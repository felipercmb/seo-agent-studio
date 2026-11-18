/** Ativação local e pontual da fonte, sem expor a chave no chat ou nos logs. */
import {createServer} from 'node:http';
import {open, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {RAIZ_PROJETO} from '../lib/config.mjs';
import {fetchPublico} from '../lib/rede-publica.mjs';
import {ErroFonte, verificarContaGratuita} from '../src/serpapi.mjs';

const pagina = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ativar fonte gratuita · Visibilidade Aberta</title><style>body{font:17px/1.5 system-ui,sans-serif;background:#f5f7f5;color:#182d28;max-width:42rem;margin:3rem auto;padding:0 1rem}main{background:white;border:1px solid #d5e1dc;border-radius:1rem;padding:2rem}h1{line-height:1.15}input,button{font:inherit;padding:.7rem;box-sizing:border-box}input{width:100%;margin:.5rem 0 1rem;border:1px solid #879e94;border-radius:.4rem}button{background:#087a63;border:0;border-radius:.4rem;color:white;cursor:pointer}button:disabled{opacity:.6}#aviso{min-height:2em}</style></head><body><main><h1>Ativar a fonte gratuita</h1><p>Copie a chave de API do painel da SerpApi e cole abaixo. Ela será validada diretamente com a SerpApi e guardada neste computador, sem aparecer no chat.</p><p>O aplicativo só aceita o plano gratuito compatível, sem créditos extras. Não adicione cartão ou plano pago para este teste.</p><form id="f"><label for="chave">Chave da SerpApi</label><input id="chave" type="password" autocomplete="off" spellcheck="false" minlength="16" maxlength="256" required><button type="submit">Validar e ativar</button></form><p id="aviso" role="status" aria-live="polite"></p></main><script>'use strict';const f=document.querySelector('#f'),campo=document.querySelector('#chave'),aviso=document.querySelector('#aviso'),botao=f.querySelector('button');f.addEventListener('submit',async e=>{e.preventDefault();botao.disabled=true;aviso.textContent='Validando o plano gratuito…';try{const r=await fetch('/configurar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:campo.value})});const d=await r.json();aviso.textContent=d.mensagem;if(r.ok){campo.value='';f.hidden=true;}}catch{aviso.textContent='Não foi possível completar a validação. Verifique a conexão e tente novamente.'}finally{botao.disabled=false}});</script></body></html>`;

async function ler(req) {
  const partes=[];let tamanho=0;
  for await (const p of req) { tamanho+=p.length;if(tamanho>4096)throw Error('grande');partes.push(p); }
  return JSON.parse(Buffer.concat(partes).toString('utf8'));
}

export async function iniciarConfigurador({porta=8796,arquivo=join(RAIZ_PROJETO,'.env'),
    verificar=chave=>verificarContaGratuita(chave,{fetch:fetchPublico})}={}) {
  let gravando=false;
  const server=createServer(async(req,res)=>{
    const responder=(codigo,valor,tipo='application/json')=>{
      res.writeHead(codigo,{'Content-Type':tipo+'; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});
      res.end(tipo==='application/json'?JSON.stringify({mensagem:valor}):valor);
    };
    const host=`127.0.0.1:${server.address().port}`,origem=`http://${host}`;
    if(req.headers.host!==host) return responder(403,'Abra o endereço local indicado.');
    if(req.method==='GET' && req.url==='/')return responder(200,pagina,'text/html');
    if(req.method!=='POST'||req.url!=='/configurar')return responder(404,'Página não encontrada.');
    if(req.headers.origin!==origem || req.headers['sec-fetch-site']==='cross-site' ||
       !/^application\/json(?:;|$)/i.test(req.headers['content-type']||'') ||
       Number(req.headers['content-length'])>4096) return responder(403,'Abra a página local para configurar a fonte.');
    if(gravando)return responder(409,'Uma validação já está em andamento.');
    gravando=true;
    try {
      const dados=await ler(req);
      if(!dados||typeof dados!=='object'||Array.isArray(dados)||Object.keys(dados).join()!=='chave'||
         typeof dados.chave!=='string')return responder(400,'Confira a chave e tente novamente.');
      dados.chave=dados.chave.trim();
      if(!/^[a-zA-Z0-9_-]{16,256}$/.test(dados.chave))return responder(400,'Confira a chave e tente novamente.');
      await verificar(dados.chave);
      let f;
      try { f=await open(arquivo,'wx',0o600);await f.writeFile('SERPAPI_KEY='+dados.chave+'\n'); }
      catch(erro) {
        if(f)await unlink(arquivo).catch(()=>{});
        if(erro.code==='EEXIST')return responder(409,'Já existe um arquivo .env. Para preservar sua configuração, atualize SERPAPI_KEY nesse arquivo manualmente.');
        return responder(500,'Não foi possível guardar a configuração local.');
      } finally { await f?.close().catch(()=>{}); }
      return responder(200,'Plano gratuito validado e chave salva neste computador. A fonte será ligada ao reiniciar o aplicativo.');
    } catch(erro) {
      const mensagem=erro instanceof ErroFonte?erro.message:'Não foi possível validar a conta. Confira a chave e a conexão.';
      return responder(400,mensagem);
    } finally {gravando=false;}
  });
  server.requestTimeout=15_000;server.headersTimeout=15_000;
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(porta,'127.0.0.1',()=>{server.off('error',fail);ok();});});
  return {server,endereco:`http://127.0.0.1:${server.address().port}`,fechar:()=>new Promise((ok,fail)=>server.close(e=>e?fail(e):ok()))};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  iniciarConfigurador().then(app=>console.log('Ativação local disponível em '+app.endereco)).catch(()=>{console.error('Não foi possível abrir a ativação local.');process.exitCode=1;});
}
