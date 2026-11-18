import {test} from 'node:test';
import assert from 'node:assert/strict';
import {criarConexoesGoogleLocais,origemExtensaoGoogle} from '../lib/conexao-google-local.mjs';
const T=Date.parse('2026-11-17T10:00:00.000Z');
const captura=(i=0)=>({formato:'visibilidade-google-local',versao:1,metodo:'pagina_aberta',url:'https://www.google.com/search?q=agenda&udm=14&hl=pt-BR&gl=br',coletadoEm:new Date(T+i).toISOString(),dispositivo:'computador',localidadeDeclarada:null,html:'<div id="rso"><div class="g"><a href="https://example.com/"><h3>Agenda</h3></a></div></div>'});
function ambiente(){let agora=T,gravacoes=0;const p={dominio:'example.com',revisao:1,capturasGoogleLocais:[],segredo:'NAO_RETORNAR'};
 const c=criarConexoesGoogleLocais({agora:()=>agora,consultarProjeto:async()=>structuredClone(p),registrarCaptura:async e=>{assert.equal(e.site,p.dominio);assert.equal(e.revisao,p.revisao);gravacoes++;p.revisao++;p.capturasGoogleLocais.push(e.captura);return structuredClone(p);}});
 return{c,p,gravacoes:()=>gravacoes,avancar:ms=>{agora+=ms;},criar:()=>c.criar({site:p.dominio,revisao:p.revisao})};
}
test('código tem entropia própria e concede apenas envio, sem dados do perfil nem persistência',async()=>{
 const a=ambiente(),s=await a.criar();assert.match(s.codigo,/^[A-Za-z0-9_-]{43}$/u);assert.equal(s.permissao,'somente_enviar_capturas');assert.equal(a.c.consultar(s.codigo).codigo,undefined);assert.ok(!JSON.stringify(a.c.consultar(s.codigo)).includes('NAO_RETORNAR'));assert.ok(!JSON.stringify(a.p).includes(s.codigo));assert.equal(a.gravacoes(),0);
});
test('expiração é fixa, não se estende no envio e reinício remove a autorização',async()=>{
 const a=ambiente(),s=await a.criar();a.avancar(599000);const r=await a.c.registrar({codigo:s.codigo,captura:captura()});assert.equal(r.expiraEm,s.expiraEm);a.avancar(1000);assert.throws(()=>a.c.consultar(s.codigo),e=>e.status===401);await assert.rejects(a.c.registrar({codigo:s.codigo,captura:captura()}),e=>e.status===401);const novo=await a.criar();a.c.fechar();assert.throws(()=>a.c.consultar(novo.codigo),e=>e.status===401);
});
test('novo código revoga o anterior do projeto e revogação explícita impede novos envios',async()=>{
 const a=ambiente(),s=await a.criar(),n=await a.criar();assert.notEqual(s.codigo,n.codigo);assert.throws(()=>a.c.consultar(s.codigo),e=>e.status===401);assert.equal(a.c.revogar(n.codigo).revogada,true);await assert.rejects(a.c.registrar({codigo:n.codigo,captura:captura()}),e=>e.status===401);
});
test('revisão concorrente exige reconectar e não grava usando novo perfil silenciosamente',async()=>{
 const a=ambiente(),s=await a.criar();a.p.revisao++;await assert.rejects(a.c.registrar({codigo:s.codigo,captura:captura()}),e=>e.status===409);assert.equal(a.gravacoes(),0);await assert.rejects(a.c.criar({site:a.p.dominio,revisao:1}),e=>e.status===409);
});
test('reenvio idêntico é idempotente inclusive com outra ordem de chaves e não devolve perfil',async()=>{
 const a=ambiente(),s=await a.criar(),c=captura(),r=await a.c.registrar({codigo:s.codigo,captura:c}),n=await a.c.registrar({codigo:s.codigo,captura:Object.fromEntries(Object.entries(c).reverse())});assert.equal(a.gravacoes(),1);assert.equal(n.estado,'ja_recebida');assert.equal(r.revisao,n.revisao);assert.equal(n.capturasNoProjeto,1);assert.ok(!JSON.stringify(n).includes('NAO_RETORNAR'));
});
test('um código não permite trocar domínio, ação, posição ou enviar captura inválida',async()=>{
 const a=ambiente(),s=await a.criar();for(const extra of [{site:'outro.com'},{acao:'reler_site'},{posicao:1}])await assert.rejects(a.c.registrar({codigo:s.codigo,captura:captura(),...extra}),e=>e.status===400);await assert.rejects(a.c.registrar({codigo:s.codigo,captura:{...captura(),html:'x'.repeat(60001)}}),e=>e.status===413);await assert.rejects(a.c.registrar({codigo:s.codigo,captura:{...captura(),url:'https://outro.com/'}}),e=>e.status===400);assert.equal(a.gravacoes(),0);
});
test('reenvio de uma captura antiga informa o saldo e a revisão mais recentes da conexão',async()=>{
 const a=ambiente(),s=await a.criar(),primeira=captura();
 await a.c.registrar({codigo:s.codigo,captura:primeira});
 for(let i=1;i<20;i++)await a.c.registrar({codigo:s.codigo,captura:captura(i)});
 const r=await a.c.registrar({codigo:s.codigo,captura:primeira});
 assert.equal(r.estado,'ja_recebida');assert.equal(r.restantes,0);assert.equal(r.revisao,21);assert.equal(r.capturasNoProjeto,20);assert.equal(a.gravacoes(),20);
});
test('limite de vinte gravações preserva recibos e impede crescimento ilimitado',async()=>{
 const a=ambiente(),s=await a.criar();for(let i=0;i<20;i++)await a.c.registrar({codigo:s.codigo,captura:captura(i)});await assert.rejects(a.c.registrar({codigo:s.codigo,captura:captura(21)}),e=>e.status===429);assert.equal(a.gravacoes(),20);assert.equal((await a.c.registrar({codigo:s.codigo,captura:captura(19)})).estado,'ja_recebida');
});
test('envios paralelos não disputam a mesma revisão nem duplicam efeito',async()=>{
 let liberar;const espera=new Promise(r=>{liberar=r;});let n=0;const c=criarConexoesGoogleLocais({agora:()=>T,consultarProjeto:async()=>({dominio:'example.com',revisao:1}),registrarCaptura:async()=>{await espera;n++;return{dominio:'example.com',revisao:2,capturasGoogleLocais:[]};}}),s=await c.criar({site:'example.com',revisao:1});
 const primeiro=c.registrar({codigo:s.codigo,captura:captura()});await assert.rejects(c.registrar({codigo:s.codigo,captura:captura(1)}),e=>e.status===409);liberar();await primeiro;assert.equal(n,1);
});
test('erro de gravação não consome a cota nem deixa conexão ocupada',async()=>{
 let falhar=true;const c=criarConexoesGoogleLocais({agora:()=>T,consultarProjeto:async()=>({dominio:'example.com',revisao:1}),registrarCaptura:async()=>{if(falhar)throw Error('falha local');return{dominio:'example.com',revisao:2};}}),s=await c.criar({site:'example.com',revisao:1});await assert.rejects(c.registrar({codigo:s.codigo,captura:captura()}));assert.equal(c.consultar(s.codigo).restantes,20);falhar=false;assert.equal((await c.registrar({codigo:s.codigo,captura:captura()})).restantes,19);
});
test('origens de extensão válidas são exatas, sem sufixo, credencial ou URL web',()=>{
 const valida='chrome-extension://'+'a'.repeat(32);assert.equal(origemExtensaoGoogle(valida),valida);for(const v of [valida+'/',valida+'.evil.com','https://example.com','null',undefined,'chrome-extension://'+'q'.repeat(32)])assert.equal(origemExtensaoGoogle(v),null);
});
