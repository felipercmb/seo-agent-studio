import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {coletarSite} from '../src/coleta.mjs';
import {normalizarSite} from '../src/consulta.mjs';
import {fetchPublico} from '../lib/rede-publica.mjs';
import {carregarCapturaLocal} from '../ia/negocio/capturas.mjs';
import {prepararRelacoes} from '../ia/negocio/relacoes/preparar.mjs';

const raiz=fileURLToPath(new URL('../',import.meta.url));
function executar(cmd,args){return new Promise((ok,erro)=>{
  const processo=spawn(cmd,args,{cwd:raiz,stdio:'inherit',env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
  processo.once('error',erro);processo.once('exit',code=>code===0?ok():erro(Error('Processo terminou com código '+code)));
});}

export function argumentos(args){
  const config={};
  for(let i=0;i<args.length;i++){
    if(!['--site','--captura','--saida','--python','--modelo-base'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw Error('Use --site DOMINIO ou --captura ARQUIVO, --saida PASTA_NOVA; --python e --modelo-base são opcionais.');
    const k=args[i].slice(2);if(k in config)throw Error('Argumento duplicado.');config[k]=args[++i];
  }
  if(!config.saida||Boolean(config.site)===Boolean(config.captura))throw Error('Informe exatamente site ou captura e uma pasta nova de saída.');
  if(config.site)config.site=normalizarSite(config.site);
  if(config['modelo-base']&&!['qwen3-4b','qwen35-4b'].includes(config['modelo-base']))throw Error('Modelo fora do registro local.');
  return config;
}

export async function analisarRelacoes(config){
  const destino=resolve(config.saida);
  // No existing destination can be reused or overwritten.
  await mkdir(dirname(destino),{recursive:true,mode:0o700});
  await mkdir(destino,{mode:0o700});
  let arquivo;
  if(config.captura)arquivo=resolve(config.captura);
  else{
    const coleta=await coletarSite(config.site,{objetivo:'descoberta',limiteRequisicoes:24,tempoTotalMs:20000,fetch:fetchPublico});
    arquivo=join(destino,'captura.json');await writeFile(arquivo,JSON.stringify(coleta,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  const c=carregarCapturaLocal(arquivo),r=prepararRelacoes(c.coleta);r.captura={...c.captura,arquivo};
  const contexto=join(destino,'contexto.json');await writeFile(contexto,JSON.stringify(r,null,2)+'\n',{flag:'wx',mode:0o600});
  const python=resolve(config.python||join(raiz,'.venv-ia/bin/python'));
  const resultado=join(destino,'relacoes.json');
  await executar(python,['-B','ia/negocio/relacoes/executar.py','--contextos',contexto,'--saida',resultado,
    '--modelo-base',config['modelo-base']||'qwen35-4b']);
  await executar(python,['-B','ia/negocio/relacoes/relatorio.py',resultado,join(destino,'REVISAO.md')]);
  await writeFile(join(destino,'manifesto.json'),JSON.stringify({versao:1,criadoEm:new Date().toISOString(),
    contextoSha256:createHash('sha256').update(await readFile(contexto)).digest('hex'),
    resultadoSha256:createHash('sha256').update(await readFile(resultado)).digest('hex'),
    modo:'experimental_local',modeloPadraoAlterado:false,publicado:false},null,2)+'\n',{flag:'wx',mode:0o600});
  return destino;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  if(process.argv.includes('--help'))console.log('node scripts/analisar-relacoes.mjs --site DOMINIO --saida PASTA_NOVA\nRepetir offline: --captura ARQUIVO em vez de --site. Requer o ambiente MLX e os pesos locais; não instala nem chama API de IA.');
  else try{console.log('Análise salva em '+await analisarRelacoes(argumentos(process.argv.slice(2))));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
