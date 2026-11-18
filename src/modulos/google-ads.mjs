import {createHash} from 'node:crypto';
import {normalizarSite} from '../consulta.mjs';
import {contextoDemanda, normalizarDemanda} from './demanda.mjs';

const MESES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
  'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const MAX_BYTES = 1024 * 1024;
const PRAZO_MS = 15_000;
const chave = valor => valor.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
const objeto = valor => !!valor && typeof valor === 'object' && !Array.isArray(valor);
const segredoValido = valor => typeof valor === 'string' && valor.length >= 8 && valor.length <= 4096 && /^[\x21-\x7e]+$/.test(valor);
const cliente = valor => typeof valor === 'string' && /^(?:\d{10}|\d{3}-\d{3}-\d{4})$/.test(valor)
  ? valor.replaceAll('-', '') : null;
const termoValido = valor => typeof valor === 'string' && valor.trim().length >= 3 && valor.length <= 80 &&
  valor.trim().split(/\s+/).length <= 10 && !/[\p{Cc}\p{Cf}<>@]|https?:|www\.|\d[\d\s().+/-]{6,}\d/iu.test(valor);

function numeroInteiro(valor) {
  if (typeof valor === 'string' && !/^(?:0|[1-9]\d*)$/.test(valor)) return null;
  if (!['string', 'number'].includes(typeof valor)) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : null;
}

function janela(instante) {
  const data = new Date(instante), ano = data.getUTCFullYear(), mes = data.getUTCMonth();
  const meses = Array.from({length: 12}, (_, i) => new Date(Date.UTC(ano, mes - 12 + i, 1)));
  const periodo = d => d.toISOString().slice(0, 7);
  const recurso = d => ({year: d.getUTCFullYear(), month: MESES[d.getUTCMonth()]});
  return {periodoInicio: periodo(meses[0]), periodoFim: periodo(meses.at(-1)),
    recurso: {start: recurso(meses[0]), end: recurso(meses.at(-1))},
    chaves: new Set(meses.map(d => `${d.getUTCFullYear()}:${MESES[d.getUTCMonth()]}`))};
}

function mesesCompletos(metricas, periodo) {
  if (!Array.isArray(metricas?.monthlySearchVolumes) || metricas.monthlySearchVolumes.length !== 12) return false;
  const vistos = new Set();
  for (const mes of metricas.monthlySearchVolumes) {
    const ano = numeroInteiro(mes?.year), id = `${ano}:${mes?.month}`;
    if (!periodo.chaves.has(id) || vistos.has(id) || numeroInteiro(mes?.monthlySearches) === null) return false;
    vistos.add(id);
  }
  return vistos.size === 12;
}

function converter(resposta, solicitados, periodo, instante) {
  const base = {fonte: 'Google Ads API · métricas históricas', coletadoEm: new Date(instante).toISOString(),
    pais: 'Brasil', idioma: 'Português', rede: 'Google Search', dispositivos: 'Todos os dispositivos',
    periodoInicio: periodo.periodoInicio, periodoFim: periodo.periodoFim};
  if (!objeto(resposta) || !Array.isArray(resposta.results) || resposta.results.length > 100) return null;
  const registros = [], contagens = new Map();
  let descartados = 0;
  for (const resultado of resposta.results) {
    if (!termoValido(resultado?.text) || resultado.closeVariants != null && !Array.isArray(resultado.closeVariants)) {
      descartados++; continue;
    }
    const textos = [resultado.text, ...(resultado.closeVariants || [])];
    if (textos.length > 100 || textos.some(t => !termoValido(t))) { descartados++; continue; }
    const ids = textos.map(chave);
    // These are variants of requested keywords, not automatic keyword ideas.
    // A mismatched term cannot borrow the volume of another query.
    if (ids.some(id => !solicitados.has(id)) || new Set(ids).size !== ids.length) { descartados++; continue; }
    for (const id of ids) contagens.set(id, (contagens.get(id) || 0) + 1);
    const volume = numeroInteiro(resultado.keywordMetrics?.avgMonthlySearches);
    registros.push({ids, textos: ids.map(id => solicitados.get(id)), volume,
      valido: volume !== null && mesesCompletos(resultado.keywordMetrics, periodo)});
  }
  const itens = [], grupos = [];
  for (const registro of registros) {
    if (!registro.valido || registro.ids.some(id => contagens.get(id) !== 1)) { descartados++; continue; }
    if (registro.ids.length === 1) itens.push({termo: registro.textos[0], buscasMensais: registro.volume});
    else grupos.push({id: createHash('sha256').update(registro.ids.slice().sort().join('\n')).digest('hex').slice(0, 20),
      termoCanonico: registro.textos[0], termos: registro.textos, buscasMensais: registro.volume,
      natureza: 'estimativa_historica_compartilhada',
      aviso: 'A média pertence ao conjunto de variantes. Não há volume individual para cada termo e ela não deve ser somada entre variantes.'});
  }
  const normalizado = normalizarDemanda({...base, itens, grupos}, {agora: () => instante});
  return {...normalizado, estado: normalizado.estado === 'disponivel' && descartados ? 'parcial' : normalizado.estado,
    cobertura: {termosSolicitados: solicitados.size, termosIndividuais: itens.length,
      gruposCompartilhados: grupos.length, registrosDescartados: descartados, mesesSolicitados: 12},
    limites: [...normalizado.limites,
      'O conector solicita somente Google Search, Brasil e português, nos doze meses completos anteriores à consulta.',
      'As estimativas agregam todos os dispositivos. Não são volume exclusivo do computador nem previsão de cliques para a posição medida.',
      'São aceitas apenas médias cuja resposta contém os doze meses solicitados com valores explícitos; lacunas não viram zero.',
      ...(grupos.length ? ['Variantes próximas retornam em grupos separados, sem atribuir o volume conjunto a cada palavra.'] : []),
      ...(descartados ? ['Parte da resposta foi descartada por período incompleto, valor ausente ou associação ambígua de palavras.'] : [])]};
}

/**
 * Opt-in local. Um único POST de planejamento, sem campanhas, cobrança de
 * mídia, renovação de OAuth, retries ou fallback externo.
 * Docs: https://developers.google.com/google-ads/api/docs/keyword-planning/generate-historical-metrics
 * REST: https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v26/services/keyword_plan_idea_service.proto
 * Português=1014: https://developers.google.com/google-ads/api/data/codes-formats#languages
 * Brasil=2076: https://developers.google.com/google-ads/api/data/geotargets
 */
export function criarFonteGoogleAds({env = process.env, fetch: buscar = globalThis.fetch, agora = Date.now} = {}) {
  if (env?.GOOGLE_ADS_DEMANDA !== '1') return null;
  const customerId = cliente(env.GOOGLE_ADS_CUSTOMER_ID);
  const token = env.GOOGLE_ADS_ACCESS_TOKEN, developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginId = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? cliente(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) : null;
  const versao = env.GOOGLE_ADS_API_VERSION || 'v26';
  if (!customerId || !segredoValido(token) || !segredoValido(developerToken) ||
      env.GOOGLE_ADS_LOGIN_CUSTOMER_ID && !loginId || !/^v[1-9]\d{1,2}$/.test(versao) ||
      typeof buscar !== 'function' || typeof agora !== 'function') return null;
  // Configuration never controls the host, method, operation or query string.
  const endereco = `https://googleads.googleapis.com/${versao}/customers/${customerId}:generateKeywordHistoricalMetrics`;
  const headers = {'Content-Type': 'application/json', Accept: 'application/json',
    Authorization: 'Bearer ' + token, 'developer-token': developerToken,
    ...(loginId ? {'login-customer-id': loginId} : {})};

  return async function consultar(entrada = {}, {signal} = {}) {
    const instante = agora();
    const indisponivel = () => ({...normalizarDemanda(null, {agora: () => Number.isFinite(instante) ? instante : Date.now()}),
      grupos: [], limites: ['Não foi possível obter estimativas válidas do Google Ads nesta consulta. Verifique configuração, autorização, token, cota e disponibilidade. Nenhum volume foi atribuído.']});
    if (!Number.isFinite(instante) || signal?.aborted) return indisponivel();
    try { normalizarSite(entrada.dominio); } catch { return indisponivel(); }
    if (contextoDemanda(entrada.pais ?? 'Brasil', 'pais') !== 'Brasil' ||
        contextoDemanda(entrada.idioma ?? 'Português', 'idioma') !== 'Português' ||
        !Array.isArray(entrada.termos) || entrada.termos.length > 100) return indisponivel();
    const solicitados = new Map();
    for (const termo of entrada.termos) if (termoValido(termo)) {
      const id = chave(termo);
      if (!solicitados.has(id)) solicitados.set(id, termo.trim().replace(/\s+/g, ' '));
    }
    if (!solicitados.size) return indisponivel();
    const periodo = janela(instante), controller = new AbortController();
    let leitor, temporizador, rejeitarPrazo;
    const prazo = new Promise((_, rejeitar) => { rejeitarPrazo = rejeitar; });
    const cancelar = () => {
      controller.abort();
      if (leitor) void leitor.cancel().catch(() => {});
      rejeitarPrazo(new Error('Consulta interrompida.'));
    };
    signal?.addEventListener('abort', cancelar, {once: true});
    temporizador = setTimeout(cancelar, PRAZO_MS);
    try {
      const tarefa = (async () => {
        const resposta = await buscar(endereco, {method: 'POST', headers, redirect: 'error', signal: controller.signal,
          body: JSON.stringify({keywords: [...solicitados.values()], geoTargetConstants: ['geoTargetConstants/2076'],
            language: 'languageConstants/1014', keywordPlanNetwork: 'GOOGLE_SEARCH', includeAdultKeywords: false,
            historicalMetricsOptions: {includeAverageCpc: false, yearMonthRange: periodo.recurso}})});
        if (!resposta?.ok || resposta.redirected || !/^application\/json(?:;|$)/i.test(resposta.headers?.get('content-type') || '') ||
            Number(resposta.headers?.get('content-length')) > MAX_BYTES || !resposta.body?.getReader) {
          await resposta?.body?.cancel().catch(() => {});
          return null;
        }
        leitor = resposta.body.getReader();
        const partes = []; let tamanho = 0;
        while (true) {
          const {done, value} = await leitor.read();
          if (done) break;
          tamanho += value.byteLength;
          if (tamanho > MAX_BYTES) throw new Error('Resposta excedeu o limite.');
          partes.push(value);
        }
        const bytes = new Uint8Array(tamanho);
        let deslocamento = 0;
        for (const parte of partes) { bytes.set(parte, deslocamento); deslocamento += parte.byteLength; }
        const bruto = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
        return converter(bruto, solicitados, periodo, instante);
      })();
      return await Promise.race([tarefa, prazo]) || indisponivel();
    } catch { return indisponivel(); }
    finally {
      clearTimeout(temporizador);
      signal?.removeEventListener('abort', cancelar);
      controller.abort();
      if (leitor) void leitor.cancel().catch(() => {});
    }
  };
}
