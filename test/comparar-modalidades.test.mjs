import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compararLimitesDeModalidades as comparar} from '../src/modulos/comparar-modalidades.mjs';

const dominio='empresa.com.br',url='https://'+dominio+'/planos';
const fonte=(trecho,outros={})=>({trecho,url,sha256:'a'.repeat(64),coletadoEm:'2026-11-18T03:00:00.000Z',
  recortado:false,...outros});
const gratis=fonte('Sim. O plano Gratuito custa R$ 0 e atende até 3 usuários, com 2 GB de armazenamento.');
const empresa=fonte('O plano Corporativo tem mínimo de 10 usuários e custa R$ 156 por usuário/mês.');
const rodar=(...fontes)=>comparar({dominio,ofertaId:'crm',fontes});

test('contrasta o máximo de uma modalidade com o mínimo de outra, preservando as lacunas',()=>{
  const r=rodar(gratis,empresa);
  assert.equal(r.unidade,'usuarios');
  assert.equal(r.elegibilidadeConfirmada,false);
  assert.deepEqual(r.modalidades.map(m=>[m.modalidade,m.minimo,m.maximo]),[
    ['plano Gratuito',null,3],['plano Corporativo',10,null]
  ]);
  assert.deepEqual(r.casos.map(c=>c.quantidade),[3,4,10]);
  assert.deepEqual(r.casos[1].comparacao.map(c=>c.resultado),['acima_do_maximo','abaixo_do_minimo']);
  for(const m of r.modalidades){
    assert.equal(m.fonte.trecho.slice(m.inicio,m.fim),m.trechoLimite);
    assert.ok(m.fonte.trecho.includes(m.frase));
  }
});

test('recusa misturar versões, rotas, unidades, trechos recortados ou capacidade que depende de outra modalidade',()=>{
  for(const f of [
    {...empresa,sha256:'b'.repeat(64)},
    {...empresa,url:url+'/outros'},
    {...empresa,coletadoEm:'2026-11-17T03:00:00.000Z'},
    {...empresa,recortado:true},
    {...empresa,trecho:'O plano Corporativo tem mínimo de 10 projetos.'},
    {...empresa,trecho:'O plano Corporativo oferece demo e o plano Básico tem mínimo de 5 usuários.'},
    {...empresa,trecho:'O plano Corporativo tem mínimo de 10 usuários por mês.'},
  ])assert.equal(rodar(gratis,f),null);
  assert.equal(rodar(gratis,{...gratis,trecho:'O plano Gratuito atende até 5 usuários.'},empresa),null);
});

test('cartões com preço e ciclos diferentes conservam a unidade de usuários de campo',()=>{
  const cartao=(nome,n,preco,extra={})=>fonte(nome+' R$ '+preco+' Para equipes de até 100 usuários. Até '+n+' usuários de campo 15 dias de teste Assinar agora.',
    {campo:'bloco.titulo-conteudo',titulos:[{nivel:3,texto:nome}],...extra});
  const inicial=cartao('Inicial',2,'122,00 /mês');
  const equipe=cartao('Equipe',6,'250,00 /mês');
  const anual=cartao('Equipe',6,'200,00 por mês, cobrança anual');
  const r=rodar(inicial,equipe,anual);
  assert.equal(r?.unidade,'usuarios_de_campo');
  assert.deepEqual(r.modalidades.map(m=>m.maximo),[2,6]);
  assert.deepEqual(r.modalidades.map(m=>m.trechoLimite),['Até 2 usuários de campo','Até 6 usuários de campo']);
  assert.deepEqual(r.casos.map(c=>c.quantidade),[2,6,7]);
  assert.equal(rodar(inicial,equipe,cartao('Equipe',7,'200,00 por mês, cobrança anual')),null);
  const condicionado={...equipe,trecho:equipe.trecho.replace('de campo 15','de campo se ativar a extensão. 15')};
  assert.equal(rodar(inicial,condicionado),null);
  assert.equal(rodar({...inicial,url:'https://terceiro.com.br/planos'},{...equipe,url:'https://terceiro.com.br/planos'}),null);
});
