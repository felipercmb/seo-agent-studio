import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the actual browser payload builder without invoking network or AI.
// These regressions concern saving edits, not rendering or a mirror of the formula.
const html = readFileSync(new URL('../src/projeto.html', import.meta.url), 'utf8');
const inicio = html.indexOf('function numeroOpcional('), fim = html.indexOf('function montarAtuacao(');
assert.ok(inicio >= 0 && fim > inicio, 'localizar o construtor real do formulário');
const montarOferta = Function(html.slice(inicio, fim) + '\nreturn montarOferta;')();
const input = v => ({value:v === null || v === undefined ? '' : String(v)});
function rascunho(premissasOriginais, contribuicao) {
  const premissas = Object.fromEntries(['referencia','inicio','fim','populacao','criterio','contatos','fechamentos','aquisicao','fixos','minContrib','maxContrib','minTaxa','maxTaxa','minAquisicao','maxAquisicao','minFixos','maxFixos'].map(k => [k,input('')]));
  premissas.origem = input('declarada');
  return {id:'oferta_original', nome:input('Contratação de artistas gospel'), url:input('https://cliente.com.br/contratacao'),
    contribuicao:input(contribuicao), taxa:input(25), centralidadeAlterada:false,
    premissas, premissasOriginais, removerPremissas:false};
}
function originais(completas = false) {
  return {versao:1, ofertaId:'oferta_original', moeda:'BRL',
    origem:completas ? {tipo:'registro_local',referencia:'Resumo fictício antigo'} : null,
    periodo:completas ? {inicio:'2026-10-01',fim:'2026-10-31'} : null,
    coorte:completas ? {descricao:'Grupo antigo',criterioQualificacao:'Qualificação antiga'} : null,
    contribuicaoPorVenda:{tipo:'valor',valor:1000},fechamento:{tipo:'valor',valor:.25},custosAquisicao:null,custosFixos:null};
}

test('salvar novo valor pontual de premissa incompleta mantém a edição e a ausência de contexto', () => {
  const anteriores = originais(), antes = structuredClone(anteriores);
  const oferta = montarOferta(rascunho(anteriores,2000));
  assert.equal(oferta.economia.contribuicaoPorVenda,2000);
  assert.deepEqual(oferta.premissasEconomicas.contribuicaoPorVenda,{tipo:'valor',valor:2000});
  assert.equal(oferta.premissasEconomicas.origem,null);
  assert.equal(oferta.premissasEconomicas.periodo,null);
  assert.equal(oferta.premissasEconomicas.coorte,null);
  assert.deepEqual(anteriores,antes,'a preparação do payload não modifica o projeto salvo');
});

test('limpar premissas e redigitar contribuição não recupera origem, período ou valores anteriores', () => {
  // The clear button empties the controls. A subsequent input resets
  // removerPremissas=false, so the payload must be built from this new draft.
  const oferta = montarOferta(rascunho(originais(true),2500));
  assert.equal(oferta.premissasEconomicas.origem,null);
  assert.equal(oferta.premissasEconomicas.periodo,null);
  assert.equal(oferta.premissasEconomicas.coorte,null);
  assert.deepEqual(oferta.premissasEconomicas.contribuicaoPorVenda,{tipo:'valor',valor:2500});
});
