import {normalizarSite} from '../consulta.mjs';
import {classificarDocumentoPublico} from './documentos-publicos.mjs';
import {revisarEstruturaProposicao,revisarEstruturaCondicao} from './estrutura-proposicoes.mjs';
import {classificarOrigemPublicada} from './atribuicao-publica.mjs';

const lista=v=>Array.isArray(v)?v:[];
function identidade(f,dominio){
  const c=f?.contexto||f||{};
  try{const u=new URL(c.url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||normalizarSite(u.href)!==dominio||!/^[a-f0-9]{64}$/u.test(c.sha256||''))return null;return{url:u.href,sha256:c.sha256};}catch{return null;}
}
const igual=(a,b)=>a&&b&&a.url===b.url&&a.sha256===b.sha256;
const documental=f=>['politica','editorial'].includes(classificarDocumentoPublico(f?.contexto||f).classe);
const relato=f=>classificarOrigemPublicada(f).estado!=='nao_determinada';
const explicar=motivo=>motivo==='ancora_documental_nao_confirma_oferta'
  ?'O nome foi identificado em uma política ou publicação editorial. Esse contexto não confirma que o site forneça a oferta nem que execute as atividades citadas.'
  :motivo==='fonte_documental_nao_confirma_operacao'
  ?'A fonte é uma política ou publicação editorial. O trecho foi preservado para revisar seu alcance; ele não confirma uma rotina operacional desta oferta.'
  :motivo==='ancora_de_relato_nao_confirma_oferta'||motivo==='fonte_de_relato_nao_confirma_operacao'
  ?'A fonte tem rótulo de relato de cliente ou formato de avaliação publicada. Ela não confirma uma oferta ou rotina própria do fornecedor; autoria e alcance continuam pendentes.'
  :'A fonte ou sua projeção não ficou vinculada à página usada para identificar a oferta. Isso não prova que a relação esteja errada.';

/** A separate review view: raw jobs/hashes remain intact. Page agreement is a
 * necessary documentary boundary, never confirmation of the same activity. */
export function revisarEscopoProposicoes(resultado){
  if(resultado?.versao!==3||!Array.isArray(resultado.ofertas))return{versao:1,estado:'nao_aplicavel',resultadoTriado:null,pendencias:[]};
  let dominio;try{dominio=normalizarSite(resultado.dominio);}catch{return{versao:1,estado:'dominio_invalido',resultadoTriado:null,pendencias:[]};}
  const triado=structuredClone(resultado),pendencias=[],ofertas=[];
  for(const o of triado.ofertas){
    if(!o.jornada)continue;
    const fs=lista(o.citacoes),nomeada=o.fonteNome?fs.filter(f=>f.id===o.fonteNome):fs,
      identidades=nomeada.map(f=>identidade(f,dominio)).filter(Boolean),unicas=[...new Map(identidades.map(i=>[JSON.stringify(i),i])).values()],
      ancora=unicas.length===1?unicas[0]:null,ancoraDocumental=Boolean(ancora&&nomeada.some(documental)),ancoraRelato=Boolean(ancora&&nomeada.some(relato));
    const motivo=item=>!ancora?'pagina_da_ancora_nao_determinada':ancoraDocumental?'ancora_documental_nao_confirma_oferta':ancoraRelato?'ancora_de_relato_nao_confirma_oferta':lista(item.citacoes).some(documental)?'fonte_documental_nao_confirma_operacao':lista(item.citacoes).some(relato)?'fonte_de_relato_nao_confirma_operacao':'fonte_ou_proposicao_fora_da_pagina_da_ancora';
    const dentro=item=>ancora&&!ancoraDocumental&&!ancoraRelato&&lista(item.citacoes).length>0&&lista(item.citacoes).every(f=>igual(identidade(f,dominio),ancora)&&!documental(f)&&!relato(f));
    const proposicoesOriginais=lista(o.jornada.proposicoes),estruturas=new Map(proposicoesOriginais.map(p=>[p.id,revisarEstruturaProposicao(p)]));
    const pendente=(campo,item)=>{
      const propria=campo==='proposicoes'?estruturas.get(item.id):campo==='condicoes'?revisarEstruturaCondicao(item,o):null;
      const dependencia=lista(item.proposicoes).map(id=>estruturas.get(id)).find(e=>e?.estado==='requer_revisao_estrutural');
      const estrutural=propria?.estado==='requer_revisao_estrutural'?propria:dependencia;
      const referenciaPendente=proposicoesOriginais.find(p=>lista(item.proposicoes).includes(p.id)&&!dentro(p));
      const motivoBase=!lista(item.citacoes).length&&referenciaPendente?motivo(referenciaPendente):motivo(item);
      const m=dentro(item)||!lista(item.citacoes).length&&dependencia?estrutural?.motivos[0]||motivoBase:motivoBase;
      pendencias.push({ofertaNome:o.nome,campo,motivo:m,explicacao:estrutural?.explicacao||explicar(m),...(estrutural?{conferenciaEstrutural:estrutural}:{}),...(referenciaPendente?{proposicaoDeApoioPendente:referenciaPendente.id}:{}),ancora,interpretacao:structuredClone(item),recomendacaoComercial:false});
    };
    if(ancoraDocumental||ancoraRelato)pendente('oferta_identificada',{nome:o.nome,natureza:o.natureza,papel_site:o.papel_site,citacoes:fs});
    const j=o.jornada,originais=proposicoesOriginais,retidas=originais.filter(p=>dentro(p)&&estruturas.get(p.id)?.estado!=='requer_revisao_estrutural'),ids=new Set(retidas.map(p=>p.id));
    const reter=(campo,item)=>{
      if(campo==='condicoes'&&revisarEstruturaCondicao(item,o).estado==='requer_revisao_estrutural'){pendente(campo,item);return false;}
      const refs=lista(item.proposicoes),apoio=refs.length?refs.every(p=>ids.has(p))&&(!lista(item.citacoes).length||dentro(item)):dentro(item);
      if(apoio)return true;
      pendente(campo,item);return false;
    };
    for(const p of originais)if(!retidas.includes(p))pendente('proposicoes',p);
    j.proposicoes=retidas;
    for(const campo of ['compradores','executores','beneficiarios','pagadores','fornecimento','operacoesAutomatizadas','transacoesDoCliente','naoProjetadas','condicoes'])if(Array.isArray(j[campo]))j[campo]=j[campo].filter(x=>reter(campo,x));
    ofertas.push({nome:o.nome,ancora,ancoraDocumental,ancoraRelato,proposicoesOriginais:originais.length,proposicoesDentroDaPagina:retidas.length});
    j.perfilConfirmado=false;j.revisaoSemantica='pendente';
  }
  triado.perfilConfirmado=false;triado.revisaoSemantica='pendente';
  return{versao:3,estado:pendencias.length?'com_pendencias':'sem_pendencia_documental',politica:'mesma_url_e_hash_sem_atribuir_documento_editorial_ou_politica_a_operacao',
    resultadoOriginalPreservado:true,resultadoTriado:triado,ofertas,pendencias,
    limites:['Uma citação literal em outra página não é atribuída automaticamente à oferta escolhida. A interpretação original e as fontes permanecem no job preservado.',
      'Mesma página e hash não demonstram mesma oferta, autoria, condição vigente ou verdade da interpretação. Relações da mesma página ainda precisam de revisão.',
      'A classe documental é uma heurística por caminho/título/contexto. Termos podem conter condições relevantes e artigos podem descrever ofertas reais; mantê-los pendentes não prova que sejam falsos ou irrelevantes.',
      'Indicadores estruturais mantêm imperativos, objetos oferecidos e campos nominais para revisão. Ausência de indicador não aprova a interpretação.',
      'Relatos e avaliações publicados não confirmam atividade própria, autoria independente ou resultado reproduzível. A fonte original continua preservada.',
      'A retirada desta visualização não prova erro ou inexistência da relação: uma ligação entre páginas pode ser legítima, mas precisa ser confirmada. Não é ganho de precisão medido.']};
}
