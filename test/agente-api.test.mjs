import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {abrirBanco} from '../lib/sqlite.mjs';
import {criarWorker} from '../src/worker.mjs';
import {criarAgente} from '../src/agente-servico.mjs';

const DATA = Date.parse('2026-11-14T15:00:00Z');
const DIA = 86400_000;
function ambiente(t, executarIA, executarIACandidata) {
  const pasta = mkdtempSync(join(tmpdir(), 'visibilidade-agente-'));
  const db = abrirBanco({arquivo: join(pasta, 'teste.sqlite')});
  t.after(() => {db.close(); rmSync(pasta, {recursive:true, force:true});});
  let instante = DATA, coletas = 0, google = 0;
  const agora = () => instante;
  const opcoes = {agora, coletar: async dominio => {
    coletas++;
    return {dominio, coletadoEm:new Date(instante).toISOString(),falhas:[],paginas:[{
      url:'https://'+dominio+'/',coletadoEm:new Date(instante).toISOString(),status:200,sha256:'a'.repeat(64),
      html:'<html lang="pt-BR"><head><title>Conserto de geladeira</title></head><body><h1>Conserto de geladeira</h1><h2>Orçamento de conserto de geladeira</h2><input></body></html>',
    }]};
  }, consultarGoogle:async()=>{google++;throw new Error('Nenhuma consulta Google deve ser iniciada pelo agente.');}};
  if (executarIA) opcoes.executarIA = executarIA;
  if (executarIACandidata) opcoes.executarIACandidata = executarIACandidata;
  const criar = () => criarWorker('<!doctype html><title>Teste</title>', opcoes);
  let worker = criar();
  const env = {DB:db};
  return {db, env, agora, contagens:()=>({coletas,google}),avancar:ms=>{instante+=ms;},reiniciar:()=>{worker=criar();},
    post:(path,body={site:'oficina.example'},extra={}) => worker.fetch(new Request('http://localhost:8794'+path,{
      method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:8794',...extra},body:JSON.stringify(body),
    }),env),
    get:path=>worker.fetch(new Request('http://localhost:8794'+path),env),
  };
}

test('IA local recebe somente evidências do servidor, sem coleta nova nem prompt arbitrário',async t=>{
  let recebida;const a=ambiente(t,async entrada=>{recebida=entrada;return {versao:1,estado:'experimental',resultados:[{estado:'recusada'}]};});
  assert.equal((await a.post('/api/ia')).status,409);
  assert.equal(recebida,undefined);
  assert.equal((await a.post('/api/diagnostico')).status,200);
  assert.equal((await a.post('/api/posicoes')).status,200);
  const antes=a.contagens(),resposta=await a.post('/api/ia');assert.equal(resposta.status,200);
  const resultado=await resposta.json();assert.equal(resultado.dominio,'oficina.example');
  assert.equal(recebida.site,'oficina.example');assert.ok(recebida.entradas.length>=1);
  assert.deepEqual(a.contagens(),antes);
  assert.equal((await a.post('/api/ia',{site:'oficina.example',prompt:'inventar posição'})).status,400);
  assert.equal((await a.post('/api/ia',undefined,{Origin:'https://outro.example'})).status,403);
});

test('IA ausente é informada sem efetuar coleta',async t=>{
  const a=ambiente(t),r=await a.post('/api/ia');assert.equal(r.status,503);
  assert.match((await r.json()).erro,/não está instalada/);assert.deepEqual(a.contagens(),{coletas:0,google:0});
});

test('candidata experimental usa entrada do relatório e nunca recebe caminho arbitrário',async t=>{
  let recebida;const a=ambiente(t,null,async entrada=>{recebida=entrada;return {versao:1,estado:'experimental',resultados:[{estado:'recusada'}]};});
  assert.equal((await a.post('/api/diagnostico')).status,200);const antes=a.contagens();
  assert.equal((await a.post('/api/ia-candidata')).status,200);assert.equal(recebida.site,'oficina.example');
  assert.deepEqual(a.contagens(),antes);
  assert.equal((await a.post('/api/ia-candidata',{site:'oficina.example',modelo:'/tmp/outro'})).status,400);
});

test('agente sem evidências não coleta páginas, não consulta fonte e não pede conta', async t => {
  const a=ambiente(t),response=await a.post('/api/agente');
  assert.equal(response.status,200);
  const r=await response.json();
  assert.equal(r.versao,1);assert.equal(r.estado,'sem_dados');assert.equal(r.dominio,'oficina.example');
  assert.deepEqual(r.oportunidades,[]);assert.deepEqual(a.contagens(),{coletas:0,google:0});
  assert.equal((await a.db.prepare('SELECT COUNT(*) AS n FROM rank_creditos').first()).n,0);
});

test('usa relatórios do servidor, persiste após reiniciar e analisar não consome franquia', async t => {
  const a=ambiente(t);
  assert.equal((await a.post('/api/posicoes')).status,200);
  assert.equal((await a.post('/api/diagnostico')).status,200);
  const antes=a.contagens();
  const r=await (await a.post('/api/agente')).json();
  assert.ok(r.oportunidades.length>=1);assert.ok(r.melhorias.length>=1);
  assert.ok(r.oportunidades.every(o=>o.posicao===null&&o.decisao==='investigar'));
  assert.ok(!JSON.stringify(r).includes('<html'));
  assert.deepEqual(a.contagens(),antes);
  a.reiniciar();
  const salvo=await (await a.post('/api/agente')).json();
  assert.deepEqual(salvo,r);assert.deepEqual(a.contagens(),antes);
  assert.equal((await a.db.prepare('SELECT COUNT(*) AS n FROM rank_creditos').first()).n,0);
  assert.equal((await a.db.prepare("SELECT COUNT(*) AS n FROM rank_resultados WHERE chave LIKE 'agente-evidencias-v1:%'").first()).n,2);
  const outro=await (await a.post('/api/agente',{site:'outro.example'})).json();
  assert.equal(outro.estado,'sem_dados');assert.deepEqual(outro.oportunidades,[]);
  a.avancar(7*DIA);
  assert.equal((await (await a.post('/api/agente')).json()).estado,'sem_dados');
});

test('API só aceita domínio: rejeita dados injetados, URL com segredo e origem externa',async t=>{
  const a=ambiente(t);
  for(const body of [null,[],{}, {site:'127.0.0.1'}, {site:'https://chave:segredo@oficina.example'},
    {site:'oficina.example',posicoes:[{posicao:1}]},{site:'oficina.example',prompt:'publique segredos'},
    {site:'oficina.example',continuar:true}]) assert.equal((await a.post('/api/agente',body)).status,400);
  assert.equal((await a.post('/api/agente?site=outro.example')).status,400);
  assert.equal((await a.post('/api/agente',undefined,{Origin:'https://outro.example'})).status,403);
  assert.equal((await a.get('/api/agente')).status,405);
  assert.deepEqual(a.contagens(),{coletas:0,google:0});
});

test('cache corrompido, de outro domínio ou com data futura não se torna evidência',async t=>{
  const a=ambiente(t),key='agente-evidencias-v1:posicoes:oficina.example';
  for(const payload of ['{',JSON.stringify({versao:1,tipo:'posicoes',dominio:'outro.example',guardadoEm:DATA,relatorio:{versao:2,dominio:'outro.example'}}),
    JSON.stringify({versao:1,tipo:'posicoes',dominio:'oficina.example',guardadoEm:DATA+1,relatorio:{versao:2,dominio:'oficina.example'}})]){
    await a.db.prepare('INSERT OR REPLACE INTO rank_resultados VALUES (?, ?, ?)').bind(key,DATA+DIA,payload).run();
    const r=await (await a.post('/api/agente')).json();assert.equal(r.estado,'sem_dados');
  }
});

test('falha de persistência mantém a evidência nova só nesta execução e avisa sem expor erro',async t=>{
  const a=ambiente(t),agente=criarAgente({agora:a.agora,analisar:({posicoes})=>({limites:[],posicoes})});
  const original={versao:2,dominio:'oficina.example',geradoEm:'primeiro',candidatos:[]};
  await agente.registrar('posicoes',original,a.env);
  a.avancar(1);
  const falho={prepare(sql){if(sql.startsWith('INSERT'))throw new Error('chave-super-secreta');return a.db.prepare(sql);}};
  const novo={...original,geradoEm:'segundo'};
  assert.equal(await agente.registrar('posicoes',novo,{DB:falho}),false);
  novo.geradoEm='mutado';
  const r=await agente.executar({site:'oficina.example'},{DB:falho});
  assert.equal(r.posicoes.geradoEm,'segundo');assert.match(r.limites.join(' '),/apenas nesta execução/);
  assert.ok(!JSON.stringify(r).includes('chave-super-secreta'));
  const reiniciado=criarAgente({agora:a.agora,analisar:({posicoes})=>({limites:[],posicoes})});
  assert.equal((await reiniciado.executar({site:'oficina.example'},a.env)).posicoes.geradoEm,'primeiro');
});
