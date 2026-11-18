import {ErroConsulta} from "./consulta.mjs";
import {criarDiagnostico, ErroDiagnostico} from "./diagnostico.mjs";
import {criarCapturas} from './capturas.mjs';
import {criarPosicoesAtuais} from './posicoes-atuais.mjs';
import {criarAgente} from './agente-servico.mjs';
import {prepararEntradasIA} from './entrada-ia.mjs';
import {criarCoordenador} from './modulos/coordenador.mjs';
import {ErroProjeto} from './modulos/repositorio.mjs';

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

async function lerCorpo(request, maximo = 4096) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) {
    throw new ErroConsulta('Envie o endereço em uma consulta JSON.');
  }
  if (Number(request.headers.get('Content-Length')) > maximo || !request.body) throw new ErroConsulta('Consulta inválida.');
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
      if (tamanho > maximo) throw new ErroConsulta('Consulta inválida.');
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
  const agente = criarAgente({agora: opcoes.agora});
  const coordenador = criarCoordenador({...opcoes, coletar: criarCapturas({...opcoes, objetivo: 'descoberta'})});
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url), metodo = request.method;
      if (url.pathname === '/projeto' && env.MODULOS_LOCAIS === true && opcoes.htmlProjeto) {
        if (!['GET', 'HEAD'].includes(metodo)) return resposta('Método indisponível.', 'text/plain', 405, metodo, {Allow:'GET, HEAD'});
        return resposta(opcoes.htmlProjeto, 'text/html', 200, metodo);
      }
      if (['/api/diagnostico', '/api/posicoes', '/api/agente', '/api/ia', '/api/ia-candidata', '/api/projeto'].includes(url.pathname)) {
        if (url.pathname === '/api/projeto' && env.MODULOS_LOCAIS !== true) return resposta(JSON.stringify({erro:'Os perfis de negócio estão disponíveis apenas na instalação local.'}), 'application/json', 404, metodo);
        if (metodo !== 'POST') return resposta('Use o formulário para analisar o site.', 'text/plain', 405, metodo, {Allow: 'POST'});
        const origem = request.headers.get('Origin');
        if ((origem && origem !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
          return resposta(JSON.stringify({erro: 'Abra o portal para analisar o site.'}), 'application/json', 403, metodo);
        }
        try {
          if (url.search) throw new ErroConsulta('Envie o endereço pelo formulário.');
          const entrada = await lerCorpo(request, url.pathname === '/api/projeto' ? 65536 : 4096);
          let relatorio;
          if (url.pathname === '/api/projeto') relatorio = await coordenador.executar(entrada, env);
          else if (url.pathname === '/api/ia' || url.pathname === '/api/ia-candidata') {
            const executar = url.pathname === '/api/ia-candidata' ? opcoes.executarIACandidata : opcoes.executarIA;
            if (typeof executar !== 'function') return resposta(JSON.stringify({erro:'A IA local não está instalada nesta execução.'}), 'application/json', 503, metodo);
            const base = await agente.executar(entrada, env);
            if (base.estado === 'sem_dados') return resposta(JSON.stringify({erro:'Leia o site antes de executar a IA local.'}), 'application/json', 409, metodo);
            const resultado = await executar(prepararEntradasIA(base, {agora:opcoes.agora}));
            if (!resultado || resultado.versao !== 1 || resultado.estado !== 'experimental' ||
                !Array.isArray(resultado.resultados) || resultado.resultados.length < 1 || resultado.resultados.length > 3) throw new Error('Resposta da IA inválida.');
            relatorio = {...resultado, dominio:base.dominio, geradoEm:new Date().toISOString()};
          } else if (url.pathname === '/api/agente') relatorio = await agente.executar(entrada, env);
          else {
            const ranking = url.pathname === '/api/posicoes';
            relatorio = ranking ? await posicoes(entrada, env) : await diagnosticar(entrada, request);
            await agente.registrar(ranking ? 'posicoes' : 'diagnostico', relatorio, env);
          }
          return resposta(JSON.stringify(relatorio), 'application/json', 200, metodo);
        } catch (erro) {
          const invalido = erro instanceof ErroConsulta;
          const limitado = erro instanceof ErroDiagnostico;
          const mensagem = invalido || limitado ? erro.message : 'Não foi possível analisar as páginas agora. Tente novamente em instantes.';
          return resposta(JSON.stringify({erro: mensagem}), 'application/json', erro instanceof ErroProjeto ? erro.status : invalido ? 400 : limitado ? erro.status : 503, metodo,
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
