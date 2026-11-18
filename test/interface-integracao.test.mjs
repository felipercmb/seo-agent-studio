import{test}from'node:test';import assert from'node:assert/strict';import{prepararDecisaoPublicada}from'../src/modulos/decisoes-publicadas.mjs';import{conferirVinculoResposta}from'../src/modulos/entregaveis-prioridades.mjs';
const U='https://rotas-integracao.com.br/mensagens',T='2026-11-17T13:00:00Z',H='a'.repeat(64),o={id:'a',nome:'Plataforma de mensagens',url:U,jornada:{objetivo:'Comparar uso pela plataforma e integração ao sistema por API.'}},f={url:U,sha256:H,coletadoEm:T,recortado:false,campo:'p',classePagina:'institucional',secao:'Recursos da plataforma de mensagens',trecho:'Envie mensagens pela nossa plataforma ou faça uma integração simples com o seu sistema. Utilize API para mensagens convencionais e transacionais.'};
const run=(fs=[f],offer=o)=>prepararDecisaoPublicada({id:'t'},{oferta:offer,ofertas:[offer],fontes:fs,validarVinculo:conferirVinculoResposta,agora:()=>Date.parse(T)+1000});
test('uma escolha explícita produz dois casos com a fonte inteira e requisitos não confirmados',()=>{
 const r=run(),d=r.decisao.decisaoPreparada;assert.equal(d.tipo,'comparar_interface_e_integracao');assert.equal(d.casos.length,2);assert.ok(d.alternativas.every(a=>a.fonte.trecho===f.trecho));assert.equal(d.confirmacaoRealCliente,false);assert.equal(d.casos[1].dadosEntrada.integracaoDisponivelConfirmada,false);assert.ok(d.casos[1].esperado.justificativa.includes('compatibilidade'));
});
test('uma menção solta, negação, convite comercial ou documento recortado não cria rotas',()=>{
 for(const changed of [{trecho:'A API permite consultar os pedidos da plataforma.'},{trecho:'Não envie mensagens pela nossa plataforma ou faça uma integração. A API não está disponível.'},{trecho:'Envie mensagens pela plataforma ou fale com a equipe comercial para conhecer a API.'},{recortado:true},{classePagina:'politica'}])assert.equal(run([{...f,...changed}]),null);
});
test('sem objetivo de comparar canais ou com duas respostas diferentes de mesmo apoio, a escolha fica pendente',()=>{
 assert.equal(run([f],{...o,jornada:{objetivo:'Conferir o prazo de resposta comercial.'}}),null);
 assert.equal(run([f,{...f,trecho:'Envie dados pela nossa plataforma ou realize a integração no seu sistema. Utilize API para dados convencionais e transacionais.'}]),null);
});
test('captura antiga que marcou um nome de produto como contato não redireciona a decisão',()=>{
 const r=prepararDecisaoPublicada({id:'t'},{oferta:o,ofertas:[o],fontes:[f],interacoes:[{tipo:'link',acao:'contatar',rotulo:'Produto WhatsApp',url:U,sha256:H,htmlInicial:true,modo:'nao_preenchido'}],validarVinculo:conferirVinculoResposta,agora:()=>Date.parse(T)+1000});
 assert.equal(r.decisao.decisaoPreparada.proximoPasso.tipo,'consulta_de_bloco_publicado');assert.ok(!r.decisao.decisaoPreparada.proximoPasso.descricao.includes('Produto WhatsApp'));
});
