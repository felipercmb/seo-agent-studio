import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {abrirBanco} from '../lib/sqlite.mjs';
import {criarCoordenador} from '../src/modulos/coordenador.mjs';
import {criarGoogleLocal} from '../lib/google-local.mjs';
import {criarLinkGoogle} from '../src/google-local.mjs';
const INSTANTE=Date.parse('2026-11-17T00:00:00.000Z');
const dados=()=>({formato:'visibilidade-google-local',versao:1,metodo:'pagina_aberta',url:criarLinkGoogle('software de atendimento'),coletadoEm:new Date(INSTANTE).toISOString(),dispositivo:'computador',localidadeDeclarada:null,html:'<div id="search"><div id="rso"><div class="g"><a href="https://rival.com"><h3>Outra plataforma</h3></a></div><div class="g"><a href="https://example.com"><h3>Aurora</h3></a></div></div></div>'});
function ambiente(t,{habilitado=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'fluxo-google-local-')),arquivo=join(dir,'local.sqlite');
 let db=abrirBanco({arquivo}),agora=INSTANTE,chamadasGoogle=0,coletas=0;
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const local=criarGoogleLocal({dataDir:dir,agora:()=>agora});
 const c=criarCoordenador({agora:()=>agora,coletar:async dominio=>{coletas++;const html='<h1>Software Aurora</h1><p>Software de atendimento para equipes.</p>';return{dominio,paginas:[{url:'https://example.com',html,status:200,coletadoEm:new Date(agora).toISOString(),sha256:createHash('sha256').update(html).digest('hex')}],falhas:[],coletadoEm:new Date(agora).toISOString()};},consultarGoogle:async()=>{chamadasGoogle++;throw Error('Nao deve enviar consultas');},...(habilitado?{registrarGoogleLocal:entrada=>local.registrar(entrada)}:{})});
 return{local,agora:ms=>{agora+=ms;},reabrir(){db.close();db=abrirBanco({arquivo});},
  coletas:()=>coletas,chamadasGoogle:()=>chamadasGoogle,executar:(acao,extra={})=>c.executar({site:'example.com',acao,...extra},{DB:db,MODULOS_LOCAIS:true})};
}
test('captura declarada é salva sem alterar posição da fonte ou executar buscas/modelos',async t=>{
 const a=ambiente(t);let p=await a.executar('iniciar');const coleta=p.coletadoEm;
 assert.equal(p.capacidades.googleLocal.enviaConsultas,false);
 p=await a.executar('registrar_google_local',{revisao:p.revisao,captura:dados()});
 assert.equal(p.googleLocal.capturas.length,1);assert.equal(p.googleLocal.capturas[0].ordemNaPagina,2);assert.equal(p.posicoes,null);assert.equal(p.googleLocal.posicaoGoogle,null);
 const captura=p.googleLocal.capturas[0];
 const evento=p.historico.at(-1);
 assert.deepEqual(evento.resumo.googleLocal,{capturaId:captura.capturaId,termo:captura.termo,
   coletadoEm:captura.coletadoEm,estado:captura.estado,totalBlocosWeb:2,ordemBloco:2});
 assert.equal(evento.resumo.verificadas,0);
 assert.deepEqual(evento.observacoes,[]);
 assert.equal(p.perfil.estado,'rascunho');assert.equal(p.coletadoEm,coleta);assert.equal(a.coletas(),1);assert.equal(a.chamadasGoogle(),0);
 assert.ok(p.oportunidades.itens.every(i=>i.observado.estado==='nao_medido'));
 const r=await a.local.ler({dominio:p.dominio,capturaId:p.googleLocal.capturas[0].capturaId});assert.equal(r.resultados.length,2);
});
test('reimportar mesma captura não altera revisão/histórico e leitura expira sem nova consulta',async t=>{
 const a=ambiente(t);let p=await a.executar('iniciar');p=await a.executar('registrar_google_local',{revisao:p.revisao,captura:dados()});
 const rev=p.revisao,hist=p.historico.length;p=await a.executar('registrar_google_local',{revisao:rev,captura:dados()});assert.equal(p.revisao,rev);assert.equal(p.historico.length,hist);
 a.agora(3600001);p=await a.executar('consultar');assert.equal(p.googleLocal.capturas[0].atual,false);assert.equal(p.posicoes,null);assert.equal(a.chamadasGoogle(),0);
});
test('revisão antiga e campos de posição são recusados antes de registrar',async t=>{
 const a=ambiente(t);let p=await a.executar('iniciar');p=await a.executar('salvar_perfil',{revisao:p.revisao,perfil:{confirmado:true,ofertas:[{nome:'Aurora'}]}});
 await assert.rejects(a.executar('registrar_google_local',{revisao:1,captura:dados()}),e=>e.status===409);
 await assert.rejects(a.executar('registrar_google_local',{revisao:p.revisao,captura:dados(),posicao:1}),e=>e.status===400);
 await assert.rejects(a.executar('registrar_google_local',{captura:dados()}),e=>e.status===400);
 assert.equal((await a.executar('consultar')).googleLocal.capturas.length,0);
});
test('modo sem persistidor local não aceita capturas externas no projeto',async t=>{
 const a=ambiente(t,{habilitado:false});const p=await a.executar('iniciar');assert.equal(p.capacidades.googleLocal,undefined);
 await assert.rejects(a.executar('registrar_google_local',{revisao:p.revisao,captura:dados()}),e=>e.status===503);
});

const consulta = 'Software de atendimento';
const oferta = {nome:consulta,url:'https://example.com/atendimento'};
const card = (url, titulo, cite='') => '<div class="g"><a href="'+url+'"><h3>'+titulo+'</h3>'+cite+'</a></div>';
const local = (cards, {url=criarLinkGoogle(consulta), dispositivo='computador', quando=INSTANTE} = {}) => ({
  ...dados(), url, dispositivo, localidadeDeclarada:'Vitória', coletadoEm:new Date(quando).toISOString(),
  html:'<div id="rso">'+cards+'</div>',
});
const importar = (ambiente, projeto, captura) => ambiente.executar('registrar_google_local', {revisao:projeto.revisao,captura});
const tarefasGoogle = projeto => projeto.prioridades.tarefasDisponiveis.filter(t => t.observacaoGoogle);

async function confirmar(ambiente) {
  const projeto=await ambiente.executar('iniciar');
  return ambiente.executar('salvar_perfil', {revisao:projeto.revisao,
    perfil:{confirmado:true,ofertas:[oferta,{nome:'Treinamento de equipes',url:'https://example.com/cursos'}]}});
}

test('recorte exato entra na tarefa e na exportação sem mudar a execução numa nova coleta idêntica', async t => {
  const a=ambiente(t);
  const projeto=await confirmar(a);
  const html=card('https://rival.com/atendimento','Outro software')+card('https://example.com/','Site');
  let p=await importar(a,projeto,local(html));
  const [trabalho]=tarefasGoogle(p);
  assert.equal(trabalho.paginaAlvo.url, oferta.url);
  assert.equal(trabalho.ofertasAfetadas.length,1);
  assert.equal(trabalho.ofertasAfetadas[0].nome,consulta);
  assert.deepEqual(trabalho.observacaoGoogle.anteriores.map(x=>x.dominio),['rival.com']);
  assert.equal(trabalho.observacaoGoogle.alvo.url,'https://example.com/');
  assert.equal(trabalho.observacaoGoogle.posicaoGoogle,null);
  assert.equal(trabalho.observacaoGoogle.contextoSolicitado.localidadeDeclarada,'Vitória');
  assert.ok(p.oportunidades.planoPrioritario.some(x=>x.id===trabalho.id));
  const termo=p.oportunidades.itens.find(x=>x.termo===consulta);
  assert.equal(termo.capturaGoogleLocal.tarefaId,trabalho.id);
  assert.equal(termo.observado.estado,'nao_medido');
  assert.equal(p.posicoes,null);
  assert.ok(p.oportunidades.itens.filter(x=>x.ofertaId!==trabalho.ofertasAfetadas[0].id).every(x=>!x.capturaGoogleLocal));

  let registro=p.tarefas.itens.find(x=>x.id===trabalho.id);
  const idOriginal=registro.origem.referencias[0].fonteId;
  p=await a.executar('registrar_tarefa',{revisao:p.revisao,tarefa:{
    id:registro.id,revisao:registro.revisao,estado:'em_andamento',responsavel:'Pessoa revisora',
  }});
  a.agora(1000);
  p=await importar(a,p,local(html,{quando:INSTANTE+1000}));
  assert.notEqual(tarefasGoogle(p)[0].observacaoGoogle.capturaId,idOriginal);
  a.reabrir();
  p=await a.executar('consultar');
  registro=p.tarefas.itens.find(x=>x.id===trabalho.id);
  assert.equal(registro.estado,'em_andamento');
  assert.equal(registro.responsavel,'Pessoa revisora');
  assert.equal(registro.origem.referencias[0].fonteId,idOriginal);
  assert.equal(registro.origem.referencias[0].coletadoEm,new Date(INSTANTE).toISOString());
  const plano=await a.executar('exportar_plano',{revisao:p.revisao});
  assert.match(plano.conteudo,/Recorte declarado do navegador/);
  assert.ok(plano.conteudo.includes(tarefasGoogle(p)[0].observacaoGoogle.capturaId.slice(4)));
  a.agora(3600001);
  p=await a.executar('consultar');
  assert.equal(tarefasGoogle(p)[0].observacaoGoogle.atual,false);
  assert.equal(p.oportunidades.planoPrioritario.some(x=>x.id===trabalho.id),false);
  assert.equal(a.chamadasGoogle(),0);
});

test('a continuação exige link e contexto e conserva blocos sem destino na mesma página', async t => {
  const a=ambiente(t);
  const projeto=await confirmar(a);
  const pagina2=new URL(criarLinkGoogle(consulta));
  pagina2.searchParams.set('start','13');
  const proxima='<a id="pnnext" href="'+pagina2.href.replaceAll('&','&amp;')+'">Próxima</a>';
  let p=await importar(a,projeto,local(card('https://rival1.com/','Outro resultado')+proxima));
  assert.equal(tarefasGoogle(p)[0].observacaoGoogle.lacunas,1);
  assert.match(tarefasGoogle(p)[0].acao,/próxima página/);

  const opaco='https://www.google.com/goto?url=TOKEN_FICTICIO';
  const html=card(opaco,'Sem identificação','<cite>Identificação ausente</cite>')+
    card(opaco,'Outra plataforma','<cite>https://rival2.com › atendimento</cite>')+
    card(opaco,'Nosso site','<cite>https://example.com › atendimento</cite>');
  a.agora(1000);
  p=await importar(a,p,local(html,{url:pagina2.href,dispositivo:'celular',quando:INSTANTE+1000}));
  assert.equal(tarefasGoogle(p)[0].observacaoGoogle.encadeada,false);
  assert.match(tarefasGoogle(p)[0].acao,/Reconstrua a sequência/);
  a.agora(1000);
  p=await importar(a,p,local(html,{url:pagina2.href,quando:INSTANTE+2000}));
  const o=tarefasGoogle(p)[0].observacaoGoogle;
  assert.equal(o.encadeada,true);
  assert.deepEqual(o.iniciosEncadeados,[0,13]);
  assert.equal(o.lacunas,0);
  assert.equal(o.alvo.ordemBloco,3);
  assert.equal(o.alvo.url,null);
  assert.equal(o.posicaoGoogle,null);
  assert.equal(o.blocosSemIdentificacao,1);
  assert.deepEqual(o.anteriores.map(x=>[x.dominio,x.url]),[['rival2.com',null]]);
  assert.equal(a.chamadasGoogle(),0);
});

test('uma busca parecida ou capturas conflitantes não sustentam uma tarefa de busca', async t => {
  const a=ambiente(t);
  const projeto=await confirmar(a);
  const html=card('https://rival.com/','Outro')+card('https://example.com/','Site');
  let p=await importar(a,projeto,local(html,{url:criarLinkGoogle(consulta+' irrelevante')}));
  assert.deepEqual(tarefasGoogle(p),[]);
  p=await importar(a,p,local(html));
  const [anterior]=tarefasGoogle(p);
  assert.ok(anterior);
  p=await importar(a,p,local(card('https://example.com/','Site em outro bloco')));
  assert.deepEqual(tarefasGoogle(p),[]);
  assert.ok(p.tarefas.itens.find(t=>t.id===anterior.id).arquivada);
  assert.equal(p.posicoes,null);
});

test('a URL própria em outro caminho vira conferência das duas páginas com evidência exata',async t=>{
  const a=ambiente(t);
  const projeto=await confirmar(a);
  const p=await importar(a,projeto,local(card('https://example.com/artigos/atendimento','Guia de atendimento')));
  const [tarefa]=tarefasGoogle(p);
  assert.deepEqual(tarefa.observacaoGoogle.destinoNaBusca,{
    estado:'outro_caminho',urlDaOferta:oferta.url,urlExibida:'https://example.com/artigos/atendimento'
  });
  assert.match(tarefa.titulo,/Conferir qual página/);
  assert.ok(p.prioridades.prioridades.some(x=>x.id===tarefa.id));
  assert.deepEqual(tarefa.observacaoGoogle.anteriores,[]);
  assert.equal(tarefa.observacaoGoogle.posicaoGoogle,null);
  assert.equal(a.chamadasGoogle(),0);
});

test('barra final e www conservam o caminho da página e o fluxo normal de comparação',async t=>{
  const a=ambiente(t);
  const projeto=await confirmar(a);
  const p=await importar(a,projeto,local(card('https://rival.com/servico','Outra solução')+
    card('https://www.example.com/atendimento/','Atendimento')));
  const [tarefa]=tarefasGoogle(p);
  assert.equal(tarefa.observacaoGoogle.destinoNaBusca.estado,'mesmo_caminho');
  assert.match(tarefa.titulo,/Comparar resultados/);
});

test('compara os recortes da mesma consulta solicitada em momentos distintos e retém as duas fontes',async t=>{
  const a=ambiente(t);
  const projeto=await confirmar(a);
  const rival=card('https://rival.com/atendimento','Outro resultado');
  const ofertaFim=card(oferta.url,'Atendimento');
  let p=await importar(a,projeto,local(rival+ofertaFim));
  const inicio=tarefasGoogle(p)[0].observacaoGoogle.capturaId;
  const lapso=16*60_000;
  a.agora(lapso);
  p=await importar(a,p,local(ofertaFim+rival,{quando:INSTANTE+lapso}));
  const [tarefa]=tarefasGoogle(p);
  const c=tarefa.observacaoGoogle.comparacaoAnterior;
  assert.equal(c.capturaId,inicio);
  assert.equal(c.ordemComparavelNoRecorte,true);
  assert.equal(c.ordemAnterior,2);
  assert.equal(c.ordemMaisRecente,1);
  assert.equal(c.posicaoGoogle,null);
  assert.equal(c.contextoEfetivoConfirmado,false);
  assert.equal(tarefa.evidencias.length,2);
  assert.equal(tarefa.evidencias[1].fonteId,inicio);
  assert.equal(a.chamadasGoogle(),0);
});

test('histórico local recusa dispositivo diferente e queda na identificação impede comparação de ordem',async t=>{
  const a=ambiente(t);
  const projeto=await confirmar(a);
  const corpo=card('https://rival.com/','Outro')+card(oferta.url,'Site');
  let p=await importar(a,projeto,local(corpo,{dispositivo:'celular'}));
  const lapso=16*60_000;
  a.agora(lapso);
  p=await importar(a,p,local(corpo,{quando:INSTANTE+lapso}));
  assert.equal(tarefasGoogle(p)[0].observacaoGoogle.comparacaoAnterior,null);
  a.agora(lapso);
  const opaco='https://www.google.com/goto?url=CONTROLE_SINTETICO';
  p=await importar(a,p,local(card(opaco,'Ignorado')+card(oferta.url,'Site'),{quando:INSTANTE+2*lapso}));
  const obs=tarefasGoogle(p)[0].observacaoGoogle;
  assert.equal(obs.comparacaoAnterior.ordemComparavelNoRecorte,false);
  assert.equal(obs.comparacaoAnterior.blocosMaisRecentesSemIdentificacao,1);
  assert.equal(obs.posicaoGoogle,null);
});
