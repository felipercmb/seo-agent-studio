import test from 'node:test';
import assert from 'node:assert/strict';
import {projetarContextos} from '../ia/negocio/preparar_contextos.mjs';
import {conferirContextos} from '../ia/negocio/conferir_contextos.mjs';

const captura={arquivo:'fixture-local.json',sha256:'fixture-sha',formato:'captura_json'};
const coleta={dominio:'fixture.example',paginas:[{url:'https://fixture.example/',status:200,coletadoEm:'2026-11-16T00:00:00Z',
  html:'<!doctype html><html><body><main><h1>Serviços</h1><p>Prestamos manutenção de equipamentos para empresas.</p></main></body></html>'}]};
const caso=()=>({id:'fixture',dominio:'fixture.example',grupoEmpresarial:'fixture.example',split:'validation',captura});

test('recuperação EE não lê os rótulos nem o perfil oracle',()=>{
  const c=caso();for(const k of ['alvosPorCampo','perfilOracle','planejamentoEsperado'])Object.defineProperty(c,k,{get(){throw Error('Vazamento de rótulo: '+k);}});
  const campos=[];
  const r=projetarContextos([c],{carregar:()=>({captura,coleta}),recuperar:(pool,{campo})=>{
    assert.equal(Object.hasOwn(pool,'alvosPorCampo'),false);assert.equal(Object.hasOwn(pool,'perfilOracle'),false);campos.push(campo);
    return {campo,fontes:pool.fontes};
  }});
  assert.equal(campos.length,7);assert.equal(r.length,1);assert.equal(r[0].pool.fontes.length>0,true);
});

test('captura alterada interrompe a projeção antes da recuperação',()=>{
  let chamou=false;
  assert.throws(()=>projetarContextos([caso()],{carregar:()=>({captura:{...captura,sha256:'outro'},coleta}),recuperar:()=>{chamou=true;}}),/Captura alterada/);
  assert.equal(chamou,false);
});

test('captura de outro domínio é recusada mesmo com ID parecido',()=>{
  assert.throws(()=>projetarContextos([caso()],{carregar:()=>({captura,coleta:{...coleta,dominio:'outro.example'}})}),/Domínio/);
});

test('fronteira EE aceita só o pool reextraído da captura original',()=>{
  const casos=projetarContextos([caso()],{carregar:()=>({captura,coleta})});
  const d={modo:'end_to_end',casos};
  const r=conferirContextos(d,{carregar:()=>({captura,coleta})});
  assert.equal(r.verificado,true);assert.equal(r.organizacoes,1);
  const adulterado=structuredClone(d);adulterado.casos[0].pool.fontes[0].url='https://outro.example/';
  assert.throws(()=>conferirContextos(adulterado,{carregar:()=>({captura,coleta})}),/Pool difere/);
});

test('trocar só metadados do contexto não passa pela fronteira',()=>{
  const d={modo:'end_to_end',casos:projetarContextos([caso()],{carregar:()=>({captura,coleta})})};
  const contexto=Object.values(d.casos[0].contextosPorCampo).find(c=>c.fontes.length);
  assert.ok(contexto);contexto.fontes[0].coletadoEm='2020-01-01T00:00:00Z';
  assert.throws(()=>conferirContextos(d,{carregar:()=>({captura,coleta})}),/Fonte\/metadados/);
});
