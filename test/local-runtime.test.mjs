import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {abrirBanco} from '../lib/sqlite.mjs';
import {carregarConfiguracao, carregarDotEnv, validarNode, RAIZ_PROJETO} from '../lib/config.mjs';
import {criarServidor} from '../server.mjs';
import {criarFranquia} from '../src/franquia.mjs';

const CHAVE = 'chave_ficticia_apenas_para_testes_1234567890123456789012345678901234';
const temporario = () => mkdtempSync(join(tmpdir(), 'visibilidade-local-'));
const remover = pasta => rmSync(pasta, {recursive: true, force: true});
function consultar(porta, {path = '/', method = 'GET', headers = {}, body} = {}) {
  return new Promise((resolver, rejeitar) => {
    const req = httpRequest({hostname:'127.0.0.1',port:porta,path,method,headers}, res => {
      const partes = [];
      res.on('data', parte => partes.push(parte));
      res.on('end', () => resolver({status:res.statusCode,headers:res.headers,texto:Buffer.concat(partes).toString('utf8')}));
      res.on('error', rejeitar);
    });
    req.on('error', rejeitar);
    req.end(body);
  });
}
async function servidor(t, opcoes = {}) {
  const pasta = temporario();
  let app;
  t.after(async () => { await app?.fechar(); remover(pasta); });
  app = await criarServidor({carregarEnv:false,...opcoes,
    // Isolate every database even when another environment option is supplied.
    env:{PORT:'0',...opcoes.env,DATA_DIR:pasta}});
  return {...app,pasta};
}

test('configuração valida Node, porta e chave sem imprimir valores; diretório relativo usa a raiz', () => {
  const padrao = carregarConfiguracao({env:{},carregarEnv:false});
  assert.equal(padrao.porta,8794);assert.equal(padrao.host,'127.0.0.1');
  assert.equal(padrao.dataDir,join(RAIZ_PROJETO,'data'));assert.equal(padrao.fonteConfigurada,false);
  const relativo = carregarConfiguracao({env:{PORT:'0',DATA_DIR:'./data',HOST:'0.0.0.0',SERPAPI_KEY:CHAVE},carregarEnv:false});
  assert.equal(relativo.porta,0);assert.equal(relativo.host,'127.0.0.1');assert.equal(relativo.dataDir,padrao.dataDir);
  assert.equal(relativo.chave,CHAVE);assert.equal(relativo.fonteConfigurada,true);
  for (const PORT of ['-1','65536','8794x','1.5','']) assert.throws(() => carregarConfiguracao({env:{PORT}}), /PORT/);
  assert.throws(() => carregarConfiguracao({env:{DATA_DIR:'x\u0000y'}}), /DATA_DIR/);
  assert.throws(() => carregarConfiguracao({env:{SERPAPI_KEY:'segredo inválido'}}), erro => {
    assert.match(erro.message,/SERPAPI_KEY/);assert.ok(!erro.message.includes('segredo inválido'));return true;
  });
  for (const versao of ['22.13.0','22.22.1','24.0.0']) assert.doesNotThrow(() => validarNode(versao));
  for (const versao of ['20.19.0','22.12.0','23.0.0','25.0.0','26.0.0','22.x.0']) assert.throws(() => validarNode(versao), /Node.js/);
});

test('.env é opcional e não substitui variáveis já presentes no processo', () => {
  const pasta = temporario(), arquivo = join(pasta,'.env');
  const nome = 'VISIBILIDADE_RUNTIME_TEST_ENV', novo = 'VISIBILIDADE_RUNTIME_TEST_NEW';
  const anterior = process.env[nome], anteriorNovo = process.env[novo];
  try {
    process.env[nome] = 'prioridade-shell';delete process.env[novo];
    writeFileSync(arquivo,nome+'=valor-arquivo\n'+novo+'=carregado\n');
    carregarDotEnv(arquivo);
    assert.equal(process.env[nome],'prioridade-shell');assert.equal(process.env[novo],'carregado');
    assert.doesNotThrow(() => carregarDotEnv(join(pasta,'ausente.env')));
    assert.throws(() => carregarDotEnv(pasta), /Não foi possível ler/);
  } finally {
    if (anterior === undefined) delete process.env[nome]; else process.env[nome] = anterior;
    if (anteriorNovo === undefined) delete process.env[novo]; else process.env[novo] = anteriorNovo;
    remover(pasta);
  }
});

test('SQLite aplica ambas migrações uma vez e cache/cota sobrevivem à reinicialização', async () => {
  const pasta = temporario(), arquivo = join(pasta,'dados','visibilidade.sqlite');
  let db;
  try {
    db = abrirBanco({arquivo});
    const migracoes = await db.prepare('SELECT nome, checksum FROM schema_migrations ORDER BY nome').all();
    assert.deepEqual(migracoes.results.map(m=>m.nome),['0000_ranking_gratuito.sql','0001_cota_dominio.sql']);
    assert.ok(migracoes.results.every(m=>/^[a-f0-9]{64}$/.test(m.checksum)));
    assert.equal(await db.prepare('PRAGMA journal_mode').first('journal_mode'),'wal');
    assert.equal(Object.values(await db.prepare('PRAGMA busy_timeout').first())[0],5000);
    if (process.platform !== 'win32') assert.equal(statSync(arquivo).mode & 0o777,0o600);
    const agora = () => Date.parse('2026-11-14T15:00:00Z'), franquia = criarFranquia(db,agora);
    const relatorio = {dominio:'cliente.com.br',coletadoEm:'2026-11-14T14:59:30Z',posicao:3};
    await franquia.guardar('captura',relatorio);
    const reservas = await Promise.all(Array.from({length:25},()=>franquia.reservar('cliente.com.br')));
    assert.equal(reservas.filter(Boolean).length,20);
    db.close();db.close();
    assert.throws(()=>db.prepare('SELECT 1'),/fechado/);
    db = abrirBanco({arquivo});
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').first('n'),2);
    const reaberta = criarFranquia(db,agora);
    assert.deepEqual(await reaberta.obter('captura'),relatorio);
    assert.equal(await reaberta.reservar('cliente.com.br'),false);
    assert.equal((await reaberta.saldo('cliente.com.br')).dominio,0);
    assert.equal(await db.prepare('SELECT id FROM rank_creditos WHERE dominio = ?').bind('inexistente').first(),null);
  } finally { db?.close();remover(pasta); }
});

test('migrações alteradas são recusadas e uma nova migração inválida é revertida', () => {
  const pasta = temporario(), migracoesDir = join(pasta,'migrations'), arquivo = join(pasta,'visibilidade.sqlite');
  mkdirSync(migracoesDir);
  const nomes = ['0000_ranking_gratuito.sql','0001_cota_dominio.sql'];
  for (const nome of nomes) copyFileSync(new URL('../migrations/'+nome,import.meta.url),join(migracoesDir,nome));
  try {
    abrirBanco({arquivo,migracoesDir}).close();
    const original = readFileSync(join(migracoesDir,nomes[0]),'utf8');
    writeFileSync(join(migracoesDir,nomes[0]),original+'\n-- alterada\n');
    assert.throws(()=>abrirBanco({arquivo,migracoesDir}),/migração aplicada foi modificada/);
    writeFileSync(join(migracoesDir,nomes[0]),original);
    writeFileSync(join(migracoesDir,'0002_falha.sql'),'CREATE TABLE parcial (id INTEGER); INSERT INTO inexistente VALUES (1);');
    assert.throws(()=>abrirBanco({arquivo,migracoesDir}));
    const sqlite = new DatabaseSync(arquivo);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'parcial'").get().n,0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,2);
    sqlite.close();
    writeFileSync(join(migracoesDir,'0002_falha.sql'),'CREATE TABLE parcial (id INTEGER);');
    abrirBanco({arquivo,migracoesDir}).close();
    abrirBanco({arquivo,migracoesDir}).close();
  } finally { remover(pasta); }
});

test('listener só abre loopback e healthz expõe apenas estado neutro', async t => {
  let chamadas = 0;
  const app = await servidor(t,{env:{SERPAPI_KEY:CHAVE},worker:{fetch:async (_req,env)=>{
    chamadas++;assert.equal(env.SERPAPI_KEY,CHAVE);assert.equal(typeof env.DB.prepare,'function');return new Response('worker');
  }}});
  assert.equal(app.server.address().address,'127.0.0.1');
  assert.ok(app.porta > 0);assert.equal(app.endereco,'http://127.0.0.1:'+app.porta);
  const health = await consultar(app.porta,{path:'/healthz'});
  assert.equal(health.status,200);assert.deepEqual(JSON.parse(health.texto),{status:'ok',fonteConfigurada:true});
  assert.ok(!health.texto.includes(CHAVE));assert.ok(!health.texto.includes(app.pasta));
  assert.equal((await consultar(app.porta,{path:'/healthz',method:'HEAD'})).texto,'');
  assert.equal(chamadas,0);assert.equal((await consultar(app.porta)).texto,'worker');
  await app.fechar();await app.fechar();
  await assert.rejects(()=>consultar(app.porta));
});

test('Host e Origin rejeitam DNS rebinding e POST de navegador sem origem; CLI local continua permitido', async t => {
  let chamadas = 0;
  const app = await servidor(t,{worker:{fetch:async req=>{
    chamadas++;assert.equal(req.headers.get('cf-connecting-ip'),null);
    return Response.json({url:req.url,corpo:req.method==='POST'?await req.json():null});
  }}});
  for (const host of ['externo.com:'+app.porta,'127.0.0.1.externo.com:'+app.porta,'localhost.:'+app.porta,
    '127.0.0.1:'+(app.porta===65535?65534:app.porta+1),'usuario@127.0.0.1:'+app.porta]) {
    assert.equal((await consultar(app.porta,{headers:{Host:host}})).status,403);
  }
  const post = {method:'POST',path:'/api/posicoes',body:JSON.stringify({site:'cliente.com.br'})};
  for (const extras of [{Origin:'https://externo.com'},{Origin:'null'},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-origin'}]) {
    assert.equal((await consultar(app.porta,{...post,headers:{'Content-Type':'application/json',...extras}})).status,403);
  }
  assert.equal(chamadas,0);
  assert.equal((await consultar(app.porta,{...post,headers:{'Content-Type':'application/json','CF-Connecting-IP':'falso'}})).status,200);
  assert.equal((await consultar(app.porta,{...post,headers:{'Content-Type':'application/json',Origin:app.endereco,'Sec-Fetch-Site':'same-origin'}})).status,200);
  const localhost='http://localhost:'+app.porta;
  const local = await consultar(app.porta,{...post,headers:{Host:'localhost:'+app.porta,Origin:localhost,'Content-Type':'application/json'}});
  assert.equal(local.status,200);assert.equal(JSON.parse(local.texto).url,localhost+'/api/posicoes');
  assert.equal(chamadas,3);
  assert.equal((await consultar(app.porta,{...post,body:'x'.repeat(4097),headers:{'Content-Type':'application/json'}})).status,413);
  assert.equal(chamadas,3);
});

test('Worker real serve HTML e usa o transporte injetado tanto para coleta quanto para SERP', async t => {
  const urls = [];
  const fetchPublico = async valor => {
    const url = new URL(valor);urls.push(url);
    if (['dns.google','cloudflare-dns.com'].includes(url.hostname)) return Response.json({Status:0,Answer:url.searchParams.get('type')==='A'?[{type:1,data:'93.184.215.14'}]:[]});
    if (url.hostname==='cliente.com.br') {
      if (url.pathname==='/robots.txt'||url.pathname==='/sitemap.xml') return new Response(null,{status:404});
      return new Response('<title>Consultoria ambiental</title><h1>Consultoria ambiental</h1>',{headers:{'Content-Type':'text/html'}});
    }
    assert.equal(url.hostname,'serpapi.com');
    if (url.pathname==='/account.json') return Response.json({account_status:'Active',plan_id:'free',plan_name:'Free Plan',plan_monthly_price:0,
      plan_renewal_date:'2027-01-01',searches_per_month:250,plan_searches_left:249,total_searches_left:249,extra_credits:0,
      this_month_usage:1,this_hour_searches:0,account_rate_limit_per_hour:50});
    assert.equal(url.pathname,'/search.json');
    return Response.json({search_metadata:{id:'captura_runtime_123',status:'Success',created_at:new Date().toISOString()},
      search_parameters:{engine:'google',q:url.searchParams.get('q'),gl:'br',hl:'pt',google_domain:'google.com.br',device:'desktop',location_requested:'Brazil',location_used:'Brazil',start:0},
      organic_results:[{position:1,title:'Concorrente',link:'https://rival.com.br/'},{position:2,title:'Cliente',link:'https://cliente.com.br/'}]});
  };
  const app = await servidor(t,{env:{SERPAPI_KEY:CHAVE},fetchPublico});
  const pagina = await consultar(app.porta);
  assert.equal(pagina.status,200);assert.match(pagina.headers['content-type'],/text\/html/);assert.ok(pagina.texto.includes('<html'));
  assert.equal((await consultar(app.porta,{path:'/api/env'})).status,404);
  const post = continuar => consultar(app.porta,{path:'/api/posicoes',method:'POST',headers:{Origin:app.endereco,'Content-Type':'application/json'},body:JSON.stringify({site:'cliente.com.br',...(continuar?{continuar:true}:{})})});
  const inicial=JSON.parse((await post(false)).texto);
  assert.equal(inicial.candidatos.length,1);assert.deepEqual(inicial.consultas,[]);
  assert.ok(!urls.some(u=>u.hostname==='serpapi.com'));
  const resultado=JSON.parse((await post(true)).texto);
  assert.equal(resultado.consultas[0].posicao,2);
  assert.deepEqual(urls.filter(u=>u.hostname==='serpapi.com').map(u=>u.pathname),['/account.json','/search.json']);
  assert.ok(!JSON.stringify(resultado).includes(CHAVE));
});

test('SIGINT e SIGTERM fecham o executável e deixam o banco reutilizável', {skip:process.platform==='win32'}, async t => {
  for (const sinal of ['SIGINT','SIGTERM']) await t.test(sinal,async () => {
    const pasta=temporario();
    const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{
      cwd:RAIZ_PROJETO,env:{...process.env,PORT:'0',DATA_DIR:pasta,SERPAPI_KEY:''},stdio:['ignore','pipe','pipe'],
    });
    let pronto=false,timer;
    try {
      await new Promise((resolver,rejeitar)=>{
        timer=setTimeout(()=>rejeitar(new Error('Servidor não iniciou no prazo do teste')),10_000);
        let texto='';
        child.stdout.on('data',parte=>{texto+=parte.toString();if(/disponível em http:\/\/127\.0\.0\.1:\d+/.test(texto)){pronto=true;resolver();}});
        child.once('error',rejeitar);
        child.once('exit',()=>{if(!pronto)rejeitar(new Error('Servidor encerrou antes de iniciar'));});
      });
      clearTimeout(timer);
      const encerrado=once(child,'exit');child.kill(sinal);
      const [codigo,recebido]=await encerrado;
      assert.equal(codigo,0);assert.equal(recebido,null);
      abrirBanco({arquivo:join(pasta,'visibilidade.sqlite')}).close();
    } finally { clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');remover(pasta); }
  });
});
