import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {carregarConfiguracao, ErroConfiguracao} from './lib/config.mjs';
import {criarWorker} from './src/worker.mjs';
import {coletarSite} from './src/coleta.mjs';
import {consultarGoogle} from './src/serpapi.mjs';
import {criarExecutorIA} from './lib/ia-local.mjs';
import {criarFonteGoogleAds} from './src/modulos/google-ads.mjs';
import {criarEntendimentoLocal} from './lib/entendimento-local.mjs';
import {prepararJornadas} from './ia/negocio/jornadas/preparar.mjs';
import {criarGoogleLocal} from './lib/google-local.mjs';
import {criarPacoteExtensaoGoogle} from './lib/extensao-google.mjs';
import {criarConexoesGoogleLocais,origemExtensaoGoogle} from './lib/conexao-google-local.mjs';

function rejeitar(resposta, status, mensagem) {
  resposta.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', Connection: 'close'});
  resposta.end(JSON.stringify({erro: mensagem}));
}

function origemLocal(request, porta) {
  if (request.rawHeaders.filter((_, i, lista) => i % 2 === 0 && lista[i].toLowerCase() === 'host').length !== 1) return null;
  const host = request.headers.host;
  if (typeof host !== 'string' || /[\s/@\\?#]/.test(host)) return null;
  let url;
  try { url = new URL('http://' + host); } catch { return null; }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || Number(url.port || 80) !== porta) return null;
  return url.origin;
}

async function lerCorpo(request, maximo = 4096) {
  if (Number(request.headers['content-length']) > maximo) throw new Error('tamanho');
  const partes = [];
  let tamanho = 0, timer;
  const limite = new Promise((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error('tempo')), 5000);
  });
  try {
    return await Promise.race([limite, (async () => {
      for await (const parte of request) {
        tamanho += parte.length;
        if (tamanho > maximo) throw new Error('tamanho');
        partes.push(parte);
      }
      return tamanho ? Buffer.concat(partes, tamanho) : undefined;
    })()]);
  } finally { clearTimeout(timer); }
}

export async function criarServidor(opcoes = {}) {
  const config = carregarConfiguracao(opcoes);
  const {abrirBanco} = await import('./lib/sqlite.mjs');
  const banco = abrirBanco({arquivo: config.arquivoBanco});
  let worker,entendimento,proposicoes;
  let legadoOcupado=false;
  try {
    if (opcoes.worker) worker = opcoes.worker;
    else {
      const fetchPublico = opcoes.fetchPublico ?? (await import('./lib/rede-publica.mjs')).fetchPublico;
      let html = await readFile(new URL('./src/portal.html', import.meta.url), 'utf8');
      const htmlProjeto = await readFile(new URL('./src/projeto.html', import.meta.url), 'utf8');
      html = html.replace('<!--PROJETO_LOCAL-->', '<a href="/projeto" class="como">Análise por módulos</a>');
      const ia = opcoes.iaLocal ?? criarExecutorIA();
      const googleLocal=opcoes.googleLocal??criarGoogleLocal({dataDir:config.dataDir});
      entendimento=opcoes.entendimentoLocal??criarEntendimentoLocal({dataDir:config.dataDir,preparar:prepararJornadas,podeIniciar:()=>!legadoOcupado});
      proposicoes=opcoes.proposicoesLocal??criarEntendimentoLocal({dataDir:config.dataDir,preparar:prepararJornadas,motor:'proposicoes',limiteMs:900000,podeIniciar:()=>!legadoOcupado});
      const entendimentoDisponivel=await entendimento.disponivel();
      const modoPesquisa=opcoes.habilitarProposicoes===true;
      const proposicoesDisponiveis=modoPesquisa&&await proposicoes.disponivel();
      const executarLegado=async(entrada,candidata=false)=>{
        if(legadoOcupado||entendimento.ocupado?.()||proposicoes?.ocupado?.())throw new Error('Outro modelo local está em execução.');
        legadoOcupado=true;try{return await ia.executar(entrada,candidata?{candidata:true}:undefined);}finally{legadoOcupado=false;}
      };
      const iaDisponivel = await ia.disponivel();
      if (iaDisponivel) html = html.replace('const IA_LOCAL_HABILITADA = false;', 'const IA_LOCAL_HABILITADA = true;');
      const candidataDisponivel = iaDisponivel && typeof ia.candidataDisponivel === 'function' && await ia.candidataDisponivel();
      if (candidataDisponivel) html = html.replace('const IA_CANDIDATA_HABILITADA = false;', 'const IA_CANDIDATA_HABILITADA = true;');
      worker = criarWorker(html, {
        htmlProjeto,
        consultarDemanda: opcoes.consultarDemanda ?? criarFonteGoogleAds({env:opcoes.env ?? process.env}),
        coletar: opcoes.coletar ?? ((dominio, options) => coletarSite(dominio, {...options, fetch: fetchPublico})),
        consultarGoogle: opcoes.consultarGoogle ?? ((entrada, options) => consultarGoogle(entrada, {...options, fetch: fetchPublico})),
        registrarEvidencias:coleta=>entendimento.registrar(coleta),
        registrarGoogleLocal:pedido=>googleLocal.registrar(pedido),
        conexaoDiretaGoogleLocal:true,
        ...(typeof entendimento.consultar==='function'?{consultarEntendimento:pedido=>entendimento.consultar(pedido)}:{}),
        ...(typeof proposicoes.consultar==='function'?{consultarProposicoes:pedido=>proposicoes.consultar(pedido)}:{}),
        ...(entendimentoDisponivel?{iniciarEntendimento:pedido=>entendimento.iniciar(pedido)}:{}),
        ...(proposicoesDisponiveis?{iniciarProposicoes:pedido=>proposicoes.iniciar(pedido)}:{}),
        ...(iaDisponivel ? {executarIA: entrada => executarLegado(entrada)} : {}),
        ...(candidataDisponivel ? {executarIACandidata: entrada => executarLegado(entrada,true)} : {}),
      });
    }
    if (typeof worker?.fetch !== 'function') throw new Error('Worker inválido');
  } catch (erro) { banco.close(); throw erro; }
  const envWorker = {DB: banco, SERPAPI_KEY: config.chave, MODULOS_LOCAIS: true};
  const executarProjeto=async(dados)=>{
    const request=new Request('http://127.0.0.1/api/projeto',{method:'POST',headers:{'Content-Type':'application/json','Origin':'http://127.0.0.1'},body:JSON.stringify(dados)});
    const res=await worker.fetch(request,envWorker),obj=await res.json();
    if(!res.ok){const erro=new Error(obj.erro||'Não foi possível acessar o projeto local.');erro.status=res.status;throw erro;}return obj;
  };
  const conexoesGoogle=criarConexoesGoogleLocais({consultarProjeto:site=>executarProjeto({site,acao:'consultar'}),
    registrarCaptura:pedido=>executarProjeto({...pedido,acao:'registrar_google_local'})});
  const tarefas = new Set();
  const server = createServer((entrada, saida) => {
    const tarefa = (async () => {
      const origem = origemLocal(entrada, server.address()?.port);
      if (!origem) return rejeitar(saida, 403, 'Use o endereço local exibido ao iniciar o projeto.');
      if (!entrada.url?.startsWith('/') || entrada.url.startsWith('//')) return rejeitar(saida, 400, 'Endereço de consulta inválido.');
      const url = new URL(entrada.url, origem);
      if (url.origin !== origem) return rejeitar(saida, 400, 'Endereço de consulta inválido.');
      if(url.pathname.startsWith('/api/google-local/')&&url.search)return rejeitar(saida,400,'Envie a conexão pelo corpo JSON, sem parâmetros na URL.');
      const rotaExtensao=['/api/google-local/receber','/api/google-local/conferir','/api/google-local/revogar'].includes(url.pathname),
        origemExtensao=origemExtensaoGoogle(entrada.headers.origin);
      if(rotaExtensao){
        if(!origemExtensao)return rejeitar(saida,403,'Esta rota é exclusiva da extensão conectada ao projeto local.');
        const cors={'Access-Control-Allow-Origin':origemExtensao,'Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
        if(entrada.method==='OPTIONS'){
          if(entrada.headers['access-control-request-method']!=='POST'||String(entrada.headers['access-control-request-headers']||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).some(s=>s!=='content-type'))return rejeitar(saida,403,'Pré-consulta da extensão inválida.');
          saida.writeHead(204,{...cors,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Private-Network':'true','Access-Control-Max-Age':'300'});return saida.end();
        }
        if(entrada.method!=='POST'){saida.writeHead(405,{...cors,Allow:'POST'});return saida.end();}
        try{
          if(!/^application\/json(?:;|$)/iu.test(entrada.headers['content-type']||''))throw Object.assign(new Error('Envie a captura como JSON.'),{status:415});
          const raw=await lerCorpo(entrada,65536);let obj;try{obj=JSON.parse(raw?.toString()||'');}catch{throw Object.assign(new Error('JSON inválido.'),{status:400});}
          let resultado;
          if(url.pathname.endsWith('/receber'))resultado=await conexoesGoogle.registrar(obj);
          else{
            if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).some(k=>k!=='codigo'))throw Object.assign(new Error('Informe apenas o código temporário.'),{status:400});
            resultado=url.pathname.endsWith('/revogar')?conexoesGoogle.revogar(obj.codigo):conexoesGoogle.consultar(obj.codigo);
          }
          saida.writeHead(200,{...cors,'Content-Type':'application/json; charset=utf-8'});return saida.end(JSON.stringify(resultado));
        }catch(e){
          const status=e.message==='tamanho'?413:e.message==='tempo'?408:Number.isInteger(e.status)?e.status:503;
          saida.writeHead(status,{...cors,'Content-Type':'application/json; charset=utf-8'});return saida.end(JSON.stringify({erro:status===503?'Não foi possível receber a captura local agora.':e.message}));
        }
      }
      if (entrada.method === 'POST') {
        const origin = entrada.headers.origin;
        const browser = Object.keys(entrada.headers).some(h => h.startsWith('sec-fetch-'));
        if (origin && origin !== origem || !origin && browser || entrada.headers['sec-fetch-site'] === 'cross-site') {
          return rejeitar(saida, 403, 'Abra o formulário no endereço local do projeto.');
        }
      }
      if(url.pathname==='/api/google-local/conexao'){
        if(entrada.method!=='POST')return rejeitar(saida,405,'Use o botão de conexão no projeto local.');
        try{
          if(!/^application\/json(?:;|$)/iu.test(entrada.headers['content-type']||''))return rejeitar(saida,415,'Envie o projeto como JSON.');
          const raw=await lerCorpo(entrada,4096);let dados;try{dados=JSON.parse(raw?.toString()||'');}catch{return rejeitar(saida,400,'Projeto JSON inválido.');}
          const {codigo,...meta}=await conexoesGoogle.criar(dados);
          saida.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
          return saida.end(JSON.stringify({...meta,codigoLocal:server.address().port+'.'+codigo}));
        }catch(e){return rejeitar(saida,e.message==='tamanho'?413:e.message==='tempo'?408:Number.isInteger(e.status)?e.status:503,Number.isInteger(e.status)?e.message:'Não foi possível criar uma conexão local agora.');}
      }
      if (url.pathname === '/healthz' && ['GET', 'HEAD'].includes(entrada.method)) {
        saida.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
        return saida.end(entrada.method === 'HEAD' ? undefined : JSON.stringify({status: 'ok', fonteConfigurada: config.fonteConfigurada}));
      }
      if(['/google-local','/google-local/extensao.zip'].includes(url.pathname)&&['GET','HEAD'].includes(entrada.method)){
        const zip=url.pathname.endsWith('.zip');
        const enviar=async()=>{
          const conteudo=zip?await criarPacoteExtensaoGoogle():await readFile(new URL('./src/google-local.html',import.meta.url));
          saida.writeHead(200,{'Content-Type':zip?'application/zip':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin',
            ...(zip?{'Content-Disposition':'attachment; filename="visibilidade-google-local.zip"'}:{'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"})});
          saida.end(entrada.method==='HEAD'?undefined:conteudo);
        };const tarefa=enviar().catch(()=>{if(!saida.headersSent)rejeitar(saida,503,'Não foi possível preparar os arquivos locais.');else saida.destroy();}).finally(()=>tarefas.delete(tarefa));tarefas.add(tarefa);return;
      }
      if(url.pathname==='/api/capacidades'&&['GET','HEAD'].includes(entrada.method)){
        const dados={versao:1,modo:'local',cadastroNecessario:false,coleta:{disponivel:true,htmlInicial:true},
          entendimento:{instalado:!!entendimento&&await entendimento.disponivel(),estado:'experimental',requerConfirmacao:true},
          ...(opcoes.habilitarProposicoes===true?{proposicoes:{instalado:await proposicoes.disponivel(),estado:'experimental',padrao:false,requerConfirmacao:true}}:{}),
          googleLocal:{disponivel:true,modo:'pagina_aberta',enviaConsultas:false,conexaoDireta:true},tarefas:{disponivel:true},premissas:{disponivel:true},
          posicoes:{configurada:config.fonteConfigurada,estado:config.fonteConfigurada?'configurada_nao_testada':'nao_configurada',consultaAutomatica:false},
          limite:'Disponibilidade de instalação não comprova qualidade da IA nem acesso, saldo ou resultados atuais de fornecedor.'};
        saida.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        return saida.end(entrada.method==='HEAD'?undefined:JSON.stringify(dados));
      }
      let body;
      if (!['GET', 'HEAD'].includes(entrada.method)) {
        try { body = await lerCorpo(entrada, url.pathname === '/api/projeto' ? 65536 : 4096); }
        catch (erro) { return rejeitar(saida, erro.message === 'tamanho' ? 413 : 408, 'Não foi possível receber a consulta. Envie apenas o domínio no formulário.'); }
      }
      const headers = new Headers();
      for (const [nome, valor] of Object.entries(entrada.headers)) if (valor != null && nome !== 'cf-connecting-ip') {
        headers.set(nome, Array.isArray(valor) ? valor.join(', ') : valor);
      }
      const request = new Request(url, {method: entrada.method, headers, ...(body ? {body} : {})});
      const resposta = await worker.fetch(request, envWorker);
      if (!(resposta instanceof Response)) throw new Error('Resposta inválida');
      saida.writeHead(resposta.status, Object.fromEntries(resposta.headers));
      if (entrada.method === 'HEAD' || !resposta.body) { await resposta.body?.cancel(); return saida.end(); }
      await pipeline(Readable.fromWeb(resposta.body), saida);
    })().catch(() => {
      if (!saida.headersSent && !saida.destroyed) rejeitar(saida, 503, 'Não foi possível concluir a consulta local agora.');
      else saida.destroy();
    });
    tarefas.add(tarefa);
    tarefa.finally(() => tarefas.delete(tarefa));
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_erro, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  try {
    await new Promise((resolver, rejeitar) => {
      server.once('error', rejeitar);
      server.listen(config.porta, config.host, () => { server.off('error', rejeitar); resolver(); });
    });
  } catch (erro) { banco.close(); throw erro; }
  const porta = server.address().port;
  let encerramento;
  return {server, porta, endereco: 'http://127.0.0.1:' + porta,
    configuracao: {porta, dataDir: config.dataDir, fonteConfigurada: config.fonteConfigurada},
    fechar() {
      if (!encerramento) encerramento = (async () => {
        await new Promise((resolver, rejeitar) => {
          server.close(erro => erro ? rejeitar(erro) : resolver());
          server.closeIdleConnections();
        });
        await Promise.allSettled([...tarefas]);
        await entendimento?.fechar?.();
        await proposicoes?.fechar?.();
        conexoesGoogle.fechar();
        banco.close();
      })();
      return encerramento;
    },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const servidor = await criarServidor();
    let encerrando = false;
    const encerrar = () => {
      if (encerrando) return;
      encerrando = true;
      servidor.fechar().catch(() => { process.exitCode = 1; });
    };
    process.once('SIGINT', encerrar);
    process.once('SIGTERM', encerrar);
    console.log('Visibilidade Aberta disponível em ' + servidor.endereco + '/projeto');
  } catch (erro) {
    if (erro?.code === 'EADDRINUSE') {
      console.error('A porta local está em uso. Execute PORT=0 npm start para usar uma porta livre e abra o endereço exibido.');
    } else {
      console.error(erro instanceof ErroConfiguracao ? erro.message : 'Não foi possível iniciar o servidor local. Verifique a porta, o diretório de dados e as migrações.');
    }
    process.exitCode = 1;
  }
}
