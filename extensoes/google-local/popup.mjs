import {capturarPaginaGoogle} from './capturar.mjs';
const $=id=>document.getElementById(id),status=$('status');
let conexao=null,pendente=null,ocupado=false,inicializando=true;
const PENDENTE='capturaGooglePendente';
function atualizar(){
 const bloqueado=ocupado||inicializando;
 for(const id of ['capturar','conectar','desconectar','descartar-pendente'])$(id).disabled=bloqueado;
 $('enviar').disabled=bloqueado||!conexao;
 $('enviar').textContent=pendente?'Reenviar mesma captura':'Capturar e enviar esta página';
 $('capturar').textContent=pendente?'Baixar captura pendente':'Baixar captura da página';
 $('desconectar').hidden=!conexao;$('descartar-pendente').hidden=!pendente;
 $('pendencia').textContent=pendente?'Envio ainda não confirmado para '+pendente.dominio+'. Busca: '+new URL(pendente.captura.url).searchParams.get('q')+'. Capturada em '+new Date(pendente.captura.coletadoEm).toLocaleString('pt-BR')+'. Reenvie os mesmos dados, baixe o arquivo ou descarte esta pendência.':'';
 $('conexao').textContent=conexao?'Projeto: '+conexao.dominio+'. Código válido até '+new Date(conexao.expiraEm).toLocaleTimeString('pt-BR')+'. Restam '+conexao.restantes+' novas capturas.':'Nenhum projeto conectado.';
}
function lerCodigo(valor){
 const m=/^([1-9]\d{0,4})\.([A-Za-z0-9_-]{43})$/u.exec(valor.trim());
 if(!m||+m[1]<1024||+m[1]>65535)throw Error('Cole o código temporário gerado pelo aplicativo local.');
 return{endereco:'http://127.0.0.1:'+m[1],codigo:m[2]};
}
function pendenteValida(p){
 try{
  const c=p?.captura,u=new URL(c?.url);
  return typeof p.dominio==='string'&&/^[a-z0-9.-]{3,253}$/u.test(p.dominio)&&c?.formato==='visibilidade-google-local'&&c.versao===1&&typeof c.html==='string'&&Number.isFinite(Date.parse(c.coletadoEm))&&u.protocol==='https:'&&['google.com','www.google.com','google.com.br','www.google.com.br'].includes(u.hostname)&&u.pathname==='/search'&&new TextEncoder().encode(JSON.stringify(c)).length<=60000;
 }catch{return false;}
}
async function guardarPendente(){if(pendente)await chrome.storage.session.set({[PENDENTE]:pendente});else await chrome.storage.session.remove(PENDENTE);}
async function apagarPendente(){await chrome.storage.session.remove(PENDENTE);pendente=null;}
async function limparConexao(){conexao=null;await chrome.storage.session.remove('conexaoGoogleLocal');}
async function api(dados,rota,body){
 if(!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/u.test(dados.endereco))throw Error('Endereço local inválido.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const r=await fetch(dados.endereco+'/api/google-local/'+rota,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codigo:dados.codigo,...body}),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
  let j;try{j=await r.json();}catch{const e=Error('O aplicativo não confirmou a resposta. Confira a análise antes de reenviar a mesma captura.');e.status=r.status;throw e;}
  if(!r.ok){const e=Error(j.erro||'O aplicativo local recusou o envio.');e.status=r.status;throw e;}return j;
 }finally{clearTimeout(timer);}
}
async function capturar(){
 const[tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw Error('Nenhuma aba ativa encontrada.');
 const resultados=await chrome.scripting.executeScript({target:{tabId:tab.id},func:capturarPaginaGoogle}),c=resultados[0]?.result;
 if(!c)throw Error('A página não pôde ser capturada.');if(new TextEncoder().encode(JSON.stringify(c)+'\n').length>60000)throw Error('A captura completa excedeu o limite local. Nada foi cortado ou salvo.');return c;
}
async function acao(func){
 if(ocupado||inicializando)return;ocupado=true;atualizar();
 try{await func();}
 catch(e){
  if(e?.status===401||e?.status===409)await limparConexao();
  status.textContent=(e?.name==='AbortError'?'O aplicativo local demorou a responder. Confira a análise antes de reenviar.':e?.message||'Não foi possível concluir a captura local.')+(pendente?' A mesma captura está preservada para reenvio ou download.':'');
 }finally{ocupado=false;atualizar();}
}
$('capturar').addEventListener('click',()=>acao(async()=>{
 status.textContent=pendente?'Preparando a captura pendente…':'Lendo o trecho desta aba…';
 const c=pendente?.captura||await capturar(),blob=new Blob([JSON.stringify(c)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='google-local-'+new Date().toISOString().replace(/[:.]/gu,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 status.textContent=pendente?'Arquivo da captura pendente preparado. O envio permanece não confirmado; verifique a análise ou importe este arquivo.':'Arquivo preparado. Importe-o em “Capturas do seu navegador” no projeto local.';
}));
$('conectar').addEventListener('click',()=>acao(async()=>{
 const dados=lerCodigo($('codigo').value);
 const permitido=await chrome.permissions.request({origins:['http://127.0.0.1/*']});if(!permitido)throw Error('Conexão não autorizada. Você pode continuar baixando o arquivo.');
 const meta=await api(dados,'conferir',{});
 if(pendente&&pendente.dominio!==meta.dominio)throw Error('Há uma captura pendente de '+pendente.dominio+'. Baixe ou descarte a pendência antes de conectar outro projeto.');
 conexao={...dados,...meta};await chrome.storage.session.set({conexaoGoogleLocal:conexao});$('codigo').value='';
 status.textContent='Conectado a '+conexao.dominio+'. '+(pendente?'A captura pendente pode ser reenviada sem nova leitura da página.':'Confira o projeto antes de enviar.');
}));
$('enviar').addEventListener('click',()=>acao(async()=>{
 if(!conexao||Date.parse(conexao.expiraEm)<=Date.now()){const e=Error('O código expirou. Gere outro no aplicativo local.');e.status=401;throw e;}
 if(pendente&&pendente.dominio!==conexao.dominio)throw Error('A pendência pertence a outro projeto. Baixe ou descarte-a antes de enviar.');
 if(!pendente){status.textContent='Capturando esta aba…';const nova={dominio:conexao.dominio,captura:await capturar()};if(!pendenteValida(nova))throw Error('A captura não passou pela conferência local. Nada foi enviado.');pendente=nova;await guardarPendente();}
 status.textContent='Enviando a mesma captura ao aplicativo deste computador…';
 const r=await api(conexao,'receber',{captura:pendente.captura});conexao={...conexao,...r};
 await chrome.storage.session.set({conexaoGoogleLocal:conexao});await apagarPendente();
 status.textContent='Captura recebida em '+r.dominio+'. Atualize as capturas no aplicativo local para ver o resultado.';
}));
$('descartar-pendente').addEventListener('click',()=>acao(async()=>{
 await apagarPendente();status.textContent='Pendência descartada deste navegador. Isso não apaga uma captura que o aplicativo já tenha recebido.';
}));
$('desconectar').addEventListener('click',()=>acao(async()=>{
 try{if(conexao)await api(conexao,'revogar',{});}catch{/* Grants expire even if the app stopped. */}
 await limparConexao();await chrome.permissions.remove({origins:['http://127.0.0.1/*']});
 status.textContent='Conexão removida do navegador.'+(pendente?' A captura pendente continua disponível para download ou descarte.':' Códigos no aplicativo expiram em até dez minutos.');
}));
atualizar();
try{
 const s=await chrome.storage.session.get(['conexaoGoogleLocal',PENDENTE]),c=s.conexaoGoogleLocal;
 if(c&&Date.parse(c.expiraEm)>Date.now()&&/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/u.test(c.endereco))conexao=c;
 else await chrome.storage.session.remove('conexaoGoogleLocal');
 if(pendenteValida(s[PENDENTE]))pendente=s[PENDENTE];else await chrome.storage.session.remove(PENDENTE);
 if(pendente&&conexao&&pendente.dominio!==conexao.dominio)await limparConexao();
}catch{status.textContent='O armazenamento temporário não está disponível. O download da captura continua disponível.';}
inicializando=false;atualizar();
