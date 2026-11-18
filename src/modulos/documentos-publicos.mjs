const normal=v=>String(v||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/gu,' ').trim();
const editorial=/(?:^|\/)(?:blog|post|posts|artigos|noticias|news|journal|insights|cases|cases-de-sucesso)(?:\/|$)/u;
const politica=/(?:^|\/)(?:politica(?:-de)?-(?:privacidade|cookies?|reembolso|cancelamento|compra)|privacy(?:-policy)?|termos(?:-de-(?:uso|servico|contratacao|adesao)|-uso|-e-condicoes|-comerciais)?|terms(?:-of-(?:use|service))?|refund(?:-policy)?|reembolso|devolucoes|condicoes-gerais|cookies?)(?:\/|$)/u;
export function textoPadraoDeConsentimento(texto){
 const n=normal(texto);
 return /^o armazenamento (?:ou acesso tecnico|tecnico ou acesso) (?:e|que e|que)\b/u.test(n)&&
  /\b(?:finalidade legitima|proposito legitimo|fins estatisticos|fim geralmente|exclusivamente para fins)\b/u.test(n);
}
/** Documentary routing only. A policy may contain relevant conditions, and
 * a product may be mentioned inside an article; neither proves its operation. */
export function classificarDocumentoPublico({url,tituloPagina,classePagina}={}){
 let path='';try{const u=new URL(url);path=normal(decodeURIComponent(u.pathname));}catch{/* Preserve the previous declaration if URL is unusable. */}
 const previous=['institucional','editorial','politica','nao_determinada'].includes(classePagina)?classePagina:'nao_determinada';
 const title=normal(tituloPagina);
 const result=editorial.test(path)?['editorial','caminho_editorial_explicito']
  :politica.test(path)?['politica','caminho_documental_explicito']
  :/^(?:politica de (?:privacidade|cookies?|reembolso|cancelamento)|privacy policy|refund policy|termos de uso|terms (?:of use|of service)|condicoes gerais)(?:\b|$)/u.test(title)?['politica','titulo_documental_explicito']
  :[previous,'classe_anterior_ou_nao_determinada'];
 return{versao:2,classe:result[0],motivo:result[1],classeAnterior:previous,natureza:'heuristica_documental',finalidadeOuPapelConfirmado:false};
}
