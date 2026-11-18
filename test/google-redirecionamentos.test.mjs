import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {interpretarCapturaGoogle,criarLinkGoogle,resumirCapturasGoogle} from '../src/google-local.mjs';
import {dominioExibidoGoogle,destinoGooglePublicado} from '../src/google-identidade.mjs';
import {criarGoogleLocal} from '../lib/google-local.mjs';

const quando='2026-11-17T15:52:38.517Z',agora=()=>Date.parse(quando);
const envolver=html=>({formato:'visibilidade-google-local',versao:1,metodo:'pagina_aberta',url:criarLinkGoogle('busca controlada'),coletadoEm:quando,dispositivo:'computador',localidadeDeclarada:null,html:'<div id="rso">'+html+'</div>'});
const card=(href,cite='',titulo='Exemplo')=>'<div class="MjjYud"><div class="tF2Cxc"><a href="'+href+'"><h3>'+titulo+'</h3>'+cite+'</a></div></div>';
const opaco=(cite,titulo)=>card('https://www.google.com/goto?url=TOKEN_OPACO_FICTICIO',cite,titulo);
const ler=c=>interpretarCapturaGoogle(c,{dominio:'example.com',agora});

test('recorte autoral identifica domínio exibido e ordem dos blocos com redirecionamentos opacos',()=>{
  const dominios=['acervo.example.net','catalogo.example.org','example.com',
    'agenda.example.org','pagina.example.net','servicos.example.org',null,
    'canal.example.net','projetos.example.org','comercio.example.net'];
  const blocos=dominios.map((dominio,i)=>dominio
    ? opaco('<cite>https://'+dominio+'<span> › servico</span></cite>','Resultado '+(i+1))
    : opaco('<cite>Mais de 100 seguidores</cite>','Página social'));
  const c=envolver(blocos.join(''));
  const antes=structuredClone(c),r=ler(c);
  assert.equal(r.estado,'dominios_exibidos');assert.equal(r.parserVersao,2);
  assert.equal(r.ordemDominioExibido,3);assert.equal(r.totalBlocosWeb,10);assert.equal(r.blocosSemIdentificacao,1);
  assert.deepEqual(r.dominiosExibidosAntes.map(d=>d.dominioExibido),dominios.slice(0,2));
  assert.equal(r.dominiosExibidos.length,9);assert.ok(r.dominiosExibidos.every(d=>d.urlDestino===null));
  assert.equal(r.ordemNaPagina,null);assert.equal(r.posicaoGoogle,null);assert.deepEqual(r.resultados,[]);
  assert.equal(r.dominiosExibidos.find(d=>d.dominioExibido===dominios[7]).ordemBloco,8);
  assert.deepEqual(c,antes);
});

test('bloco sem dominio permanece na contagem antes do alvo',()=>{
  const r=ler(envolver(opaco('<cite>Mais de 100 seguidores</cite>','Social')+opaco('<cite>https://example.com<span> › produto</span></cite>','Alvo')));
  assert.equal(r.blocosSemIdentificacao,1);assert.equal(r.ordemDominioExibido,2);assert.equal(r.ordemNaPagina,null);assert.equal(r.posicaoGoogle,null);
});

test('cite ambiguo, externo ao link, oculto ou pertencente a anuncio nao identifica o alvo',()=>{
  for(const html of [opaco('<cite>https://example.com</cite><cite>https://rival.com</cite>'),card('https://www.google.com/goto')+'<cite>https://example.com</cite>',opaco('<cite hidden>https://example.com</cite>'),'<div data-text-ad="1">'+opaco('<cite>https://example.com</cite>')+'</div>']){
    const r=ler(envolver(html));assert.equal(r.ordemDominioExibido,null);assert.equal(r.ordemNaPagina,null);assert.equal(r.posicaoGoogle,null);
  }
});

test('citacao nao sobrepoe o dominio de uma URL publicada nem de um link de terceiro',()=>{
  for(const href of ['https://rival.com/','https://rival.com/redirect?url=https://example.com']){
    const r=ler(envolver(card(href,'<cite>https://example.com</cite>')));assert.equal(r.ordemNaPagina,null);assert.equal(r.ordemDominioExibido,null);assert.equal(r.resultados[0].dominio,'rival.com');
  }
});

test('destino explicito de goto e lido sem seguir link; token opaco e ambiguidade nao viram destino',()=>{
  const u='https://www.google.com/goto?url='+encodeURIComponent('https://example.com/servico#local');
  assert.equal(destinoGooglePublicado(u,criarLinkGoogle('x')).url,'https://example.com/servico');
  assert.equal(ler(envolver(card(u))).ordemNaPagina,1);
  for(const v of ['https://www.google.com/goto?url=CAES_OPACO','https://www.google.com/url?q=https://example.com&url=https://rival.com','https://www.google.com/goto?url=https://example.com&url=https://rival.com','https://www.google.com/goto?url='+encodeURIComponent('https://nome:senha@example.com/')])assert.equal(destinoGooglePublicado(v,criarLinkGoogle('x')),null);
});

test('citacao truncada, IP, credenciais, porta, marca ou dominio semelhante nao afirma o alvo',()=>{
  for(const c of ['https://exam…ple.com','https://example..com','https://127.0.0.1','https://example.com:8443','https://example.com@rival.com','example.com','https://www.google.com','https://googleadservices.com','https://ｅxample.com'])assert.equal(dominioExibidoGoogle(c),null,c);
  const r=ler(envolver(opaco('<cite>https://notexample.com</cite>')));assert.equal(r.ordemDominioExibido,null);assert.equal(r.dominiosExibidos[0].dominioExibido,'notexample.com');
});

test('persistencia e reabertura preservam data, citacao e dominio; removem token opaco e idempotencia continua',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'google-goto-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const api=criarGoogleLocal({dataDir,agora}),c=envolver(opaco('<cite>https://example.com</cite>'));
  const a=await api.registrar({dominio:'example.com',captura:c}),b=await api.registrar({dominio:'example.com',captura:c});assert.equal(a.capturaId,b.capturaId);
  const salvo=await api.ler({dominio:'example.com',capturaId:a.capturaId});assert.equal(salvo.coletadoEm,quando);assert.equal(salvo.ordemDominioExibido,1);assert.equal(salvo.posicaoGoogle,null);
  const raw=await readFile(join(dataDir,'google-local','capturas',a.capturaId+'.json'),'utf8');assert.doesNotMatch(raw,/TOKEN_OPACO_FICTICIO/);assert.match(raw,/https:\/\/example\.com/);
});

test('URL explicita no goto sobrevive a minimizacao sem preservar parametros extras',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'google-goto-explicito-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const api=criarGoogleLocal({dataDir,agora}),c=envolver(card('https://www.google.com/goto?url=https%3A%2F%2Fexample.com%2Foferta&amp;gsessionid=FICTICIO'));
  const r=await api.registrar({dominio:'example.com',captura:c});assert.equal(r.ordemNaPagina,1);assert.equal(r.resultados[0].url,'https://example.com/oferta');
  const raw=await readFile(join(dataDir,'google-local','capturas',r.capturaId+'.json'),'utf8');assert.doesNotMatch(raw,/gsessionid|FICTICIO/);
});

test('versao anterior pede reinterpretacao sem exibir dominios ou ordens precomputadas',()=>{
  const r=ler(envolver(opaco('<cite>https://example.com</cite>')));r.parserVersao=1;
  const c=resumirCapturasGoogle([r],{dominio:'example.com',agora}).capturas[0];assert.equal(c.estado,'reinterpretacao_necessaria');assert.equal(c.ordemDominioExibido,null);assert.deepEqual(c.dominiosExibidos,[]);assert.equal(c.coletadoEm,quando);
});

test('fila distingue observacao de dominio e nao produz medicao automatica de posicoes',()=>{
  const r=ler(envolver(opaco('<cite>https://example.com</cite>'))),s=resumirCapturasGoogle([r],{dominio:'example.com',candidatos:[{termo:r.termo}],agora});
  assert.equal(s.fila[0].estado,'dominios_exibidos');assert.equal(s.posicaoGoogle,null);assert.equal(s.capturas[0].posicaoGoogle,null);
});

test('redirecionador inseguro ou ambiguo nao ganha identidade pela citacao',()=>{
  for(const href of ['http://www.google.com/goto?url=https://example.com','https://www.google.com:8443/goto?url=https://example.com','https://usuario:senha@www.google.com/goto?url=https://example.com','https://www.google.com/goto?url=https://127.0.0.1','https://www.google.com/goto?url=javascript:alert(1)','https://www.google.com/goto?url=https://rival.com&amp;q=https://example.com']){
    const r=ler(envolver(card(href,'<cite>https://example.com</cite>')));assert.equal(r.ordemNaPagina,null,href);assert.equal(r.ordemDominioExibido,null,href);
  }
});

test('rotulo patrocinado acima do cartao no mesmo bloco impede contar anuncio como organico',()=>{
  const ad='<div class="MjjYud"><span>Patrocinado</span><div class="tF2Cxc"><a href="https://www.google.com/goto"><h3>Alvo patrocinado</h3><cite>https://example.com</cite></a></div></div>';
  const r=ler(envolver(ad+opaco('<cite>https://rival.com</cite>')));assert.equal(r.totalBlocosWeb,1);assert.equal(r.dominiosExibidos.length,1);assert.equal(r.dominiosExibidos[0].dominioExibido,'rival.com');assert.equal(r.ordemDominioExibido,null);
});

test('minimizar um destino recusado nao o transforma em redirecionamento opaco com identidade nova',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'google-goto-recusado-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const api=criarGoogleLocal({dataDir,agora});
  for(const href of ['https://www.google.com/goto?url=https://127.0.0.1','https://www.google.com/goto?url=javascript:alert(1)','https://www.google.com/goto?url=https://rival.com&amp;q=https://example.com','https://www.google.com/url?url=https://127.0.0.1']){
    const c=envolver(card(href,'<cite>https://example.com</cite>')),antes=ler(c),depois=await api.registrar({dominio:'example.com',captura:c});
    assert.equal(antes.ordemDominioExibido,null);assert.equal(depois.ordemDominioExibido,null,href);assert.equal(depois.ordemNaPagina,null,href);
  }
});
