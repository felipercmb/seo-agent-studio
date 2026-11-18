import test from 'node:test';
import assert from 'node:assert/strict';
import {selecionarCasos,resumirRevisaoSemantica} from '../scripts/avaliar-negocio-utilidade.mjs';

test('divisão errada não vira avaliação vazia ou sucesso aparente',()=>{
  const corpus={casos:[{id:'val',dominio:'val.example',split:'validation'},{id:'reservado',dominio:'test.example',split:'holdout'}]};
  assert.throws(()=>selecionarCasos(corpus,['teste']),/não contém casos/);
  assert.deepEqual(selecionarCasos(corpus,['validation']).map(c=>c.id),['val']);
  assert.throws(()=>selecionarCasos(corpus,[]),/explicitamente/);
});

test('fonte sem leitura permanece no denominador e domínio repetido é recusado',()=>{
  const casos=[{id:'a',dominio:'a.example',split:'holdout',paginasCapturadas:0},{id:'b',dominio:'b.example',split:'holdout',paginasCapturadas:2}];
  assert.equal(selecionarCasos({casos},['holdout']).length,2);
  assert.throws(()=>selecionarCasos({casos:[...casos,{id:'c',dominio:'a.example',split:'holdout'}]},['holdout']),/repetidos/);
});

test('ID, contrato e ação genérica não recebem crédito de utilidade',()=>{
  const generica={acao:'validar_demanda',evidencias:['p1'],contratoValido:true,U1:true,U2:true,U3:false,U4:true,justificativa:'A fonte existe, mas não há passo específico para o caso.'};
  const especifica={U1:true,U2:true,U3:true,U4:true,justificativa:'Alvo, passo e verificação foram tecnicamente revisados.'};
  const resumo=resumirRevisaoSemantica([{id:'a',tarefas:[generica]},{id:'b',tarefas:[especifica]},{id:'sem-fila',tarefas:[]}]);
  assert.equal(resumo.empresasAvaliadas,3);
  assert.equal(resumo.tarefasAvaliadas,2);
  assert.equal(resumo.tarefasUteis,1);
  assert.equal(resumo.empresasComTarefaUtil,1);
  assert.equal(resumirRevisaoSemantica([{tarefas:[{...especifica,justificativa:''}]}]).tarefasUteis,0);
});
