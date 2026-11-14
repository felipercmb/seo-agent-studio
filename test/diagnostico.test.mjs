import assert from 'node:assert/strict';
import {test} from 'node:test';
import {criarWorker} from '../src/worker.mjs';

function ambiente(opcoes = {}) {
  let chamadas = 0, instante = Date.parse('2026-11-14T12:00:00Z');
  const coletar = async dominio => {
    chamadas++;
    return {dominio, coletadoEm: new Date(instante).toISOString(), paginas: [], falhas: [{url: 'https://' + dominio + '/', motivo: 'Coleta não disponível neste teste.'}]};
  };
  const worker = criarWorker('<title>Consulta</title>', {coletar, agora: () => instante, ...opcoes});
  return {
    worker, chamadas: () => chamadas, avancar: ms => { instante += ms; },
    post: (body, headers = {}, path = '/api/diagnostico') => worker.fetch(new Request('https://portal.com' + path, {
      method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: typeof body === 'string' ? body : JSON.stringify(body),
    })),
  };
}

test('diagnóstico independente do índice e sem inventar defeitos quando a coleta falha', async () => {
  const a = ambiente();
  const resposta = await a.post({site: 'https://www.pequenonegocio.com.br/oferta?segredo=123'});
  assert.equal(resposta.status, 200);
  const r = await resposta.json();
  assert.equal(r.dominio, 'pequenonegocio.com.br');
  assert.equal(r.estado, 'indisponivel');
  assert.ok(!r.verificacoes.some(v => v.estado === 'atencao' || v.estado === 'verificado'));
  assert.ok(!JSON.stringify(r).includes('segredo'));
  assert.ok(r.acoes.length <= 3);
  assert.equal(a.chamadas(), 1);
  assert.equal(resposta.headers.get('Cache-Control'), 'private, no-store');
});

test('entrada e origem rejeitadas antes da coleta; GET e HEAD não iniciam trabalho', async () => {
  const a = ambiente();
  for (const corpo of [{site:'127.0.0.1'}, {site:'localhost'}, {site:'https://user:secret@site.com'}, {site:'a.com', atualizar:'sim'}, {site:'a.com', senha:'x'}, [], null, '{}', '{']) {
    assert.equal((await a.post(corpo)).status, 400);
  }
  assert.equal((await a.post({site:'a.com'}, {Origin:'https://terceiro.com'})).status, 403);
  assert.equal((await a.post({site:'a.com'}, {'Sec-Fetch-Site':'cross-site'})).status, 403);
  assert.equal((await a.post('x'.repeat(4097))).status, 400);
  assert.equal((await a.post({site:'a.com'}, {'Content-Type':'text/plain'})).status, 400);
  assert.equal((await a.post({site:'a.com'}, {}, '/api/diagnostico?site=a.com')).status, 400);
  for (const method of ['GET','HEAD']) {
    assert.equal((await a.worker.fetch(new Request('https://portal.com/api/diagnostico', {method}))).status, 405);
  }
  assert.equal(a.chamadas(), 0);
});

test('reconsulta distingue cache de nova observação e impõe intervalo mínimo', async () => {
  const a = ambiente();
  const primeira = await (await a.post({site:'negocio.com'})).json();
  assert.equal(primeira.cache.reutilizado, false);
  a.avancar(30_000);
  const cedo = await (await a.post({site:'negocio.com', atualizar:true})).json();
  assert.equal(cedo.cache.reutilizado, true);
  assert.equal(cedo.coletadoEm, primeira.coletadoEm);
  a.avancar(31_000);
  const nova = await (await a.post({site:'negocio.com', atualizar:true})).json();
  assert.equal(nova.cache.reutilizado, false);
  assert.notEqual(nova.coletadoEm, primeira.coletadoEm);
  const repetida = await (await a.post({site:'negocio.com'})).json();
  assert.equal(repetida.cache.reutilizado, true);
  assert.equal(a.chamadas(), 2);
});

test('cota de coleta preserva acesso ao relatório já analisado', async () => {
  const a = ambiente();
  for (let i=0; i<10; i++) assert.equal((await a.post({site:'negocio' + i + '.com'})).status, 200);
  const limite = await a.post({site:'outro.com'});
  assert.equal(limite.status, 429);
  assert.equal(limite.headers.get('Retry-After'), '600');
  assert.equal((await a.post({site:'negocio0.com'})).status, 200);
  a.avancar(10 * 60_000);
  assert.equal((await a.post({site:'outro.com'})).status, 200);
});

test('coletas concorrentes do mesmo domínio compartilham trabalho', async () => {
  let soltar, iniciar, chamadas = 0;
  const inicio = new Promise(resolve => { iniciar = resolve; });
  const trava = new Promise(resolve => { soltar = resolve; });
  const a = ambiente({coletar: async dominio => {
    chamadas++;
    iniciar();
    await trava;
    return {dominio, coletadoEm: '2026-11-14T12:00:00Z', paginas: [], falhas: []};
  }});
  const primeiro = a.post({site:'negocio.com'});
  await inicio;
  const segundo = a.post({site:'negocio.com'});
  await new Promise(resolve => setTimeout(resolve, 10));
  soltar();
  assert.deepEqual((await Promise.all([primeiro, segundo])).map(r => r.status), [200,200]);
  assert.equal(chamadas, 1);
});

test('falha inesperada não expõe detalhes e pode ser tentada de novo', async () => {
  let n = 0;
  const a = ambiente({coletar: async dominio => {
    if (!n++) throw new Error('credencial interna nunca deve aparecer');
    return {dominio, coletadoEm:'2026-11-14T12:00:00Z', paginas:[], falhas:[]};
  }});
  const falha = await a.post({site:'negocio.com'});
  assert.equal(falha.status,503);
  assert.ok(!(await falha.text()).includes('credencial'));
  assert.equal((await a.post({site:'negocio.com'})).status,200);
});
