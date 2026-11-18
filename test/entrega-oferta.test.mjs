import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizarEntregaOferta} from '../src/modulos/entrega-oferta.mjs';
import {corrigirPerfil} from '../src/modulos/perfil.mjs';
import {compararRevisaoPerfil} from '../src/modulos/revisao-perfil.mjs';
import {gerarPalavras} from '../src/modulos/palavras.mjs';

const inicial=()=>({versao:1,dominio:'cliente.com.br',estado:'rascunho',nome:'Grupo exemplo',resumo:'Atividades a confirmar',publico:'',regioes:[],exclusoes:[],ofertas:[],entendimento:{versao:2,papel:'produtos',natureza:'declaracao_usuario',evidencias:[],atuacoes:[]}});
const entrada=()=>({confirmado:true,ofertas:[{nome:'Hospedagem para WordPress',url:'https://cliente.com.br/hospedagem',entrega:{tipoOferta:'software',papelOrganizacao:'disponibiliza'}},{nome:'Implantação assistida',url:'https://cliente.com.br/implantacao',entrega:{tipoOferta:'servico',papelOrganizacao:'executa'}}]});

test('duas ofertas do mesmo negócio preservam tipo e papel distintos sem inventar quem executa a rotina',()=>{
  const p=corrigirPerfil(inicial(),entrada());
  assert.equal(p.ofertas[0].entrega.tipoOferta,'software');assert.equal(p.ofertas[0].entrega.papelOrganizacao,'disponibiliza');
  assert.equal(p.ofertas[1].entrega.tipoOferta,'servico');assert.equal(p.ofertas[1].entrega.papelOrganizacao,'executa');
  assert.ok(p.ofertas.every(o=>o.entrega.origem==='declaracao_usuario'&&o.jornada===undefined));
  assert.equal(p.entendimento.papel,'produtos');
});

test('software declarado não recebe reserva de hotel ou orçamento de serviço, e serviço não herda compra de produto do papel global',()=>{
  const p=corrigirPerfil(inicial(),entrada()),{candidatos}=gerarPalavras({perfil:p});
  const soft=candidatos.filter(c=>c.ofertaId===p.ofertas[0].id),servico=candidatos.filter(c=>c.ofertaId===p.ofertas[1].id);
  assert.ok(soft.some(c=>c.termo==='contratar Hospedagem para WordPress'));
  assert.ok(soft.every(c=>!/^reservar |^orçamento para /u.test(c.termo)));
  assert.ok(servico.some(c=>c.termo==='orçamento para Implantação assistida'));
  assert.ok(servico.every(c=>!/^comprar /u.test(c.termo)));
  assert.ok(candidatos.every(c=>c.origem==='hipotese'));
});

test('produto declarado prevalece sobre nome que parece gestão de software, sem alterar papéis do cliente',()=>{
  const p=corrigirPerfil(inicial(),{confirmado:true,ofertas:[{nome:'Manual de gestão',entrega:{tipoOferta:'produto',papelOrganizacao:'vende'}}]});
  const termos=gerarPalavras({perfil:p}).candidatos.map(c=>c.termo);
  assert.ok(termos.includes('comprar Manual de gestão'));assert.ok(!termos.includes('contratar Manual de gestão'));
  assert.equal(p.ofertas[0].jornada,undefined);
});

test('atualização parcial preserva entrega declarada, limpeza explícita remove e edição retira confirmação',()=>{
  const p=corrigirPerfil(inicial(),entrada());
  const parcial=corrigirPerfil(p,{ofertas:p.ofertas.map(o=>({id:o.id,nome:o.nome}))});
  assert.deepEqual(parcial.ofertas.map(o=>o.entrega),p.ofertas.map(o=>o.entrega));assert.equal(parcial.estado,'rascunho');
  const limpo=corrigirPerfil(parcial,{ofertas:parcial.ofertas.map(o=>({id:o.id,nome:o.nome,entrega:null}))});
  assert.ok(limpo.ofertas.every(o=>o.entrega===undefined));
});

test('renomear uma oferta pela API não transfere declaração de entrega de outro objeto',()=>{
  const p=corrigirPerfil(inicial(),entrada());
  const outro=corrigirPerfil(p,{ofertas:[{id:p.ofertas[0].id,nome:'Nova atividade diferente'}]});
  assert.equal(outro.ofertas[0].entrega,undefined);
});

test('registro da revisão distingue correção de entrega de correção econômica',()=>{
  const p=corrigirPerfil(inicial(),entrada()),nova=corrigirPerfil(p,{confirmado:true,ofertas:p.ofertas.map((o,i)=>({id:o.id,nome:o.nome,...(i===0?{entrega:{tipoOferta:'servico',papelOrganizacao:'intermedeia'}}:{})}))});
  const r=compararRevisaoPerfil(p,nova),alterada=r.ofertas.alteradas.find(o=>o.id===p.ofertas[0].id);
  assert.ok(alterada.campos.includes('entrega'));assert.equal(alterada.entrega.depois.papelOrganizacao,'intermedeia');assert.equal(r.economiaAlterada,false);
});

test('contrato recusa conteúdo arbitrário, origem falsa e classificações não suportadas',()=>{
  for(const v of [[],{},undefined,{tipoOferta:'software',papelOrganizacao:'disponibiliza',origem:'observada'},{tipoOferta:'software',papelOrganizacao:'executa_tudo'},{tipoOferta:'programa_social',papelOrganizacao:'vende'}])assert.throws(()=>normalizarEntregaOferta(v));
  assert.equal(normalizarEntregaOferta(null),null);
});
