import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {carregarCapturaLocal} from '../capturas.mjs';
import {prepararJornadas} from './preparar-v5.mjs';
export {prepararJornadas};
export {prepararJornadas as prepararJornadasExperimentalV6} from './preparar-v6.mjs';
const serial=v=>JSON.stringify(v),hash=v=>createHash('sha256').update(v).digest('hex');

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [captura,saida]=process.argv.slice(2);
  if(!captura||!saida)throw Error('Uso: node ia/negocio/jornadas/preparar.mjs CAPTURA SAIDA_NOVA');
  const carregada=carregarCapturaLocal(resolve(captura));
  const resultado=prepararJornadas(carregada.coleta);
  resultado.captura={...carregada.captura,arquivo:resolve(captura)};
  resultado.codigoSha256={preparador:hash(await readFile(new URL(import.meta.url))),seletorV5:hash(await readFile(new URL('./preparar-v5.mjs',import.meta.url))),exportador:hash(await readFile(new URL('../fontes-v5.mjs',import.meta.url))),baseV4:hash(await readFile(new URL('../fontes-v4.mjs',import.meta.url))),contextoPublico:hash(await readFile(new URL('../../../src/modulos/contexto-publico.mjs',import.meta.url))),perguntasPublicadas:hash(await readFile(new URL('../../../src/modulos/perguntas-publicadas.mjs',import.meta.url)))};
  await writeFile(resolve(saida),serial(resultado)+'\n',{flag:'wx',mode:0o600});
}
