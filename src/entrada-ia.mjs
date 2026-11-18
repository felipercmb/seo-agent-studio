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
    observado_em: dataISO(e.coletadoEm), sha256_pagina:e.sha256, descricao};
}

function evidenciaDiagnostico(m, dominio, agora) {
  const pagina = urlPublica(m?.paginaAlvo, dominio), descricao = texto(m?.evidencia);
  // The source agent has already restricted this excerpt to the exact observed URL.
  // Do not convert a title, category or recommended step into an observed defect.
  if (!pagina || !descricao || !recente(m.coletadoEm, agora, 24 * HORA)) return null;
  const evidencia = {id: 'd1', tipo: 'pagina', pagina, atual: true, observado_em: dataISO(m.coletadoEm), descricao};
  if (hashValido(m.sha256Pagina)) evidencia.sha256_pagina = m.sha256Pagina;
  if (m.verificacaoId === 'diretiva-noindex-html' && hashValido(m.sha256Pagina)) {
    evidencia.verificacao = {tipo:'meta_robots_noindex', escopo:'html_inicial', intencao:'desconhecida'};
  }
  if (m.verificacaoId === 'diretiva-noindex-http' && hashValido(m.sha256Pagina) && hashValido(m.sha256Cabecalho) &&
      typeof m.valorCabecalho==='string' && m.valorCabecalho.length<=512 && !/[\p{Cc}\p{Cf}]/u.test(m.valorCabecalho)) {
    evidencia.sha256_cabecalho=m.sha256Cabecalho;
    evidencia.valor_cabecalho=m.valorCabecalho;
    evidencia.verificacao={tipo:'http_robots_noindex',escopo:'cabecalho_http',intencao:'desconhecida'};
  }
  return evidencia;
}

function evidenciaSerp(o, dominio, agora, estadoFonte) {
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
    estado_fonte: fontesValidas && posicao === null ? 'nao_observado_recorte' :
      ['nao_configurada','cota_esgotada','consultavel_ou_parcial','sem_relatorio'].includes(estadoFonte) ? estadoFonte : 'desconhecida',
    descricao: posicao !== null ? 'Posição observada no Google Brasil, português, computador. Não identifica a causa do ranking.'
      : estadoFonte === 'nao_configurada' ? 'A fonte de posições não está configurada; a posição e os concorrentes atuais são desconhecidos.'
      : estadoFonte === 'cota_esgotada' ? 'A cota da fonte de posições está esgotada; a posição e os concorrentes atuais são desconhecidos.'
      : fontesValidas ? 'Site não observado no recorte consultado. A posição atual é desconhecida.'
      : 'Posição atual não confirmada: falta uma captura válida e recente.'};
  if (fontesValidas && posicao === null) {
    // A ausência no recorte é uma observação distinta de fonte indisponível.
    // Ela nunca produz uma posição, mas pode ser auditada enquanto recente.
    resultado.recorte_serp = paginas.map(e => ({id:e.fonteId,sha256:e.sha256,observado_em:dataISO(e.coletadoEm)}));
  }
  if (posicao !== null) {
    const ids = new Set(paginas.map(e => e.fonteId));
    resultado.fontes_serp = paginas.map(e => ({id:e.fonteId,sha256:e.sha256,
      observado_em:dataISO(e.coletadoEm),descricao:texto(e.trecho,120)}));
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
  // A seleção de três contextos não pode deixar uma diretiva de indexação
  // observada para trás apenas porque há muitos termos em outras páginas.
  for (const m of melhorias) {
    const e = evidenciaDiagnostico(m, site, instante);
    if (!['meta_robots_noindex','http_robots_noindex'].includes(e?.verificacao?.tipo) || paginasVistas.has(e.pagina)) continue;
    const entrada = base(site);
    entrada.objetivo = e.verificacao.tipo==='http_robots_noindex'
      ? 'Há uma diretiva no cabeçalho HTTP; qual a próxima verificação antes de alterar essa página?'
      : 'Há uma diretiva no HTML inicial; qual a próxima verificação antes de alterar essa página?';
    entrada.evidencias.push(e); entradas.push(entrada); paginasVistas.add(e.pagina);
    if (entradas.length === 3) return {versao: 1, site, entradas};
  }
  for (const o of (valido && Array.isArray(relatorio.oportunidades) ? relatorio.oportunidades : []).slice(0, 100)) {
    if (!objeto(o) || !texto(o.termo)) continue;
    const pagina = urlPublica(o.paginaAlvo, site), grupo = pagina || 'termo:' + texto(o.termo);
    if (paginasVistas.has(grupo)) continue;
    paginasVistas.add(grupo);
    const entrada = base(site);
    entrada.evidencias.push(evidenciaSerp(o, site, instante, relatorio.fontePosicoes?.estado));
    const origem = (Array.isArray(o.evidencias) ? o.evidencias : [])
      .map(e => evidenciaPagina(e, site, instante)).find(e => e && (!pagina || e.pagina === pagina));
    if (origem) entrada.evidencias.push(origem);
    const diagnosticos = melhorias.map(m => evidenciaDiagnostico(m, site, instante)).filter(e => e && e.pagina === pagina);
    const diagnostico = diagnosticos.find(e => e.verificacao?.tipo === 'meta_robots_noindex') || diagnosticos[0];
    if (diagnostico) {
      entrada.evidencias.push(diagnostico);
      if (diagnostico.verificacao?.tipo === 'meta_robots_noindex') entrada.objetivo = 'Há uma diretiva no HTML inicial; qual a próxima verificação antes de alterar essa página?';
    }
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
    if (e.verificacao?.tipo === 'meta_robots_noindex') entrada.objetivo = 'Há uma diretiva no HTML inicial; qual a próxima verificação antes de alterar essa página?';
    entradas.push(entrada);
  }
  if (!entradas.length) entradas.push(base(site));
  return {versao: 1, site, entradas};
}
