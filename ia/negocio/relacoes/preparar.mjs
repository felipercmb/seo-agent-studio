import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {carregarCapturaLocal} from '../capturas.mjs';
import {extrairFontesNegocio} from '../fontes-v3.mjs';
import {recuperarFontesNegocio} from '../recuperacao.mjs';

const hash=v=>createHash('sha256').update(v).digest('hex');
const serial=v=>JSON.stringify(v);

/** Select intact segments, count the full serialized context, and retain audit
 * references. Selection uses no company labels or expected relations. */
export function prepararRelacoes(coleta,{maxFontes=16,maxCaracteres=15000}={}) {
  if(!Number.isInteger(maxFontes)||maxFontes<1||maxFontes>16||!Number.isInteger(maxCaracteres)||maxCaracteres<256||maxCaracteres>24000)
    throw new TypeError('Orçamento contextual inválido.');
  const pool=extrairFontesNegocio(coleta,{maxFontes:240});
  const filas=['papel','publicos','ofertas','condicoes'].map(campo=>
    recuperarFontesNegocio(pool,{campo,maxFontes:16,maxCaracteres:12000}).fontes);
  const fontes=[],vistos=new Set(),conteudos=new Set(),descartes=[];
  for(let i=0;i<16;i++)for(const fila of filas){
    const f=fila[i];if(!f||vistos.has(f.id))continue;vistos.add(f.id);
    const chave=serial([f.url,f.contexto.titulos,f.texto]);
    if(conteudos.has(chave)){descartes.push({id:f.id,motivo:'mesmo_texto_pagina_e_cabecalhos'});continue;}
    const proxima={id:'s'+String(fontes.length+1).padStart(2,'0'),texto:f.texto,tipo:f.tipo,contexto:f.contexto};
    if(fontes.length===maxFontes||serial([...fontes.map(x=>x.modelo),proxima]).length>maxCaracteres){
      descartes.push({id:f.id,motivo:'orcamento_contexto_integral'});continue;}
    conteudos.add(chave);fontes.push({original:f.id,modelo:proxima});
  }
  return {versao:1,dominio:pool.dominio,pool,
    entrada:{versao:1,tarefa:'mapear_relacoes',dominio:pool.dominio,fontes:fontes.map(x=>x.modelo)},
    mapaIds:Object.fromEntries(fontes.map(x=>[x.modelo.id,x.original])),
    recuperacao:{maxFontes,maxCaracteres,caracteresComContexto:serial(fontes.map(x=>x.modelo)).length,
      fontesRetidas:fontes.length,paginasRetidas:new Set(fontes.map(x=>x.modelo.contexto.url)).size,descartes,
      limitada:pool.cobertura.limitada||descartes.length>0},
    limite:'Fontes públicas limitadas. Contexto de seção auxilia interpretação; não prova contratação, preço, vigência ou relação financeira.'};
}

export function semContexto(entrada){
  return {...entrada,fontes:entrada.fontes.map(({id,texto,tipo})=>({id,texto,tipo}))};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [captura,saida]=process.argv.slice(2);
  if(!captura||!saida)throw Error('Uso: node ia/negocio/relacoes/preparar.mjs CAPTURA SAIDA_NOVA');
  const carregada=carregarCapturaLocal(resolve(captura));
  const resultado=prepararRelacoes(carregada.coleta);
  resultado.captura={...carregada.captura,arquivo:resolve(captura)};
  resultado.preparadorSha256=hash(await readFile(new URL(import.meta.url)));
  await writeFile(resolve(saida),JSON.stringify(resultado,null,2)+'\n',{flag:'wx',mode:0o600});
}
