import {normalizarSite} from '../consulta.mjs';

const lista=v=>Array.isArray(v)?v:[];
const texto=v=>typeof v==='string'?v.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/gu,' ').trim():'';
const chave=v=>texto(v).normalize('NFC').toLocaleLowerCase('pt-BR').replace(/[?.!,;:]+$/u,'').trim();
const intencoes=new Set(['comercial','informacional','navegacional','indefinida']);
const termoValido=v=>typeof v==='string'&&v.trim().length>=3&&v.length<=160&&!/[\p{Cc}\p{Cf}<>@]|https?:\/\//iu.test(v);
function instanteISO(v){
  if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(v))return null;
  const n=Date.parse(v);
  return Number.isFinite(n)&&new Date(n).toISOString().slice(0,19)===v.slice(0,19)?n:null;
}

function pagina(valor,dominio){
  try{
    if(typeof valor!=='string'||valor.length>2048)return null;
    const u=new URL(valor);
    return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&normalizarSite(u.href)===dominio?u.href:null;
  }catch{return null;}
}

function observacao(item,agora){
  const o=item?.observado;
  const evidencia=lista(item?.evidencias).find(e=>{const momento=instanteISO(e?.coletadoEm);
    return e?.tipo==='google'&&texto(e.fonte)&&momento!==null&&momento<=agora&&agora-momento<3600_000;});
  const encontrado=o?.estado==='encontrado'&&Number.isInteger(o.posicao)&&o.posicao>=1&&o.posicao<=100;
  const ausente=o?.estado==='nao_encontrado_no_recorte'&&o.posicao===null;
  if(!evidencia||(!encontrado&&!ausente))return {estado:'nao_medido',posicao:null};
  return {estado:encontrado?'encontrado':'nao_encontrado_no_recorte',posicao:encontrado?o.posicao:null,
    fonte:texto(evidencia.fonte),coletadoEm:evidencia.coletadoEm,contexto:o.contexto||null};
}

function questao(c,oferta){
  if(!oferta)return 'A expressão se refere a algo que esta organização oferece ou a informação, marca, apoio ou atendimento?';
  if(c.intencao!=='comercial')return 'Quem pesquisa “'+c.termo+'” procura contratar esta oferta, aprender sobre o tema ou receber atendimento?';
  return 'Quem pesquisa “'+c.termo+'” consegue reconhecer '+oferta.nome+' e o próximo passo na página vinculada?';
}

/** An inspectable map of the existing research queue, not a keyword-value model.
 * Receives the server-derived project. Never ranks by monetary premises, adds
 * queries, changes the measurement plan or treats confirmation as proof of intent.
 */
export function construirMapaInvestigacao(projeto,{agora=Date.now}={}){
  const dominio=normalizarSite(projeto.dominio),instante=agora(),confirmado=projeto.perfil?.estado==='confirmado';
  const ofertas=lista(projeto.perfil?.ofertas).slice(0,8).filter(o=>texto(o?.id)&&texto(o?.nome));
  const ids=new Map(ofertas.map(o=>[o.id,o])),vistos=new Set(),observados=new Map();
  for(const i of lista(projeto.oportunidades?.itens).slice(0,100)){
    if(!termoValido(i?.termo))continue;
    const k=chave(i.termo);
    // Ambiguous duplicate observations never choose one by array order.
    observados.set(k,observados.has(k)?null:i);
  }
  const candidatos=[];
  for(const c of lista(projeto.palavras?.candidatos).slice(0,100)){
    if(!termoValido(c?.termo)||vistos.has(chave(c.termo)))continue;
    vistos.add(chave(c.termo));
    const oferta=ids.get(c.ofertaId),item=observados.get(chave(c.termo));
    // A valid observation for another offer cannot lend its relationship to this one.
    const medida=item&&(item.ofertaId??null)===(oferta?.id??null)?observacao(item,instante):{estado:'nao_medido',posicao:null};
    candidatos.push({termo:c.termo.trim(),ofertaId:oferta?.id??null,atuacaoId:texto(c.atuacaoId)||null,
      origem:c.origem==='site'?'site':'hipotese',intencao:intencoes.has(c.intencao)?c.intencao:'indefinida',
      naturezaIntencao:'hipotese_por_regras',observado:medida,questao:questao(c,oferta)});
  }
  const porOferta=ofertas.map(o=>{
    const buscas=candidatos.filter(c=>c.ofertaId===o.id),url=pagina(o.url,dominio);
    const comerciais=buscas.filter(c=>c.intencao==='comercial');
    const ordenadas=[...comerciais,...buscas.filter(c=>c.intencao!=='comercial')];
    return {ofertaId:o.id,nome:o.nome,perfilConfirmado:confirmado,
      entrega:o.entrega?.origem==='declaracao_usuario'?{tipoOferta:o.entrega.tipoOferta,papelOrganizacao:o.entrega.papelOrganizacao,origem:'declaracao_usuario'}:null,
      objetivo:texto(o.jornada?.objetivo)||null,comprador:texto(o.jornada?.comprador)||null,
      origemJornada:o.jornada?.natureza==='declaracao_usuario'?'declaracao_usuario':'nao_declarada',
      pagina:url?{url,origem:'perfil',conteudoConfirmado:false}:null,
      estado:!confirmado?'revisar_perfil':!buscas.length?'vincular_buscas':!url?'vincular_pagina':'investigar',
      cobertura:{candidatas:buscas.length,hipotesesComerciais:comerciais.length,
        comObservacaoAtual:buscas.filter(c=>c.observado.estado!=='nao_medido').length},
      primeirasBuscas:ordenadas.slice(0,3),outrasBuscas:Math.max(0,buscas.length-3),
      proximoPasso:!confirmado?'Confirme o que a organização oferece antes de usar esta ligação como plano de pesquisa.':
        !buscas.length?'Relacione uma expressão que o público usaria a esta oferta; a ausência de vínculo nesta seleção não prova ausência de demanda.':
        !url?'Vincule a página existente que atende a esta oferta antes de propor conteúdo novo.':
        'Compare as primeiras expressões com o público e o objetivo declarados. Confira a intenção nos resultados e a página de destino antes de definir um teste de SEO.',
      limite:'Esta ordem usa vínculo com a oferta e hipótese de intenção. Não estima procura, conversão, facilidade de subir ou retorno financeiro.'};
  });
  const semOferta=candidatos.filter(c=>!c.ofertaId),reserva=semOferta.filter(c=>c.atuacaoId);
  return {versao:1,estado:confirmado?'disponivel':'revisao_necessaria',porOferta,
    outrasAtividades:{quantidade:reserva.length,primeirasBuscas:reserva.slice(0,5)},
    semVinculo:{quantidade:semOferta.length-reserva.length,primeirasBuscas:semOferta.filter(c=>!c.atuacaoId).slice(0,5)},
    cobertura:{candidatas:candidatos.length,ligadasAOferta:candidatos.filter(c=>c.ofertaId).length,
      comObservacaoAtual:candidatos.filter(c=>c.observado.estado!=='nao_medido').length},
    limites:['O mapa resume a seleção existente; não adiciona termos, altera a fila de medição ou consome cota.',
      'Uma busca ampla ou sem vínculo precisa de investigação; isso não a torna inútil nem prova desperdício.',
      'Intenção de busca é hipótese. Perfil confirmado não comprova conversão, volume ou intenção de quem pesquisa.',
      'Programas, participação e apoio ficam identificados separadamente de ofertas; não precisam produzir uma venda.',
      'Valores de contribuição, taxa e custos não são copiados para este mapa nem atribuídos a palavras.']};
}
