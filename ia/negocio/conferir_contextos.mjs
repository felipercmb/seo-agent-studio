/** Rebuild the source pool from the saved capture before trusting an EE file. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {carregarCapturaLocal} from './capturas.mjs';
import {extrairFontesNegocio} from './fontes.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const CAMPOS=['papel','finalidade','ofertas','publicos','atuacoes','condicoes','recomendar'];
export function conferirContextos(d,{carregar=carregarCapturaLocal,extrair=extrairFontesNegocio}={}) {
  if(d?.modo!=='end_to_end'||!Array.isArray(d.casos)||!d.casos.length)throw Error('Lote EE vazio ou inválido.');
  const resultados=[],ids=new Set(),dominios=new Set();
  for(const c of d.casos){
    if(ids.has(c.id)||dominios.has(c.dominio))throw Error('Organização repetida no lote.');ids.add(c.id);dominios.add(c.dominio);
    const {captura,coleta}=carregar(c.captura.arquivo);
    if(captura.sha256!==c.captura.sha256)throw Error('Hash da captura alterado: '+c.id);
    const pool=extrair(coleta,{maxFontes:240});
    if(pool.dominio!==c.dominio||!isDeepStrictEqual(pool,c.pool))throw Error('Pool difere da captura local: '+c.id);
    const fontes=new Map(pool.fontes.map(f=>[f.id,f]));
    for(const campo of CAMPOS){
      const contextos=[c.contextosPorCampo?.[campo],...(c.contextosExtrasPorCampo?.[campo]||[])];
      for(const contexto of contextos){
        if(contexto?.campo!==campo||!Array.isArray(contexto.fontes)||contexto.fontes.length>16)throw Error('Contexto de campo inválido: '+c.id);
        const vistos=new Set();
        for(const f of contexto.fontes){
          if(vistos.has(f.id)||!isDeepStrictEqual(fontes.get(f.id),f))throw Error('Fonte/metadados fora da captura: '+c.id+' '+campo);
          vistos.add(f.id);
        }
      }
    }
    resultados.push({id:c.id,dominio:c.dominio,capturaSha256:captura.sha256,fontes:pool.fontes.length,paginas:pool.paginas.length});
  }
  return {versao:1,verificado:true,organizacoes:resultados.length,resultados};
}
async function main(){
  if(process.argv.length!==3)throw Error('Uso: node ia/negocio/conferir_contextos.mjs arquivo-contextos.json');
  const arquivo=process.argv[2],bruto=fs.readFileSync(arquivo),d=JSON.parse(bruto);
  const exportador=d.exportador||'v1';if(!['v1','v2'].includes(exportador))throw Error('Exportador não reconhecido.');
  const nomeFontes=exportador==='v1'?'fontes.mjs':'fontes-v2.mjs';
  for(const nome of ['capturas.mjs',nomeFontes])if(d.codigo?.[nome]!==sha(fs.readFileSync(new URL(nome,import.meta.url))))throw Error('Versão do exportador mudou; use o código congelado correspondente.');
  const extrair=exportador==='v1'?extrairFontesNegocio:(await import('./fontes-v2.mjs')).extrairFontesNegocio;
  const r=conferirContextos(d,{extrair});r.exportador=exportador;r.contextosSha256=sha(bruto);r.verificadorSha256=sha(fs.readFileSync(new URL(import.meta.url)));
  console.log(JSON.stringify(r));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
