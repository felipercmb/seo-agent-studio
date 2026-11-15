import {normalizarSite} from './consulta.mjs';

const HORA = 3600_000;
const hashValido = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const objeto = v => !!v && typeof v === 'object' && !Array.isArray(v);
const texto = (v, limite = 160) => typeof v === 'string'
  ? v.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, limite) : '';
const recente = (data, agora, prazo) => typeof data === 'string' &&
  Number.isFinite(Date.parse(data)) && Date.parse(data) <= agora && agora - Date.parse(data) < prazo;
const dataISO = data => typeof data === 'string' && Number.isFinite(Date.parse(data))
  ? new Date(data).toISOString() : null;

function urlPublica(valor, dominio) {
  try {
    const u = new URL(valor), host = normalizarSite(u.href);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port ||
      (dominio && host !== dominio && !host.endsWith('.' + dominio)) ||
      [...u.searchParams.keys()].some(k => /^(?:api[_-]?key|key|token|access_token|auth|authorization|secret|password|senha)$/i.test(k))) return null;
    u.hash = '';
    return u.href.length <= 250 ? u.href : null;
  } catch { return null; }
}

function base(site) {
  return {site, evidencias: [],
    objetivo: 'Escolher uma próxima melhoria com as evidências disponíveis. O retorno comercial não foi medido.',
    dados_negocio: {volume_busca: null, taxa_conversao: null, margem: null}};
}

function evidenciaPagina(e, dominio, agora) {
  const pagina = urlPublica(e?.url, dominio), descricao = texto(e?.trecho);
  if (e?.tipo !== 'site' || !pagina || !descricao || !hashValido(e.sha256)) return null;
  return {id: 'p1', tipo: 'pagina', pagina, atual: recente(e.coletadoEm, agora, 24 * HORA),
    observado_em: dataISO(e.coletadoEm), descricao};
}

function evidenciaDiagnostico(m, dominio, agora) {
  const pagina = urlPublica(m?.paginaAlvo, dominio), descricao = texto(m?.evidencia);
  // The source agent has already restricted this excerpt to the exact observed URL.
  // Do not convert a title, category or recommended step into an observed defect.
  if (!pagina || !descricao || !recente(m.coletadoEm, agora, 24 * HORA)) return null;
  return {id: 'd1', tipo: 'pagina', pagina, atual: true, observado_em: dataISO(m.coletadoEm), descricao};
}

function evidenciaSerp(o, dominio, agora) {
  const paginas = (Array.isArray(o.evidencias) ? o.evidencias : []).filter(e => e?.tipo === 'google');
  const fontesValidas = paginas.length > 0 && paginas.length <= 5 && paginas.every(e =>
    e.fonte === 'SerpApi' && /^[a-zA-Z0-9_-]{8,128}$/.test(e.fonteId ?? '') &&
    hashValido(e.sha256) && recente(e.coletadoEm, agora, HORA));
  const posicao = fontesValidas && Number.isInteger(o.posicao) && o.posicao >= 1 && o.posicao <= 100
    ? o.posicao : null;
  const datas = paginas.map(e => dataISO(e.coletadoEm));
  const resultado = {id: 's1', tipo: 'serp', termo: texto(o.termo),
    pagina: urlPublica(o.paginaAlvo, dominio), posicao, atual: posicao !== null,
    observado_em: datas.length && datas.every(Boolean) ? datas.sort()[0] : null,
    descricao: posicao !== null ? 'Posição observada no Google Brasil, português, computador. Não identifica a causa do ranking.'
      : fontesValidas ? 'Site não observado no recorte consultado. A posição atual é desconhecida.'
      : 'Posição atual não confirmada: falta uma captura válida e recente.'};
  if (posicao !== null) {
    const ids = new Set(paginas.map(e => e.fonteId));
    resultado.concorrentes = (Array.isArray(o.concorrentes) ? o.concorrentes : [])
      .filter(c => Number.isInteger(c?.posicao) && c.posicao > 0 && c.posicao < posicao &&
        ids.has(c.fonteId) && recente(c.coletadoEm, agora, HORA) && urlPublica(c.url))
      .slice(0, 2).map(c => ({pagina: urlPublica(c.url), posicao: c.posicao}));
    if (resultado.concorrentes.length) resultado.descricao += ' O conteúdo dos concorrentes não foi analisado.';
  }
  return resultado;
}

/**
 * Projects the server-validated report into bounded model inputs. This adapter
 * does not authenticate arbitrary JSON or fetch evidence. Numeric facts remain
 * outside generated prose; inferred intentions and rule recommendations are omitted.
 */
export function prepararEntradasIA(relatorio, {agora = Date.now} = {}) {
  const instante = new Date(typeof agora === 'function' ? agora() : agora).getTime();
  if (!Number.isFinite(instante)) throw new TypeError('O relógio da exportação é inválido.');
  let site = '';
  try { site = normalizarSite(relatorio?.dominio); } catch { /* Missing reports have no measured facts. */ }
  const entradas = [], paginasVistas = new Set();
  const valido = site && objeto(relatorio) && relatorio.versao === 1 && relatorio.metodo === 'regras-abertas-v1';
  const melhorias = valido && Array.isArray(relatorio.melhorias) ? relatorio.melhorias.slice(0, 6) : [];
  for (const o of (valido && Array.isArray(relatorio.oportunidades) ? relatorio.oportunidades : []).slice(0, 100)) {
    if (!objeto(o) || !texto(o.termo)) continue;
    const pagina = urlPublica(o.paginaAlvo, site), grupo = pagina || 'termo:' + texto(o.termo);
    if (paginasVistas.has(grupo)) continue;
    paginasVistas.add(grupo);
    const entrada = base(site);
    entrada.evidencias.push(evidenciaSerp(o, site, instante));
    const origem = (Array.isArray(o.evidencias) ? o.evidencias : [])
      .map(e => evidenciaPagina(e, site, instante)).find(e => e && (!pagina || e.pagina === pagina));
    if (origem) entrada.evidencias.push(origem);
    const diagnostico = melhorias.map(m => evidenciaDiagnostico(m, site, instante))
      .find(e => e && e.pagina === pagina);
    if (diagnostico) entrada.evidencias.push(diagnostico);
    entradas.push(entrada);
    if (entradas.length === 3) break;
  }
  for (const m of melhorias) {
    if (entradas.length === 3) break;
    const e = evidenciaDiagnostico(m, site, instante);
    if (!e || paginasVistas.has(e.pagina)) continue;
    paginasVistas.add(e.pagina);
    const entrada = base(site);
    entrada.evidencias.push(e);
    entradas.push(entrada);
  }
  if (!entradas.length) entradas.push(base(site));
  return {versao: 1, site, entradas};
}
