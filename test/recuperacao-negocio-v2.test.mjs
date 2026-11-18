import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recuperarFontesNegocio as v1} from '../ia/negocio/recuperacao.mjs';
import {recuperarFontesNegocio as v2} from '../ia/negocio/recuperacao-v2.mjs';

const dominio='exemplo.com.br',sha256='b'.repeat(64),coletadoEm='2026-11-16T03:00:00Z';
const fonte=(id,texto,extras={})=>({id,texto,tipo:'conteudo',url:'https://exemplo.com.br/',campo:'p',coletadoEm,sha256,recortado:false,...extras});
const pool=fontes=>({versao:1,dominio,fontes});

test('recupera declaração de atividade e nome nominal sem exigir a palavra serviço',()=>{
  const entrada=pool([fonte('declaracao','Somos uma agência que conecta profissionais criativos a empresas que planejam eventos.'),fonte('nome','Equipamentos',{campo:'h2'}),fonte('entidade','Empresa Exemplo',{tipo:'declaracao',campo:'jsonld.Organization.name'})]);
  const antes=v1(entrada,{campo:'ofertas'}),depois=v2(entrada,{campo:'ofertas'});
  assert.ok(!antes.fontes.some(f=>f.id==='declaracao'));assert.ok(depois.fontes.some(f=>f.id==='declaracao'));assert.ok(depois.fontes.some(f=>f.id==='nome'));assert.ok(!depois.fontes.some(f=>f.id==='entidade'));
});

test('metadado de nome repetido não afasta objeto, e pergunta não substitui resposta',()=>{
  const fontes=Array.from({length:8},(_,i)=>fonte('org'+i,'Empresa Exemplo',{tipo:'declaracao',campo:'jsonld.Organization.name',url:'https://exemplo.com.br/pagina-'+i}));
  fontes.push(fonte('pergunta','Quais são os serviços disponíveis?',{tipo:'declaracao',campo:'jsonld.Question.name'}),fonte('resposta','Oferecemos oficinas práticas com mentoria individual e aulas presenciais.'));
  const r=v2(pool(fontes),{campo:'ofertas',maxFontes:2});assert.ok(r.fontes.some(f=>f.id==='resposta'));assert.ok(!r.fontes.some(f=>f.id.startsWith('org')||f.id==='pergunta'));assert.ok(r.auditoria.descartes.some(d=>d.motivo==='texto_e_secao_repetidos_em_outra_pagina'));
});

test('capacidade e modalidade publicadas são contexto mesmo sem condição formal',()=>{
  const f=fonte('capacidade','Atendimento empresarial Integração de estoque e emissão automática de documentos. Aulas online e ao vivo.',{campo:'bloco.titulo-conteudo',secao:'Atendimento empresarial'});
  const r=v2(pool([f]),{campo:'condicoes'});assert.deepEqual(r.fontes,[f]);assert.ok(r.auditoria.candidatos[0].motivos.some(m=>m.criterio==='funcionamento_ou_modalidade_publicados'));
});

test('negação completa e contexto do processo não viram exclusão de outro público',()=>{
  const fontes=[fonte('titulo','Inscrição e seleção',{campo:'h2'}),fonte('regra','Indisponível para profissionais autônomos. A admissão depende de oportunidades abertas.',{secao:'Inscrição e seleção'}),fonte('clientes','Pacientes podem agendar atendimento particular.',{secao:'Atendimento particular'})];
  const r=v2(pool(fontes),{campo:'publicos'});assert.ok(r.fontes.some(f=>f.id==='regra'));assert.ok(r.fontes.some(f=>f.id==='titulo'));assert.ok(r.fontes.some(f=>f.id==='clientes'));assert.ok(r.auditoria.escoposVizinhos.every(v=>v.relacaoSemanticaConfirmada===false));assert.equal(r.publicos,undefined);
});

test('bloco original substitui fragmento redundante sem construir uma frase',()=>{
  const texto='Plano Inicial Disponível somente online e com limite de vinte usuários.';
  const fontes=[fonte('titulo','Plano Inicial',{campo:'h2'}),fonte('p','Disponível somente online e com limite de vinte usuários.',{secao:'Plano Inicial'}),fonte('bloco',texto,{campo:'bloco.titulo-conteudo',secao:'Plano Inicial'})];
  const r=v2(pool(fontes),{campo:'condicoes'});assert.ok(r.fontes.some(f=>f.id==='bloco'&&f.texto===texto));assert.ok(!r.fontes.some(f=>f.id==='p'));assert.ok(r.auditoria.escoposVizinhos.every(v=>r.fontes.some(f=>f.id===v.fonteId)&&r.fontes.some(f=>f.id===v.contextoId)));
});

test('mesma condição em seções distintas preserva as duas origens',()=>{
  const fontes=[fonte('a','Disponível somente online.',{secao:'Plano Inicial'}),fonte('b','Disponível somente online.',{secao:'Plano Avançado',url:'https://exemplo.com.br/avancado'})];const r=v2(pool(fontes),{campo:'condicoes'});assert.equal(r.fontes.length,2);assert.equal(r.auditoria.equivalentesNaoExibidos.length,0);
});

test('páginas úteis e exclusão de interface continuam com origem íntegra',()=>{
  const fontes=Array.from({length:24},(_,i)=>fonte('home'+i,'Oferecemos cursos para empresas com materiais publicados '+i+'.'));fontes.push(fonte('outra','Consultoria jurídica',{campo:'jsonld.Service.name',tipo:'declaracao',url:'https://exemplo.com.br/consultoria'}),fonte('interface','Comprar produtos',{tipo:'interface',campo:'button'}));const r=v2(pool(fontes),{campo:'ofertas',maxFontes:4});assert.ok(r.fontes.some(f=>f.id==='outra'));assert.ok(!r.fontes.some(f=>f.id==='interface'));assert.ok(r.fontes.every(f=>fontes.some(original=>JSON.stringify(original)===JSON.stringify(f))));
});

test('orçamento usa fontes inteiras com caracteres de formato e não altera o pool',()=>{
  const fontes=[fonte('cf','Condições: CNPJ obrigatório.\u200d Restrição publicada e somente para a seleção.'),fonte('longo','Disponível somente online. '+('Condição adicional publicada. '.repeat(18)))],entrada=pool(fontes),antes=structuredClone(entrada),r=v2(entrada,{campo:'condicoes',maxCaracteres:250});assert.ok(r.fontes.some(f=>f.id==='cf'&&f.texto.includes('\u200d')));assert.ok(!r.fontes.some(f=>f.id==='longo'));assert.ok(r.auditoria.caracteresModelo<=250);assert.deepEqual(entrada,antes);
});

test('nomes C+ e C++ e origens de páginas distintas não são fundidos',()=>{
  const entrada=pool([fonte('cmais','Curso C+',{tipo:'declaracao',campo:'jsonld.Course.name'}),fonte('cpp','Curso C++ Inclui dez aulas.',{campo:'bloco.titulo-conteudo'}),fonte('outro','Curso C+ Inclui vinte aulas.',{campo:'bloco.titulo-conteudo',url:'https://exemplo.com.br/outra'})]);const r=v2(entrada,{campo:'ofertas'});assert.equal(r.fontes.length,3);assert.ok(!r.auditoria.escoposVizinhos.some(v=>v.fonteId==='cmais'));
});

test('pool vazio e metadados inválidos permanecem sem contexto inventado',()=>{
  assert.equal(v2(pool([]),{campo:'papel'}).fontes.length,0);const entrada=pool([fonte('bad','Somos uma empresa de produtos.',{sha256:'inválido'}),fonte('externo','Somos uma empresa de produtos.',{url:'https://externo.com/'})]);assert.equal(v2(entrada,{campo:'papel'}).fontes.length,0);assert.throws(()=>v2(pool([]),{campo:'inventado'}));
});
