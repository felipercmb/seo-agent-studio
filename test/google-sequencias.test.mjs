import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interpretarCapturaGoogle,criarLinkGoogle,resumirCapturasGoogle} from '../src/google-local.mjs';
import {organizarSequenciasGoogle} from '../src/google-sequencias.mjs';
const T=Date.parse('2026-11-17T10:00:00.000Z'),D='example.com';
function pagina(start=0,{alvo=false,next=null,ms=0,termo='software de agenda',device='computador',pais='br',estado=null}={}){
 const url=new URL(criarLinkGoogle(termo));url.searchParams.set('start',String(start));url.searchParams.set('gl',pais);
 const proxima=new URL(url);if(next!==null)proxima.searchParams.set('start',String(next));
 const html='<div id="rso"><div class="g"><a href="https://rival.com/pagina-'+start+'"><h3>Rival</h3></a></div>'+(alvo?'<div class="g"><a href="https://example.com/"><h3>Alvo</h3></a></div>':'')+'</div>'+(next!==null?'<a id="pnnext" href="'+proxima.href.replace(/&/g,'&amp;')+'">Próxima</a>':'');
 const r=interpretarCapturaGoogle({formato:'visibilidade-google-local',versao:1,metodo:'pagina_aberta',url:url.href,coletadoEm:new Date(T+ms).toISOString(),dispositivo:device,localidadeDeclarada:null,html},{dominio:D,agora:()=>T+ms});
 return{...r,capturaId:'id_'+start+'_'+ms+'_'+device+'_'+pais,...(estado?{estado,resultados:[],encontrados:[],ordemNaPagina:null,totalLinksReconhecidos:0,proximaPagina:null}:{})};
}
test('encadeia próxima página preservada e encontra o alvo sem converter start em ranking',()=>{
 const a=pagina(0,{next:20}),b=pagina(20,{alvo:true,ms:30000});const [s]=organizarSequenciasGoogle([b,a]);
 assert.equal(s.paginasEncadeadas,2);assert.equal(s.estado,'site_observado_na_sequencia');assert.equal(s.primeiroEncontroNaSequencia.inicioSolicitado,20);assert.equal(s.primeiroEncontroNaSequencia.ordemNaPagina,2);assert.equal(s.posicaoGoogle,null);assert.equal(s.contextoEfetivoConfirmado,false);assert.equal(s.termino,'sem_proxima_identificada');
});
test('página intermediária faltante aparece como lacuna, sem colar capturas avulsas',()=>{
 const [s]=organizarSequenciasGoogle([pagina(0,{next:10}),pagina(20,{alvo:true,ms:1000})]);assert.equal(s.paginasEncadeadas,1);assert.equal(s.lacunas.length,1);assert.equal(s.paginasForaDaSequencia.length,1);assert.equal(s.estado,'site_observado_fora_da_sequencia');assert.equal(s.primeiroEncontroNaSequencia,null);assert.equal(s.proximaAcao,'capturar_proxima_pagina');
});
test('começar além da primeira página não estabelece sequência desde o início',()=>{
 const [s]=organizarSequenciasGoogle([pagina(30,{alvo:true})]);assert.equal(s.paginasEncadeadas,0);assert.equal(s.proximaAcao,'capturar_primeira_pagina');assert.equal(s.encontros[0].naSequenciaDesdePrimeira,false);assert.equal(s.posicaoGoogle,null);
});
test('país, dispositivo, expressão e janela de coleta diferentes ficam separados',()=>{
 const itens=[pagina(),pagina(10,{device:'celular'}),pagina(20,{pais:'pt'}),pagina(30,{termo:'agenda empresarial'}),pagina(40,{ms:900001})];assert.equal(organizarSequenciasGoogle(itens).length,5);
});
test('captura recente bloqueada substitui a antiga da mesma página sem fabricar ausência',()=>{
 const [s]=organizarSequenciasGoogle([pagina(0,{alvo:true}),pagina(0,{ms:1000,estado:'interrompida'})]);assert.equal(s.repeticoes.length,1);assert.equal(s.estado,'requer_conferencia');assert.equal(s.encontros.length,0);assert.equal(s.termino,'pagina_requer_conferencia');assert.equal(s.primeiroEncontroNaSequencia,null);
});
test('capturas conflitantes no mesmo horário não recebem desempate de posição',()=>{
 const a=pagina(0,{alvo:true}),b={...pagina(0),capturaId:'outro'};const [s]=organizarSequenciasGoogle([a,b]);assert.equal(s.conflitos.length,1);assert.equal(s.estado,'requer_conferencia');assert.equal(s.primeiroEncontroNaSequencia,null);assert.equal(s.paginas[0].ordemNaPagina,null);
});
test('links repetidos entre páginas são expostos sem somar ordens',()=>{
 const a=pagina(0,{alvo:true,next:10}),b=pagina(10,{alvo:true,ms:1000});const [s]=organizarSequenciasGoogle([a,b]);assert.equal(s.linksEmMaisDeUmaPagina.length,1);assert.equal(s.encontros.length,2);assert.equal(s.posicaoGoogle,null);
});
test('ordem de importação e repetição do mesmo ID não alteram resultado nem fontes',()=>{
 const a=pagina(0,{next:10}),b=pagina(10,{ms:1000}),before=structuredClone([a,b]);assert.deepEqual(organizarSequenciasGoogle([a,b,a]),organizarSequenciasGoogle([b,a]));assert.deepEqual([a,b],before);
});
test('ausência no recorte e coleta histórica preservam seus limites',()=>{
 const a=pagina();a.atual=false;const [s]=organizarSequenciasGoogle([a]);assert.equal(s.recente,false);assert.equal(s.estado,'site_nao_observado_no_recorte');assert.ok(s.limites.some(l=>l.includes('não é ausência no Google')));assert.equal(s.posicaoGoogle,null);
});
test('parser antigo e data inválida não entram em sequência atual',()=>{
 assert.deepEqual(organizarSequenciasGoogle([{...pagina(),parserVersao:0},{...pagina(),coletadoEm:'inválido'}]),[]);
});
test('resumo do projeto integra sequências sem alterar fila ou medições de posições',()=>{
 const c=[pagina(0,{next:10}),pagina(10,{alvo:true,ms:1000})],r=resumirCapturasGoogle(c,{dominio:D,candidatos:[{termo:c[0].termo}],agora:()=>T+1000});assert.equal(r.sequencias.length,1);assert.equal(r.fila.length,1);assert.equal(r.posicaoGoogle,null);assert.ok(r.capturas.every(x=>x.posicaoGoogle===null));
});

function paginaDominios(start=0,{alvo=false,next=null,ms=0}={}){
 const url=new URL(criarLinkGoogle('software de agenda'));url.searchParams.set('start',String(start));const prox=new URL(url);if(next!==null)prox.searchParams.set('start',String(next));const dominio=alvo?'example.com':'rival.com';
 const html='<div id="rso"><div class="g"><a href="https://www.google.com/goto?url=OPACO"><h3>Resultado web</h3><cite>https://'+dominio+'</cite></a></div></div>'+(next!==null?'<a id="pnnext" href="'+prox.href.replace(/&/g,'&amp;')+'">Próxima</a>':'');
 return{...interpretarCapturaGoogle({formato:'visibilidade-google-local',versao:1,metodo:'pagina_aberta',url:url.href,coletadoEm:new Date(T+ms).toISOString(),dispositivo:'computador',localidadeDeclarada:null,html},{dominio:D,agora:()=>T+ms}),capturaId:'dom_'+start+'_'+ms+'_'+alvo};
}

test('paginas com dominios exibidos encadeiam pelo proximo link sem criar URL ou posicao',()=>{
 const a=paginaDominios(0,{next:10}),b=paginaDominios(10,{alvo:true,ms:1000}),antes=structuredClone([a,b]),[s]=organizarSequenciasGoogle([b,a]);assert.equal(s.paginasEncadeadas,2);assert.equal(s.estado,'dominio_exibido_na_sequencia');assert.equal(s.paginasComDominiosExibidos,2);assert.equal(s.paginasReconhecidas,0);assert.deepEqual(s.encontros,[]);assert.equal(s.encontrosDominiosExibidos.length,1);assert.equal(s.encontrosDominiosExibidos[0].ordemBloco,1);assert.equal(s.encontrosDominiosExibidos[0].urlDestino,null);assert.equal(s.encontrosDominiosExibidos[0].posicaoGoogle,null);assert.equal(s.posicaoGoogle,null);assert.deepEqual([a,b],antes);
});

test('sequencia mista preserva encontro por URL separado do dominio da primeira pagina',()=>{
 const [s]=organizarSequenciasGoogle([paginaDominios(0,{alvo:true,next:10}),pagina(10,{alvo:true,ms:1000})]);assert.equal(s.paginasEncadeadas,2);assert.equal(s.estado,'site_observado_na_sequencia');assert.equal(s.encontros.length,1);assert.equal(s.encontros[0].inicioSolicitado,10);assert.equal(s.encontros[0].ordemNaPagina,2);assert.equal(s.encontrosDominiosExibidos[0].inicioSolicitado,0);assert.equal(s.primeiroDominioExibidoNaSequencia.ordemBloco,1);assert.equal(s.posicaoGoogle,null);
});

test('conflito de dominios na mesma pagina e horario nao escolhe um alvo',()=>{
 const [s]=organizarSequenciasGoogle([paginaDominios(0,{alvo:true}),paginaDominios()]);assert.equal(s.conflitos.length,1);assert.equal(s.estado,'requer_conferencia');assert.deepEqual(s.encontrosDominiosExibidos,[]);assert.equal(s.paginas[0].ordemDominioExibido,null);assert.equal(s.primeiroDominioExibidoNaSequencia,null);
});

test('dominio em pagina avulsa continua sem sequencia e sem posicao absoluta',()=>{
 const [s]=organizarSequenciasGoogle([paginaDominios(30,{alvo:true})]);assert.equal(s.paginasEncadeadas,0);assert.equal(s.estado,'dominio_exibido_fora_da_sequencia');assert.equal(s.encontrosDominiosExibidos[0].naSequenciaDesdePrimeira,false);assert.equal(s.proximaAcao,'capturar_primeira_pagina');assert.equal(s.posicaoGoogle,null);
});

test('dominios de outros sites nao demonstram ausencia do alvo nem continuidade por start',()=>{
 const [s]=organizarSequenciasGoogle([paginaDominios(0,{next:20}),paginaDominios(10,{ms:1000})]);assert.equal(s.estado,'alvo_nao_identificado_nas_observacoes');assert.equal(s.paginasEncadeadas,1);assert.equal(s.lacunas.length,1);assert.equal(s.paginasForaDaSequencia.length,1);assert.equal(s.proximaAcao,'capturar_proxima_pagina');assert.equal(s.posicaoGoogle,null);
});
