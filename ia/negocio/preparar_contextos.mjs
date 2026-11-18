/** Offline, label-free projection from saved HTML to field-specific sources. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {carregarCapturaLocal} from './capturas.mjs';
import {extrairFontesNegocio} from './fontes.mjs';
import {recuperarFontesNegocio as recuperarV1} from './recuperacao.mjs';

const CAMPOS=['papel','finalidade','ofertas','publicos','atuacoes','condicoes','recomendar'];
const hash=b=>createHash('sha256').update(b).digest('hex');

export function projetarContextos(casos, {recuperar=recuperarV1,extrair=extrairFontesNegocio,maxCaracteres=6000,carregar=carregarCapturaLocal}={}) {
  return casos.map(c=>{
    // Intentionally do not forward alvosPorCampo, perfilOracle or planning
    // annotations to either extraction or retrieval.
    const {captura,coleta}=carregar(c.captura.arquivo);
    if(c.captura.sha256!==captura.sha256)throw Error('Captura alterada: '+c.id);
    const pool=extrair(coleta,{maxFontes:240});
    if(pool.dominio!==c.dominio)throw Error('Domínio da captura não coincide: '+c.id);
    const contextosPorCampo=Object.fromEntries(CAMPOS.map(campo=>[campo,recuperar(pool,{campo,maxCaracteres})]));
    return {id:c.id,dominio:c.dominio,grupoEmpresarial:c.grupoEmpresarial,split:c.split,captura,pool,contextosPorCampo};
  });
}

async function main(){
  const a={};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i];if(!['--corpus','--saida','--recuperador','--exportador','--max-caracteres'].includes(k)||process.argv[i+1]===undefined)throw Error('Argumento inválido.');a[k]=process.argv[i+1];}
  if(!a['--corpus']||!a['--saida']||fs.existsSync(a['--saida']))throw Error('Informe corpus local e saída nova.');
  const versao=a['--recuperador']||'v1';if(!['v1','v2'].includes(versao))throw Error('Recuperador inválido.');
  const recuperar=versao==='v1'?recuperarV1:(await import('./recuperacao-v2.mjs')).recuperarFontesNegocio;
  const exportador=a['--exportador']||'v1';if(!['v1','v2'].includes(exportador))throw Error('Exportador inválido.');
  const extrair=exportador==='v1'?extrairFontesNegocio:(await import('./fontes-v2.mjs')).extrairFontesNegocio;
  const maxCaracteres=Number(a['--max-caracteres']||6000),arquivo=a['--corpus'],bruto=fs.readFileSync(arquivo),d=JSON.parse(bruto);
  const casos=projetarContextos(d.casos,{recuperar,extrair,maxCaracteres});
  const codigo=Object.fromEntries(['preparar_contextos.mjs','capturas.mjs',exportador==='v1'?'fontes.mjs':'fontes-v2.mjs',versao==='v1'?'recuperacao.mjs':'recuperacao-v2.mjs'].map(n=>[n,hash(fs.readFileSync(new URL(n,import.meta.url)))]));
  const saida={versao:1,modo:'end_to_end',geradoEm:new Date().toISOString(),fonte:{arquivo:path.resolve(arquivo),sha256:hash(bruto)},
    entradaNoRecuperador:'Somente captura, domínio, campo e limites; nenhum alvo, perfil oracle ou rótulo de negócio.',
    codigo,recuperador:versao,exportador,maxCaracteres,elegivelTreinoExperimental:false,casos};
  fs.mkdirSync(path.dirname(a['--saida']),{recursive:true});fs.writeFileSync(a['--saida'],JSON.stringify(saida,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({organizacoes:casos.length,campos:CAMPOS.length,codigo}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
