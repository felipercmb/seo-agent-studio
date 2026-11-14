import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

// Execute the browser's actual comparison function without loading the DOM.
const html = readFileSync(new URL('../src/portal.html', import.meta.url), 'utf8');
const trecho = html.match(/function compararLeituras\([\s\S]*?(?=\nfunction rotuloVerificacao\()/)?.[0];
assert.ok(trecho, 'A função de comparação da interface deve estar disponível para este teste.');
const contexto = {};
runInNewContext(trecho, contexto);
const comparar = contexto.compararLeituras;

function leituras() {
  return {
    anterior: {
      coletadoEm: '2026-11-14T12:00:00Z', estado: 'concluido',
      paginas: ['https://negocio.com/', 'https://negocio.com/contato'],
      verificacoes: [{id: 'alternativas-imagens', estado: 'atencao'}],
    },
    atual: {
      coletadoEm: '2026-11-14T13:00:00Z', estado: 'concluido',
      paginas: [{url: 'https://negocio.com/contato'}, {url: 'https://negocio.com/'}],
      falhas: [], cache: {reutilizado: false},
      verificacoes: [{id: 'alternativas-imagens', titulo: 'Alternativas das imagens', estado: 'verificado'}],
    },
  };
}

const desapareceu = resultado => resultado.itens.some(item => /não apareceu nesta leitura/.test(item.resultado));

test('primeira leitura não inventa uma melhoria sem referência anterior', () => {
  const {atual} = leituras();
  assert.equal(comparar(null, atual), null);
});

test('cache reutilizado ou mesma data não são tratados como nova observação', () => {
  const {anterior, atual} = leituras();
  for (const rel of [
    {...atual, cache: {reutilizado: true}},
    {...atual, coletadoEm: anterior.coletadoEm},
  ]) {
    const resultado = comparar(anterior, rel);
    assert.equal(resultado.tipo, 'reutilizada');
    assert.equal(resultado.itens.length, 0);
  }
});

test('nova data e mesmas páginas permitem comparar a regra automática repetida', () => {
  const {anterior, atual} = leituras();
  const resultado = comparar(anterior, atual);
  assert.equal(resultado.tipo, 'comparavel');
  assert.equal(resultado.data, anterior.coletadoEm);
  assert.equal(desapareceu(resultado), true);
  const persistente = comparar(anterior, {...atual,
    verificacoes: [{...atual.verificacoes[0], estado: 'atencao'}],
  });
  assert.equal(desapareceu(persistente), false);
  assert.match(persistente.itens[0].resultado, /continua presente/);
  const manual = comparar(anterior, {...atual,
    verificacoes: [{...atual.verificacoes[0], estado: 'manual'}],
  });
  assert.equal(desapareceu(manual), false);
  assert.match(manual.itens[0].resultado, /não permite concluir/);
});

test('cobertura parcial em qualquer leitura ou falha atual impede confirmar correção', () => {
  const {anterior, atual} = leituras();
  const cenarios = [
    [{...anterior, estado: 'parcial'}, atual],
    [anterior, {...atual, estado: 'parcial'}],
    [anterior, {...atual, falhas: [{url: 'https://negocio.com/contato', motivo: 'Indisponível'}]}],
  ];
  for (const [antes, depois] of cenarios) {
    const resultado = comparar(antes, depois);
    assert.equal(resultado.tipo, 'inconclusiva');
    assert.equal(desapareceu(resultado), false);
  }
});

test('mudança nas URLs impede atribuir ausência de problema a uma correção', () => {
  const {anterior, atual} = leituras();
  const resultado = comparar(anterior, {...atual,
    paginas: [{url: 'https://negocio.com/'}, {url: 'https://negocio.com/sobre'}],
  });
  assert.equal(resultado.tipo, 'inconclusiva');
  assert.equal(desapareceu(resultado), false);
});

test('regra anterior não repetida permanece inconclusiva mesmo com mesmas páginas', () => {
  const {anterior, atual} = leituras();
  const resultado = comparar(anterior, {...atual, verificacoes: []});
  assert.equal(desapareceu(resultado), false);
  assert.equal(resultado.itens.length, 1);
  assert.match(resultado.itens[0].resultado, /inconclusiva/);
});
