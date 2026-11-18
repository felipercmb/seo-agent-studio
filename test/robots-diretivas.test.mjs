import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classificarCabecalhoRobots,metaTemNoindex,metaTemNofollow,cabecalhoPedeNaoSeguir} from '../src/robots-diretivas.mjs';

test('parâmetros none não se tornam diretivas de indexação ou seguimento',()=>{
  assert.equal(metaTemNoindex('max-image-preview: none'),false);
  assert.equal(metaTemNofollow('max-image-preview: none'),false);
  assert.equal(cabecalhoPedeNaoSeguir('max-image-preview: none'),false);
  assert.equal(cabecalhoPedeNaoSeguir('max-image-preview: none nofollow'),true);
  assert.equal(metaTemNoindex('max-image-preview: none, noindex'),true);
  assert.equal(cabecalhoPedeNaoSeguir('googlebot: nofollow'),true);
});

test('cabeçalho distingue diretiva geral, Google e escopos que não podem ser atribuídos',()=>{
  for(const valor of ['noindex','NOINDEX, nofollow','googlebot: noindex','googlebot: none',
    'nofollow, googlebot: noindex','noindex, otherbot: nofollow']) {
    assert.equal(classificarCabecalhoRobots(valor).estado,'noindex',valor);
  }
  for(const valor of ['bingbot: noindex','googlebot-news: noindex','otherbot: noindex, noindex']) {
    assert.equal(classificarCabecalhoRobots(valor).estado,'inconclusivo',valor);
  }
  assert.equal(classificarCabecalhoRobots(null).estado,'ausente');
  assert.equal(classificarCabecalhoRobots('nofollow, max-image-preview: none').estado,'sem_noindex');
  assert.equal(classificarCabecalhoRobots('diretiva-desconhecida').estado,'inconclusivo');
  assert.equal(classificarCabecalhoRobots('nofollow, diretiva-desconhecida').estado,'inconclusivo');
  assert.equal(classificarCabecalhoRobots('max-image-preview: none noindex').estado,'inconclusivo');
  assert.equal(classificarCabecalhoRobots('max-snippet: noindex').estado,'inconclusivo');
  assert.equal(classificarCabecalhoRobots('x'.repeat(513)).estado,'inconclusivo');
});
