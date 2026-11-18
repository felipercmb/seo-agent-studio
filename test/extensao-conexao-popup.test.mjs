import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const fonte=readFileSync(new URL('../extensoes/google-local/popup.mjs',import.meta.url),'utf8').replace(/^import[^\n]*\n/u,'');
const TOKEN='x'.repeat(43),CODIGO='8794.'+TOKEN,ORIGEM='http://127.0.0.1:8794';
async function popup({permitido=true,inicial=null,recusarEnvio=false,falharCaptura=false,armazenamentoInicial={},aoPedir=null}={}){
 const nodes=new Map(),pedidos=[],permissoes=[],removidas=[],downloads=[],blobs=[],store={...(inicial?{conexaoGoogleLocal:inicial}:{}),...structuredClone(armazenamentoInicial)};let leituras=0;
 const no=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',disabled:false,hidden:false,eventos:{},addEventListener(k,fn){this.eventos[k]=fn;},click(){this.clicado=true;downloads.push(this);}});return nodes.get(id);};
 const meta=()=>({dominio:'example.com',expiraEm:new Date(Date.now()+600000).toISOString(),restantes:20,permissao:'somente_enviar_capturas'});
 const capture={formato:'visibilidade-google-local',versao:1,metodo:'pagina_aberta',url:'https://www.google.com/search?q=agenda&udm=14',coletadoEm:new Date().toISOString(),dispositivo:'computador',localidadeDeclarada:null,html:'<div>trecho autoral</div>'};
 class URLTeste extends URL{static createObjectURL(blob){blobs.push(blob);return'blob:local';}static revokeObjectURL(){}}
 const chrome={permissions:{request:async x=>{permissoes.push(x);return permitido;},remove:async x=>{removidas.push(x);return true;}},storage:{session:{get:async()=>structuredClone(store),set:async x=>Object.assign(store,structuredClone(x)),remove:async k=>{delete store[k];}}},tabs:{query:async()=>[{id:7}]},scripting:{executeScript:async()=>{leituras++;if(falharCaptura)throw Error('Verificação na página; captura interrompida.');return[{result:capture}];}}};
 const context={document:{getElementById:no,createElement:no},chrome,Date,TextEncoder,Blob,URL:URLTeste,AbortController,setTimeout,clearTimeout,capturarPaginaGoogle:()=>{},fetch:async(url,opcoes)=>{
   pedidos.push({url,opcoes});if(aoPedir){const r=await aoPedir(url,opcoes,pedidos.length);if(r)return r;}const falha=recusarEnvio&&url.endsWith('/receber');return{ok:!falha,status:falha?409:200,json:async()=>falha?{erro:'O projeto mudou. Gere outro código.'}:url.endsWith('/receber')?{...meta(),restantes:19,estado:'recebida'}:url.endsWith('/revogar')?{revogada:true}:meta()};
 }};
 await runInNewContext('(async()=>{'+fonte+'})()',context);
 return{no,pedidos,permissoes,removidas,store,downloads,blobs,leituras:()=>leituras,capture,clicar:async id=>no(id).eventos.click()};
}
test('abrir popup não consulta Google, captura aba ou conecta a qualquer servidor',async()=>{
 const p=await popup();assert.equal(p.pedidos.length,0);assert.equal(p.permissoes.length,0);assert.equal(p.leituras(),0);assert.equal(p.no('enviar').disabled,true);
});
test('endereços externos, credenciais e portas inválidas são recusados antes de pedir permissão',async()=>{
 const p=await popup();for(const v of ['https://evil.com/'+TOKEN,'8794@evil.com.'+TOKEN,'65536.'+TOKEN,'80.'+TOKEN]){p.no('codigo').value=v;await p.clicar('conectar');}assert.equal(p.pedidos.length,0);assert.equal(p.permissoes.length,0);assert.match(p.no('status').textContent,/código temporário/);
});
test('conexão pede apenas loopback; envio ocorre por clique e não aceita redirects ou cookies',async()=>{
 const p=await popup();p.no('codigo').value=CODIGO;await p.clicar('conectar');assert.equal(p.permissoes.length,1);assert.equal(p.permissoes[0].origins.join(','),'http://127.0.0.1/*');assert.equal(p.pedidos.length,1);assert.equal(p.leituras(),0);assert.equal(p.no('codigo').value,'');assert.match(p.no('conexao').textContent,/example.com/);
 await p.clicar('enviar');assert.equal(p.leituras(),1);assert.equal(p.pedidos.length,2);const r=p.pedidos[1];assert.equal(r.url,ORIGEM+'/api/google-local/receber');assert.equal(r.opcoes.credentials,'omit');assert.equal(r.opcoes.redirect,'error');const payload=JSON.parse(r.opcoes.body);assert.equal(payload.codigo,TOKEN);assert.deepEqual(payload.captura,p.capture);assert.equal(p.store.conexaoGoogleLocal.restantes,19);assert.match(p.no('status').textContent,/Captura recebida/);
});
test('recusar permissão local conserva download sem rede',async()=>{
 const p=await popup({permitido:false});p.no('codigo').value=CODIGO;await p.clicar('conectar');assert.equal(p.pedidos.length,0);assert.equal(p.no('enviar').disabled,true);await p.clicar('capturar');assert.equal(p.leituras(),1);assert.equal(p.pedidos.length,0);assert.equal(p.downloads.length,1);
});
test('revisão recusada pelo aplicativo é apresentada sem afirmar que a captura foi recebida',async()=>{
 const p=await popup({recusarEnvio:true});p.no('codigo').value=CODIGO;await p.clicar('conectar');await p.clicar('enviar');assert.match(p.no('status').textContent,/projeto mudou/);assert.equal(p.store.conexaoGoogleLocal,undefined);assert.deepEqual(p.store.capturaGooglePendente.captura,p.capture);
});
test('desconectar revoga o código, remove a sessão e a permissão local',async()=>{
 const p=await popup();p.no('codigo').value=CODIGO;await p.clicar('conectar');await p.clicar('desconectar');assert.equal(p.pedidos.at(-1).url,ORIGEM+'/api/google-local/revogar');assert.equal(p.store.conexaoGoogleLocal,undefined);assert.equal(p.removidas.length,1);assert.equal(p.no('enviar').disabled,true);
});
test('sessão expirada não é reutilizada e página bloqueada não é enviada',async()=>{
 const p=await popup({inicial:{endereco:ORIGEM,codigo:TOKEN,dominio:'example.com',expiraEm:'2020-01-01T00:00:00Z'}});assert.equal(p.store.conexaoGoogleLocal,undefined);assert.equal(p.no('enviar').disabled,true);assert.equal(p.pedidos.length,0);
 const b=await popup({falharCaptura:true});b.no('codigo').value=CODIGO;await b.clicar('conectar');await b.clicar('enviar');assert.equal(b.pedidos.length,1);assert.match(b.no('status').textContent,/captura interrompida/);
});
test('manifesto não concede hosts Google, acesso amplo, cookies ou histórico',()=>{
 const m=JSON.parse(readFileSync(new URL('../extensoes/google-local/manifest.json',import.meta.url),'utf8'));assert.deepEqual(m.optional_host_permissions,['http://127.0.0.1/*']);assert.equal(m.host_permissions,undefined);for(const proibida of ['cookies','history','tabs','webRequest','<all_urls>'])assert.ok(!m.permissions.includes(proibida));assert.ok(m.permissions.includes('activeTab'));assert.ok(m.permissions.includes('scripting'));
});
test('resposta perdida preserva os mesmos bytes e reenvio não recaptura a aba',async()=>{
 let perder=true;const p=await popup({aoPedir:async url=>{if(url.endsWith('/receber')&&perder){perder=false;throw TypeError('Failed to fetch');}}});
 p.no('codigo').value=CODIGO;await p.clicar('conectar');await p.clicar('enviar');assert.equal(p.leituras(),1);assert.ok(p.store.capturaGooglePendente);assert.equal(p.no('enviar').textContent,'Reenviar mesma captura');assert.match(p.no('status').textContent,/preservada/);
 const before=p.pedidos.at(-1).opcoes.body;await p.clicar('enviar');assert.equal(p.pedidos.at(-1).opcoes.body,before);assert.equal(p.leituras(),1);assert.equal(p.store.capturaGooglePendente,undefined);assert.match(p.no('status').textContent,/Captura recebida/);
});
test('reabrir popup restaura pendência sem rede e envia a captura original',async()=>{
 const p=await popup({aoPedir:async url=>{if(url.endsWith('/receber'))throw Error('Resposta interrompida');}});p.no('codigo').value=CODIGO;await p.clicar('conectar');await p.clicar('enviar');
 const q=await popup({armazenamentoInicial:p.store});assert.equal(q.pedidos.length,0);assert.equal(q.leituras(),0);assert.equal(q.no('enviar').textContent,'Reenviar mesma captura');await q.clicar('enviar');assert.equal(q.leituras(),0);assert.deepEqual(JSON.parse(q.pedidos[0].opcoes.body).captura,p.capture);
});
test('download da pendência e descarte não releem página nem apagam dados do servidor',async()=>{
 const p=await popup({aoPedir:async url=>{if(url.endsWith('/receber'))throw Error('Resposta interrompida');}});p.no('codigo').value=CODIGO;await p.clicar('conectar');await p.clicar('enviar');const n=p.pedidos.length;
 await p.clicar('capturar');assert.equal(p.leituras(),1);assert.deepEqual(JSON.parse(await p.blobs[0].text()),p.capture);assert.ok(p.store.capturaGooglePendente);
 await p.clicar('descartar-pendente');assert.equal(p.pedidos.length,n);assert.equal(p.store.capturaGooglePendente,undefined);assert.match(p.no('status').textContent,/não apaga/);
});
test('pendência de outro domínio impede trocar projeto silenciosamente',async()=>{
 let conferir=0;const p=await popup({aoPedir:async url=>{if(url.endsWith('/receber'))throw Error('Resposta interrompida');if(url.endsWith('/conferir')&&++conferir===2)return{ok:true,status:200,json:async()=>({dominio:'outro.com',expiraEm:new Date(Date.now()+600000).toISOString(),restantes:20})};}});
 p.no('codigo').value=CODIGO;await p.clicar('conectar');await p.clicar('enviar');p.no('codigo').value='8794.'+'y'.repeat(43);await p.clicar('conectar');
 assert.equal(p.store.conexaoGoogleLocal.dominio,'example.com');assert.equal(p.store.capturaGooglePendente.dominio,'example.com');assert.match(p.no('status').textContent,/outro projeto/);
});
test('código expirado conserva captura e aceita reconexão ao mesmo domínio',async()=>{
 let expired=true;const p=await popup({aoPedir:async url=>{if(url.endsWith('/receber')&&expired){expired=false;return{ok:false,status:401,json:async()=>({erro:'Código expirado.'})};}}});
 p.no('codigo').value=CODIGO;await p.clicar('conectar');await p.clicar('enviar');assert.equal(p.store.conexaoGoogleLocal,undefined);assert.ok(p.store.capturaGooglePendente);assert.equal(p.no('enviar').disabled,true);
 p.no('codigo').value='8794.'+'y'.repeat(43);await p.clicar('conectar');await p.clicar('enviar');assert.equal(p.leituras(),1);assert.equal(p.store.capturaGooglePendente,undefined);
});
test('resposta sem JSON não vira confirmação nem perde a captura',async()=>{
 const p=await popup({aoPedir:async url=>url.endsWith('/receber')?{ok:true,status:200,json:async()=>{throw SyntaxError('JSON incompleto');}}:null});p.no('codigo').value=CODIGO;await p.clicar('conectar');await p.clicar('enviar');assert.ok(p.store.capturaGooglePendente);assert.match(p.no('status').textContent,/não confirmou/);assert.doesNotMatch(p.no('status').textContent,/Captura recebida/);
});
test('pendência inválida em memória não inicia rede, captura ou download',async()=>{
 const p=await popup({armazenamentoInicial:{capturaGooglePendente:{dominio:'example.com',captura:{url:'javascript:alert(1)',html:'texto'}}}});assert.equal(p.store.capturaGooglePendente,undefined);assert.equal(p.pedidos.length,0);assert.equal(p.leituras(),0);assert.equal(p.downloads.length,0);
});
test('cliques simultâneos aguardam o envio e não geram segunda captura',async()=>{
 let release;const barrier=new Promise(r=>{release=r;});const p=await popup({aoPedir:async url=>{if(url.endsWith('/receber'))await barrier;}});p.no('codigo').value=CODIGO;await p.clicar('conectar');const first=p.clicar('enviar');await new Promise(setImmediate);await p.clicar('enviar');assert.equal(p.leituras(),1);assert.equal(p.pedidos.length,2);release();await first;
});
