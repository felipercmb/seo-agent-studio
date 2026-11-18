import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {coletar,validarPlano} from '../ia/serp_real/coletar.mjs';

const plano={versao:1,sites:[
  {site:'exemplo.com.br',grupo:'empresa-a',split:'train',lotes:1},
  {site:'exemplo.org.br',grupo:'empresa-b',split:'valid',lotes:1},
  {site:'exemplo.net.br',grupo:'empresa-c',split:'test',lotes:1},
]};

test('separa organizações e exige divisões antes de coletar',()=>{
  assert.equal(validarPlano(plano),plano);
  assert.throws(()=>validarPlano({...plano,sites:[plano.sites[0],{...plano.sites[1],grupo:'empresa-a'},plano.sites[2]]}),/divisões diferentes/);
  assert.throws(()=>validarPlano({...plano,sites:plano.sites.slice(0,2)}),/Reserve grupos/);
  assert.throws(()=>validarPlano({...plano,sites:[...plano.sites,plano.sites[0]]}),/inválidos/);
});

test('não começa nem cria arquivos quando a fonte está desativada',async t=>{
  const pasta=await mkdtemp(join(tmpdir(),'serp-real-'));t.after(()=>rm(pasta,{recursive:true,force:true}));
  let chamadas=0;
  await assert.rejects(coletar({plano,saida:join(pasta,'rodada'),pastaDados:pasta,
    health:async()=>({fonteConfigurada:false}),requisitar:async()=>{chamadas++;}}),/não está configurada/);
  assert.equal(chamadas,0);await assert.rejects(readFile(join(pasta,'rodada','manifest.json')));
});

test('preserva os relatórios, o plano e as falhas sem inventar resultados',async t=>{
  const pasta=await mkdtemp(join(tmpdir(),'serp-real-'));t.after(()=>rm(pasta,{recursive:true,force:true}));
  let espera=0;const vistos=[];
  const requisitar=async(_base,caminho,corpo)=>{
    vistos.push([caminho,corpo.site,!!corpo.continuar]);
    if(caminho==='/api/diagnostico'&&corpo.site==='exemplo.org.br')throw Error('sem página');
    if(caminho==='/api/posicoes')return {estado:'parcial',cobertura:{verificadas:0,encontradas:0,paginasConsultadas:0},
      progresso:{continuar:!corpo.continuar,esperaMs:3,paginasNesteLote:0}};
    return {estado:'parcial'};
  };
  const saida=join(pasta,'rodada');
  const m=await coletar({plano,saida,pastaDados:pasta,health:async()=>({fonteConfigurada:true}),requisitar,pausa:async()=>{espera++;}});
  assert.equal(espera,3);assert.equal(vistos.filter(x=>x[0]==='/api/posicoes'&&x[2]).length,3);
  assert.equal(m.arquivos.filter(x=>x.tipo==='erro_diagnostico').length,1);
  assert.ok(m.arquivos.some(x=>x.site==='exemplo.org.br'&&x.tipo==='posicoes'));
  assert.equal(JSON.parse(await readFile(join(saida,'manifest.json'))).plano_sha256,m.plano_sha256);
  assert.ok(m.arquivos.filter(x=>x.tipo==='posicoes').every(x=>x.encontradas===0));
});

test('não consome mais lotes após fonte rejeitar todas as capturas',async t=>{
  const pasta=await mkdtemp(join(tmpdir(),'serp-real-'));t.after(()=>rm(pasta,{recursive:true,force:true}));
  let lotes=0;
  const requisitar=async(_base,caminho,corpo)=>{
    if(caminho==='/api/posicoes') {
      if(corpo.continuar)lotes++;
      return {estado:'parcial',cobertura:{paginasConsultadas:0},progresso:{continuar:true,paginasNesteLote:corpo.continuar?4:0}};
    }
    return {estado:'parcial'};
  };
  const m=await coletar({plano,saida:join(pasta,'rodada'),pastaDados:pasta,health:async()=>({fonteConfigurada:true}),requisitar,pausa:async()=>{}});
  assert.equal(lotes,1);assert.equal(m.interrompida,'fonte_sem_captura_valida');
});
