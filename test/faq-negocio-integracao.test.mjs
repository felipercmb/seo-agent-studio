import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extrairContextoPublico} from '../src/modulos/contexto-publico.mjs';
import {extrairFontesNegocio as v4} from '../ia/negocio/fontes-v4.mjs';
import {extrairFontesNegocio as v5} from '../ia/negocio/fontes-v5.mjs';
import {prepararJornadas} from '../ia/negocio/jornadas/preparar.mjs';
import {construirPrioridades} from '../src/modulos/prioridades-local.mjs';
const D='empresa-exemplo.com.br',URL='https://'+D+'/',T=Date.parse('2026-11-17T10:00:00.000Z');
function captura({nome='Suite Agenda',pergunta=null,resposta='A Suite Agenda permite que a equipe do cliente configure os acessos e organize seus compromissos.',extra='',body=true}={}){
 const faq={'@context':'https://schema.org','@type':'FAQPage',mainEntity:[{'@type':'Question',name:pergunta||'Quem configura os acessos da '+nome+'?',acceptedAnswer:{'@type':'Answer',text:resposta}}]};
 const html='<html><head><title>Suite Agenda</title><script type="application/ld+json">'+JSON.stringify(faq)+'</script></head><body>'+(body?'<h1>Suite Agenda</h1><p>Publicamos o software de agenda para equipes de empresas.</p>':'')+extra+'</body></html>';
 return{dominio:D,coletadoEm:new Date(T-10000).toISOString(),paginas:[{url:URL,status:200,html,sha256:createHash('sha256').update(html).digest('hex')}]};
}
function projeto(c){return{dominio:D,perfil:{estado:'confirmado',ofertas:[{id:'agenda',nome:'Suite Agenda',url:URL,jornada:{natureza:'declaracao_usuario',comprador:'Gestor da equipe',executor:'Equipe do cliente que configura os acessos',beneficiario:'Equipe do cliente',objetivo:'Conferir a configuração dos acessos na Suite Agenda.'}}]},palavras:{candidatos:[]},contextoPublico:extrairContextoPublico(c),oportunidades:{planoDeAcao:[]}};}

test('FAQ entra no contexto e no pool neural com campo próprio e ator preservado',()=>{
 const c=captura(),ctx=extrairContextoPublico(c),pool=v5(c),f=pool.fontes.find(f=>f.campo.includes('acceptedAnswer'));
 assert.equal(ctx.perguntasPublicadas.length,1);assert.ok(f);assert.equal(f.texto,ctx.perguntasPublicadas[0].trecho);assert.equal(f.contexto.titulos[0].texto,ctx.perguntasPublicadas[0].pergunta);assert.equal(f.projecao.visibilidade,'nao_verificada');assert.ok(prepararJornadas(c).base.fontes.some(f=>f.contexto.campo.includes('acceptedAnswer')));assert.ok(!v4(c).fontes.some(f=>f.campo.includes('acceptedAnswer')));
});
test('fontes sem FAQ nem seção de terceiro conservam a ordem e os bytes V4',()=>{
 const c=captura();c.paginas[0].html='<body><h1>Consulta técnica</h1><p>Prestamos consultoria para empresas mediante contratação.</p></body>';c.paginas[0].sha256=createHash('sha256').update(c.paginas[0].html).digest('hex');assert.deepEqual(v5(c).fontes,v4(c).fontes);
});
test('seção de depoimentos não vira atividade própria, e seção irmã continua disponível',()=>{
 const c=captura({extra:'<section><h2>Depoimentos</h2><p>Nossa equipe fabrica materiais para clientes internacionais.</p></section><section><h2>Serviços publicados</h2><p>Oferecemos acesso ao software para a equipe do cliente.</p></section>'}),p=v5(c);
 assert.ok(p.atribuicao.descartes.length>0);assert.ok(!p.fontes.some(f=>f.texto.includes('fabrica materiais')));assert.ok(p.fontes.some(f=>f.texto.includes('Oferecemos acesso')));assert.ok(v4(c).fontes.some(f=>f.texto.includes('fabrica materiais')));
});
test('resposta existente gera conferência específica, preserva executor e não presume edição',()=>{
 const c=captura(),p=projeto(c),r=construirPrioridades(p,{agora:()=>T}),t=r.tarefasDisponiveis.find(t=>t.tipo==='conferir_resposta_existente');
 assert.ok(t);assert.equal(t.decisao.perguntaPublicada,p.contextoPublico.perguntasPublicadas[0].pergunta);assert.equal(t.decisao.respostaInteira.trecho,p.contextoPublico.perguntasPublicadas[0].trecho);assert.equal(t.decisao.visibilidadeConfirmada,false);assert.equal(t.decisao.edicaoNecessaria,null);assert.ok(t.acao.includes('equipe do cliente'));assert.ok(!t.modeloEntregavel);assert.match(t.passos.at(-1),/Preserve o conteúdo/);
});
test('FAQ de oferta vizinha ou de conceito geral não sustenta resposta para a oferta',()=>{
 for(const nome of ['Editor Contratos','sistema de gestão']){
  const p=projeto(captura({nome,resposta:'O Editor Contratos permite configurar documentos da equipe para assinatura.'}));p.perfil.ofertas.push({id:'editor',nome:'Editor Contratos',url:URL,jornada:{}});const r=construirPrioridades(p,{agora:()=>T});assert.ok(!r.tarefasDisponiveis.some(t=>t.tipo==='conferir_resposta_existente'&&t.ofertasAfetadas.some(o=>o.id==='agenda')));
 }
});
test('metadado sem texto visível ainda exige coleta e responsabilidades desconhecidas continuam pendentes',()=>{
 const p=projeto(captura({body:false})),r=construirPrioridades(p,{agora:()=>T});assert.ok(!r.tarefasDisponiveis.some(t=>t.tipo==='conferir_resposta_existente'));assert.ok(r.tarefasDisponiveis.some(t=>t.tipo==='confirmar_jornada'));
 const outro=projeto(captura());outro.perfil.ofertas[0].jornada.executor='';const b=construirPrioridades(outro,{agora:()=>T});assert.ok(!b.tarefasDisponiveis.some(t=>t.tipo==='conferir_resposta_existente'));assert.ok(b.tarefasDisponiveis.find(t=>t.tipo==='confirmar_jornada').camposAConfirmar.includes('quem executa cada rotina'));
});
test('HTML adulterado não cria FAQ ou resposta no pool',()=>{
 const c=captura();c.paginas[0].html+='adulterado';assert.equal(extrairContextoPublico(c).perguntasPublicadas.length,0);assert.equal(v5(c).fontes.length,0);
});
test('resposta ou pergunta além do contrato neural ficam inteiras no contexto e fora da entrada do modelo',()=>{
 for(const c of [captura({resposta:'A Suite Agenda permite organizar os compromissos. '+('Condição completa publicada. ').repeat(24)}),captura({nome:'X'.repeat(235)})]){
  const ctx=extrairContextoPublico(c),pool=v5(c);assert.equal(ctx.perguntasPublicadas.length,1);assert.ok(!pool.fontes.some(f=>f.campo.includes('acceptedAnswer')));assert.equal(pool.atribuicao.descartesFAQNeural.length,1);assert.equal(pool.cobertura.limitada,true);
 }
});
test('FAQ condicional prepara duas declarações fictícias sem concluir elegibilidade',()=>{
 const resposta='A Suite Agenda permite que a equipe configure seus acessos. Para isso, é necessário ter uma conta aprovada pela equipe responsável.';
 const p=projeto(captura({resposta})),r=construirPrioridades(p,{agora:()=>T}),t=r.tarefasDisponiveis.find(t=>t.tipo==='conferir_resposta_existente');assert.ok(t);
 assert.equal(t.decisao.casosDeConferencia.length,2);assert.ok(t.decisao.casosDeConferencia.every(c=>c.natureza==='hipotese_controlada'&&c.condicoesInteiras===resposta&&c.adequacaoConfirmada===false));assert.match(t.passos.join(' '),/Caso fictício A/);assert.match(t.passos.join(' '),/Caso fictício B/);assert.equal(t.decisao.edicaoNecessaria,null);
});

test('regras diferentes por atividade geram duas conferencias com fonte integral sem inventar obrigacao',()=>{
 const resposta='Não. Seu cliente não precisa criar conta para assinar. Conta é só para quem envia.',p=projeto(captura({resposta})),antes=structuredClone(p),r=construirPrioridades(p,{agora:()=>T}),t=r.tarefasDisponiveis.find(t=>t.tipo==='conferir_resposta_existente');
 assert.ok(t);assert.match(t.titulo,/requisitos por atividade/);assert.deepEqual(t.decisao.casosDeConferencia.map(c=>c.atividadeLiteral),['assinar','envia']);
 assert.ok(t.decisao.casosDeConferencia.every(c=>c.condicoesInteiras===resposta&&c.adequacaoConfirmada===false));assert.match(t.passos.join(' '),/frase sozinha não prova essa obrigação/);
 assert.equal(t.modeloEntregavel.tipo,'ficha_de_conferencia_por_atividade');assert.equal(t.modeloEntregavel.campos.filter(c=>c.origem==='trecho_publicado').length,2);assert.ok(t.modeloEntregavel.campos.filter(c=>c.evidencia).every(c=>c.evidencia.trecho===resposta));assert.equal(t.decisao.escopoConfirmado,false);assert.deepEqual(p,antes);
});

test('regras por atividade nao completam a responsabilidade ausente nem liberam casos de contratacao',()=>{
 const p=projeto(captura({resposta:'Não. Seu cliente não precisa criar conta para assinar. Conta é só para quem envia.'}));p.perfil.ofertas[0].jornada.executor='';
 const r=construirPrioridades(p,{agora:()=>T}),t=r.tarefasDisponiveis.find(t=>t.tipo==='confirmar_jornada');assert.ok(t);assert.ok(!r.tarefasDisponiveis.some(t=>t.tipo==='conferir_resposta_existente'));assert.ok(t.camposAConfirmar.includes('quem executa cada rotina'));assert.ok(t.modeloEntregavel.campos.some(c=>/Regra publicada para a atividade/.test(c.rotulo)));assert.match(t.modeloEntregavel.campos.find(c=>c.rotulo==='Resposta ainda necessária').valorSugerido,/quais partes participam/);
});

test('comparacao de atividades na FAQ vizinha nao e promovida a tarefa da oferta alvo',()=>{
 const p=projeto(captura({nome:'Editor Contratos',resposta:'Não. Seu cliente não precisa criar conta para assinar. Conta é só para quem envia.'}));p.perfil.ofertas.push({id:'editor',nome:'Editor Contratos',url:URL,jornada:{}});
 const r=construirPrioridades(p,{agora:()=>T});assert.ok(!r.tarefasDisponiveis.some(t=>t.tipo==='conferir_resposta_existente'&&t.ofertasAfetadas.some(o=>o.id==='agenda')));
});

test('comparacao de atividades apenas em metadado nao confirma a exibicao ou uma tarefa operacional',()=>{
 const p=projeto(captura({body:false,resposta:'Não. Seu cliente não precisa criar conta para assinar. Conta é só para quem envia.'})),r=construirPrioridades(p,{agora:()=>T});assert.ok(!r.tarefasDisponiveis.some(t=>t.tipo==='conferir_resposta_existente'));assert.ok(r.tarefasDisponiveis.some(t=>t.tipo==='confirmar_jornada'));
});

test('FAQ relacionada ao objetivo mas sem nome da oferta gera esclarecimento especifico de escopo',()=>{
 const resposta='Não. Seu cliente não precisa criar conta para assinar. Conta é só para quem envia.',p=projeto(captura({pergunta:'Meu cliente precisa criar conta para assinar?',resposta}));p.perfil.ofertas[0].jornada.objetivo='Conferir a criação de conta para assinar e o que muda para quem envia documentos.';
 const r=construirPrioridades(p,{agora:()=>T}),t=r.tarefasDisponiveis.find(t=>t.tipo==='esclarecer_escopo_resposta');assert.ok(t);assert.equal(t.decisao.escopoConfirmado,false);assert.equal(t.decisao.recomendacaoComercial,false);assert.equal(t.decisao.visibilidadeConfirmada,false);assert.equal(t.decisao.vinculoResposta.motivo,'faq_sem_nome_explicito_da_oferta');assert.equal(t.modeloEntregavel.tipo,'ficha_de_escopo_da_resposta');assert.equal(t.decisao.respostaInteira.trecho,resposta);assert.ok(!r.tarefasDisponiveis.some(t=>t.tipo==='conferir_resposta_existente'));assert.match(t.acao,/não nomeia esta oferta/);
});

test('conta generica ou uma atividade apenas no objetivo nao basta para selecionar a comparacao',()=>{
 for(const objetivo of ['Conferir a conta para usar a Suite Agenda.','Conferir a conta para assinar documentos.']){
  const p=projeto(captura({pergunta:'Meu cliente precisa criar conta para assinar?',resposta:'Não. Seu cliente não precisa criar conta para assinar. Conta é só para quem envia.'}));p.perfil.ofertas[0].jornada.objetivo=objetivo;const r=construirPrioridades(p,{agora:()=>T});assert.ok(!r.tarefasDisponiveis.some(t=>t.tipo==='esclarecer_escopo_resposta'));
 }
});

test('objeto comum das duas atividades nao e contado como duas intencoes distintas',()=>{
 const p=projeto(captura({pergunta:'Preciso de conta para os documentos?',resposta:'Seu cliente não precisa criar conta para assinar documentos. Conta é só para quem envia documentos.'}));p.perfil.ofertas[0].jornada.objetivo='Conferir os documentos publicados.';
 assert.ok(!construirPrioridades(p,{agora:()=>T}).tarefasDisponiveis.some(t=>t.tipo==='esclarecer_escopo_resposta'));
});

test('pool neural duplicado nao apaga pergunta, ponte JSONLD ou tarefa especifica da aplicacao',()=>{
 const c=captura({pergunta:'Meu cliente precisa criar conta para assinar?',resposta:'Não. Seu cliente não precisa criar conta para assinar. Conta é só para quem envia.'}),p=projeto(c);p.evidenciasNegocio={base:{fontes:v5(c).fontes}};p.perfil.ofertas[0].jornada.objetivo='Conferir a conta para assinar e o que muda para quem envia documentos.';
 const t=construirPrioridades(p,{agora:()=>T}).tarefasDisponiveis.find(t=>t.tipo==='esclarecer_escopo_resposta');assert.ok(t);assert.equal(t.decisao.respostaInteira.pergunta,'Meu cliente precisa criar conta para assinar?');assert.ok(t.decisao.respostaInteira.origemEstruturada.respostaPointer);assert.equal(t.decisao.respostaInteira.visibilidade,'nao_verificada');
});

test('marca de recorte em duplicata do pool continua impedindo a tarefa FAQ',()=>{
 const c=captura({resposta:'Não. Seu cliente não precisa criar conta para assinar. Conta é só para quem envia.'}),p=projeto(c),fontes=v5(c).fontes;for(const f of fontes)if(f.campo.includes('acceptedAnswer'))f.recortado=true;p.evidenciasNegocio={base:{fontes}};
 assert.ok(!construirPrioridades(p,{agora:()=>T}).tarefasDisponiveis.some(t=>['conferir_resposta_existente','esclarecer_escopo_resposta'].includes(t.tipo)));
});

test('mesma resposta em perguntas diferentes conserva o escopo da pergunta ate a selecao da tarefa',()=>{
 const c=captura(),html=c.paginas[0].html.replace('"mainEntity":[','"mainEntity":[{"@type":"Question","name":"Quem configura os acessos do Editor Contratos?","acceptedAnswer":{"@type":"Answer","text":"A Suite Agenda permite que a equipe do cliente configure os acessos e organize seus compromissos."}},');c.paginas[0].html=html;c.paginas[0].sha256=createHash('sha256').update(html).digest('hex');const p=projeto(c);p.perfil.ofertas.push({id:'editor',nome:'Editor Contratos',url:URL,jornada:{}});p.evidenciasNegocio={base:{fontes:v5(c).fontes}};
 const t=construirPrioridades(p,{agora:()=>T}).tarefasDisponiveis.find(t=>t.tipo==='conferir_resposta_existente'&&t.ofertasAfetadas.some(o=>o.id==='agenda'));assert.ok(t);assert.equal(t.decisao.perguntaPublicada,'Quem configura os acessos da Suite Agenda?');
});

test('pool de negocio afasta avaliacao com estrelas e preserva a publicacao operacional irma',()=>{
 const c=captura({extra:'<section><p>“⭐⭐⭐⭐⭐ A parceria nos ajudou a fabricar peças para clientes.</p></section><section><h2>Operação da Suite Agenda</h2><p>A Suite Agenda organiza os compromissos cadastrados pela equipe.</p></section>'}),p=v5(c);assert.ok(!p.fontes.some(f=>f.texto.includes('fabricar peças')));assert.ok(p.fontes.some(f=>f.texto.includes('organiza os compromissos')));assert.ok(p.atribuicao.descartes.some(f=>f.motivo==='formato_de_avaliacao_publicada_sem_autoria_verificada'));
});
