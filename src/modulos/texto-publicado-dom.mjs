// Keep format characters (for example U+200D) from the published source.
// Only Unicode compatibility normalization and whitespace are permitted.
export const limpar=v=>typeof v==='string'?v.normalize('NFKC').replace(/\s+/gu,' ').trim():'';
export const attrs=n=>Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]));
export const oculto=a=>'hidden'in a||'inert'in a||String(a['aria-hidden']||'').trim().toLowerCase()==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/iu.test(a.style||'');
export const controleApresentacao=a=>/(?:^|[\s_-])(?:mockup|mock-up|demo-form|form-demo|form-preview|input|fields)(?:$|[\s_-])/iu.test((a.class||'')+' '+(a.id||''));
export const controleEscolha=a=>['option','listbox','combobox'].includes(String(a.role||'').toLowerCase())||/(?:^|\s)(?:select-with-search(?:[-_\s]|$)|select2(?:[-_\s]|$)|choices__|dropdown-menu(?:[-_\s]|$))/iu.test((a.class||'')+' '+(a.id||''));
export const terceiro=a=>/(?:^|[\s_-])(?:testimonial|testimonials|depoimento|review|reviews|comment|customer)(?:$|[\s_-])/iu.test((a.class||'')+' '+(a.id||''));
export const ignorados=new Set(['style','noscript','template','form','input','select','textarea','option','svg','iframe','object','blockquote']);
export const blocos=new Set(['div','p','li','ul','ol','section','article','header','footer','nav','form','table','h1','h2','h3','h4','h5','h6','blockquote']);
export const estruturais=new Set(['nav','header','footer','aside']);
export const navegacaoSemantica=a=>String(a.role||'').toLowerCase()==='navigation'||/(?:^|\s)(?:w-nav(?:-menu)?|navbar|navbar-nav|navigation|navigation-menu|nav-menu|mega-menu|megamenu|breadcrumb|breadcrumbs)(?:$|\s)/iu.test((a.class||'')+' '+(a.id||''));
export const feedbackFormulario=a=>/(?:^|\s)(?:w-form-(?:done|fail)|form[-_](?:success|error|fail|failure|feedback|status|message)|(?:success|error|failure)[-_]message[-_]form)(?:$|\s)/iu.test((a.class||'')+' '+(a.id||''));
function temTextoNaSubarvore(no){const pilha=[no];let n=0;while(pilha.length&&n++<1600){const x=pilha.pop();if(x.nodeName==='#text'&&/\S/u.test(x.value||''))return true;pilha.push(...(x.childNodes||[]));}return pilha.length>0;}
export function textoProjetado(no,{raizFeedback=false}={}){
  const pilha=[no],partes=[],omissoes=new Set(),segmentos=[];let n=0,tamanho=0,segmento=[];
  while(pilha.length&&n<1600&&tamanho<2200){
    n++;const x=pilha.pop(),a=attrs(x);
    const motivo=oculto(a)?'subarvore_oculta':navegacaoSemantica(a)?'navegacao_semantica':controleApresentacao(a)?'controle_visual_nao_executado':controleEscolha(a)?'controle_de_escolha':terceiro(a)?'relato_de_terceiro':ignorados.has(x.tagName)||estruturais.has(x.tagName)||x.tagName==='script'?'subarvore_'+x.tagName:feedbackFormulario(a)&&!(x===no&&raizFeedback)?'feedback_formulario':null;
    if(motivo){if(['form','input','select','textarea'].includes(x.tagName)||temTextoNaSubarvore(x)){omissoes.add(motivo);if(limpar(segmento.join(' ')))segmentos.push(limpar(segmento.join(' ')));segmento=[];}continue;}
    if(x.nodeName==='#text'){partes.push(x.value);segmento.push(x.value);tamanho+=x.value.length;}
    else pilha.push(...(x.childNodes||[]).slice().reverse());
  }
  if(limpar(segmento.join(' ')))segmentos.push(limpar(segmento.join(' ')));
  return{texto:limpar(partes.join(' ')),segmentos,omissoes:[...omissoes],limitada:pilha.length>0};
}

const contenedores=new Set(['section','article','main','div','li','details','aside','header','footer','nav']);

export function escopoDeTitulos(no,escopo){
  return contenedores.has(no.tagName)?{titulos:escopo.titulos.slice()}:escopo;
}

export function registrarTitulo(escopo,nivel,texto){
  while(escopo.titulos.length&&escopo.titulos.at(-1).nivel>=nivel)escopo.titulos.pop();
  if(texto)escopo.titulos.push({nivel,texto});
}
