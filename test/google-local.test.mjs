import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {interpretarCapturaGoogle,criarLinkGoogle,resumirCapturasGoogle} from '../src/google-local.mjs';
import {criarGoogleLocal} from '../lib/google-local.mjs';
const QUANDO='2026-11-17T00:00:00.000Z',agora=()=>Date.parse(QUANDO),link=(url,titulo)=>'<div class="g"><a href="'+url+'"><h3>'+titulo+'</h3></a></div>';
const html=(corpo,rodape='')=>'<div id="search"><div id="rso">'+corpo+'</div></div>'+rodape;
const captura=(corpo,extra={})=>({formato:'visibilidade-google-local',versao:1,metodo:'pagina_aberta',url:criarLinkGoogle('contratação de artista gospel'),coletadoEm:QUANDO,dispositivo:'computador',localidadeDeclarada:null,html:corpo,...extra});
const ler=(c,op={})=>interpretarCapturaGoogle(c,{dominio:'example.com',agora,...op});

test('ordem é local, subdomínio pertence ao alvo e domínio parecido não pertence',()=>{
 const r=ler(captura(html(link('https://notexample.com/','Outro negócio')+link('https://rival.com/','Rival')+link('https://loja.example.com/','Exemplo'))));
 assert.equal(r.ordemNaPagina,3);assert.equal(r.posicaoGoogle,null);assert.equal(r.fonteAutenticada,false);
 assert.deepEqual(r.concorrentesAntes.map(c=>c.dominio),['notexample.com','rival.com']);assert.equal(r.encontrados.length,1);
 assert.equal(r.contexto.localidadeDeclarada,null);assert.equal(r.contexto.personalizacao,'desconhecida');assert.equal(r.atual,true);
});
test('anúncios, perguntas relacionadas e navegação não entram na ordem reconhecida',()=>{
 const corpo='<div data-text-ad><div class="g"><a href="https://ad.com/"><h3>Anúncio</h3></a></div></div>'+
 '<div class="related-question-pair">'+link('https://pergunta.com/','Pergunta')+'</div>'+link('https://rival.com/','Rival')+link('https://example.com/','Alvo')+link('https://example.com/','Sitelink duplicado');
 const r=ler(captura('<h3><a href="https://nav.com/">Navegação</a></h3>'+html(corpo)));
 assert.deepEqual(r.resultados.map(x=>x.dominio),['rival.com','example.com']);assert.equal(r.ordemNaPagina,2);assert.equal(r.estado,'parcial');assert.equal(r.linksIgnorados,3);
});
test('redirecionamento transparente é interpretado sem seguir link; destinos privados e protocolos ativos são descartados',()=>{
 const c=html(link('/url?q='+encodeURIComponent('https://example.com/pagina'),'Exemplo')+link('javascript:alert(1)','Código')+link('http://127.0.0.1/','Local')+link('/search?q=outro','Busca'));
 const r=ler(captura(c));assert.equal(r.resultados.length,1);assert.equal(r.resultados[0].url,'https://example.com/pagina');
});
test('site ausente no recorte não vira posição zero nem concorrentes anteriores confirmados',()=>{
 const r=ler(captura(html(link('https://rival.com/','Rival'))));assert.equal(r.ordemNaPagina,null);assert.equal(r.posicaoGoogle,null);assert.deepEqual(r.concorrentesAntes,[]);assert.equal(r.outrosResultados.length,1);
});
test('sitelink com outro h3 dentro do mesmo bloco não cria resultado orgânico adicional',()=>{
 const corpo='<div class="g"><a href="https://rival.com"><h3>Resultado principal</h3></a><a href="https://example.com"><h3>Referência interna do bloco</h3></a></div>';
 const r=ler(captura(html(corpo)));assert.equal(r.resultados.length,1);assert.equal(r.ordemNaPagina,null);assert.equal(r.estado,'parcial');
});
test('layout desconhecido difere de mensagem explícita de nenhum resultado',()=>{
 const desconhecido=ler(captura('<main>Conteúdo qualquer</main>'));
 const vazio=ler(captura(html('<p>Nenhum resultado encontrado</p>')));
 assert.equal(desconhecido.estado,'layout_nao_reconhecido');assert.equal(vazio.estado,'sem_resultados_explicitos');
 for(const r of [desconhecido,vazio]){assert.equal(r.ordemNaPagina,null);assert.equal(r.posicaoGoogle,null);assert.equal(r.totalLinksReconhecidos,0);}
});
test('bloqueio, consentimento, consulta corrigida e busca geral não são ranking',()=>{
 for(const[body,estado]of [['<form id="captcha-form">Nossos sistemas detectaram tráfego incomum</form>','interrompida'],['<p>Antes de continuar para o Google</p>','consentimento'],['<p>Exibindo resultados para outra frase</p>','consulta_alterada']]){
  const r=ler(captura(body+html(link('https://example.com/','Alvo'))));assert.equal(r.estado,estado);assert.deepEqual(r.resultados,[]);assert.equal(r.ordemNaPagina,null);
 }
 const c=captura(html(link('https://example.com/','Alvo')));c.url=c.url.replace('udm=14','udm=2');assert.equal(ler(c).estado,'modo_nao_suportado');
});
test('mês inválido, futuro e data sem zona são recusados; histórico é preservado sem selo atual',()=>{
 for(const coletadoEm of ['2026-02-30T00:00:00.000Z','2026-11-17T01:00:00.000Z','2026-11-17T00:00:00'])assert.throws(()=>ler(captura(html(''),{coletadoEm})),/data|horário|adiante/iu);
 const antigo=ler(captura(html(link('https://example.com/','Alvo')),{coletadoEm:'2026-11-16T22:00:00.000Z'}));assert.equal(antigo.atual,false);assert.equal(antigo.ordemNaPagina,1);
});
test('Google falso, parâmetros ambíguos, credenciais e campos de posição enviados pelo cliente são recusados',()=>{
 for(const url of ['https://www.google.com.evil.com/search?q=x&udm=14','https://google.com/search?q=x&q=y&udm=14','https://usuario:senha@google.com/search?q=x&udm=14','https://www.google.com/search?q=x&udm=14&start=-10'])assert.throws(()=>ler(captura(html(''),{url})));
 assert.throws(()=>ler(captura(html(''),{posicao:1})),/formato/iu);
});
test('o endereço seguinte precisa manter consulta e contexto; start não é convertido em posição',()=>{
 const u=new URL(criarLinkGoogle('contratação de artista gospel'));u.searchParams.set('start','10');
 const r=ler(captura(html(link('https://example.com/','Alvo'),'<a id="pnnext" href="'+u.href.replaceAll('&','&amp;')+'">Próxima</a>')));
 assert.equal(new URL(r.proximaPagina).searchParams.get('start'),'10');
 const segunda=ler(captura(html(link('https://example.com/','Alvo')),{url:u.href}));
 assert.equal(segunda.inicioSolicitado,10);assert.equal(segunda.ordemNaPagina,1);assert.equal(segunda.posicaoGoogle,null);
 u.searchParams.set('q','outra consulta');const diferente=ler(captura(html(link('https://example.com/','Alvo'),'<a id="pnnext" href="'+u.href+'">Próxima</a>')));assert.equal(diferente.proximaPagina,null);
});
test('links ocultos não entram e parâmetros de sessão não são persistidos na URL da consulta',()=>{
 const c=captura(html('<div style="display:none">'+link('https://hidden.com/','Oculto')+'</div>'+link('https://example.com/','Alvo')));c.url+='&authuser=9&token=privado';
 const r=ler(c);assert.equal(r.resultados.length,1);assert.doesNotMatch(r.urlConsulta,/authuser|privado|token/);assert.equal(r.ordemNaPagina,1);
});
test('reabrir recalcula validade e vínculo com a seleção sem fabricar observação de palavra nova',()=>{
 const r=ler(captura(html(link('https://example.com/','Alvo'))));
 const atual=resumirCapturasGoogle([r],{dominio:'example.com',candidatos:[{termo:r.termo}],agora});assert.equal(atual.capturas[0].termoNaSelecao,true);
 const depois=resumirCapturasGoogle([r],{dominio:'example.com',candidatos:[{termo:'outra palavra'}],agora:()=>agora()+3600001});assert.equal(depois.capturas[0].atual,false);assert.equal(depois.capturas[0].termoNaSelecao,false);assert.equal(depois.posicaoGoogle,null);
});
test('captura grande é recusada sem cortar o texto',()=>assert.throws(()=>ler(captura('x'.repeat(49153))),/48 KiB/));
test('rótulo separado de anúncio é diferente de título orgânico sobre anúncios',()=>{
 const principal=link('https://rival.com','Rival')+link('https://example.com','Alvo');
 for(const ad of ['<div class="g"><div>Patrocinado</div><a href="https://ad.com"><h3>Oferta</h3></a></div>','<div class="g"><a href="https://ad.com"><span>Sponsored</span><h3>Oferta</h3></a></div>']){
  const r=ler(captura(html(ad+principal)));assert.equal(r.ordemNaPagina,2);assert.ok(r.resultados.every(x=>x.dominio!=='ad.com'));
 }
 for(const titulo of ['Anúncios','<span>Sponsored</span>']){
  const r=ler(captura(html(link('https://rival.com',titulo)+link('https://example.com','Alvo'))));assert.equal(r.ordemNaPagina,2);assert.equal(r.resultados.length,2);
 }
});
test('redirecionadores de publicidade não são concorrentes orgânicos',()=>{
 for(const endereco of ['https://www.googleadservices.com/pagead/aclk?adurl=https://ad.com','https://googleads.g.doubleclick.net/aclk?adurl=https://ad.com']){
  const r=ler(captura(html(link(endereco,'Anúncio')+link('https://rival.com','Rival')+link('https://example.com','Alvo'))));assert.equal(r.ordemNaPagina,2);assert.equal(r.resultados.length,2);
 }
});
test('palavras de bloqueio/correção em título ou trecho orgânico não viram controle do Google',()=>{
 for(const titulo of ["I'm not a robot — tutorial",'Exibindo resultados para filtros de pesquisa']){
  const r=ler(captura(html(link('https://rival.com',titulo)+link('https://example.com','Alvo'))));assert.equal(r.estado,'capturada');assert.equal(r.ordemNaPagina,2);
 }
});
test('correção espanhola fora dos resultados é recusada e idioma desconhecido não recebe ordem',()=>{
 const c=captura('<p>Se muestran resultados de otra consulta</p>'+html(link('https://example.com','Alvo')));c.url=c.url.replace('hl=pt-BR','hl=es');assert.equal(ler(c).estado,'consulta_alterada');
 for(const hl of ['fr',null]){const u=new URL(criarLinkGoogle('busca'));hl===null?u.searchParams.delete('hl'):u.searchParams.set('hl',hl);const r=ler(captura(html(link('https://example.com','Alvo')),{url:u.href}));assert.equal(r.estado,'contexto_nao_suportado');assert.equal(r.ordemNaPagina,null);}
});
test('resultado antigo sem versão do parser precisa ser reinterpretado com data original',()=>{
 const r=ler(captura(html(link('https://example.com','Alvo'))));delete r.parserVersao;
 const antigo=resumirCapturasGoogle([r],{dominio:'example.com',candidatos:[],agora}).capturas[0];assert.equal(antigo.estado,'reinterpretacao_necessaria');assert.equal(antigo.ordemNaPagina,null);assert.equal(antigo.totalLinksReconhecidos,null);assert.equal(antigo.coletadoEm,QUANDO);
});
test('persistência minimiza parâmetros de conta no topo e no próximo link, guardando fingerprint do recebido',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'google-local-minimo-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const c=captura(html(link('https://example.com','Alvo'),'<a id="pnnext" href="'+criarLinkGoogle('contratação de artista gospel')+'&start=10&authuser=9&token=FICTICIO_NEXT">Próxima</a>'));c.url+='&authuser=7&token=FICTICIO_TOPO';
 const s=criarGoogleLocal({dataDir:dir,agora}),r=await s.registrar({dominio:'example.com',captura:c}),raw=await readFile(join(dir,'google-local/capturas',r.capturaId+'.json'),'utf8');
 assert.doesNotMatch(raw,/FICTICIO_NEXT|FICTICIO_TOPO|authuser/);assert.equal(r.minimizacao.linksGoogleNormalizados,true);assert.notEqual(r.sha256Trecho,r.minimizacao.sha256TrechoRecebido);assert.equal(r.ordemNaPagina,1);
 const reaberto=await s.ler({dominio:'example.com',capturaId:r.capturaId});assert.equal(reaberto.sha256Trecho,r.sha256Trecho);assert.deepEqual(reaberto.minimizacao,r.minimizacao);assert.equal(reaberto.coletadoEm,QUANDO);
});
test('persistência é imutável, idempotente e restrita ao domínio; alteração é detectada',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'google-local-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const s=criarGoogleLocal({dataDir:dir,agora}),entrada={dominio:'example.com',captura:captura(html(link('https://example.com/','Alvo')))};
 const primeiro=await s.registrar(entrada),segundo=await s.registrar(entrada);assert.equal(primeiro.capturaId,segundo.capturaId);
 const r=await s.ler({dominio:'example.com',capturaId:primeiro.capturaId});assert.equal(r.ordemNaPagina,1);
 await assert.rejects(s.ler({dominio:'rival.com',capturaId:r.capturaId}),e=>e.status===404);
 await assert.rejects(s.ler({dominio:'example.com',capturaId:'../../arquivo'}));
 const p=join(dir,'google-local/capturas',r.capturaId+'.json');await writeFile(p,(await readFile(p,'utf8')).replace('Alvo','Falso'));
 await assert.rejects(s.ler({dominio:'example.com',capturaId:r.capturaId}),e=>e.status===409);
});
test('arquivo de captura substituído por symlink é recusado',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'google-local-link-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const s=criarGoogleLocal({dataDir:dir,agora}),r=await s.registrar({dominio:'example.com',captura:captura(html(link('https://example.com/','Alvo')))});
 const p=join(dir,'google-local/capturas',r.capturaId+'.json'),outro=join(dir,'original.json');await writeFile(outro,await readFile(p));await rm(p);await symlink(outro,p);
 await assert.rejects(s.ler({dominio:'example.com',capturaId:r.capturaId}),e=>e.status===409);
});
test('URL normalizada mantém a identidade ao reabrir e ao explicitar start zero',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'google-local-canonico-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const s=criarGoogleLocal({dataDir:dir,agora}),c=captura(html(link('https://example.com','Alvo'))),r=await s.registrar({dominio:'example.com',captura:c});
 const aberto=await s.ler({dominio:'example.com',capturaId:r.capturaId});assert.equal(aberto.urlConsulta,r.urlConsulta);
 const u=new URL(c.url);u.searchParams.set('start','0');const igual=await s.registrar({dominio:'example.com',captura:{...c,url:u.href}});assert.equal(igual.capturaId,r.capturaId);assert.equal(igual.urlConsulta,r.urlConsulta);
});
