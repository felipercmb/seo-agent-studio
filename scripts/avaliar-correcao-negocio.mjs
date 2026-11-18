import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {avaliarNegocioUtilidade} from './avaliar-negocio-utilidade.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const lista=v=>Array.isArray(v)?v:[];

/** Windows describe the product's actual ordering, not usefulness. The legacy
 * compatibility branch retains old attempted business tasks in the denominator. */
export function extrairJanelasUtilidade(etapa) {
  const o=etapa?.oportunidades||{},fila=lista(o.planoDeAcao);
  const dedicada=Array.isArray(o.planoNegocio);
  const negocio=dedicada?o.planoNegocio:fila.filter(t=>t.tipo==='conferir_oferta');
  const posicao=t=>{const i=fila.findIndex(f=>f===t||(t.id&&f.id===t.id));return i<0?null:i+1;};
  const item=t=>({posicaoFilaGeral:posicao(t),tarefa:t});
  return {geral:fila.slice(0,3).map(item),negocio:negocio.slice(0,3).map(item),
    totalGeral:fila.length,totalNegocioProposto:negocio.length,
    origemFilaNegocio:dedicada?'planoNegocio_do_produto':'compatibilidade_legada_tipo_conferir_oferta',
    limite:'Fila/categoria/objeto decisaoCliente não recebe crédito automático. Aplicar U1-U4 semanticamente; até três tarefas por janela, dependentes da mesma organização.'};
}

export async function avaliarCorrecaoNegocio(opcoes) {
  const resultado=await avaliarNegocioUtilidade(opcoes);
  for(const r of resultado.resultados)for(const etapa of ['rascunho','condicional']){
    r[etapa].janelasUtilidade=extrairJanelasUtilidade(r[etapa]);
    r[etapa].paraRevisao.primeirasTarefasNegocio=r[etapa].janelasUtilidade.negocio;
  }
  resultado.versaoAvaliadorCorrecao=1;
  resultado.denominadores.negocio={
    organizacoes:resultado.denominadores.organizacoesSolicitadas,
    semTarefaProposta:resultado.resultados.filter(r=>r.condicional.janelasUtilidade.totalNegocioProposto===0).length,
    tarefasNaJanela:resultado.resultados.reduce((n,r)=>n+r.condicional.janelasUtilidade.negocio.length,0),
    limite:'Contagens de propostas; somente adjudicação semântica mede utilidade. Empresas sem proposta continuam no denominador.'};
  return resultado;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),o={};
 for(let i=0;i<args.length;i+=2){if(!['--raiz','--dados','--rotulos','--splits','--saida'].includes(args[i])||!args[i+1]||Object.hasOwn(o,args[i]))throw Error('Argumentos inválidos.');o[args[i]]=args[i+1];}
 if(!o['--rotulos']||!o['--splits']||!o['--saida'])throw Error('Informe rótulos, splits e saída nova.');
 const b=await readFile(resolve(o['--rotulos']));
 const r=await avaliarCorrecaoNegocio({raiz:o['--raiz']||process.cwd(),raizDados:o['--dados']||dirname(resolve(o['--rotulos'])),corpus:JSON.parse(b),splits:o['--splits'].split(',')});
 r.rotulosSha256=hash(b);r.avaliadorCorrecaoSha256=hash(await readFile(new URL(import.meta.url)));
 r.avaliadorBaseSha256=hash(await readFile(new URL('./avaliar-negocio-utilidade.mjs',import.meta.url)));
 await writeFile(resolve(o['--saida']),JSON.stringify(r,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(r.denominadores));
}
