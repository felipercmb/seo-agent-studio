import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {criarExecutorIA,candidataIntegra} from '../lib/ia-local.mjs';

function processo() {
  const filho=new EventEmitter();filho.stdin=new PassThrough();filho.stdout=new PassThrough();
  filho.kill=()=>{filho.morto=true;};return filho;
}

test('executor local usa processo fixo, não passa chave ou comando do navegador e limita concorrência',async()=>{
  const filho=processo();let chamada;
  const executor=criarExecutorIA({iniciar:(...args)=>{chamada=args;return filho;},limiteMs:1000});
  const anterior=process.env.SERPAPI_KEY;process.env.SERPAPI_KEY='segredo-que-nao-deve-ser-passado';
  try {
    const pendente=executor.executar({versao:1,entradas:[]});
    await assert.rejects(executor.executar({versao:1}),/andamento/);
    assert.equal(chamada[2].shell,false);assert.equal(chamada[2].env.SERPAPI_KEY,undefined);
    assert.equal(chamada[2].env.HF_HUB_OFFLINE,'1');assert.match(chamada[1][0],/inferir_web\.py$/);
    filho.stdout.write(JSON.stringify({versao:1}));filho.emit('close',0);
    assert.deepEqual(await pendente,{versao:1});
  } finally {if(anterior===undefined)delete process.env.SERPAPI_KEY;else process.env.SERPAPI_KEY=anterior;}
});

test('executor encerra o processo após o prazo e não propaga saída inválida',async()=>{
  const filho=processo(),executor=criarExecutorIA({iniciar:()=>filho,limiteMs:10});
  await assert.rejects(executor.executar({versao:1}),/tempo/);assert.equal(filho.morto,true);
  const outro=processo(),ruim=criarExecutorIA({iniciar:()=>outro,limiteMs:1000});
  const pendente=ruim.executar({versao:1});outro.stdout.write('texto indevido');outro.emit('close',0);
  await assert.rejects(pendente,/inválida/);
});

test('candidata usa apenas flag fixa e mantém a execução local',async()=>{
  const filho=processo();let argumentos;
  const executor=criarExecutorIA({iniciar:(_python,args)=>{argumentos=args;return filho;},limiteMs:1000});
  const p=executor.executar({versao:1},{candidata:true});
  assert.equal(argumentos.length,2);assert.equal(argumentos[1],'--candidata');
  filho.stdout.write('{"versao":1}');filho.emit('close',0);assert.equal((await p).versao,1);
});

test('candidata nova exige decisão e hash compatíveis, preservando seleção anterior',()=>{
  const dados=Buffer.from('{"candidato":"local"}'),sha=createHash('sha256').update(dados).digest('hex');
  assert.equal(candidataIntegra(dados,JSON.stringify({estado:'experimental_disponivel',selecao_sha256:sha})),true);
  assert.equal(candidataIntegra(dados,JSON.stringify({estado:'manter_selecao_anterior',selecao_sha256:sha})),true);
  assert.equal(candidataIntegra(dados,JSON.stringify({estado:'experimental_disponivel',selecao_sha256:'0'.repeat(64)})),false);
  assert.equal(candidataIntegra(dados,'{'),false);
});
