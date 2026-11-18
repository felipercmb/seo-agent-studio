import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepararDecisaoPublicada} from '../src/modulos/decisoes-publicadas.mjs';
import {conferirVinculoResposta} from '../src/modulos/entregaveis-prioridades.mjs';
const U='https://modalidades-exemplo.com.br/assinatura',H='a'.repeat(64),T='2026-11-17T13:00:00Z';
const offer={id:'a',nome:'Assinatura de documentos',url:U,jornada:{comprador:'Remetente',executor:'Remetente envia; signatários assinam',beneficiario:'Partes do documento',objetivo:'Comparar as modalidades de assinatura e suas condições.'}};
const fonte=(trecho,secao,extra={})=>({url:U,sha256:H,coletadoEm:T,recortado:false,campo:'p',classePagina:'institucional',trecho,secao,...extra});
const yes=()=>fonte('Cada signatário assina o documento com seu próprio certificado no sistema.','Modalidades / Com certificado digital');
const no=()=>fonte('Os signatários não precisam adquirir certificado digital; o remetente pode definir outras formas de validação.','Modalidades / Sem certificado digital');
function prepare(fs,extra={}){return prepararDecisaoPublicada({id:'preservado',decisao:{}},{oferta:offer,ofertas:[offer],fontes:fs,interacoes:[],cobertura:{paginas:[{url:U,sha256:H}]},validarVinculo:conferirVinculoResposta,agora:()=>Date.parse(T)+1000,...extra});}
test('dois casos concretos conservam recurso, alternativas, condições e papéis a revisar',()=>{
 const a=yes(),b=no(),r=prepare([a,b]),p=r.decisao.decisaoPreparada;assert.equal(p.tipo,'comparar_presenca_de_recurso');assert.equal(r.id,'preservado');assert.equal(p.confirmacaoRealCliente,false);
 assert.deepEqual(p.casos.map(c=>c.dadosEntrada.presencaDeclarada),['com_recurso','sem_recurso']);
 assert.equal(p.alternativas[0].fonte.trecho,a.trecho);assert.equal(p.alternativas[1].fonte.trecho,b.trecho);assert.ok(p.casos.every(c=>c.dadosEntrada.recursoRealConfirmado===false));
 assert.ok(p.casos[1].esperado.justificativa.includes('dispensa de todas as condições'));
});
test('outra captura, página ou seção pai não forma uma escolha por proximidade',()=>{
 for(const changed of [{sha256:'b'.repeat(64)},{url:'https://modalidades-exemplo.com.br/outro'},{secao:'Outro produto / Sem certificado digital'}])assert.equal(prepare([yes(),{...no(),...changed}]),null);
});
test('uma resposta recortada, título vazio de operação ou relato não completa alternativas',()=>{
 for(const changed of [{recortado:true},{campo:'h2'},{trecho:'Uma experiência extraordinária para crescer mais.'},{secao:'Depoimentos / Sem certificado digital'}])assert.equal(prepare([yes(),{...no(),...changed}]),null);
});
test('produto vizinho no corpo é recusado pelo vínculo existente',()=>{
 const other={id:'b',nome:'Módulo Arquivo',url:U};assert.equal(prepare([yes(),{...no(),trecho:'O Módulo Arquivo permite organizar os registros sem certificado digital.'}],{ofertas:[offer,other]}),null);
});
test('duas comparações sem critério distintivo permanecem ambíguas',()=>{
 assert.equal(prepare([yes(),no(),fonte('O operador utiliza um dispositivo para registrar os dados.','Modalidades / Com dispositivo externo'),fonte('O operador registra os dados e não precisa adquirir dispositivo.','Modalidades / Sem dispositivo externo')]),null);
});
test('com e sem desconto não vira escolha operacional nem recomendação de verba',()=>{
 assert.equal(prepare([fonte('O usuário utiliza o plano com condições anunciadas.','Com desconto especial'),fonte('O usuário utiliza o mesmo plano sem condição promocional.','Sem desconto especial')]),null);
});
test('bloco que já mistura os dois rótulos não vira duas rotas independentes',()=>{
 assert.equal(prepare([{...yes(),trecho:'O signatário assina com certificado digital ou Sem certificado digital, dependendo do percurso.'},no()]),null);
});
test('a mesma dupla literal em hierarquias abreviadas e completas conta uma vez',()=>{
 const r=prepare([yes(),no(),{...yes(),secao:'Com certificado digital'},{...no(),secao:'Sem certificado digital'}]);
 assert.equal(r.decisao.decisaoPreparada.tipo,'comparar_presenca_de_recurso');assert.equal(r.decisao.decisaoPreparada.alternativas.length,2);
 assert.ok(r.decisao.decisaoPreparada.alternativas.every(a=>a.fonte.secao.startsWith('Modalidades / ')));
});
test('outra seção com respostas distintas continua ambígua mesmo com os mesmos rótulos',()=>{
 assert.equal(prepare([yes(),no(),{...yes(),secao:'Outro / Com certificado digital',trecho:'O operador assina somente depois que configura uma credencial diferente.'},{...no(),secao:'Outro / Sem certificado digital',trecho:'O operador utiliza outro procedimento e precisa solicitar uma credencial.'}]),null);
});
test('bloco misto não apaga uma dupla de parágrafos completos da mesma captura',()=>{
 const mixed={...yes(),campo:'bloco.titulo-conteudo',trecho:'Com certificado digital o signatário assina o documento, ou Sem certificado digital pode utilizar outro procedimento. Assinatura de documentos tem modalidades para comparar.'};
 const r=prepare([mixed,yes(),no()]);assert.equal(r.decisao.decisaoPreparada.tipo,'comparar_presenca_de_recurso');
 assert.ok(r.decisao.decisaoPreparada.alternativas.every(a=>a.fonte.campo==='p'));
});
test('blocos completos conservam condições adicionais quando contêm a mesma dupla abreviada',()=>{
 const a={...yes(),campo:'bloco.titulo-conteudo',trecho:'Com certificado digital '+yes().trecho+' Credencial individual exigida.'},b={...no(),campo:'bloco.titulo-conteudo',trecho:'Sem certificado digital '+no().trecho+' Confira as formas de verificação.'};
 const r=prepare([a,b,{...yes(),secao:'Com certificado digital'},{...no(),secao:'Sem certificado digital'}]);
 assert.ok(r.decisao.decisaoPreparada.alternativas.every(a=>a.fonte.campo==='bloco.titulo-conteudo'));
 assert.ok(r.decisao.decisaoPreparada.alternativas[0].fonte.trecho.includes('Credencial individual exigida.'));
});
