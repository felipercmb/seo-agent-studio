/** Reavalia HTML guardado, sem acessar a rede ou alterar a coleta original. */
import {readFile, open, realpath} from 'node:fs/promises';
import {resolve, join, dirname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {analisarPaginas} from '../../src/analise.mjs';

const raiz=fileURLToPath(new URL('../../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');

export async function reanalisar(pasta) {
  const base=resolve(pasta), manifest=JSON.parse(await readFile(join(base,'manifest.json'),'utf8'));
  const escopo=await readFile(join(base,'escopo.json'));
  if(sha(escopo)!==manifest.escopo_sha256) throw new Error('Escopo alterado.');
  const sites=[];
  for(const item of manifest.sites) {
    if(!/^site-\d{2}$/.test(item.id)) throw new Error('Identificador de site inválido.');
    const local=join(base,item.id), reg=await readFile(join(local,'registro.json'));
    if(sha(reg)!==item.sha256_registro) throw new Error('Registro alterado: '+item.id);
    const registro=JSON.parse(reg);
    if(registro.dominio!==item.dominio || registro.split!==item.split) throw new Error('Escopo divergente.');
    const paginas=[];
    for(const meta of registro.arquivos) {
      if(!/^pagina-\d{2}\.html$/.test(meta.arquivo)) throw new Error('Nome de página inválido.');
      const bytes=await readFile(join(local,meta.arquivo));
      if(sha(bytes)!==meta.sha256_utf8_local) throw new Error('HTML local alterado: '+item.id);
      paginas.push({url:meta.url,coletadoEm:meta.coletadoEm,status:meta.status,bytes:bytes.length,
        sha256:meta.sha256_utf8_local,html:bytes.toString('utf8'),
        ...(meta.cabecalhoRobots ? {cabecalhoRobots:meta.cabecalhoRobots} : {})});
    }
    const diagnostico=analisarPaginas({dominio:item.dominio,coletadoEm:registro.coletadoEm,paginas,falhas:registro.falhas});
    sites.push({id:item.id,dominio:item.dominio,split:item.split,sha256_registro:sha(reg),diagnostico});
  }
  return {versao:1,geradoEm:new Date().toISOString(),manifesto_sha256:sha(await readFile(join(base,'manifest.json'))),
    observacao:'Reanálise local do HTML coletado; não estabelece que o conteúdo continue atual.',sites};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [pasta,saida]=process.argv.slice(2);
    if(!pasta || !saida) throw new Error('Use node ia/reais/reanalizar.mjs <coleta> <saida-em-data>.');
    const destino=resolve(saida), permitido=resolve(raiz,'data')+'/';
    if(!destino.startsWith(permitido)) throw new Error('A saída deve ficar em data/.');
    const pastaReal=await realpath(dirname(destino)),dataReal=await realpath(resolve(raiz,'data'));
    if(pastaReal!==dataReal && !pastaReal.startsWith(dataReal+sep)) throw new Error('A pasta de saída aponta para fora de data/.');
    const rel=await reanalisar(pasta), f=await open(destino,'wx',0o600);
    try { await f.writeFile(JSON.stringify(rel,null,2)+'\n'); } finally { await f.close(); }
    console.log(`Reanalisados ${rel.sites.length} sites; fonte e hashes preservados.`);
  } catch(e) {console.error(e.message);process.exitCode=1;}
}
