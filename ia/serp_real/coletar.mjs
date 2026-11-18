/** Registra relatórios locais com SERPs reais, sem receber ou ler a chave da fonte. */
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,realpath} from 'node:fs/promises';
import {resolve,join,dirname,basename,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizarSite} from '../../src/consulta.mjs';

const raiz=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=b=>JSON.stringify(b,null,2)+'\n';

export function validarPlano(plano) {
  if(!plano||plano.versao!==1||!Array.isArray(plano.sites)||!plano.sites.length||plano.sites.length>30)
    throw Error('Plano de coleta inválido.');
  const dominios=new Set(),grupos=new Map();
  for(const s of plano.sites) {
    if(!s||typeof s!=='object'||typeof s.site!=='string'||normalizarSite(s.site)!==s.site||
       !['train','valid','test'].includes(s.split)||typeof s.grupo!=='string'||!s.grupo.trim()||
       !Number.isInteger(s.lotes)||s.lotes<1||s.lotes>5||dominios.has(s.site))throw Error('Site ou divisão inválidos.');
    if(grupos.has(s.grupo)&&grupos.get(s.grupo)!==s.split)throw Error('Uma organização aparece em divisões diferentes.');
    dominios.add(s.site);grupos.set(s.grupo,s.split);
  }
  if(!['train','valid','test'].every(s=>plano.sites.some(x=>x.split===s)))
    throw Error('Reserve grupos de treino, validação e teste antes da coleta.');
  return plano;
}

async function gravar(nome,valor) {
  const f=await open(nome,'wx',0o600);
  try{await f.writeFile(valor);}finally{await f.close();}
  return sha(Buffer.from(valor));
}
async function pedir(base,caminho,corpo) {
  const r=await fetch(base+caminho,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},
    body:JSON.stringify(corpo),signal:AbortSignal.timeout(95_000)});
  const resposta=await r.json();
  if(!r.ok)throw Error(`Servidor local retornou HTTP ${r.status}.`);
  return resposta;
}
function cobertura(r) {
  return {estado:r.estado||'desconhecido',motivo:r.progresso?.motivo||null,
    novas:r.progresso?.paginasNesteLote??0,reutilizadas:r.progresso?.paginasReutilizadasNesteLote??0,
    verificadas:r.cobertura?.verificadas??0,encontradas:r.cobertura?.encontradas??0,
    paginas:r.cobertura?.paginasConsultadas??0,continuar:r.progresso?.continuar===true};
}

export async function coletar({plano,planoBytes,saida,porta=8795,pausa=ms=>new Promise(r=>setTimeout(r,ms)),
    requisitar=pedir,health=async base=>(await (await fetch(base+'/healthz')).json()),pastaDados=join(raiz,'data')}={}) {
  validarPlano(plano);
  if(!Number.isInteger(porta)||porta<1||porta>65535)throw Error('Porta inválida.');
  const base='http://127.0.0.1:'+porta;
  if((await health(base))?.fonteConfigurada!==true)throw Error('A fonte ainda não está configurada no servidor local.');
  const data=await realpath(pastaDados);
  const caminho=resolve(saida),destino=join(await realpath(dirname(caminho)),basename(caminho));
  if(!relative(data,destino)||relative(data,destino).startsWith('..'))throw Error('A saída deve ficar em data/.');
  await mkdir(destino,{recursive:false,mode:0o700});
  const real=await realpath(destino);if(relative(data,real).startsWith('..'))throw Error('A saída deve ficar em data/.');
  const arquivos=[],inicio=new Date().toISOString();
  const planoSerializado=planoBytes||json(plano);
  if(JSON.stringify(JSON.parse(planoSerializado))!==JSON.stringify(plano))throw Error('O plano não corresponde ao arquivo.');
  const planoHash=await gravar(join(real,'plano.json'),planoSerializado);
  const codigo={};
  for(const nome of ['ia/serp_real/coletar.mjs','src/serpapi.mjs','src/posicoes-atuais.mjs','src/agente.mjs','src/entrada-ia.mjs'])
    codigo[nome]=sha(await readFile(join(raiz,nome)));
  await gravar(join(real,'congelamento.json'),json({versao:1,inicio,plano_sha256:planoHash,codigo_sha256:codigo,
    limites:['A seleção dos grupos ocorreu antes da coleta.', 'As capturas servem como histórico após o vencimento.',
      'Hashes verificam integridade, não provam autoria da fonte nem efeito comercial.']}));
  const salvar=async(nome,dados,meta)=>{const bytes=json(dados),digest=await gravar(join(real,nome),bytes);
    arquivos.push({arquivo:nome,sha256:digest,...meta});};
  let interrompida=null;
  for(const [i,s] of plano.sites.entries()) {
    const prefixo=String(i+1).padStart(2,'0')+'-'+s.site;
    try {
      try {
        const diagnostico=await requisitar(base,'/api/diagnostico',{site:s.site});
        await salvar(prefixo+'-diagnostico.json',diagnostico,{site:s.site,split:s.split,tipo:'diagnostico'});
      }catch{arquivos.push({site:s.site,split:s.split,tipo:'erro_diagnostico',erro:'diagnostico_indisponivel'});}
      let r=await requisitar(base,'/api/posicoes',{site:s.site});
      await salvar(prefixo+'-posicoes-00.json',r,{site:s.site,split:s.split,tipo:'posicoes',...cobertura(r)});
      for(let lote=1;lote<=s.lotes&&r.progresso?.continuar===true;lote++) {
        const paginasAntes=r.cobertura?.paginasConsultadas??0;
        await pausa(Math.max(3200,Math.min(10_000,Number(r.progresso?.esperaMs)||3200)));
        r=await requisitar(base,'/api/posicoes',{site:s.site,continuar:true});
        await salvar(prefixo+'-posicoes-'+String(lote).padStart(2,'0')+'.json',r,
          {site:s.site,split:s.split,tipo:'posicoes',...cobertura(r)});
        if(['cota','cota_dominio','configuracao','plano_incompativel','controle'].includes(r.progresso?.motivo)) {
          if(r.progresso.motivo!=='cota_dominio')interrompida=r.progresso.motivo;
          break;
        }
        // Interrompe globalmente se houve reservas mas nenhuma captura foi
        // aceita. Uma incompatibilidade da fonte não deve gastar a franquia.
        if((r.progresso?.paginasNesteLote??0)>0&&(r.progresso?.paginasReutilizadasNesteLote??0)===0&&
           (r.cobertura?.paginasConsultadas??0)<=paginasAntes){interrompida='fonte_sem_captura_valida';break;}
      }
      const agente=await requisitar(base,'/api/agente',{site:s.site});
      await salvar(prefixo+'-agente.json',agente,{site:s.site,split:s.split,tipo:'agente'});
      console.log(JSON.stringify({site:s.site,split:s.split,...cobertura(r)}));
      if(interrompida)break;
    }catch{arquivos.push({site:s.site,split:s.split,tipo:'erro',erro:'coleta_indisponivel'});
      console.log(JSON.stringify({site:s.site,split:s.split,estado:'coleta_indisponivel'}));}
  }
  const manifesto={versao:1,inicio,fim:new Date().toISOString(),plano_sha256:planoHash,interrompida,arquivos,
    limites:['Relatórios públicos coletados por um aplicativo local; não contêm validação independente de impacto.',
      'Uma observação de posição vale apenas para sua data, país, idioma e dispositivo; não comprova demanda nem vendas.']};
  await gravar(join(real,'manifest.json'),json(manifesto));
  return manifesto;
}

async function main() {
  const [planoNome,saida,portaTexto]=process.argv.slice(2);
  if(!planoNome||!saida||process.argv.length>5)throw Error('Uso: node ia/serp_real/coletar.mjs PLANO.json SAIDA [PORTA]');
  const planoBytes=await readFile(resolve(planoNome),'utf8'),plano=JSON.parse(planoBytes);
  const r=await coletar({plano,planoBytes,saida,porta:portaTexto?Number(portaTexto):8795});
  console.log(JSON.stringify({arquivos:r.arquivos.length,interrompida:r.interrompida}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
