import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepararJornadas} from '../ia/negocio/jornadas/preparar-v6.mjs';
import {prepararJornadas as anterior} from '../ia/negocio/jornadas/preparar-v5.mjs';
const D='exemplo-documental.com.br',T='2026-11-17T13:00:00Z';
function coleta(){
 const blocks=Array.from({length:24},(_,i)=>'<h2>Rotina '+i+'</h2><p>A equipe do cliente utiliza a ferramenta Aurora para organizar pedidos do setor '+i+', com informações de produção e usuários responsáveis.</p>').join('');
 const policies=Array.from({length:18},(_,i)=>'<h2>Condição contratual '+i+'</h2><p>O cliente precisa informar uma conta para solicitar reembolso do plano, em até '+(i+2)+' dias, apenas nas condições e taxas aqui publicadas.</p>').join('');
 const posts=Array.from({length:18},(_,i)=>'<h2>Artigo '+i+'</h2><p>A empresa pode melhorar os resultados e contratar profissionais para seus projetos, conforme o número de pessoas e o limite de '+(i+3)+' dias.</p>').join('');
 return{dominio:D,coletadoEm:T,paginas:[['/','Aurora — software de pedidos',blocks],['/politica-de-reembolso','Política de reembolso',policies],['/blog/guia','Blog — guia de contratação',posts]].map(([path,title,body])=>{const html='<html><head><title>'+title+'</title></head><body><h1>'+title+'</h1>'+body+'</body></html>';return{url:'https://'+D+path,status:200,html,coletadoEm:T,sha256:createHash('sha256').update(html).digest('hex')};})};
}
test('política e artigo não ocupam o espaço da operação principal na base',()=>{
 const c=coleta(),a=anterior(c),r=prepararJornadas(c),count=arr=>arr.reduce((m,f)=>(m[f.contexto.classePagina]=(m[f.contexto.classePagina]||0)+1,m),{}),old=count(a.base.fontes),now=count(r.base.fontes);
 assert.ok((old.politica||0)+(old.editorial||0)>2);assert.ok((now.politica||0)<=1);assert.ok((now.editorial||0)<=1);assert.ok(r.base.fontes.filter(f=>!['politica','editorial'].includes(f.contexto.classePagina)).length>=14);
 assert.ok(r.pool.fontes.filter(f=>f.contexto.classePagina==='politica').length>1);assert.ok(r.recuperacao.descartes.some(d=>d.motivo==='cota_de_classe_documental_na_base'));
});
test('seleção conserva texto, contexto, IDs e orçamento integral sem recortar',()=>{
 const r=prepararJornadas(coleta());assert.ok(r.base.fontes.length<=16);assert.ok(JSON.stringify(r.base).length<=15000);
 for(const f of r.base.fontes){const original=r.pool.fontes.find(p=>p.id===r.mapaIds[f.id]);assert.ok(original);assert.equal(f.texto,original.texto);assert.deepEqual(f.contexto,original.contexto);assert.equal(f.contexto.recortado,false);}
 assert.equal(r.recuperacao.politicaDocumental.poolDocumentalPreservado,true);
});
test('uma instalação com somente documento contratual mantém limitação e não inventa operação',()=>{
 const c=coleta();c.paginas=c.paginas.filter(p=>p.url.includes('politica'));const r=prepararJornadas(c);assert.ok(r.base.fontes.length<=1);assert.ok(r.pool.fontes.length>r.base.fontes.length);assert.ok(r.recuperacao.limitada);assert.equal(r.recuperacao.politicaDocumental.contagem.principal_potencial,undefined);
});
test('orçamento pequeno prioriza fonte principal sem exceder quantidade ou bytes',()=>{
 const r=prepararJornadas(coleta(),{maxFontes:1,maxCaracteres:1500});assert.ok(r.base.fontes.length<=1);assert.ok(JSON.stringify(r.base).length<=1500);if(r.base.fontes.length)assert.ok(!['politica','editorial'].includes(r.base.fontes[0].contexto.classePagina));
});
test('wrapper preserva V5 e a seleção documental V6 permanece experimental reproduzível',async()=>{
 const ativo=await import('../ia/negocio/jornadas/preparar.mjs');assert.deepEqual(ativo.prepararJornadas(coleta()),anterior(coleta()));assert.deepEqual(ativo.prepararJornadasExperimentalV6(coleta()),prepararJornadas(coleta()));assert.equal(anterior(coleta()).recuperacao.versao,1);assert.equal(prepararJornadas(coleta()).recuperacao.versao,2);
});
