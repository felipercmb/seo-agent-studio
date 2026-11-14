import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizarSite} from '../src/consulta.mjs';
import {criarWorker} from '../src/worker.mjs';

test('normaliza domínio público sem confundir credenciais, IPs ou subdomínios', () => {
  for (const [entrada, esperado] of [
    ['WWW.Cliente.com.br', 'cliente.com.br'],
    [' https://Loja.Cliente.com.br.:443/ofertas?origem=busca ', 'loja.cliente.com.br'],
    ['https://www.pão.com.br/a', 'xn--po-sia.com.br'],
    ['loja.com.br/?retorno=https://outra.com.br', 'loja.com.br'],
  ]) assert.equal(normalizarSite(entrada), esperado);
  for (const invalido of [null, '', 'localhost', 'https://127.0.0.1', '0x7f000001', '[::1]', '10.0.0.1',
    'com.br', 'co.uk', 'servidor.internal', 'ftp://site.com', 'file:///secret', 'a_b.com',
    'https://usuario:senha@site.com', 'https://@site.com', 'site.com:8000', 'https:\\site.com',
    'http:///site.com', 'https:////site.com', 'http://cliente.com\nsufixo', '*.site.com']) {
    assert.throws(() => normalizarSite(invalido), /domínio público/);
  }
});

test('rotas não expõem configuração, banco, código ou relatórios por URL', async () => {
  const html = '<!doctype html><title>Visibilidade Aberta</title>';
  const app = criarWorker(html);
  const requisitar = (rota, method = 'GET') => app.fetch(new Request('http://127.0.0.1:8794' + rota, {method}));
  const inicio = await requisitar('/');
  assert.equal(inicio.status, 200);
  assert.equal(await inicio.text(), html);
  assert.equal(inicio.headers.get('Referrer-Policy'), 'no-referrer');
  assert.match(inicio.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  for (const rota of ['/.env', '/data/visibilidade.sqlite', '/server.mjs', '/lib/config.mjs',
    '/api/consulta?site=cliente.com.br', '/src/portal.html']) {
    assert.equal((await requisitar(rota)).status, 404, rota);
  }
  assert.equal((await requisitar('/api/posicoes')).status, 405);
  assert.equal(await (await requisitar('/', 'HEAD')).text(), '');
});
