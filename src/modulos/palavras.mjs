import {normalizarSite} from '../consulta.mjs';
import {createHash} from 'node:crypto';
import {contextoDaExpressao, evidenciaContemExpressao, baseDaOferta} from './linguagem-negocio.mjs';

const chave = valor => String(valor || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
const limite = 100;
// The provider and evidence validators share a 160-character query contract.
// Drop oversized combinations instead of truncating them into another query.
const aceitavel = termo => typeof termo === 'string' && termo.trim().length >= 3 && termo.length <= 160 &&
  !/[\u0000-\u001f\u007f<>]|https?:\/\/|\S+@\S+|\b(?:site|intitle|inurl|filetype):/i.test(termo);
const filtroValido = termo => typeof termo === 'string' && termo.trim().length > 0 && termo.length <= 100 && !/[\u0000-\u001f\u007f<>]/.test(termo);
const temFrase = (texto, frase) => evidenciaContemExpressao(frase, texto);
const chaveConsulta = valor => chave(valor).replace(/[?.!,;:]+$/u, '').trim();
const rotuloSemObjeto = valor => /^(?:portugues(?: \((?:br|pt)\))?|english(?: \((?:us|uk)\))?|espanol|espanhol|pt-br|en-us|idioma|menu|inicio|home|saiba mais|leia mais|ver mais|veja mais|quem somos|a empresa|o que fazemos|o que pensamos|nossas especializacoes|frentes de atuacao|noss(?:os|as) (?:servicos|produtos|solucoes)|historias? de sucesso de clientes)$/.test(chaveConsulta(valor));

function distribuirPorOferta(ordenados, prioridade, centralidade=()=>1) {
  const resultado = [];
  for(const nivel of [0,1,2,3]){
  for (const faixa of [0, 1, 2, 3, 4]) {
    const candidatos = ordenados.filter(c => centralidade(c)===nivel && prioridade(c) === faixa);
    if (faixa > 1) { resultado.push(...candidatos); continue; }
    const grupos = new Map();
    for (const candidato of candidatos) {
      if (!grupos.has(candidato.ofertaId)) grupos.set(candidato.ofertaId, []);
      grupos.get(candidato.ofertaId).push(candidato);
    }
    // One offer with many published variants cannot remove every research
    // candidate for the other offers the owner has explicitly confirmed.
    while (grupos.size) {
      for (const [oferta, fila] of grupos) {
        resultado.push(fila.shift());
        if (!fila.length) grupos.delete(oferta);
      }
    }
  }
  }
  return resultado;
}

function variacoesDaAtividade(oferta,perfil) {
  const nome=oferta.nome,n=chave(nome),base=baseDaOferta(nome);
  // These phrases describe possible searches, never an observed purchase path.
  // A course or ticket should not inherit a quotation template merely because
  // the old generic offer contract called every activity a service.
  const objeto=nome.replace(/^(?:compra|venda|contrata[cç][aã]o|aluguel)\s+de\s+/iu,'');
  const entrega=oferta.entrega?.origem==='declaracao_usuario'?oferta.entrega:null;
  if(entrega?.tipoOferta==='software')return ['contratar '+objeto,'preço de '+objeto];
  if(entrega?.tipoOferta==='produto')return ['comprar '+objeto,'preço de '+objeto];
  if(/^(?:cursos?|pos[ -]graduacao|mba|formacao|treinamento|aulas?)\b/.test(n) || oferta.evidencias?.some(e=>/^jsonld\.Course\./.test(e.campo||'')))return['inscrição em '+nome,'preço de '+base];
  if(/^(?:hoteis|hotel|pousada|hospedagem)\b/.test(n) && !/\b(?:sites?|web|cloud|servidor|wordpress|dominio)\b/.test(n))return['reservar '+nome,'preço de '+base];
  if(/^restaurantes?\b/.test(n))return['reserva em '+nome,'preço de '+base];
  const plataforma=/\b(?:plataforma|software|sistema|gestao|solucao)\b/.test(n);
  if(!plataforma && /\b(?:passagens? de (?:onibus|aviao)|passagens? aereas|ingressos?)\b/.test(n))return['comprar '+objeto,'preço de '+objeto];
  if(/^(?:imoveis|apartamentos?|casas)\b/.test(chave(objeto)))return[/\b(?:aluguel|alugar)\b/.test(n)?'alugar '+objeto:'comprar '+objeto,'preço de '+objeto];
  if(plataforma && !/\b(?:implantacao|implementacao|desenvolvimento|consultoria)\b/.test(n))return['contratar '+objeto,'preço de '+objeto];
  if(entrega?.tipoOferta!=='servico'&&(perfil.entendimento?.papel==='produtos' || oferta.evidencias?.some(e=>/^jsonld\.Product\./.test(e.campo||''))))return['comprar '+objeto,'preço de '+objeto];
  return['orçamento para '+base,'preço de '+base];
}

function intencao(candidato) {
  const t = chave(candidato.termo);
  const contexto = contextoDaExpressao(candidato);
  if (contexto === 'participacao') return 'navegacional';
  if (['atendimento', 'institucional'].includes(contexto)) return 'navegacional';
  if (contexto === 'negacao') return 'indefinida';
  if (contexto === 'informacao') return /^(?:quanto custa|qual (?:e )?o (?:preco|valor)|como (?:solicitar|pedir|obter) (?:um )?orcamento|onde (?:contratar|comprar|alugar))\b/.test(t) ? 'comercial' : 'informacional';
  if (candidato.tipo === 'marca' || ['atendimento', 'institucional'].includes(candidato.tipo)) return 'navegacional';
  if (/^(?:como|o que|por que|quando|onde|qual|quais)\b/.test(t) && !/\b(?:contratar|comprar|orcamento)\b/.test(t)) return 'informacional';
  if (['servico', 'produto', 'local'].includes(candidato.tipo) || /\b(?:contratar|contratacao|orcamento|comprar|preco|alugar)\b/.test(t)) return 'comercial';
  return candidato.tipo === 'tema' ? 'informacional' : 'indefinida';
}
function evidenciaPublica(candidato, dominio) {
  const e = candidato.evidencia;
  try {
    const url = new URL(e.url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port &&
      !url.search && !url.hash && normalizarSite(url.href) === dominio && typeof e.trecho === 'string' && e.trecho.trim() && typeof e.campo === 'string' &&
      evidenciaContemExpressao(candidato.termo, e.trecho);
  } catch { return false; }
}

/** Generates a bounded research queue; these are not measured Google queries. */
export function gerarPalavras({perfil, descoberta = {}}) {
  const dominio = normalizarSite(perfil.dominio);
  const ofertas = Array.isArray(perfil.ofertas) ? perfil.ofertas.slice(0, 8) : [];
  const exclusoes = (perfil.exclusoes || []).filter(filtroValido);
  const mapa = new Map();
  let excluidos = 0,rotulosSemObjetoDescartados=0;
  const adicionar = candidato => {
    if (!aceitavel(candidato.termo)) return;
    if (exclusoes.some(e => temFrase(candidato.termo, e))) { excluidos++; return; }
    const k = chaveConsulta(candidato.termo);
    if (!mapa.has(k)) mapa.set(k, {...candidato, termo: candidato.termo.trim()});
  };
  for (const c of (Array.isArray(descoberta.candidatos) ? descoberta.candidatos : []).slice(0, 100)) {
    if (!c || !aceitavel(c.termo) || !evidenciaPublica(c, dominio)) continue;
    // Match actual offer wording. A shared generic noun or artist name does not
    // establish the relationship between a query and a confirmed offer.
    const contexto = contextoDaExpressao(c);
    const exata = ofertas.find(o => chave(o.nome) === chave(c.termo));
    const declaradaExata = perfil.estado === 'confirmado' && exata?.origem === 'usuario' ? exata : null;
    // A language switcher or a generic navigation label is a literal page
    // observation, but not a useful search object. Keep it in discovery rather
    // than spending a limited ranking query; explicit owner offers take precedence.
    if(c.tipo!=='marca'&&!declaradaExata&&rotuloSemObjeto(c.termo)){rotulosSemObjetoDescartados++;continue;}
    const oferta = ['negacao', 'participacao'].includes(contexto) ? null :
      ['atendimento', 'institucional'].includes(contexto) ? declaradaExata :
      exata || ofertas.filter(o =>
        chave(o.nome).split(' ').length >= 2 && temFrase(c.termo, o.nome))
        .sort((a, b) => chave(b.nome).length - chave(a.nome).length)[0];
    adicionar({termo: c.termo, tipo: c.tipo || 'tema', origem: 'site', ofertaId: oferta?.id ?? null,
      intencao: intencao(c), evidencia: structuredClone(c.evidencia),
      contextoFonte: contexto,
      motivo: declaradaExata && oferta === declaradaExata && ['atendimento', 'institucional'].includes(contexto)
        ? 'A pessoa declarou esta oferta exata; a página de origem é de atendimento ou institucional e não comprova intenção de compra.'
        : oferta ? 'Expressão publicada vinculada ao nome de uma oferta do perfil; intenção de busca ainda é uma hipótese.'
        : 'Expressão publicada; a ligação com uma oferta comercial ainda precisa ser confirmada.'});
  }
  // The profile can recover an exact title or structured service/product name
  // from the same collected pages even when the discovery vocabulary missed it.
  // Keep its public origin immediately; confirmation is needed for new variants.
  for (const oferta of ofertas.filter(o => o.origem === 'site')) {
    const evidencia = oferta.evidencias?.[0];
    const candidato = {termo:oferta.nome, tipo:/Product/.test(evidencia?.campo || '') ? 'produto' : 'servico', evidencia};
    if (!aceitavel(oferta.nome) || !evidenciaPublica(candidato, dominio) || contextoDaExpressao(candidato) !== 'oferta') continue;
    adicionar({...candidato, origem:'site', ofertaId:oferta.id, intencao:intencao(candidato), contextoFonte:'oferta',
      motivo:'Nome publicado recuperado do título ou de uma declaração estruturada do site; a oferta continua sujeita à revisão.'});
  }
  if (perfil.estado === 'confirmado') {
    for (const oferta of ofertas) {
      if (!aceitavel(oferta.nome)) continue;
      // Do not expand a negative or editorial label into a commercial queue
      // merely because a draft was confirmed. The original owner label remains.
      const contexto = contextoDaExpressao({termo:oferta.nome, tipo:'servico'});
      if (contexto !== 'oferta') continue;
      const razao = 'Sugestão gerada a partir de uma oferta confirmada pelo usuário; não comprova pesquisa, volume ou posição.';
      adicionar({termo: oferta.nome, tipo: 'servico', origem: 'hipotese', ofertaId: oferta.id, intencao: 'comercial', motivo: razao});
      for(const termo of variacoesDaAtividade(oferta,perfil))adicionar({termo,tipo:'servico',origem:'hipotese',ofertaId:oferta.id,intencao:'comercial',motivo:razao});
      const marca=typeof perfil.nome==='string'?perfil.nome.trim():'';
      if(marca.length>=2 && marca.length<=80 && !/[./:@<>]/.test(marca) && chave(oferta.nome).split(' ').length<=3 && !temFrase(oferta.nome,marca)){
        adicionar({termo:oferta.nome+' '+marca,tipo:'servico',origem:'hipotese',ofertaId:oferta.id,intencao:'comercial',motivo:'Combinação de oferta e nome revisados no perfil. É uma hipótese de consulta, sem procura ou posição confirmada.'});
      }
      for (const regiao of (perfil.regioes || []).slice(0, 5)) {
        if (!filtroValido(regiao) || temFrase(oferta.nome, regiao)) continue;
        adicionar({termo: oferta.nome + ' em ' + regiao, tipo: 'local', origem: 'hipotese', ofertaId: oferta.id, intencao: 'comercial', motivo: 'Sugestão combina uma oferta e uma região informadas no perfil; demanda e posição não foram observadas.'});
      }
    }
  }
  const atuacoes=(Array.isArray(perfil.entendimento?.atuacoes)?perfil.entendimento.atuacoes:[])
    .filter(a=>['programa_social','captacao','participacao'].includes(a?.tipo)).slice(0,8);
  for(const a of atuacoes){
    if(!aceitavel(a.nome))continue;
    const atuacaoId=a.id || 'atuacao_'+createHash('sha256').update(dominio+'\n'+a.tipo+'\n'+a.nome).digest('hex').slice(0,16);
    const evidencia=a.evidencias?.find(e=>evidenciaPublica({termo:a.nome,evidencia:e},dominio));
    if(evidencia){
      const motivo='Atividade não comercial mencionada nas fontes. A presença do nome não comprova procura ou participação.';
      const publicada=mapa.get(chaveConsulta(a.nome));
      const intencaoAtividade=a.tipo==='participacao' && (publicada?.intencao==='navegacional' || contextoDaExpressao({termo:a.nome,tipo:'tema',evidencia})==='participacao')?'navegacional':'informacional';
      // Discovery may already have classified the same literal title as a
      // service. Its reviewed activity relationship takes precedence, while
      // retaining the first public wording and its original provenance.
      if(publicada?.origem==='site' && !publicada.ofertaId)mapa.set(chaveConsulta(a.nome),{...publicada,tipo:'tema',atuacaoId,intencao:intencaoAtividade,contextoFonte:'participacao',motivo});
      else adicionar({termo:a.nome,tipo:'tema',origem:'site',atuacaoId,intencao:intencaoAtividade,contextoFonte:'participacao',evidencia:structuredClone(evidencia),motivo});
    }
    if(perfil.estado==='confirmado'){
      const prefixo=a.tipo==='captacao'?'como apoiar ':a.tipo==='participacao'?'como participar de ':'como funciona ';
      adicionar({termo:prefixo+a.nome,tipo:'tema',origem:'hipotese',atuacaoId,intencao:'informacional',contextoFonte:'participacao',
        motivo:'Hipótese para encontrar informação sobre uma atividade revisada. Não pressupõe venda, impacto social ou volume de buscas.'});
    }
  }
  const niveis=new Map(ofertas.map(o=>[o.id,({principal:0,indefinida:1,complementar:2}[o.centralidade?.nivel] ?? 1)]));
  const centralidade=c=>c.ofertaId?(niveis.get(c.ofertaId) ?? 1):c.atuacaoId?1:3;
  const prioridade = c => c.ofertaId && c.intencao === 'comercial' ? 0 : c.ofertaId ? 1 : c.tipo === 'marca' ? 2 : c.intencao === 'comercial' ? 3 : 4;
  const ordenados = [...mapa.values()].sort((a, b) => centralidade(a)-centralidade(b) || prioridade(a) - prioridade(b) || Number(a.origem === 'hipotese') - Number(b.origem === 'hipotese'));
  const todos = distribuirPorOferta(ordenados, prioridade,centralidade);
  const candidatos = todos.slice(0, limite);
  return {versao: 1, candidatos,
    cobertura: {publicadas: candidatos.filter(c => c.origem === 'site').length, hipoteses: candidatos.filter(c => c.origem === 'hipotese').length,
      excluidos,rotulosSemObjetoDescartados, limiteTermos: limite, totalElegiveis: todos.length, limitada: Boolean(descoberta.cobertura?.limitada || todos.length > limite)},
    limites: [
      'Os candidatos formam uma seleção para pesquisa, não o conjunto de todas as buscas em que o site aparece.',
      'A intenção é uma classificação inicial por regras. Volume, posição e retorno financeiro precisam de evidências separadas.',
      'Expressões publicadas preservam a página de origem. Novas combinações são hipóteses e só são geradas após a confirmação do perfil.',
      'Até 100 candidatos são priorizados por vínculo com uma oferta e intenção comercial. Esta ordem não estima vendas, procura ou dificuldade de SEO.',
      'A importância principal ou complementar da oferta organiza as faixas; é uma hipótese ou declaração do usuário, não uma medida de mercado. Dentro de cada faixa, as ofertas dividem a seleção em rodízio.',
      'Variações de pontuação terminal são deduplicadas, preservando a primeira expressão publicada.',
      'Rótulos genéricos de navegação e idioma não entram na fila de consultas, salvo uma marca ou oferta exata declarada pelo usuário. A descoberta original mantém suas fontes.',
    ],
  };
}
