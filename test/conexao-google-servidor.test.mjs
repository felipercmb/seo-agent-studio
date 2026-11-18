import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {criarServidor} from '../server.mjs';
const EXT='chrome-extension://'+'a'.repeat(32);
async function ambiente(t){
 const dir=await mkdtemp(join(tmpdir(),'google-conexao-http-'));let coletas=0,google=0;
 const app=await criarServidor({carregarEnv:false,env:{PORT:'0',DATA_DIR:dir},iaLocal:{disponivel:async()=>false},coletar:async dominio=>{coletas++;const html='<h1>Agenda</h1><p>Fornecemos software de agenda para equipes.</p>';return{dominio,coletadoEm:new Date().toISOString(),paginas:[{url:'https://example.com/',status:200,html,sha256:createHash('sha256').update(html).digest('hex')}],falhas:[]};},consultarGoogle:async()=>{google++;throw Error('Não executar consultas.');}});
 t.after(async()=>{await app.fechar();await rm(dir,{recursive:true,force:true});});
 const request=async(path,body,{origin=app.endereco,method='POST',headers={}}={})=>{const res=await fetch(app.endereco+path,{method,headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{}),...headers},...(method!=='GET'?{body:body===undefined?undefined:JSON.stringify(body)}:{})});const raw=await res.text();let data;try{data=JSON.parse(raw);}catch{}return{status:res.status,data,raw,headers:res.headers};};
 const initial=await request('/api/projeto',{site:'example.com',acao:'iniciar'});assert.equal(initial.status,200);
 const mint=async()=>request('/api/google-local/conexao',{site:'example.com',revisao:(await request('/api/projeto',{site:'example.com',acao:'consultar'})).data.revisao});
 return{app,request,mint,coletas:()=>coletas,google:()=>google};
}
function captura(){return{formato:'visibilidade-google-local',versao:1,metodo:'pagina_aberta',url:'https://www.google.com/search?q=agenda&udm=14&hl=pt-BR&gl=br',coletadoEm:new Date().toISOString(),dispositivo:'computador',localidadeDeclarada:null,html:'<div id="rso"><div class="g"><a href="https://rival.com/"><h3>Rival</h3></a></div><div class="g"><a href="https://example.com/"><h3>Agenda</h3></a></div></div>'};}
test('extensão conecta e envia diretamente a um único projeto sem ler perfil, repetir coleta ou chamar Google',async t=>{
 const a=await ambiente(t),m=await a.mint();assert.equal(m.status,200);const codigo=m.data.codigoLocal.split('.')[1];assert.equal(m.headers.get('cache-control'),'no-store');
 const info=await a.request('/api/google-local/conferir',{codigo},{origin:EXT});assert.equal(info.status,200);assert.equal(info.data.dominio,'example.com');assert.equal(info.data.codigo,undefined);assert.equal(info.data.perfil,undefined);assert.equal(info.headers.get('access-control-allow-origin'),EXT);
 const cap=captura(),r=await a.request('/api/google-local/receber',{codigo,captura:cap},{origin:EXT});assert.equal(r.status,200);assert.equal(r.data.capturasNoProjeto,1);assert.equal(r.data.perfil,undefined);assert.ok(!r.raw.includes(codigo));
 const retry=await a.request('/api/google-local/receber',{codigo,captura:cap},{origin:EXT});assert.equal(retry.data.estado,'ja_recebida');const p=(await a.request('/api/projeto',{site:'example.com',acao:'consultar'})).data;assert.equal(p.googleLocal.capturas.length,1);assert.equal(p.googleLocal.capturas[0].ordemNaPagina,2);assert.equal(p.posicoes,null);assert.ok(!JSON.stringify(p).includes(codigo));assert.equal(a.coletas(),1);assert.equal(a.google(),0);
});
test('origem web externa não cria código nem envia captura, mesmo conhecendo um código válido',async t=>{
 const a=await ambiente(t),m=await a.mint(),codigo=m.data.codigoLocal.split('.')[1];
 assert.equal((await a.request('/api/google-local/conexao',{site:'example.com',revisao:1},{origin:'https://evil.com'})).status,403);
 for(const origin of ['https://evil.com','null',a.app.endereco]){const r=await a.request('/api/google-local/receber',{codigo,captura:captura()},{origin});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);}
 assert.equal((await a.request('/api/google-local/receber',{codigo:'x'.repeat(43),captura:captura()},{origin:EXT})).status,401);
 assert.equal((await a.request('/api/projeto',{site:'example.com',acao:'consultar'})).data.googleLocal.capturas.length,0);
});
test('preflight é específico da extensão e permite só POST JSON; códigos na URL não são aceitos',async t=>{
 const a=await ambiente(t),r=await a.request('/api/google-local/receber',undefined,{method:'OPTIONS',origin:EXT,headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),EXT);assert.equal(r.headers.get('access-control-allow-credentials'),null);
 assert.equal((await a.request('/api/google-local/receber',undefined,{method:'OPTIONS',origin:EXT,headers:{'Access-Control-Request-Method':'GET'}})).status,403);
 assert.equal((await a.request('/api/google-local/conferir?codigo=valor',{}, {origin:EXT})).status,400);
 assert.equal((await a.request('/api/google-local/conferir',undefined,{method:'GET',origin:EXT})).status,405);
});
test('mudança de perfil invalida a revisão da conexão e revogação impede novos envios',async t=>{
 const a=await ambiente(t),m=await a.mint(),codigo=m.data.codigoLocal.split('.')[1];let p=(await a.request('/api/projeto',{site:'example.com',acao:'consultar'})).data;
 p=(await a.request('/api/projeto',{site:'example.com',acao:'salvar_perfil',revisao:p.revisao,perfil:{nome:'Nome revisado',confirmado:false}})).data;
 assert.equal((await a.request('/api/google-local/receber',{codigo,captura:captura()},{origin:EXT})).status,409);assert.equal(p.googleLocal.capturas.length,0);
 const n=await a.mint(),novo=n.data.codigoLocal.split('.')[1];assert.equal((await a.request('/api/google-local/revogar',{codigo:novo},{origin:EXT})).status,200);assert.equal((await a.request('/api/google-local/conferir',{codigo:novo},{origin:EXT})).status,401);
});
