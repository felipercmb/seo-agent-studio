import {classificarOrigemPublicada} from './atribuicao-publica.mjs';

const frases = new Intl.Segmenter('pt-BR', {granularity:'sentence'});
const normal = valor => String(valor ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const semAcentosOuSeparadores = valor => normal(valor).replace(/[^a-z0-9]/g, '');
const objetoMediado = /^(?:ingressos?|passagens?|reservas?|vouchers?|agendamentos?|pagamentos?|servi[cç]os? de|contrata[cç][ãa]o de)\b/iu;
const sujeitoNomeado = /^(?:[oa]\s+)?(?<nome>[\p{L}\d&-]+(?:\s+[\p{L}\d&-]+){0,3})\s+(?:por meio (?:de sua|do seu|da sua|da nossa|do nosso)\s+[^,.!?;]{3,55}\s+)?(?=disponibiliza\s+para\s+aquisi[çc][ãa]o\s|comercializa\s|intermedeia\s|faz a intermedia[çc][ãa]o de\s)/iu;
const disponivel = /^(?:disponibiliza(?:mos)? para aquisi[çc][ãa]o|comercializa(?:mos)?|(?:intermedeia|intermediamos)(?: a venda de)?)\s+(?<objetos>[^.!?;]{3,110}?)\s+de\s+terceiros?(?=\s+(?:fornecedores?|independentes?|prestadores?)\b|\s*[,;.]|$)/iu;
const representacao = /(?<objeto>\b(?:ingressos?|passagens?|reservas?|vouchers?)(?:\s+de\s+[^,.!?;"“”]{2,44}?)?)\s+(?:s[ãa]o\s+)?(?:vendid[oa]s?|comercializad[oa]s?) por (?:n[oó]s|nossa (?:empresa|plataforma)) em nome d(?:[oa](?:s)?|e)\s+(?<representado>[^.;!?–—]{4,82}?)(?=[,.;!?–—]|$)/iu;
const explicito = /\b(?:organizadores?|promotores?|artistas?|operadores?|prestadores?|fornecedores?|empresas?|locadores?|pessoas? que realizam)\b/u;
const intermediacaoEntrePartes = /^(?:(?:faz|fazemos) a intermedia[çc][ãa]o de|intermedeia|intermediamos)\s+(?<objeto>[^,.!?;]{3,65}?)\s+entre\s+(?:v[áa]rias?\s+)?(?<ladoA>empresas|vendedores|fornecedores|prestadores|locadores|contratantes|lojistas)\s+e\s+(?<ladoB>consumidores|clientes|contratantes|compradores|prestadores|locat[áa]rios)\b/iu;
export const limiteDeOrcamentos = /\breceba at[eé]\s+\d+\s+or[çc]amentos\b/iu;

/** Identifies a published commercial intermediary and preserves the whole
 * sentence. It makes no claim about who delivers, sets the price, or owns stock. */
export function extrairMediacoesDaFonte(fonte, dominio) {
  const trecho = fonte?.trecho;
  if (typeof trecho !== 'string' || !trecho.trim() || trecho.length > 600 || fonte.recortado ||
      classificarOrigemPublicada(fonte).estado !== 'nao_determinada') return [];
  const marca = semAcentosOuSeparadores(dominio?.split('.')[0]);
  const saida = [];
  for (const {segment} of frases.segment(trecho)) {
    const frase = segment.trim();
    if (!frase || /\?$/.test(frase) || /^[“"'‘]/u.test(frase) && /diz|segundo/i.test(frase)) continue;
    const inicio = frase.replace(/^\d+(?:\.\d+)*\.\s+/u, '');
    const sujeito = sujeitoNomeado.exec(inicio);
    const primeiraPessoa = /^(?:n[oó]s\s+)?(?=(?:disponibilizamos|comercializamos|intermediamos|fazemos a intermedia[çc][ãa]o de)\s)/iu.exec(inicio);
    const proprio = primeiraPessoa ? inicio.slice(primeiraPessoa[0].length) :
      sujeito && marca && semAcentosOuSeparadores(sujeito.groups.nome) === marca ? inicio.slice(sujeito[0].length) : '';
    const polos = intermediacaoEntrePartes.exec(proprio);
    if(polos&&objetoMediado.test(polos.groups.objeto)) {
      saida.push({frase,objetos:[polos.groups.objeto],forma:'intermediacao_entre_partes',
        atores:[polos.groups.ladoA,polos.groups.ladoB]});
      continue;
    }
    const colocacao = disponivel.exec(proprio);
    if (colocacao) {
      const objetos = colocacao.groups.objetos.split(/\s*,\s*|\s+e\s+/iu).map(o=>o.replace(/^(?:o|a|os|as)\s+/iu,'').trim()).filter(o=>objetoMediado.test(o));
      if (objetos.length) saida.push({frase,objetos,forma:'disponibilizacao_de_objetos_de_terceiros'});
      continue;
    }
    const venda = representacao.exec(frase);
    if (!venda || !explicito.test(normal(venda.groups.representado))) continue;
    const anterior = normal(frase.slice(0,venda.index)).trim();
    if (/\b(?:nao|nunca|hipotetico|exemplo|segundo|diz|afirma|informou|citou|previa|anteriormente)\b/u.test(anterior)) continue;
    saida.push({frase,objetos:[venda.groups.objeto.trim()],forma:'venda_em_nome_de_terceiro'});
  }
  return saida;
}

/** Requests and comparison on the same captured page support a hypothesis
 * about the intake journey. They leave delivery and payment roles open. */
export function extrairComparacaoDeOrcamentos(fontes) {
  const elegiveis = fontes.filter(f=>f.recortado===false&&['p','meta.description','meta.og:description'].includes(f.campo)&&
    classificarOrigemPublicada(f).estado==='nao_determinada'&&/^[a-f0-9]{64}$/u.test(f.sha256));
  for(const pedido of elegiveis) {
    if(pedido.campo!=='p') continue;
    const frase = [...frases.segment(pedido.trecho)].map(f=>f.segment.trim()).find(f=>
      /^(?:Em [\p{L}\p{N}& -]{2,32} )?(?:n[oó]s )?recebemos\s+[^?!]{0,120}\bsolicita[çc][oõ]es\b[^?!]{0,100}\b(?:clientes|contratantes) que (?:buscam|procuram) (?:profissionais|prestadores)\b/iu.test(f)&&
      !/\b(?:n[aã]o|nunca)\b/u.test(normal(f)));
    if(!frase) continue;
    for(const comparacao of elegiveis) {
      if(comparacao.url!==pedido.url||comparacao.sha256!==pedido.sha256||comparacao.coletadoEm!==pedido.coletadoEm) continue;
      const c = /(?:^|[.!?]\s+)\s*Compare\s+(or[çc]amentos)\b/iu.exec(comparacao.trecho);
      if(c) return {frase,objetos:[c[1]],forma:'comparacao_de_orcamentos',fonte:pedido,complemento:comparacao};
    }
  }
  return null;
}
