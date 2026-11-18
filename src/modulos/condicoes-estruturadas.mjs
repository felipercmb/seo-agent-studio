/** Extração conservadora de limites inteiros de contagem ou peso em kg em segmentos públicos contínuos.
 * A procedência é preservada, não auditada aqui. Texto literal não certifica
 * vínculo à oferta, vigência, elegibilidade ou uma recomendação comercial.
 */
import {normalizarSite} from '../consulta.mjs';

export class ErroCondicaoEstruturada extends Error {
  constructor(campo, motivo) {
    super(`${campo}: ${motivo}`);
    this.name = 'ErroCondicaoEstruturada';
    this.campo = campo;
    this.codigo = 'condicao_estruturada_invalida';
  }
}
const falhar = (campo, motivo) => { throw new ErroCondicaoEstruturada(campo, motivo); };
const objeto = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const MAXIMO = Number.MAX_SAFE_INTEGER;
const UNIDADES = {
  usuarios: 'usu[aá]rios?', itens: '(?:itens|item)', documentos: 'documentos?', assinaturas: 'assinaturas?',
  colaboradores: '(?:colaboradores|colaborador)', produtos: 'produtos?', projetos: 'projetos?',
  kg: '(?:kg|quilos?|quilogramas?)', arquivos: 'arquivos?', sites: 'sites?', paginas: 'p[aá]ginas?', licencas: 'licen[cç]as?', contatos: 'contatos?',
};
const UNIDADE_RE = `(${Object.values(UNIDADES).map(v => `(?:${v})`).join('|')})(?![\\p{L}\\p{N}_])`;
const BORDA = '(?<![\\p{L}\\p{N}_])';
const PADROES = [
  {nome: 'mais_de_e_ate', regex: `${BORDA}mais\\s+de\\s*(\\d+)\\s+e\\s+at[eé]\\s*(\\d+)\\s*${UNIDADE_RE}`, limites: (a, b) => [a + 1, b]},
  {nome: 'de_a', regex: `${BORDA}de\\s*(\\d+)\\s*(?:a|at[eé])\\s*(\\d+)\\s*${UNIDADE_RE}`, limites: (a, b) => [a, b]},
  {nome: 'entre_e', regex: `${BORDA}entre\\s*(\\d+)\\s*e\\s*(\\d+)\\s*${UNIDADE_RE}`, limites: (a, b) => [a, b]},
  {nome: 'ate', regex: `${BORDA}(?:at[eé]|no\\s+m[aá]ximo)\\s*(\\d+)\\s*${UNIDADE_RE}`, limites: a => [null, a]},
  {nome: 'minimo', regex: `${BORDA}(?:no\\s+m[ií]nimo|m[ií]nimo\\s+de)\\s*(\\d+)\\s*${UNIDADE_RE}`, limites: a => [a, null]},
  {nome: 'mais_de', regex: `${BORDA}mais\\s+de\\s*(\\d+)\\s*${UNIDADE_RE}`, limites: a => [a + 1, null]},
];
const BASE_LIMITE = 'Ausência de mínimo ou máximo significa limite não publicado, nunca capacidade ilimitada. Compatibilidade dos limites não comprova elegibilidade, atualidade, interpretação ou benefício.';

function chaves(v, permitidas, obrigatorias, campo) {
  if (!objeto(v) || Object.keys(v).some(k => !permitidas.includes(k)) || obrigatorias.some(k => !Object.hasOwn(v, k))) {
    falhar(campo, 'objeto com campos ausentes ou não suportados.');
  }
}
function texto(v, campo, maximo, multiline = false) {
  const controle = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}]/u : /[\p{Cc}\p{Cf}]/u;
  if (typeof v !== 'string' || !v.trim() || v.length > maximo || controle.test(v)) falhar(campo, 'texto ausente, extenso ou com controles não suportados.');
  return v;
}
function inteiro(v, campo, nulo = false) {
  if (nulo && v === null) return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) falhar(campo, 'informe inteiro não negativo seguro, ou null quando permitido.');
  return Object.is(v, -0) ? 0 : v;
}
function urlPublica(v, campo, dominio = null) {
  texto(v, campo, 2048);
  let url, host;
  try { url = new URL(v); host = normalizarSite(v); } catch { falhar(campo, 'URL pública inválida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.hash) falhar(campo, 'URL pública HTTP(S), sem credencial, porta ou fragmento, necessária.');
  if (dominio !== null && host !== dominio) falhar(campo, 'fonte pertence a outro domínio.');
  return url.href;
}
function instante(v, campo) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)) falhar(campo, 'use instante UTC completo.');
  const t = Date.parse(v);
  if (!Number.isFinite(t) || new Date(t).toISOString() !== (v.includes('.') ? v : v.replace('Z', '.000Z'))) falhar(campo, 'instante inexistente.');
  return new Date(t).toISOString();
}
function sha(v, campo) {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) falhar(campo, 'SHA-256 hexadecimal minúsculo necessário.');
  return v;
}
function escopo(v) {
  if (v === null || v === undefined) return {id: null, descricao: null, confirmado: false};
  chaves(v, ['id', 'descricao', 'confirmado'], ['id', 'descricao', 'confirmado'], 'escopo');
  if (typeof v.confirmado !== 'boolean') falhar('escopo.confirmado', 'confirmação deve ser booleana e explícita.');
  return {id: texto(v.id, 'escopo.id', 160), descricao: texto(v.descricao, 'escopo.descricao', 240), confirmado: v.confirmado};
}
function unidadeDaFrase(v) {
  return Object.entries(UNIDADES).find(([, regex]) => new RegExp(`^(?:${regex})$`, 'iu').test(v))?.[0] || null;
}
function clausula(textoFonte, inicio, fim) {
  let a = inicio, b = fim;
  while (a > 0 && !/[.!?;\n]/u.test(textoFonte[a - 1])) a--;
  while (b < textoFonte.length && !/[.!?;\n]/u.test(textoFonte[b])) b++;
  return {inicio: a, fim: b, texto: textoFonte.slice(a, b)};
}
function impedimento(contexto, candidato, bruto) {
  const antes = contexto.texto.slice(0, candidato.inicio - contexto.inicio), depois = contexto.texto.slice(candidato.fim - contexto.inicio);
  if (/\b(?:n[aã]o|nunca|exceto|salvo|somente|apenas|se|sem|ou)\b|desde\s+que|a\s+menos\s+que/iu.test(contexto.texto)) return 'condicao_ou_negacao_composta_nao_suportada';
  if (/\b(?:por|ao|no|a\s+cada)\s+(?:m[eê]s|meses|ano|dia|hora|semana|minuto|segundo)|\b(?:mensal|mensais|mensalmente|diariamente|di[aá]ri[oa]s?|anuais|anual|anualmente|semanal|semanais|semanalmente)\b/iu.test(antes) ||
      /^\s*(?:,?\s*)(?:\/|por\b|a\s+cada\b)/iu.test(depois) ||
      /^[^;.!?\n]{0,40}\b(?:(?:por|ao|no)\s+(?:m[eê]s|meses|dias?|anos?|horas?|semanas?)|(?:em|durante)\s*\d+\s*(?:dias?|meses?|horas?)|mensais|mensal|mensalmente|diariamente|di[aá]ri[oa]s?|anual|anuais|anualmente|semanal|semanais|semanalmente)\b/iu.test(depois)) return 'taxa_ou_periodicidade_nao_comparavel_a_capacidade';
  if (/^\s*(?:ativ[oa]s?|simult[aâ]ne[oa]s?|adicionais?|gratuit[oa]s?|pag[oa]s?)\b/iu.test(depois)) return 'qualificador_da_unidade_nao_suportado';
  // Não extrair o sufixo de uma faixa/exceção não reconhecida como uma regra isolada.
  const prefixo = bruto.slice(Math.max(0, candidato.inicio - 100), candidato.inicio);
  if (/(?:\b(?:de|entre|mais\s+de|menos\s+de)\s*[-\d.,]+\s*(?:(?:a|e|ou)\s*)?)$/iu.test(prefixo)) return 'faixa_composta_nao_suportada';
  return null;
}

/**
 * Fontes já coletadas, nunca busca na rede. Cada fonte é um segmento contínuo.
 * `escopo.confirmado` só pode vir da revisão do objeto/fonte pelo responsável.
 */
export function extrairCondicoesEstruturadas(entrada) {
  chaves(entrada, ['ofertaId', 'dominio', 'fontes', 'escopo'], ['ofertaId', 'fontes'], 'entrada');
  const ofertaId = texto(entrada.ofertaId, 'ofertaId', 160), e = escopo(entrada.escopo);
  let dominio = null;
  if (entrada.dominio != null) {
    try { dominio = normalizarSite(entrada.dominio); } catch { falhar('dominio', 'domínio público inválido.'); }
  }
  if (!Array.isArray(entrada.fontes) || entrada.fontes.length > 64) falhar('fontes', 'use até 64 segmentos.');
  const condicoes = [], naoInterpretadas = [], vistos = new Set();
  for (const f of entrada.fontes) {
    chaves(f, ['id', 'texto', 'url', 'sha256', 'coletadoEm'], ['id', 'texto', 'url', 'sha256', 'coletadoEm'], 'fonte');
    const id = texto(f.id, 'fonte.id', 160), bruto = texto(f.texto, 'fonte.texto', 6000, true);
    if (vistos.has(id)) falhar('fonte.id', 'ID repetido.');
    vistos.add(id);
    const origem = {fonteId: id, url: urlPublica(f.url, 'fonte.url', dominio),
      sha256: sha(f.sha256, 'fonte.sha256'), coletadoEm: instante(f.coletadoEm, 'fonte.coletadoEm')};
    const consumidos = [], rejeitados = [];
    for (const p of PADROES) {
      for (const m of bruto.matchAll(new RegExp(p.regex, 'giu'))) {
        const inicio = m.index, fim = inicio + m[0].length;
        if (consumidos.some(c => inicio < c.fim && fim > c.inicio)) continue;
        const unidade = unidadeDaFrase(m.at(-1));
        const numeros = m.slice(1, -1).map(Number), [minimo, maximo] = p.limites(...numeros);
        const candidato = {inicio, fim};
        consumidos.push(candidato);
        const contexto = clausula(bruto, inicio, fim);
        const motivo = (unidade==='kg'&&p.nome.startsWith('mais_de')?'limite_aberto_de_peso_nao_discretizar':null) || impedimento(contexto, candidato, bruto) ||
          (numeros.some(n => !Number.isSafeInteger(n) || n < 0) || [minimo, maximo].some(n => n !== null && (!Number.isSafeInteger(n) || n < 0))
            ? 'inteiro_fora_do_limite' : minimo !== null && maximo !== null && minimo > maximo ? 'intervalo_vazio' : null);
        if (motivo) {
          rejeitados.push({...origem, fraseLiteral: m[0], inicio, fim, motivo});
          continue;
        }
        condicoes.push({versao: 1, ...origem, ofertaId, unidade, minimo, maximo,
          minimoPublicado: minimo !== null, maximoPublicado: maximo !== null,
          fraseLiteral: m[0], inicio, fim, padrao: p.nome,
          escopoId: e.id, escopoDescricao: e.descricao, escopoConfirmado: e.confirmado,
          interpretacao: 'limite_numerico_candidato', vigenciaConfirmada: false});
      }
    }
    naoInterpretadas.push(...rejeitados);
    // Explicita números/durações que ficaram fora dos padrões. Não tenta completá-los.
    for (const m of bruto.matchAll(/[^;\n!?]+/gu)) {
      if (!/\d|ilimitad[oa]/iu.test(m[0])) continue;
      const inicio = m.index, fim = inicio + m[0].length;
      const caracteres = m[0].split('');
      for (const r of consumidos) if (r.inicio < fim && r.fim > inicio) caracteres.fill(' ', Math.max(0, r.inicio - inicio), Math.min(caracteres.length, r.fim - inicio));
      const restam = caracteres.join('');
      if (!/\d|ilimitad[oa]/iu.test(restam)) continue;
      naoInterpretadas.push({...origem, fraseLiteral: m[0].slice(0, 600), inicio, fim: inicio + Math.min(m[0].length, 600),
        motivo: /\d\s*(?:dias?|meses?|horas?|anos?|semanas?)\b/iu.test(restam) ? 'duracao_nao_e_capacidade' : 'regra_fora_dos_padroes_suportados'});
    }
  }
  condicoes.sort((a, b) => a.fonteId.localeCompare(b.fonteId) || a.inicio - b.inicio);
  return {versao: 1, condicoes, naoInterpretadas, limites: [BASE_LIMITE,
    'Somente padrões explícitos de contagem ou peso inteiro em kg são extraídos, sem conversão de unidades. Taxas, períodos, exceções, negações, decimais e unidades qualificadas não são completados por inferência.',
    'Escopo confirmado é declaração de revisão do responsável. URL, hash e data são metadados fornecidos; o módulo não conferiu o documento original nem sua validade atual.',
    'Uma frase parcial com capacidade não representa todas as condições de contratação. Outras restrições podem existir fora do segmento ou da captura.']};
}

function condicao(v, nome) {
  if (!objeto(v)) falhar(nome, 'condição inválida.');
  const obrigatorias = ['ofertaId', 'unidade', 'minimo', 'maximo', 'escopoId', 'escopoDescricao', 'escopoConfirmado', 'fonteId', 'url', 'sha256', 'coletadoEm'];
  for (const k of obrigatorias) if (!Object.hasOwn(v, k)) falhar(`${nome}.${k}`, 'campo necessário.');
  const min = inteiro(v.minimo, `${nome}.minimo`, true), max = inteiro(v.maximo, `${nome}.maximo`, true);
  if (min === null && max === null) falhar(nome, 'nenhum limite publicado.');
  if (min !== null && max !== null && min > max) falhar(nome, 'intervalo vazio.');
  if (typeof v.unidade !== 'string' || !Object.hasOwn(UNIDADES, v.unidade)) falhar(`${nome}.unidade`, 'unidade não suportada.');
  if (typeof v.escopoConfirmado !== 'boolean') falhar(`${nome}.escopoConfirmado`, 'confirmação booleana necessária.');
  for (const [chave, n] of [['minimoPublicado', min], ['maximoPublicado', max]]) {
    if (nome === 'publicado' && Object.hasOwn(v, chave) && v[chave] !== (n !== null)) falhar(`${nome}.${chave}`, 'marcador não coincide com o limite informado.');
  }
  if (v.escopoConfirmado && (!v.escopoId || !v.escopoDescricao)) falhar(`${nome}.escopoId`, 'escopo confirmado precisa de identificação e descrição.');
  return {ofertaId: texto(v.ofertaId, `${nome}.ofertaId`, 160), unidade: v.unidade, minimo: min, maximo: max,
    escopoId: v.escopoId === null ? null : texto(v.escopoId, `${nome}.escopoId`, 160),
    escopoDescricao: v.escopoDescricao === null ? null : texto(v.escopoDescricao, `${nome}.escopoDescricao`, 240),
    escopoConfirmado: v.escopoConfirmado, fonteId: texto(v.fonteId, `${nome}.fonteId`, 160),
    url: urlPublica(v.url, `${nome}.url`), sha256: sha(v.sha256, `${nome}.sha256`), coletadoEm: instante(v.coletadoEm, `${nome}.coletadoEm`)};
}

/** Compara somente restrições explícitas da mesma fonte/objeto/escopo revisado. */
export function verificarCompatibilidade(publicado, recomendado) {
  let p, r;
  try { p = condicao(publicado, 'publicado'); r = condicao(recomendado, 'recomendado'); }
  catch (erro) {
    if (!(erro instanceof ErroCondicaoEstruturada)) throw erro;
    return {compativel: false, estado: 'entrada_invalida', erros: [erro.campo + ':invalido'], contraexemplos: [], limite: BASE_LIMITE};
  }
  const erros = [], testemunhas = [];
  for (const campo of ['ofertaId', 'unidade', 'escopoId', 'escopoDescricao', 'fonteId', 'url', 'sha256', 'coletadoEm']) {
    if (p[campo] !== r[campo]) erros.push(campo + '_diferente');
  }
  if (!p.escopoConfirmado || !r.escopoConfirmado) erros.push('escopo_nao_confirmado');
  if (erros.length) return {compativel: false, estado: 'contexto_incompativel_ou_pendente', erros, contraexemplos: [], limite: BASE_LIMITE};
  const ausentes = ['minimo', 'maximo'].filter(k => p[k] === null);
  for (const campo of ausentes) if (r[campo] !== null) erros.push(campo + '_sem_base_publicada');
  if (p.minimo !== null && (r.minimo === null || r.minimo < p.minimo)) {
    erros.push(r.minimo === null ? 'limite_inferior_omitido' : 'limite_inferior_ampliado');
    const n = Math.min(p.minimo - 1, r.maximo ?? p.minimo - 1);
    if (Number.isSafeInteger(n) && n >= (r.minimo ?? 0) && n >= 0) testemunhas.push(n);
  }
  if (p.maximo !== null && (r.maximo === null || r.maximo > p.maximo)) {
    erros.push(r.maximo === null ? 'limite_superior_omitido' : 'limite_superior_ampliado');
    const n = Math.max(p.maximo + 1, r.minimo ?? p.maximo + 1);
    if (Number.isSafeInteger(n) && n <= (r.maximo ?? MAXIMO)) testemunhas.push(n);
  }
  return {compativel: erros.length === 0, estado: erros.length ? 'limites_incompativeis_ou_sem_base' : ausentes.length ? 'compativel_nos_limites_publicados' : 'compativel',
    erros, contraexemplos: [...new Set(testemunhas)], limitesNaoPublicados: ausentes,
    naturezaContraexemplo: 'valor_que_respeita_restricoes_explicitas_da_recomendacao_e_viola_limite_publicado',
    elegibilidadeConfirmada: false, vigenciaConfirmada: false, limite: BASE_LIMITE};
}
