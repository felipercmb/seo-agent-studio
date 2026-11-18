import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {argumentos,analisarRelacoes} from '../scripts/analisar-relacoes.mjs';

test('CLI exige fonte única e não aceita argumento solto',()=>{
  assert.throws(()=>argumentos(['--site','exemplo.com','--captura','a.json','--saida','x']));
  assert.throws(()=>argumentos(['--saida','x']));assert.throws(()=>argumentos(['--site']));
  assert.throws(()=>argumentos(['--site','exemplo.com','--saida','x','--api','paga']));
});

test('CLI permite repetir captura local sem site nem conta',()=>{
  assert.deepEqual(argumentos(['--captura','a.json','--saida','x']),{captura:'a.json',saida:'x'});
});

test('CLI recusa pasta existente antes de coletar ou invocar modelo',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'relacoes-preservar-'));
  try{await assert.rejects(()=>analisarRelacoes({captura:'arquivo-que-nao-existe.json',saida:dir}),{code:'EEXIST'});}
  finally{await rm(dir,{recursive:true});}
});

test('CLI cria os pais de uma saída nova sem sobrescrever diretórios existentes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'relacoes-pais-')),saida=join(dir,'grupo','analise');
  try{
    // The expected error is the missing input, after destination preparation.
    await assert.rejects(()=>analisarRelacoes({captura:join(dir,'ausente.json'),saida}),{code:'ENOENT'});
    assert.ok((await stat(saida)).isDirectory());
  }finally{await rm(dir,{recursive:true});}
});
