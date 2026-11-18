import test from 'node:test';
import assert from 'node:assert/strict';
import {construirMapaInvestigacao} from '../src/modulos/mapa-investigacao.mjs';

const instante=Date.parse('2026-11-16T21:10:00Z'),agora=()=>instante;
const perfil=()=>({estado:'confirmado',ofertas:[{id:'o1',nome:'Contratação de artista gospel',url:'https://cliente.com/contratar',
  jornada:{natureza:'declaracao_usuario',comprador:'Organizador de evento',executor:'Artista contratado',beneficiario:'Público do evento',objetivo:'Contratar uma apresentação para a data e o local do evento'}}]});
function projeto(candidatos=[]){return {dominio:'cliente.com',perfil:perfil(),palavras:{candidatos},oportunidades:{itens:[]}};}
const candidatura=(termo,extra={})=>({termo,ofertaId:'o1',origem:'hipotese',intencao:'comercial',...extra});
const observado=(termo,extra={})=>({termo,ofertaId:'o1',observado:{estado:'encontrado',posicao:11,contexto:{pais:'Brasil'}},
  evidencias:[{tipo:'google',fonte:'Fonte controlada',coletadoEm:new Date(instante-1000).toISOString()}],...extra});

test('expressão ampla sem oferta não herda intenção, objetivo ou posição da contratação',()=>{
  const p=projeto([candidatura('show',{ofertaId:null,intencao:'indefinida'}),candidatura('contratar artista gospel')]);
  p.oportunidades.itens=[observado('contratar artista gospel')];
  const m=construirMapaInvestigacao(p,{agora});
  assert.equal(m.semVinculo.quantidade,1);assert.equal(m.semVinculo.primeirasBuscas[0].observado.estado,'nao_medido');
  assert.match(m.semVinculo.primeirasBuscas[0].questao,/informação, marca, apoio ou atendimento/);
  assert.equal(m.porOferta[0].primeirasBuscas[0].observado.posicao,11);
  assert.match(m.porOferta[0].primeirasBuscas[0].questao,/Contratação de artista gospel/);
});

test('ordem local do resumo não altera candidatos, plano de medição ou premissas',()=>{
  const p=projeto([candidatura('como funciona a contratação',{intencao:'informacional'}),candidatura('preço de artista gospel')]);
  p.perfil.ofertas[0].premissasEconomicas={contribuicao:987654.32,fechamento:.54321};
  const antes=structuredClone(p),m=construirMapaInvestigacao(p,{agora});
  assert.equal(m.porOferta[0].primeirasBuscas[0].termo,'preço de artista gospel');
  assert.deepEqual(p,antes);assert.doesNotMatch(JSON.stringify(m),/987654|54321|contribuicao|premissasEconomicas/);
  assert.equal(m.porOferta[0].primeirasBuscas[0].naturezaIntencao,'hipotese_por_regras');
});

test('nome e associação de oferta precisam existir no perfil; IDs soltos não confirmam vínculo',()=>{
  const p=projeto([candidatura('contratar banda',{ofertaId:'removida'})]);
  p.oportunidades.itens=[observado('contratar banda',{ofertaId:'removida'})];
  const m=construirMapaInvestigacao(p,{agora});
  assert.equal(m.porOferta[0].estado,'vincular_buscas');assert.equal(m.semVinculo.quantidade,1);
  assert.equal(m.semVinculo.primeirasBuscas[0].observado.estado,'nao_medido');
});

test('rascunho não é tratado como decisão validada e URL externa não se torna página da oferta',()=>{
  const p=projeto([candidatura('contratar artista')]);p.perfil.estado='rascunho';p.perfil.ofertas[0].url='https://rival.com/';
  const m=construirMapaInvestigacao(p,{agora});
  assert.equal(m.estado,'revisao_necessaria');assert.equal(m.porOferta[0].estado,'revisar_perfil');assert.equal(m.porOferta[0].pagina,null);
  assert.equal(m.porOferta[0].perfilConfirmado,false);
  p.perfil.estado='confirmado';assert.equal(construirMapaInvestigacao(p,{agora}).porOferta[0].estado,'vincular_pagina');
});

test('ausência no recorte continua sem posição e não comprova concorrentes à frente',()=>{
  const p=projeto([candidatura('contratar artista')]);
  p.oportunidades.itens=[observado('contratar artista',{observado:{estado:'nao_encontrado_no_recorte',posicao:null,concorrentes:[{posicao:1,dominio:'rival.com'}]}})];
  const m=construirMapaInvestigacao(p,{agora}),o=m.porOferta[0].primeirasBuscas[0].observado;
  assert.equal(o.estado,'nao_encontrado_no_recorte');assert.equal(o.posicao,null);assert.equal(o.concorrentes,undefined);
  assert.equal(m.cobertura.comObservacaoAtual,1);
});

test('vencimento, futuro e falta de fonte retiram posição do resumo',()=>{
  for(const [delta,fonte] of [[3600_000,'Fonte'],[-1,'Fonte'],[0,'']]){
    const p=projeto([candidatura('contratar artista')]);
    p.oportunidades.itens=[observado('contratar artista',{evidencias:[{tipo:'google',fonte,coletadoEm:new Date(instante-delta).toISOString()}]})];
    assert.equal(construirMapaInvestigacao(p,{agora}).porOferta[0].primeirasBuscas[0].observado.estado,'nao_medido');
  }
});

test('observação duplicada ambígua e observação para outra oferta não emprestam posição',()=>{
  for(const itens of [[observado('contratar artista'),observado('CONTRATAR ARTISTA')],[observado('contratar artista',{ofertaId:'o2'})]]){
    const p=projeto([candidatura('contratar artista')]);p.oportunidades.itens=itens;
    assert.equal(construirMapaInvestigacao(p,{agora}).cobertura.comObservacaoAtual,0);
  }
});

test('participação e apoio não viram oferta nem busca sem valor por não serem venda',()=>{
  const p=projeto([candidatura('como apoiar o programa',{ofertaId:null,atuacaoId:'a1',intencao:'informacional'})]);
  p.perfil.ofertas=[];const m=construirMapaInvestigacao(p,{agora});
  assert.equal(m.outrasAtividades.quantidade,1);assert.equal(m.semVinculo.quantidade,0);assert.equal(m.porOferta.length,0);
  assert.doesNotMatch(JSON.stringify(m.outrasAtividades),/inútil|desperdício comprovado|baixo valor/);
});

test('deduplicação e limite visual informam quantas buscas ficaram no plano completo',()=>{
  const p=projeto([...Array.from({length:6},(_,i)=>candidatura('Contratar artista '+i)),candidatura('CONTRATAR ARTISTA 0?')]);
  const m=construirMapaInvestigacao(p,{agora});
  assert.equal(m.cobertura.candidatas,6);assert.equal(m.porOferta[0].primeirasBuscas.length,3);assert.equal(m.porOferta[0].outrasBuscas,3);
  assert.equal(m.porOferta[0].cobertura.candidatas,6);
});

test('sem dados não vira volume, previsão de receita, posição zero ou conteúdo confirmado',()=>{
  const p=projeto([candidatura('contratar artista')]),m=construirMapaInvestigacao(p,{agora});
  assert.equal(m.porOferta[0].pagina.conteudoConfirmado,false);assert.equal(m.porOferta[0].pagina.origem,'perfil');
  assert.equal(m.porOferta[0].primeirasBuscas[0].observado.posicao,null);
  assert.doesNotMatch(JSON.stringify(m),/buscasMensais|receitaPrevista|valorPorPalavra|verbaSugerida/);
});

test('data civil inexistente não é normalizada para parecer uma observação atual',()=>{
  const p=projeto([candidatura('contratar artista')]);
  p.oportunidades.itens=[observado('contratar artista',{evidencias:[{tipo:'google',fonte:'Fonte',coletadoEm:'2026-02-31T12:00:00Z'}]})];
  const m=construirMapaInvestigacao(p,{agora:()=>Date.parse('2026-03-03T12:10:00Z')});
  assert.equal(m.cobertura.comObservacaoAtual,0);
});
