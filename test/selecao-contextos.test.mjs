import test from 'node:test';
import assert from 'node:assert/strict';
import {selecionarContextosNegocio} from '../src/modulos/selecao-contextos.mjs';
import {prepararIAProjeto,registrarContextoInsuficiente} from '../src/modulos/ia.mjs';

const agora=()=>Date.parse('2026-11-15T21:00:00Z');
const publicado=(termo,extra={})=>({termo,origem:'site',ofertaId:'o1',intencao:'comercial',contextoFonte:'oferta',
  evidencia:{url:'https://oficina.com.br/servico',trecho:termo,coletadoEm:'2026-11-15T20:59:00Z',sha256:'a'.repeat(64)},...extra});
const projeto=candidatos=>({dominio:'oficina.com.br',revisao:1,perfil:{ofertas:[{id:'o1',nome:'Conserto de bicicletas'}]},
  palavras:{candidatos},coletadoEm:'2026-11-15T20:59:00Z',descoberta:{cobertura:{paginasLidas:1}},diagnostico:null});

test('marca, ajuda e contexto institucional não preenchem a seleção de ações úteis',()=>{
  const p=projeto([publicado('Oficina',{intencao:'navegacional'}),publicado('Ajuda',{contextoFonte:'atendimento'}),
    publicado('Nosso propósito',{contextoFonte:'institucional'}),publicado('Conserto de bicicletas'),publicado('Slogan',{ofertaId:null})]);
  const r=selecionarContextosNegocio(p,{oportunidades:p.palavras.candidatos.map(c=>({termo:c.termo})),melhorias:[]},{agora});
  assert.deepEqual(r.relatorio.oportunidades.map(o=>o.termo),['Conserto de bicicletas']);
  assert.equal(r.selecao.candidatosElegiveis,1);assert.equal(r.selecao.excluidos.length,4);
});
test('origens vencidas, sem hash ou de outro domínio não sustentam uma seleção atual',()=>{
  for(const alterar of [e=>{e.coletadoEm='2026-11-13T20:59:00Z';},e=>{e.sha256='';},e=>{e.url='https://outra.com.br/';}]){
    const c=publicado('Conserto de bicicletas');alterar(c.evidencia);
    const r=selecionarContextosNegocio(projeto([c]),{oportunidades:[{termo:c.termo}],melhorias:[]},{agora});
    assert.equal(r.relatorio.oportunidades.length,0);assert.equal(r.selecao.excluidos[0].motivo,'origem_sem_evidencia_atual');
  }
});
test('diretiva de publicação permanece candidata à validação mesmo sem oferta identificada',()=>{
  const melhorias=[{verificacaoId:'diretiva-noindex-html',paginaAlvo:'https://oficina.com.br/reservada'},
    {verificacaoId:'titulo-pagina',paginaAlvo:'https://oficina.com.br/sem-objeto'}];
  const r=selecionarContextosNegocio(projeto([]),{oportunidades:[],melhorias},{agora});
  assert.deepEqual(r.relatorio.melhorias,[melhorias[0]]);
});
test('falta de oferta relacionada registra pedido de revisão sem fabricar contexto para o modelo',()=>{
  const p=projeto([publicado('Marca',{ofertaId:null,intencao:'navegacional'})]);
  const r=prepararIAProjeto(p,{agora});assert.deepEqual(r.entrada.entradas,[]);
  const salvo=registrarContextoInsuficiente(p,r,{agora});
  assert.equal(salvo.estado,'sem_contexto');assert.equal(salvo.resultados.length,0);
  assert.match(salvo.limite,/Revise o que o negócio oferece/);assert.equal(salvo.modelo,undefined);
});
