import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

/** Hydrates an existing capture or legacy HTML+registry without network I/O.
 * Original registries and HTML files are never rewritten. */
export function carregarCapturaLocal(arquivo) {
  const bruto=fs.readFileSync(arquivo),registro=JSON.parse(bruto),base=path.dirname(path.resolve(arquivo));
  const captura={arquivo,sha256:createHash('sha256').update(bruto).digest('hex'),formato:Array.isArray(registro.arquivos)?'registro_html_local':'captura_json'};
  if(!Array.isArray(registro.arquivos))return{captura,coleta:registro};
  const paginas=[];
  for(const p of registro.arquivos){
    if(typeof p.arquivo!=='string'||!p.arquivo.endsWith('.html'))throw Error('Registro sem nome HTML válido.');
    const alvo=path.resolve(base,p.arquivo);
    if(!alvo.startsWith(base+path.sep))throw Error('HTML fora da pasta da captura.');
    const b=fs.readFileSync(alvo),sha256=createHash('sha256').update(b).digest('hex');
    const esperado=p.sha256_utf8_local||p.sha256;
    if(esperado&&esperado!==sha256)throw Error('Hash local do HTML diverge do registro.');
    paginas.push({url:p.url,status:p.status,coletadoEm:p.coletadoEm||registro.coletadoEm,html:b.toString('utf8'),sha256});
  }
  return{captura,coleta:{dominio:registro.dominio,coletadoEm:registro.coletadoEm,paginas,falhas:registro.falhas||[]}};
}
