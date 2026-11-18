import {normalizarSite} from './consulta.mjs';

const GOOGLE=new Set(['google.com','www.google.com','google.com.br','www.google.com.br']);
const publicidade=h=>/(?:^|\.)(?:googleadservices\.com|doubleclick\.net|doubleclick\.com|googlesyndication\.com)$/iu.test(h)||h==='adservice.google.com';

/** A published URL is not a visited or authenticated destination. Never follows a redirect. */
export function destinoGooglePublicado(valor,base){
  let u;try{u=new URL(valor,base);}catch{return null;}
  let identificacao='url_publicada';
  if(GOOGLE.has(u.hostname)&&['/url','/goto'].includes(u.pathname)){
    if(u.protocol!=='https:'||u.port||u.username||u.password)return null;
    const qs=u.searchParams.getAll('q'),urls=u.searchParams.getAll('url');
    if(qs.length+urls.length!==1)return null;
    try{u=new URL(qs[0]||urls[0]);}catch{return null;}
    identificacao='destino_explicito_no_link';
  }
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||GOOGLE.has(u.hostname)||publicidade(u.hostname))return null;
  let dominio;try{dominio=normalizarSite(u.href);}catch{return null;}
  u.hash='';return{url:u.href,dominio,identificacaoDestino:identificacao};
}

/** This only reads the single URL-like citation displayed in a result card.
 * The path, target URL, ownership and navigation are deliberately unknown.
 */
export function dominioExibidoGoogle(valor){
  if(typeof valor!=='string'||valor.length>800||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(valor))return null;
  const literal=valor.replace(/\s+/gu,' ').trim();
  const m=/^https?:\/\/([^\s/\?#]+)(?:[/\s\?#]|$)/iu.exec(literal);
  if(!m||/[\u0080-\uFFFF@:%]/u.test(m[1])||m[1].includes('..')||/[.…]/u.test(m[1].slice(-1)))return null;
  let u;try{u=new URL('https://'+m[1]);}catch{return null;}
  if(u.port||u.username||u.password||GOOGLE.has(u.hostname)||publicidade(u.hostname))return null;
  let dominio;try{dominio=normalizarSite(u.href);}catch{return null;}
  return{dominioExibido:dominio,citacaoLiteral:literal,urlDestino:null,identificacao:'dominio_exibido_sem_destino'};
}

export function redirecionamentoGoogleSemDestino(valor,base){
  try{
    const u=new URL(valor,base);
    if(u.protocol!=='https:'||!GOOGLE.has(u.hostname)||u.username||u.password||u.port||!['/url','/goto'].includes(u.pathname)||destinoGooglePublicado(valor,base))return false;
    const vs=[...u.searchParams.getAll('q'),...u.searchParams.getAll('url')];
    if(vs.length>1)return false;
    if(!vs.length)return true; // Historical captures already removed opaque tokens.
    if(!vs[0].trim()||vs[0].length>4096||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(vs[0]))return false;
    try{new URL(vs[0]);return false;}catch{return true;} // Only an opaque value, never an explicit unsafe destination.
  }catch{return false;}
}
