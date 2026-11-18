import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {lerCapturaLocal} from '../scripts/preparar-ia-capturas.mjs';

async function captura(t,alterar=()=>{}) {
  const pasta=await mkdtemp(join(tmpdir(),'ia-captura-'));t.after(()=>rm(pasta,{recursive:true,force:true}));
  const html='<h1>Conserto de bicicletas</h1>',sha=createHash('sha256').update(html).digest('hex');
  const r={versao:1,dominio:'oficina.example',coletadoEm:'2026-11-15T19:00:00Z',split:'development',
    arquivos:[{arquivo:'pagina-01.html',url:'https://oficina.example/',status:200,coletadoEm:'2026-11-15T18:59:00Z',sha256_utf8_local:sha}]};
  alterar(r);await writeFile(join(pasta,'registro.json'),JSON.stringify(r));await writeFile(join(pasta,'pagina-01.html'),html);
  return {pasta,r,html};
}

test('leitura local preserva HTML, data original e hashes sem produzir dados de ranking',async t=>{
  const a=await captura(t),r=await lerCapturaLocal(a.pasta);
  assert.equal(r.coleta.paginas[0].html,a.html);assert.equal(r.coleta.paginas[0].coletadoEm,'2026-11-15T18:59:00Z');
  assert.equal(r.coleta.paginas[0].sha256,a.r.arquivos[0].sha256_utf8_local);assert.equal(r.coleta.posicoes,undefined);
  assert.equal(r.origem.paginas.length,1);assert.equal(r.origem.splitHistorico,'development');
});
test('HTML alterado depois da captura interrompe a preparação',async t=>{
  const a=await captura(t);await writeFile(join(a.pasta,'pagina-01.html'),'Conteúdo trocado.');
  await assert.rejects(lerCapturaLocal(a.pasta),/hash registrado/);
});
test('nome fora da pasta é recusado antes de tentar abrir outro arquivo',async t=>{
  const a=await captura(t,r=>{r.arquivos[0].arquivo='../fora.html';});
  await assert.rejects(lerCapturaLocal(a.pasta),/Nome de captura/);
});
test('duplicatas ou excesso de páginas não geram cobertura silenciosamente incorreta',async t=>{
  for(const alterar of [r=>r.arquivos.push({...r.arquivos[0]}),r=>{r.arquivos=Array.from({length:13},(_,i)=>({...r.arquivos[0],arquivo:'pagina-'+String(i+1).padStart(2,'0')+'.html'}));}]){
    const a=await captura(t,alterar);await assert.rejects(lerCapturaLocal(a.pasta),/fora dos limites/);
  }
});
