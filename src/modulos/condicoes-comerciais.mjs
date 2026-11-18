import {createHash} from 'node:crypto';

const segmentador = new Intl.Segmenter('pt-BR', {granularity:'sentence'});
const cobrancaInicial = /\bsem\s+(?:taxa\s+de\s+)?(?:ades[aã]o|instala[cç][aã]o|mensalidade|assinatura|configura[cç][aã]o)\b/iu;
const inicio = /^(?:\s*sem\b)|\b(?:criar|crie|publicar|publique|comece|come[cç]ar|instalar|instale|configurar|configure)\b/iu;
const negacaoAmbigua = /\b(?:n[aã]o\s+(?:[eé]\s+poss[ií]vel|permite|garante|ser[aá]|fica)|evite|saiba se)\b/iu;
const tarifa = /\b(?:taxas?|tarifas?|comiss[aã]o)\b/iu;
const cobrancaDeclarada = /\b(?:cobramos|cobra|cobram|cobrad[ao]s?|incide|haver[aá]|ser[aá]\s+aplicad[ao])(?![\p{L}\p{N}_])|R\$|\d\s*%/iu;
const isencao = /\b(?:sem|isen[cç][aã]o|n[aã]o\s+(?:h[aá]|existe|cobramos|[eé]\s+cobrad[ao]))\b[^.!?]{0,45}\b(?:taxas?|tarifas?|comiss[aã]o)\b/iu;
const operacao = '(?:inscri[cç](?:[aã]o|[oõ]es)|ingressos?|reservas?|pedidos?|vendas?|matr[ií]culas?|transa[cç](?:[aã]o|[oõ]es))';
const escopoOperacao = new RegExp(
  '\\b(?:(?:nas?|nos?|em|para)\\s+' + operacao + '\\s+pag[oa]s?' +
  '|(?:caso|quando|se)\\s+[^.!?,;]{0,34}\\b(?:evento|'+operacao+')\\b[^.!?,;]{0,34}\\bpag[oa]s?\\b' +
  '|(?:por|a cada|sobre\\s+(?:a|o|as|os))\\s+' + operacao + ')\\b','iu');

function frase(segment, index, trecho) {
  const texto = segment.trim();
  const inicio = index + segment.indexOf(texto);
  const fim = inicio + texto.length;
  return {texto:trecho.slice(inicio,fim),inicio,fim};
}

function etapaInicial(texto) {
  return !texto.endsWith('?') && cobrancaInicial.test(texto) && inicio.test(texto) && !negacaoAmbigua.test(texto);
}

function etapaTransacao(texto) {
  if (texto.endsWith('?') || !tarifa.test(texto) || !cobrancaDeclarada.test(texto) ||
      isencao.test(texto) || negacaoAmbigua.test(texto) ||
      /\bn[aã]o\s+(?:(?:for(?:em)?|seja(?:m)?|estiver(?:em)?|será|é)\s+)?pag[oa]s?\b/iu.test(texto)) return null;
  return escopoOperacao.exec(texto);
}

/** The caller supplies a complete, scoped body source. Quotes refer to its UTF-16 offsets. */
export function compararCobrancasNoTrecho(trecho) {
  if (typeof trecho !== 'string' || trecho.length > 1600 || !trecho.trim()) return null;
  const frases = Array.from(segmentador.segment(trecho), ({segment,index}) => frase(segment,index,trecho));
  const resultados = [];
  for (let i = 0; i+1 < frases.length; i++) {
    const [a,b] = frases.slice(i,i+2);
    const entrada = etapaInicial(a.texto) ? a : etapaInicial(b.texto) ? b : null;
    if (!entrada) continue;
    const transacao = entrada === a ? b : a;
    const escopo = etapaTransacao(transacao.texto);
    if (!escopo) continue;
    const inicioEscopo = transacao.inicio + escopo.index;
    resultados.push({
      entrada, transacao,
      escopoTransacao:{texto:escopo[0], inicio:inicioEscopo, fim:inicioEscopo+escopo[0].length},
    });
  }
  if (resultados.length !== 1) return null;
  return {versao:1, ...resultados[0], sha256Trecho:createHash('sha256').update(trecho).digest('hex'),
    estado:'para_conferencia', unidadeOffsets:'utf16_no_trecho'};
}
