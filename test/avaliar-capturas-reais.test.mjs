import test from 'node:test';
import assert from 'node:assert/strict';
import {avaliarPerfilReal,evidenciaDaPropostaVerificavel} from '../scripts/avaliar-capturas-reais.mjs';

const rotulo={papeisAceitaveis:['servicos'],gruposObrigatorios:[{id:'erp',padroes:['sistema de gestao','erp']}],
  naoOfertas:['O que é um sistema de gestão?']};

test('pergunta com palavras de uma oferta não ganha suporte só pelo núcleo compartilhado',()=>{
  const resultado=avaliarPerfilReal({entendimento:{papel:'servicos'},ofertas:[{nome:'O que é um sistema de gestão?'}]},rotulo);
  assert.equal(resultado.propostasIndevidas,1);
  assert.equal(resultado.propostasCompativeis,0);
  assert.equal(resultado.grupos[0].presente,false);
});

test('proposta sem revisão permanece explícita e não é automaticamente aprovada ou reprovada',()=>{
  const resultado=avaliarPerfilReal({entendimento:{papel:'servicos'},ofertas:[{nome:'Sistema de gestão ERP'},{nome:'Oferta adicional não revisada'}]},rotulo);
  assert.equal(resultado.propostasCompativeis,1);
  assert.equal(resultado.propostasNaoRevisadas,1);
  assert.equal(resultado.totalPropostas,2);
  assert.equal(resultado.grupos[0].presente,true);
});

test('ausência de leitura só permite classificar papel como indefinido pelo rótulo disponível',()=>{
  const resultado=avaliarPerfilReal({entendimento:{papel:'indefinido'},ofertas:[]},{papeisAceitaveis:['indefinido'],gruposObrigatorios:[],naoOfertas:[]});
  assert.equal(resultado.papel.compativel,true);
  assert.equal(resultado.totalPropostas,0);
});

test('referência de proposta precisa corresponder à página capturada, hash, data e texto',()=>{
  const p={url:'https://empresa.example/',sha256:'a'.repeat(64),coletadoEm:'2026-11-15T19:00:00Z',
    html:'<h1>Serviços de logística para empresas</h1>'};
  const oferta={nome:'Serviços de logística',evidencias:[{url:p.url,sha256:p.sha256,coletadoEm:p.coletadoEm,trecho:'Serviços de logística para empresas'}]};
  assert.equal(evidenciaDaPropostaVerificavel(oferta,{paginas:[p]}),true);
  oferta.evidencias[0].sha256='b'.repeat(64);
  assert.equal(evidenciaDaPropostaVerificavel(oferta,{paginas:[p]}),false);
});

test('frase que ocorre no site não autentica citação de outra URL ou oferta inventada',()=>{
  const p={url:'https://empresa.example/',sha256:'a'.repeat(64),coletadoEm:'2026-11-15T19:00:00Z',html:'<p>Assessoria de eventos</p>'};
  const oferta={nome:'Assessoria de eventos',evidencias:[{url:'https://rival.example/',sha256:p.sha256,coletadoEm:p.coletadoEm,trecho:'Assessoria de eventos'}]};
  assert.equal(evidenciaDaPropostaVerificavel(oferta,{paginas:[p]}),false);
  oferta.evidencias[0].url=p.url;oferta.nome='Venda de equipamentos';
  assert.equal(evidenciaDaPropostaVerificavel(oferta,{paginas:[p]}),false);
});
