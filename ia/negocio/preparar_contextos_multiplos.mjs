import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {projetarContextos} from './preparar_contextos.mjs';
import {recuperarFontesNegocio} from './recuperacao.mjs';

const LISTAS=['ofertas','publicos','atuacoes','condicoes'];
export function adicionarPassadas(casos,{recuperar=recuperarFontesNegocio,maxCaracteres=6000}={}){
  return casos.map(c=>{
    const contextosExtrasPorCampo={};
    for(const campo of LISTAS){
      const ids=new Set(c.contextosPorCampo[campo].fontes.map(f=>f.id));
      const restante={...c.pool,fontes:c.pool.fontes.filter(f=>!ids.has(f.id))};
      contextosExtrasPorCampo[campo]=[recuperar(restante,{campo,maxCaracteres})];
    }
    return {...c,contextosExtrasPorCampo};
  });
}
async function main(){
  const a={};for(let i=2;i<process.argv.length;i+=2){if(!['--corpus','--saida','--max-caracteres','--exportador'].includes(process.argv[i])||!process.argv[i+1])throw Error('Argumento inválido.');a[process.argv[i]]=process.argv[i+1];}
  if(!a['--corpus']||!a['--saida']||fs.existsSync(a['--saida']))throw Error('Corpus e saída nova são necessários.');
  const maxCaracteres=Number(a['--max-caracteres']||6000),b=fs.readFileSync(a['--corpus']),d=JSON.parse(b);
  const exportador=a['--exportador']||'v1';if(!['v1','v2'].includes(exportador))throw Error('Exportador inválido.');
  const extrair=(await import(exportador==='v1'?'./fontes.mjs':'./fontes-v2.mjs')).extrairFontesNegocio;
  const casos=adicionarPassadas(projetarContextos(d.casos,{maxCaracteres,extrair}),{maxCaracteres});
  const hash=b=>createHash('sha256').update(b).digest('hex');
  const codigo=Object.fromEntries(['preparar_contextos_multiplos.mjs','preparar_contextos.mjs','capturas.mjs',exportador==='v1'?'fontes.mjs':'fontes-v2.mjs','recuperacao.mjs'].map(n=>[n,hash(fs.readFileSync(new URL(n,import.meta.url)))]));
  const r={versao:1,modo:'end_to_end',geradoEm:new Date().toISOString(),fonte:{arquivo:path.resolve(a['--corpus']),sha256:hash(b)},
    politica:'Duas passadas disjuntas nos quatro campos de lista; categorias em uma passada. Não recebe alvos no recuperador.',
    codigo,recuperador:'v1',exportador,maxCaracteres,elegivelTreinoExperimental:false,casos};
  fs.mkdirSync(path.dirname(a['--saida']),{recursive:true});fs.writeFileSync(a['--saida'],JSON.stringify(r,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({organizacoes:casos.length,passadasListas:2,codigo}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
