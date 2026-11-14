import {normalizarSite, ErroConsulta} from './consulta.mjs';
import {coletarSite} from './coleta.mjs';
import {analisarPaginas} from './analise.mjs';

const TTL = 15 * 60_000;
const ESPERA = 60_000;
const JANELA = 10 * 60_000;
const LIMITE_MEMORIA = 250;

export class ErroDiagnostico extends Error {
  constructor(message, status = 429, espera = 60) {
    super(message);
    this.status = status;
    this.espera = espera;
  }
}

async function chave(texto) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

// Só resultados da análise de páginas públicas entram no cache. Nunca HTML,
// cookies do visitante, credenciais ou informações de contas conectadas.
export function criarDiagnostico(opcoes = {}) {
  const coletar = opcoes.coletar ?? coletarSite;
  const analisar = opcoes.analisar ?? analisarPaginas;
  const agora = opcoes.agora ?? Date.now;
  const borda = opcoes.cache ?? globalThis.caches?.default;
  const locais = new Map(), pendentes = new Map(), cotas = new Map();

  function guardar(mapa, id, valor) {
    mapa.delete(id);
    if (mapa.size >= LIMITE_MEMORIA) mapa.delete(mapa.keys().next().value);
    mapa.set(id, valor);
  }

  async function lerCache(url) {
    if (!borda) return null;
    try { return await (await borda.match(url))?.json(); } catch { return null; }
  }

  async function gravarCache(url, valor, segundos) {
    if (!borda) return;
    try {
      await borda.put(url, new Response(JSON.stringify(valor), {
        headers: {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + segundos},
      }));
    } catch { /* O cache é uma otimização; sua falha não invalida a evidência. */ }
  }

  async function limitar(request) {
    const janela = Math.floor(agora() / JANELA);
    // CF-Connecting-IP vem da borda Cloudflare. Não armazenamos o IP em claro.
    const id = await chave((request.headers.get('CF-Connecting-IP') || 'sem-ip') + ':' + janela);
    const url = new URL('/__cache/limite-v1/' + id, request.url).href;
    const remoto = await lerCache(url);
    const local = cotas.get(id);
    const usados = Math.max(local?.usados || 0, remoto?.usados || 0);
    const global = cotas.get('global');
    if (usados >= 10 || (global?.janela === janela && global.usados >= 60)) {
      throw new ErroDiagnostico('O limite de novas análises foi atingido. Aguarde alguns minutos e tente novamente.', 429, 600);
    }
    guardar(cotas, id, {usados: usados + 1, janela});
    guardar(cotas, 'global', {janela, usados: global?.janela === janela ? global.usados + 1 : 1});
    await gravarCache(url, {usados: usados + 1}, 600);
  }

  function entregar(registro, reutilizado) {
    return {...registro.relatorio, cache: {
      reutilizado,
      atualizacaoPermitidaEm: new Date(registro.instante + ESPERA).toISOString(),
    }};
  }

  return async function diagnosticar(entrada, request) {
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) ||
        Object.keys(entrada).some(k => !['site', 'atualizar'].includes(k)) ||
        (entrada.atualizar !== undefined && typeof entrada.atualizar !== 'boolean')) {
      throw new ErroConsulta('Informe o endereço do site para analisar.');
    }
    const dominio = normalizarSite(entrada.site);
    const url = new URL('/__cache/diagnostico-v4/' + await chave(dominio), request.url).href;
    let anterior = locais.get(dominio) || await lerCache(url);
    if (anterior && (!Number.isFinite(anterior.instante) || anterior.relatorio?.dominio !== dominio)) anterior = null;
    const idade = anterior ? agora() - anterior.instante : Infinity;
    if (idade >= 0 && idade < TTL && (!entrada.atualizar || idade < ESPERA)) {
      return entregar(anterior, true);
    }
    if (pendentes.has(dominio)) return entregar(await pendentes.get(dominio), true);
    if (pendentes.size >= 2) throw new ErroDiagnostico('Há análises em andamento. Tente novamente em um minuto.');
    // Reservamos antes de esperar pela cota para evitar duas coletas do mesmo site.
    const trabalho = (async () => {
      await limitar(request);
      const coleta = await coletar(dominio);
      const relatorio = analisar(coleta);
      const registro = {instante: agora(), relatorio};
      guardar(locais, dominio, registro);
      await gravarCache(url, registro, TTL / 1000);
      return registro;
    })();
    pendentes.set(dominio, trabalho);
    try { return entregar(await trabalho, false); }
    finally { pendentes.delete(dominio); }
  };
}
