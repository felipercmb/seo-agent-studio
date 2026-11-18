import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compararCobrancasNoTrecho} from '../src/modulos/condicoes-comerciais.mjs';

test('preserva as duas etapas e o valor com separadores decimais na publicação',()=>{
  const trecho='🧾 Crie sua loja sem mensalidade. Cobramos uma taxa de R$ 1.234,56 por venda.';
  const r=compararCobrancasNoTrecho(trecho);
  assert.equal(r.entrada.texto,'🧾 Crie sua loja sem mensalidade.');
  assert.equal(r.transacao.texto,'Cobramos uma taxa de R$ 1.234,56 por venda.');
  assert.equal(r.escopoTransacao.texto,'por venda');
  for(const p of [r.entrada,r.transacao,r.escopoTransacao]){
    assert.equal(trecho.slice(p.inicio,p.fim),p.texto);
  }
  assert.equal(r.sha256Trecho,createHash('sha256').update(trecho).digest('hex'));
});

test('a afirmação de taxa em operação condicionada preserva a condição integral',()=>{
  const trecho='Sem taxa de instalação. Caso seu evento seja pago, cobramos uma taxa sobre a inscrição.';
  assert.equal(compararCobrancasNoTrecho(trecho)?.escopoTransacao.texto,'Caso seu evento seja pago');
});

test('pergunta, isenção e tarifa de plano não viram cobrança de uma operação',()=>{
  const prefixo='Sem taxa de instalação. ';
  for(const condicao of [
    'Cobramos uma taxa por venda?',
    'Não cobramos taxa por venda.',
    'Caso seu plano seja pago, cobramos taxa de ativação.',
    'Entenda a taxa por venda antes de montar sua loja.',
    'Quando a inscrição não for paga, cobramos uma taxa por inscrição.',
    'Cobramos uma taxa se o evento não seja pago.',
  ]) assert.equal(compararCobrancasNoTrecho(prefixo+condicao),null,condicao);
  assert.equal(compararCobrancasNoTrecho('É possível criar a loja sem mensalidade? Cobramos taxa de 1% por venda.'),null);
});
