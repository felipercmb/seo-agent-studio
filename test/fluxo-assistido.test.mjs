import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {abrirBanco} from '../lib/sqlite.mjs';
import {criarCoordenador} from '../src/modulos/coordenador.mjs';
import {criarWorker} from '../src/worker.mjs';

const DOMINIO = 'cliente.com.br';
const INICIO = Date.parse('2026-11-16T12:00:00.000Z');
const iso = n => new Date(n).toISOString();
const hash = v => createHash('sha256').update(v).digest('hex');
const OFERTAS = [
  ['Contratação de artistas gospel', '/contratacao', 'contratar um artista para o evento'],
  ['Produção de eventos', '/producao', 'organizar a estrutura do evento'],
  ['Consultoria para eventos', '/consultoria', 'definir as etapas do evento'],
];

function ambiente(t, {ia = false} = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'visibilidade-fluxo-assistido-'));
  const arquivo = join(pasta, 'local.sqlite');
  let db = abrirBanco({arquivo}), instante = INICIO, coletas = 0;
  let jobEstado = 'em_execucao';
  const chamadas = {registrar:[], iniciar:[], consultar:[]};
  const env = {DB:db, MODULOS_LOCAIS:true};
  const coletar = async dominio => {
    coletas++;
    const coletadoEm = iso(instante);
    return {dominio, coletadoEm, falhas:[], paginas:OFERTAS.map(([nome, caminho]) => {
      const html = '<html lang="pt-BR"><head><title>' + nome + '</title><meta name="description" content="Assessoria para eventos: confira as etapas e solicite orçamento."></head><body><h1>' + nome + '</h1><p>Atendemos organizadores de eventos e igrejas. Informe a cidade, a data e o tipo de evento para solicitar orçamento.</p><a href="/contato">Solicitar orçamento</a></body></html>';
      return {url:'https://' + dominio + caminho, html, status:200, coletadoEm, sha256:hash(html)};
    })};
  };
  const opcoes = {agora:() => instante, coletar};
  if (ia) Object.assign(opcoes, {
    registrarEvidencias:async coleta => {
      chamadas.registrar.push(structuredClone(coleta));
      return {capturaId:hash(JSON.stringify(coleta)), dominio:coleta.dominio, coletadoEm:coleta.coletadoEm,
        base:{versao:1, dominio:coleta.dominio, fontes:[]}, recuperacao:{fontesRetidas:0}};
    },
    iniciarEntendimento:async entrada => {
      chamadas.iniciar.push(structuredClone(entrada));
      return {id:'job_controlado_01', estado:'em_execucao', criadoEm:iso(instante)};
    },
    consultarEntendimento:async entrada => {
      chamadas.consultar.push(structuredClone(entrada));
      return {id:'job_controlado_01', estado:jobEstado, criadoEm:iso(INICIO),
        ...(jobEstado === 'concluido' ? {resultado:{versao:2, dominio:DOMINIO, perfilConfirmado:false,
          ofertas:[{nome:'Oferta sugerida pelo modelo', natureza:'servico', papel_site:'intermedeia',
            jornada:{compradores:[], executores:[], beneficiarios:[], pagadores:[], condicoes:[],
              duvidas:['Quem contrata precisa ser confirmado.']}}]}} : {})};
    },
  });
  let coordenador = criarCoordenador(opcoes);
  t.after(() => { db.close(); rmSync(pasta, {recursive:true, force:true}); });
  return {env, opcoes, chamadas,
    executar:(acao, extra = {}) => coordenador.executar({site:DOMINIO, acao, ...extra}, env),
    avancar:ms => { instante += ms; }, agora:() => instante,
    concluirIA:() => { jobEstado = 'concluido'; }, falharIA:() => { jobEstado = 'falhou'; },
    coletas:() => coletas,
    payload:async () => (await db.prepare('SELECT payload FROM projetos_modulares WHERE dominio = ?').bind(DOMINIO).first()).payload,
    reabrir() { db.close(); db = abrirBanco({arquivo}); env.DB = db; coordenador = criarCoordenador(opcoes); },
  };
}

function perfilDeclarado({confirmado = true, premissa = true} = {}) {
  return {confirmado, resumo:'Intermediação de artistas e assessoria para eventos, revisada no ensaio local.',
    publico:'Organizadores de eventos e igrejas', regioes:['Brasil'], ofertas:OFERTAS.map(([nome, caminho, objetivo], i) => ({
      nome, url:'https://' + DOMINIO + caminho,
      centralidade:i === 0 ? 'principal' : 'complementar',
      jornada:{comprador:'Organizadores de eventos e igrejas', executor:i === 0 ? 'Artistas parceiros' : 'Equipe de produção',
        beneficiario:'Participantes do evento', pagador:'Contratante do evento', objetivo},
      ...(premissa && i === 0 ? {premissasEconomicas:{versao:1, moeda:'BRL',
        origem:{tipo:'registro_local', referencia:'Resumo fictício local de outubro, versão 1'},
        periodo:{inicio:'2026-10-01', fim:'2026-10-31'},
        coorte:{descricao:'Pedidos distintos de contratação de artistas em outubro', criterioQualificacao:'Cidade, data e interesse confirmados'},
        contribuicaoPorVenda:{tipo:'valor', valor:9321.87}, fechamento:{tipo:'contagem', contatosQualificados:100, fechamentos:20},
        custosAquisicao:{escopo:'total_periodo_coorte', total:{tipo:'valor', valor:731.42}}, custosFixos:null}} : {}),
    }))};
}

async function confirmar(a, p, opcoes) {
  return a.executar('salvar_perfil', {revisao:p.revisao, perfil:perfilDeclarado(opcoes)});
}
function tarefaAtualDaOferta(p) {
  const oferta = p.perfil.ofertas.find(o => o.nome === OFERTAS[0][0]);
  const plano = p.prioridades.tarefasDisponiveis.find(t => t.decisao && t.ofertasAfetadas?.some(o => o.id === oferta?.id));
  assert.ok(plano, 'a oferta precisa de uma ação atual, sem recorrer ao plano legado arquivado');
  return p.tarefas.itens.find(t => t.id === plano.id && !t.arquivada);
}
function atualizar(a, p, tarefa, patch) {
  return a.executar('registrar_tarefa', {revisao:p.revisao, tarefa:{id:tarefa.id, revisao:tarefa.revisao, ...patch}});
}
function fechamento(a, tarefa) {
  return {estado:'concluida', implementadoEm:iso(a.agora() - 1000),
    verificacao:{metodo:'Revisão declarada de responsabilidades e cobertura em cenário fictício, sem enviar o formulário.',
      evidencia:'Duas partes foram revisadas no cenário fictício; o conteúdo operacional renderizado ainda precisa ser confirmado.',
      verificadoEm:iso(a.agora()), url:tarefa.origem.paginaAlvo,
      resultado:'inconclusivo', medida:{indicador:'partes_revisadas', tipo:'numero', valor:2, unidade:'partes'}}};
}
function requisicao(acao, extra = {}) {
  return new Request('http://localhost/api/projeto', {method:'POST',
    headers:{'Content-Type':'application/json', origin:'http://localhost'}, body:JSON.stringify({site:DOMINIO, acao, ...extra})});
}

test('fluxo assistido preserva jornada, premissas e execução após reabrir SQLite, sem inventar posição ou retorno', async t => {
  const a = ambiente(t);
  let p = await a.executar('iniciar');
  assert.equal(p.perfil.estado, 'rascunho');
  p = await confirmar(a, p);
  assert.equal(p.perfil.estado, 'confirmado');
  assert.equal(p.prioridades.prioridades.length, 3);
  assert.equal(new Set(p.prioridades.prioridades.map(x => x.id)).size, 3);
  assert.equal(p.posicoes, null);
  assert.ok(p.oportunidades.itens.every(i => i.observado.posicao === null));
  const oferta = p.perfil.ofertas.find(o => o.nome === OFERTAS[0][0]);
  assert.equal(oferta.jornada.executor, 'Artistas parceiros');
  assert.equal(oferta.jornada.natureza, 'declaracao_usuario');
  const cenario = p.cenariosEconomicos.find(c => c.ofertaId === oferta.id);
  assert.equal(cenario.estado, 'cenario_condicional');
  assert.equal(cenario.contribuicaoPorContatoQualificado.valor, 1864.37);
  assert.equal(cenario.procedencia.verificacao, 'nao_auditada');
  assert.equal(cenario.custos.deduzidos, false);
  assert.equal(Object.hasOwn(cenario, 'roi'), false);
  const pendente = tarefaAtualDaOferta(p);
  assert.ok(pendente, 'a oferta confirmada precisa produzir uma tarefa atual e persistida');
  // This fixture declares actors but publishes no operational flow. In v2 it
  // must clarify the context instead of manufacturing a contracting exercise.
  assert.equal(pendente.origem.tipo, 'confirmar_jornada');
  assert.equal(pendente.origem.paginaAlvo, 'https://' + DOMINIO + OFERTAS[0][1]);
  assert.match(pendente.origem.acao, /etapa operacional inteira/);
  assert.ok(pendente.origem.passos.some(passo => passo.includes(pendente.origem.paginaAlvo)));
  assert.match(pendente.origem.criterioSucesso, /conteúdo renderizado observado/);
  assert.match(pendente.origem.criterioSucesso, /dados ainda desconhecidos/);
  a.avancar(2000);
  p = await atualizar(a, p, pendente, {estado:'em_andamento', responsavel:'Revisor local', nota:'Ensaio de responsabilidades e cobertura'});
  const andamento = p.tarefas.itens.find(x => x.id === pendente.id);
  assert.equal(andamento.estado, 'em_andamento');
  a.avancar(2000);
  p = await atualizar(a, p, andamento, fechamento(a, andamento));
  const final = structuredClone(p);
  a.reabrir();
  const salvo = await a.executar('consultar');
  assert.deepEqual(salvo.perfil, final.perfil);
  assert.deepEqual(salvo.tarefas, final.tarefas);
  assert.deepEqual(salvo.cenariosEconomicos, final.cenariosEconomicos);
  const concluida = salvo.tarefas.itens.find(x => x.id === pendente.id);
  assert.equal(concluida.verificacao.natureza, 'declarado');
  assert.equal(concluida.verificacao.resultado, 'inconclusivo');
  assert.equal(concluida.verificacao.medida.valor, 2);
  const antes = await a.payload();
  await a.executar('historico');
  await a.executar('consultar');
  const plano = await a.executar('exportar_plano', {revisao:salvo.revisao});
  assert.match(plano.conteudo, /Confirmar uso e responsabilidades antes da avaliação/);
  assert.match(plano.conteudo, /Execução registrada/);
  assert.match(plano.conteudo, /concluida/);
  assert.match(plano.conteudo, /inconclusivo/);
  assert.match(plano.conteudo, /Duas partes foram revisadas no cenário fictício/);
  assert.doesNotMatch(plano.conteudo, /9321[.,]87|1864[.,]37|731[.,]42/);
  assert.equal(await a.payload(), antes, 'leituras e exportação não podem regravar estado ou histórico');
  assert.equal(a.coletas(), 1, 'acompanhar e exportar não fazem nova coleta');
});

test('rascunho preserva jornada e números, mas exige confirmação antes do cenário e da tarefa de jornada', async t => {
  const a = ambiente(t), inicial = await a.executar('iniciar');
  const p = await confirmar(a, inicial, {confirmado:false});
  assert.equal(p.perfil.estado, 'rascunho');
  assert.equal(p.perfil.ofertas[0].jornada.comprador, 'Organizadores de eventos e igrejas');
  assert.equal(p.prioridades.estado, 'aguardando_confirmacao');
  assert.ok(p.prioridades.tarefasDisponiveis.every(tarefa => !tarefa.decisao), 'rascunho não cria uma decisão assistida confirmada');
  const cenario = p.cenariosEconomicos.find(c => c.nome === OFERTAS[0][0]);
  assert.equal(cenario.contribuicaoPorContatoQualificado, null);
  assert.ok(cenario.faltam.includes('perfilConfirmado'));
});

test('API devolve 409 para revisão antiga de projeto e de tarefa e preserva a edição já salva', async t => {
  const a = ambiente(t), inicial = await a.executar('iniciar');
  let p = await confirmar(a, inicial), tarefa = tarefaAtualDaOferta(p);
  const worker = criarWorker('portal', {...a.opcoes, htmlProjeto:'projeto de teste'});
  const revisaoProjeto = p.revisao, revisaoTarefa = tarefa.revisao;
  a.avancar(1000);
  p = await atualizar(a, p, tarefa, {estado:'em_andamento', responsavel:'Primeiro revisor'});
  const antes = await a.payload();
  const projetoAntigo = await worker.fetch(requisicao('registrar_tarefa', {revisao:revisaoProjeto,
    tarefa:{id:tarefa.id, revisao:revisaoTarefa, nota:'Sobrescrita indevida'}}), a.env);
  assert.equal(projetoAntigo.status, 409);
  const tarefaAntiga = await worker.fetch(requisicao('registrar_tarefa', {revisao:p.revisao,
    tarefa:{id:tarefa.id, revisao:revisaoTarefa, nota:'Outra sobrescrita indevida'}}), a.env);
  assert.equal(tarefaAntiga.status, 409);
  assert.equal(await a.payload(), antes);
  tarefa = (await a.executar('consultar')).tarefas.itens.find(t => t.id === tarefa.id);
  assert.equal(tarefa.responsavel, 'Primeiro revisor');
  assert.equal(tarefa.nota, '');
});

test('premissas inválidas e jornada com origem forjada são recusadas sem salvar perfil parcial', async t => {
  const a = ambiente(t), inicial = await a.executar('iniciar'), p = await confirmar(a, inicial);
  const worker = criarWorker('portal', {...a.opcoes, htmlProjeto:'projeto de teste'});
  const antes = await a.payload();
  for (const adulterar of [
    perfil => { perfil.ofertas[0].premissasEconomicas.fechamento.fechamentos = 101; },
    perfil => { perfil.ofertas[0].premissasEconomicas.periodo.fim = '2026-02-30'; },
    perfil => { perfil.ofertas[0].jornada.natureza = 'observado'; },
  ]) {
    const perfil = perfilDeclarado(); adulterar(perfil);
    const resposta = await worker.fetch(requisicao('salvar_perfil', {revisao:p.revisao, perfil}), a.env);
    assert.equal(resposta.status, 400);
    assert.equal(await a.payload(), antes);
  }
  assert.equal((await a.executar('consultar')).revisao, p.revisao);
});

test('conclusão sem comprovação declarada é recusada e conclusão inconclusiva não vira sucesso', async t => {
  const a = ambiente(t), inicial = await a.executar('iniciar');
  let p = await confirmar(a, inicial), tarefa = tarefaAtualDaOferta(p);
  const antes = await a.payload();
  await assert.rejects(atualizar(a, p, tarefa, {estado:'concluida'}), e => e.status === 400);
  assert.equal(await a.payload(), antes);
  a.avancar(2000);
  p = await atualizar(a, p, tarefa, fechamento(a, tarefa));
  tarefa = p.tarefas.itens.find(t => t.id === tarefa.id);
  assert.equal(tarefa.estado, 'concluida');
  assert.equal(tarefa.verificacao.resultado, 'inconclusivo');
  assert.ok(p.oportunidades.itens.every(i => i.observado.posicao === null));
  assert.equal(p.posicoes, null);
});

test('alterar somente o resumo preserva premissas e conclusão sem adicionar eventos às tarefas', async t => {
  const a = ambiente(t), inicial = await a.executar('iniciar');
  let p = await confirmar(a, inicial), tarefa = tarefaAtualDaOferta(p);
  a.avancar(2000); p = await atualizar(a, p, tarefa, fechamento(a, tarefa));
  const antes = structuredClone(p);
  a.avancar(1000);
  p = await a.executar('salvar_perfil', {revisao:p.revisao, perfil:{confirmado:true, resumo:'Descrição atualizada pelo responsável, mantendo as mesmas ofertas.'}});
  assert.deepEqual(p.tarefas, antes.tarefas);
  assert.deepEqual(p.perfil.ofertas, antes.perfil.ofertas);
  assert.deepEqual(p.cenariosEconomicos, antes.cenariosEconomicos);
  assert.equal(p.historico.length, antes.historico.length + 1);
});

test('IA assíncrona usa captura pública, não muda revisão enquanto pendente e não sobrescreve perfil confirmado', async t => {
  const a = ambiente(t, {ia:true}), inicial = await a.executar('iniciar');
  let p = await confirmar(a, inicial);
  const perfil = structuredClone(p.perfil);
  p = await a.executar('experimentar_entendimento', {revisao:p.revisao});
  assert.equal(p.entendimentoNovo.estado, 'em_execucao');
  assert.equal(a.chamadas.iniciar.length, 1);
  assert.deepEqual(Object.keys(a.chamadas.iniciar[0]).sort(), ['capturaId','dominio']);
  assert.equal(a.chamadas.iniciar[0].capturaId, p.evidenciasNegocio.capturaId);
  assert.doesNotMatch(JSON.stringify(a.chamadas), /9321[.,]87|731[.,]42|Resumo fictício local/);
  const pendente = structuredClone(p), persistido = await a.payload();
  for (let i = 0; i < 3; i++) {
    a.avancar(1000); p = await a.executar('consultar_entendimento', {revisao:p.revisao});
    assert.equal(p.revisao, pendente.revisao);
    assert.deepEqual(p.historico, pendente.historico);
    assert.equal(await a.payload(), persistido);
  }
  a.concluirIA(); a.avancar(1000);
  p = await a.executar('consultar_entendimento', {revisao:p.revisao});
  assert.equal(p.revisao, pendente.revisao + 1);
  assert.equal(p.entendimentoNovo.estado, 'concluido');
  assert.equal(p.entendimentoNovo.perfilConfirmado, false);
  assert.equal(p.entendimentoNovo.fonteHistorica, false);
  assert.deepEqual(p.perfil, perfil);
  assert.deepEqual(p.tarefas, pendente.tarefas);
  const pronto = await a.payload();
  const repetido = await a.executar('consultar_entendimento', {revisao:p.revisao});
  assert.equal(repetido.revisao, p.revisao);
  assert.equal(await a.payload(), pronto);
  a.reabrir();
  assert.deepEqual((await a.executar('consultar')).entendimentoNovo, p.entendimentoNovo);
});

test('nova captura torna o entendimento anterior histórico, preservando correção do usuário e evidência original', async t => {
  const a = ambiente(t, {ia:true}), inicial = await a.executar('iniciar');
  let p = await confirmar(a, inicial);
  p = await a.executar('experimentar_entendimento', {revisao:p.revisao});
  a.concluirIA(); a.avancar(1000);
  p = await a.executar('consultar_entendimento', {revisao:p.revisao});
  const perfil = structuredClone(p.perfil), origemIA = p.entendimentoNovo.capturaId;
  a.avancar(61000);
  p = await a.executar('reler_site', {revisao:p.revisao});
  assert.notEqual(p.evidenciasNegocio.capturaId, origemIA);
  assert.equal(p.entendimentoNovo.capturaId, origemIA);
  assert.equal(p.entendimentoNovo.fonteHistorica, true);
  assert.deepEqual(p.perfil, perfil);
  assert.equal(a.chamadas.iniciar.length, 1);
  a.reabrir();
  assert.equal((await a.executar('consultar')).entendimentoNovo.fonteHistorica, true);
});

test('falha do processo de IA é registrada uma vez e preserva o trabalho assistido', async t => {
  const a = ambiente(t, {ia:true}), inicial = await a.executar('iniciar');
  let p = await confirmar(a, inicial);
  p = await a.executar('experimentar_entendimento', {revisao:p.revisao});
  const perfil = structuredClone(p.perfil), tarefas = structuredClone(p.tarefas), revisao = p.revisao;
  a.falharIA(); a.avancar(1000);
  p = await a.executar('consultar_entendimento', {revisao:p.revisao});
  assert.equal(p.entendimentoNovo.estado, 'falhou');
  assert.equal(p.revisao, revisao + 1);
  assert.deepEqual(p.perfil, perfil); assert.deepEqual(p.tarefas, tarefas);
  const antes = await a.payload();
  await a.executar('consultar_entendimento', {revisao:p.revisao});
  assert.equal(await a.payload(), antes);
});

test('cenário revisado por oferta não recebe recomendação financeira contraditória do campo legado', async t => {
  const a = ambiente(t), inicial = await a.executar('iniciar');
  const perfil = perfilDeclarado();
  perfil.ofertas[0].economia = {contribuicaoPorVenda:-100, taxaFechamento:.25};
  const p = await a.executar('salvar_perfil', {revisao:inicial.revisao, perfil});
  const cenario = p.cenariosEconomicos.find(c => c.nome === OFERTAS[0][0]);
  assert.equal(cenario.estado, 'cenario_condicional');
  assert.equal(cenario.contribuicaoPorContatoQualificado.valor, 1864.37);
  const itens = p.oportunidades.itens.filter(i => i.ofertaId === cenario.ofertaId);
  assert.ok(itens.length > 0);
  assert.ok(itens.every(i => i.valorPorContato === null), 'cenário v1 fica por oferta e não é atribuído a cada busca');
  assert.ok(itens.every(i => i.proximoTeste?.tipo !== 'validar_economia'), 'o valor legado negativo não pode orientar a recomendação desta oferta');
  assert.ok(itens.every(i => !/produzem contribuição por contato negativa/.test(i.motivo)));
});
