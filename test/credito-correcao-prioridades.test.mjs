import test from 'node:test';
import assert from 'node:assert/strict';
import {prepararDecisaoPublicada} from '../src/modulos/decisoes-publicadas.mjs';
import {conferirVinculoResposta} from '../src/modulos/entregaveis-prioridades.mjs';
const U='https://roteiro-local.com.br/solucoes',H='f'.repeat(64);
const oferta=()=>({id:'r',nome:'Curso de redação',url:U,jornada:{comprador:'Pessoa que solicita avaliação da redação',executor:'Professor realiza a avaliação humana',beneficiario:'Pessoa que escreveu a redação',pagador:'',objetivo:'Comparar correção de redação por IA e professor.'}});
const fonte=(trecho,secao,extra={})=>({url:U,trecho,secao,campo:'p',sha256:H,coletadoEm:'2026-11-17T00:00:00Z',recortado:false,tipo:'negocio_publicado',...extra});
const ia=()=>fonte('O Curso de redação publica 10 correções de redação por IA por mês.','Retorno por IA');
const humano=()=>fonte('A redação pode ser corrigida por um professor que devolve orientação.','Correção humana');
const credito=()=>fonte('Escolha a redação que precisa de um professor e use 1 crédito.','Compre créditos');
function executar(fontes){const o=oferta();return prepararDecisaoPublicada({id:'t',decisao:{}},{oferta:o,ofertas:[o],fontes,validarVinculo:conferirVinculoResposta,agora:()=>Date.parse('2026-11-17T01:00:00Z')});}
const condicoes=r=>r.decisao.decisaoPreparada.alternativas.find(a=>a.modo==='humano').condicoes;
test('condição de crédito para código não é atribuída à correção humana de redação',()=>{
 const codigo=fonte('Para a revisão de código por professor, cada crédito cobre uma análise de código.','Compre créditos de código');
 const r=executar([ia(),humano(),codigo]);
 assert.equal(r.decisao.decisaoPreparada.tipo,'comparar_modalidades_de_correcao');
 assert.deepEqual(condicoes(r),[]);
});
test('crédito explicitamente ligado à redação permanece no retorno humano',()=>{
 const c=credito(),r=executar([ia(),humano(),c]);
 assert.deepEqual(condicoes(r).map(x=>x.trecho),[c.trecho]);
 assert.deepEqual(r.decisao.decisaoPreparada.alternativas.find(a=>a.modo==='automatizado').quantidadeAnunciada,{valor:10,unidade:'correcoes',periodo:'mes',natureza:'quantidade_anunciada_nao_maximo_inferido'});
});
test('duas capturas empatadas da mesma página não viram uma comparação combinada',()=>{
 assert.equal(executar([ia(),humano(),{...credito(),sha256:'e'.repeat(64)}]),null);
});
test('ausência de condição de crédito mantém a condição desconhecida e preserva os dados',()=>{
 const fs=[ia(),humano()],antes=structuredClone(fs),r=executar(fs);
 assert.deepEqual(fs,antes);assert.deepEqual(condicoes(r),[]);
 assert.equal(r.decisao.decisaoPreparada.casos[1].dadosEntrada.creditosDisponiveis,null);
});
