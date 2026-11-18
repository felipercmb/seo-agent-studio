import {ErroConsulta} from '../consulta.mjs';

export const TIPOS_OFERTA=Object.freeze(['software','servico','produto','indefinido']);
export const PAPEIS_ORGANIZACAO=Object.freeze(['disponibiliza','executa','vende','intermedeia','indefinido']);

/** Optional owner declaration for this offer, never a classification of the
 * entire company or evidence of who carries out the customer's activity. */
export function normalizarEntregaOferta(entrada){
  if(entrada===null)return null;
  if(!entrada||typeof entrada!=='object'||Array.isArray(entrada)||
      Object.keys(entrada).some(k=>!['tipoOferta','papelOrganizacao'].includes(k))||
      !TIPOS_OFERTA.includes(entrada.tipoOferta)||!PAPEIS_ORGANIZACAO.includes(entrada.papelOrganizacao))
    throw new ErroConsulta('Informe o tipo desta oferta e o papel da organização, ou mantenha ambos como não definidos.');
  return {versao:1,origem:'declaracao_usuario',tipoOferta:entrada.tipoOferta,papelOrganizacao:entrada.papelOrganizacao};
}
