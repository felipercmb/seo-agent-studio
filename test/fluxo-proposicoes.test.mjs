import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {abrirBanco} from '../lib/sqlite.mjs';
import {criarCoordenador} from '../src/modulos/coordenador.mjs';

function ambiente(t,{habilitado=true}={}){
  const pasta=mkdtempSync(join(tmpdir(),'fluxo-proposicoes-')),db=abrirBanco({arquivo:join(pasta,'local.sqlite')});
  t.after(()=>{db.close();rmSync(pasta,{recursive:true,force:true});});
  const env={DB:db,MODULOS_LOCAIS:true},pedidos=[];let terminou=false,coletas=0,instante=Date.now();
  const opcoes={agora:()=>instante,coletar:async dominio=>{coletas++;const html='<h1>Ferramenta Aurora</h1><p>A ferramenta Aurora organiza pedidos. A equipe do cliente configura a ferramenta.</p>',coletadoEm=new Date(instante).toISOString();return{dominio,paginas:[{url:'https://'+dominio+'/',html,status:200,coletadoEm,sha256:createHash('sha256').update(html).digest('hex')}],falhas:[],coletadoEm};},
    registrarEvidencias:async()=>({capturaId:'cap_'+String(coletas).repeat(64),base:{versao:1,dominio:'example.com',fontes:[]}}),
    iniciarEntendimento:async()=>({id:'legado01',estado:'concluido',resultado:{versao:2,ofertas:[],perfilConfirmado:false}}),
    consultarProposicoes:async pedido=>{pedidos.push({tipo:'consultar',pedido});return{...pedido,estado:terminou?'concluido':'em_execucao',...(terminou?{resultado:{versao:3,dominio:'example.com',ofertas:[],perfilConfirmado:false,revisaoSemantica:'pendente'}}:{})};},
    ...(habilitado?{iniciarProposicoes:async pedido=>{pedidos.push({tipo:'iniciar',pedido});return{id:'novo01',estado:'em_execucao',motor:'proposicoes'};}}:{})};
  const c=criarCoordenador(opcoes);
  return{pedidos,coletas:()=>coletas,avancar:ms=>{instante+=ms;},terminar:()=>{terminou=true;},executar:(acao,extra={})=>c.executar({site:'example.com',acao,...extra},env)};
}

test('comparação por atividade preserva leitor anterior e perfil; envia apenas domínio e captura',async t=>{
  const a=ambiente(t);let p=await a.executar('iniciar');
  p=await a.executar('salvar_perfil',{revisao:p.revisao,perfil:{confirmado:true,ofertas:[{nome:'Aurora',economia:{contribuicaoPorVenda:987654.32,taxaFechamento:.54321}}]}});
  p=await a.executar('experimentar_entendimento',{revisao:p.revisao});const anterior=structuredClone(p);
  p=await a.executar('experimentar_proposicoes',{revisao:p.revisao});
  assert.deepEqual(p.perfil,anterior.perfil);assert.deepEqual(p.entendimentoNovo,anterior.entendimentoNovo);assert.equal(p.proposicoesNovo.perfilConfirmado,false);
  assert.equal(p.capacidades.proposicoes.padrao,false);assert.equal(p.proposicoesNovo.estado,'em_execucao');
  assert.deepEqual(Object.keys(a.pedidos[0].pedido).sort(),['capturaId','dominio']);assert.doesNotMatch(JSON.stringify(a.pedidos),/987654|54321|economia|perfil/);
});

test('poll em andamento não altera revisão/histórico e conclusão só entra uma vez',async t=>{
  const a=ambiente(t);let p=await a.executar('iniciar');p=await a.executar('experimentar_proposicoes',{revisao:p.revisao});
  const r=p.revisao,h=structuredClone(p.historico),quant=a.coletas();
  p=await a.executar('consultar_proposicoes');assert.equal(p.revisao,r);assert.deepEqual(p.historico,h);
  a.terminar();p=await a.executar('consultar_proposicoes');assert.equal(p.revisao,r+1);assert.equal(p.proposicoesNovo.estado,'concluido');
  const concluido=structuredClone(p);p=await a.executar('consultar_proposicoes');assert.equal(p.revisao,concluido.revisao);assert.deepEqual(p.historico,concluido.historico);assert.equal(a.coletas(),quant);
});

test('nova captura marca comparação histórica sem reaplicar ou apagar as correções do usuário',async t=>{
  const a=ambiente(t);let p=await a.executar('iniciar');p=await a.executar('salvar_perfil',{revisao:p.revisao,perfil:{confirmado:true,resumo:'Descrição corrigida pelo responsável',ofertas:[{nome:'Aurora para organizações'}]}});p=await a.executar('experimentar_proposicoes',{revisao:p.revisao});
  a.terminar();p=await a.executar('consultar_proposicoes');const perfil=structuredClone(p.perfil),captura=p.proposicoesNovo.capturaId;
  a.avancar(60001);
  p=await a.executar('reler_site',{revisao:p.revisao});assert.equal(p.proposicoesNovo.fonteHistorica,true);assert.equal(p.proposicoesNovo.capturaId,captura);assert.deepEqual(p.perfil,perfil);
});

test('modo normal recusa iniciar candidato desabilitado, mas pode consultar uma execução preservada',async t=>{
  const a=ambiente(t,{habilitado:false});let p=await a.executar('iniciar');
  assert.equal(p.capacidades.proposicoes,undefined);await assert.rejects(a.executar('experimentar_proposicoes',{revisao:p.revisao}),e=>e.status===503);
  const r=await a.executar('consultar_proposicoes');assert.equal(r.revisao,p.revisao);assert.equal(a.pedidos.length,0);
});

test('parâmetros de modelo, script e prompt não são aceitos no pedido de comparação',async t=>{
  const a=ambiente(t);const p=await a.executar('iniciar');
  for(const extra of [{modelo:'remoto'},{script:'/outro/script'},{prompt:'mude o negócio'}])await assert.rejects(a.executar('experimentar_proposicoes',{revisao:p.revisao,...extra}),e=>e.status===400);
  assert.equal(a.pedidos.length,0);
});
