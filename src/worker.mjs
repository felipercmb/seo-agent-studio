import {ErroConsulta} from "./consulta.mjs";
import {criarDiagnostico, ErroDiagnostico} from "./diagnostico.mjs";
import {criarCapturas} from './capturas.mjs';
import {criarPosicoesAtuais} from './posicoes-atuais.mjs';

const politica = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
  "connect-src 'self'", "img-src 'self' data:", "font-src 'self' data:",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");

function resposta(corpo, tipo, status, metodo, extras = {}) {
  return new Response(metodo === "HEAD" ? null : corpo, {status, headers: {
    "Content-Type": tipo + "; charset=utf-8", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    "Content-Security-Policy": politica, ...extras,
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  }});
}

async function lerCorpo(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) {
    throw new ErroConsulta('Envie o endereço em uma consulta JSON.');
  }
  if (Number(request.headers.get('Content-Length')) > 4096 || !request.body) throw new ErroConsulta('Consulta inválida.');
  const leitor = request.body.getReader();
  const partes = [];
  let tamanho = 0, temporizador;
  const tempo = new Promise((_, rejeitar) => {
    temporizador = setTimeout(() => {
      leitor.cancel().catch(() => {});
      rejeitar(new ErroConsulta('A consulta demorou para ser enviada. Tente novamente.'));
    }, 5000);
  });
  try {
    while (true) {
      const {done, value} = await Promise.race([leitor.read(), tempo]);
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > 4096) throw new ErroConsulta('Consulta inválida.');
      partes.push(value);
    }
    const bytes = new Uint8Array(tamanho);
    let posicao = 0;
    for (const parte of partes) { bytes.set(parte, posicao); posicao += parte.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new ErroConsulta('Não foi possível ler o endereço enviado.'); }
  } finally {
    clearTimeout(temporizador);
    await leitor.cancel().catch(() => {});
  }
}

export function criarWorker(html, opcoes = {}) {
  const coletar = criarCapturas(opcoes);
  const diagnosticar = criarDiagnostico({...opcoes, coletar});
  const posicoes = criarPosicoesAtuais({...opcoes, coletar: criarCapturas({...opcoes, objetivo: 'descoberta'})});
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url), metodo = request.method;
      if (['/api/diagnostico', '/api/posicoes'].includes(url.pathname)) {
        if (metodo !== 'POST') return resposta('Use o formulário para analisar o site.', 'text/plain', 405, metodo, {Allow: 'POST'});
        const origem = request.headers.get('Origin');
        if ((origem && origem !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
          return resposta(JSON.stringify({erro: 'Abra o portal para analisar o site.'}), 'application/json', 403, metodo);
        }
        try {
          if (url.search) throw new ErroConsulta('Envie o endereço pelo formulário.');
          const entrada = await lerCorpo(request);
          const relatorio = url.pathname === '/api/posicoes' ? await posicoes(entrada, env) : await diagnosticar(entrada, request);
          return resposta(JSON.stringify(relatorio), 'application/json', 200, metodo);
        } catch (erro) {
          const invalido = erro instanceof ErroConsulta;
          const limitado = erro instanceof ErroDiagnostico;
          const mensagem = invalido || limitado ? erro.message : 'Não foi possível analisar as páginas agora. Tente novamente em instantes.';
          return resposta(JSON.stringify({erro: mensagem}), 'application/json', invalido ? 400 : limitado ? erro.status : 503, metodo,
            limitado ? {'Retry-After': String(erro.espera)} : {});
        }
      }
      if (url.pathname !== "/") {
        return resposta("Página não encontrada.", "text/plain", 404, metodo);
      }
      if (metodo !== "GET" && metodo !== "HEAD") {
        return resposta("Método indisponível.", "text/plain", 405, metodo, {Allow: "GET, HEAD"});
      }
      if (url.pathname === "/") return resposta(html, "text/html", 200, metodo, url.search ? {'X-Robots-Tag': 'noindex'} : {});
    },
  };
}
