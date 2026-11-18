import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,rm,readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {criarEntendimentoLocal} from '../lib/entendimento-local.mjs';
import {prepararJornadas} from '../ia/negocio/jornadas/preparar.mjs';

const D='cliente.com.br',SHA=x=>createHash('sha256').update(x).digest('hex');
const raiz=fileURLToPath(new URL('../',import.meta.url));
const ordenar=x=>Array.isArray(x)?x.map(ordenar):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordenar(x[k])])):x;
const digest=x=>SHA(JSON.stringify(ordenar(x))),instante=()=>new Date(Date.now()-60000).toISOString();
const coleta=()=>({dominio:D,coletadoEm:instante(),paginas:[{url:'https://'+D+'/',html:'<h1>Assessoria</h1>'}],falhas:[]});
function preparada(c){return {base:{versao:1,dominio:c.dominio,fontes:[{id:'s01',texto:'Assessoria para contratação de artistas.',tipo:'declaracao'}]},
  mapaIds:{s01:'origem_01'},pool:{fontes:[{id:'origem_01',texto:'Assessoria para contratação de artistas.',tipo:'declaracao'}],arquivoPrivado:'/Users/segredo/local.json'},
  recuperacao:{versao:1,maxFontes:16,fontesRetidas:1,limitada:false,limites:['Cobertura limitada.'],selecoes:['/Users/segredo/origem']}};}
function resposta(entrada){
  const b=entrada.base,selecionadas=b.fontes.map(f=>structuredClone(f));
  if(!b.fontes.length)return{versao:2,estado:'sem_fontes',dominio:b.dominio,ofertas:[],duvidas:['Sem fontes.'],inferencias:[],perfilConfirmado:false,codigo:{}};
  const j={compradores:[],executores:[],beneficiarios:[],pagadores:[],condicoes:[],recusados:[],duvidas:[],revisaoSemantica:'pendente',perfilConfirmado:false,
    fontesSelecionadas:selecionadas,entradaSha256:digest({versao:1,dominio:b.dominio,fontes:selecionadas})};
  return{versao:2,estado:'revisao_necessaria',dominio:b.dominio,
    ofertas:[{nome:'Assessoria',natureza:'servico',papel_site:'intermedeia',evidencias:['s01'],citacoes:[b.fontes[0]],revisaoSemantica:'pendente',jornada:j}],
    ofertasIdentificadas:1,ofertasAnalisadas:1,recusadas:[],duvidas:[],modelo:{modeloBase:'qwen35-4b'},inferencias:[{inferida:true,textoBruto:'JSON privado'}],
    entradaSha256:digest(b),codigo:{'ia/negocio/jornadas/executar.py':'a'.repeat(64)},perfilConfirmado:false,limite:'Revisão necessária.'};
}
function spawner(comportamento){
  const chamadas=[];
  const iniciar=(comando,args,opcoes)=>{
    const f=new EventEmitter();f.stdin=new PassThrough();f.stdout=new PassThrough();f.stderr=new PassThrough();f.pid=999999;f.sinais=[];
    let fechado=false;f.encerrar=(codigo=0,sinal=null)=>{if(fechado)return;fechado=true;queueMicrotask(()=>f.emit('close',codigo,sinal));};
    f.kill=sinal=>{f.sinais.push(sinal);f.encerrar(null,sinal);return true;};
    let recebeu;f.recebeu=new Promise(r=>{recebeu=r;});
    const entrada=[];f.stdin.on('data',b=>entrada.push(b));f.stdin.on('finish',()=>{f.entrada=JSON.parse(Buffer.concat(entrada).toString());recebeu();comportamento?.(f,f.entrada);});
    chamadas.push({comando,args,opcoes,filho:f});return f;
  };
  return {iniciar,chamadas};
}
async function ambiente(t,{comportamento,preparar=preparada,limiteMs=10000,podeIniciar,motor='jornadas'}={}){
  const dataDir=await mkdtemp(join(tmpdir(),'entendimento-local-')),s=spawner(comportamento);
  const servico=criarEntendimentoLocal({dataDir,preparar,iniciar:s.iniciar,limiteMs,podeIniciar,motor});
  t.after(async()=>{await servico.fechar();await rm(dataDir,{recursive:true,force:true});});
  return{dataDir,servico,...s};
}
const concluir=(f,e)=>{f.stdout.write(JSON.stringify(resposta(e)));f.encerrar();};
async function terminado(s,job){for(let i=0;i<100;i++){const r=await s.consultar({dominio:job.dominio,id:job.id});if(r.estado!=='em_execucao')return r;await new Promise(r=>setTimeout(r,5));}throw new Error('Job falso não encerrou.');}
const caminho=(a,id,nome)=>join(a.dataDir,'evidencias-negocio','execucoes',id,nome);
const rejeita=(fn,status)=>assert.rejects(fn,e=>e.status===status);

test('registro preserva captura e preparação imutáveis por hash e expõe somente resumo público',async t=>{
  const a=await ambiente(t),c=coleta(),antes=structuredClone(c),r=await a.servico.registrar(c);
  assert.deepEqual(c,antes);assert.match(r.capturaId,/^cap_[a-f0-9]{64}$/);assert.equal(r.base.fontes[0].id,'s01');
  assert.doesNotMatch(JSON.stringify(r),/Users|pool|mapaIds|selecoes|html/);
  const b=await readFile(join(a.dataDir,'evidencias-negocio','capturas',r.capturaId+'.json'));
  assert.equal(r.capturaId,'cap_'+SHA(b));assert.deepEqual(JSON.parse(b).coleta,c);assert.equal(JSON.parse(b).preparacao.pool.arquivoPrivado,'/Users/segredo/local.json');
  assert.deepEqual(await a.servico.registrar(c),r);
});
test('registros simultâneos iguais produzem um único arquivo completo',async t=>{
  const a=await ambiente(t),c=coleta(),r=await Promise.all([a.servico.registrar(c),a.servico.registrar(c)]);
  assert.deepEqual(r[0],r[1]);assert.equal((await readdir(join(a.dataDir,'evidencias-negocio','capturas'))).length,1);
});
test('preparação incompatível não é aceita como captura do domínio',async t=>{
  const a=await ambiente(t,{preparar:c=>({...preparada(c),base:{...preparada(c).base,dominio:'rival.com.br'}})});
  await rejeita(()=>a.servico.registrar(coleta()),400);assert.equal(a.chamadas.length,0);
});
test('fontes repetidas, datas futuras e caminhos injetados na fonte são recusados',async t=>{
  for(const alterar of [p=>p.base.fontes.push(p.base.fontes[0]),p=>p.base.fontes[0].id='../s01']){
    const a=await ambiente(t,{preparar:c=>{const p=preparada(c);alterar(p);return p;}});await rejeita(()=>a.servico.registrar(coleta()),400);
  }
  const a=await ambiente(t);await rejeita(()=>a.servico.registrar({...coleta(),coletadoEm:new Date(Date.now()+60000).toISOString()}),400);
});
test('captura alterada falha antes de iniciar qualquer processo',async t=>{
  const a=await ambiente(t),r=await a.servico.registrar(coleta()),p=join(a.dataDir,'evidencias-negocio','capturas',r.capturaId+'.json');
  await writeFile(p,'{}');await rejeita(()=>a.servico.iniciar({dominio:D,capturaId:r.capturaId}),409);assert.equal(a.chamadas.length,0);assert.equal(a.servico.ocupado(),false);
});
test('IDs e domínio restringem consultas e comandos não entram pelo pedido',async t=>{
  const a=await ambiente(t),r=await a.servico.registrar(coleta());
  await rejeita(()=>a.servico.iniciar({dominio:D,capturaId:'../../segredo'}),400);
  await rejeita(()=>a.servico.iniciar({dominio:'rival.com.br',capturaId:r.capturaId}),404);
  await rejeita(()=>a.servico.iniciar({dominio:D,capturaId:r.capturaId,comando:'rm -rf'}),400);
  await rejeita(()=>a.servico.consultar({dominio:D,id:'../entrada.json'}),400);
  assert.equal(a.chamadas.length,0);assert.equal(a.servico.ocupado(),false);
});
test('iniciar retorna antes do filho terminar, fixa comando/env e envia apenas snapshot salvo',async t=>{
  const a=await ambiente(t),r=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:r.capturaId});
  assert.equal(j.estado,'em_execucao');assert.equal(a.servico.ocupado(),true);assert.equal(a.chamadas.length,1);
  const c=a.chamadas[0];
  await c.filho.recebeu;
  assert.equal(c.comando,join(raiz,'.venv-ia','bin','python'));
  assert.deepEqual(c.args,[join(raiz,'ia','negocio','jornadas','executar.py')]);
  assert.equal(c.opcoes.shell,false);assert.deepEqual(c.opcoes.stdio,['pipe','pipe','pipe']);
  assert.equal(c.opcoes.env.HF_HUB_OFFLINE,'1');assert.equal(c.opcoes.env.TRANSFORMERS_OFFLINE,'1');assert.equal(c.opcoes.env.HF_HUB_DISABLE_IMPLICIT_TOKEN,'1');
  assert.equal(c.filho.entrada.maxOfertas,1);assert.deepEqual(c.filho.entrada.base,r.base);assert.equal(c.filho.entrada.fontesReserva[0].id,'origem_01');
  assert.doesNotMatch(JSON.stringify(c.filho.entrada),/arquivoPrivado|mapaIds|html/);
  concluir(c.filho,c.filho.entrada);assert.equal((await terminado(a.servico,j)).estado,'concluido');
});
test('exclusão global impede leitores de jornadas e proposições de iniciarem modelos juntos',async t=>{
  const a=await ambiente(t),b=await ambiente(t,{motor:'proposicoes'}),ca=await a.servico.registrar(coleta()),cb=await b.servico.registrar(coleta());
  const j=await a.servico.iniciar({dominio:D,capturaId:ca.capturaId});assert.equal(b.servico.ocupado(),true);
  await rejeita(()=>b.servico.iniciar({dominio:D,capturaId:cb.capturaId}),409);assert.equal(b.chamadas.length,0);
  await a.chamadas[0].filho.recebeu;concluir(a.chamadas[0].filho,a.chamadas[0].filho.entrada);await terminado(a.servico,j);assert.equal(b.servico.ocupado(),false);
});

test('leitor de proposições fixa o script, confere código e preserva versão ao reabrir sem inferir novamente',async t=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/proposicoes-autoral-v3.json',import.meta.url),'utf8'));
  let a;
  const preparar=()=>({base:fixture.base,mapaIds:{s01:'origem01'},pool:{fontes:[]},recuperacao:{versao:1}});
  const comportamento=async f=>{try{
    const ids=await readdir(join(a.dataDir,'evidencias-negocio','execucoes'));
    const meta=JSON.parse(await readFile(caminho(a,ids[0],'iniciado.json'),'utf8'));
    const r=structuredClone(fixture.saida);r.codigo=meta.identidade.codigo;
    f.stdout.write(JSON.stringify(r));f.encerrar();
  }catch(e){f.stderr.write(String(e));f.encerrar(1);}};
  a=await ambiente(t,{preparar,comportamento,motor:'proposicoes'});
  const c=await a.servico.registrar({...coleta(),dominio:'example.com'}),j=await a.servico.iniciar({dominio:'example.com',capturaId:c.capturaId}),r=await terminado(a.servico,j);
  assert.equal(r.estado,'concluido');assert.equal(r.motor,'proposicoes');assert.equal(r.resultado.versao,3);assert.equal(r.resultado.inferenciasExecutadas,0);
  assert.equal(a.chamadas[0].args[0],join(raiz,'ia','negocio','proposicoes','executar.py'));
  assert.equal(a.chamadas[0].opcoes.env.HF_HUB_OFFLINE,'1');
  const reaberto=criarEntendimentoLocal({dataDir:a.dataDir,preparar,motor:'proposicoes',iniciar:()=>{throw Error('Não executar.');}});
  assert.deepEqual(await reaberto.consultar({dominio:'example.com',id:j.id}),r);await reaberto.fechar();
  const legado=criarEntendimentoLocal({dataDir:a.dataDir,preparar});await rejeita(()=>legado.consultar({dominio:'example.com',id:j.id}),404);await legado.fechar();
});

test('leitor de proposições conserva stdout quando código declarado não confere',async t=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/proposicoes-autoral-v3.json',import.meta.url),'utf8'));
  const a=await ambiente(t,{motor:'proposicoes',preparar:()=>({base:fixture.base,mapaIds:{},pool:{fontes:[]},recuperacao:{}}),comportamento:f=>{
    const r=structuredClone(fixture.saida);r.codigo={'ia/negocio/proposicoes/executar.py':'a'.repeat(64)};f.stdout.write(JSON.stringify(r));f.encerrar();
  }});
  const c=await a.servico.registrar({...coleta(),dominio:'example.com'}),j=await a.servico.iniciar({dominio:'example.com',capturaId:c.capturaId}),r=await terminado(a.servico,j);
  assert.equal(r.estado,'falhou');assert.equal(r.resultado,undefined);assert.equal(r.erro.codigo,'resposta_invalida');
  assert.ok((await readFile(caminho(a,j.id,'stdout.bin'))).length);assert.equal(a.servico.ocupado(),false);
});
test('callback de ocupação do legado bloqueia sem manter a trava',async t=>{
  const a=await ambiente(t,{podeIniciar:()=>false}),c=await a.servico.registrar(coleta());
  await rejeita(()=>a.servico.iniciar({dominio:D,capturaId:c.capturaId}),409);assert.equal(a.servico.ocupado(),false);assert.equal(a.chamadas.length,0);
});
test('conclusão valida fontes e identidade, salva bruto e sobrevive à reabertura',async t=>{
  const a=await ambiente(t,{comportamento:concluir}),c=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:c.capturaId}),r=await terminado(a.servico,j);
  assert.equal(r.estado,'concluido');assert.equal(r.resultado.perfilConfirmado,false);assert.equal(r.resultado.entradaSha256,digest(c.base));
  assert.doesNotMatch(JSON.stringify(r),/textoBruto|Users|pidServidor|codigoProcesso|jornadas\/executar/);
  const meta=JSON.parse(await readFile(caminho(a,j.id,'final.json')));assert.equal(meta.stdoutSha256,SHA(await readFile(caminho(a,j.id,'stdout.bin'))));
  assert.equal(meta.resultadoSha256,SHA(await readFile(caminho(a,j.id,'resultado.json'))));
  const reaberto=criarEntendimentoLocal({dataDir:a.dataDir,preparar:preparada,iniciar:()=>{throw new Error('Não deve executar.');}});
  assert.deepEqual(await reaberto.consultar({dominio:D,id:j.id}),r);await reaberto.fechar();
  await rejeita(()=>a.servico.consultar({dominio:'rival.com.br',id:j.id}),404);
});
test('jornada pode selecionar fonte da reserva, com IDs renumerados e conteúdo idêntico',async t=>{
  const extra={id:'extra_02',texto:'Contratantes informam a data do evento.',tipo:'conteudo'};
  const a=await ambiente(t,{preparar:c=>{const p=preparada(c);p.pool.fontes.push(extra);return p;},comportamento:(f,e)=>{
    const r=resposta(e),s={...extra,id:'s02'},j=r.ofertas[0].jornada;j.fontesSelecionadas=[s];j.entradaSha256=digest({versao:1,dominio:D,fontes:[s]});
    j.compradores=[{grupo:'Contratantes',evidencias:['s02'],citacoes:[s],revisaoSemantica:'pendente'}];f.stdout.write(JSON.stringify(r));f.encerrar();
  }});
  const c=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:c.capturaId}),r=await terminado(a.servico,j);
  assert.equal(r.estado,'concluido');assert.equal(r.resultado.ofertas[0].jornada.compradores[0].citacoes[0].texto,extra.texto);
});
test('saída sem fontes é válida sem fabricar identidade do modelo ou inferência',async t=>{
  const a=await ambiente(t,{preparar:c=>({...preparada(c),base:{versao:1,dominio:D,fontes:[]},pool:{fontes:[]}}),comportamento:concluir});
  const c=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:c.capturaId}),r=await terminado(a.servico,j);
  assert.equal(r.estado,'concluido');assert.equal(r.resultado.estado,'sem_fontes');assert.deepEqual(r.resultado.ofertas,[]);
  assert.equal(r.resultado.modeloBase,null);assert.equal(r.resultado.inferenciasExecutadas,0);
});
test('respostas de outro domínio, versão, hash ou com aprovação fabricada são recusadas',async t=>{
  for(const alterar of [r=>r.dominio='rival.com.br',r=>r.versao=1,r=>r.entradaSha256='b'.repeat(64),r=>r.perfilConfirmado=true,r=>r.revisorConfirmacao=true]){
    const a=await ambiente(t,{comportamento:(f,e)=>{const r=resposta(e);alterar(r);f.stdout.write(JSON.stringify(r));f.encerrar();}});
    const c=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:c.capturaId}),r=await terminado(a.servico,j);
    assert.equal(r.estado,'falhou');assert.equal(r.erro.codigo,'resposta_invalida');assert.equal(r.resultado,undefined);assert.ok((await readFile(caminho(a,j.id,'stdout.bin'))).length>0);
  }
});
test('citação alterada e fonte de jornada fora do pool são recusadas',async t=>{
  for(const alterar of [r=>r.ofertas[0].citacoes[0]={...r.ofertas[0].citacoes[0],texto:'Conteúdo inventado'},r=>{
    const j=r.ofertas[0].jornada;j.fontesSelecionadas=[{id:'s01',texto:'Condição que não existe na captura.',tipo:'conteudo'}];
    j.entradaSha256=digest({versao:1,dominio:D,fontes:j.fontesSelecionadas});}]){
    const a=await ambiente(t,{comportamento:(f,e)=>{const r=resposta(e);alterar(r);f.stdout.write(JSON.stringify(r));f.encerrar();}});
    const c=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:c.capturaId});assert.equal((await terminado(a.servico,j)).estado,'falhou');
  }
});
test('JSON inválido e stderr privado ficam no disco sem aparecer no erro público',async t=>{
  const segredo='/Users/nomeprivado/chave-token.txt',a=await ambiente(t,{comportamento:f=>{f.stdout.write('{invalido');f.stderr.write(segredo);f.encerrar(1);}});
  const c=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:c.capturaId}),r=await terminado(a.servico,j);
  assert.equal(r.estado,'falhou');assert.doesNotMatch(JSON.stringify(r),/nomeprivado|token|invalido/);assert.equal(await readFile(caminho(a,j.id,'stderr.bin'),'utf8'),segredo);
});
test('tempo excedido encerra apenas o filho criado e preserva saída parcial',async t=>{
  const a=await ambiente(t,{limiteMs:10,comportamento:f=>f.stdout.write('{"parcial":')});
  const c=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:c.capturaId}),r=await terminado(a.servico,j);
  assert.equal(r.estado,'interrompido');assert.equal(r.erro.codigo,'tempo_excedido');assert.deepEqual(a.chamadas[0].filho.sinais,['SIGKILL']);
  assert.equal(await readFile(caminho(a,j.id,'stdout.bin'),'utf8'),'{"parcial":');assert.equal(a.servico.ocupado(),false);
});
test('stdout excessivo interrompe, enquanto stderr excessivo é limitado sem vazar',async t=>{
  const a=await ambiente(t,{comportamento:f=>f.stdout.write(Buffer.alloc(1024*1024+1,120))});
  const c=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:c.capturaId}),r=await terminado(a.servico,j);
  assert.equal(r.estado,'falhou');assert.equal(r.erro.codigo,'saida_excedida');assert.equal((await readFile(caminho(a,j.id,'stdout.bin'))).length,1024*1024);
  assert.equal(JSON.parse(await readFile(caminho(a,j.id,'final.json'))).stdoutTruncado,true);
  const b=await ambiente(t,{comportamento:(f,e)=>{f.stderr.write(Buffer.alloc(256*1024+1,120));concluir(f,e);}});
  const cb=await b.servico.registrar(coleta()),jb=await b.servico.iniciar({dominio:D,capturaId:cb.capturaId});assert.equal((await terminado(b.servico,jb)).estado,'concluido');
  assert.equal((await readFile(caminho(b,jb.id,'stderr.bin'))).length,256*1024);assert.equal(JSON.parse(await readFile(caminho(b,jb.id,'final.json'))).stderrTruncado,true);
});
test('resultado salvo alterado não é devolvido após reinício',async t=>{
  const a=await ambiente(t,{comportamento:concluir}),c=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:c.capturaId});await terminado(a.servico,j);
  await writeFile(caminho(a,j.id,'resultado.json'),'{}');await rejeita(()=>a.servico.consultar({dominio:D,id:j.id}),409);
});
test('entrada ou stdout preservados alterados também invalidam a leitura de resultado',async t=>{
  for(const arquivo of ['entrada.json','stdout.bin']){
    const a=await ambiente(t,{comportamento:concluir}),c=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:c.capturaId});await terminado(a.servico,j);
    await writeFile(caminho(a,j.id,arquivo),'{}');await rejeita(()=>a.servico.consultar({dominio:D,id:j.id}),409);
  }
});
test('registro iniciado sem processo proprietário vira interrompido, inclusive consultas simultâneas',async t=>{
  const a=await ambiente(t),c=await a.servico.registrar(coleta()),id=randomUUID(),p=caminho(a,id,'iniciado.json');await mkdir(join(p,'..'),{recursive:true});
  const meta={versao:1,id,dominio:D,capturaId:c.capturaId,estado:'em_execucao',criadoEm:instante(),entradaSha256:digest(c.base)};await writeFile(p,JSON.stringify(meta));
  const resultados=await Promise.all([a.servico.consultar({dominio:D,id}),a.servico.consultar({dominio:D,id})]);
  assert.equal(resultados[0].estado,'interrompido');assert.deepEqual(resultados[0],resultados[1]);assert.equal(a.chamadas.length,0);
  assert.equal(JSON.parse(await readFile(caminho(a,id,'final.json'))).estado,'interrompido');
});
test('fechar outro wrapper não encerra processo alheio; dono fecha apenas seu filho',async t=>{
  const a=await ambiente(t),b=await ambiente(t),c=await a.servico.registrar(coleta()),j=await a.servico.iniciar({dominio:D,capturaId:c.capturaId});
  await b.servico.fechar();assert.deepEqual(a.chamadas[0].filho.sinais,[]);assert.equal(a.servico.ocupado(),true);
  await a.servico.fechar();assert.deepEqual(a.chamadas[0].filho.sinais,['SIGKILL']);assert.equal((await a.servico.consultar({dominio:D,id:j.id})).estado,'interrompido');
  await rejeita(()=>a.servico.registrar(coleta()),503);assert.equal(await a.servico.disponivel(),false);
});
test('falha síncrona de spawn preserva início e libera exclusão global',async t=>{
  const a=await ambiente(t),s=criarEntendimentoLocal({dataDir:a.dataDir,preparar:preparada,iniciar:()=>{throw new Error('/Users/privado/erro');}}),c=await s.registrar(coleta());
  const j=await s.iniciar({dominio:D,capturaId:c.capturaId});assert.equal(j.estado,'falhou');assert.equal(s.ocupado(),false);assert.doesNotMatch(JSON.stringify(j),/privado/);await s.fechar();
});
test('preparador de jornadas real produz snapshot aceito sem inferência',async t=>{
  const a=await ambiente(t,{preparar:prepararJornadas}),c=coleta();
  c.paginas[0]={...c.paginas[0],status:200,coletadoEm:c.coletadoEm,sha256:SHA(c.paginas[0].html)};
  const r=await a.servico.registrar(c);assert.equal(r.base.versao,1);assert.ok(r.base.fontes.length<=16);assert.equal(a.chamadas.length,0);
});
test('disponibilidade só verifica arquivos e bibliotecas presentes, sem criar processo',async t=>{
  const a=await ambiente(t),d=await a.servico.disponivel();assert.equal(typeof d,'boolean');assert.equal(a.chamadas.length,0);
});
test('reserva acima de um MiB é recusada inteira sem truncar frases ou iniciar Python',async t=>{
  const a=await ambiente(t,{preparar:c=>{const p=preparada(c);p.pool.fontes=Array.from({length:640},(_,i)=>({id:'f_'+i,texto:'x'.repeat(600),tipo:'conteudo',
    contexto:{paginaId:'pag_'+'a'.repeat(20),url:'https://'+D+'/oferta-'+i,tituloPagina:'x'.repeat(240),titulos:Array.from({length:6},(_,j)=>({nivel:j+1,texto:'x'.repeat(240)})),
      campo:'p',coletadoEm:c.coletadoEm,sha256:'a'.repeat(64),recortado:false,classePagina:'institucional'}}));return p;}});
  const c=await a.servico.registrar(coleta());await rejeita(()=>a.servico.iniciar({dominio:D,capturaId:c.capturaId}),413);
  assert.equal(a.chamadas.length,0);assert.equal(a.servico.ocupado(),false);
  const salvo=JSON.parse(await readFile(join(a.dataDir,'evidencias-negocio','capturas',c.capturaId+'.json')));assert.equal(salvo.preparacao.pool.fontes.length,640);
  assert.equal(salvo.preparacao.pool.fontes[0].texto.length,600);
});
test('erro assíncrono de spawn sem PID é persistido sem esperar timeout',async t=>{
  const a=await ambiente(t),s=criarEntendimentoLocal({dataDir:a.dataDir,preparar:preparada,iniciar:(...args)=>{
    const f=a.iniciar(...args);delete f.pid;queueMicrotask(()=>f.emit('error',new Error('/Users/privado/ENOENT')));return f;}});
  const c=await s.registrar(coleta()),j=await s.iniciar({dominio:D,capturaId:c.capturaId}),r=await terminado(s,j);
  assert.equal(r.estado,'falhou');assert.equal(r.erro.codigo,'processo_indisponivel');assert.doesNotMatch(JSON.stringify(r),/privado|ENOENT/);assert.equal(s.ocupado(),false);await s.fechar();
});
