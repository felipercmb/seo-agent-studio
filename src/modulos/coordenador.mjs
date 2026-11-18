import {normalizarSite} from '../consulta.mjs';
import {descobrirTermos} from '../descoberta.mjs';
import {analisarPaginas} from '../analise.mjs';
import {criarFranquia} from '../franquia.mjs';
import {inferirPerfil, corrigirPerfil} from './perfil.mjs';
import {gerarPalavras} from './palavras.mjs';
import {normalizarDemanda} from './demanda.mjs';
import {avaliarOportunidades} from './oportunidades.mjs';
import {criarRepositorio, ErroProjeto} from './repositorio.mjs';
import {medirProjeto, identificarPlano} from './medicao.mjs';
import {registrarHistorico} from './acompanhamento.mjs';
import {prepararIAProjeto, registrarIAProjeto, estadoIAProjeto, registrarContextoInsuficiente} from './ia.mjs';
import {extrairContextoPublico} from './contexto-publico.mjs';
import {criarRelatorioCliente} from './relatorio-cliente.mjs';
import {compararRevisaoPerfil} from './revisao-perfil.mjs';
import {construirPrioridades} from './prioridades-local.mjs';
import {sincronizarTarefas,atualizarTarefa} from './tarefas.mjs';
import {calcularCenarioPorContato} from './premissas-economicas.mjs';
import {extrairCondicoesEstruturadas} from './condicoes-estruturadas.mjs';
import {construirMapaInvestigacao} from './mapa-investigacao.mjs';
import {chaveBuscaGoogle, resumirCapturasGoogle} from '../google-local.mjs';
import {vincularObservacoesGoogle} from './recomendacoes-google-local.mjs';
import {revisarEscopoProposicoes} from './escopo-proposicoes.mjs';

const ACOES = new Set(['iniciar', 'consultar', 'salvar_perfil', 'reler_site', 'revisar_leitura', 'medir', 'analisar', 'experimentar_ia', 'experimentar_ia_candidata','experimentar_entendimento','consultar_entendimento','experimentar_proposicoes','consultar_proposicoes','registrar_google_local','registrar_tarefa', 'historico', 'exportar_plano', 'excluir']);
const LEITURAS = new Set(['consultar', 'historico','exportar_plano','revisar_leitura']);
const LIMITES = [
  'O perfil e as sugestões usam regras abertas e precisam da revisão do responsável pelo negócio. Não são uma IA validada para decisões autônomas.',
  'A leitura cobre páginas públicas dentro dos limites exibidos, sem executar JavaScript. Ela não lê todo o site necessariamente.',
  'Sem dados de gastos, conversões e atribuição não é possível afirmar desperdício de anúncios ou retorno financeiro.',
  'As análises e até 24 eventos ficam no banco deste computador. Correções não treinam modelos nem são enviadas a serviços de IA.',
  'O acompanhamento ocorre ao solicitar uma nova análise. Não há tarefas automáticas de coleta em segundo plano.',
  'Nesta versão, as posições usam Google Brasil, português e computador no recorte nacional. As regiões do perfil não alteram automaticamente esse recorte.',
];

function validar(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) || !ACOES.has(entrada.acao)) {
    throw new ErroProjeto('Informe o site e uma ação do projeto.');
  }
  const permitidos = ['site', 'acao', 'revisao', ...(entrada.acao === 'salvar_perfil' ? ['perfil'] : []),...(entrada.acao==='registrar_tarefa'?['tarefa']:[]),...(entrada.acao==='registrar_google_local'?['captura']:[])];
  if (Object.keys(entrada).some(k => !permitidos.includes(k))) throw new ErroProjeto('A consulta contém campos não permitidos.');
  if (entrada.revisao != null && (!Number.isSafeInteger(entrada.revisao) || entrada.revisao < 1)) throw new ErroProjeto('Revisão inválida.');
  if (['salvar_perfil', 'excluir','registrar_tarefa','registrar_google_local'].includes(entrada.acao) && entrada.revisao == null) throw new ErroProjeto('Abra a análise salva antes de editar.');
  return normalizarSite(entrada.site);
}

async function atualizarDerivados(projeto) {
  if (!projeto) return null;
  // Regras podem evoluir entre reinicializações. O plano utilizado na medição
  // deve ser o mesmo apresentado ao abrir o projeto salvo, antes de gastar cota.
  projeto.palavras = gerarPalavras({perfil:projeto.perfil, descoberta:projeto.descoberta});
  if (projeto.posicoes?.planoId && projeto.posicoes.planoId !== await identificarPlano(projeto.palavras)) {
    projeto.posicoes = null;
    const aviso = 'A seleção de buscas mudou com a revisão do perfil ou das regras. O histórico foi preservado; as novas buscas precisam de medição própria.';
    if (!(projeto.avisos || []).includes(aviso)) projeto.avisos = [...(projeto.avisos || []),aviso];
  }
  return projeto;
}

function compor(projeto, agora, capacidades) {
  const demanda = normalizarDemanda(projeto.demanda, {agora});
  const oportunidades = avaliarOportunidades({...projeto, demanda, capacidades}, {agora});
  const googleLocal = resumirCapturasGoogle(projeto.capturasGoogleLocais,
    {dominio:projeto.dominio, candidatos:projeto.palavras.candidatos, agora});
  const planoBase = construirPrioridades({...projeto, oportunidades}, {agora});
  const {plano:prioridades, tarefas, porTermo} = vincularObservacoesGoogle(
    {...projeto, googleLocal}, planoBase, {agora});
  if (porTermo.size) {
    const ids = new Set(tarefas.map(tarefa => tarefa.id));
    for (const item of oportunidades.itens) {
      const tarefa = porTermo.get(chaveBuscaGoogle(item.termo));
      if (!tarefa || tarefa.ofertasAfetadas[0].id !== item.ofertaId) continue;
      const {capturaId, coletadoEm, atual} = tarefa.observacaoGoogle;
      item.capturaGoogleLocal = {capturaId, coletadoEm, atual, tarefaId:ids.has(tarefa.id) ? tarefa.id : null};
    }
    oportunidades.tarefasGoogleLocal = tarefas;
  }
  oportunidades.planoPrioritario=prioridades.prioridades;
  oportunidades.regrasPrioridades=prioridades.regrasVersao||1;
  const mapaInvestigacao=construirMapaInvestigacao({...projeto,oportunidades},{agora});
  const cenariosEconomicos=(projeto.perfil.ofertas||[]).map(o=>{
    try{return {ofertaId:o.id,nome:o.nome,...calcularCenarioPorContato(o.premissasEconomicas??o.economia,{ofertaId:o.id,perfilConfirmado:projeto.perfil.estado==='confirmado',agora})};}
    catch{return {ofertaId:o.id,nome:o.nome,estado:'incompleto',contribuicaoPorContatoQualificado:null,faltam:['Revisar premissas e período da oferta.']};}
  });
  const confirmada = projeto.perfil.estado === 'confirmado';
  // Não deixar um relatório salvo apresentar números antigos como atuais.
  // A evidência original permanece no registro persistido e no histórico.
  let posicoes = projeto.posicoes;
  if (posicoes?.consultas?.length) {
    const atuais = new Set(oportunidades.itens.filter(i => i.observado.estado !== 'nao_medido').map(i => i.termo));
    const consultas = posicoes.consultas.map(q => atuais.has(q.termo) ? q : {...q,
      estado:'sem_captura_atual', posicao:null, acima:[], resultados:[], paginas:[], profundidadeObservada:0,
      motivo:'A observação salva não confirma uma posição atual para este plano. Solicite nova medição.'});
    const invalidadas = consultas.filter(q => q.estado === 'sem_captura_atual').length;
    if (invalidadas) posicoes = {...posicoes, consultas, estado:atuais.size ? 'parcial' : 'desatualizada',
      aviso:'Parte das observações salvas não confirma posições atuais. Solicite nova medição.',
      cobertura:{...posicoes.cobertura, verificadas:atuais.size,
        encontradas:consultas.filter(q => q.posicao !== null).length,
        finalizadas:consultas.filter(q => q.estado !== 'sem_captura_atual' && q.concluida).length,
        pendentes:Math.max(0, projeto.palavras.candidatos.length-atuais.size)}};
  }
  const entendimentoNovo=projeto.entendimentoNovo?{...projeto.entendimentoNovo,
    fonteHistorica:projeto.entendimentoNovo.capturaId!==projeto.evidenciasNegocio?.capturaId}:undefined;
  const proposicoesNovo=projeto.proposicoesNovo?{...projeto.proposicoesNovo,
    fonteHistorica:projeto.proposicoesNovo.capturaId!==projeto.evidenciasNegocio?.capturaId}:undefined;
  if(proposicoesNovo?.job?.resultado)proposicoesNovo.revisaoEscopo=revisarEscopoProposicoes(proposicoesNovo.job.resultado);
  if(entendimentoNovo?.job?.resultado?.ofertas){
    entendimentoNovo.condicoesEstruturadas=entendimentoNovo.job.resultado.ofertas.flatMap(o=>{
      const perfilOferta=projeto.perfil.ofertas.find(p=>p.nome.normalize('NFKC').toLowerCase()===o.nome.normalize('NFKC').toLowerCase());
      if(!perfilOferta)return [];
      return (o.jornada?.condicoes||[]).filter(c=>c.aplicacao==='esta_oferta').map(c=>{
        const fontes=c.citacoes.map(f=>({id:f.id,texto:f.texto,url:f.contexto.url,sha256:f.contexto.sha256,coletadoEm:f.contexto.coletadoEm}));
        try{return {ofertaId:perfilOferta.id,nome:perfilOferta.nome,...extrairCondicoesEstruturadas({ofertaId:perfilOferta.id,dominio:projeto.dominio,fontes,escopo:{id:perfilOferta.id,descricao:perfilOferta.nome,confirmado:false}})};}
        catch{return {ofertaId:perfilOferta.id,nome:perfilOferta.nome,condicoes:[],naoInterpretadas:[],limites:['A condição precisa de revisão manual.']};}
      });
    });
  }
  return {...projeto,...(entendimentoNovo?{entendimentoNovo}:{}),...(proposicoesNovo?{proposicoesNovo}:{}),capturasGoogleLocais:googleLocal.capturas,googleLocal, posicoes, demanda, oportunidades,prioridades,cenariosEconomicos,mapaInvestigacao, ia:estadoIAProjeto({...projeto, capacidades}, {agora}),
    ...(projeto.iaCandidata ? {iaCandidata:estadoIAProjeto({...projeto,capacidades,ia:projeto.iaCandidata},{agora})} : {}),
    capacidades, avaliadoEm: new Date(agora()).toISOString(),
    modulos: [
      {id:'perfil', nome:'Entender o negócio', estado:confirmada ? 'confirmado' : 'revisao_necessaria', detalhe:'O responsável pode corrigir ofertas, público e área atendida.'},
      {id:'palavras', nome:'Descobrir palavras', estado:projeto.palavras.candidatos.length ? 'disponivel' : 'sem_termos', detalhe:'Termos publicados e sugestões são identificados pela origem.'},
      {id:'posicoes', nome:'Medir posições', estado:posicoes?.estado || 'nao_consultada', detalhe:'Fonte, data, recorte e concorrentes observados acompanham cada captura.'},
      {id:'valor', nome:'Avaliar oportunidades', estado:oportunidades.estado, detalhe:'Relação com a oferta e evidências orientam prioridades; valores são cenários declarados.'},
      {id:'historico', nome:'Acompanhar', estado:projeto.tarefas?.itens?.length ? 'disponivel' : 'sem_tarefas', detalhe:'Registre execução e verificação das tarefas; uma mudança isolada não comprova causa.'},
    ], limites:[...LIMITES, ...(projeto.avisos || [])]};
}

export function criarCoordenador(opcoes = {}) {
  const agora = opcoes.agora || Date.now;
  async function lerSite(dominio) {
    const coleta = await opcoes.coletar(dominio);
    if (!coleta || coleta.dominio !== dominio) throw new ErroProjeto('Não foi possível confirmar a leitura do domínio solicitado.', 503);
    const evidenciasNegocio=typeof opcoes.registrarEvidencias==='function'?await opcoes.registrarEvidencias(coleta):null;
    return {descoberta: descobrirTermos(coleta), diagnostico: analisarPaginas(coleta),
      ...(evidenciasNegocio?{evidenciasNegocio}:{}),
      contextoPublico:extrairContextoPublico(coleta),
      coletadoEm: coleta.coletadoEm || new Date(agora()).toISOString()};
  }
  return {async executar(entrada, env = {}) {
    const dominio = validar(entrada), acao = entrada.acao;
    const repo = criarRepositorio(env.DB);
    const capacidades = {posicoes:{configurada:!!env.SERPAPI_KEY},
      demanda:{configurada:typeof opcoes.consultarDemanda === 'function'},
      ia:{instalada:typeof opcoes.executarIA === 'function', estado:'experimental',
        ...(typeof opcoes.executarIACandidata === 'function' ? {candidata:true} : {})},
      entendimento:{instalado:typeof opcoes.iniciarEntendimento==='function',estado:'experimental_local'},
      ...(typeof opcoes.registrarGoogleLocal==='function'?{googleLocal:{disponivel:true,modo:'pagina_aberta',enviaConsultas:false,...(opcoes.conexaoDiretaGoogleLocal===true?{conexaoDireta:true}:{})}}:{}),
      ...(typeof opcoes.iniciarProposicoes==='function'?{proposicoes:{instalado:true,estado:'experimental_local',padrao:false}}:{}),
      tarefas:{disponivel:true},premissas:{disponivel:true}};
    if (LEITURAS.has(acao)) {
      const projeto = await atualizarDerivados(await repo.ler(dominio));
      if (!projeto) throw new ErroProjeto('Nenhum projeto salvo para este site. Comece pela leitura do negócio.', 404);
      if(entrada.revisao!=null && entrada.revisao!==projeto.revisao)throw new ErroProjeto('O projeto mudou. Abra a análise salva antes de exportar ou consultar esta revisão.',409);
      const atual=compor(projeto, agora, capacidades);
      if(acao==='revisar_leitura')return{...atual,propostaDaLeitura:{perfil:inferirPerfil({dominio,descoberta:projeto.descoberta,contextoPublico:projeto.contextoPublico,coletadoEm:projeto.coletadoEm}),
        natureza:'hipotese_da_leitura_salva',coletadoEm:projeto.coletadoEm,
        limite:'Sugestões calculadas com as regras atuais sobre a leitura salva, sem novas requisições. Não alteram o perfil, os valores declarados ou o histórico. Compare com o que você sabe e edite apenas os campos que quiser revisar.'}};
      return acao==='exportar_plano' ? criarRelatorioCliente(atual) : atual;
    }
    const franquia = criarFranquia(env.DB, agora), trava = 'projeto-modular:' + dominio;
    const token = await franquia.bloquear(trava);
    if (!token) throw new ErroProjeto('Este projeto está sendo atualizado. Aguarde a conclusão e tente novamente.', 409);
    try {
      let projeto = await atualizarDerivados(await repo.ler(dominio));
      let revisaoPerfil = null;
      let capturaGoogle = null;
      const revisaoAnterior = projeto?.revisao || 0;
      if (acao === 'iniciar' && projeto) return compor(projeto, agora, capacidades);
      if (acao !== 'iniciar' && !projeto) throw new ErroProjeto('Leia o site antes de continuar.', 404);
      if (entrada.revisao != null && entrada.revisao !== revisaoAnterior) {
        throw new ErroProjeto('O projeto foi alterado em outra janela. Abra a análise salva antes de editar novamente.', 409);
      }
      if (acao === 'excluir') {
        await repo.excluir(dominio, entrada.revisao);
        // O histórico e os dados declarados são removidos; cotas continuam
        // registradas para não tornar a exclusão um modo de renovar a franquia.
        await env.DB.prepare('DELETE FROM rank_resultados WHERE chave LIKE ?').bind('ranking-plano-v2:' + dominio + ':modular:%').run();
        return {versao:1, dominio, estado:'excluido'};
      }
      if (acao === 'iniciar') {
        const leitura = await lerSite(dominio);
        projeto = {versao:1, dominio, revisao:0, ...leitura,
          perfil:inferirPerfil({dominio, ...leitura}), historico:[], posicoes:null,
          demanda:normalizarDemanda(null, {agora}), avisos:[]};
      } else if (acao === 'reler_site') {
        if (agora() - Date.parse(projeto.ultimaTentativaLeitura || projeto.coletadoEm) < 60_000) {
          throw new ErroProjeto('Aguarde um minuto antes de atualizar a leitura do site.', 429);
        }
        const leitura = await lerSite(dominio);
        projeto.ultimaTentativaLeitura = new Date(agora()).toISOString();
        if (leitura.descoberta.cobertura.paginasLidas > 0) {
          Object.assign(projeto, leitura);
          if (projeto.perfil.estado !== 'confirmado' && projeto.perfil.origemRevisao !== 'usuario') {
            projeto.perfil = inferirPerfil({dominio, ...leitura});
          }
          projeto.avisos = [];
        } else projeto.avisos = ['A nova leitura falhou. O conteúdo anterior mantém sua data; revise a cobertura antes de agir.'];
      } else if (acao === 'salvar_perfil') {
        const perfilRevisado = corrigirPerfil(projeto.perfil, entrada.perfil);
        revisaoPerfil = compararRevisaoPerfil(projeto.perfil, perfilRevisado);
        projeto.perfil = perfilRevisado;
        projeto.posicoes = null;
        // Demandas anteriores não herdam automaticamente a nova segmentação.
        projeto.demanda = normalizarDemanda(null, {agora});
      } else if(['experimentar_entendimento','experimentar_proposicoes'].includes(acao)){
        const novo=acao==='experimentar_proposicoes',iniciar=novo?opcoes.iniciarProposicoes:opcoes.iniciarEntendimento,campo=novo?'proposicoesNovo':'entendimentoNovo';
        if(typeof iniciar!=='function'||!projeto.evidenciasNegocio?.capturaId)throw new ErroProjeto('O entendimento por IA precisa do ambiente local e de uma leitura preservada. Atualize a leitura ou use o perfil editável.',503);
        const job=await iniciar({dominio,capturaId:projeto.evidenciasNegocio.capturaId});
        projeto[campo]={versao:novo?3:2,job,estado:job.estado,capturaId:projeto.evidenciasNegocio.capturaId,perfilConfirmado:false};
      } else if(['consultar_entendimento','consultar_proposicoes'].includes(acao)){
        const novo=acao==='consultar_proposicoes',campo=novo?'proposicoesNovo':'entendimentoNovo',consultar=novo?opcoes.consultarProposicoes:opcoes.consultarEntendimento;
        if(!projeto[campo]?.job?.id||typeof consultar!=='function')return compor(projeto,agora,capacidades);
        const job=await consultar({dominio,id:projeto[campo].job.id});
        if(job.estado==='em_execucao'||job.estado===projeto[campo].estado)return compor(projeto,agora,capacidades);
        projeto[campo]={...projeto[campo],job,estado:job.estado,perfilConfirmado:false,
          fonteHistorica:projeto[campo].capturaId!==projeto.evidenciasNegocio?.capturaId};
      } else if(acao==='registrar_google_local'){
        if(typeof opcoes.registrarGoogleLocal!=='function')throw new ErroProjeto('A captura Google do navegador está disponível apenas no servidor local.',503);
        const captura=await opcoes.registrarGoogleLocal({dominio,captura:entrada.captura});
        const enderecoCanonico=valor=>{try{const u=new URL(valor);u.searchParams.sort();return u.href;}catch{return null;}};
        const iguais=c=>c.capturaId===captura.capturaId||c.sha256Trecho===captura.sha256Trecho&&c.coletadoEm===captura.coletadoEm&&enderecoCanonico(c.urlConsulta)===enderecoCanonico(captura.urlConsulta)&&JSON.stringify(c.contexto)===JSON.stringify(captura.contexto);
        if((projeto.capturasGoogleLocais||[]).some(c=>iguais(c)&&c.parserVersao===captura.parserVersao))return compor(projeto,agora,capacidades);
        projeto.capturasGoogleLocais=[...(projeto.capturasGoogleLocais||[]).filter(c=>!iguais(c)),captura].slice(-20);
        capturaGoogle = captura;
      } else if(acao==='registrar_tarefa'){
        projeto=compor(projeto,agora,capacidades);
        projeto.tarefas=sincronizarTarefas(projeto.tarefas||null,projeto.prioridades.tarefasDisponiveis,{dominio,agora});
        projeto.tarefas=atualizarTarefa(projeto.tarefas,entrada.tarefa,{dominio,agora});
      } else if (['experimentar_ia','experimentar_ia_candidata'].includes(acao)) {
        const candidata=acao==='experimentar_ia_candidata';
        const executar=candidata ? opcoes.executarIACandidata : opcoes.executarIA;
        if (typeof executar !== 'function') throw new ErroProjeto('O piloto de IA local solicitado não está instalado nesta execução. A análise por evidências continua disponível.', 503);
        if (projeto.perfil.estado !== 'confirmado') throw new ErroProjeto('Confirme o perfil antes de experimentar a IA local.', 409);
        const entradaIA = prepararIAProjeto({...projeto, capacidades}, {agora});
        const resultado = entradaIA.entrada.entradas.length ? await executar(entradaIA.entrada) : null;
        projeto[candidata ? 'iaCandidata' : 'ia'] = resultado
          ? registrarIAProjeto(projeto, resultado, entradaIA, {agora,modoEsperado:candidata ? 'candidata' : 'padrao'})
          : registrarContextoInsuficiente(projeto,entradaIA,{agora});
      } else if (acao === 'medir') {
        if (projeto.perfil.estado !== 'confirmado') throw new ErroProjeto('Confirme o perfil do negócio antes de usar a cota de posições.', 409);
        projeto.posicoes = await medirProjeto(projeto, env, opcoes);
      } else if (acao === 'analisar' && typeof opcoes.consultarDemanda === 'function' && projeto.perfil.estado === 'confirmado') {
        let timer;
        const controller = new AbortController();
        try {
          const dados = await Promise.race([
            opcoes.consultarDemanda({dominio, termos:projeto.palavras.candidatos.map(c => c.termo),
              pais:'Brasil', idioma:'Português'}, {signal:controller.signal}),
            new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Prazo da fonte')); }, 10_000); }),
          ]);
          projeto.demanda = normalizarDemanda(dados, {agora});
        } catch { projeto.demanda = normalizarDemanda(null, {agora}); }
        finally { clearTimeout(timer); }
      }
      projeto.palavras = gerarPalavras({perfil:projeto.perfil, descoberta:projeto.descoberta});
      if (projeto.posicoes?.planoId && projeto.posicoes.planoId !== await identificarPlano(projeto.palavras)) projeto.posicoes = null;
      projeto.revisao = revisaoAnterior + 1;
      projeto.geradoEm = new Date(agora()).toISOString();
      projeto = compor(projeto, agora, capacidades);
      projeto.tarefas=sincronizarTarefas(projeto.tarefas||null,projeto.prioridades.tarefasDisponiveis,{dominio,agora});
      projeto.historico = registrarHistorico(projeto, acao, agora, revisaoPerfil, capturaGoogle);
      // Os estados de módulos refletem o evento que acabou de ser salvo.
      projeto = compor(projeto, agora, capacidades);
      await repo.salvar(projeto, revisaoAnterior);
      return projeto;
    } finally { await franquia.liberar(trava, token); }
  }};
}
