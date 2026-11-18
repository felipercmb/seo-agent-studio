import test from 'node:test';
import assert from 'node:assert/strict';
import {avaliarCasos} from '../scripts/avaliar-rodada-modular.mjs';

const caso = (id, split='development') => ({id,split,familia:'familia_'+id,dominio:'empresa-avaliada.example',
  natureza:'sintetico_controlado',publicado:[{termo:'Reparo de equipamentos',tipo:'servico'}],
  esperado:{ofertasObrigatorias:['Reparo de equipamentos'],ofertasAceitaveis:['Reparo de equipamentos'],
    palavras:[],oportunidades:[]}});
const corpus = casos => ({versao:1,relogioReferencia:'2026-11-15T17:47:09Z',casos});
const modulos = {
  inferirPerfil:({dominio}) => ({dominio,estado:'rascunho',ofertas:[
    {id:'oferta1',nome:'Reparo de equipamentos'}, {id:'oferta2',nome:'Oferta inventada'}]}),
  gerarPalavras:() => ({candidatos:[]}),
  avaliarOportunidades:() => ({itens:[]}),
};

test('avaliador registra oferta indevida sem eliminar a proposta do denominador', async () => {
  const r = await avaliarCasos(corpus([caso('controle')]),modulos,['development']);
  assert.deepEqual(r.metricas.ofertas_propostas,{aprovados:1,total:2});
  assert.deepEqual(r.metricas.ofertas_obrigatorias,{aprovados:1,total:1});
  assert.equal(r.casosIntegralmenteAprovados,0);
  assert.equal(r.falhas[0].id,'Oferta inventada');
});

test('avaliador mantém erro de execução e quantidade de casos solicitados', async () => {
  const r = await avaliarCasos(corpus([caso('erro')]),{...modulos,
    inferirPerfil:() => { throw new Error('falha controlada'); }},['development']);
  assert.equal(r.casosSolicitados,1);
  assert.equal(r.casosExecutados,0);
  assert.equal(r.casosIntegralmenteAprovados,0);
  assert.deepEqual(r.errosExecucao,[{id:'erro',split:'development',erro:'falha controlada'}]);
});

test('filtro de split evita executar casos reservados em avaliação de desenvolvimento', async () => {
  const r = await avaliarCasos(corpus([caso('dev'),caso('reservado','holdout')]),modulos,['development']);
  assert.equal(r.casosSolicitados,1);
  assert.deepEqual(r.resultados.map(x => x.id),['dev']);
});
