// Executada somente após clicar na extensão, na página já aberta. Sem rede.
export function capturarPaginaGoogle(){
  const u=new URL(location.href),hosts=['google.com','www.google.com','google.com.br','www.google.com.br'];
  if(u.protocol!=='https:'||!hosts.includes(u.hostname)||u.pathname!=='/search')throw Error('Abra uma página de resultados do Google antes de capturar.');
  if(u.searchParams.get('udm')!=='14'||u.searchParams.has('tbm'))throw Error('Abra a aba Web do Google para esta captura.');
  const q=u.searchParams.get('q');if(!q||q.length>200)throw Error('A consulta da página não foi identificada.');
  const bloco=document.getElementById('search');
  if(!bloco)throw Error('O bloco de resultados não foi reconhecido. Não é possível concluir que o site esteja ausente.');
  const recipiente=document.createElement('div');
  const copiar=bloco.cloneNode(true);
  const pares=[[bloco,copiar]];
  while(pares.length){
    const[original,clone]=pares.pop();
    if(original instanceof Element){
      const estilo=getComputedStyle(original);
      if(original.hidden||estilo.display==='none'||estilo.visibility==='hidden'||estilo.visibility==='collapse'){clone.remove();continue;}
    }
    const a=[...original.childNodes],b=[...clone.childNodes];for(let i=0;i<a.length;i++)if(b[i])pares.push([a[i],b[i]]);
  }
  for(const n of copiar.querySelectorAll('script,style,noscript,template,form,input,textarea,select,button,iframe,svg,img,video,audio'))n.remove();
  const permitidos=new Set(['id','class','href','role','aria-label','aria-hidden','hidden','data-text-ad','data-ta-slot','data-q']);
  for(const n of [copiar,...copiar.querySelectorAll('*')]){
    if(n instanceof HTMLElement&&(n.hidden||n.getAttribute('aria-hidden')==='true')){n.remove();continue;}
    for(const a of [...n.attributes])if(!permitidos.has(a.name))n.removeAttribute(a.name);
    if(n.hasAttribute('href')){
      try{const h=new URL(n.getAttribute('href'),location.href);
        if(!['http:','https:'].includes(h.protocol)||h.username||h.password||/(?:^|\.)googleadservices\.com$/iu.test(h.hostname))n.removeAttribute('href');
        else{
          if(hosts.includes(h.hostname)){
            let destinoExplicito=false,opacoPermitido=false;
            if(['/url','/goto'].includes(h.pathname)){
              const vs=[...h.searchParams.getAll('q'),...h.searchParams.getAll('url')];
              if(h.protocol==='https:'&&!h.port&&vs.length<=1){
                if(!vs.length)opacoPermitido=true;
                else if(vs[0].trim()&&vs[0].length<=4096&&!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(vs[0]))try{
                  const v=new URL(vs[0]);destinoExplicito=['http:','https:'].includes(v.protocol)&&!v.username&&!v.password&&!v.port&&!hosts.includes(v.hostname);
                }catch{opacoPermitido=true;}
              }
              if(!destinoExplicito&&!opacoPermitido){n.removeAttribute('href');continue;}
            }
            const permitidos=destinoExplicito?['q','url']:h.pathname==='/search'?['q','udm','start','hl','gl','pws','uule']:[];for(const k of [...h.searchParams.keys()])if(!permitidos.includes(k))h.searchParams.delete(k);}
          n.setAttribute('href',h.href);
        }}
      catch{n.removeAttribute('href');}
    }
  }
  recipiente.append(copiar);
  const topo=document.getElementById('topstuff');
  if(topo){const d=document.createElement('p');d.textContent=topo.innerText;recipiente.prepend(d);}
  const proxima=document.getElementById('pnnext');
  if(proxima)try{
    const p=new URL(proxima.href,location.href);
    if(p.protocol==='https:'&&hosts.includes(p.hostname)&&p.pathname==='/search'&&!p.username&&!p.password){
      for(const k of [...p.searchParams.keys()])if(!['q','udm','start','hl','gl','pws','uule'].includes(k))p.searchParams.delete(k);
      const a=document.createElement('a');a.id='pnnext';a.href=p.href;a.textContent='Próxima página';recipiente.append(a);
    }
  }catch{/* Nenhum endereço seguinte seguro para preservar. */}
  const html=recipiente.innerHTML;
  if(new TextEncoder().encode(html).length>49152)throw Error('O trecho excede 48 KiB. A captura não foi truncada nem salva.');
  const url=new URL('https://'+u.hostname+'/search');
  for(const k of ['q','udm','start','hl','gl','pws','uule'])if(u.searchParams.has(k))url.searchParams.set(k,u.searchParams.get(k));
  return{formato:'visibilidade-google-local',versao:1,metodo:'pagina_aberta',url:url.href,coletadoEm:new Date().toISOString(),dispositivo:/Mobile|Android|iPhone/iu.test(navigator.userAgent)?'celular':'computador',localidadeDeclarada:null,html};
}
