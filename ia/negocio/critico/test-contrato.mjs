import assert from 'node:assert/strict';
import {test} from 'node:test';
import {montarCorpus,construirFamilias} from './montar-controles.mjs';
import {validarEntradaCritica,validarSaidaCritica,TIPOS_PROBLEMA} from './contrato.mjs';

const corpus=montarCorpus();
const caso=corpus.casos.find(c=>c.esperado.estado==='revisar');

test('corpus pareado preserva forma mesmo quando a proposta tem erro semântico',()=>{
  assert.equal(corpus.casos.length,24);
  for(const c of corpus.casos){
    assert.equal(validarEntradaCritica(c.entrada).valido,true,c.id);
    assert.equal(validarSaidaCritica(c.esperado,c.entrada).valido,true,c.id);
    assert.deepEqual(Object.keys(c.entrada).sort(),['fontes','proposta','tarefa']);
  }
  for(const fam of construirFamilias())assert.equal(fam.delta.length,1);
  for(const tipo of TIPOS_PROBLEMA)for(const split of ['train','validation'])
    assert.equal(corpus.casos.filter(c=>c.split===split&&c.esperado.estado==='revisar'&&c.esperado.problemas[0].tipo===tipo).length,1);
});

test('pares e fontes nunca atravessam divisão por família',()=>{
  for(const grupo of new Set(corpus.casos.map(c=>c.grupoEmpresarial))){
    const par=corpus.casos.filter(c=>c.grupoEmpresarial===grupo);
    assert.equal(par.length,2);assert.equal(new Set(par.map(c=>c.split)).size,1);
    assert.deepEqual(par[0].entrada.fontes,par[1].entrada.fontes);
    assert.deepEqual(new Set(par.map(c=>c.esperado.estado)),new Set(['manter','revisar']));
  }
});

test('crítico não pode citar trecho inventado, juntado entre campos ou fonte inexistente',()=>{
  const s=structuredClone(caso.esperado);
  s.problemas[0].trechoPropostaLiteral='Texto inventado que não ocorre na proposta';
  assert.equal(validarSaidaCritica(s,caso.entrada).valido,false);
  s.problemas[0].trechoPropostaLiteral=caso.entrada.proposta.decisao.slice(-20)+' '+caso.entrada.proposta.acao.slice(0,20);
  assert.equal(validarSaidaCritica(s,caso.entrada).valido,false);
  s.problemas[0].trechoPropostaLiteral=caso.esperado.problemas[0].trechoPropostaLiteral;s.problemas[0].fontes=['fonte_ausente'];
  assert.equal(validarSaidaCritica(s,caso.entrada).valido,false);
});

test('trecho deve pertencer à proposta e não somente à fonte',()=>{
  const c=corpus.casos.find(c=>c.familia==='prazo-atualizacao-licenca'&&c.esperado.estado==='revisar');
  const s=structuredClone(c.esperado);s.problemas[0].trechoPropostaLiteral='Vendemos a Licença Traço';
  assert.ok(c.entrada.fontes[0].texto.includes(s.problemas[0].trechoPropostaLiteral));
  assert.equal(validarSaidaCritica(s,c.entrada).valido,false);
});

test('manter não leva problemas e revisar exige problema delimitado',()=>{
  assert.equal(validarSaidaCritica({estado:'manter',problemas:caso.esperado.problemas},caso.entrada).valido,false);
  assert.equal(validarSaidaCritica({estado:'revisar',problemas:[]},caso.entrada).valido,false);
  assert.equal(validarSaidaCritica({estado:'manter',problemas:[]},caso.entrada).valido,true);
});

test('uma proposta mecanicamente quebrada não serve de entrada ao crítico semântico',()=>{
  const e=structuredClone(caso.entrada);delete e.proposta.fontes;
  assert.equal(validarEntradaCritica(e).valido,false);
  assert.equal(validarSaidaCritica(caso.esperado,e).valido,false);
});
