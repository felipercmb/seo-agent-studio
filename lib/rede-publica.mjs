import {lookup as resolverDNS} from 'node:dns/promises';
import {Agent, request as requestHTTPS} from 'node:https';
import {isIP} from 'node:net';
import {checkServerIdentity} from 'node:tls';
import {Transform} from 'node:stream';
import {createGunzip, createInflate, createBrotliDecompress} from 'node:zlib';
import {enderecoPublico} from '../src/coleta.mjs';

const MAX_URL = 8192;
const MAX_CORPO = 2 * 1024 * 1024;
const BUFFER = 16 * 1024;
const AGENTE = 'ConsultaVisibilidade/1.0 (Visibilidade Aberta; leitura publica de paginas)';
const falha = () => new TypeError('Não foi possível acessar este destino público com segurança.');
const cancelado = () => new DOMException('A requisição foi cancelada.', 'AbortError');

function parametros(entrada, init) {
  const original = entrada instanceof Request ? entrada : null;
  const valor = original ? original.url : entrada instanceof URL ? entrada.href : entrada;
  if (typeof valor !== 'string' || valor.length > MAX_URL || /[\u0000-\u0020\u007f\\]/.test(valor)) throw falha();
  let url;
  try { url = new URL(valor); } catch { throw falha(); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !url.hostname) throw falha();
  try { if (/[\u0000-\u001f\u007f\\]/.test(decodeURIComponent(url.pathname))) throw falha(); }
  catch { throw falha(); }
  if (String(init.method ?? original?.method ?? 'GET').toUpperCase() !== 'GET' ||
      (init.redirect ?? original?.redirect) !== 'manual' || init.body != null || original?.body) throw falha();
  const signal = init.signal ?? original?.signal ?? null;
  if (signal != null && !(signal instanceof AbortSignal)) throw falha();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(hostname);
  if (literal ? !enderecoPublico(hostname) : hostname.length > 253 ||
      !hostname.split('.').every(p => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(p)) ||
      !hostname.includes('.') || /\.(?:localhost|local|internal|lan|onion)$/i.test(hostname)) throw falha();
  let fornecidos;
  try { fornecidos = new Headers(init.headers ?? original?.headers); } catch { throw falha(); }
  // Never forward Cookie, Authorization, Host, Referer, proxy credentials or
  // caller-controlled transport/TLS options. No browser cookie jar is used.
  const headers = {'user-agent': AGENTE, 'accept-encoding': 'identity', host: url.host, accept: '*/*'};
  for (const nome of ['accept', 'accept-language']) {
    const valor = fornecidos.get(nome);
    if (valor != null) {
      if (valor.length > 256 || /[\u0000-\u001f\u007f]/.test(valor)) throw falha();
      headers[nome] = valor;
    }
  }
  return {url, hostname, literal, signal, headers};
}

function esperarDNS(promessa, signal) {
  // dns.lookup itself is not abortable. Stop awaiting it immediately and
  // discard its eventual result, so cancellation cannot open a late socket.
  return new Promise((resolve, reject) => {
    let encerrado = false;
    const concluir = (fn, valor) => {
      if (encerrado) return;
      encerrado = true;
      signal?.removeEventListener('abort', abortar);
      fn(valor);
    };
    const abortar = () => concluir(reject, cancelado());
    signal?.addEventListener('abort', abortar, {once: true});
    Promise.resolve(promessa).then(v => concluir(resolve, v), () => concluir(reject, falha()));
    if (signal?.aborted) abortar();
  });
}

function limitador() {
  let tamanho = 0;
  return new Transform({highWaterMark: BUFFER, transform(chunk, _, callback) {
    tamanho += chunk.byteLength;
    callback(tamanho > MAX_CORPO ? falha() : null, chunk);
  }});
}

function cabecalhosResposta(resposta, descomprimida) {
  const headers = new Headers();
  for (const [nome, valores] of Object.entries(resposta.headers)) {
    if (/^(?:set-cookie2?|connection|keep-alive|transfer-encoding|proxy-authenticate|proxy-authorization|trailer|upgrade)$/i.test(nome) ||
        descomprimida && /^(?:content-length|content-encoding)$/i.test(nome)) continue;
    if (valores != null) for (const valor of Array.isArray(valores) ? valores : [valores]) headers.append(nome, String(valor));
  }
  return headers;
}

/** One HTTPS GET, manual redirects, public DNS pinned to the TLS connection.
 * resolver: dns.promises.lookup-compatible; request: https.request-compatible.
 * Both injection points are for tests/trusted server code, never request data.
 * Bodies are streamed and limited to 2 MiB on the wire and after decoding;
 * the collector/provider must retain their smaller per-resource limits.
 */
export function criarFetchPublico({resolver = resolverDNS, request = requestHTTPS} = {}) {
  if (typeof resolver !== 'function' || typeof request !== 'function') throw falha();
  return async function fetchPublico(entrada, init = {}) {
    const {url, hostname, literal, signal, headers} = parametros(entrada, init);
    if (signal?.aborted) throw cancelado();
    let enderecos;
    if (literal) enderecos = [{address: hostname, family: literal}];
    else {
      try { enderecos = await esperarDNS(resolver(hostname, {all: true, order: 'verbatim'}), signal); }
      catch (erro) { if (erro?.name === 'AbortError') throw erro; throw falha(); }
    }
    if (signal?.aborted) throw cancelado();
    if (!Array.isArray(enderecos) || !enderecos.length || enderecos.length > 64 ||
        enderecos.some(e => !e || ![4, 6].includes(e.family) || isIP(e.address) !== e.family || !enderecoPublico(e.address))) throw falha();
    const escolhido = enderecos.find(e => e.family === 4) ?? enderecos[0];
    const fixado = Object.freeze({address: escolhido.address, family: escolhido.family});

    // Explicit private agent avoids https.globalAgent, environment proxies,
    // connection reuse and a second DNS decision when the socket is opened.
    // Node docs: https://nodejs.org/api/http.html#httprequestoptions-callback
    const agent = new Agent({keepAlive: false, maxSockets: 1, maxFreeSockets: 0, proxyEnv: {}});
    return new Promise((resolve, reject) => {
      let req, resposta, controller, resolvido = false, encerrado = false;
      const streams = [];
      const limpar = () => {
        signal?.removeEventListener('abort', abortar);
        for (const stream of streams) stream.destroy();
        resposta?.destroy();
        req?.destroy();
        agent.destroy();
      };
      const interromper = (erro, cancelar = false) => {
        if (encerrado) return;
        encerrado = true;
        limpar();
        if (!resolvido) reject(erro);
        else if (!cancelar) { try { controller?.error(erro); } catch { /* Already consumed/cancelled. */ } }
      };
      const abortar = () => interromper(cancelado());
      const erroRede = () => interromper(falha());
      signal?.addEventListener('abort', abortar, {once: true});
      if (signal?.aborted) { abortar(); return; }
      const lookupFixado = (nome, opcoes, callback) => {
        if (typeof opcoes === 'function') { callback = opcoes; opcoes = {}; }
        if (signal?.aborted || encerrado) { callback(cancelado()); return; }
        if (nome !== hostname || !enderecoPublico(fixado.address)) { callback(falha()); return; }
        if (opcoes?.all) callback(null, [{...fixado}]);
        else callback(null, fixado.address, fixado.family);
      };
      try {
        req = request({protocol: 'https:', hostname, port: 443, path: url.pathname + url.search,
          method: 'GET', headers, agent, lookup: lookupFixado, family: fixado.family, autoSelectFamily: false,
          servername: literal ? '' : hostname, rejectUnauthorized: true, minVersion: 'TLSv1.2',
          checkServerIdentity: (_, cert) => checkServerIdentity(hostname, cert),
          maxHeaderSize: 16 * 1024, insecureHTTPParser: false,
        }, recebido => {
          resposta = recebido;
          resposta.on('error', erroRede);
          resposta.on('aborted', erroRede);
          if (encerrado || signal?.aborted) { resposta.destroy(); abortar(); return; }
          try {
            const status = resposta.statusCode;
            if (!Number.isInteger(status) || status < 200 || status > 599 ||
                Number(resposta.headers['content-length']) > MAX_CORPO) throw falha();
            const encoding = String(resposta.headers['content-encoding'] || 'identity').trim().toLowerCase();
            const fabricas = {gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress};
            if (encoding !== 'identity' && !Object.hasOwn(fabricas, encoding)) throw falha();
            const responseHeaders = cabecalhosResposta(resposta, encoding !== 'identity');
            if ([204, 205, 304].includes(status)) {
              const resultado = new Response(null, {status, headers: responseHeaders});
              resolvido = true; encerrado = true; limpar(); resolve(resultado); return;
            }
            const entradaLimitada = limitador(), saidaLimitada = limitador();
            streams.push(entradaLimitada, saidaLimitada);
            let decodificador;
            if (encoding !== 'identity') {
              decodificador = fabricas[encoding]({chunkSize: BUFFER, highWaterMark: BUFFER});
              streams.push(decodificador);
            }
            for (const stream of streams) stream.on('error', erroRede);
            const iterador = saidaLimitada[Symbol.asyncIterator]();
            const corpo = new ReadableStream({
              start(c) { controller = c; },
              async pull(c) {
                try {
                  const {done, value} = await iterador.next();
                  if (encerrado) return;
                  if (done) { encerrado = true; limpar(); c.close(); }
                  else c.enqueue(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
                } catch { erroRede(); }
              },
              cancel() { interromper(cancelado(), true); },
            }, {highWaterMark: 0});
            const resultado = new Response(corpo, {status, headers: responseHeaders});
            resposta.pipe(entradaLimitada);
            if (decodificador) entradaLimitada.pipe(decodificador).pipe(saidaLimitada);
            else entradaLimitada.pipe(saidaLimitada);
            resolvido = true;
            resolve(resultado);
          } catch { erroRede(); }
        });
        req.on('error', erroRede);
        if (encerrado) req.destroy();
        else req.end();
      } catch { erroRede(); }
    });
  };
}

export const fetchPublico = criarFetchPublico();
