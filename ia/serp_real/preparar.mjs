/** Reproduz, na hora da coleta, os contextos com posição SERP verificada. Sem rede. */
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,realpath} from 'node:fs/promises';
import {resolve,join,dirname,basename,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analisarOportunidades} from '../../src/agente.mjs';
import {prepararEntradasIA} from '../../src/entrada-ia.mjs';
import {validarPlano} from './coletar.mjs';

const raiz=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
const normal=s=>s.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
const json=v=>JSON.stringify(v,null,2)+'\n';
async function gravar(p,b){const f=await open(p,'wx',0o600);try{await f.writeFile(b);}finally{await f.close();}}

/** Cada registro é o último relatório arquivado de um site da divisão prévia. */
export function criarCasos(registros) {
  const consultas=new Map();
  for(const {site,relatorio} of registros) for(const q of relatorio.consultas||[]) {
    if(typeof q?.termo!=='string'||!q.termo.trim())continue;
    const k=normal(q.termo);if(!consultas.has(k))consultas.set(k,new Set());consultas.get(k).add(site.split);
  }
  const casos=[],descartes={cruzam_divisoes:0,sem_posicao_validada:0,sem_candidato:0};
  for(const {site,relatorio,sha256Relatorio} of registros) {
    const horario=Date.parse(relatorio.geradoEm);
    if(relatorio.versao!==2||relatorio.dominio!==site.site||!Number.isFinite(horario)||
       !Array.isArray(relatorio.consultas)||!Array.isArray(relatorio.candidatos))continue;
    for(const q of relatorio.consultas) {
      if(typeof q?.termo!=='string'||!q.termo.trim())continue;
      if(consultas.get(normal(q.termo)).size>1){descartes.cruzam_divisoes++;continue;}
      const cs=relatorio.candidatos.filter(c=>typeof c.termo==='string'&&normal(c.termo)===normal(q.termo));
      if(cs.length!==1){descartes.sem_candidato++;continue;}
      // O motor revalida a sequência, o contexto, as datas e o hash de cada página.
      const posicoes={...relatorio,candidatos:cs,consultas:[q]};
      const rel=analisarOportunidades({dominio:site.site,posicoes,diagnostico:null},{agora:()=>horario});
      const entrada=prepararEntradasIA(rel,{agora:()=>horario}).entradas.find(e=>
        e.evidencias.some(x=>x.id==='s1'&&normal(x.termo||'')===normal(q.termo)));
      const serp=entrada?.evidencias.find(e=>e.id==='s1');
      if(!serp||serp.atual!==true||!Number.isInteger(serp.posicao)||!serp.fontes_serp?.length){descartes.sem_posicao_validada++;continue;}
      const competidores=Array.isArray(serp.concorrentes)&&serp.concorrentes.length>0;
      const esperado={acao:competidores?'comparar_concorrentes':'acompanhar',evidencias:['s1']};
      const variantes=[entrada,{...entrada,objetivo:competidores
        ?'Como comparar os sites que apareceram acima na mesma busca?'
        :'Como acompanhar a posição observada nesta busca?'}];
      for(const [indice,variacao] of variantes.entries()) {
        const id=sha(Buffer.from([site.site,q.termo,sha256Relatorio,String(indice)].join('|'))).slice(0,24);
        casos.push({id,grupo:site.grupo,dominio:site.site,split:site.split,tipo:competidores?'concorrentes':'acompanhar',
          entrada:variacao,esperado,fonte:{relatorio_sha256:sha256Relatorio,reproducao_em:relatorio.geradoEm,
            ids_serp:serp.fontes_serp.map(f=>f.id),hashes_serp:serp.fontes_serp.map(f=>f.sha256)},
          limite:'Captura histórica reproduzida na data original. Preferência editorial automática sem revisão independente; não mede demanda, vendas ou causa de posição.'});
      }
    }
  }
  return {casos,descartes};
}

export async function preparar({coleta,saida,pastaDados=join(raiz,'data')}={}) {
  const data=await realpath(pastaDados),origem=await realpath(coleta),destinoBruto=resolve(saida);
  const destino=join(await realpath(dirname(destinoBruto)),basename(destinoBruto));
  for(const p of [origem,destino])if(!relative(data,p)||relative(data,p).startsWith('..'))throw Error('Arquivos devem ficar em data/.');
  const mb=await readFile(join(origem,'manifest.json')),m=JSON.parse(mb),pb=await readFile(join(origem,'plano.json'));
  if(sha(pb)!==m.plano_sha256)throw Error('Plano da coleta foi alterado.');
  const plano=validarPlano(JSON.parse(pb)),congelado=JSON.parse(await readFile(join(origem,'congelamento.json')));
  if(congelado.plano_sha256!==m.plano_sha256)throw Error('Plano difere do congelamento.');
  for(const [nome,hash] of Object.entries(congelado.codigo_sha256))if(sha(await readFile(join(raiz,nome)))!==hash)
    throw Error('O código da coleta mudou; preserve a versão congelada para reproduzir.');
  const registros=[];
  for(const site of plano.sites) {
    const arqs=m.arquivos.filter(x=>x.site===site.site&&x.split===site.split&&x.tipo==='posicoes'&&typeof x.arquivo==='string').sort((a,b)=>a.arquivo.localeCompare(b.arquivo));
    const a=arqs.at(-1);if(!a)continue;
    if(basename(a.arquivo)!==a.arquivo)throw Error('Caminho inválido no manifesto.');
    const b=await readFile(join(origem,a.arquivo));if(sha(b)!==a.sha256)throw Error('Relatório de origem foi alterado.');
    registros.push({site,relatorio:JSON.parse(b),sha256Relatorio:a.sha256});
  }
  const {casos,descartes}=criarCasos(registros);await mkdir(destino,{recursive:false,mode:0o700});
  const arquivos={};
  for(const split of ['train','valid','test']) {
    const linhas=casos.filter(c=>c.split===split).map(c=>JSON.stringify(c)).join('\n');
    const bytes=linhas?linhas+'\n':'';const nome=`casos-${split}.jsonl`;
    await gravar(join(destino,nome),bytes);arquivos[nome]={sha256:sha(Buffer.from(bytes)),casos:casos.filter(c=>c.split===split).length};
  }
  const manifesto={versao:1,origem_manifesto_sha256:sha(mb),plano_sha256:m.plano_sha256,
    gerador_sha256:sha(await readFile(fileURLToPath(import.meta.url))),arquivos,descartes,
    dominios:Object.fromEntries(['train','valid','test'].map(s=>[s,new Set(casos.filter(c=>c.split===s).map(c=>c.grupo)).size])),
    limites:['Os dois objetivos de uma mesma consulta são relacionados.', 'Ação esperada é preferência editorial automática, não parecer independente.',
      'A reprodução usa a hora da captura; dados antigos não são posições atuais.', 'Sem volume, conversão, gastos ou receita medidos.']};
  await gravar(join(destino,'manifest.json'),json(manifesto));return manifesto;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [coleta,saida]=process.argv.slice(2);
  if(!coleta||!saida||process.argv.length!==4){console.error('Uso: node ia/serp_real/preparar.mjs COLETA SAIDA');process.exitCode=1;}
  else preparar({coleta,saida}).then(m=>console.log(JSON.stringify({arquivos:m.arquivos,descartes:m.descartes,dominios:m.dominios})))
    .catch(e=>{console.error(e.message);process.exitCode=1;});
}
