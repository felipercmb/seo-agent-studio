import test from 'node:test';
import assert from 'node:assert/strict';
import {construirPrioridades} from '../src/modulos/prioridades-local.mjs';
import {refinarPlanoAssistido} from '../src/modulos/prioridades-assistidas.mjs';
const D='controle-local.com.br',U='https://'+D+'/modalidades',H='a'.repeat(64),T=Date.parse('2026-11-17T02:00:00Z');
const oferta=(id,nome)=>({id,nome,url:U,centralidade:{nivel:'principal',natureza:'declaracao_usuario'},jornada:{natureza:'declaracao_usuario',comprador:'Pessoa que avalia a modalidade',executor:'Equipe da organização usuária',beneficiario:'Pessoas usuárias da equipe',objetivo:'Conferir cadastro, acesso, custos e registros antes de solicitar a modalidade.'},evidencias:[]});
const a=()=>oferta('a','Plano Alfa'),b=()=>oferta('b','Plano Beta');
const fonte=(id,texto,secao)=>({id,texto,tipo:'declaracao',contexto:{paginaId:'pag_'+H.slice(0,20),url:U,tituloPagina:'Modalidades',titulos:[{nivel:1,texto:'Modalidades'},{nivel:2,texto:secao}],campo:'p',coletadoEm:'2026-11-17T01:00:00Z',sha256:H,recortado:false,classePagina:'institucional'}});
const projeto=(fontes,ofertas=[a(),b()],plano=[])=>({dominio:D,perfil:{estado:'confirmado',ofertas},palavras:{candidatos:[]},oportunidades:{planoDeAcao:plano},evidenciasNegocio:{base:{versao:1,dominio:D,fontes}},contextoPublico:{cobertura:{paginas:[{url:U,sha256:H,htmlInicial:true,caracteresTextoVisivel:1000}]}}});
const executar=p=>construirPrioridades(p,{agora:()=>T});
const daOferta=(t,id)=>t.ofertasAfetadas?.some(o=>o.id===id);
const rotinaAlfa=()=>fonte('s02','O Plano Alfa organiza os acessos e permite até 3 usuários.','Plano Alfa');
const vizinha=()=>fonte('s01','O Plano Beta permite até 40 usuários e organiza cadastro, acesso, custos e registros.','Plano Alfa');

test('todos os vínculos recusados viram pendência com os trechos inteiros, sem prioridade da oferta',()=>{
 const f=vizinha(),p=projeto([f]),antes=structuredClone(p),r=executar(p);
 assert.deepEqual(p,antes);
 assert.ok(!r.prioridades.some(t=>daOferta(t,'a')&&t.tipo==='conferir_oferta'));
 assert.ok(!r.tarefasDisponiveis.some(t=>daOferta(t,'a')&&t.modeloEntregavel));
 const pend=r.pendenciasDeOferta.find(x=>x.ofertaId==='a');
 assert.equal(pend.estado,'sem_vinculo_sustentado');assert.equal(pend.recomendacaoComercial,false);
 assert.equal(pend.fontesRecusadas[0].trecho,f.texto);assert.equal(pend.fontesRecusadas[0].sha256,H);
 assert.equal(pend.fontesRecusadas[0].vinculoResposta.motivo,'outro_objeto_nomeado_no_corpo');
 assert.ok(r.diagnosticoDeRegras.some(x=>x.ofertaId==='a'&&x.pendencia?.fontesRecusadas[0].trecho===f.texto));
 assert.ok(r.prioridades.some(t=>daOferta(t,'b')&&t.modeloEntregavel),'A fonte continua legítima para o objeto que ela nomeia.');
});

test('a fonte sustentada vence a vizinha lexicalmente mais parecida sem emprestar limite',()=>{
 const rejeitada=vizinha(),boa=rotinaAlfa(),r=executar(projeto([rejeitada,boa]));
 const t=r.tarefasDisponiveis.find(t=>daOferta(t,'a')&&t.decisao);
 assert.equal(t.decisao.condicaoInteira.trecho,boa.texto);
 assert.deepEqual(t.decisao.casos.map(c=>c.entrada),[3,4]);
 assert.ok(!JSON.stringify(t.modeloEntregavel).includes('40 usuários'));
 assert.equal(r.pendenciasDeOferta.find(x=>x.ofertaId==='a').estado,'vinculos_parciais');
 assert.equal(r.pendenciasDeOferta.find(x=>x.ofertaId==='a').fontesRecusadas[0].trecho,rejeitada.texto);
});

test('catálogo geral sob heading do alvo não cria rascunho comercial na mesma URL',()=>{
 const f=fonte('s01','O aplicativo organiza acessos, cadastro, pagamentos e diversos serviços em um só lugar.','Plano Alfa');
 const r=executar(projeto([f]));
 assert.ok(!r.prioridades.some(t=>daOferta(t,'a')&&t.modeloEntregavel));
 assert.equal(r.pendenciasDeOferta.find(x=>x.ofertaId==='a').fontesRecusadas[0].vinculoResposta.motivo,'catalogo_geral_sem_nome_da_oferta');
});

test('publicação legítima conserva hipótese, condição literal e dados reais desconhecidos',()=>{
 const f=rotinaAlfa(),r=executar(projeto([f])),t=r.prioridades.find(t=>daOferta(t,'a')&&t.modeloEntregavel);
 assert(t);assert.equal(t.base,'hipotese');assert.equal(t.decisao.escopoConfirmado,false);
 assert.equal(t.modeloEntregavel.natureza,'hipotese_editorial');
 assert.ok(t.modeloEntregavel.campos.some(c=>c.valorSugerido===f.texto&&c.origem==='trecho_publicado'));
 assert.ok(t.modeloEntregavel.campos.some(c=>c.origem==='a_confirmar'));
});

test('achado técnico observado permanece quando a oferta perde rascunho sem vínculo',()=>{
 const observado={id:'controle_sem_rotulo',tipo:'corrigir_uso',eixo:'tecnico',base:'observacao',titulo:'Conferir controle sem rótulo',acao:'Conferir o controle capturado.',paginaAlvo:{url:U},ofertasAfetadas:[],passos:['Conferir na mesma página.'],criterioSucesso:'Rótulo observado ou pendente.',evidencias:[{url:U,trecho:'Controle sem texto visível',tipo:'diagnostico'}]};
 const r=executar(projeto([vizinha()],[a(),b()],[observado]));
 assert.ok(r.prioridades.some(t=>t.id===observado.id&&t.base==='observacao'));
 assert.ok(r.tarefasDisponiveis.some(t=>t.id===observado.id));
 assert.ok(!r.prioridades.some(t=>daOferta(t,'a')&&t.modeloEntregavel));
 assert.ok(r.pendenciasDeOferta.some(x=>x.ofertaId==='a'));
});

test('rascunho legado com todos os vínculos recusados permanece apenas no diagnóstico',()=>{
 const f={url:U,trecho:vizinha().texto,sha256:H,campo:'p'},legado={id:'rascunho_legado',tipo:'conferir_oferta',eixo:'negocio',base:'hipotese',titulo:'Rascunho antigo',modeloEntregavel:{campos:[]},evidenciasNegocio:[f],decisao:{entrega:{vinculos:[{fonteId:'origem',sustentado:false,motivo:'outro_objeto_nomeado_no_corpo'}]}}};
 const r=refinarPlanoAssistido({dominio:D,perfil:{estado:'confirmado',ofertas:[]}},{tarefasDisponiveis:[legado]},{agora:()=>T});
 assert.ok(!r.prioridades.some(t=>t.id===legado.id));assert.ok(!r.tarefasDisponiveis.some(t=>t.id===legado.id));
 const d=r.diagnosticoDeRegras.find(x=>x.tarefaId===legado.id);
 assert.equal(d.evidenciasPreservadas[0].trecho,f.trecho);assert.equal(d.vinculos[0].sustentado,false);
});
