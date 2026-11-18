import {extrairFontesNegocio as extrairV5} from './fontes-v5.mjs';
import {classificarDocumentoPublico} from '../../src/modulos/documentos-publicos.mjs';
/** Keep all V5 texts and IDs; only documentary context gains an explicit derivation. */
export function extrairFontesNegocio(coleta={},opcoes={}){
 const anterior=extrairV5(coleta,opcoes),classificacoes=[];
 const fontes=anterior.fontes.map(f=>{const documento=classificarDocumentoPublico(f.contexto);classificacoes.push({id:f.id,url:f.url,...documento});
  return{...f,contexto:{...f.contexto,classePagina:documento.classe},classificacaoDocumento:documento};});
 return{...anterior,versao:6,fontes,classificacoesDocumentais:classificacoes,
  limites:[...anterior.limites,'Classificação documental por caminho/título é uma heurística de recuperação. Política e artigo permanecem integrais no pool; não são descartados nem promovidos a operação da oferta.']};
}
