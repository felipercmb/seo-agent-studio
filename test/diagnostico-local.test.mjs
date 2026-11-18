import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {diagnosticarLocal, sondarGravacao, textoDiagnostico} from '../scripts/diagnosticar-local.mjs';

const ativo = {estado:'gravacao_verificada',diretorioExiste:true,escritaVerificada:true,espacoDisponivelBytes:50000};
const sha = b => createHash('sha256').update(b).digest('hex');
async function fixture(t) {
  const raiz = await mkdtemp(join(tmpdir(), 'visibilidade-diag-test-'));
  t.after(() => rm(raiz,{recursive:true,force:true}));
  return raiz;
}
function modulos({parse5=true,sqlite=true,fechar=()=>{}}={}) {
  return async nome => {
    if (nome==='parse5') { if (!parse5) throw new Error('segredo_do_erro'); return {parse:()=>({nodeName:'#document'})}; }
    if (nome==='node:sqlite') {
      if (!sqlite) throw new Error('segredo_do_erro');
      return {DatabaseSync:class {constructor(nome){assert.equal(nome,':memory:');}prepare(sql){assert.equal(sql,'SELECT 1 AS sonda');return {get:()=>({sonda:1})};}close(){fechar();}}};
    }
    assert.fail('Importação não prevista: '+nome);
  };
}
function opcoes(raiz,extras={}) {return {raiz,ambiente:{},versaoNode:'22.22.1',plataforma:'linux',arquitetura:'x64',carregarModulo:modulos(),verificarGravacao:async()=>ativo,...extras};}

test('núcleo pronto sem IA ou fonte é uma capacidade local, sem ranking inventado',async t=>{
  const raiz=await fixture(t), r=await diagnosticarLocal(opcoes(raiz));
  assert.equal(r.estado,'pronto_para_iniciar');
  assert.equal(r.entendimento.estado,'plataforma_nao_suportada');
  assert.equal(r.entendimento.modeloAprovado,false);
  assert.deepEqual(r.fontes.posicoes,{configurada:false,estado:'nao_configurada',consultaExecutada:false});
  assert.equal(r.fontes.demanda.estado,'nao_habilitada');
  assert.equal(r.configuracao.porta,8794);
  assert.match(textoDiagnostico(r),/rankings e concorrentes não observados como indisponíveis/);
});

test('a compatibilidade segue as séries aceitas pelo servidor',async t=>{
  const raiz=await fixture(t);
  for(const [v,ok] of [['22.12.0',false],['22.13.0',true],['22.22.1',true],['24.0.0',true],['23.1.0',false],['25.0.0',false],['20.19.1',false],['segredo',false]]){
    const r=await diagnosticarLocal(opcoes(raiz,{versaoNode:v}));
    assert.equal(r.node.compativel,ok,v);
    assert.equal(r.estado,ok?'pronto_para_iniciar':'requer_correcao',v);
  }
});

test('falha de dependência é sanitizada e bloqueia o núcleo',async t=>{
  const raiz=await fixture(t);
  for(const chave of ['parse5','sqlite']){
    const r=await diagnosticarLocal(opcoes(raiz,{carregarModulo:modulos({[chave]:false})}));
    assert.equal(r.estado,'requer_correcao');
    assert.equal(r.dependencias[chave],'nao_verificado');
    assert.doesNotMatch(JSON.stringify(r),/segredo_do_erro/);
  }
});

test('SQLite da sonda fica em memória e é fechado',async t=>{
  const raiz=await fixture(t);let fechados=0;
  await diagnosticarLocal(opcoes(raiz,{carregarModulo:modulos({fechar:()=>{fechados++;}})}));
  assert.equal(fechados,1);
});

test('a sonda de escrita não toca no banco nem deixa arquivo temporário',async t=>{
  const raiz=await fixture(t),dados=join(raiz,'data');await mkdir(dados);
  const arquivo=join(dados,'visibilidade.sqlite'),conteudo=Buffer.from('banco que não deve ser aberto');await writeFile(arquivo,conteudo);
  const antes=(await readdir(dados)).sort();
  const r=await sondarGravacao(dados);
  assert.equal(r.estado,'gravacao_verificada');assert.equal(r.escritaVerificada,true);
  assert.equal(sha(await readFile(arquivo)),sha(conteudo));
  assert.deepEqual((await readdir(dados)).sort(),antes);
});

test('DATA_DIR ausente tem criação testada no ancestral e continua ausente',async t=>{
  const raiz=await fixture(t),diretorio=join(raiz,'novo','data');
  const r=await sondarGravacao(diretorio);
  assert.equal(r.estado,'criacao_no_ancestral_verificada');assert.equal(r.diretorioExiste,false);assert.equal(r.escritaVerificada,true);
  await assert.rejects(lstat(join(raiz,'novo')),{code:'ENOENT'});
  assert.deepEqual(await readdir(raiz),[]);
});

test('arquivo ou symlink não é aceito como diretório de dados da sonda',async t=>{
  const raiz=await fixture(t),arquivo=join(raiz,'arquivo'),real=join(raiz,'real'),atalho=join(raiz,'atalho');
  await writeFile(arquivo,'preservado');await mkdir(real);await symlink(real,atalho);
  for(const p of [arquivo,atalho]){
    const r=await sondarGravacao(p);assert.equal(r.estado,'alvo_invalido');assert.equal(r.escritaVerificada,false);
  }
  assert.equal(await readFile(arquivo,'utf8'),'preservado');assert.deepEqual(await readdir(real),[]);
});

test('falha e saída não confiável da sonda não viram prontidão nem vazam detalhes',async t=>{
  const raiz=await fixture(t);
  const variantes=[async()=>{throw Error('/Users/privado/segredo');},async()=>({estado:'ok /Users/privado',escritaVerificada:true,diretorioExiste:'token',espacoDisponivelBytes:Infinity,chave:'SEGREDO'})];
  for(const verificarGravacao of variantes){
    const r=await diagnosticarLocal(opcoes(raiz,{verificarGravacao}));
    assert.equal(r.estado,'requer_correcao');assert.equal(r.armazenamento.escritaVerificada,false);
    assert.doesNotMatch(JSON.stringify(r),/Users|privado|SEGREDO|token/);
  }
});

test('.env e variáveis têm a precedência do servidor sem mutar o ambiente global',async t=>{
  const raiz=await fixture(t),segredo='SERPAPI_SEGREDO_123456789';
  await writeFile(join(raiz,'.env'),`PORT=8795\nSERPAPI_KEY=${segredo}\nDATA_DIR=dados_da_empresa_privada\n`);
  const original=process.env.SERPAPI_KEY,bytes=await readFile(join(raiz,'.env'));
  const r=await diagnosticarLocal(opcoes(raiz,{ambiente:{PORT:'8814'}}));
  assert.equal(r.configuracao.porta,8814);assert.equal(r.configuracao.arquivoEnv,'lido');
  assert.equal(r.fontes.posicoes.estado,'configurada_nao_testada');assert.equal(r.fontes.posicoes.consultaExecutada,false);
  assert.equal(process.env.SERPAPI_KEY,original);assert.equal(sha(await readFile(join(raiz,'.env'))),sha(bytes));
  const exibido=JSON.stringify(r)+'\n'+textoDiagnostico(r);
  assert.doesNotMatch(exibido,/SERPAPI_SEGREDO|dados_da_empresa_privada|visibilidade-diag-test-/);
});

test('configuração inválida não faz escrita nem exibe a chave recebida',async t=>{
  const raiz=await fixture(t);let escritas=0;
  const r=await diagnosticarLocal(opcoes(raiz,{ambiente:{SERPAPI_KEY:'curta SECRETA'},verificarGravacao:async()=>{escritas++;return ativo;}}));
  assert.equal(r.estado,'requer_correcao');assert.equal(r.configuracao.estado,'invalida');assert.equal(escritas,0);
  assert.equal(r.fontes.posicoes.estado,'configuracao_invalida');assert.doesNotMatch(JSON.stringify(r),/curta|SECRETA/);
});

test('.env binário, excessivo ou symlink é recusado sem ler configuração arbitrária',async t=>{
  for(const modo of ['binario','excessivo','symlink']){
    const raiz=await fixture(t),p=join(raiz,'.env');
    if(modo==='binario')await writeFile(p,Buffer.from('SERPAPI_KEY=SECRETO\0NAO_EXIBIR'));
    else if(modo==='excessivo')await writeFile(p,'x'.repeat(65537));
    else {await writeFile(join(raiz,'privado'),'SERPAPI_KEY=SECRETO_1234567890');await symlink(join(raiz,'privado'),p);}
    const r=await diagnosticarLocal(opcoes(raiz));
    assert.equal(r.configuracao.arquivoEnv,'invalido',modo);assert.equal(r.estado,'requer_correcao',modo);
    assert.doesNotMatch(JSON.stringify(r),/SECRETO|NAO_EXIBIR/);
  }
});

test('demanda distingue desligada, habilitada incompleta e configurada sem consultar',async t=>{
  const raiz=await fixture(t);
  const incompleta=await diagnosticarLocal(opcoes(raiz,{ambiente:{GOOGLE_ADS_DEMANDA:'1'}}));
  assert.equal(incompleta.fontes.demanda.estado,'habilitada_configuracao_invalida');
  const env={GOOGLE_ADS_DEMANDA:'1',GOOGLE_ADS_CUSTOMER_ID:'1234567890',GOOGLE_ADS_ACCESS_TOKEN:'token_exemplo_local',GOOGLE_ADS_DEVELOPER_TOKEN:'developer_exemplo_local'};
  const r=await diagnosticarLocal(opcoes(raiz,{ambiente:env}));
  assert.equal(r.fontes.demanda.estado,'configurada_nao_testada');assert.equal(r.fontes.demanda.consultaExecutada,false);
  assert.doesNotMatch(JSON.stringify(r),/1234567890|token_exemplo|developer_exemplo/);
});

test('nenhum fetch, subprocesso ou importação Python é necessário ao diagnóstico',async t=>{
  const raiz=await fixture(t),anterior=globalThis.fetch;let chamadas=0;
  globalThis.fetch=()=>{chamadas++;throw Error('nenhuma rede');};
  try {await diagnosticarLocal(opcoes(raiz,{ambiente:{SERPAPI_KEY:'chave_local_de_teste_123456'}}));}
  finally {globalThis.fetch=anterior;}
  assert.equal(chamadas,0);
});

test('presença completa é experimental e não executa o Python nem confere os pesos',async t=>{
  const raiz=await fixture(t),modelo=join(raiz,'data/ia/negocio/modelos/qwen35-4b-4bit-sem-pensamento');
  await mkdir(join(raiz,'.venv-ia/bin'),{recursive:true});
  await writeFile(join(raiz,'.venv-ia/bin/python'),'# Este arquivo não é executado.\n',{mode:0o700});
  await writeFile(join(raiz,'.venv-ia/pyvenv.cfg'),'home = exemplo\n');
  await mkdir(join(raiz,'ia/negocio/jornadas'),{recursive:true});await writeFile(join(raiz,'ia/negocio/jornadas/executar.py'),'raise Exception("nunca executar")');
  await mkdir(modelo,{recursive:true});
  for(const n of ['proveniencia-local.json','model.safetensors','config.json','tokenizer.json','chat_template.jinja'])await writeFile(join(modelo,n),'arquivo controlado sem pesos válidos');
  for(const n of ['mlx','mlx_lm','transformers','outlines_core'])await mkdir(join(raiz,'.venv-ia/lib/python3.14/site-packages',n),{recursive:true});
  const r=await diagnosticarLocal(opcoes(raiz,{plataforma:'darwin',arquitetura:'arm64'}));
  assert.equal(r.entendimento.instalacaoPresente,true);assert.equal(r.entendimento.estado,'instalacao_presente_nao_testada');
  assert.equal(r.entendimento.modeloAprovado,false);assert.match(r.entendimento.limite,/Não testa GPU/);
  await rm(join(modelo,'tokenizer.json'));
  const ausente=await diagnosticarLocal(opcoes(raiz,{plataforma:'darwin',arquitetura:'arm64'}));
  assert.equal(ausente.entendimento.instalacaoPresente,false);assert.equal(ausente.entendimento.modeloPresente,false);
  assert.equal(ausente.entendimento.estado,'instalacao_incompleta');assert.equal(ausente.estado,'pronto_para_iniciar');
});
