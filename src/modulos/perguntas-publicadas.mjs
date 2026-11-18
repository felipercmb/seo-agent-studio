import {parseFragment} from 'parse5';
import {createHash} from 'node:crypto';

const lista=v=>Array.isArray(v)?v:v==null?[]:[v];
const texto=v=>typeof v==='string'?v.replace(/\s+/gu,' ').trim():'';
const attrs=n=>Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]));
const tipos=v=>lista(v).filter(t=>typeof t==='string').map(t=>t.replace(/^https?:\/\/schema\.org\//u,''));
const schema=v=>typeof v==='string'?/^https?:\/\/schema\.org\/?$/u.test(v):Array.isArray(v)?v.some(schema):v&&typeof v==='object'?schema(v['@vocab']):false;
const sha=v=>createHash('sha256').update(v).digest('hex');
function semMarcacao(valor){
  if(typeof valor!=='string'||valor.length>6000)return '';
  const pilha=[parseFragment(valor)],partes=[];let nos=0;
  while(pilha.length&&nos++<1000){const n=pilha.pop();if(['script','style','template','noscript','form','input','textarea','select','iframe','object'].includes(n.tagName))continue;
    if(n.nodeName==='#text')partes.push(n.value);else pilha.push(...(n.childNodes||[]).slice().reverse());}
  return pilha.length?'':texto(partes.join(' '));
}

/** Reads only FAQPage/Question/acceptedAnswer in bounded local JSON-LD.
 * A published answer is a declaration, not proof of visibility or eligibility. */
export function extrairPerguntasPublicadas(documento,fonte){
  const itens=[],descartes=[],pilha=[documento];let nos=0,scripts=0,limitada=false;
  const vistos=new Set();
  while(pilha.length){
    if(++nos>30000){limitada=true;break;}
    const no=pilha.pop(),a=attrs(no);
    if(['form','blockquote','iframe','template','noscript'].includes(no.tagName)||/(?:^|[\s_-])(?:testimonial|testimonials|depoimento|review|reviews|comment)(?:$|[\s_-])/iu.test((a.class||'')+' '+(a.id||'')))continue;
    if(no.tagName!=='script'){pilha.push(...(no.childNodes||[]).slice().reverse());continue;}
    if(a.type?.trim().toLowerCase()!=='application/ld+json')continue;
    const scriptIndice=scripts++;
    if(scripts>4){limitada=true;continue;}
    const bruto=(no.childNodes||[]).map(n=>n.value||'').join('');
    if(Buffer.byteLength(bruto)>65536){limitada=true;continue;}
    let valor;try{valor=JSON.parse(bruto);}catch{descartes.push({scriptIndice,motivo:'json_invalido'});continue;}
    const fila=lista(valor).slice(0,100).map((v,i)=>({v,schema:false,caminho:Array.isArray(valor)?'/'+i:''}));let objetos=0;
    while(fila.length&&objetos++<500){
      const {v,schema:herdado,caminho}=fila.shift();if(!v||typeof v!=='object'||Array.isArray(v))continue;
      const valido=Object.hasOwn(v,'@context')?schema(v['@context']):herdado;if(!valido)continue;
      if(tipos(v['@type']).includes('FAQPage')){
        for(const [i,q] of lista(v.mainEntity).slice(0,50).entries()){
          if(!q||typeof q!=='object'||!tipos(q['@type']).includes('Question'))continue;
          const resposta=q.acceptedAnswer;
          if(!resposta||Array.isArray(resposta)||!tipos(resposta['@type']).includes('Answer'))continue;
          const pergunta=semMarcacao(q.name),trecho=semMarcacao(resposta.text);
          if(pergunta.length<5||pergunta.length>300||trecho.length<20||trecho.length>1200){descartes.push({scriptIndice,caminho,motivo:'pergunta_ou_resposta_fora_do_limite'});limitada=true;continue;}
          const chave=JSON.stringify([pergunta,trecho]);if(vistos.has(chave))continue;vistos.add(chave);
          if(itens.length>=12){limitada=true;continue;}
          const path=caminho+'/mainEntity'+(Array.isArray(v.mainEntity)?'/'+i:'');
          itens.push({...fonte,id:'faq_'+sha(JSON.stringify([fonte.url,fonte.sha256,scriptIndice,path,chave])).slice(0,20),
            tipo:'faq_estruturada',natureza:'resposta_estruturada_publicada',campo:'jsonld.FAQPage.mainEntity.acceptedAnswer.text',
            pergunta,trecho,secao:pergunta,recortado:false,htmlInicial:true,visibilidade:'nao_verificada',autoria:'declaracao_do_site_nao_verificada',
            origemEstruturada:{scriptIndice,jsonLdSha256:sha(bruto),perguntaPointer:path+'/name',respostaPointer:path+'/acceptedAnswer/text',perguntaOriginal:q.name,respostaOriginal:resposta.text}});
        }
      }
      for(const [i,g] of lista(v['@graph']).slice(0,100).entries())if(g&&typeof g==='object')fila.push({v:g,schema:valido,caminho:caminho+'/@graph'+(Array.isArray(v['@graph'])?'/'+i:'')});
    }
    if(fila.length){limitada=true;descartes.push({scriptIndice,motivo:'limite_objetos'});}
  }
  return{itens,descartes,limitada,scriptsLidos:Math.min(scripts,4),limitePagina:12,
    limite:'Respostas declaradas em FAQPage do HTML inicial; visibilidade, autoria efetiva, atualidade do serviço e adequação ao cliente não foram confirmadas.'};
}
