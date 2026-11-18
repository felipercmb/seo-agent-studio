import {parse} from 'parse5';
import {createHash} from 'node:crypto';
import {normalizarSite} from './consulta.mjs';
import {ErroProjeto} from './modulos/repositorio.mjs';
import {organizarSequenciasGoogle} from './google-sequencias.mjs';
import {destinoGooglePublicado,dominioExibidoGoogle,redirecionamentoGoogleSemDestino} from './google-identidade.mjs';

export class ErroGoogleLocal extends ErroProjeto {constructor(mensagem,status=400){super(mensagem,status);}}
const falhar=(m,s)=>{throw new ErroGoogleLocal(m,s);};
const objeto=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const bytes=s=>Buffer.byteLength(s,'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const limpo=s=>String(s||'').replace(/\s+/gu,' ').trim();
export const chaveBuscaGoogle=s=>limpo(String(s||'').normalize('NFKC')).toLocaleLowerCase('pt-BR');
const GOOGLE=new Set(['google.com','www.google.com','google.com.br','www.google.com.br']);
const PARAMETROS=['q','udm','start','hl','gl','pws','uule'];
function urlGoogle(valor,{proxima=false}={}){
  let u;try{u=new URL(valor);}catch{falhar('Informe a URL da página de resultados aberta.');}
  if(u.protocol!=='https:'||!GOOGLE.has(u.hostname)||u.port||u.username||u.password||u.pathname!=='/search')falhar('A captura precisa vir de uma página de resultados do Google, sem redirecionamentos.');
  for(const k of PARAMETROS)if(u.searchParams.getAll(k).length>1)falhar('A URL contém parâmetros repetidos.');
  const termo=limpo(u.searchParams.get('q'));
  if(!termo||Array.from(termo).length>200||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(termo))falhar('A consulta da página está ausente ou inválida.');
  const raw=u.searchParams.get('start')||'0';
  if(!/^(?:0|[1-9]\d{0,3})$/u.test(raw)||Number(raw)>500)falhar('O início solicitado da página ultrapassa o limite local.');
  const limpa=new URL('https://'+u.hostname+'/search');
  for(const k of PARAMETROS){const v=k==='start'?String(Number(raw)):u.searchParams.get(k);if(v!==null){if(v.length>(k==='uule'?512:300))falhar('O contexto de busca ultrapassa o limite local.');limpa.searchParams.set(k,k==='q'?termo:v);}}
  limpa.hash='';
  return{url:limpa.href,termo,inicioSolicitado:Number(raw),modoWeb:u.searchParams.get('udm')==='14'&&!u.searchParams.has('tbm'),hl:u.searchParams.get('hl')||null,gl:u.searchParams.get('gl')||null,pws:u.searchParams.get('pws')||null,uule:u.searchParams.get('uule')||null};
}
export function criarLinkGoogle(termo){
  if(typeof termo!=='string'||!limpo(termo)||Array.from(termo).length>200||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(termo))falhar('Busca candidata inválida.');
  const u=new URL('https://www.google.com/search');for(const[k,v]of Object.entries({q:limpo(termo),udm:'14',hl:'pt-BR',gl:'br',pws:'0'}))u.searchParams.set(k,v);return u.href;
}
function iso(valor){
  if(typeof valor!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(valor))falhar('A captura precisa de data e horário UTC completos.');
  const n=Date.parse(valor);if(!Number.isFinite(n)||new Date(n).toISOString()!==valor)falhar('Data da captura inválida.');return n;
}
function arvore(html){
  const root=parse(html),todos=[],pais=new WeakMap(),attrs=new WeakMap(),ocultos=new WeakMap(),pilha=[[root,null,false]];
  while(pilha.length){const[n,p,oculto]=pilha.pop();if(todos.length>=12000)falhar('O trecho contém elementos demais.',413);
    const a=Object.fromEntries((n.attrs||[]).map(x=>[x.name,x.value]));
    const ocultar=oculto||['script','style','template','noscript'].includes(n.tagName)||Object.hasOwn(a,'hidden')||a['aria-hidden']==='true'||/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(a.style||'');
    pais.set(n,p);attrs.set(n,a);ocultos.set(n,ocultar);todos.push(n);for(const c of [...(n.childNodes||[])].reverse())pilha.push([c,n,ocultar]);
  }
  const texto=(n,ignorar=null)=>{const partes=[],p=[n];while(p.length){const x=p.pop();if(x===ignorar||ocultos.get(x))continue;if(x.nodeName==='#text')partes.push(x.value);for(const c of [...(x.childNodes||[])].reverse())p.push(c);}return limpo(partes.join(' '));};
  const ancestrais=n=>{const r=[];for(let p=n;p;p=pais.get(p))r.push(p);return r;};
  return{todos,pais,attrs,ocultos,texto,ancestrais};
}
export function interpretarCapturaGoogle(entrada,{dominio,agora=Date.now}={}){
  if(!objeto(entrada)||Object.keys(entrada).some(k=>!['formato','versao','metodo','url','coletadoEm','dispositivo','localidadeDeclarada','html'].includes(k))||entrada.formato!=='visibilidade-google-local'||entrada.versao!==1||entrada.metodo!=='pagina_aberta')falhar('Use uma captura local no formato Visibilidade Aberta, versão 1.');
  if(typeof entrada.html!=='string'||!entrada.html.trim()||bytes(entrada.html)>49152)falhar('O trecho HTML deve ter até 48 KiB. Nenhum trecho foi truncado.',413);
  if(bytes(JSON.stringify(entrada))>60000)falhar('A captura completa excedeu o limite local de 60.000 bytes.',413);
  if(!['computador','celular','desconhecido'].includes(entrada.dispositivo))falhar('Informe o dispositivo observado.');
  if(entrada.localidadeDeclarada!=null&&(typeof entrada.localidadeDeclarada!=='string'||entrada.localidadeDeclarada.length>100||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(entrada.localidadeDeclarada)))falhar('Localidade declarada inválida.');
  const alvo=normalizarSite(dominio),origem=urlGoogle(entrada.url),instante=iso(entrada.coletadoEm),agoraMs=agora();
  if(!Number.isFinite(agoraMs)||instante>agoraMs+300000)falhar('A data da captura está adiante do relógio local. Confira o horário antes de importar.');
  const a=arvore(entrada.html),texto=a.texto(a.todos[0]),resultados=[],vistos=new Set(),cardsVistos=new Set(),blocosWeb=[],dominiosExibidos=[];let ignorados=0;
  const rso=a.todos.find(n=>a.attrs.get(n)?.id==='rso'&&!a.ocultos.get(n)),textoFora=a.texto(a.todos[0],rso);
  const base={versao:1,parserVersao:2,dominio:alvo,termo:origem.termo,chaveBusca:chaveBuscaGoogle(origem.termo),urlConsulta:origem.url,inicioSolicitado:origem.inicioSolicitado,coletadoEm:entrada.coletadoEm,importadoEm:new Date(agoraMs).toISOString(),sha256Trecho:sha(entrada.html),metodo:'captura_declarada_pagina_aberta',fonteAutenticada:false,posicaoGoogle:null,contexto:{idiomaSolicitado:origem.hl,paisSolicitado:origem.gl,dispositivo:entrada.dispositivo,localidadeDeclarada:entrada.localidadeDeclarada?.trim()||null,personalizacao:'desconhecida',pwsSolicitado:origem.pws,uuleSolicitado:origem.uule},limites:['A captura foi fornecida pelo operador; origem e horário não foram autenticados pelo Google.','A ordem considera links web reconhecidos neste trecho; não é posição universal nem prova de cobertura completa.','País e idioma na URL são parâmetros solicitados. A localização efetiva e a personalização permanecem desconhecidas.','A ausência no trecho não determina posição fora dele. Este módulo não envia consultas ao Google.']};
  const pertence=d=>d===alvo||d.endsWith('.'+alvo);
  const finalizar=(estado,motivo,proximaPagina=null)=>{
    const encontrados=resultados.filter(x=>pertence(x.dominio)),primeiro=encontrados[0];
    const exibidosDoAlvo=dominiosExibidos.filter(x=>pertence(x.dominioExibido)),primeiroExibido=exibidosDoAlvo[0];
    return{...base,estado,motivo,resultados,encontrados,concorrentesAntes:primeiro?resultados.filter(x=>x.ordemNaPagina<primeiro.ordemNaPagina):[],outrosResultados:primeiro?[]:resultados.slice(0,10),ordemNaPagina:primeiro?.ordemNaPagina??null,
      blocosWeb,totalBlocosWeb:blocosWeb.length,blocosSemIdentificacao:blocosWeb.filter(b=>b.identificacao==='desconhecida').length,
      dominiosExibidos,exibidosDoAlvo,ordemDominioExibido:primeiroExibido?.ordemBloco??null,dominiosExibidosAntes:primeiroExibido?dominiosExibidos.filter(x=>x.ordemBloco<primeiroExibido.ordemBloco):[],
      proximaPagina,linksIgnorados:ignorados,totalLinksReconhecidos:resultados.length,atual:agoraMs-instante<=3600000};
  };
  const controleDesafio=a.todos.some(n=>!a.ocultos.get(n)&&!a.ancestrais(n).includes(rso)&&
    (['captcha-form','recaptcha'].includes(a.attrs.get(n)?.id)||Object.hasOwn(a.attrs.get(n)||{},'data-sitekey')));
  if(controleDesafio||!rso&&/(?:unusual traffic|tráfego incomum|trafego incomum|our systems have detected|nossos sistemas detectaram|não sou um robô|i'm not a robot)/iu.test(textoFora))return finalizar('interrompida','A página contém uma verificação ou bloqueio; nenhum resultado foi considerado.');
  if(/(?:before you continue to google|antes de continuar para o google|antes de ir a google)/iu.test(textoFora))return finalizar('consentimento','A página de consentimento não é uma página de resultados.');
  if(!origem.modoWeb)return finalizar('modo_nao_suportado','Use a aba Web do Google. Outros módulos da busca não são classificados por este parser.');
  if(!origem.hl||!/^(?:pt(?:[-_]br)?|en(?:[-_]us)?|es(?:[-_][a-z]{2})?)$/iu.test(origem.hl))return finalizar('contexto_nao_suportado','Abra a busca pelos links do projeto, com idioma explícito português, inglês ou espanhol. Sem idioma suportado não há leitura de ordem.');
  const marcadorCorrecao=a.todos.some(n=>!a.ocultos.get(n)&&!a.ancestrais(n).includes(rso)&&['fprsl','fprs','spell'].includes(a.attrs.get(n)?.id));
  if(marcadorCorrecao||/(?:mostrando resultados (?:para|de)|exibindo resultados para|showing results for|including results for|se muestran resultados (?:de|para))/iu.test(textoFora))return finalizar('consulta_alterada','O Google indicou outra consulta. Esta captura não mede a expressão solicitada.');
  if(!rso)return finalizar('layout_nao_reconhecido','O bloco de resultados web não foi reconhecido; vazio não significa ausência do site.');
  for(const h of a.todos.filter(n=>n.tagName==='h3'&&!a.ocultos.get(n))){
    const ancestrais=a.ancestrais(h);if(!ancestrais.includes(rso))continue;
    if(ancestrais.some(n=>{const x=a.attrs.get(n)||{};return ['tads','tadsb','bottomads','taw','rhs'].includes(x.id)||Object.hasOwn(x,'data-text-ad')||Object.hasOwn(x,'data-ta-slot')||Object.hasOwn(x,'data-q')||/(?:^|\s)(?:uEierd|related-question-pair)(?:\s|$)/u.test(x.class||'')||/^(?:patrocinad[oa]s?|sponsored|ads?|anúncios?)$/iu.test(x['aria-label']||'');})){ignorados++;continue;}
    const card=ancestrais.find(n=>/(?:^|\s)(?:g|tF2Cxc|MjjYud)(?:\s|$)/u.test(a.attrs.get(n)?.class||''));
    const anchor=ancestrais.find(n=>n.tagName==='a');
    if(!card||!anchor||!a.ancestrais(anchor).includes(card)||cardsVistos.has(card)){ignorados++;continue;}
    const areaRotulo=ancestrais.find(n=>/(?:^|\s)MjjYud(?:\s|$)/u.test(a.attrs.get(n)?.class||''))||card;
    const rotuloAnuncio=a.todos.some(n=>['span','div'].includes(n.tagName)&&!a.ocultos.get(n)&&a.ancestrais(n).includes(areaRotulo)&&!ancestrais.includes(n)&&!a.ancestrais(n).includes(h)&&
      !a.ancestrais(n).some(x=>x!==card&&x!==areaRotulo&&/(?:^|\s)(?:g|tF2Cxc)(?:\s|$)/u.test(a.attrs.get(x)?.class||''))&&/^(?:patrocinad[oa]s?|sponsored|anúncios?|anuncios?)$/iu.test(a.texto(n)));
    if(rotuloAnuncio){ignorados++;continue;}
    const href=a.attrs.get(anchor)?.href,titulo=a.texto(h);
    if(!titulo){ignorados++;continue;}
    cardsVistos.add(card);
    const ordemBloco=blocosWeb.length+1,d=destinoGooglePublicado(href,origem.url);
    const bloco={ordemBloco,titulo:titulo.slice(0,300),identificacao:'desconhecida'};
    blocosWeb.push(bloco);
    if(d){
      bloco.identificacao=d.identificacaoDestino;bloco.dominio=d.dominio;
      if(vistos.has(d.url)){ignorados++;continue;}
      vistos.add(d.url);resultados.push({ordemNaPagina:resultados.length+1,ordemBloco,...d,titulo:titulo.slice(0,300),evidencia:{criterio:'primeiro_h3_em_link_de_bloco_web_reconhecido',sha256Trecho:base.sha256Trecho}});
    }else{
      ignorados++;
      if(redirecionamentoGoogleSemDestino(href,origem.url)){
        const citas=a.todos.filter(n=>n.tagName==='cite'&&!a.ocultos.get(n)&&a.ancestrais(n).includes(anchor));
        const exibido=citas.length===1?dominioExibidoGoogle(a.texto(citas[0])):null;
        if(exibido){
          bloco.identificacao='dominio_exibido_sem_destino';bloco.dominioExibido=exibido.dominioExibido;
          dominiosExibidos.push({ordemBloco,titulo:titulo.slice(0,300),...exibido,evidencia:{criterio:'cite_unico_no_mesmo_link_do_titulo_com_redirecionamento_google',sha256Trecho:base.sha256Trecho}});
        }
      }
    }
    if(blocosWeb.length>=30)break;
  }

  let proxima=null;
  const linkProximo=a.todos.find(n=>a.attrs.get(n)?.id==='pnnext'&&!a.ocultos.get(n));
  if(linkProximo)try{const p=urlGoogle(new URL(a.attrs.get(linkProximo).href,origem.url).href,{proxima:true});if(p.modoWeb&&p.termo===origem.termo&&p.inicioSolicitado>origem.inicioSolicitado&&p.hl===origem.hl&&p.gl===origem.gl&&p.pws===origem.pws&&p.uule===origem.uule)proxima=p.url;}catch{/* Sem próximo endereço verificável. */}
  if(!resultados.length&&dominiosExibidos.length)return finalizar('dominios_exibidos','Domínios lidos nas citações dos blocos web; os destinos dos links permanecem desconhecidos. A ordem dos blocos não é uma posição absoluta no Google.',proxima);
  if(!resultados.length)return finalizar(/(?:nenhum resultado|não encontrou|did not match any documents|no results found)/iu.test(texto)?'sem_resultados_explicitos':'layout_nao_reconhecido','Nenhum link web foi reconhecido. Não atribua posição zero nem ausência global.');
  return finalizar(ignorados?'parcial':'capturada','Ordem dos links web reconhecidos na página fornecida; a completude depende do layout e da captura.',proxima);
}
export function resumirCapturasGoogle(capturas,{dominio,candidatos=[],agora=Date.now}={}){
  const alvo=normalizarSite(dominio),termos=new Set(candidatos.map(c=>chaveBuscaGoogle(c.termo))),lista=Array.isArray(capturas)?capturas:[];
  const validas=lista.filter(c=>c&&c.versao===1&&c.dominio===alvo&&c.metodo==='captura_declarada_pagina_aberta').map(c=>{
    const atual=Number.isFinite(Date.parse(c.coletadoEm))&&agora()-Date.parse(c.coletadoEm)>=-300000&&agora()-Date.parse(c.coletadoEm)<=3600000;
    if(c.parserVersao!==2)return{...c,estado:'reinterpretacao_necessaria',atual:false,resultados:[],encontrados:[],concorrentesAntes:[],outrosResultados:[],ordemNaPagina:null,posicaoGoogle:null,proximaPagina:null,totalLinksReconhecidos:null,blocosWeb:[],totalBlocosWeb:null,blocosSemIdentificacao:null,dominiosExibidos:[],exibidosDoAlvo:[],ordemDominioExibido:null,dominiosExibidosAntes:[],termoNaSelecao:termos.has(c.chaveBusca),motivo:'A versão da interpretação mudou ou não foi registrada. Reimporte o arquivo preservado; a data de coleta será mantida.'};
    return{...c,atual,termoNaSelecao:termos.has(c.chaveBusca)};
  });
  const fila=candidatos.slice(0,100).map(c=>{
    const anteriores=validas.filter(v=>v.chaveBusca===chaveBuscaGoogle(c.termo)).sort((a,b)=>Date.parse(b.coletadoEm)-Date.parse(a.coletadoEm));
    const ultima=anteriores[0];
    return{termo:c.termo,url:criarLinkGoogle(c.termo),estado:!ultima?'sem_captura':!ultima.atual?'historica':['capturada','parcial'].includes(ultima.estado)&&ultima.totalLinksReconhecidos>0?'links_reconhecidos':ultima.estado==='dominios_exibidos'&&ultima.dominiosExibidos?.length?'dominios_exibidos':'requer_conferencia',ultimaCapturaId:ultima?.capturaId||null,ultimaCapturaEm:ultima?.coletadoEm||null};
  });
  return{versao:1,modo:'capturas_locais_declaradas',posicaoGoogle:null,capturas:validas,sequencias:organizarSequenciasGoogle(validas),fila,limite:'Capturas locais são uma evidência separada das medições da fonte de posições. Não alimentam automaticamente decisões de verba ou o treinamento.'};
}
