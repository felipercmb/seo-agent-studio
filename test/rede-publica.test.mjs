import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter, getEventListeners} from 'node:events';
import {PassThrough} from 'node:stream';
import {gzipSync, deflateSync, brotliCompressSync} from 'node:zlib';
import {criarFetchPublico, fetchPublico} from '../lib/rede-publica.mjs';

const opcoes = {method: 'GET', redirect: 'manual'};
const PUBLICO = {address: '93.184.216.34', family: 4};
const URL_PUBLICA = 'https://exemplo.com/servicos';
function transporte({enderecos = [PUBLICO], corpo = Buffer.from('conteúdo público'), headers = {'content-type': 'text/plain'}, status = 200,
  encerrar = true, inspecionar, resolver, falharRequisicao} = {}) {
  const chamadas = [], resolucoes = [], requisicoes = [], respostas = [];
  let agentesDestruidos = 0;
  const request = (opts, callback) => {
    chamadas.push(opts);
    const req = new EventEmitter(), res = new PassThrough({highWaterMark: 16 * 1024});
    res.statusCode = status; res.headers = headers;
    respostas.push(res); requisicoes.push(req);
    req.destroyed = false;
    req.destroy = () => { req.destroyed = true; res.destroy(); };
    const destruirAgente = opts.agent.destroy.bind(opts.agent);
    opts.agent.destroy = () => { agentesDestruidos++; destruirAgente(); };
    req.end = () => queueMicrotask(() => {
      if (req.destroyed) return;
      if (falharRequisicao) { req.emit('error', falharRequisicao); return; }
      try {
        inspecionar?.(opts);
        callback(res);
        if (encerrar && !res.destroyed) res.end(corpo);
      } catch (erro) { req.emit('error', erro); }
    });
    return req;
  };
  const fetch = criarFetchPublico({request, resolver: async (nome, opts) => {
    resolucoes.push({nome, opts});
    return resolver ? resolver(nome, opts) : enderecos;
  }});
  return {fetch, chamadas, resolucoes, requisicoes, respostas, agentesDestruidos: () => agentesDestruidos};
}
const rejeicaoSegura = erro => {
  assert.ok(erro instanceof TypeError);
  assert.equal(erro.message, 'Não foi possível acessar este destino público com segurança.');
  return true;
};

test('exports oferecem contrato Fetch e Response nativa sem dependência de agente global', async () => {
  assert.equal(typeof fetchPublico, 'function');
  const t = transporte();
  const resposta = await t.fetch(URL_PUBLICA, opcoes);
  assert.ok(resposta instanceof Response);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get('content-type'), 'text/plain');
  assert.equal(await resposta.text(), 'conteúdo público');
  assert.deepEqual(t.resolucoes, [{nome: 'exemplo.com', opts: {all: true, order: 'verbatim'}}]);
  assert.equal(t.chamadas.length, 1);
  assert.equal(t.requisicoes[0].destroyed, true);
  assert.equal(t.respostas[0].destroyed, true);
  assert.equal(t.agentesDestruidos(), 1);
});

test('DNS misto, privado, reservado ou malformado nunca abre socket', async () => {
  for (const enderecos of [
    [{address: '127.0.0.1', family: 4}], [PUBLICO, {address: '10.0.0.1', family: 4}],
    [{address: '192.168.1.1', family: 4}, PUBLICO], [{address: '169.254.169.254', family: 4}],
    [{address: '100.64.0.1', family: 4}], [{address: '192.0.2.1', family: 4}],
    [{address: '::1', family: 6}], [{address: '::ffff:127.0.0.1', family: 6}],
    [PUBLICO, {address: 'fd00::1', family: 6}], [{address: '2001:db8::1', family: 6}],
    [{address: '93.184.216.34', family: 6}], [{address: 'inválido', family: 4}], [], null,
  ]) {
    const t = transporte({enderecos});
    await assert.rejects(t.fetch(URL_PUBLICA, opcoes), rejeicaoSegura);
    assert.equal(t.chamadas.length, 0);
    assert.equal(t.resolucoes.length, 1);
  }
});

test('destinos literais privados e protocolos/portas/credenciais inválidos falham antes de DNS', async () => {
  for (const url of ['http://exemplo.com/', 'file:///etc/passwd', 'https://localhost/', 'https://nome.local/',
    'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://[::1]/',
    'https://[::ffff:127.0.0.1]/', 'https://exemplo.com:8443/', 'https://nome:senha@exemplo.com/',
    'https://exemplo.com/#senha', 'https://exemplo.com/\nsegredo', 'https://exemplo.com/%0d%0asegredo',
    'https://exemplo.com/\\arquivo', 'https://exemplo.com/' + 'x'.repeat(8192)]) {
    const t = transporte();
    await assert.rejects(t.fetch(url, opcoes), rejeicaoSegura);
    assert.equal(t.resolucoes.length, 0);
    assert.equal(t.chamadas.length, 0);
  }
});

test('GET sem body e redirecionamento manual são obrigatórios', async () => {
  for (const init of [{}, {redirect: 'follow'}, {redirect: 'error'}, {...opcoes, method: 'POST'}, {...opcoes, body: ''}]) {
    const t = transporte();
    await assert.rejects(t.fetch(URL_PUBLICA, init), rejeicaoSegura);
    assert.equal(t.resolucoes.length, 0);
    assert.equal(t.chamadas.length, 0);
  }
  const t = transporte();
  const r = await t.fetch(new Request(URL_PUBLICA, {redirect: 'manual'}));
  assert.equal(await r.text(), 'conteúdo público');
});

test('lookup do socket devolve somente IP fixado, sem resolver novamente, e mantém TLS original', async () => {
  const enderecos = [{...PUBLICO}], resultadosLookup = [];
  const t = transporte({enderecos, inspecionar(opts) {
    enderecos[0].address = '127.0.0.1'; // DNS answer changes after validation.
    assert.equal(opts.hostname, 'exemplo.com');
    assert.equal(opts.servername, 'exemplo.com');
    assert.equal(opts.headers.host, 'exemplo.com');
    assert.equal(opts.port, 443);
    assert.equal(opts.rejectUnauthorized, true);
    assert.equal(opts.autoSelectFamily, false);
    assert.equal(opts.minVersion, 'TLSv1.2');
    assert.equal(opts.checkServerIdentity('outro-host-ignorado', {subjectaltname: 'DNS:exemplo.com'}), undefined);
    assert.ok(opts.checkServerIdentity('exemplo.com', {subjectaltname: 'DNS:malicioso.com'}) instanceof Error);
    opts.lookup('exemplo.com', {}, (erro, address, family) => { assert.equal(erro, null); resultadosLookup.push({address, family}); });
    opts.lookup('exemplo.com', {all: true}, (erro, ips) => { assert.equal(erro, null); resultadosLookup.push(...ips); });
    opts.lookup('malicioso.com', {}, erro => assert.ok(erro instanceof TypeError));
  }});
  assert.equal(await (await t.fetch(URL_PUBLICA, opcoes)).text(), 'conteúdo público');
  assert.deepEqual(resultadosLookup, [PUBLICO, PUBLICO]);
  assert.equal(t.resolucoes.length, 1);
  assert.equal(t.chamadas.length, 1);
});

test('IPv6 público é fixado sem transição e literal público não exige nova resolução', async () => {
  const ipv6 = {address: '2606:4700:4700::1111', family: 6};
  const t = transporte({enderecos: [ipv6], inspecionar(opts) {
    assert.equal(opts.family, 6);
    opts.lookup('exemplo.com', {}, (erro, address, family) => {
      assert.equal(erro, null); assert.equal(address, ipv6.address); assert.equal(family, 6);
    });
  }});
  await (await t.fetch(URL_PUBLICA, opcoes)).body.cancel();
  const literal = transporte({inspecionar(opts) {
    assert.equal(opts.hostname, '8.8.8.8'); assert.equal(opts.servername, '');
    assert.equal(opts.checkServerIdentity('ignorado', {subjectaltname: 'IP Address:8.8.8.8'}), undefined);
  }});
  await (await literal.fetch('https://8.8.8.8/', opcoes)).body.cancel();
  assert.equal(literal.resolucoes.length, 0);
});

test('não envia cookies, autenticação, proxy, referência ou opções TLS/host do chamador', async () => {
  const t = transporte({headers: {'content-type': 'text/plain', 'set-cookie': ['sessao=segredo'], 'cf-mitigated': 'challenge'}, inspecionar(opts) {
    assert.deepEqual(opts.agent.options.proxyEnv, {});
    assert.equal(opts.headers.authorization, undefined);
    assert.equal(opts.headers.cookie, undefined);
    assert.equal(opts.headers['proxy-authorization'], undefined);
    assert.equal(opts.headers.referer, undefined);
    assert.equal(opts.headers.host, 'exemplo.com');
    assert.equal(opts.headers.accept, 'application/dns-json');
    assert.equal(opts.headers['accept-language'], 'pt-BR');
    assert.equal(opts.headers['accept-encoding'], 'identity');
    assert.match(opts.headers['user-agent'], /^ConsultaVisibilidade\/1\.0/);
    assert.equal(opts.rejectUnauthorized, true);
    assert.equal(opts.socketPath, undefined);
    assert.equal(opts.auth, undefined);
  }});
  const r = await t.fetch(URL_PUBLICA, {...opcoes, rejectUnauthorized: false, socketPath: '/tmp/privado', auth: 'senha',
    headers: {Authorization: 'Bearer segredo', Cookie: 'sessao=segredo', 'Proxy-Authorization': 'senha', Referer: 'https://privado/',
      Host: '127.0.0.1', 'User-Agent': 'agente falsificado', Accept: 'application/dns-json', 'Accept-Language': 'pt-BR', 'Accept-Encoding': 'gzip'}});
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(r.headers.get('cf-mitigated'), 'challenge');
  await r.body.cancel();
});

test('redirecionamento para endereço privado é devolvido e nunca seguido', async () => {
  const t = transporte({status: 302, headers: {location: 'https://127.0.0.1/segredo'}});
  const r = await t.fetch(URL_PUBLICA, opcoes);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://127.0.0.1/segredo');
  await r.body.cancel();
  assert.equal(t.chamadas.length, 1);
  assert.equal(t.resolucoes.length, 1);
});

test('Google DNS, Cloudflare DNS e SerpApi usam o mesmo transporte público fixado', async () => {
  for (const url of ['https://dns.google/resolve?name=exemplo.com&type=A',
    'https://cloudflare-dns.com/dns-query?name=exemplo.com&type=AAAA',
    'https://serpapi.com/account.json?api_key=fixture_inventada']) {
    const t = transporte();
    await (await t.fetch(url, opcoes)).body.cancel();
    assert.equal(t.chamadas[0].hostname, new URL(url).hostname);
    assert.equal(t.chamadas[0].path, new URL(url).pathname + new URL(url).search);
  }
});

test('abort antes e durante DNS não abre socket nem depois de resolução tardia', async () => {
  const antes = new AbortController(); antes.abort('segredo interno');
  const a = transporte();
  await assert.rejects(a.fetch(URL_PUBLICA, {...opcoes, signal: antes.signal}), {name: 'AbortError'});
  assert.equal(a.resolucoes.length, 0);
  let resolverDepois;
  const t = transporte({resolver: () => new Promise(resolve => { resolverDepois = resolve; })});
  const controle = new AbortController();
  const p = t.fetch(URL_PUBLICA, {...opcoes, signal: controle.signal});
  const rejeitada = assert.rejects(p, {name: 'AbortError', message: 'A requisição foi cancelada.'});
  controle.abort('não refletir segredo'); await rejeitada;
  resolverDepois([PUBLICO]); await Promise.resolve(); await Promise.resolve();
  assert.equal(t.chamadas.length, 0);
  assert.equal(getEventListeners(controle.signal, 'abort').length, 0);
});

test('abort depois dos headers interrompe leitura, destrói socket e remove listeners', async () => {
  const controle = new AbortController(), t = transporte({encerrar: false});
  const r = await t.fetch(URL_PUBLICA, {...opcoes, signal: controle.signal});
  const leitor = r.body.getReader();
  const leitura = leitor.read();
  const rejeitada = assert.rejects(leitura, {name: 'AbortError'});
  controle.abort(); await rejeitada;
  assert.equal(t.requisicoes[0].destroyed, true);
  assert.equal(t.respostas[0].destroyed, true);
  assert.equal(t.agentesDestruidos(), 1);
  assert.equal(getEventListeners(controle.signal, 'abort').length, 0);
});

test('cancelar body sem ler fecha recursos e não aguarda um corpo pendente', async () => {
  const controle = new AbortController(), t = transporte({encerrar: false});
  const r = await t.fetch(URL_PUBLICA, {...opcoes, signal: controle.signal});
  await r.body.cancel();
  assert.equal(t.requisicoes[0].destroyed, true);
  assert.equal(t.respostas[0].destroyed, true);
  assert.equal(t.agentesDestruidos(), 1);
  assert.equal(getEventListeners(controle.signal, 'abort').length, 0);
});

test('gzip, deflate e br são descomprimidos em streaming e removem comprimento comprimido', async () => {
  for (const [encoding, compactar] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]]) {
    const corpo = compactar(Buffer.from('Olá, conteúdo público.'));
    const t = transporte({corpo, headers: {'content-type': 'text/html; charset=utf-8', 'content-encoding': encoding, 'content-length': String(corpo.length)}});
    const r = await t.fetch(URL_PUBLICA, opcoes);
    assert.equal(r.headers.get('content-encoding'), null);
    assert.equal(r.headers.get('content-length'), null);
    assert.equal(await r.text(), 'Olá, conteúdo público.');
    assert.equal(t.requisicoes[0].destroyed, true);
  }
});

test('corpos excessivos, bombas de compressão e codificações inválidas encerram recursos', async () => {
  const grande = Buffer.alloc(2 * 1024 * 1024 + 1, 65);
  for (const config of [{corpo: grande}, {corpo: gzipSync(grande), headers: {'content-encoding': 'gzip'}},
    {corpo: Buffer.from('não é gzip'), headers: {'content-encoding': 'gzip'}}]) {
    const t = transporte(config), r = await t.fetch(URL_PUBLICA, opcoes);
    await assert.rejects(r.arrayBuffer(), rejeicaoSegura);
    assert.equal(t.requisicoes[0].destroyed, true);
    assert.equal(t.respostas[0].destroyed, true);
  }
  for (const headers of [{'content-length': String(grande.length)}, {'content-encoding': 'gzip, br'}, {'content-encoding': 'zstd'}]) {
    const t = transporte({headers});
    await assert.rejects(t.fetch(URL_PUBLICA, opcoes), rejeicaoSegura);
    assert.equal(t.requisicoes[0].destroyed, true);
  }
});

test('respostas sem corpo fecham conexão e erros internos não refletem URL ou credencial', async () => {
  for (const status of [204, 205, 304]) {
    const t = transporte({status, encerrar: false});
    const r = await t.fetch(URL_PUBLICA, opcoes);
    assert.equal(r.status, status); assert.equal(r.body, null);
    assert.equal(t.requisicoes[0].destroyed, true);
  }
  const t = transporte({falharRequisicao: new Error('https://segredo/?api_key=senha_interna')});
  await assert.rejects(t.fetch(URL_PUBLICA, opcoes), rejeicaoSegura);
  assert.equal(t.requisicoes[0].destroyed, true);
  const d = transporte({resolver: async () => { throw new Error('DNS interno secreto'); }});
  await assert.rejects(d.fetch(URL_PUBLICA, opcoes), rejeicaoSegura);
  assert.equal(d.chamadas.length, 0);
});
