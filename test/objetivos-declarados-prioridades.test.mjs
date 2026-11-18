import test from 'node:test';
import assert from 'node:assert/strict';
import {prepararComparacaoObjetivos} from '../src/modulos/decisoes-objetivos.mjs';
import {conferirVinculoResposta} from '../src/modulos/entregaveis-prioridades.mjs';
const U='https://roteiro-local.com.br/solucoes',H='f'.repeat(64);
const oferta=(id,nome,objetivo)=>({id,nome,url:U,jornada:{comprador:'Pessoa que solicita '+id,executor:'Equipe declarada '+id,beneficiario:'Pessoa usuária '+id,pagador:'',objetivo}});
const a=()=>oferta('a','Atlas Agenda','Planejar a sequência de atividades antes de solicitar acesso.');
const b=()=>oferta('b','Vega Arquivo','Consultar o acervo já produzido antes de solicitar acesso.');
const fonte=(trecho,secao)=>({url:U,trecho,secao,campo:'p',sha256:H,coletadoEm:'2026-11-17T00:00:00Z',recortado:false,tipo:'negocio_publicado'});
const fa=()=>fonte('Atlas Agenda: as atividades aparecem por etapa, com sequência e responsável. O limite anunciado é de 7 etapas.','Atlas Agenda');
const fb=()=>fonte('Vega Arquivo: cada versão permanece no acervo com seu histórico. A consulta é descrita para o acervo publicado.','Vega Arquivo');
const run=(fontes,ofertas=[a(),b()])=>prepararComparacaoObjetivos({oferta:ofertas[0],ofertas,fontes,validarVinculo:conferirVinculoResposta});
test('objetivos declarados distintos selecionam publicações próprias sem verbo de setor',()=>{
 const p=run([fa(),fb()]);
 assert.equal(p.tipo,'comparar_objetivos_declarados');
 assert.deepEqual(p.casos.map(x=>x.dadosEntrada.objetivoDeclarado),[a().jornada.objetivo,b().jornada.objetivo]);
 assert.deepEqual(p.casos.map(x=>x.esperado.alternativas),p.opcoes.map(x=>[x.id]));
 assert.ok(p.casos.every(x=>x.natureza==='hipotese_controlada'&&x.esperado.adequacaoConfirmada===false));
 assert.deepEqual(p.opcoes.map(x=>x.fonte.trecho),[fa().trecho,fb().trecho]);
 assert.deepEqual(p.casos.map(x=>x.dadosEntrada.origemDasPartes),['declaracao_usuario','declaracao_usuario']);
 assert.ok(!p.casos.some(x=>x.dadosEntrada.pagador));
});
test('título e URL compartilhados não substituem a referência de objeto no corpo',()=>{
 const outra=fonte('Atlas Agenda: existe um acervo anunciado nesta oferta.','Vega Arquivo');
 assert.equal(run([fa(),outra]),null);
 assert.equal(run([fa(),fonte('A solução oferece uma rotina disponível.','Vega Arquivo')]),null);
});
test('condição de uma opção permanece no seu próprio trecho',()=>{
 const p=run([fa(),fb()]);
 assert.equal(p.opcoes[0].fonte.trecho,fa().trecho);assert.equal(p.opcoes[1].fonte.trecho,fb().trecho);
 assert.ok(!p.opcoes[1].fonte.trecho.includes('7 etapas'));
});
test('oferta sem objetivo/partes próprias e público global não cria caso',()=>{
 const sem=b();sem.jornada={objetivo:'',publico:'famílias, doadores, compradores'};
 assert.equal(run([fa(),fb()],[a(),sem]),null);
});
test('objetivos iguais ou segunda fonte só metadados não são contraste respondido',()=>{
 const igual=b();igual.jornada.objetivo=a().jornada.objetivo;
 assert.equal(run([fa(),fb()],[a(),igual]),null);
 assert.equal(run([fa(),{...fb(),campo:'h2'}]),null);
});

import {prepararDecisaoPublicada} from '../src/modulos/decisoes-publicadas.mjs';
test('condição de crédito de outro objeto não é transferida à modalidade humana',()=>{
 const o=oferta('r','Curso de redação','Comparar correção de redação por IA e professor.');
 const ia=fonte('O Curso de redação publica 10 correções de redação por IA por mês.','Retorno por IA');
 const humano=fonte('A redação pode ser corrigida por um professor que devolve orientação.','Correção humana');
 const codigo=fonte('Para a revisão de código por professor, cada crédito cobre uma análise de código.','Compre créditos de código');
 const p=prepararDecisaoPublicada({id:'t',decisao:{}},{oferta:o,ofertas:[o],fontes:[ia,humano,codigo],validarVinculo:conferirVinculoResposta,agora:()=>Date.parse('2026-11-17T01:00:00Z')});
 assert.ok(p);assert.deepEqual(p.decisao.decisaoPreparada.alternativas[1].condicoes,[]);
});
test('uma promoção com objetivo genérico não se torna comparação respondida',()=>{
 const aa=a(),bb=b();aa.jornada.objetivo='Verificar as etapas antes de solicitar uma proposta.';bb.jornada.objetivo='Conhecer a consulta antes de pedir acesso.';
 assert.equal(run([fonte('Atlas Agenda com até 70% OFF por tempo limitado.','Atlas Agenda'),fonte('Vega Arquivo com oferta promocional disponível hoje.','Vega Arquivo')],[aa,bb]),null);
});
