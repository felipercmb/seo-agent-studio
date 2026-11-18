import {createHash} from 'node:crypto';
import {extrairFontesNegocio as extrairV4} from './fontes-v4.mjs';
import {extrairContextoPublico} from '../../src/modulos/contexto-publico.mjs';
import {classificarOrigemPublicada} from '../../src/modulos/atribuicao-publica.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');

/** V5 keeps V4 intact, removes explicitly attributed third-party sections and
 * adds FAQ answers with their own source field. It never supplies an actor. */
export function extrairFontesNegocio(coleta={},opcoes={}){
  const anterior=extrairV4(coleta,opcoes),contexto=extrairContextoPublico(coleta),descartes=[],descartesFAQNeural=[];
  const fontes=anterior.fontes.filter(f=>{
    const atribuicao=classificarOrigemPublicada(f);
    if(atribuicao.estado==='nao_determinada')return true;
    descartes.push({id:f.id,motivo:atribuicao.motivo,url:f.url,sha256:f.sha256,atribuicao});return false;
  });
  const adicionais=[];
  for(const f of contexto.perguntasPublicadas){
    if(f.trecho.length>600||f.pergunta.length>240||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(f.trecho+f.pergunta)){
      descartesFAQNeural.push({id:f.id,url:f.url,motivo:'fora_do_contrato_neural_sem_recortar',respostaCaracteres:f.trecho.length,perguntaCaracteres:f.pergunta.length});continue;
    }
    const pagina=anterior.paginas.find(p=>p.url===f.url&&p.sha256===f.sha256);if(!pagina)continue;
    const representativa=anterior.fontes.find(s=>s.url===f.url);
    const ctx={paginaId:'pag_'+sha(f.url+'\n'+f.sha256).slice(0,20),url:f.url,
      tituloPagina:representativa?.contexto?.tituloPagina||null,titulos:[{nivel:2,texto:f.pergunta}],
      campo:f.campo,coletadoEm:f.coletadoEm,sha256:f.sha256,recortado:false,
      classePagina:representativa?.contexto?.classePagina||'nao_determinada'};
    adicionais.push({id:f.id,texto:f.trecho,tipo:'declaracao',url:f.url,campo:f.campo,secao:f.pergunta,
      coletadoEm:f.coletadoEm,sha256:f.sha256,recortado:false,contexto:ctx,
      projecao:{tipo:'resposta_faq_estruturada',subarvoresOmitidas:false,visibilidade:'nao_verificada',autoria:'declaracao_do_site_nao_verificada'},
      origemEstruturada:f.origemEstruturada});
  }
  const limite=anterior.cobertura.limiteFontes,porPagina=anterior.paginas.map(p=>({faq:adicionais.filter(f=>f.url===p.url)}));
  const combinadas=[];
  // Reserve one FAQ per page before filling the larger source pool.
  for(const fila of porPagina)if(fila.faq.length&&combinadas.length<limite)combinadas.push(fila.faq.shift());
  const restantes=[...fontes,...porPagina.flatMap(f=>f.faq)];
  combinadas.push(...restantes.slice(0,Math.max(0,limite-combinadas.length)));
  return{...anterior,versao:5,fontes:combinadas,atribuicao:{descartes,descartesFAQNeural,naoClassificaAutoriaImplicita:true},
    cobertura:{...anterior.cobertura,fontesRetidas:combinadas.length,respostasFAQ:combinadas.filter(f=>f.campo==='jsonld.FAQPage.mainEntity.acceptedAnswer.text').length,
      limitada:anterior.cobertura.limitada||contexto.coberturaPerguntas.limitada||descartesFAQNeural.length>0||fontes.length+adicionais.length>limite},
    coberturaPerguntas:contexto.coberturaPerguntas,
    limites:[...anterior.limites,'FAQ estruturada preserva pergunta no contexto e resposta separada, com ponteiros e hash. Não confirma visibilidade, execução própria, adequação ou atualidade do serviço.','Seções explicitamente atribuídas a depoimentos/clientes não alimentam o leitor de atividades próprias. Autoria implícita ou não rotulada ainda pode ser ambígua.']};
}
