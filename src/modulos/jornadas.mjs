import {ErroConsulta} from '../consulta.mjs';
const CAMPOS=['comprador','executor','beneficiario','pagador','objetivo'];
const limpar=v=>v.replace(/\s+/gu,' ').trim();

/** Explicit business-owner declarations, never silently labelled observations. */
export function normalizarJornada(entrada){
  if(!entrada||typeof entrada!=='object'||Array.isArray(entrada)||Object.keys(entrada).some(k=>!CAMPOS.includes(k)))
    throw new ErroConsulta('A jornada aceita comprador, executor, beneficiário, pagador e objetivo.');
  const resultado={versao:1,natureza:'declaracao_usuario'};
  for(const c of CAMPOS){
    const v=entrada[c]??'';
    if(typeof v!=='string'||v.length>500||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(v))
      throw new ErroConsulta('Descreva cada parte da jornada em até500caracteres.');
    resultado[c]=limpar(v);
  }
  return resultado;
}

export function camposJornada(jornada){
  return Object.fromEntries(CAMPOS.map(c=>[c,typeof jornada?.[c]==='string'?jornada[c]:'']));
}

export function compararJornada(antes,depois){
  return CAMPOS.filter(c=>(antes?.[c]||'')!==(depois?.[c]||'')).map(c=>({campo:c,antes:antes?.[c]||'',depois:depois?.[c]||''}));
}
