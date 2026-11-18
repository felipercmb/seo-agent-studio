import {test} from 'node:test';
import assert from 'node:assert/strict';
import {revisarEstruturaProposicao,revisarEstruturaCondicao} from '../src/modulos/estrutura-proposicoes.mjs';
import {revisarEscopoProposicoes} from '../src/modulos/escopo-proposicoes.mjs';
const fonte={id:'s01',texto:'Fonte de teste.',contexto:{url:'https://example.com/oferta',sha256:'a'.repeat(64),classePagina:'institucional'}};
const p=(texto,sujeito,acao,objeto,extra={})=>({id:'p01',sujeito,acao,objeto,unidadeLiteral:{texto},citacoes:[fonte],...extra});

test('reproduz objeto de oferecemos e recurso antes de imperativo sem atribuir executor',()=>{
  const casos=[p('Também oferecemos o App Equipe Escolar, exclusivo para professores e gestores.','App Equipe Escolar','oferecemos','o App Equipe Escolar'),p('API para automações Conecte a Agenda Edu a fluxos automatizados de comunicação.','API','Conecte','fluxos automatizados de comunicação')];
  for(const item of casos){const antes=structuredClone(item),r=revisarEstruturaProposicao(item);assert.equal(r.estado,'requer_revisao_estrutural');assert.deepEqual(item,antes);assert.equal(r.revisaoSemantica,'pendente');}
});

test('fragmento verbal e complemento de finalidade nao sao apresentados como sujeito e acao',()=>{
  const item=p('Se precisar, temos soluções para criação de conteúdo perfeitas para você.','temos soluções','para criação de conteúdo','perfeitas para você');
  const r=revisarEstruturaProposicao(item);assert.ok(r.motivos.includes('fragmento_verbal_no_campo_do_sujeito'));assert.ok(r.motivos.includes('complemento_nominal_no_campo_da_acao'));
});

test('primeira pessoa com sujeito explicito e ferramenta em uso nao sao retipadas',()=>{
  for(const item of [p('Nós oferecemos o serviço.','Nós','oferecemos','o serviço'),p('O checkout aceita Pix.','O checkout','aceita','Pix',{tipoSujeito:'ferramenta',escopo:'uso'}),p('A equipe instala o sistema.','A equipe','instala','o sistema')])assert.equal(revisarEstruturaProposicao(item).estado,'sem_indicio_local');
  const r=revisarEstruturaProposicao(p('O checkout aceita Pix.','O checkout','aceita','Pix',{tipoSujeito:'ferramenta',escopo:'fornecimento'}));assert.ok(r.motivos.includes('funcao_de_pagamento_confundida_com_fornecimento'));
});

test('triagem retira somente da vista revisada o papel estruturalmente pendente e suas dependencias',()=>{
  const item=p('API para automações Conecte a Agenda a fluxos automatizados.','API','Conecte','fluxos automatizados');
  const original={versao:3,dominio:'example.com',ofertas:[{nome:'Agenda',fonteNome:'s01',citacoes:[fonte],jornada:{proposicoes:[item],executores:[{grupo:'API',proposicoes:['p01']}],condicoes:[]}}]};
  const antes=structuredClone(original),r=revisarEscopoProposicoes(original);assert.equal(r.resultadoTriado.ofertas[0].jornada.proposicoes.length,0);assert.equal(r.resultadoTriado.ofertas[0].jornada.executores.length,0);assert.deepEqual(original,antes);assert.equal(r.pendencias.length,2);assert.ok(r.pendencias.every(x=>x.conferenciaEstrutural&&x.explicacao.includes('instrução')));assert.equal(r.resultadoOriginalPreservado,true);
});

test('prazo de suporte fica com escopo pendente sem alterar um servico cujo objeto e suporte',()=>{
  const c={categoria:'prazo',aplicaA:'suporte técnico',alcance:'oferta'};
  assert.equal(revisarEstruturaCondicao(c,{nome:'ERP',natureza:'software'}).estado,'requer_revisao_estrutural');
  assert.equal(revisarEstruturaCondicao({...c,alcance:'suporte'},{nome:'ERP',natureza:'software'}).estado,'sem_indicio_local');
  assert.equal(revisarEstruturaCondicao(c,{nome:'Suporte técnico',natureza:'servico'}).estado,'sem_indicio_local');
});

test('falta de indicador ou de unidade nao e aprovacao semantica',()=>{
  assert.equal(revisarEstruturaProposicao({sujeito:'API',acao:'Conecte'}).estado,'sem_unidade_para_conferencia');
  const r=revisarEstruturaProposicao(p('A ferramenta organiza os pedidos.','A ferramenta','organiza','os pedidos'));assert.equal(r.revisaoSemantica,'pendente');assert.match(r.limite,/não certifica/);
});

test('acao com objeto junto nao contorna a revisao de imperativo ou de primeira pessoa',()=>{
  const a=p('Utilize o App para enviar os documentos.','o App','Utilize o App','os documentos');
  const b=p('Também oferecemos acesso ao sistema.','o sistema','oferecemos acesso','acesso');
  assert.ok(revisarEstruturaProposicao(a).motivos.includes('imperativo_nao_publica_ator_da_operacao'));
  assert.ok(revisarEstruturaProposicao(b).motivos.includes('primeira_pessoa_sem_sujeito_literal_explicito'));
});

test('duracao isolada e frase inteira ficam pendentes sem rejeitar um evento temporal completo',()=>{
  const texto='O LMS será implantado em até 45 dias úteis após o envio dos dados.';
  const c={categoria:'prazo',aplicaA:texto,unidadeLiteral:{texto},gatilho:'até 45 dias úteis',modalidade:'45 dias úteis',alcance:'oferta'},antes=structuredClone(c),r=revisarEstruturaCondicao(c,{nome:'LMS',natureza:'software'});
  assert.deepEqual(r.motivos,['frase_inteira_nao_e_objeto_da_condicao','duracao_nao_e_gatilho','duracao_nao_e_modalidade']);assert.deepEqual(c,antes);
  assert.equal(revisarEstruturaCondicao({...c,aplicaA:'LMS',gatilho:'45 dias após o envio dos dados',modalidade:null},{nome:'LMS',natureza:'software'}).estado,'sem_indicio_local');
});

test('finalidade e complemento de treinamento nao sao retulados como atividade com executor',()=>{
 const casos=[p('A plataforma foi feita para aumentar a participação.','A plataforma','aumentar','a participação'),p('Plataforma brasileira para treinamento e desenvolvimento de pessoas.','Plataforma brasileira','para treinamento e desenvolvimento','de pessoas')];for(const item of casos)assert.equal(revisarEstruturaProposicao(item).estado,'requer_revisao_estrutural');
 assert.equal(revisarEstruturaProposicao(p('A ferramenta organiza os treinamentos.','A ferramenta','organiza','os treinamentos')).estado,'sem_indicio_local');assert.doesNotThrow(()=>revisarEstruturaProposicao(p('Fonte qualquer.','Sistema','(criar','arquivos')));
});

test('prazo para experimentar a oferta nao e transacao do cliente final',()=>{
 const item=p('Depois disso, você terá 14 dias para testar a plataforma, sem informar cartão.','você','terá','14 dias para testar a plataforma',{tipoSujeito:'usuario',escopo:'transacao_do_cliente'});assert.ok(revisarEstruturaProposicao(item).motivos.includes('teste_da_oferta_nao_e_transacao_do_cliente'));assert.equal(revisarEstruturaProposicao({...item,escopo:'contratacao_da_oferta'}).estado,'sem_indicio_local');
});

test('job preservado com avaliacao antiga fica pendente junto das projecoes que dependem dela',()=>{
 const citacao={...fonte,id:'s02',texto:'“⭐⭐⭐⭐⭐ A implementação da Plataforma Aurora representa um avanço para nossa equipe.'},item={...p(citacao.texto,'Plataforma Aurora','representa','um avanço'),citacoes:[citacao]};
 const original={versao:3,dominio:'example.com',ofertas:[{nome:'Aurora',fonteNome:'s01',citacoes:[fonte],jornada:{proposicoes:[item],executores:[{grupo:'Plataforma Aurora',proposicoes:['p01']}],condicoes:[]}}]},antes=structuredClone(original),r=revisarEscopoProposicoes(original);
 assert.equal(r.resultadoTriado.ofertas[0].jornada.proposicoes.length,0);assert.equal(r.resultadoTriado.ofertas[0].jornada.executores.length,0);assert.deepEqual(original,antes);assert.ok(r.pendencias.every(x=>x.motivo==='fonte_de_relato_nao_confirma_operacao'));assert.equal(r.pendencias.find(x=>x.campo==='executores').proposicaoDeApoioPendente,'p01');
});


test('marca antes da virgula introduzida por na nao vira executor do beneficio do pet',()=>{
 const item=p('Na Pet Anjo, seu pet conta com banho e tosa profissional e atendimento veterinário.','Pet Anjo','conta com','banho e tosa profissional e atendimento veterinário',{tipoSujeito:'fornecedor',escopo:'fornecimento'}),antes=structuredClone(item),r=revisarEstruturaProposicao(item);assert.ok(r.motivos.includes('adjunto_inicial_confundido_com_sujeito'));assert.equal(r.estado,'requer_revisao_estrutural');assert.deepEqual(item,antes);assert.match(r.explicacao,/Não substitua o ator automaticamente/);
});

test('meio e destinatario no adjunto ficam pendentes sem rejeitar o sujeito publicado depois dele',()=>{
 for(const item of [p('Com a API, a equipe integra os pedidos.','a API','integra','os pedidos'),p('Para os gestores, o painel organiza as tarefas.','os gestores','organiza','as tarefas')])assert.ok(revisarEstruturaProposicao(item).motivos.includes('adjunto_inicial_confundido_com_sujeito'));
 for(const item of [p('Com a API, a equipe integra os pedidos.','a equipe','integra','os pedidos'),p('A equipe na unidade realiza o atendimento.','A equipe','realiza','o atendimento'),p('Pet Anjo oferece serviços publicados.','Pet Anjo','oferece','serviços publicados')])assert.equal(revisarEstruturaProposicao(item).estado,'sem_indicio_local');
});

test('projecoes apoiadas no adjunto nao sobrevivem na vista revisada e o job original fica inteiro',()=>{
 const item=p('No Portal, a equipe publica os arquivos.','Portal','publica','os arquivos'),job={versao:3,dominio:'example.com',ofertas:[{nome:'Portal',fonteNome:'s01',citacoes:[fonte],jornada:{proposicoes:[item],executores:[{grupo:'Portal',proposicoes:['p01']}],condicoes:[]}}]},antes=structuredClone(job),r=revisarEscopoProposicoes(job);assert.equal(r.resultadoTriado.ofertas[0].jornada.proposicoes.length,0);assert.equal(r.resultadoTriado.ofertas[0].jornada.executores.length,0);assert.equal(r.pendencias.length,2);assert.ok(r.pendencias.every(x=>x.conferenciaEstrutural.motivos.includes('adjunto_inicial_confundido_com_sujeito')));assert.deepEqual(job,antes);
});


test('ideal para em descricao nominal nao vira verbo de prestacao do servico',()=>{
 const item=p('Jadlog.com Ideal para envio rápido de produtos com até 30 kg vendidos pela internet.','Jadlog.com','Ideal','envio rápido de produtos'),antes=structuredClone(item),r=revisarEstruturaProposicao(item);assert.ok(r.motivos.includes('adjetivo_de_finalidade_no_campo_da_acao'));assert.equal(r.estado,'requer_revisao_estrutural');assert.deepEqual(item,antes);assert.equal(r.revisaoSemantica,'pendente');
});

test('forma verbal idealiza e acao diferente no contexto com ideal nao acionam o indicador nominal',()=>{
 for(const item of [p('A equipe idealiza o projeto.','A equipe','idealiza','o projeto'),p('A equipe define o plano ideal para o cliente.','A equipe','define','o plano')])assert.equal(revisarEstruturaProposicao(item).estado,'sem_indicio_local');
});
