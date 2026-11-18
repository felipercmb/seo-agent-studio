import {createHash} from 'node:crypto';

const normal=v=>String(v??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
const attrs=n=>Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]));
const ignorar=new Set(['script','style','noscript','template','textarea','option','svg','iframe','object','blockquote']);
const oculto=a=>'hidden'in a||'inert'in a||String(a['aria-hidden']||'').trim().toLowerCase()==='true'||
  /(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(a.style||'');
const terceiro=a=>/(?:^|[\s_-])(?:review|depoimento|testimonial|testimonials|comment|customer)(?:$|[\s_-])/i.test((a.class||'')+' '+(a.id||''));
const id=(url,valor)=>'interface_'+createHash('sha256').update(url+'\n'+valor).digest('hex').slice(0,16);

function textoPublico(no) {
  const fila=[no],partes=[];let n=0;
  while(fila.length&&n++<500) {
    const atual=fila.pop(),a=attrs(atual);
    if(ignorar.has(atual.tagName)||['input','select','button','form'].includes(atual.tagName)&&atual!==no||oculto(a)||terceiro(a))continue;
    if(atual.nodeName==='#text')partes.push(atual.value);
    else fila.push(...(atual.childNodes||[]).slice().reverse());
  }
  return partes.join(' ').replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim();
}

function rotuloSeguro(v) {
  if(typeof v!=='string')return null;
  const t=v.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim();
  if(t.length<2||t.length>120||/[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(t)||t.replace(/\D/g,'').length>=8||
    /\b(?:csrf|access.?token|password|senha|secret|session.?id)\b/iu.test(t))return null;
  return t;
}

export function rotuloContatoExplicito(rotulo){
 const t=normal(rotulo);
 return /^(?:contatos?|telefone)(?:$|\s+(?:comercial|da equipe|de atendimento)$)/u.test(t)||
  /^(?:(?:entre|entrar) em contato|contate|contatar|fale|falar|converse|conversar|chame|chamar|ligue|ligar|abrir opcoes de contato)\b/u.test(t);
}
function acao(rotulo) {
  const t=normal(rotulo);
  if(/\?$/.test(t)||/^(?:como|por que|e confiavel)\b/.test(t))return 'indefinida';
  if(/^onde comprar\b/.test(t))return 'buscar';
  if(/\b(?:buscar|pesquisar|localizar|consultar|encontrar)\b/.test(t))return 'buscar';
  if(/\b(?:comprar|compre|adquirir|adquira)\b/.test(t))return 'comprar';
  if(/\b(?:reservar|reserve|reserva)\b/.test(t))return 'reservar';
  if(/\b(?:agendar|agende|agendamento)\b/.test(t))return 'agendar';
  if(/\b(?:orcamento|cotacao)\b/.test(t))return 'solicitar_orcamento';
  if(rotuloContatoExplicito(rotulo))return 'contatar';
  return 'indefinida';
}

/** Reads accessible names from an already parsed public initial document.
 * Values, placeholders, names, selected options and submission URLs are never
 * copied. No control is filled, activated or submitted. */
export function extrairInteracoesDaPagina(documento,fonte) {
  const entradas=[],porId=new Map(),rotulosPorControle=new Map();
  const fila=[{no:documento,grupo:'pagina',tipoGrupo:'pagina',visivel:false}];
  let nos=0,grupos=0,limitada=false;
  while(fila.length) {
    if(++nos>30_000){limitada=true;break;}
    const item=fila.pop(),n=item.no,a=attrs(n);
    if(ignorar.has(n.tagName)||oculto(a)||terceiro(a))continue;
    if(n.tagName==='input'&&['hidden','password','file'].includes((a.type||'text').toLowerCase()))continue;
    let grupo=item.grupo,tipoGrupo=item.tipoGrupo;
    if(n.tagName==='form'||a.role?.toLowerCase()==='search') {
      tipoGrupo=n.tagName==='form'?'formulario':'busca';grupo=tipoGrupo+'_'+(++grupos);
    }
    const visivel=item.visivel||n.tagName==='body';
    if(visivel) {
      const linha={n,a,grupo,tipoGrupo};entradas.push(linha);
      if(a.id)porId.set(a.id,linha); // Internal association only; never serialized.
      if(n.tagName==='label'&&a.for) {
        const r=rotuloSeguro(textoPublico(n));
        if(r&&!rotulosPorControle.has(a.for))rotulosPorControle.set(a.for,r);
      }
    }
    if(n.tagName==='select'||n.tagName==='input')continue;
    fila.push(...(n.childNodes||[]).slice().reverse().map(no=>({no,grupo,tipoGrupo,visivel})));
  }
  const itens=[],vistos=new Set();
  const adicionar=(linha,tipo,rotulo,campo)=>{
    const r=rotuloSeguro(rotulo);if(!r)return;
    const chave=[linha.grupo,tipo,r].join('\n');if(vistos.has(chave))return;vistos.add(chave);
    itens.push({id:id(fonte.url,chave),grupoId:id(fonte.url,linha.grupo),tipoGrupo:linha.tipoGrupo,
      tipo,rotulo:r,trecho:r,campo,url:fonte.url,coletadoEm:fonte.coletadoEm,sha256:fonte.sha256,
      acao:acao(r),natureza:'interface_publica',modo:'nao_preenchido',htmlInicial:true});
  };
  for(const linha of entradas) {
    const {n,a}=linha;
    if(['input','select'].includes(n.tagName)||['combobox','textbox','searchbox'].includes(a.role?.toLowerCase())) {
      let rotulo=a.id?rotulosPorControle.get(a.id):null,campo='label.texto';
      if(!rotulo&&n.parentNode?.tagName==='label')rotulo=textoPublico(n.parentNode);
      if(!rotulo&&a['aria-label']){rotulo=a['aria-label'];campo='aria-label';}
      if(!rotulo&&a['aria-labelledby']) {
        const partes=a['aria-labelledby'].split(/\s+/).map(k=>porId.get(k)).filter(Boolean);
        if(partes.length&&partes.every(p=>!['input','select','textarea','option'].includes(p.n.tagName))) {
          rotulo=partes.map(p=>textoPublico(p.n)).join(' ');campo='aria-labelledby.texto';
        }
      }
      adicionar(linha,'campo',rotulo,campo);
    } else if(n.tagName==='button'||a.role?.toLowerCase()==='button') {
      const r=textoPublico(n)||a['aria-label'];adicionar(linha,'botao',r,textoPublico(n)?'button.texto':'aria-label');
    } else if(n.tagName==='a') {
      const r=textoPublico(n)||a['aria-label'];if(acao(r)!=='indefinida')adicionar(linha,'link',r,textoPublico(n)?'a.texto':'aria-label');
    } else if(n.tagName==='legend')adicionar(linha,'campo',textoPublico(n),'legend.texto');
  }
  const prioridade=e=>e.tipo==='campo'&&/\b(?:origem|destino|data|dia|evento|cidade|servico|tipo|pedido|quantidade|bairro|cep)\b/.test(normal(e.rotulo))?0:
    e.tipo==='botao'&&e.acao!=='indefinida'||e.tipo==='campo'&&e.tipoGrupo!=='pagina'?1:e.acao!=='indefinida'||e.tipo==='campo'?2:3;
  const ordenados=itens.map((e,i)=>({e,i})).sort((a,b)=>prioridade(a.e)-prioridade(b.e)||a.i-b.i);
  return {itens:ordenados.slice(0,8).map(v=>v.e),candidatos:itens.length,limitada:limitada||itens.length>8};
}
