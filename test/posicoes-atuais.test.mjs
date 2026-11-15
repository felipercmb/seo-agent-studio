import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {criarPosicoesAtuais} from '../src/posicoes-atuais.mjs';
import {criarFranquia} from '../src/franquia.mjs';
import {criarWorker} from '../src/worker.mjs';
import {consultarGoogle} from '../src/serpapi.mjs';

const CHAVE = 'chave_ficticia_apenas_para_testes_1234567890123456789012345678901234';
const INSTANTE = Date.parse('2026-11-14T15:00:00Z');
const HORA = 3600_000, DIA = 86400_000;
const TERMOS = ['Consultoria ambiental','Licenciamento ambiental','Gestão de resíduos','Manutenção de equipamentos','Auditoria ambiental','Tratamento de água'];
const MIGRACOES = ['0000_ranking_gratuito.sql','0001_cota_dominio.sql'].map(nome => readFileSync(new URL('../migrations/' + nome, import.meta.url), 'utf8'));
function banco(t) {
  const sqlite = new DatabaseSync(':memory:');
  for (const sql of MIGRACOES) sqlite.exec(sql);
  t.after(() => sqlite.close());
  const db = {prepare(sql) { return {bind(...valores) { return {
    async first() { return sqlite.prepare(sql).get(...valores) ?? null; },
    async run() { return sqlite.prepare(sql).run(...valores); },
  }; }}; }};
  return {db, sqlite};
}
function coleta(dominio, termos, instante) {
  const html = '<html lang="pt-BR"><head></head><body>' + termos.map((s,i) => '<h' + (i ? 2 : 1) + '>' + s + '</h' + (i ? 2 : 1) + '>').join('') + '</body></html>';
  return {dominio, coletadoEm: new Date(instante).toISOString(), falhas: [], paginas: [{url:'https://' + dominio + '/', html, status:200,
    coletadoEm:new Date(instante).toISOString(),sha256:createHash('sha256').update(html).digest('hex')}]};
}
function fixtureFonte(agora, opcoes = {}) {
  const chamadas = [], buscas = [];
  const fetch = async endereco => {
    const url = new URL(endereco);
    assert.equal(url.origin,'https://serpapi.com');
    chamadas.push(url.pathname);
    if (url.pathname === '/account.json') {
      await opcoes.aoAccount?.();
      return Response.json({account_status:'Active',plan_id:'free',plan_name:'Free Plan',plan_monthly_price:0,plan_renewal_date:'2026-12-14',
        searches_per_month:250,plan_searches_left:249,extra_credits:0,total_searches_left:249,this_month_usage:1,this_hour_searches:0,
        account_rate_limit_per_hour:50,...opcoes.conta},{status:opcoes.statusConta || 200});
    }
    assert.equal(url.pathname,'/search.json');
    const ctx = {termo:url.searchParams.get('q'),inicio:Number(url.searchParams.get('start'))};
    ctx.pagina=ctx.inicio/10+1; ctx.numero=buscas.length+1; buscas.push(ctx);
    await opcoes.aoSearch?.(ctx);
    if(opcoes.falhar?.(ctx))return new Response('detalhe privado da fonte',{status:503});
    const links = opcoes.resultados?.(ctx) ?? Array.from({length:10},(_,i) => 'https://' +
      (i===2 && opcoes.encontrar!==false?'cliente.com.br':'rival'+i+'.com.br') + '/pagina-'+ctx.inicio+'-'+i);
    const data=typeof opcoes.coletadoEm==='function'?opcoes.coletadoEm(ctx):opcoes.coletadoEm||new Date(agora()-1000).toISOString();
    const continuar=typeof opcoes.continuar==='function'?opcoes.continuar(ctx):!!opcoes.continuar;
    const proxima=new URL('/search.json','https://serpapi.com');
    for(const[k,v]of Object.entries({engine:'google',q:ctx.termo,gl:'br',hl:'pt',google_domain:'google.com.br',device:'desktop',location:'Brazil',start:ctx.inicio+links.length}))proxima.searchParams.set(k,String(v));
    return Response.json({search_metadata:{id:'captura_fixture_'+ctx.numero,status:'Success',created_at:data,processed_at:data},
      search_parameters:{engine:'google',q:ctx.termo,gl:'br',hl:'pt',google_domain:'google.com.br',device:'desktop',location_requested:'Brazil',location_used:'Brazil',start:ctx.inicio},
      search_information:{page_number:ctx.pagina,query_displayed:ctx.termo,organic_results_state:'Results for exact spelling'},
      organic_results:links.map((link,i)=>({position:i+1,title:'Resultado '+(ctx.inicio+i+1),link})),
      ...(continuar?{serpapi_pagination:{current:ctx.pagina,next:opcoes.proxima || proxima.href}}:{}),
      related_searches:(opcoes.relacionadas?.(ctx)||[]).map(query=>({query})),
    });
  };
  return {chamadas,buscas,consultar:(entrada,opcoes)=>consultarGoogle(entrada,{...opcoes,fetch})};
}
function ambiente(t,{termos=[TERMOS[0]],fonte={},coletar}={}) {
  const {db,sqlite}=banco(t);
  let instante=INSTANTE,coletas=0;
  const agora=()=>instante,relogio={agora,avancar:ms=>{instante+=ms;}};
  const provedor=fixtureFonte(agora,typeof fonte==='function'?fonte(relogio):fonte);
  const opcoes={agora,consultarGoogle:provedor.consultar,coletar:async(d,o)=>{coletas++;return coletar?coletar(d,o,relogio):coleta(d,termos,agora());}};
  const env={DB:db,SERPAPI_KEY:CHAVE},posicoes=criarPosicoesAtuais(opcoes);
  return {db,sqlite,opcoes,env,posicoes,provedor,...relogio,coletas:()=>coletas,
    creditos:()=>sqlite.prepare('SELECT COUNT(*) AS n FROM rank_creditos').get().n,
    inicial:(dominio='cliente.com.br',instancia=posicoes)=>instancia({site:dominio},env),
    lote:(dominio='cliente.com.br',instancia=posicoes)=>{instante+=3001;return instancia({site:dominio,continuar:true},env);},
  };
}
function request(body={site:'cliente.com.br'},headers={},caminho='/api/posicoes') {
  return new Request('https://portal.com'+caminho,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://portal.com',...headers},body:JSON.stringify(body)});
}

test('primeira consulta só descobre; continuar explícito executa até quatro páginas por lote',async t=>{
  const a=ambiente(t,{termos:TERMOS}),inicial=await a.inicial();
  assert.equal(inicial.versao,2);assert.equal(inicial.candidatos.length,6);
  assert.equal(inicial.cobertura.limiteTermos,100);assert.equal(inicial.descoberta.limitePaginas,12);
  assert.equal(inicial.progresso.continuar,true);assert.deepEqual(inicial.consultas,[]);
  assert.deepEqual(a.provedor.chamadas,[]);assert.equal(a.creditos(),0);
  const primeiro=await a.lote();
  assert.equal(primeiro.progresso.paginasNesteLote,4);assert.equal(primeiro.cobertura.verificadas,4);
  assert.equal(a.creditos(),4);assert.equal(a.provedor.buscas.length,4);
  assert.ok(primeiro.consultas.every(c=>c.posicao===3));
  const segundo=await a.lote();
  assert.equal(segundo.cobertura.finalizadas,6);assert.equal(segundo.estado,'verificado');
  assert.equal(a.creditos(),6);assert.equal(a.coletas(),1);
  assert.ok(!JSON.stringify(segundo).includes(CHAVE));assert.ok(!JSON.stringify(segundo).includes('<html'));
});

test('agente usa a captura paginada validada pelo conector e não chama a fonte ao recomendar',async t=>{
  const a=ambiente(t,{termos:['Orçamento de consultoria ambiental'],fonte:{continuar:true,
    resultados:({inicio})=>Array.from({length:10},(_,i)=>
      'https://'+(inicio===10&&i===2?'cliente.com.br':'rival'+(inicio+i)+'.com.br')+'/oferta')}});
  let worker=criarWorker('<title>Teste</title>',a.opcoes);
  const post=(path,body)=>worker.fetch(request(body,{},path),a.env);
  await post('/api/posicoes',{site:'cliente.com.br'});
  a.avancar(3001);
  const rank=await (await post('/api/posicoes',{site:'cliente.com.br',continuar:true})).json();
  assert.equal(rank.consultas[0].posicao,13);
  const chamadas=a.provedor.chamadas.length,creditos=a.creditos(),coletas=a.coletas();
  const plano=await (await post('/api/agente',{site:'cliente.com.br'})).json();
  assert.equal(plano.resumo.posicoesAtuais,1);
  assert.equal(plano.oportunidades[0].posicao,13);
  assert.equal(plano.oportunidades[0].decisao,'priorizar');
  assert.equal(plano.oportunidades[0].paginaAlvo,'https://cliente.com.br/oferta');
  assert.equal(plano.oportunidades[0].concorrentes.length,5);
  assert.equal(plano.oportunidades[0].evidencias.filter(e=>e.tipo==='google').length,2);
  assert.ok(!JSON.stringify(plano).includes(CHAVE));
  worker=criarWorker('<title>Teste</title>',a.opcoes);
  assert.deepEqual(await (await post('/api/agente',{site:'cliente.com.br'})).json(),plano);
  a.avancar(HORA);
  const antigo=await (await post('/api/agente',{site:'cliente.com.br'})).json();
  assert.equal(antigo.oportunidades[0].posicao,null);assert.equal(antigo.oportunidades[0].decisao,'investigar');
  assert.deepEqual([a.provedor.chamadas.length,a.creditos(),a.coletas()],[chamadas,creditos,coletas]);
});

test('abrir novamente ou repetir antes de três segundos não inicia outro lote',async t=>{
  const a=ambiente(t,{termos:TERMOS});await a.inicial();await a.lote();
  const outra=criarPosicoesAtuais(a.opcoes);await a.inicial('cliente.com.br',outra);
  await outra({site:'cliente.com.br',continuar:true},a.env);
  assert.equal(a.provedor.buscas.length,4);assert.equal(a.coletas(),1);assert.equal(a.creditos(),4);
});

test('grupo de quatro termos percorre páginas em rodízio antes de iniciar o quinto',async t=>{
  const a=ambiente(t,{termos:TERMOS,fonte:{encontrar:false,continuar:true}}),inicio=await a.inicial();
  const quatro=inicio.candidatos.slice(0,4).map(c=>c.termo);
  await a.lote();assert.deepEqual(a.provedor.buscas.map(b=>[b.termo,b.inicio]),quatro.map(t=>[t,0]));
  await a.lote('cliente.com.br',criarPosicoesAtuais(a.opcoes));
  assert.deepEqual(a.provedor.buscas.slice(4).map(b=>[b.termo,b.inicio]),quatro.map(t=>[t,10]));assert.equal(a.coletas(),1);
});

test('cinco páginas por termo é o teto; encontrado encerra antes disso',async t=>{
  await t.test('cinco páginas',async st=>{
    const a=ambiente(st,{fonte:{encontrar:false,continuar:true}});await a.inicial();
    assert.equal((await a.lote()).consultas[0].paginas.length,4);
    const r=await a.lote(),q=r.consultas[0];
    assert.equal(q.paginas.length,5);assert.equal(q.interrompidaPor,'limite_paginas');assert.equal(q.concluida,true);
    assert.equal(q.posicao,null);assert.equal(q.profundidadeObservada,50);assert.equal(a.provedor.buscas.length,5);
    await a.lote();assert.equal(a.provedor.buscas.length,5);
  });
  await t.test('encontrado na segunda página',async st=>{
    const a=ambiente(st,{fonte:{continuar:true,resultados:({inicio})=>Array.from({length:10},(_,i)=>
      'https://'+(inicio===10&&i===2?'cliente.com.br':'rival'+(inicio+i)+'.com.br')+'/oferta')}});
    await a.inicial();const q=(await a.lote()).consultas[0];
    assert.equal(q.posicao,13);assert.equal(q.posicaoNaPagina,3);assert.equal(q.pagina,2);assert.equal(q.paginas.length,2);
    assert.equal(q.acima.length,12);assert.ok(q.acima.every(c=>c.posicao<13&&c.coletadoEm&&c.fonte.id));assert.equal(a.provedor.buscas.length,2);
  });
});

test('cache de consulta atende outro domínio e recalcula posição e concorrentes',async t=>{
  const a=ambiente(t,{fonte:{resultados:()=>['https://rival.com.br/','https://cliente.com.br/','https://outro.com.br/']}});
  await a.inicial();const primeiro=await a.lote();a.avancar(30*60_000);
  const outra=criarPosicoesAtuais(a.opcoes);await a.inicial('outro.com.br',outra);const segundo=await a.lote('outro.com.br',outra);
  assert.equal(primeiro.consultas[0].posicao,2);assert.equal(segundo.consultas[0].posicao,3);
  assert.deepEqual(segundo.consultas[0].acima.map(c=>c.dominio),['rival.com.br','cliente.com.br']);
  assert.equal(segundo.consultas[0].coletadoEm,primeiro.consultas[0].coletadoEm);assert.equal(segundo.consultas[0].sha256,primeiro.consultas[0].sha256);
  assert.equal(segundo.progresso.paginasReutilizadasNesteLote,1);assert.equal(segundo.progresso.paginasNesteLote,0);
  assert.equal(a.provedor.buscas.length,1);assert.equal(a.creditos(),1);
});

test('captura de 54 minutos mantém data e deixa de confirmar posição ao completar uma hora',async t=>{
  const data=new Date(INSTANTE-54*60_000).toISOString(),a=ambiente(t,{fonte:{coletadoEm:data}});
  await a.inicial();const primeiro=await a.lote();
  const cache=a.sqlite.prepare("SELECT expira_em FROM rank_resultados WHERE chave LIKE 'google-pagina-v2:%'").get();
  assert.equal(cache.expira_em,INSTANTE+6*60_000);assert.equal(primeiro.consultas[0].coletadoEm,data);
  a.avancar(cache.expira_em-a.agora());const expirado=await a.inicial();
  assert.deepEqual(expirado.consultas,[]);assert.equal(expirado.cobertura.verificadas,0);assert.equal(a.provedor.buscas.length,1);
});

test('prefixo expirado é descartado inteiro e retomada começa pela página um',async t=>{
  const a=ambiente(t,{fonte:{continuar:true,encontrar:false}});await a.inicial();const antigo=await a.lote();
  const ids=new Set(antigo.consultas[0].paginas.map(p=>p.fonte.id));a.avancar(HORA);
  const novo=await a.lote('cliente.com.br',criarPosicoesAtuais(a.opcoes));
  assert.deepEqual(a.provedor.buscas.map(b=>b.inicio),[0,10,20,30,0,10,20,30]);assert.equal(novo.consultas[0].paginas.length,4);
  assert.ok(novo.consultas[0].paginas.every(p=>!ids.has(p.fonte.id)));assert.equal(novo.consultas[0].paginas[0].inicio,0);
});

test('relacionadas exigem contexto compartilhado e só expandem uma geração',async t=>{
  const a=ambiente(t,{fonte:{relacionadas:({termo})=>termo===TERMOS[0]
    ?['Consultoria ambiental preço','Bolo de chocolate','Consultoria ambiental','Consultoria email@privado.com','Consultoria 27999998888']
    :['Consultoria ambiental preço barato']}});
  await a.inicial();const r=await a.lote();assert.deepEqual(r.candidatos.map(c=>c.termo),[TERMOS[0],'Consultoria ambiental preço']);
  assert.equal(r.candidatos[1].origem,'busca_relacionada');assert.equal(r.candidatos[1].evidencia.termoOrigem,TERMOS[0]);
  assert.equal(r.candidatos[1].evidencia.campo,'Google.related_searches');assert.equal(a.provedor.buscas.length,2);
});

test('vinte páginas por domínio em 24h não são renovadas após uma hora',async t=>{
  const a=ambiente(t),franquia=criarFranquia(a.db,a.agora);
  const reservas=await Promise.all(Array.from({length:30},()=>franquia.reservar('cliente.com.br')));assert.equal(reservas.filter(Boolean).length,20);
  a.avancar(HORA);assert.equal(await franquia.reservar('cliente.com.br'),false);await a.inicial();const r=await a.lote();
  assert.equal(r.estado,'cota_esgotada');assert.equal(r.progresso.motivo,'cota_dominio');
  assert.deepEqual(a.provedor.chamadas,['/account.json']);assert.equal(a.creditos(),20);
  a.avancar(DIA);assert.equal(await franquia.reservar('cliente.com.br'),true);
});

test('cotas horária e mensal globais limitam domínios diferentes antes de Search',async t=>{
  for(const mensal of [false,true])await t.test(mensal?'200 por mês':'40 por hora',async st=>{
    const a=ambiente(st),franquia=criarFranquia(a.db,a.agora);
    for(let hora=0;hora<(mensal?5:1);hora++){
      for(let i=0;i<40;i++)assert.equal(await franquia.reservar('dominio'+hora+'-'+i+'.com.br'),true);
      if(mensal)a.avancar(HORA);
    }
    await a.inicial();const r=await a.lote();assert.equal(r.estado,'cota_esgotada');assert.equal(r.progresso.motivo,'cota');
    assert.deepEqual(a.provedor.chamadas,['/account.json']);assert.equal(a.creditos(),mensal?200:40);
  });
});

test('sem chave ou sem D1 há descoberta e nenhuma chamada à fonte',async t=>{
  const a=ambiente(t);
  for(const env of [{DB:a.db},{SERPAPI_KEY:CHAVE}]){
    const r=await criarPosicoesAtuais(a.opcoes)({site:'cliente.com.br',continuar:true},env);
    assert.equal(r.candidatos.length,1);assert.deepEqual(r.consultas,[]);assert.equal(r.progresso.continuar,false);
  }
  assert.deepEqual(a.provedor.chamadas,[]);assert.equal(a.creditos(),0);
});

test('preflight recusado preserva candidatos sem reservar crédito nem pesquisar',async t=>{
  for(const fonte of [{statusConta:401},{conta:{plan_id:'starter',plan_name:'Starter',plan_monthly_price:25}},
    {conta:{plan_searches_left:0,total_searches_left:0,this_month_usage:250}}])await t.test(JSON.stringify(fonte),async st=>{
    const a=ambiente(st,{fonte});await a.inicial();const r=await a.lote();
    assert.equal(r.candidatos.length,1);assert.equal(r.progresso.continuar,false);assert.deepEqual(a.provedor.chamadas,['/account.json']);
    assert.equal(a.creditos(),0);assert.equal(a.sqlite.prepare('SELECT COUNT(*) AS n FROM rank_travas').get().n,0);
  });
});

test('falha após página válida preserva evidência e não declara posição zero',async t=>{
  const a=ambiente(t,{fonte:{encontrar:false,continuar:true,falhar:({inicio})=>inicio===10}});await a.inicial();const r=await a.lote();
  assert.equal(r.consultas[0].paginas.length,1);assert.equal(r.consultas[0].posicao,null);assert.equal(r.consultas[0].concluida,false);
  assert.match(r.consultas[0].motivo,/captura válida/);assert.equal(r.progresso.continuar,false);assert.equal(a.creditos(),2);
  assert.ok(!JSON.stringify(r).includes('detalhe privado'));
  assert.deepEqual((await a.inicial('cliente.com.br',criarPosicoesAtuais(a.opcoes))).consultas,r.consultas);assert.equal(a.provedor.buscas.length,2);
});

test('prazo encerra lote preservando progresso; retomada usa próxima página',async t=>{
  const a=ambiente(t,{fonte:relogio=>({encontrar:false,continuar:true,aoSearch:({numero})=>{if(numero===1)relogio.avancar(40_001);}})});
  await a.inicial();const curto=await a.lote();assert.equal(curto.progresso.motivo,'prazo');assert.equal(curto.progresso.continuar,true);
  assert.equal(curto.consultas[0].paginas.length,1);
  const seguinte=await a.lote('cliente.com.br',criarPosicoesAtuais(a.opcoes));assert.equal(a.provedor.buscas[1].inicio,10);
  assert.equal(seguinte.consultas[0].paginas.length,5);assert.equal(a.creditos(),5);
});

test('Account lento não reserva quando restam menos de treze segundos',async t=>{
  const a=ambiente(t,{fonte:relogio=>({aoAccount:()=>relogio.avancar(52_001)})});await a.inicial();const r=await a.lote();
  assert.equal(r.progresso.motivo,'prazo');assert.deepEqual(a.provedor.chamadas,['/account.json']);assert.equal(a.creditos(),0);assert.deepEqual(r.consultas,[]);
});

test('pedidos simultâneos na mesma instância compartilham um lote',async t=>{
  let iniciou,liberar;const inicio=new Promise(r=>{iniciou=r;}),pausa=new Promise(r=>{liberar=r;});
  const a=ambiente(t,{fonte:{aoSearch:async()=>{iniciou();await pausa;}}});await a.inicial();const primeiro=a.lote();await inicio;
  const segundo=a.posicoes({site:'https://www.cliente.com.br/',continuar:true},a.env);liberar();const[p,s]=await Promise.all([primeiro,segundo]);
  assert.deepEqual(p,s);assert.equal(a.creditos(),1);assert.equal(a.provedor.buscas.length,1);
});

test('instâncias independentes respeitam trava D1 e retomam relatório concluído',async t=>{
  let iniciou,liberar;const inicio=new Promise(r=>{iniciou=r;}),pausa=new Promise(r=>{liberar=r;});
  const a=ambiente(t,{fonte:{aoSearch:async()=>{iniciou();await pausa;}}});await a.inicial();const primeiro=a.lote();await inicio;
  const outra=criarPosicoesAtuais(a.opcoes),bloqueado=await outra({site:'cliente.com.br',continuar:true},a.env);
  assert.equal(bloqueado.progresso.motivo,'ocupada');assert.equal(a.creditos(),1);liberar();const concluido=await primeiro;
  assert.deepEqual((await a.inicial('cliente.com.br',outra)).consultas,concluido.consultas);assert.equal(a.provedor.buscas.length,1);
  assert.equal(a.sqlite.prepare('SELECT COUNT(*) AS n FROM rank_travas').get().n,0);
});

test('API exige POST de mesma origem e rejeita termos manuais ou paginação arbitrária',async t=>{
  const a=ambiente(t),worker=criarWorker('<title>Portal</title>',a.opcoes),inicial=await worker.fetch(request(),a.env);
  assert.equal(inicial.status,200);assert.equal((await inicial.json()).candidatos.length,1);assert.equal(inicial.headers.get('cache-control'),'private, no-store');
  for(const body of [{site:'localhost'},{site:'127.0.0.1'},{site:'cliente.com.br',termo:'livre'},{site:'cliente.com.br',palavras:['livre']},
    {site:'cliente.com.br',inicio:20},{site:'cliente.com.br',continuar:'true'},[],null])assert.equal((await worker.fetch(request(body),a.env)).status,400);
  for(const method of ['GET','HEAD','OPTIONS'])assert.equal((await worker.fetch(new Request('https://portal.com/api/posicoes',{method}),a.env)).status,405);
  for(const headers of [{Origin:'https://outro.com'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await worker.fetch(request(undefined,headers),a.env)).status,403);
  assert.equal((await worker.fetch(request(undefined,{'Content-Type':'text/plain'}),a.env)).status,400);
  assert.equal((await worker.fetch(request(undefined,{},'/api/posicoes?site=cliente.com.br'),a.env)).status,400);
  assert.equal((await worker.fetch(request(undefined,{},'/api/consultar'),a.env)).status,404);assert.deepEqual(a.provedor.chamadas,[]);
});

test('Worker separa coleta social de três páginas e descoberta de doze páginas',async t=>{
  const objetivos=[],a=ambiente(t,{coletar:(d,o,relogio)=>{objetivos.push(o);return coleta(d,[TERMOS[0]],relogio.agora());}});
  const worker=criarWorker('<title>Portal</title>',a.opcoes);
  const respostas=await Promise.all([worker.fetch(request(),a.env),worker.fetch(request(undefined,{},'/api/diagnostico'),a.env)]);
  assert.deepEqual(respostas.map(r=>r.status),[200,200]);
  assert.deepEqual(objetivos.sort((a,b)=>a.limiteRequisicoes-b.limiteRequisicoes),[{objetivo:'busca',limiteRequisicoes:24},{objetivo:'descoberta',limiteRequisicoes:40}]);
  assert.equal(a.coletas(),2);assert.deepEqual(a.provedor.chamadas,[]);
});

test('sem conteúdo não inventa palavras nem inicia fonte',async t=>{
  const a=ambiente(t,{coletar:async d=>({dominio:d,paginas:[],falhas:[]})}),r=await a.inicial();
  assert.equal(r.estado,'sem_termos');assert.deepEqual(r.candidatos,[]);assert.equal(r.progresso.continuar,false);assert.deepEqual(a.provedor.chamadas,[]);
});

test('erro de D1 não vira ausência de termos e erro da reserva nunca inicia Search',async t=>{
  const a=ambiente(t);
  const DB={prepare(){throw new Error('detalhe privado do banco');}};
  const vazio=await a.posicoes({site:'cliente.com.br'}, {...a.env,DB});
  assert.equal(vazio.estado,'indisponivel');assert.equal(vazio.progresso.motivo,'controle');
  assert.deepEqual(a.provedor.chamadas,[]);assert.ok(!JSON.stringify(vazio).includes('detalhe privado'));
  await a.inicial();
  const real=criarFranquia(a.db,a.agora),franquia={...real,reservar:async()=>{throw new Error('detalhe privado da reserva');}};
  const r=await a.lote('cliente.com.br',criarPosicoesAtuais({...a.opcoes,franquia}));
  assert.equal(r.progresso.motivo,'controle');assert.equal(r.candidatos.length,1);
  assert.deepEqual(a.provedor.chamadas,['/account.json']);assert.equal(a.creditos(),0);
  assert.equal(a.sqlite.prepare('SELECT COUNT(*) AS n FROM rank_travas').get().n,0);
});

test('resposta vazia não é compartilhada como captura e não confirma ausência no Google',async t=>{
  const a=ambiente(t,{fonte:{resultados:()=>[]}});await a.inicial();const r=await a.lote();
  assert.equal(r.consultas[0].estado,'indisponivel');assert.equal(r.consultas[0].posicao,null);
  assert.equal(r.cobertura.verificadas,0);assert.equal(a.creditos(),1);
  assert.equal(a.sqlite.prepare("SELECT COUNT(*) AS n FROM rank_resultados WHERE chave LIKE 'google-pagina-v2:%'").get().n,0);
});

test('falha ao guardar cache compartilhado não descarta a captura válida do relatório',async t=>{
  const a=ambiente(t);await a.inicial();
  const real=criarFranquia(a.db,a.agora),franquia={...real,guardar:async(chave,...args)=>{
    if(chave.startsWith('google-pagina-v2:'))throw new Error('cache indisponível');
    return real.guardar(chave,...args);
  }};
  const r=await a.lote('cliente.com.br',criarPosicoesAtuais({...a.opcoes,franquia}));
  assert.equal(r.consultas[0].posicao,3);assert.equal(r.cobertura.verificadas,1);
  assert.ok(r.limites.some(l=>/cache compartilhado/.test(l)));
  assert.deepEqual((await a.inicial()).consultas,r.consultas);assert.equal(a.creditos(),1);
});

test('nova leitura vazia preserva candidatos e captura ainda atual com datas originais',async t=>{
  let vazio=false;
  const a=ambiente(t,{coletar:(d,_o,relogio)=>vazio?{dominio:d,paginas:[],falhas:[]} : coleta(d,[TERMOS[0]],relogio.agora())});
  const descoberta=await a.inicial();await a.lote();
  a.avancar(DIA-30*60_000-3001);
  const recente=await a.lote();
  vazio=true;a.avancar(30*60_000);
  const r=await a.inicial('cliente.com.br',criarPosicoesAtuais(a.opcoes));
  assert.deepEqual(r.candidatos,descoberta.candidatos);assert.deepEqual(r.consultas,recente.consultas);
  assert.equal(r.descoberta.coletadoEm,descoberta.descoberta.coletadoEm);
  assert.equal(r.descoberta.releituraIndisponivel,true);assert.ok(r.descoberta.releituraTentadaEm);
  assert.equal(a.coletas(),2);await a.inicial();assert.equal(a.coletas(),2);
  a.avancar(15*60_000);await a.inicial();assert.equal(a.coletas(),3);
});

test('paginação inconsistente ou repetida conserva evidência sem contar termo finalizado',async t=>{
  for(const repetida of [false,true])await t.test(repetida?'página repetida':'continuação incompatível',async st=>{
    const a=ambiente(st,{fonte:{encontrar:false,continuar:true,
      ...(repetida?{resultados:()=>Array.from({length:10},(_,i)=>'https://rival'+i+'.com.br/igual')}:{proxima:'https://externo.com/search?start=10'})}});
    await a.inicial();const r=await a.lote();
    assert.equal(r.estado,'parcial');assert.equal(r.consultas[0].paginas.length,1);
    assert.equal(r.consultas[0].interrompidaPor,repetida?'pagina_repetida':'paginacao_inconsistente');
    assert.equal(r.cobertura.verificadas,1);assert.equal(r.cobertura.finalizadas,0);assert.equal(r.cobertura.pendentes,1);
    assert.equal(a.provedor.buscas.length,repetida?2:1);
  });
});

test('mudança editorial de C++ para C# não herda posição da outra consulta ainda atual',async t=>{
  let termo='Consultoria C++';
  const a=ambiente(t,{coletar:(d,_o,relogio)=>coleta(d,[termo],relogio.agora())});
  await a.inicial();await a.lote();a.avancar(DIA-30*60_000-3001);
  const recente=await a.lote();assert.equal(recente.consultas[0].termo,'Consultoria C++');
  termo='Consultoria C#';a.avancar(30*60_000);
  const alterado=await a.inicial('cliente.com.br',criarPosicoesAtuais(a.opcoes));
  assert.deepEqual(alterado.candidatos.map(c=>c.termo),['Consultoria C#']);
  assert.deepEqual(alterado.consultas,[]);assert.equal(alterado.cobertura.finalizadas,0);
  const novo=await a.lote();assert.equal(novo.consultas[0].termo,'Consultoria C#');
  assert.notEqual(novo.consultas[0].sha256,recente.consultas[0].sha256);
});

test('descoberta concorrente sem chave permite aguardar e retomar automaticamente',async t=>{
  const a=ambiente(t,{termos:TERMOS}),franquia=criarFranquia(a.db,a.agora);
  const chave='ranking-plano-v2:cliente.com.br',token=await franquia.bloquear(chave);
  const aguardando=await a.posicoes({site:'cliente.com.br'},{DB:a.db});
  assert.equal(aguardando.estado,'parcial');
  assert.equal(aguardando.progresso.continuar,true);
  assert.equal(aguardando.progresso.motivo,'ocupada');
  assert.equal(aguardando.progresso.esperaMs,5000);
  assert.equal(aguardando.cache.reutilizado,false);
  assert.equal(a.coletas(),0);
  await franquia.liberar(chave,token);
  a.avancar(5000);
  const retomado=await a.posicoes({site:'cliente.com.br',continuar:true},{DB:a.db});
  assert.equal(retomado.estado,'fonte_nao_configurada');
  assert.equal(retomado.candidatos.length,6);
  assert.equal(retomado.progresso.continuar,false);
  assert.deepEqual(a.provedor.chamadas,[]);
});
