import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {publicarProposicoes,conferirProjecaoProposicoes} from '../lib/proposicoes-publicas.mjs';

const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/proposicoes-autoral-v3.json',import.meta.url),'utf8'));
const ordenar=v=>Array.isArray(v)?v.map(ordenar):v!==null&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordenar(v[k])])):v;
const sha=v=>createHash('sha256').update(JSON.stringify(ordenar(v))).digest('hex');

test('unidade com emoji preserva offsets Unicode e distingue ferramenta de equipe sem aprovar a interpretação',()=>{
  const {base,saida}=fixture(),r=publicarProposicoes(saida,base),ps=r.ofertas[0].jornada.proposicoes;
  assert.equal(r.inferenciasExecutadas,0);assert.equal(r.perfilConfirmado,false);assert.equal(r.revisaoSemantica,'pendente');
  assert.equal(ps[0].tipoSujeito,'ferramenta');assert.equal(ps[0].unidadeLiteral.texto,'🔧 A ferramenta Aurora organiza os pedidos dos usuários.');
  assert.equal(ps[1].sujeito,'Os analistas do cliente');assert.equal(ps[1].acao,'configuram');assert.equal(ps[1].objeto,'a integração');
  assert.equal(ps[2].escopo,'implementacao');assert.equal(r.ofertas[0].jornada.compradores,undefined);
});

test('intervalo UTF16 que inclui o caractere vizinho não é aceito como span Python',()=>{
  const {base,saida}=fixture();saida.ofertas[0].jornada.proposicoes[0].unidadeLiteral.fim++;
  assert.throws(()=>publicarProposicoes(saida,base),/intervalo literal/);
});

test('nome de um ator em outra sentença do mesmo parágrafo não prova esta relação',()=>{
  const {base,saida}=fixture();saida.ofertas[0].jornada.proposicoes[0].sujeito='Os analistas do cliente';
  assert.throws(()=>publicarProposicoes(saida,base),/sujeito na unidade/);
});

test('ação e objeto também precisam coexistir com o sujeito na mesma unidade',()=>{
  for(const [campo,valor] of [['acao','implementa'],['objeto','a integração']]){
    const {base,saida}=fixture();saida.ofertas[0].jornada.proposicoes[0][campo]=valor;
    assert.throws(()=>publicarProposicoes(saida,base),new RegExp(campo==='acao'?'ação na unidade':'objeto na unidade'));
  }
});

test('citação alterada ou identidade da base divergente não gera versão pública',()=>{
  const a=fixture();a.saida.ofertas[0].jornada.proposicoes[0].citacoes[0].contexto.sha256='c'.repeat(64);
  assert.throws(()=>publicarProposicoes(a.saida,a.base),/citações/);
  const b=fixture();b.saida.entradaSha256='c'.repeat(64);assert.throws(()=>publicarProposicoes(b.saida,b.base),/identidade da entrada/);
});

test('fonte selecionada fora da captura ou do pool não é validada por citar um nome real',()=>{
  const {base,saida}=fixture(),j=saida.ofertas[0].jornada;
  j.fontesSelecionadas[0].contexto.url='https://example.com/nao-coletado';
  j.entradaSha256=sha({versao:1,dominio:base.dominio,fontes:j.fontesSelecionadas});
  assert.throws(()=>publicarProposicoes(saida,base),/fontes recuperadas/);
});

test('IDs de proposição duplicados e fonte trocada não deixam uma relação herdar a prova de outra',()=>{
  const a=fixture(),p=a.saida.ofertas[0].jornada.proposicoes;p[1].id=p[0].id;
  assert.throws(()=>publicarProposicoes(a.saida,a.base),/identidade da proposição/);
  const b=fixture();b.saida.ofertas[0].jornada.proposicoes[0].evidencias=['s02'];
  assert.throws(()=>publicarProposicoes(b.saida,b.base),/referência da proposição/);
});

test('alcance comercial fica explícito e não se transforma em condição geral de uso',()=>{
  const {base,saida}=fixture();saida.ofertas[0].jornada.condicoes[0].alcance='proposta_comercial';
  const c=publicarProposicoes(saida,base).ofertas[0].jornada.condicoes[0];
  assert.equal(c.alcance,'proposta_comercial');assert.equal(c.aplicaA,'teste da ferramenta Aurora');assert.equal(c.obrigatorio,undefined);
  assert.equal(c.revisaoSemantica,'pendente');
});

test('modelo não pode declarar a si mesmo aprovado ou esconder mudança de código',()=>{
  for(const alterar of [r=>r.perfilConfirmado=true,r=>r.revisaoSemantica='aprovada',r=>r.codigoMudouDuranteExecucao=true,r=>r.ofertas[0].jornada.revisaoSemantica='aprovada']){
    const {base,saida}=fixture();alterar(saida);assert.throws(()=>publicarProposicoes(saida,base));
  }
});

test('projeções, caminhos e logs brutos não entram na resposta pública',()=>{
  const {base,saida}=fixture();saida.modelo={caminho:'/Users/exemplo/modelo-privado'};saida.codigo={'caminho':123};
  saida.ofertas[0].jornada.compradores=[{grupo:'NÃO COPIAR ESSA PROJEÇÃO',contribuicao:987654.32}];
  saida.inferencias=[{inferida:false,textoBruto:'STDERR PRIVADO 12345'}];
  const r=publicarProposicoes(saida,base);
  assert.doesNotMatch(JSON.stringify(r),/Users|modelo-privado|NÃO COPIAR|987654|STDERR/);
  assert.equal(r.inferenciasExecutadas,0);
});

test('publicar o experimento não modifica dados, papéis ou o estado de confirmação originais',()=>{
  const {base,saida}=fixture(),antes=structuredClone({base,saida});
  publicarProposicoes(saida,base);assert.deepEqual({base,saida},antes);
});

test('nome escolhido por título mantém apoio no título, sem inventar nova expressão',()=>{
  const {base,saida}=fixture(),o=saida.ofertas[0];o.origemNome='titulo_pagina';
  assert.equal(publicarProposicoes(saida,base).ofertas[0].nome,'ferramenta Aurora');
  o.nome=o.nomePublicado='Gestão total Aurora';assert.throws(()=>publicarProposicoes(saida,base),/nome literal/);
});

test('prova do nome mantém identidade mesmo quando outra referência aparece primeiro',()=>{
  const {base,saida}=fixture(),outra=structuredClone(base.fontes[0]);outra.id='s02';outra.contexto.url='https://example.com/implantacao';
  base.fontes.push(outra);saida.entradaSha256=sha(base);saida.ofertas[0].evidencias=['s02','s01'];saida.ofertas[0].citacoes=[outra,base.fontes[0]];
  const o=publicarProposicoes(saida,base).ofertas[0];assert.equal(o.fonteNome,'s01');
  assert.equal(o.citacoes.find(f=>f.id===o.fonteNome).contexto.url,'https://example.com/aurora');assert.equal(o.citacoes[0].contexto.url,'https://example.com/implantacao');
});

test('predicado não classificado permanece indefinido sem derrubar a relação literal inteira',()=>{
  const {base,saida}=fixture();saida.ofertas[0].jornada.proposicoes[0].relacao='indefinida';
  const r=publicarProposicoes(saida,base);assert.equal(r.ofertas[0].jornada.proposicoes[0].relacao,'indefinida');assert.equal(r.revisaoSemantica,'pendente');
});

test('ofertas recusadas são contadas sem expor texto bruto ou presumir ausência do negócio',()=>{
  const {base,saida}=fixture();saida.ofertas=[];saida.estado='insuficiente';saida.ofertasIdentificadas=0;saida.recusadas=[{item:{textoBruto:'NÃO PUBLICAR O BRUTO'}}];
  const r=publicarProposicoes(saida,base);assert.equal(r.ofertasRecusadas,1);assert.equal(r.ofertas.length,0);assert.doesNotMatch(JSON.stringify(r),/NÃO PUBLICAR/);
});

test('projeção histórica é aceita sem campos aditivos, conservando os bytes e o significado anteriores',()=>{
  const {base,saida}=fixture(),atual=publicarProposicoes(saida,base),antigo=structuredClone(atual);
  delete antigo.projecaoVersao;delete antigo.ofertasRecusadas;for(const o of antigo.ofertas){delete o.fonteNome;delete o.origemNome;for(const p of o.jornada.proposicoes)delete p.relacaoOrigem;}
  const antes=JSON.stringify(antigo);assert.equal(conferirProjecaoProposicoes(atual,antigo),true);assert.equal(JSON.stringify(antigo),antes);
  antigo.ofertas[0].jornada.proposicoes[0].objeto='OBJETO ALTERADO';assert.equal(conferirProjecaoProposicoes(atual,antigo),false);
});

test('compatibilidade histórica não tolera origem falsa, campos extras ou versão de projeção desconhecida',()=>{
  const {base,saida}=fixture(),atual=publicarProposicoes(saida,base);
  for(const alterar of [r=>{delete r.projecaoVersao;r.ofertas[0].fonteNome='s99';},r=>{delete r.projecaoVersao;r.aprovado=true;},r=>r.projecaoVersao=9]){
    const r=structuredClone(atual);alterar(r);assert.equal(conferirProjecaoProposicoes(atual,r),false);
  }
});

test('modelo 9B registrado é identificado corretamente e não aceita registro de execução 4B',()=>{
  const {base,saida}=fixture();saida.config={modeloBase:'qwen35-9b'};
  const r=publicarProposicoes(saida,base,[],{modeloBaseEsperado:'qwen35-9b'});assert.equal(r.modeloBase,'qwen35-9b');
  assert.throws(()=>publicarProposicoes(saida,base,[],{modeloBaseEsperado:'qwen35-4b'}),/modelo local registrado/);
  saida.config.modeloBase='modelo-remoto-ou-nao-registrado';assert.throws(()=>publicarProposicoes(saida,base),/modelo local registrado/);
});

test('origem programática da classificação permanece distinta de inferência do modelo',()=>{
  const {base,saida}=fixture();saida.ofertas[0].jornada.proposicoes[0].relacaoOrigem='regra_verbo_literal';
  const r=publicarProposicoes(saida,base);assert.equal(r.ofertas[0].jornada.proposicoes[0].relacaoOrigem,'regra_verbo_literal');assert.equal(r.projecaoVersao,2);
  const anterior=structuredClone(r);anterior.projecaoVersao=1;for(const o of anterior.ofertas)for(const p of o.jornada.proposicoes)delete p.relacaoOrigem;
  assert.equal(conferirProjecaoProposicoes(r,anterior),true);anterior.ofertas[0].jornada.proposicoes[0].objeto='outro objeto';assert.equal(conferirProjecaoProposicoes(r,anterior),false);
});
