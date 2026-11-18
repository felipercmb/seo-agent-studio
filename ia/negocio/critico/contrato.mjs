/** Crítico experimental: valida estrutura e vínculos, nunca decide verdade. */
import {validarSaidaRecomendacao} from '../recomendacoes/validar.mjs';

export const TIPOS_PROBLEMA=Object.freeze([
  'condicao_alterada','escopo_incorreto','ator_ou_papel_trocado',
  'alegacao_como_resultado','verificacao_inviavel','diagnostico_sem_evidencia',
]);
export const DEFINICOES_PROBLEMA=Object.freeze({
  condicao_alterada:'Inverte, nega ou reduz requisito, prazo, limite ou dependência publicados.',
  escopo_incorreto:'Transfere uma condição para outra oferta, público ou contexto sem suporte.',
  ator_ou_papel_trocado:'Troca contratante/prestador, execução própria/intermediação ou infere papel só por parceria/integração.',
  alegacao_como_resultado:'Transforma publicidade, promessa ou alegação atribuída em observação/garantia não fornecida.',
  verificacao_inviavel:'Exige transação real ou acesso/dados não fornecidos, em vez de conferência ou simulação disponível.',
  diagnostico_sem_evidencia:'Afirma ausência/defeito sem observação que o sustente, inclusive quando a fonte já traz a informação.',
});
const objeto=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exato=(v,ks)=>objeto(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const texto=(v,max)=>typeof v==='string'&&v.trim().length>0&&[...v].length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);
const perfilVazio={papel:'indefinido',finalidade:'indefinida',ofertas:[],publicos:[],atuacoes:[],condicoes:[]};

export function textosDaProposta(proposta){
  const textos=[];
  if(!objeto(proposta))return textos;
  for(const k of ['decisao','acao','verificar'])if(typeof proposta[k]==='string')textos.push({caminho:k,texto:proposta[k]});
  for(const k of ['alternativas','criterios'])if(Array.isArray(proposta[k]))for(const [i,item]of proposta[k].entries())
    for(const nome of ['texto','escopo'])if(typeof item?.[nome]==='string')textos.push({caminho:`${k}[${i}].${nome}`,texto:item[nome]});
  if(Array.isArray(proposta.incertezas))for(const [i,t]of proposta.incertezas.entries())if(typeof t==='string')textos.push({caminho:`incertezas[${i}]`,texto:t});
  return textos;
}

export function validarEntradaCritica(entrada){
  const erros=[];
  if(!exato(entrada,['tarefa','fontes','proposta'])||entrada.tarefa!=='criticar')return{valido:false,erros:['entrada_invalida']};
  const r=validarSaidaRecomendacao(entrada.proposta,{tarefa:'recomendar',perfil:perfilVazio,fontes:entrada.fontes});
  if(!r.valido)erros.push(...r.erros.map(e=>'proposta_canonica:'+e));
  return{valido:erros.length===0,erros};
}

export function validarSaidaCritica(saida,entrada){
  const erros=[...validarEntradaCritica(entrada).erros],localizacoes=[];
  if(!exato(saida,['estado','problemas']))return{valido:false,erros:[...erros,'chaves_saida_invalidas'],localizacoes};
  if(!['manter','revisar'].includes(saida.estado))erros.push('estado_invalido');
  if(!Array.isArray(saida.problemas)||saida.problemas.length>4)return{valido:false,erros:[...erros,'problemas_invalidos'],localizacoes};
  if(saida.estado==='manter'&&saida.problemas.length)erros.push('manter_com_problemas');
  if(saida.estado==='revisar'&&!saida.problemas.length)erros.push('revisar_sem_problema');
  const fontes=new Set(Array.isArray(entrada?.fontes)?entrada.fontes.map(f=>f.id):[]),campos=textosDaProposta(entrada?.proposta);
  for(const [i,p]of saida.problemas.entries()){
    if(!exato(p,['tipo','trechoPropostaLiteral','fontes','explicacao'])){erros.push(`problema_${i}:chaves_invalidas`);continue;}
    if(!TIPOS_PROBLEMA.includes(p.tipo))erros.push(`problema_${i}:tipo_invalido`);
    if(!texto(p.trechoPropostaLiteral,420))erros.push(`problema_${i}:trecho_invalido`);
    const locais=typeof p.trechoPropostaLiteral==='string'&&p.trechoPropostaLiteral?campos.filter(c=>c.texto.includes(p.trechoPropostaLiteral)):[];
    if(!locais.length)erros.push(`problema_${i}:trecho_nao_literal_em_um_campo`);
    localizacoes.push({indice:i,caminhos:locais.map(l=>l.caminho)});
    if(!Array.isArray(p.fontes)||!p.fontes.length||p.fontes.length>16||new Set(p.fontes).size!==p.fontes.length||p.fontes.some(f=>typeof f!=='string'||!fontes.has(f)))erros.push(`problema_${i}:fontes_invalidas`);
    if(!texto(p.explicacao,360))erros.push(`problema_${i}:explicacao_invalida`);
  }
  return{valido:erros.length===0,erros,localizacoes,limite:'Só estrutura, referência existente e trecho literal; não aprova pertinência, verdade, utilidade ou uso com clientes.'};
}
