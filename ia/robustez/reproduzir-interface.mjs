/** Reproduz entradas da interface a partir de capturas locais íntegras, sem rede. */
import {readFile,open,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reanalisar} from '../reais/reanalizar.mjs';
import {descobrirTermos} from '../../src/descoberta.mjs';
import {analisarOportunidades} from '../../src/agente.mjs';
import {prepararEntradasIA} from '../../src/entrada-ia.mjs';

const raiz=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
const nomes=['coleta-20261114','coleta-reserva-20261114','coleta-rodada2',
  'coleta-rodada2-reserva','coleta-rodada3','coleta-rodada4','coleta-rodada4-reserva'];

async function fonte(pasta,historica) {
  const analise=await reanalisar(pasta), manifest=JSON.parse(await readFile(join(pasta,'manifest.json'),'utf8'));
  const casos=[];
  for(const site of analise.sites) {
    const registro=JSON.parse(await readFile(join(pasta,site.id,'registro.json'),'utf8'));
    const paginas=[];
    for(const a of registro.arquivos) {
      const b=await readFile(join(pasta,site.id,a.arquivo));
      if(sha(b)!==a.sha256_utf8_local) throw Error('HTML alterado.');
      paginas.push({url:a.url,coletadoEm:a.coletadoEm,status:a.status,bytes:b.length,
        sha256:a.sha256_utf8_local,html:b.toString('utf8'),...(a.cabecalhoRobots?{cabecalhoRobots:a.cabecalhoRobots}:{})});
    }
    const dados={dominio:site.dominio,coletadoEm:registro.coletadoEm,paginas,falhas:registro.falhas};
    const descoberta=descobrirTermos(dados);
    const horario=Math.max(Date.parse(registro.coletadoEm),...paginas.map(p=>Date.parse(p.coletadoEm)))+1000;
    if(!Number.isFinite(horario)) throw Error('Data da captura inválida.');
    const posicoes={versao:2,dominio:site.dominio,estado:'fonte_nao_configurada',
      candidatos:descoberta.candidatos,consultas:[],descoberta:{...descoberta.cobertura,coletadoEm:registro.coletadoEm}};
    const rel=analisarOportunidades({dominio:site.dominio,posicoes,diagnostico:site.diagnostico},{agora:()=>horario});
    const envelope=prepararEntradasIA(rel,{agora:()=>horario});
    for(const [i,entrada] of envelope.entradas.entries()) {
      const diretiva=entrada.evidencias.find(e=>e.verificacao?.intencao==='desconhecida');
      const d=entrada.evidencias.find(e=>e.id==='d1'&&e.tipo==='pagina'&&e.atual&&e.sha256_pagina);
      const p=entrada.evidencias.find(e=>e.id==='p1'&&e.tipo==='pagina'&&e.atual&&e.sha256_pagina);
      const s=entrada.evidencias.find(e=>e.id==='s1'&&e.tipo==='serp');
      // É uma preferência editorial para medir a utilidade, não um gabarito de especialista.
      const esperado=diretiva?{acao:'confirmar_publicacao',evidencias:[diretiva.id]}:
        d?{acao:'melhorar_pagina',evidencias:[d.id]}:
        p?{acao:'validar_demanda',evidencias:[p.id]}:
        s?{acao:'atualizar_coleta',evidencias:[s.id]}:{acao:'atualizar_coleta',evidencias:[]};
      const tipo=diretiva?'diretiva':d?'diagnostico':p?'termo_sem_demanda':s?'fonte_ausente':'sem_dados';
      const id=sha(Buffer.from(site.dominio+'|'+site.sha256_registro+'|'+i)).slice(0,24);
      casos.push({id,grupo:site.dominio,split:historica?'train':site.split,tipo,entrada,esperado,
        fonte:{captura:historica?'historica':'nova',registro_sha256:site.sha256_registro,
          manifesto_sha256:analise.manifesto_sha256,reproducao_em:new Date(horario).toISOString(),
          paginas_lidas:paginas.length},limite:'Preferência editorial gerada por regras, sem revisão independente; reprodução na data da captura, sem dados de posições ou retorno.'});
    }
  }
  return {casos,manifesto_sha256:analise.manifesto_sha256,sites:manifest.sites.length};
}

async function main() {
  const destino=resolve(raiz,process.argv[2]||'data/ia/robustez/interface-20261115.jsonl');
  if(!destino.startsWith(resolve(raiz,'data')+'/')) throw Error('Destino deve ficar em data/.');
  const fontes=[];
  for(const n of nomes) fontes.push(await fonte(join(raiz,'data/ia/reais',n),true));
  fontes.push(await fonte(join(raiz,'data/ia/robustez/coleta-20261115'),false));
  fontes.push(await fonte(join(raiz,'data/ia/robustez/coleta-ampliada-20261115'),false));
  const casos=fontes.flatMap(f=>f.casos), porDominio=new Map();
  for(const c of casos) {
    if(porDominio.has(c.grupo)&&porDominio.get(c.grupo)!==c.split) throw Error('Domínio atravessa grupos: '+c.grupo);
    porDominio.set(c.grupo,c.split);
  }
  const corpo=casos.map(c=>JSON.stringify(c)).join('\n')+'\n';
  await mkdir(dirname(destino),{recursive:true,mode:0o700});
  const f=await open(destino,'wx',0o600);try{await f.writeFile(corpo);}finally{await f.close();}
  const manifesto={versao:1,arquivo_sha256:sha(Buffer.from(corpo)),gerador_sha256:sha(await readFile(fileURLToPath(import.meta.url))),
    codigo_sha256:Object.fromEntries(await Promise.all(['src/analise.mjs','src/agente.mjs','src/descoberta.mjs',
      'src/entrada-ia.mjs','src/robots-diretivas.mjs','src/coleta.mjs','src/consulta.mjs','ia/reais/reanalizar.mjs','package-lock.json']
      .map(async nome=>[nome,sha(await readFile(join(raiz,nome)))]))),
    fontes:fontes.map(f=>({manifesto_sha256:f.manifesto_sha256,sites:f.sites})),
    grupos:Object.fromEntries(['train','valid','test'].map(s=>[s,new Set(casos.filter(c=>c.split===s).map(c=>c.grupo)).size])),
    contagens:Object.fromEntries(['train','valid','test'].map(s=>[s,casos.filter(c=>c.split===s).length])),
    limites:['Dados e rótulos editoriais sem revisão externa.', 'Teste não demonstrou dados atuais, resultados comerciais ou qualidade geral de SEO.',
      'Capturas sem página retornam explicitamente contexto sem dados.']};
  const m=await open(destino+'.manifest.json','wx',0o600);try{await m.writeFile(JSON.stringify(manifesto,null,2)+'\n');}finally{await m.close();}
  console.log(JSON.stringify({grupos:manifesto.grupos,contagens:manifesto.contagens},null,2));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
