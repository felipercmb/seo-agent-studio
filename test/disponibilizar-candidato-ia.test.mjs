import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,lstat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {disponibilizarCandidatoIA,argumentosCandidato} from '../scripts/disponibilizar-candidato-ia.mjs';

const hash = v => createHash('sha256').update(v).digest('hex');
const agora = () => Date.parse('2026-11-15T20:00:00Z');
async function ambiente(t) {
  const dir=await mkdtemp(join(tmpdir(),'candidato-local-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const modelo=join(dir,'modelo'),destino=join(dir,'candidato');await mkdir(modelo);
  const pesos=Buffer.from('fixture de pesos: não é um modelo real'),config=Buffer.from('{"lora_layers":4}');
  await writeFile(join(modelo,'adapters.safetensors'),pesos);await writeFile(join(modelo,'adapter_config.json'),config);
  const s={versao:1,tipo:'acoes',aprovado_para_uso_autonomo:false,adaptador_sha256:hash(pesos),
    candidato:{pasta:modelo,base:false,adaptador_sha256:hash(pesos),config_adaptador_sha256:hash(config)}};
  const selecao=join(dir,'selecao.json'),decisao=join(dir,'decisao.json');
  const salvar=async()=>{const bytes=JSON.stringify(s,null,2)+'\n';await writeFile(selecao,bytes);await writeFile(decisao,JSON.stringify({estado:'experimental_disponivel',selecao_sha256:hash(bytes),aprovado_para_uso_autonomo:false}));};
  await salvar();return{dir,modelo,selecao,decisao,destino,s,salvar,opcoes:{selecao,decisao,destino,agora}};
}

test('cópia local preserva bytes/hashes, gera auditoria e mantém pesos e seleção padrão',async t=>{
  const a=await ambiente(t),padrao=join(a.dir,'selecao-interface.json');await writeFile(padrao,'padrao preservado');
  const antesS=await readFile(a.selecao),antesD=await readFile(a.decisao),antesP=await readFile(join(a.modelo,'adapters.safetensors'));
  const r=await disponibilizarCandidatoIA(a.opcoes);
  assert.equal(r.estado,'experimental_disponivel');assert.equal(r.aprovado_para_uso_autonomo,false);
  assert.deepEqual(await readFile(join(a.destino,'selecao-interface-candidata.json')),antesS);
  assert.deepEqual(await readFile(join(a.destino,'decisao-interface-candidata.json')),antesD);
  assert.deepEqual(await readFile(join(a.modelo,'adapters.safetensors')),antesP);
  assert.equal(await readFile(padrao,'utf8'),'padrao preservado');
  assert.equal(JSON.parse(await readFile(join(a.destino,'disponibilizacao.json'),'utf8')).selecao.sha256,hash(antesS));
  assert.equal(r.criadoEm,'2026-11-15T20:00:00.000Z');
  if(process.platform!=='win32')assert.equal((await lstat(join(a.destino,'selecao-interface-candidata.json'))).mode&0o777,0o600);
});

test('destino existente nunca é sobrescrito e tentativa repetida preserva os arquivos',async t=>{
  const a=await ambiente(t);await disponibilizarCandidatoIA(a.opcoes);
  const anterior=await readFile(join(a.destino,'selecao-interface-candidata.json'));
  await assert.rejects(disponibilizarCandidatoIA(a.opcoes),/diretório novo/);
  assert.deepEqual(await readFile(join(a.destino,'selecao-interface-candidata.json')),anterior);
});

test('seleção alterada após decisão é recusada antes de criar destino',async t=>{
  const a=await ambiente(t);await writeFile(a.selecao,(await readFile(a.selecao,'utf8'))+' ');
  await assert.rejects(disponibilizarCandidatoIA(a.opcoes),/hash exato/);
  await assert.rejects(lstat(a.destino),e=>e.code==='ENOENT');
});

test('decisão de produção, aprovação autônoma ou estado anterior não são aceitos',async t=>{
  const a=await ambiente(t);
  for(const estado of ['aprovado','manter_selecao_anterior','experimental','']){
    const d=JSON.parse(await readFile(a.decisao,'utf8'));d.estado=estado;await writeFile(a.decisao,JSON.stringify(d));
    await assert.rejects(disponibilizarCandidatoIA(a.opcoes));await a.salvar();
  }
  a.s.aprovado_para_uso_autonomo=true;await a.salvar();await assert.rejects(disponibilizarCandidatoIA(a.opcoes),/uso autônomo/);
  a.s.aprovado_para_uso_autonomo=false;await a.salvar();const d=JSON.parse(await readFile(a.decisao,'utf8'));d.aprovado_para_uso_autonomo=true;await writeFile(a.decisao,JSON.stringify(d));
  await assert.rejects(disponibilizarCandidatoIA(a.opcoes));
});

test('pesos e configuração adulterados ou hashes internos divergentes são recusados',async t=>{
  const a=await ambiente(t),arquivo=join(a.modelo,'adapters.safetensors'),pesos=await readFile(arquivo);
  await writeFile(arquivo,'pesos adulterados');await assert.rejects(disponibilizarCandidatoIA(a.opcoes),/diferem/);
  await writeFile(arquivo,pesos);await writeFile(join(a.modelo,'adapter_config.json'),'{"alterado":true}');
  await assert.rejects(disponibilizarCandidatoIA(a.opcoes),/diferem/);
  a.s.candidato.adaptador_sha256='0'.repeat(64);await a.salvar();
  await assert.rejects(disponibilizarCandidatoIA(a.opcoes),/hashes coerentes/);
});

test('arquivos ausentes, links simbólicos e JSON inválido são recusados sem executar conteúdo',async t=>{
  const a=await ambiente(t),original=await readFile(a.selecao);await writeFile(a.selecao,'{"broken":');
  await assert.rejects(disponibilizarCandidatoIA(a.opcoes),/JSON UTF-8/);await writeFile(a.selecao,original);
  await writeFile(a.selecao,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),original]));
  await assert.rejects(disponibilizarCandidatoIA(a.opcoes),/JSON UTF-8/);await writeFile(a.selecao,original);
  await rm(a.selecao);await symlink(a.decisao,a.selecao);await assert.rejects(disponibilizarCandidatoIA(a.opcoes),/simbólicos/);
  await rm(a.selecao);await assert.rejects(disponibilizarCandidatoIA(a.opcoes),/arquivo local/);
});

test('CLI valida argumentos, não expõe conteúdo e encerra com erro em adulteração',async t=>{
  assert.deepEqual(argumentosCandidato(['--selecao','a','--decisao','b']),{selecao:'a',decisao:'b'});
  for(const argv of [[],['--selecao'],['--selecao','a','--decisao','b','--selecao','c'],['--force','1']])assert.throws(()=>argumentosCandidato(argv));
  const a=await ambiente(t);await writeFile(a.decisao,'{"erro":"segredo_ficticio_nunca_imprimir"}');
  const r=spawnSync(process.execPath,['scripts/disponibilizar-candidato-ia.mjs','--selecao',a.selecao,'--decisao',a.decisao,'--destino',a.destino],{encoding:'utf8'});
  assert.equal(r.status,1);assert.ok(!r.stderr.includes('segredo_ficticio_nunca_imprimir'));assert.equal(r.stdout,'');
});
