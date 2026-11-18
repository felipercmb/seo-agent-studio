import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {iniciarConfigurador} from '../scripts/configurar-fonte.mjs';
import {ErroFonte} from '../src/serpapi.mjs';

const CHAVE='chave_ficticia_para_testes_12345678901234567890';
async function preparar(t,verificar) {
  const pasta=await mkdtemp(join(tmpdir(),'ativar-fonte-')),arquivo=join(pasta,'.env');
  const app=await iniciarConfigurador({porta:0,arquivo,verificar});
  t.after(async()=>{await app.fechar();await rm(pasta,{recursive:true,force:true});});
  const post=(chave,origin=app.endereco)=>fetch(app.endereco+'/configurar',{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({chave})});
  return {...app,arquivo,post};
}

test('valida antes de salvar, usa arquivo privado e nunca devolve a chave',async t=>{
  let verificadas=0;const app=await preparar(t,async chave=>{verificadas++;assert.equal(chave,CHAVE);});
  assert.equal((await fetch(app.endereco)).status,200);
  const r=await app.post(CHAVE),texto=await r.text();
  assert.equal(r.status,200);assert.equal(verificadas,1);assert.ok(!texto.includes(CHAVE));
  assert.equal(await readFile(app.arquivo,'utf8'),'SERPAPI_KEY='+CHAVE+'\n');
  if(process.platform!=='win32')assert.equal((await stat(app.arquivo)).mode&0o777,0o600);
});

test('recusa origem externa, plano incompatível e arquivo preexistente',async t=>{
  let verificadas=0;const app=await preparar(t,async()=>{verificadas++;throw new ErroFonte('plano_incompativel','Plano incompatível.');});
  assert.equal((await app.post(CHAVE,'https://exemplo.com')).status,403);assert.equal(verificadas,0);
  assert.equal((await app.post(CHAVE)).status,400);assert.equal(verificadas,1);
  await assert.rejects(readFile(app.arquivo));
  const outro=await preparar(t,async()=>{});await writeFile(outro.arquivo,'PORT=9999\n');
  assert.equal((await outro.post(CHAVE)).status,409);
  assert.equal(await readFile(outro.arquivo,'utf8'),'PORT=9999\n');
});
