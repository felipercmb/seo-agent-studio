import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {carregarConfiguracao, ErroConfiguracao} from './lib/config.mjs';
import {criarWorker} from './src/worker.mjs';
import {coletarSite} from './src/coleta.mjs';
import {consultarGoogle} from './src/serpapi.mjs';

function rejeitar(resposta, status, mensagem) {
  resposta.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', Connection: 'close'});
  resposta.end(JSON.stringify({erro: mensagem}));
}

function origemLocal(request, porta) {
  if (request.rawHeaders.filter((_, i, lista) => i % 2 === 0 && lista[i].toLowerCase() === 'host').length !== 1) return null;
  const host = request.headers.host;
  if (typeof host !== 'string' || /[\s/@\\?#]/.test(host)) return null;
  let url;
  try { url = new URL('http://' + host); } catch { return null; }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || Number(url.port || 80) !== porta) return null;
  return url.origin;
}

async function lerCorpo(request) {
  if (Number(request.headers['content-length']) > 4096) throw new Error('tamanho');
  const partes = [];
  let tamanho = 0, timer;
  const limite = new Promise((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error('tempo')), 5000);
  });
  try {
    return await Promise.race([limite, (async () => {
      for await (const parte of request) {
        tamanho += parte.length;
        if (tamanho > 4096) throw new Error('tamanho');
        partes.push(parte);
      }
      return tamanho ? Buffer.concat(partes, tamanho) : undefined;
    })()]);
  } finally { clearTimeout(timer); }
}

export async function criarServidor(opcoes = {}) {
  const config = carregarConfiguracao(opcoes);
  const {abrirBanco} = await import('./lib/sqlite.mjs');
  const banco = abrirBanco({arquivo: config.arquivoBanco});
  let worker;
  try {
    if (opcoes.worker) worker = opcoes.worker;
    else {
      const fetchPublico = opcoes.fetchPublico ?? (await import('./lib/rede-publica.mjs')).fetchPublico;
      const html = await readFile(new URL('./src/portal.html', import.meta.url), 'utf8');
      worker = criarWorker(html, {
        coletar: opcoes.coletar ?? ((dominio, options) => coletarSite(dominio, {...options, fetch: fetchPublico})),
        consultarGoogle: opcoes.consultarGoogle ?? ((entrada, options) => consultarGoogle(entrada, {...options, fetch: fetchPublico})),
      });
    }
    if (typeof worker?.fetch !== 'function') throw new Error('Worker inválido');
  } catch (erro) { banco.close(); throw erro; }
  const envWorker = {DB: banco, SERPAPI_KEY: config.chave};
  const tarefas = new Set();
  const server = createServer((entrada, saida) => {
    const tarefa = (async () => {
      const origem = origemLocal(entrada, server.address()?.port);
      if (!origem) return rejeitar(saida, 403, 'Use o endereço local exibido ao iniciar o projeto.');
      if (!entrada.url?.startsWith('/') || entrada.url.startsWith('//')) return rejeitar(saida, 400, 'Endereço de consulta inválido.');
      const url = new URL(entrada.url, origem);
      if (url.origin !== origem) return rejeitar(saida, 400, 'Endereço de consulta inválido.');
      if (entrada.method === 'POST') {
        const origin = entrada.headers.origin;
        const browser = Object.keys(entrada.headers).some(h => h.startsWith('sec-fetch-'));
        if (origin && origin !== origem || !origin && browser || entrada.headers['sec-fetch-site'] === 'cross-site') {
          return rejeitar(saida, 403, 'Abra o formulário no endereço local do projeto.');
        }
      }
      if (url.pathname === '/healthz' && ['GET', 'HEAD'].includes(entrada.method)) {
        saida.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
        return saida.end(entrada.method === 'HEAD' ? undefined : JSON.stringify({status: 'ok', fonteConfigurada: config.fonteConfigurada}));
      }
      let body;
      if (!['GET', 'HEAD'].includes(entrada.method)) {
        try { body = await lerCorpo(entrada); }
        catch (erro) { return rejeitar(saida, erro.message === 'tamanho' ? 413 : 408, 'Não foi possível receber a consulta. Envie apenas o domínio no formulário.'); }
      }
      const headers = new Headers();
      for (const [nome, valor] of Object.entries(entrada.headers)) if (valor != null && nome !== 'cf-connecting-ip') {
        headers.set(nome, Array.isArray(valor) ? valor.join(', ') : valor);
      }
      const request = new Request(url, {method: entrada.method, headers, ...(body ? {body} : {})});
      const resposta = await worker.fetch(request, envWorker);
      if (!(resposta instanceof Response)) throw new Error('Resposta inválida');
      saida.writeHead(resposta.status, Object.fromEntries(resposta.headers));
      if (entrada.method === 'HEAD' || !resposta.body) { await resposta.body?.cancel(); return saida.end(); }
      await pipeline(Readable.fromWeb(resposta.body), saida);
    })().catch(() => {
      if (!saida.headersSent && !saida.destroyed) rejeitar(saida, 503, 'Não foi possível concluir a consulta local agora.');
      else saida.destroy();
    });
    tarefas.add(tarefa);
    tarefa.finally(() => tarefas.delete(tarefa));
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_erro, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  try {
    await new Promise((resolver, rejeitar) => {
      server.once('error', rejeitar);
      server.listen(config.porta, config.host, () => { server.off('error', rejeitar); resolver(); });
    });
  } catch (erro) { banco.close(); throw erro; }
  const porta = server.address().port;
  let encerramento;
  return {server, porta, endereco: 'http://127.0.0.1:' + porta,
    configuracao: {porta, dataDir: config.dataDir, fonteConfigurada: config.fonteConfigurada},
    fechar() {
      if (!encerramento) encerramento = (async () => {
        await new Promise((resolver, rejeitar) => {
          server.close(erro => erro ? rejeitar(erro) : resolver());
          server.closeIdleConnections();
        });
        await Promise.allSettled([...tarefas]);
        banco.close();
      })();
      return encerramento;
    },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const servidor = await criarServidor();
    let encerrando = false;
    const encerrar = () => {
      if (encerrando) return;
      encerrando = true;
      servidor.fechar().catch(() => { process.exitCode = 1; });
    };
    process.once('SIGINT', encerrar);
    process.once('SIGTERM', encerrar);
    console.log('Visibilidade Aberta disponível em ' + servidor.endereco);
  } catch (erro) {
    console.error(erro instanceof ErroConfiguracao ? erro.message : 'Não foi possível iniciar o servidor local. Verifique a porta, o diretório de dados e as migrações.');
    process.exitCode = 1;
  }
}
