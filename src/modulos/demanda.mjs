import {createHash} from 'node:crypto';

const DIA = 86_400_000;
const objeto = valor => !!valor && typeof valor === 'object' && !Array.isArray(valor);
const texto = (valor, limite = 160) => typeof valor === 'string'
  ? valor.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, limite) : '';
const chave = valor => texto(valor).normalize('NFC').toLocaleLowerCase('pt-BR');
// A query is an identity, not display copy. Never shorten a longer expression
// and attach its observations to another search that happens to be its prefix.
const termoValido = valor => typeof valor === 'string' && valor.length <= 160 &&
  valor.trim().length >= 3 && !/[\p{Cc}\p{Cf}<>@]|https?:\/\//iu.test(valor);

function instanteISO(valor) {
  if (typeof valor !== 'string') return NaN;
  const partes = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(valor);
  if (!partes) return NaN;
  const esperado = partes[1] + '.' + (partes[2] || '').padEnd(3, '0') + 'Z';
  const instante = Date.parse(esperado);
  return Number.isFinite(instante) && new Date(instante).toISOString() === esperado ? instante : NaN;
}

export function contextoDemanda(valor, campo) {
  const bruto = texto(valor, 80), normal = bruto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (campo === 'pais' && ['br', 'brasil', 'brazil'].includes(normal)) return 'Brasil';
  if (campo === 'idioma' && ['pt', 'pt-br', 'portugues', 'portuguese'].includes(normal)) return 'Português';
  return bruto;
}

function dataPeriodo(valor, fim = false) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(valor)) return NaN;
  const [ano, mes, dia] = valor.split('-').map(Number);
  if (ano < 2000 || mes < 1 || mes > 12) return NaN;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diaEfetivo = dia ?? (fim ? ultimo : 1);
  if (diaEfetivo < 1 || diaEfetivo > ultimo) return NaN;
  return Date.UTC(ano, mes - 1, diaEfetivo);
}

/**
 * Contrato de um adaptador executado no servidor, nunca um relatório enviado
 * pelo navegador: {fonte, coletadoEm, pais, idioma, periodoInicio, periodoFim,
 * itens:[{termo,buscasMensais}], grupos?:[{termoCanonico,termos,buscasMensais}]}.
 * Grupos preservam médias compartilhadas sem atribuí-las aos termos isolados.
 * O período descreve a média histórica inteira.
 * Nenhuma consulta, cobrança, leitura de credenciais ou interpolação de volume.
 */
export function normalizarDemanda(resposta, {agora = Date.now} = {}) {
  const instante = typeof agora === 'function' ? agora() : NaN;
  if (!Number.isFinite(instante)) throw new TypeError('O relógio da demanda é inválido.');
  const limites = [
    'Buscas mensais são estimativas históricas da fonte e do recorte informado, não procura atual, cliques ou vendas.',
    'Variações de palavras podem compartilhar estimativas. Os volumes não são somados para calcular mercado ou retorno.',
    'A ausência de estimativa não significa zero pesquisas. Este módulo não consulta um fornecedor por conta própria.',
  ];
  const limitesFonte = Array.isArray(resposta?.limites) ? resposta.limites.slice(0, 16).map(l => texto(l, 400)).filter(Boolean) : [];
  const indisponivel = motivo => ({versao: 1, estado: 'indisponivel', fonte: null, coletadoEm: null,
    pais: null, idioma: null, rede: null, dispositivos: null, periodoInicio: null, periodoFim: null, itens: [], grupos: [],
    limites: [...new Set([...limites, ...limitesFonte, motivo].filter(Boolean))]});
  if (!objeto(resposta)) return indisponivel('Não há uma fonte de estimativas de demanda configurada ou disponível.');
  if (resposta.versao === 1 && resposta.estado === 'indisponivel' &&
      ['fonte', 'coletadoEm', 'pais', 'idioma', 'periodoInicio', 'periodoFim'].every(k => resposta[k] === null) &&
      Array.isArray(resposta.itens) && resposta.itens.length === 0 && Array.isArray(resposta.grupos) && resposta.grupos.length === 0) {
    return indisponivel();
  }
  const fonte = texto(resposta.fonte, 120), pais = contextoDemanda(resposta.pais, 'pais');
  const idioma = contextoDemanda(resposta.idioma, 'idioma');
  const coletado = instanteISO(resposta.coletadoEm);
  const inicio = dataPeriodo(resposta.periodoInicio), fim = dataPeriodo(resposta.periodoFim, true);
  if (!fonte || !pais || !idioma || !Number.isFinite(coletado) || coletado > instante ||
      !Number.isFinite(inicio) || !Number.isFinite(fim) || inicio > fim || fim > coletado ||
      !Array.isArray(resposta.itens)) {
    return indisponivel('A fonte não forneceu origem, datas, período e recorte válidos; nenhum volume foi atribuído.');
  }
  if (instante - coletado >= 90 * DIA || instante - fim >= 180 * DIA) {
    return indisponivel('A estimativa está desatualizada para esta análise: captura com 90 dias ou período encerrado há 180 dias. Atualize a fonte.');
  }
  const vistos = new Map();
  let descartados = Math.max(0, resposta.itens.length - 100);
  for (const item of resposta.itens.slice(0, 100)) {
    if (!termoValido(item?.termo)) { descartados++; continue; }
    const termo = texto(item.termo, 160), id = chave(termo);
    if (vistos.has(id)) { vistos.set(id, null); descartados++; continue; }
    if (!Number.isSafeInteger(item?.buscasMensais) || item.buscasMensais < 0) {
      vistos.set(id, null); descartados++; continue;
    }
    vistos.set(id, {termo, buscasMensais: item.buscasMensais, natureza: 'estimativa_historica'});
  }
  const gruposBrutos = Array.isArray(resposta.grupos) ? resposta.grupos : [];
  descartados += Math.max(0, gruposBrutos.length - 100);
  const candidatosGrupo = [], ocorrencias = new Map();
  for (const grupo of gruposBrutos.slice(0, 100)) {
    if (!termoValido(grupo?.termoCanonico) || !Array.isArray(grupo?.termos) ||
        grupo.termos.length > 100 || grupo.termos.some(t => !termoValido(t))) { descartados++; continue; }
    const termoCanonico = texto(grupo?.termoCanonico), termos = Array.isArray(grupo?.termos)
      ? grupo.termos.map(t => texto(t)) : [];
    const ids = termos.map(chave);
    if (termos.length < 2 || termos.length > 100 || new Set(ids).size !== ids.length ||
        !ids.includes(chave(termoCanonico)) || termos.some(t => t.length < 3 || /[<>@]|https?:\/\//i.test(t))) {
      descartados++; continue;
    }
    for (const id of ids) ocorrencias.set(id, (ocorrencias.get(id) || 0) + 1);
    candidatosGrupo.push({termoCanonico, termos, ids, buscasMensais: grupo.buscasMensais});
  }
  const grupos = [];
  for (const grupo of candidatosGrupo) {
    if (grupo.ids.some(id => ocorrencias.get(id) !== 1 || vistos.has(id)) ||
        !Number.isSafeInteger(grupo.buscasMensais) || grupo.buscasMensais < 0) { descartados++; continue; }
    grupos.push({id: createHash('sha256').update(grupo.ids.slice().sort().join('\n')).digest('hex').slice(0, 20),
      termoCanonico: grupo.termoCanonico, termos: grupo.termos, buscasMensais: grupo.buscasMensais,
      natureza: 'estimativa_historica_compartilhada',
      aviso: 'A média pertence ao conjunto de variantes. Não há volume individual para cada termo e ela não deve ser somada entre variantes.'});
  }
  const itens = [...vistos.entries()].filter(([id, item]) => item && !ocorrencias.has(id)).map(([, item]) => item);
  if (itens.length < [...vistos.values()].filter(Boolean).length) descartados++;
  const cobertura = objeto(resposta.cobertura) ? Object.fromEntries(Object.entries(resposta.cobertura).filter(([k, v]) =>
    ['termosSolicitados', 'termosIndividuais', 'gruposCompartilhados', 'registrosDescartados', 'mesesSolicitados'].includes(k) &&
    Number.isSafeInteger(v) && v >= 0 && v <= 1000)) : undefined;
  const parcial = descartados > 0 || resposta.estado === 'parcial';
  return {versao: 1, estado: itens.length || grupos.length ? parcial ? 'parcial' : 'disponivel' : 'indisponivel',
    fonte, coletadoEm: new Date(coletado).toISOString(), pais, idioma,
    rede: texto(resposta.rede, 80) || null, dispositivos: texto(resposta.dispositivos, 80) || null,
    periodoInicio: resposta.periodoInicio, periodoFim: resposta.periodoFim, itens, grupos,
    ...(cobertura ? {cobertura} : {}),
    limites: [...new Set([...limites, ...limitesFonte,
      ...(grupos.length ? ['Variantes próximas permanecem em grupos; seus volumes não são atribuídos individualmente às palavras.'] : []),
      ...(descartados ? ['Estimativas repetidas, inválidas ou além do limite de cem termos foram descartadas.'] : [])])]};
}
