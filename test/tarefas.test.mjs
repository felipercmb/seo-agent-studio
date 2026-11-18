import test from 'node:test';
import assert from 'node:assert/strict';
import {sincronizarTarefas, atualizarTarefa, compararObservacoes, LIMITES_TAREFAS} from '../src/modulos/tarefas.mjs';
import {inferirPerfil, corrigirPerfil} from '../src/modulos/perfil.mjs';
import {gerarPalavras} from '../src/modulos/palavras.mjs';
import {avaliarOportunidades} from '../src/modulos/oportunidades.mjs';
import {descobrirTermos} from '../src/descoberta.mjs';
import {extrairContextoPublico} from '../src/modulos/contexto-publico.mjs';
import {createHash} from 'node:crypto';

const DOMINIO='cliente.com.br', URL='https://cliente.com.br/contratacao';
const T=Date.parse('2026-11-16T12:00:00.000Z');
const opts={dominio:DOMINIO,agora:()=>T};
const iso=n=>new Date(n).toISOString();
function plano(extra={}) {return {id:'acao_contratacao',tipo:'conferir_oferta',titulo:'Conferir contratação',
  acao:'Conferir se o contratante consegue identificar quais informações precisa enviar.',
  criterioSucesso:'O responsável registra as informações solicitadas no contato e as dúvidas encontradas.',
  passos:['Abra a página de contratação.','Registre as informações exigidas.'],base:'hipotese',eixo:'negocio',
  paginaAlvo:{url:URL},evidencias:[{url:URL,trecho:'Solicite o orçamento de contratação.',campo:'p',sha256:'a'.repeat(64),coletadoEm:iso(T-10000)}],...extra};}
const criar=()=>sincronizarTarefas(null,[plano()],opts);
function verificacao(extra={}) {return {metodo:'Conferência do formulário público, sem enviar dados.',
  evidencia:'A página pede data, cidade e nome do evento.',verificadoEm:iso(T-1000),url:URL,resultado:'confirmado',
  medida:{indicador:'campos_publicados',tipo:'numero',valor:3,unidade:'campos'},...extra};}
function concluir(estado=criar(),extra={}) {return atualizarTarefa(estado,{id:estado.itens[0].id,revisao:estado.itens[0].revisao,
  estado:'concluida',implementadoEm:iso(T-2000),verificacao:verificacao(),...extra},opts);}
const editar=(estado,patch)=>atualizarTarefa(estado,{id:estado.itens[0].id,revisao:estado.itens[0].revisao,...patch},opts);
const rejeita=(fn,status=400)=>assert.throws(fn,e=>e.status===status);
function observacao(extra={}) {return {natureza:'observado',coletadoEm:iso(T-5000),
  medida:{indicador:'posicao_google',tipo:'numero',valor:11,unidade:'posicao_organica'},
  contexto:{url:URL,metodo:'captura_serp',termo:'contratação de artista',pais:'Brasil',idioma:'Português',dispositivo:'Computador',localidade:'Brasil'},
  fonte:{id:'captura_001',sha256:'a'.repeat(64)},...extra};}

test('cria origem, revisão e histórico sem alterar o plano recebido',()=>{
  const p=plano(),antes=structuredClone(p),s=sincronizarTarefas(null,[p],opts);
  assert.deepEqual(p,antes);assert.equal(s.versao,1);assert.equal(s.revisao,1);assert.equal(s.itens[0].estado,'pendente');
  assert.equal(s.itens[0].origem.base,'hipotese');assert.equal(s.itens[0].origem.versao,1);
  assert.equal(s.historico.length,1);assert.equal(s.historico[0].tipo,'criada');
  assert.match(s.itens[0].origem.hash,/^[a-f0-9]{64}$/);assert.equal(s.historico[0].hashAnterior,null);
});
test('repetir a sincronização ou inverter a ordem não gera eventos nem muda o estado',()=>{
  const p=[plano(),plano({id:'acao_segunda',titulo:'Segunda conferência'})],s=sincronizarTarefas(null,p,opts);
  assert.deepEqual(sincronizarTarefas(s,p,opts),s);assert.deepEqual(sincronizarTarefas(s,p.toReversed(),opts),s);
});
test('coleção vazia é válida sem criar evento fictício',()=>{
  const s=sincronizarTarefas(null,[],opts);assert.equal(s.revisao,0);assert.deepEqual(s.itens,[]);assert.deepEqual(sincronizarTarefas(s,[],opts),s);
});
test('revisão de tarefa detecta edição concorrente e não modifica o estado anterior',()=>{
  const s=criar(),antes=structuredClone(s),novo=editar(s,{estado:'em_andamento',responsavel:'Ana'});
  assert.deepEqual(s,antes);assert.equal(novo.itens[0].revisao,2);
  rejeita(()=>atualizarTarefa(novo,{id:plano().id,revisao:1,nota:'Outra edição'},opts),409);
  assert.deepEqual(s.historico,novo.historico.slice(0,1));
});
test('repetir uma atualização com a revisão atual é idempotente',()=>{
  const s=editar(criar(),{responsavel:'Ana',nota:'Conferir com a equipe'});
  assert.deepEqual(editar(s,{responsavel:'Ana',nota:'Conferir com a equipe'}),s);
});
test('conclusão preserva medida e resultado como declaração, sem inferir sucesso',()=>{
  const s=concluir(criar(),{verificacao:verificacao({resultado:'nao_confirmado',medida:{indicador:'contato_localizado',tipo:'booleano',valor:false,unidade:'booleano'}})});
  assert.equal(s.itens[0].estado,'concluida');assert.equal(s.itens[0].verificacao.natureza,'declarado');
  assert.equal(s.itens[0].verificacao.resultado,'nao_confirmado');assert.equal(s.itens[0].verificacao.medida.valor,false);
  assert.equal(s.itens[0].verificacao.criterio,plano().criterioSucesso);assert.equal(s.historico.at(-1).natureza,'declarado');
  assert.deepEqual(sincronizarTarefas(s,[plano()],opts),s);
});
test('zero explícito de medida não é descartado como dado ausente',()=>{
  const s=concluir(criar(),{verificacao:verificacao({medida:{indicador:'duvidas',tipo:'numero',valor:0,unidade:'ocorrencias'}})});
  assert.equal(s.itens[0].verificacao.medida.valor,0);
});
test('conclusão aceita medida textual específica e resultado inconclusivo',()=>{
  const s=concluir(criar(),{verificacao:verificacao({resultado:'inconclusivo',medida:{indicador:'revisao_contratacao',tipo:'texto',valor:'O canal existe, mas não esclarece prazo de resposta.',unidade:'registro'}})});
  assert.equal(s.itens[0].verificacao.resultado,'inconclusivo');
});
test('não conclui sem implementação, verificação, medida, método ou evidência',()=>{
  rejeita(()=>editar(criar(),{estado:'concluida'}));
  rejeita(()=>editar(criar(),{estado:'concluida',implementadoEm:iso(T-2000)}));
  for(const patch of [{metodo:''},{evidencia:''},{medida:null},{medida:{indicador:'campos',tipo:'numero',valor:null,unidade:'campos'}}])
    rejeita(()=>concluir(criar(),{verificacao:verificacao(patch)}));
});
test('não aceita verificação futura ou anterior à implementação',()=>{
  rejeita(()=>concluir(criar(),{verificacao:verificacao({verificadoEm:iso(T+1)})}));
  rejeita(()=>concluir(criar(),{verificacao:verificacao({verificadoEm:iso(T-3000)})}));
  rejeita(()=>concluir(criar(),{implementadoEm:iso(T+1)}));
});
test('natureza observada, fonte fabricada e campos arbitrários são recusados na edição',()=>{
  rejeita(()=>editar(criar(),{origem:{acao:'Outra'}}));
  rejeita(()=>concluir(criar(),{verificacao:verificacao({natureza:'observado'})}));
  rejeita(()=>concluir(criar(),{verificacao:verificacao({fonte:{id:'fabricada'}})}));
  rejeita(()=>editar(criar(),{revisaoColecao:1}));
});
test('verificação precisa da mesma URL e não aceita credenciais, query ou domínio externo',()=>{
  for(const url of ['https://rival.com.br/a','https://cliente.com.br/outra','https://user:pass@cliente.com.br/contratacao',URL+'?token=abc',URL+'#formulario',URL+'?',URL+'#','file:///tmp/a'])
    rejeita(()=>concluir(criar(),{verificacao:verificacao({url})}));
});
test('registro sem página aceita medida declarada sem inventar URL',()=>{
  const s=sincronizarTarefas(null,[plano({paginaAlvo:null,evidencias:[]})],opts);
  assert.equal(concluir(s,{verificacao:verificacao({url:null})}).itens[0].verificacao.url,null);
});
test('reabrir preserva conclusão anterior no histórico e inicia nova execução sem herdar resultado',()=>{
  const concluida=concluir(),reaberta=editar(concluida,{estado:'pendente'});
  assert.equal(reaberta.itens[0].verificacao,null);assert.equal(reaberta.itens[0].implementadoEm,null);
  assert.equal(reaberta.historico[1].alteracoes.verificacao.medida.valor,3);
  assert.deepEqual(reaberta.historico.slice(0,-1),concluida.historico);
  rejeita(()=>editar(concluida,{estado:'em_andamento'}),409);
  rejeita(()=>editar(concluida,{estado:'pendente',implementadoEm:iso(T-1)}));
});
test('descarte exige justificativa; concluída ou descartada precisa reabrir antes de outro estado',()=>{
  rejeita(()=>editar(criar(),{estado:'descartada'}));
  const s=editar(criar(),{estado:'descartada',nota:'A oferta não faz mais parte do negócio.'});
  assert.equal(s.itens[0].estado,'descartada');rejeita(()=>concluir(s),409);
  assert.equal(editar(s,{estado:'pendente'}).itens[0].estado,'pendente');
});
test('mudança material da origem reabre a tarefa e preserva origem/resultado anteriores',()=>{
  const c=concluir(editar(criar(),{responsavel:'Ana',nota:'Conferido pela equipe'})),novoPlano=plano({criterioSucesso:'Conferir também a cidade de atendimento.'});
  const s=sincronizarTarefas(c,[novoPlano],opts),t=s.itens[0];
  assert.equal(t.estado,'pendente');assert.equal(t.origem.versao,2);assert.equal(t.verificacao,null);assert.equal(t.implementadoEm,null);
  assert.equal(t.responsavel,'Ana');assert.equal(t.nota,'Conferido pela equipe');
  assert.equal(s.historico[0].alteracoes.origem.criterioSucesso,plano().criterioSucesso);
  assert.equal(s.historico.at(-1).tipo,'origem_atualizada');assert.deepEqual(s.historico.slice(0,-1),c.historico);
  assert.deepEqual(sincronizarTarefas(s,[novoPlano],opts),s);
});
test('nova data da mesma evidência não cria uma nova execução nem falsifica recência',()=>{
  const s=concluir(),p=plano();p.evidencias[0].coletadoEm=iso(T-100);
  const novo=sincronizarTarefas(s,[p],opts);assert.deepEqual(novo,s);
  assert.equal(novo.itens[0].origem.referencias[0].coletadoEm,iso(T-10000));
});
test('tarefa ausente é arquivada e o retorno com origem igual preserva seu resultado',()=>{
  const c=concluir(),a=sincronizarTarefas(c,[],opts);assert.equal(a.itens[0].arquivada,true);
  assert.equal(a.itens[0].estado,'concluida');rejeita(()=>editar(a,{nota:'não editar'}),409);
  assert.deepEqual(sincronizarTarefas(a,[],opts),a);
  const r=sincronizarTarefas(a,[plano()],opts);assert.equal(r.itens[0].arquivada,false);assert.equal(r.itens[0].estado,'concluida');
  assert.equal(r.historico.at(-1).tipo,'reativada');assert.deepEqual(r.historico.slice(0,-1),a.historico);
});
test('retorno com conteúdo alterado abre nova versão sem reaproveitar conclusão arquivada',()=>{
  const a=sincronizarTarefas(concluir(),[],opts),r=sincronizarTarefas(a,[plano({acao:'Conferir a nova modalidade de contratação.'})],opts);
  assert.equal(r.itens[0].estado,'pendente');assert.equal(r.itens[0].verificacao,null);assert.equal(r.itens[0].origem.versao,2);
});
test('campos extras do plano não são serializados no registro editável',()=>{
  const p=plano({segredo:'nao_copiar',economia:{receita:123456}}),s=sincronizarTarefas(null,[p],opts);
  assert.doesNotMatch(JSON.stringify(s),/nao_copiar|123456|segredo/);
});
test('duplicatas, origem inválida, URLs externas e excesso de tarefas são recusados atomicamente',()=>{
  const s=criar(),antes=structuredClone(s);
  rejeita(()=>sincronizarTarefas(s,[plano(),plano()],opts));
  rejeita(()=>sincronizarTarefas(s,[plano({paginaAlvo:{url:'https://fora.com.br'}})],opts));
  rejeita(()=>sincronizarTarefas(s,[plano({id:'__proto__'})],opts));
  rejeita(()=>sincronizarTarefas(s,[plano({passos:['Duplicado','Duplicado']})],opts));
  rejeita(()=>sincronizarTarefas(s,Array.from({length:LIMITES_TAREFAS.ativas+1},(_,i)=>plano({id:'t'+i})),opts));
  assert.deepEqual(s,antes);
});
test('limite de bytes recusa o lote sem truncar fontes ou histórico anterior',()=>{
  const s=criar(),antes=structuredClone(s);
  const lista=Array.from({length:20},(_,i)=>plano({id:'grande_'+i,evidencias:Array.from({length:32},(_,j)=>({url:URL,campo:'p',trecho:j+':'+('x'.repeat(3900))}))}));
  rejeita(()=>sincronizarTarefas(s,lista,opts),413);assert.deepEqual(s,antes);
});
test('registro de outro domínio, estado adulterado e evento alterado não são reutilizados',()=>{
  const s=criar();rejeita(()=>sincronizarTarefas(s,[plano()],{...opts,dominio:'outro.com.br'}));
  for(const alterar of [x=>{x.itens[0].nota='mudança não registrada';},x=>{x.historico[0].alteracoes.estado='concluida';},x=>{x.historico=[];},x=>{x.itens.push(x.itens[0]);}]){
    const adulterado=structuredClone(s);alterar(adulterado);rejeita(()=>sincronizarTarefas(adulterado,[plano()],opts));
  }
});
test('revisões, datas inválidas, booleanos numéricos e controles invisíveis são recusados',()=>{
  rejeita(()=>editar(criar(),{revisao:true}));rejeita(()=>editar(criar(),{nota:'texto\u0000'}));
  rejeita(()=>concluir(criar(),{implementadoEm:'2026-02-30T00:00:00Z'}));
  rejeita(()=>concluir(criar(),{verificacao:verificacao({medida:{indicador:'campos',tipo:'numero',valor:true,unidade:'campos'}})}));
  rejeita(()=>concluir(criar(),{verificacao:verificacao({medida:{indicador:'campos',tipo:'numero',valor:NaN,unidade:'campos'}})}));
});
test('não aceita relógio retroativo nem cria evento quando só lê uma tarefa inalterada',()=>{
  const s=criar();rejeita(()=>sincronizarTarefas(s,[plano()],{...opts,agora:()=>T-1}));
  assert.deepEqual(sincronizarTarefas(s,[plano()],{...opts,agora:()=>T+1000}),s);
});
test('compara posição numericamente sem chamar diferença de ganho ou causa',()=>{
  const a=observacao(),b=observacao({coletadoEm:iso(T-1000),medida:{...a.medida,valor:5},fonte:{id:'captura_002',sha256:'b'.repeat(64)}});
  const c=compararObservacoes(a,b,opts);assert.equal(c.comparavel,true);assert.equal(c.diferenca,-6);assert.equal(c.mudou,true);assert.equal(c.causalidade,'nao_estabelecida');
});
test('observação repetida, contextos diferentes e natureza misturada não são comparáveis',()=>{
  const a=observacao();assert.equal(compararObservacoes(a,a,opts).comparavel,false);
  for(const patch of [{contexto:{...a.contexto,dispositivo:'Celular'}},{contexto:{...a.contexto,localidade:'São Paulo'}},{natureza:'declarado'},
      {medida:{...a.medida,unidade:'cliques'}},{medida:{...a.medida,indicador:'outra_metrica'}}]){
    const b=observacao({coletadoEm:iso(T-1000),...patch}),r=compararObservacoes(a,b,opts);
    assert.equal(r.comparavel,false);assert.equal(r.diferenca,null);assert.equal(r.mudou,null);
  }
});
test('hipóteses e valores ausentes nunca geram diferença ou zero inventado',()=>{
  for(const patch of [{natureza:'hipotese'},{medida:{...observacao().medida,valor:null}}]){
    const a=observacao(patch),b=observacao({coletadoEm:iso(T-1000),...patch});
    const r=compararObservacoes(a,b,opts);assert.equal(r.comparavel,false);assert.equal(r.diferenca,null);
  }
});
test('medidas textuais e booleanas têm comparação de mudança sem diferença numérica',()=>{
  for(const m of [{indicador:'contato_visivel',tipo:'booleano',valor:false,unidade:'booleano'},
    {indicador:'texto_contato',tipo:'texto',valor:'Ligação',unidade:'rotulo'}]){
    const a=observacao({natureza:'declarado',medida:m}),b=observacao({natureza:'declarado',coletadoEm:iso(T-1000),medida:{...m,valor:m.tipo==='booleano'?true:'Formulário'}});
    const c=compararObservacoes(a,b,opts);assert.equal(c.comparavel,true);assert.equal(c.mudou,true);assert.equal(c.diferenca,null);
  }
});
test('comparação por período exige duração igual, ordem e não sobreposição',()=>{
  const a=observacao({coletadoEm:iso(T-10000),contexto:{...observacao().contexto,periodoInicio:iso(T-80000),periodoFim:iso(T-40000)}});
  const b=observacao({coletadoEm:iso(T),contexto:{...a.contexto,periodoInicio:iso(T-40000),periodoFim:iso(T)}});
  assert.equal(compararObservacoes(a,b,opts).comparavel,true);
  const overlap={...b,contexto:{...b.contexto,periodoInicio:iso(T-50000),periodoFim:iso(T-10000)}};
  assert.ok(compararObservacoes(a,overlap,opts).motivos.includes('periodos_sobrepostos_ou_invertidos'));
  const desigual={...b,contexto:{...b.contexto,periodoInicio:iso(T-30000)}};
  assert.ok(compararObservacoes(a,desigual,opts).motivos.includes('duracoes_diferentes'));
});
test('observação automática exige referência, mas o contrato não autentica sua fonte',()=>{
  const a=observacao(),b=observacao({coletadoEm:iso(T-1000)});
  rejeita(()=>compararObservacoes({...a,fonte:null},b,opts));
  rejeita(()=>compararObservacoes({...a,fonte:{id:'x',sha256:'errado'}},b,opts));
  rejeita(()=>compararObservacoes({...a,contexto:{...a.contexto,url:'https://rival.com.br/'}},b,opts));
  assert.match(compararObservacoes(a,b,opts).limite,/não autenticam/);
});
test('diferença numérica acima do intervalo suportado não é apresentada como exata',()=>{
  const a=observacao({medida:{indicador:'saldo',tipo:'numero',valor:-Number.MAX_SAFE_INTEGER,unidade:'pontos'}});
  const b=observacao({coletadoEm:iso(T-1000),medida:{...a.medida,valor:Number.MAX_SAFE_INTEGER}});
  const r=compararObservacoes(a,b,opts);assert.equal(r.comparavel,false);assert.equal(r.diferenca,null);
  assert.ok(r.motivos.includes('diferenca_fora_do_intervalo_suportado'));
});
test('plano produzido pelos módulos de negócio sincroniza sem perder contrato',()=>{
  const html='<html><head><title>Contratação de artistas gospel</title><meta name="description" content="Agenciamento de artistas gospel para eventos e igrejas."></head><body><h1>Contratação de artistas gospel</h1><p>Solicite orçamento para contratar artistas gospel. Informe cidade e data do evento.</p><a href="/contato">Pedir orçamento</a></body></html>';
  const captura={dominio:DOMINIO,coletadoEm:iso(T-10000),falhas:[],paginas:[{url:URL,html,status:200,coletadoEm:iso(T-10000),sha256:createHash('sha256').update(html).digest('hex')}]};
  const descoberta=descobrirTermos(captura),contextoPublico=extrairContextoPublico(captura);
  const perfil=corrigirPerfil(inferirPerfil({dominio:DOMINIO,descoberta,contextoPublico,coletadoEm:captura.coletadoEm}),{confirmado:true});
  const palavras=gerarPalavras({perfil,descoberta});
  const oportunidades=avaliarOportunidades({perfil,palavras,contextoPublico,capacidades:{posicoes:{configurada:false}}},{agora:()=>T});
  assert.ok(oportunidades.planoDeAcao.length>0);
  const s=sincronizarTarefas(null,oportunidades.planoDeAcao,opts);assert.equal(s.itens.length,oportunidades.planoDeAcao.length);
  assert.deepEqual(sincronizarTarefas(s,oportunidades.planoDeAcao,opts),s);
});
