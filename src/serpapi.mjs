import {normalizarSite} from './consulta.mjs';

const ORIGEM = 'https://serpapi.com';
const MAX_BYTES = 512 * 1024;
const TEMPO_MS = 12_000;
const MAX_IDADE_MS = 60 * 60_000;
const CONTEXTO = {pais: 'Brasil', idioma: 'Português', dispositivo: 'Computador', localidade: 'Brasil'};

export class ErroFonte extends Error {
  constructor(codigo, message) {
    super(message);
    this.name = 'ErroFonte';
    this.codigo = codigo;
  }
}

const indisponivel = () => new ErroFonte('indisponivel', 'Não foi possível confirmar uma observação atual do Google. Tente novamente mais tarde.');
const configuracao = () => new ErroFonte('configuracao', 'A fonte de posições ainda precisa de uma chave válida configurada pelo responsável pelo portal.');
const cota = () => new ErroFonte('cota', 'A franquia gratuita de consultas está indisponível no momento. Nenhuma consulta paga será iniciada.');
const plano = () => new ErroFonte('plano_incompativel', 'Esta consulta aceita somente a franquia do plano gratuito da fonte de posições.');
const numeroInteiro = (n, minimo = 0) => Number.isSafeInteger(n) && n >= minimo;
const objeto = valor => !!valor && typeof valor === 'object' && !Array.isArray(valor);
const texto = (s, limite = 220) => String(s ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, limite);
const chaveValida = chave => typeof chave === 'string' && /^[a-zA-Z0-9_-]{16,256}$/.test(chave);
const agoraMs = opcoes => new Date(typeof opcoes.agora === 'function' ? opcoes.agora() : Date.now()).getTime();

async function requisitar(caminho, parametros, chave, opcoes) {
  if (!chaveValida(chave)) throw configuracao();
  const url = new URL(caminho, ORIGEM);
  for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, String(v));
  url.searchParams.set('api_key', chave);
  const transporte = opcoes.fetch ?? globalThis.fetch.bind(globalThis);
  const controlador = new AbortController();
  let leitor, timer;
  const limite = new Promise((_, rejeitar) => {
    timer = setTimeout(() => {
      controlador.abort();
      leitor?.cancel().catch(() => {});
      rejeitar(indisponivel());
    }, TEMPO_MS);
  });
  try {
    return await Promise.race([limite, (async () => {
      const resposta = await transporte(url.href, {
        method: 'GET', redirect: 'manual', signal: controlador.signal, headers: {Accept: 'application/json'},
      });
      if (resposta.status !== 200) {
        await resposta.body?.cancel();
        if ([401, 403].includes(resposta.status)) throw configuracao();
        if ([402, 429].includes(resposta.status)) throw cota();
        throw indisponivel();
      }
      if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(resposta.headers.get('content-type') || '') ||
          Number(resposta.headers.get('content-length')) > MAX_BYTES || !resposta.body) {
        await resposta.body?.cancel();
        throw indisponivel();
      }
      leitor = resposta.body.getReader();
      const partes = [];
      let total = 0;
      for (;;) {
        const {done, value} = await leitor.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) throw indisponivel();
        partes.push(value);
      }
      const corpo = new Uint8Array(total);
      let offset = 0;
      for (const parte of partes) { corpo.set(parte, offset); offset += parte.length; }
      let dados;
      try { dados = JSON.parse(new TextDecoder().decode(corpo)); } catch { throw indisponivel(); }
      if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw indisponivel();
      if (dados.error != null) {
        // Classify a known exhaustion response without reflecting provider text,
        // request URLs, keys, account identity, or raw error bodies to visitors.
        if (typeof dados.error === 'string' && /run out of searches|searches? (?:limit|quota)|(?:quota|credit).*(?:exceed|exhaust)|hourly.*limit/i.test(dados.error)) throw cota();
        throw indisponivel();
      }
      return dados;
    })()]);
  } catch (erro) {
    if (erro instanceof ErroFonte) throw erro;
    throw indisponivel();
  } finally {
    clearTimeout(timer);
    await leitor?.cancel().catch(() => {});
  }
}

// https://serpapi.com/account-api: this request is not charged against quota.
// Strictly refuse paid plans, purchased extra credits and unknown account
// shapes rather than silently falling back to a billable source.
export async function verificarContaGratuita(chave, opcoes = {}) {
  const d = await requisitar('/account.json', {}, chave, opcoes);
  if (d.account_status !== 'Active') throw configuracao();
  if (d.plan_id !== 'free' || !['Free', 'Free Plan'].includes(d.plan_name) || d.plan_monthly_price !== 0 || d.extra_credits !== 0) throw plano();
  if (!numeroInteiro(d.searches_per_month, 1) || d.searches_per_month > 250 ||
      !numeroInteiro(d.plan_searches_left) || d.plan_searches_left > d.searches_per_month ||
      d.total_searches_left !== d.plan_searches_left || !numeroInteiro(d.this_month_usage) ||
      d.this_month_usage + d.plan_searches_left !== d.searches_per_month ||
      !numeroInteiro(d.account_rate_limit_per_hour, 1) || d.account_rate_limit_per_hour > 50 ||
      !numeroInteiro(d.this_hour_searches) ||
      typeof d.plan_renewal_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.plan_renewal_date) ||
      !Number.isFinite(instanteUTC(d.plan_renewal_date + 'T00:00:00Z'))) throw plano();
  if (!d.plan_searches_left || d.this_hour_searches >= d.account_rate_limit_per_hour) throw cota();
  const agora = agoraMs(opcoes);
  if (!Number.isFinite(agora)) throw indisponivel();
  return {
    plano: 'free', limiteMensal: d.searches_per_month, restantes: d.plan_searches_left,
    renovacaoEm: d.plan_renewal_date, limitePorHora: d.account_rate_limit_per_hour,
    usadasNestaHora: d.this_hour_searches, verificadoEm: new Date(agora).toISOString(),
  };
}

function instanteUTC(valor) {
  if (typeof valor !== 'string') return NaN;
  let iso = valor;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/.test(valor)) iso = valor.slice(0, -4).replace(' ', 'T') + 'Z';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(iso)) return NaN;
  const n = Date.parse(iso);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 19) !== iso.slice(0, 19)) return NaN;
  return n;
}

function validarContexto(dados, termo, inicio, pagina) {
  const p = dados.search_parameters;
  if (!objeto(p) || p.engine !== 'google' || p.q !== termo || p.gl !== 'br' || p.hl !== 'pt' ||
      p.device !== 'desktop' || p.google_domain !== 'google.com.br' ||
      p.location_requested !== 'Brazil' || p.location_used !== 'Brazil' ||
      ('start' in p ? p.start !== inicio && p.start !== String(inicio) : inicio !== 0) || p.tbm || p.udm || p.ibp) throw indisponivel();
  // The documented first-page response can omit start (its default is zero).
  // Later pages must confirm their requested offset. Page-local positions
  // must never be relabelled as the first page or a corrected query.
  const i = dados.search_information;
  if (i != null && (!objeto(i) || ('page_number' in i && i.page_number !== pagina) ||
      ('query_displayed' in i && texto(i.query_displayed).toLocaleLowerCase('pt-BR') !== texto(termo).toLocaleLowerCase('pt-BR')) ||
      ('organic_results_state' in i && i.organic_results_state !== 'Results for exact spelling'))) throw indisponivel();
  const googleUrl = dados.search_metadata?.google_url;
  if (googleUrl != null) {
    let url;
    try { url = new URL(googleUrl); } catch { throw indisponivel(); }
    if (url.searchParams.getAll('start').length > 1 || url.searchParams.has('start') && url.searchParams.get('start') !== String(inicio)) throw indisponivel();
  }
}

// https://serpapi.com/pagination documents next (next_link is deprecated).
// Only extract the offset; never execute a provider-returned URL or forward
// its credentials. A malformed continuation must not discard a valid page.
function continuacao(dados, termo, inicio, pagina, quantidade) {
  const vazio = {proximoInicio: null, paginacaoInterrompida: false, paginacaoComLacuna: false,
    limiteAtingido: inicio + quantidade >= 100};
  const p = dados.serpapi_pagination;
  const interromper = (lacuna = false) => ({...vazio, paginacaoInterrompida: true, paginacaoComLacuna: lacuna});
  if (p == null) return vazio;
  if (objeto(p) && 'current' in p && p.current !== pagina) return interromper();
  if (objeto(p) && p.next == null) return vazio;
  if (!objeto(p) || typeof p.next !== 'string' || p.next.length > 4096) return interromper();
  let url;
  try { url = new URL(p.next); } catch { return interromper(); }
  if (url.origin !== ORIGEM || url.pathname !== '/search.json' || url.username || url.password || url.hash) return interromper();
  const fixos = {engine: 'google', q: termo, gl: 'br', hl: 'pt', google_domain: 'google.com.br', device: 'desktop', location: 'Brazil'};
  const permitidos = new Set([...Object.keys(fixos), 'start', 'api_key', 'no_cache', 'output']);
  for (const nome of url.searchParams.keys()) {
    if (!permitidos.has(nome) || url.searchParams.getAll(nome).length !== 1) return interromper();
  }
  for (const [nome, valor] of Object.entries(fixos)) if (url.searchParams.get(nome) !== valor) return interromper();
  if (url.searchParams.has('no_cache') && url.searchParams.get('no_cache') !== 'true' ||
      url.searchParams.has('output') && url.searchParams.get('output') !== 'json') return interromper();
  const bruto = url.searchParams.get('start');
  if (!/^\d{1,3}$/.test(bruto || '')) return interromper();
  const proximo = Number(bruto);
  if (!quantidade || proximo <= inicio || proximo < inicio + quantidade) return interromper();
  if (proximo > inicio + quantidade) return interromper(true);
  if (proximo >= 100) return {...vazio, limiteAtingido: true};
  return {...vazio, proximoInicio: proximo};
}

// Related queries already included in this page are hypotheses, not evidence
// that the target domain ranks for them. Do not follow links or expand items.
function consultasRelacionadas(dados, termo, chave, metadata, coletadoEm) {
  if (!Array.isArray(dados.related_searches)) return [];
  const vistas = new Set([termo.normalize('NFC').toLocaleLowerCase('pt-BR')]), relacionadas = [];
  for (const item of dados.related_searches.slice(0, 100)) {
    if (!objeto(item) || typeof item.query !== 'string' || item.query.length > 160) continue;
    const consulta = texto(item.query, 160);
    if (consulta.length < 2 || consulta.includes(chave) || /[<>]|https?:\/\/|www\.|\S+@\S+|(?:^|\s)(?:site|inurl|intitle|cache|filetype):/i.test(consulta)) continue;
    const normal = consulta.normalize('NFC').toLocaleLowerCase('pt-BR');
    if (vistas.has(normal)) continue;
    vistas.add(normal);
    relacionadas.push({termo: consulta, termoOrigem: termo, fonteId: metadata.id, coletadoEm});
    if (relacionadas.length === 10) break;
  }
  return relacionadas;
}

function urlPublica(valor, chave) {
  if (typeof valor !== 'string' || valor.length > 4096 || /[\p{Cc}\p{Cf}]/u.test(valor)) throw indisponivel();
  let url;
  try { url = new URL(valor); } catch { throw indisponivel(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw indisponivel();
  // Credentials reflected in provider fields cannot leak via result links.
  for (const nome of [...url.searchParams.keys()]) {
    if (/^(?:api[_-]?key|key|token|access_token|auth|authorization|secret|password|senha)$/i.test(nome)) url.searchParams.delete(nome);
  }
  url.hash = '';
  let decodificado;
  try { decodificado = decodeURIComponent(url.href); } catch { throw indisponivel(); }
  if (url.href.includes(chave) || decodificado.includes(chave)) throw indisponivel();
  try { normalizarSite(url.origin); } catch { throw indisponivel(); }
  return url.href;
}

export async function consultarGoogle({termo, dominio, chave, inicio = 0, pagina = 1} = {}, opcoes = {}) {
  if (typeof termo !== 'string' || termo !== texto(termo, 160) || termo.length < 2 || termo.length > 160 ||
      /(?:^|\s)(?:site|inurl|intitle|cache|filetype):/i.test(termo)) throw new ErroFonte('configuracao', 'O termo de consulta não é válido para esta verificação.');
  if (!numeroInteiro(inicio) || inicio >= 100 || !numeroInteiro(pagina, 1) || pagina > 100 ||
      (inicio === 0) !== (pagina === 1)) throw new ErroFonte('configuracao', 'A página de consulta não é válida para esta verificação.');
  let alvo;
  try { alvo = normalizarSite(dominio); } catch { throw new ErroFonte('configuracao', 'Informe um domínio público para verificar a posição.'); }
  await verificarContaGratuita(chave, opcoes);
  // Reserve the shared allowance only after the free account preflight, but
  // before starting the search whose consumption may become ambiguous.
  if (opcoes.antesDaBusca) await opcoes.antesDaBusca();
  const dados = await requisitar('/search.json', {
    engine: 'google', q: termo, gl: 'br', hl: 'pt', google_domain: 'google.com.br', device: 'desktop',
    location: 'Brazil', start: inicio, no_cache: true, output: 'json',
  }, chave, opcoes);
  const metadata = dados.search_metadata;
  if (!metadata || metadata.status !== 'Success' || typeof metadata.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(metadata.id) || metadata.id.includes(chave)) throw indisponivel();
  validarContexto(dados, termo, inicio, pagina);
  const instante = instanteUTC(metadata.created_at), agora = agoraMs(opcoes);
  if (!Number.isFinite(agora) || !Number.isFinite(instante) || instante > agora || agora - instante > MAX_IDADE_MS) throw indisponivel();
  if (metadata.processed_at != null) {
    const processado = instanteUTC(metadata.processed_at);
    if (!Number.isFinite(processado) || processado < instante || processado > agora) throw indisponivel();
  }
  if (!Array.isArray(dados.organic_results) || dados.organic_results.length > 10) throw indisponivel();
  // https://serpapi.com/organic-results defines position within the page.
  // The public position is calculated from the confirmed offset; preserve
  // both original coordinates rather than renumbering deduplicated URLs.
  const resultados = dados.organic_results.map((r, indice) => {
    if (!r || r.position !== indice + 1 || typeof r.title !== 'string' || !r.title.trim()) throw indisponivel();
    const url = urlPublica(r.link, chave);
    const titulo = texto(r.title.replaceAll(chave, '[redigido]'));
    if (!titulo) throw indisponivel();
    return {posicao: inicio + r.position, posicaoNaPagina: r.position, pagina, inicio, dominio: normalizarSite(url), url, titulo};
  }).filter(r => r.posicao <= 100);
  const pertence = host => host === alvo || host.endsWith('.' + alvo);
  const encontrado = resultados.find(r => pertence(r.dominio));
  const vistos = new Set();
  const acima = resultados.filter(r => {
    if (!encontrado || r.posicao >= encontrado.posicao || pertence(r.dominio) || vistos.has(r.dominio)) return false;
    vistos.add(r.dominio); return true;
  });
  const coletadoEm = new Date(instante).toISOString();
  const relatorio = {
    termo, estado: !resultados.length ? 'indisponivel' : encontrado ? 'encontrado' : 'nao_encontrado',
    posicao: encontrado?.posicao ?? null, url: encontrado?.url ?? null, resultados, acima,
    coletadoEm, profundidadeObservada: resultados.length, inicio, pagina,
    ...continuacao(dados, termo, inicio, pagina, dados.organic_results.length),
    relacionadas: consultasRelacionadas(dados, termo, chave, metadata, coletadoEm),
    fonte: {nome: 'SerpApi', id: metadata.id}, contexto: {...CONTEXTO},
  };
  // Cache and verify the same page across target domains: target matching is
  // a derived view, so estado/posicao/url/acima are not part of its identity.
  const captura = {
    termo: relatorio.termo, resultados: relatorio.resultados, inicio, pagina,
    contexto: relatorio.contexto, fonte: relatorio.fonte, coletadoEm,
    profundidadeObservada: relatorio.profundidadeObservada,
    proximoInicio: relatorio.proximoInicio, paginacaoInterrompida: relatorio.paginacaoInterrompida,
    paginacaoComLacuna: relatorio.paginacaoComLacuna, limiteAtingido: relatorio.limiteAtingido,
    relacionadas: relatorio.relacionadas,
  };
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(captura)));
  return {...relatorio, hashEscopo: 'captura-google-pagina-v1',
    sha256: Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')};
}
