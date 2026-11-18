/** Compara interpretações antigas e atuais das mesmas capturas, sem acesso à rede. */
import {readFile, mkdir, open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reanalisar} from '../reais/reanalizar.mjs';

const raiz=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const fontes=[
  ['coleta-20261114','reanalise-inicial.json'],['coleta-reserva-20261114','reanalise-reserva.json'],
  ['coleta-rodada2','reanalise-rodada2.json'],['coleta-rodada2-reserva','reanalise-rodada2-reserva.json'],
  ['coleta-rodada3','reanalise-rodada3.json'],['coleta-rodada4','reanalise-rodada4.json'],
  ['coleta-rodada4-reserva','reanalise-rodada4-reserva.json'],
];
const paginas=s=>new Set((s?.diagnostico?.verificacoes || []).find(v=>v.id==='diretiva-noindex-html')?.paginasAfetadas || []);

export async function auditar(base=resolve(raiz,'data/ia/reais')) {
  const alteracoes=[], fontesAuditadas=[];
  let sites=0,paginasAnalisadas=0,anterior=0,atual=0;
  for(const [coleta,revisao] of fontes){
    const caminho=resolve(base,coleta),bytes=await readFile(resolve(base,revisao));
    const antes=JSON.parse(bytes.toString('utf8')),depois=await reanalisar(caminho);
    if(antes.manifesto_sha256!==depois.manifesto_sha256)throw new Error('A revisão anterior não corresponde à coleta.');
    const mapa=new Map(antes.sites.map(s=>[s.id,s]));
    for(const s of depois.sites){
      const antigo=mapa.get(s.id);if(!antigo || antigo.dominio!==s.dominio)throw new Error('O escopo auditado divergiu.');
      const a=paginas(antigo),b=paginas(s);
      sites++;paginasAnalisadas+=s.diagnostico.paginas.length;anterior+=a.size;atual+=b.size;
      const removidas=[...a].filter(p=>!b.has(p)),acrescidas=[...b].filter(p=>!a.has(p));
      if(removidas.length||acrescidas.length)alteracoes.push({dominio:s.dominio,coleta,removidas,acrescidas});
    }
    fontesAuditadas.push({coleta,manifesto_sha256:depois.manifesto_sha256,revisao_anterior_sha256:sha(bytes)});
  }
  return {versao:1,geradoEm:new Date().toISOString(),tipo:'reanálise local de capturas históricas; não é nova coleta',
    escopo:{sites,paginasAnalisadas},contagem_paginas_com_noindex:{anterior,atual},alteracoes,fontes:fontesAuditadas,
    limites:['A comparação mede mudança de interpretação do HTML salvo, não a situação atual no Google.',
             'Capturas antigas não guardam X-Robots-Tag e não permitem avaliar cabeçalhos HTTP.']};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const saida=resolve(raiz,process.argv[2] || 'data/ia/qualidade/auditoria-noindex.json');
  const permitido=resolve(raiz,'data')+'/';if(!saida.startsWith(permitido))throw new Error('Saída deve ficar em data/.');
  await mkdir(dirname(saida),{recursive:true,mode:0o700});
  const resultado=await auditar(),f=await open(saida,'wx',0o600);
  try{await f.writeFile(JSON.stringify(resultado,null,2)+'\n');}finally{await f.close();}
  console.log(JSON.stringify({escopo:resultado.escopo,noindex:resultado.contagem_paginas_com_noindex,sitesComAlteracao:resultado.alteracoes.length}));
}
