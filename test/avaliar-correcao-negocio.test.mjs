import test from 'node:test';
import assert from 'node:assert/strict';
import {extrairJanelasUtilidade} from '../scripts/avaliar-correcao-negocio.mjs';

test('empresa sem tarefas preserva janela vazia, sem criar sucesso ou tarefa artificial',()=>{
 const r=extrairJanelasUtilidade({oportunidades:{planoDeAcao:[],planoNegocio:[]}});
 assert.equal(r.totalGeral,0);assert.equal(r.totalNegocioProposto,0);assert.deepEqual(r.negocio,[]);
});
test('fila negócio separada preserva ordem geral e o corte de três, sem promover eixo técnico',()=>{
 const fila=Array.from({length:7},(_,i)=>({id:`t${i}`,tipo:i%2?'conferir_oferta':'corrigir_uso'}));
 const r=extrairJanelasUtilidade({oportunidades:{planoDeAcao:fila,planoNegocio:[fila[1],fila[3],fila[5],fila[6]]}});
 assert.deepEqual(r.negocio.map(v=>v.posicaoFilaGeral),[2,4,6]);assert.equal(r.totalNegocioProposto,4);
 assert.equal(Object.hasOwn(r.negocio[0],'util'),false);
});
test('legado mantém tentativas de negócio para comparação, sem chamar um molde de útil',()=>{
 const r=extrairJanelasUtilidade({oportunidades:{planoDeAcao:[{id:'d',tipo:'corrigir_uso'},{id:'b',tipo:'conferir_oferta',categoria:'contratacao'}]}});
 assert.equal(r.origemFilaNegocio,'compatibilidade_legada_tipo_conferir_oferta');assert.equal(r.negocio[0].posicaoFilaGeral,2);
});
test('tarefa fora da fila geral tem posição desconhecida explícita',()=>{
 const r=extrairJanelasUtilidade({oportunidades:{planoDeAcao:[{id:'a'}],planoNegocio:[{id:'outro'}]}});
 assert.equal(r.negocio[0].posicaoFilaGeral,null);
});
