import {parse} from 'parse5';
import {createHash} from 'node:crypto';
import {normalizarSite} from '../../src/consulta.mjs';
import {extrairInteracoesDaPagina} from '../../src/modulos/interacoes-publicas.mjs';

// Keep format characters (for example U+200D) from the published source.
// Only Unicode compatibility normalization and whitespace are permitted.
const limpar=v=>typeof v==='string'?v.normalize('NFKC').replace(/\s+/gu,' ').trim():'';
const attrs=n=>Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]));
const hash=v=>createHash('sha256').update(v).digest('hex');
const oculto=a=>'hidden'in a||'inert'in a||String(a['aria-hidden']||'').toLowerCase()==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/iu.test(a.style||'');
const terceiro=a=>/(?:^|[\s_-])(?:testimonial|testimonials|depoimento|review|reviews|comment|customer)(?:$|[\s_-])/iu.test((a.class||'')+' '+(a.id||''));
const ignorados=new Set(['style','noscript','template','form','input','select','textarea','option','svg','iframe','object','blockquote']);
const blocos=new Set(['div','p','li','ul','ol','section','article','header','footer','nav','form','table','h1','h2','h3','h4','h5','h6','blockquote']);
const estruturais=new Set(['nav','header','footer','aside']);
const feedbackFormulario=a=>/(?:^|\s)(?:w-form-(?:done|fail)|form[-_](?:success|error|fail|failure|feedback|status|message)|(?:success|error|failure)[-_]message[-_]form)(?:$|\s)/iu.test((a.class||'')+' '+(a.id||''));
function temTextoNaSubarvore(no){const pilha=[no];let n=0;while(pilha.length&&n++<1600){const x=pilha.pop();if(x.nodeName==='#text'&&/\S/u.test(x.value||''))return true;pilha.push(...(x.childNodes||[]));}return pilha.length>0;}
function textoProjetado(no,{raizFeedback=false}={}){
  const pilha=[no],partes=[],omissoes=new Set(),segmentos=[];let n=0,tamanho=0,segmento=[];
  while(pilha.length&&n<1600&&tamanho<2200){
    n++;const x=pilha.pop(),a=attrs(x);
    const motivo=oculto(a)?'subarvore_oculta':terceiro(a)?'relato_de_terceiro':ignorados.has(x.tagName)||estruturais.has(x.tagName)||x.tagName==='script'?'subarvore_'+x.tagName:feedbackFormulario(a)&&!(x===no&&raizFeedback)?'feedback_formulario':null;
    if(motivo){if(['form','input','select','textarea'].includes(x.tagName)||temTextoNaSubarvore(x)){omissoes.add(motivo);if(limpar(segmento.join(' ')))segmentos.push(limpar(segmento.join(' ')));segmento=[];}continue;}
    if(x.nodeName==='#text'){partes.push(x.value);segmento.push(x.value);tamanho+=x.value.length;}
    else pilha.push(...(x.childNodes||[]).slice().reverse());
  }
  if(limpar(segmento.join(' ')))segmentos.push(limpar(segmento.join(' ')));
  return{texto:limpar(partes.join(' ')),segmentos,omissoes:[...omissoes],limitada:pilha.length>0};
}
function rotulosPublicosLiterais(doc){
  const rotulos=new Set(),pilha=[doc];let n=0;
  while(pilha.length&&n++<30000){const no=pilha.pop(),a=attrs(no);if(oculto(a)||terceiro(a)||['script','style','noscript','template','textarea','select','option'].includes(no.tagName))continue;
    if(['input','button','a','label','legend'].includes(no.tagName)){
      if(a.type?.toLowerCase()==='hidden')continue;
      if(a['aria-label'])rotulos.add(limpar(a['aria-label']));
      if(['button','a','label','legend'].includes(no.tagName)){const t=textoProjetado(no);if(!t.limitada)for(const segmento of t.segmentos)rotulos.add(segmento);}
    }
    pilha.push(...(no.childNodes||[]));
  }
  return rotulos;
}
function folha(no){if(no.tagName!=='div')return false;const p=[...(no.childNodes||[])];let n=0;while(p.length&&n++<200){const x=p.pop();if(blocos.has(x.tagName))return false;p.push(...(x.childNodes||[]));}return !p.length;}
function recortar(texto,maximo){if(texto.length<=maximo)return{texto,recortado:false};const corte=texto.lastIndexOf(' ',maximo);return{texto:texto.slice(0,corte>=Math.floor(maximo/2)?corte:maximo).trim(),recortado:true};}
const declaracao=t=>/(?:^|[.!?]\s)(?:somos|oferecemos|prestamos|vendemos|fabricamos|produzimos|desenvolvemos|conectamos|intermediamos|nossa miss[ãa]o|nosso prop[óo]sito)\b|\b[ée] (?:uma?|um) (?:ag[êe]ncia|organiza[çc][ãa]o|empresa|cooperativa|grupo|instituto|plataforma)\b/iu.test(t);

/** Bounded offline source exporter. It does not infer a business profile,
 * request pages, execute scripts, inspect values, or activate controls.
 * The oracle corpus selects at most16 sources from this larger review pool. */
export function extrairFontesNegocio(coleta={}, {maxFontes=160}={}) {
  const dominio=normalizarSite(coleta.dominio),limite=Math.max(1,Math.min(240,Number.isInteger(maxFontes)?maxFontes:160));
  const paginas=[],filas=[],falhas=[],vistos=new Set();let bytes=0,limitada=false;
  for(const p of (Array.isArray(coleta.paginas)?coleta.paginas:[]).slice(0,12)){
    let url;
    try{url=new URL(p.url);if(url.protocol!=='https:'||url.search||url.hash||p.url.includes('#')||url.username||url.password||url.port||normalizarSite(url.href)!==dominio)throw Error('URL fora do escopo');}
    catch{falhas.push({url:p.url||null,motivo:'URL fora do escopo público do domínio.'});continue;}
    if(vistos.has(url.href))continue;vistos.add(url.href);
    if(p.status!==200||typeof p.html!=='string'||!p.html.trim()){falhas.push({url:url.href,motivo:'Sem HTML200 disponível.'});continue;}
    const tamanho=Buffer.byteLength(p.html),sha256=hash(p.html);
    if(tamanho>1048576||bytes+tamanho>4194304||p.sha256&&p.sha256!==sha256){falhas.push({url:url.href,motivo:'Orçamento ou hash da captura inválido.'});continue;}
    bytes+=tamanho;const data=p.coletadoEm||coleta.coletadoEm,coletadoEm=Number.isFinite(Date.parse(data))?data:null;
    const fontes=[],chaves=new Set(),doc=parse(p.html),projecoesComOmissao=new Set(),segmentosUnicos=new Set(),cacheTexto=new WeakMap();let secao='',nos=0,limitadaPagina=false,jsons=0,feedbacks=0,rotulosNaoLiterais=0;
    const lerTexto=no=>{if(cacheTexto.has(no))return cacheTexto.get(no);const t=textoProjetado(no);let texto=t.texto;if(t.limitada){limitadaPagina=true;texto='';}else if(t.omissoes.length){if(t.segmentos.length===1){texto=t.segmentos[0];segmentosUnicos.add(no);}else{projecoesComOmissao.add(no);texto='';}}const resultado={texto,projecao:{tipo:t.omissoes.length?'segmento_publico_continuo':'texto_dom_publicado',subarvoresOmitidas:t.omissoes.length>0,omissoes:t.omissoes,continuidade:t.omissoes.length?'um_segmento_sem_compor_os_lados':'sem_omissao'}};cacheTexto.set(no,resultado);return resultado;};
    const textoNo=no=>lerTexto(no).texto;
    const adicionar=(tipo,campo,t,secaoFonte=null,projecao={tipo:'texto_dom_ou_campo_publicado',subarvoresOmitidas:false})=>{const texto=limpar(t);if(texto.length<2)return;if(fontes.length>=240){limitadaPagina=true;return;}const r=recortar(texto,600),chave=tipo+'\n'+campo+'\n'+r.texto;if(chaves.has(chave))return;chaves.add(chave);fontes.push({id:'fonte_'+hash(dominio+'\n'+url.href+'\n'+chave).slice(0,20),texto:r.texto,tipo,url:url.href,campo,coletadoEm,sha256,recortado:r.recortado,projecao,...(secaoFonte?{secao:secaoFonte.slice(0,120)}:{})});};
    const pilha=[{no:doc,body:false,nav:false}];
    while(pilha.length){if(++nos>30000){limitadaPagina=true;break;}const {no,body,nav}=pilha.pop(),a=attrs(no),navegacao=nav||['nav','header','footer','aside'].includes(no.tagName);if(oculto(a)||terceiro(a)||ignorados.has(no.tagName))continue;
      if(body&&!navegacao&&feedbackFormulario(a)){
        const t=textoProjetado(no,{raizFeedback:true});
        if(!t.omissoes.length&&!t.limitada){adicionar('interface','template.formulario.feedback',t.texto,null,{tipo:'feedback_formulario_no_html',subarvoresOmitidas:false,estado:'template_nao_executado',envioObservado:false,visibilidadePorCssVerificada:false});feedbacks++;}
        continue;
      }
      if(no.tagName==='title')adicionar('descricao','title',textoNo(no),null,lerTexto(no).projecao);
      if(no.tagName==='meta'&&(a.name?.toLowerCase()==='description'||a.property?.toLowerCase()==='og:description'))adicionar('descricao',a.name?'meta.description':'meta.og:description',a.content);
      if(no.tagName==='script'){
        if(a.type?.trim().toLowerCase()!=='application/ld+json'||++jsons>4)continue;
        const bruto=(no.childNodes||[]).map(n=>n.value||'').join('');if(bruto.length>65536)continue;let v;try{v=JSON.parse(bruto);}catch{continue;}
        const fila=(Array.isArray(v)?v:[v]).slice(0,80);let j=0;while(fila.length&&j++<300){const x=fila.shift();if(!x||typeof x!=='object')continue;const tipos=(Array.isArray(x['@type'])?x['@type']:[x['@type']]).filter(t=>typeof t==='string'&&/^[A-Za-z]{2,60}$/.test(t));for(const tipo of tipos)for(const campo of ['name','description'])if(typeof x[campo]==='string')adicionar('declaracao','jsonld.'+tipo+'.'+campo,x[campo]);for(const chave of ['@graph','hasOfferCatalog','itemListElement','itemOffered','offers','mainEntity','provider'])for(const filho of(Array.isArray(x[chave])?x[chave]:[x[chave]]).slice(0,80))if(filho&&typeof filho==='object')fila.push(filho);}
        continue;
      }
      if(body&&!navegacao){const cabecalho=/^h[1-4]$/.test(no.tagName),f=folha(no);if(cabecalho){secao=textoNo(no);const pai=no.parentNode;if(pai&&!['body','html','main','form','nav','header','footer','aside'].includes(pai.tagName)){const t=textoNo(pai),filhos=pai.childNodes||[],temCorpo=filhos.some(n=>['p','li','div','dd'].includes(n.tagName)&&n!==no);if(temCorpo&&t.length>secao.length+15&&t.length<=600)adicionar('conteudo','bloco.titulo-conteudo',t,secao,lerTexto(pai).projecao);}}if(cabecalho||['p','li','dd','dt','figcaption'].includes(no.tagName)||f){const t=textoNo(no);if(t.length>=(cabecalho?3:20))adicionar(declaracao(t)?'declaracao':'conteudo',f?'div.texto':no.tagName,t,secao,lerTexto(no).projecao);}}
      pilha.push(...(no.childNodes||[]).slice().reverse().map(no=>({no,body:body||no.tagName==='body',nav:navegacao})));
    }
    const rotulosLiterais=rotulosPublicosLiterais(doc);
    for(const i of extrairInteracoesDaPagina(doc,{url:url.href,sha256,coletadoEm}).itens){if(!rotulosLiterais.has(limpar(i.rotulo))){rotulosNaoLiterais++;continue;}adicionar('interface',i.campo,i.rotulo,null,{tipo:'rotulo_publico',subarvoresOmitidas:false,estado:'nao_preenchido_nem_executado',envioObservado:false});}
    paginas.push({url:url.href,sha256,coletadoEm,status:p.status,bytes:tamanho,fontesCandidatas:fontes.length,projecoesComOmissaoDescartadas:projecoesComOmissao.size,segmentosUnicosPreservados:segmentosUnicos.size,feedbacksSeparadosComoInterface:feedbacks,rotulosNaoLiteraisDescartados:rotulosNaoLiterais,limitada:limitadaPagina});filas.push(fontes);limitada||=limitadaPagina;
  }
  const fontes=[];for(let r=0;r<4;r++)for(const f of filas)if(f.length&&fontes.length<limite)fontes.push(f.shift());while(fontes.length<limite&&filas.some(f=>f.length))for(const f of filas)if(f.length&&fontes.length<limite)fontes.push(f.shift());
  return{versao:2,dominio,fontes,paginas,falhas,cobertura:{paginasLidas:paginas.length,maxPaginas:12,maxBytes:4194304,bytesLidos:bytes,limiteFontes:limite,fontesRetidas:fontes.length,projecoesComOmissaoDescartadas:paginas.reduce((n,p)=>n+p.projecoesComOmissaoDescartadas,0),segmentosUnicosPreservados:paginas.reduce((n,p)=>n+p.segmentosUnicosPreservados,0),feedbacksSeparadosComoInterface:paginas.reduce((n,p)=>n+p.feedbacksSeparadosComoInterface,0),rotulosNaoLiteraisDescartados:paginas.reduce((n,p)=>n+p.rotulosNaoLiteraisDescartados,0),limitada:Boolean(limitada||falhas.length||filas.some(f=>f.length)||(coleta.paginas||[]).length>12)},limites:['Somente HTML inicial local já capturado; nenhum acesso de rede ou execução de scripts.','Textos são declarações ou conteúdo publicados, não validação independente. Interface não prova oferta, público, transação, resultado ou funcionamento.','Feedback de formulário no HTML é template não executado. Não comprova envio, sucesso, falha, atendimento ou visibilidade após aplicar CSS.','Um bloco com subárvore omitida não é recomposto juntando os textos dos dois lados. Um único segmento contínuo pode ser preservado com omissão sinalizada; filhos elegíveis continuam possíveis.','Rótulos de interface só entram se o texto literal puder ser conferido em campos públicos, sem usar valores de controles.','O pool é limitado por páginas/bytes/nós/trechos; não representa todo o site. A seleção oracle para revisão é distinta da recuperação end-to-end.']};
}
