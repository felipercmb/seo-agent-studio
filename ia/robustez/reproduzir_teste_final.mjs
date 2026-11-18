/** Reproduz nova reserva por domínio sem rede e sem inspecionar respostas do modelo. */
import {readFile,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reanalisar} from '../reais/reanalizar.mjs';
import {descobrirTermos} from '../../src/descoberta.mjs';
import {analisarOportunidades} from '../../src/agente.mjs';
import {prepararEntradasIA} from '../../src/entrada-ia.mjs';

const raiz=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
async function gravar(nome,dados){const f=await open(nome,'wx',0o600);try{await f.writeFile(dados);}finally{await f.close();}}

async function main(){
  const pasta=resolve(raiz,process.argv[3]||'data/ia/robustez/coleta-teste-final-20261115');
  if(!pasta.startsWith(resolve(raiz,'data')+'/'))throw Error('Fonte deve ficar em data/.');
  const analise=await reanalisar(pasta),casos=[];
  for(const site of analise.sites){
    if(site.split!=='test')throw Error('A reserva final aceita apenas domínios de teste.');
    const registro=JSON.parse(await readFile(join(pasta,site.id,'registro.json'),'utf8')),paginas=[];
    for(const a of registro.arquivos){
      const b=await readFile(join(pasta,site.id,a.arquivo));if(sha(b)!==a.sha256_utf8_local)throw Error('HTML alterado.');
      paginas.push({url:a.url,coletadoEm:a.coletadoEm,status:a.status,bytes:b.length,sha256:a.sha256_utf8_local,
        html:b.toString('utf8'),...(a.cabecalhoRobots?{cabecalhoRobots:a.cabecalhoRobots}:{})});
    }
    const descoberta=descobrirTermos({dominio:site.dominio,coletadoEm:registro.coletadoEm,paginas,falhas:registro.falhas});
    const horario=Math.max(Date.parse(registro.coletadoEm),...paginas.map(p=>Date.parse(p.coletadoEm)))+1000;
    if(!Number.isFinite(horario))throw Error('Data inválida.');
    const posicoes={versao:2,dominio:site.dominio,estado:'fonte_nao_configurada',candidatos:descoberta.candidatos,
      consultas:[],descoberta:{...descoberta.cobertura,coletadoEm:registro.coletadoEm}};
    const rel=analisarOportunidades({dominio:site.dominio,posicoes,diagnostico:site.diagnostico},{agora:()=>horario});
    const envelope=prepararEntradasIA(rel,{agora:()=>horario});
    for(const [i,entrada] of envelope.entradas.entries()){
      const diretiva=entrada.evidencias.find(e=>e.verificacao?.intencao==='desconhecida');
      const d=entrada.evidencias.find(e=>e.id==='d1'&&e.tipo==='pagina'&&e.atual&&e.sha256_pagina);
      const p=entrada.evidencias.find(e=>e.id==='p1'&&e.tipo==='pagina'&&e.atual&&e.sha256_pagina);
      const s=entrada.evidencias.find(e=>e.id==='s1'&&e.tipo==='serp');
      const esperado=diretiva?{acao:'confirmar_publicacao',evidencias:[diretiva.id]}:
        d?{acao:'melhorar_pagina',evidencias:[d.id]}:p?{acao:'validar_demanda',evidencias:[p.id]}:
        s?{acao:'atualizar_coleta',evidencias:[s.id]}:{acao:'atualizar_coleta',evidencias:[]};
      const tipo=diretiva?'diretiva':d?'diagnostico':p?'termo_sem_demanda':s?'fonte_ausente':'sem_dados';
      casos.push({id:sha(Buffer.from(site.dominio+'|'+site.sha256_registro+'|'+i)).slice(0,24),grupo:site.dominio,
        split:'test',tipo,entrada,esperado,fonte:{captura:'nova',registro_sha256:site.sha256_registro,
          manifesto_sha256:analise.manifesto_sha256,reproducao_em:new Date(horario).toISOString(),paginas_lidas:paginas.length},
        limite:'Preferência editorial automática, sem especialista; nenhuma posição Google ou retorno comercial foi medido.'});
    }
  }
  const corpo=casos.map(c=>JSON.stringify(c)).join('\n')+'\n';
  const saida=resolve(raiz,process.argv[2]||'data/ia/robustez/interface-teste-final-20261115.jsonl');
  if(!saida.startsWith(resolve(raiz,'data')+'/'))throw Error('Saída deve ficar em data/.');
  await gravar(saida,corpo);
  const fontes=['src/analise.mjs','src/agente.mjs','src/descoberta.mjs','src/entrada-ia.mjs','src/robots-diretivas.mjs',
    'src/coleta.mjs','src/consulta.mjs','ia/reais/reanalizar.mjs','package-lock.json'];
  const m={versao:1,arquivo_sha256:sha(Buffer.from(corpo)),manifesto_coleta_sha256:analise.manifesto_sha256,
    gerador_sha256:sha(await readFile(fileURLToPath(import.meta.url))),
    codigo_sha256:Object.fromEntries(await Promise.all(fontes.map(async n=>[n,sha(await readFile(join(raiz,n)))]))),
    dominios:analise.sites.length,contextos:casos.length};
  await gravar(saida+'.manifest.json',JSON.stringify(m,null,2)+'\n');
  console.log(JSON.stringify({dominios:m.dominios,contextos:m.contextos}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
