/** Projeta capturas públicas locais em entradas de avaliação, sem rede ou treino. */
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';

const sha = dados => createHash('sha256').update(dados).digest('hex');

export async function lerCapturaLocal(pasta) {
  const registroPath = join(pasta,'registro.json');
  const registroBytes = await readFile(registroPath);
  const registro = JSON.parse(registroBytes);
  if (registro.versao !== 1 || typeof registro.dominio !== 'string' || !Array.isArray(registro.arquivos) ||
      registro.arquivos.length>12 || new Set(registro.arquivos.map(p=>p.arquivo)).size!==registro.arquivos.length) throw new Error('Registro de captura incompatível ou fora dos limites.');
  const paginas = [];
  for (const meta of registro.arquivos) {
    if (!/^pagina-\d{2}\.html$/.test(meta.arquivo)) throw new Error('Nome de captura inválido.');
    const arquivo = join(pasta,meta.arquivo);
    if ((await stat(arquivo)).size > 1024*1024) throw new Error('Captura acima do limite.');
    const bytes = await readFile(arquivo);
    if (sha(bytes) !== meta.sha256_utf8_local) throw new Error('A captura não confere com o hash registrado.');
    paginas.push({url:meta.url, html:bytes.toString('utf8'), status:meta.status, coletadoEm:meta.coletadoEm,
      sha256:meta.sha256_utf8_local, ...(meta.cabecalhoRobots ? {cabecalhoRobots:meta.cabecalhoRobots} : {})});
  }
  return {coleta:{dominio:registro.dominio,coletadoEm:registro.coletadoEm,paginas,falhas:registro.falhas || []},
    origem:{registro:registroPath,sha256Registro:sha(registroBytes),splitHistorico:registro.split,
      paginas:registro.arquivos.map(p => ({url:p.url,sha256:p.sha256_utf8_local,coletadoEm:p.coletadoEm}))}};
}

export async function prepararCapturaIA(pasta, {raiz=process.cwd(), agora=Date.now}={}) {
  const {coleta,origem} = await lerCapturaLocal(resolve(pasta));
  const carregar = nome => import(pathToFileURL(resolve(raiz,nome)).href);
  const [{analisarPaginas},{descobrirTermos},{inferirPerfil},{gerarPalavras},{prepararIAProjeto}] = await Promise.all([
    carregar('src/analise.mjs'),carregar('src/descoberta.mjs'),carregar('src/modulos/perfil.mjs'),
    carregar('src/modulos/palavras.mjs'),carregar('src/modulos/ia.mjs')]);
  const descoberta=descobrirTermos(coleta),diagnostico=analisarPaginas(coleta);
  let contextoPublico;
  try {const modulo=await carregar('src/modulos/contexto-publico.mjs');contextoPublico=modulo.extrairContextoPublico(coleta);} catch(erro) {if(erro.code!=='ERR_MODULE_NOT_FOUND')throw erro;}
  const perfil=inferirPerfil({...coleta,descoberta,contextoPublico});
  const palavras=gerarPalavras({perfil,descoberta,contextoPublico});
  const projeto={versao:1,dominio:coleta.dominio,coletadoEm:coleta.coletadoEm,descoberta,diagnostico,perfil,palavras,
    posicoes:null,capacidades:{posicoes:{configurada:false},demanda:{configurada:false}}};
  return {versao:1,natureza:'entrada derivada de HTML público real; sem confirmação comercial pela empresa',origem,
    projeto,entrada:prepararIAProjeto(projeto,{agora})};
}

async function main() {
  const args=process.argv.slice(2),opcoes={};
  for(let i=0;i<args.length;i+=2){if(!['--plano','--saida','--raiz'].includes(args[i]) || !args[i+1] || opcoes[args[i]])throw new Error('Argumentos inválidos.');opcoes[args[i]]=args[i+1];}
  if(!opcoes['--plano'] || !opcoes['--saida'])throw new Error('Informe --plano e --saida.');
  const planoBytes=await readFile(resolve(opcoes['--plano'])),plano=JSON.parse(planoBytes);
  if(plano.versao!==1 || !Number.isFinite(Date.parse(plano.relogioReferencia)) || !Array.isArray(plano.capturas) || plano.capturas.length>20)throw new Error('Plano inválido.');
  const resultados=[];
  for(const c of plano.capturas){if(typeof c.pasta!=='string' || !['development','validation','holdout'].includes(c.split))throw new Error('Captura sem pasta ou divisão.');
    resultados.push({...await prepararCapturaIA(c.pasta,{raiz:opcoes['--raiz'] || process.cwd(),agora:()=>Date.parse(plano.relogioReferencia)}),split:c.split});}
  const saida=resolve(opcoes['--saida']);await mkdir(dirname(saida),{recursive:true,mode:0o700});
  await writeFile(saida,JSON.stringify({versao:1,relogioReferencia:plano.relogioReferencia,planoSha256:sha(planoBytes),resultados},null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({capturas:resultados.length,paginas:resultados.reduce((n,r)=>n+r.origem.paginas.length,0),contextos:resultados.reduce((n,r)=>n+r.entrada.entrada.entradas.length,0)}));
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
