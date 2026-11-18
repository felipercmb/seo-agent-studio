import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {prepararRevisaoModular,citarShellPosix} from '../scripts/preparar-revisao-modular.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
test('exemplo de comando usa aspas POSIX preservando apóstrofes e metacaracteres literalmente',()=>{
  const caminho="pasta d'água/$(comando) `outra`";
  assert.equal(citarShellPosix(caminho),"'pasta d'\\''água/$(comando) `outra`'");
  assert.equal(citarShellPosix(''),"''");
});
async function ambiente(t){
  const temp=await mkdtemp(join(tmpdir(),'revisao-modular-')),saida=resolve('data/ia/robustez/coleta-revisao-teste-'+randomUUID());
  t.after(async()=>{await rm(temp,{recursive:true,force:true});await rm(saida,{recursive:true,force:true});});
  const html='<html><h1>Serviço público de exemplo</h1></html>',url='https://exemplo.com.br/',data='2026-11-15T20:00:00Z';
  const captura=JSON.stringify({dominio:'exemplo.com.br',coletadoEm:data,paginas:[{url,html,status:200,coletadoEm:data,sha256:hash(html)}]});
  await writeFile(join(temp,'captura.json'),captura);
  const c={versao:1,relogioReferencia:data,casos:Array.from({length:2},(_,i)=>({id:'caso-'+i,dominio:'exemplo.com.br',split:'rótulo de seleção que deve sumir',alvos:['ALVO_AUTOMATICO_OCULTO'],motivoRotulo:'MOTIVO_OCULTO',origem:{arquivoCaptura:'captura.json',capturaSha256:hash(captura)},
    entrada:{site:'exemplo.com.br',objetivo:'Qual próximo passo?',evidencias:[{id:'p1',tipo:'pagina',pagina:url,atual:true,observado_em:data,sha256_pagina:hash(html),descricao:'Serviço público de exemplo'}],dados_negocio:{margem:null}}}))};
  const corpus=join(temp,'corpus.json'),avaliacao=join(temp,'avaliacao.json'),bytes=JSON.stringify(c);await writeFile(corpus,bytes);
  const a={corpusSha256:hash(bytes),adaptadorSha256:'a'.repeat(64),relogioReferencia:data,resultados:c.casos.map(x=>({id:x.id,split:'split_oculto',alvos:['ALVO_AUTOMATICO_OCULTO'],saidaBruta:'{"acao":"validar_demanda","evidencias":["p1"]}',escolhaCrua:{acao:'validar_demanda',evidencias:['p1']},saidaHibrida:{estado:'revisao_necessaria',origem:'ia',escolha_ia:{acao:'validar_demanda',evidencias:['p1']},orientacao_padrao:'Conferir procura'},saidaCruaComBarreiras:{estado:'recusada',origem:'ia',escolha_ia:{acao:'validar_demanda',evidencias:['p1']},motivos_aplicabilidade:['Motivo de recusa']}}))};
  await writeFile(avaliacao,JSON.stringify(a));return{temp,saida,corpus,avaliacao,c,a,opcoes:{corpus,avaliacao,capturas:temp,saida}};
}
test('pacote mantém todos os contextos e evidências e oculta os alvos automáticos',async t=>{
  const a=await ambiente(t),r=await prepararRevisaoModular(a.opcoes),roteiro=await readFile(join(a.saida,'roteiro-cego.json'),'utf8');
  assert.equal(r.contextos,2);assert.equal(r.revisaoHumanaRealizada,false);assert.equal(r.capturas,1);
  assert.ok(!roteiro.includes('ALVO_AUTOMATICO_OCULTO'));assert.ok(!roteiro.includes('MOTIVO_OCULTO'));assert.ok(!roteiro.includes('split_oculto'));
  const casos=(await readFile(join(r.dados,'casos-test.jsonl'),'utf8')).trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(casos.length,2);assert.ok(casos.every(c=>!Object.hasOwn(c,'alvos')));
});
test('pacote é compatível com o validador Python existente quando Python está instalado',async t=>{
  const a=await ambiente(t),r=await prepararRevisaoModular(a.opcoes);
  const script="import sys;from pathlib import Path;sys.path.insert(0,str(Path.cwd()/'ia/robustez'));from revisar import verificar_arquivos,arquivos_da_captura;c,r=verificar_arquivos(Path(sys.argv[1]),Path(sys.argv[2]));assert len(c)==2;assert all(len(arquivos_da_captura(x))==1 for x in c.values());print('compatível')";
  const p=spawnSync('python3',['-c',script,r.dados,r.avaliacao],{encoding:'utf8'});
  if(p.error?.code==='ENOENT'){t.skip('Python3 não está instalado; verificações Node do pacote continuam nos demais testes.');return;}
  assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/compatível/);
});
test('IDs ou hash do corpus divergentes são recusados, sem seleção parcial',async t=>{
  const a=await ambiente(t);a.a.resultados.pop();await writeFile(a.avaliacao,JSON.stringify(a.a));
  await assert.rejects(prepararRevisaoModular(a.opcoes),/todos os casos/);await assert.rejects(lstat(a.saida),e=>e.code==='ENOENT');
  a.a.corpusSha256='0'.repeat(64);await writeFile(a.avaliacao,JSON.stringify(a.a));await assert.rejects(prepararRevisaoModular(a.opcoes),/não conferem/);
});
test('HTML alterado não vira evidência e saída existente não é substituída',async t=>{
  const a=await ambiente(t);await prepararRevisaoModular(a.opcoes);const antes=await readFile(join(a.saida,'manifest.json'));
  await assert.rejects(prepararRevisaoModular(a.opcoes));assert.deepEqual(await readFile(join(a.saida,'manifest.json')),antes);
  await rm(a.saida,{recursive:true,force:true});const p=JSON.parse(await readFile(join(a.temp,'captura.json'),'utf8'));p.paginas[0].html+='alteração';const raw=JSON.stringify(p);await writeFile(join(a.temp,'captura.json'),raw);a.c.casos.forEach(c=>c.origem.capturaSha256=hash(raw));const cb=JSON.stringify(a.c);await writeFile(a.corpus,cb);a.a.corpusSha256=hash(cb);await writeFile(a.avaliacao,JSON.stringify(a.a));
  await assert.rejects(prepararRevisaoModular(a.opcoes),/HTML público alterado/);
});
test('modo cru conserva recusas e nenhuma anotação humana é criada',async t=>{
  const a=await ambiente(t),r=await prepararRevisaoModular({...a.opcoes,modo:'crua'});const convertido=JSON.parse(await readFile(r.avaliacao,'utf8'));
  assert.ok(convertido.resultados.every(x=>x.aceita===false));assert.equal(convertido.resultados.length,2);
  await assert.rejects(lstat(join(a.saida,'parecer.jsonl')),e=>e.code==='ENOENT');
});
