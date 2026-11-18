import {createHash} from 'node:crypto';
import {normalizarSite} from '../consulta.mjs';
import {chaveBuscaGoogle} from '../google-local.mjs';
import {FONTE_TAREFA_GOOGLE, LIMITES_TAREFAS} from './tarefas.mjs';

const idCaptura = /^gl1_[a-f0-9]{64}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const estadosComBlocos = new Set(['capturada', 'parcial', 'dominios_exibidos']);
const texto = valor => typeof valor === 'string' ? valor.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim() : '';

function paginaDaOferta(oferta, dominio) {
  try {
    const url = new URL(oferta.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.port || url.search || url.hash || normalizarSite(url.href) !== dominio) return null;
    return {url:url.href, origem:'declarada', fonte:'perfil'};
  } catch {
    return null;
  }
}

function lerPagina(captura, dominio) {
  const links = new Map(captura.resultados.map(link => [link.ordemBloco, link]));
  const blocos = captura.blocosWeb.map(bloco => ({
    ordemBloco:bloco.ordemBloco,
    dominio:bloco.dominio || bloco.dominioExibido || null,
    titulo:bloco.titulo,
    url:links.get(bloco.ordemBloco)?.url || null,
  }));
  const doSite = bloco => bloco.dominio === dominio || bloco.dominio?.endsWith('.' + dominio);
  const alvo = blocos.find(doSite) || null;
  // Only blocks strictly before the first identified target on the same page.
  // Use block order so unidentified blocks remain visible as gaps.
  const dominios = new Set();
  const anteriores = alvo ? blocos.filter(bloco => {
    if (bloco.ordemBloco >= alvo.ordemBloco || !bloco.dominio || dominios.has(bloco.dominio)) return false;
    dominios.add(bloco.dominio);
    return true;
  }).slice(0, 5) : [];
  return {alvo, anteriores, totalBlocos:blocos.length,
    blocosSemIdentificacao:blocos.filter(bloco => !bloco.dominio).length};
}

function observacaoDaSequencia(sequencia, capturas, dominio) {
  if (sequencia.conflitos.length) return null;
  const paginas = sequencia.paginas.flatMap(pagina => {
    const captura = capturas.get(pagina.capturaId);
    if (!captura) return [];
    return [{pagina, captura, ...lerPagina(captura, dominio)}];
  });
  const ligadas = paginas.filter(x => x.pagina.naSequenciaDesdePrimeira);
  const escolhida = ligadas.find(x => x.alvo) || paginas.find(x => x.alvo) || ligadas.at(-1) || paginas[0];
  if (!escolhida) return null;
  const {pagina, captura, alvo, anteriores, totalBlocos, blocosSemIdentificacao} = escolhida;
  const lacuna = sequencia.lacunas[0] || null;
  return {
    natureza:'captura_google_declarada', capturaId:captura.capturaId, sha256Trecho:captura.sha256Trecho,
    sequenciaId:sequencia.id, termo:captura.termo, coletadoEm:captura.coletadoEm, atual:captura.atual,
    posicaoGoogle:null, contextoSolicitado:sequencia.contextoSolicitado, contextoEfetivoConfirmado:false,
    inicioSolicitado:captura.inicioSolicitado, encadeada:pagina.naSequenciaDesdePrimeira, totalBlocos,
    iniciosEncadeados:ligadas.map(x => x.pagina.inicioSolicitado), blocosSemIdentificacao,
    lacunas:sequencia.lacunas.length, primeiraPaginaCapturada:ligadas.some(x => x.pagina.inicioSolicitado === 0),
    proximaPaginaPendente:lacuna?.url || null, alvo, anteriores,
  };
}

function compararPaginaAnterior(observacao,sequencia,sequencias,capturas,dominio) {
  if(!observacao.encadeada)return null;
  const contexto=JSON.stringify(sequencia.contextoSolicitado);
  const candidatas=[];
  for(const s of sequencias){
    if(s.id===sequencia.id||s.conflitos.length||s.chaveBusca!==sequencia.chaveBusca||
      JSON.stringify(s.contextoSolicitado)!==contexto||
      Date.parse(s.ultimaColetaEm)>=Date.parse(observacao.coletadoEm))continue;
    const p=s.paginas.find(p=>p.naSequenciaDesdePrimeira&&p.inicioSolicitado===observacao.inicioSolicitado);
    const anterior=capturas.get(p?.capturaId);
    if(anterior)candidatas.push(anterior);
  }
  candidatas.sort((a,b)=>Date.parse(b.coletadoEm)-Date.parse(a.coletadoEm));
  const antes=candidatas[0];
  if(!antes)return null;
  const pagina=lerPagina(antes,dominio),agora=observacao.alvo;
  const mesmoRecorte=pagina.totalBlocos===observacao.totalBlocos&&
    pagina.blocosSemIdentificacao===0&&observacao.blocosSemIdentificacao===0;
  const mesmaIdentificacao=pagina.alvo&&agora&&pagina.alvo.dominio===agora.dominio&&
    Boolean(pagina.alvo.url)===Boolean(agora.url);
  return {capturaId:antes.capturaId,coletadoEm:antes.coletadoEm,sha256Trecho:antes.sha256Trecho,
    ordemAnterior:pagina.alvo?.ordemBloco??null,ordemMaisRecente:agora?.ordemBloco??null,
    blocosAnteriores:pagina.totalBlocos,blocosMaisRecentes:observacao.totalBlocos,
    blocosAnterioresSemIdentificacao:pagina.blocosSemIdentificacao,
    blocosMaisRecentesSemIdentificacao:observacao.blocosSemIdentificacao,
    inicioSolicitado:antes.inicioSolicitado,mesmosParametrosSolicitados:true,
    contextoEfetivoConfirmado:false,ordemComparavelNoRecorte:Boolean(mesmoRecorte&&mesmaIdentificacao),
    posicaoGoogle:null};
}

function compararDestino(pagina, encontrado) {
  if (!pagina?.url || !encontrado?.url) return {estado:'destino_a_confirmar',
    urlDaOferta:pagina?.url??null, urlExibida:encontrado?.url??null};
  try {
    const a=new URL(pagina.url), b=new URL(encontrado.url);
    const chave=u=>u.hostname.replace(/^www\./u,'')+u.pathname.replace(/\/$/u,'');
    return {estado:chave(a)===chave(b)?'mesmo_caminho':'outro_caminho',urlDaOferta:a.href,urlExibida:b.href};
  }catch {
    return {estado:'destino_a_confirmar',urlDaOferta:pagina.url,urlExibida:null};
  }
}

function instrucoes(observacao, pagina) {
  const repetir = 'Repita a consulta na aba Web com os mesmos parâmetros, dispositivo e localidade declarada. Registre a nova captura com sua própria data.';
  if (!observacao.encadeada) {
    return {verbo:'Ligar as páginas da busca', acao:'Reconstrua a sequência pela primeira página e pelos links seguintes publicados.',
      passos:['Abra a primeira página da mesma consulta e registre o contexto.', 'Siga os links indicados para preencher as lacunas até o trecho relevante.', repetir],
      criterio:'A primeira página e as continuações conferidas ficam registradas. Páginas ainda avulsas constam como lacuna.'};
  }
  if (!observacao.alvo && observacao.proximaPaginaPendente) {
    return {verbo:'Completar o recorte', acao:'Capture a próxima página indicada na sequência antes de avaliar a presença do site.',
      passos:['Abra a próxima página pendente indicada na evidência.', 'Se os parâmetros ou a consulta mudarem, comece outro registro.', repetir],
      criterio:'A próxima página foi incorporada com data e contexto, ou a interrupção foi registrada. A ordem se refere apenas a cada página.'};
  }
  if (!pagina) {
    return {verbo:'Escolher a página da oferta', acao:'Indique no perfil qual página do site deve atender a esta consulta.',
      passos:['Localize a página em que o visitante entende a oferta e encontra o próximo passo.', 'Registre a URL no perfil e confirme a oferta.', repetir],
      criterio:'Existe uma URL própria confirmada para a oferta, ou está registrada a necessidade de preparar essa página.'};
  }
  if (observacao.destinoNaBusca.estado === 'outro_caminho') {
    const {urlDaOferta,urlExibida}=observacao.destinoNaBusca;
    return {verbo:'Conferir qual página atende à busca',
      acao:'O recorte mostra '+urlExibida+' e o perfil indica '+urlDaOferta+'. Compare as duas páginas antes de escolher uma mudança.',
      passos:[
        'Abra a URL registrada na captura e a página da oferta. Registre o título principal e o primeiro passo disponível em cada página.',
        'Compare as páginas com a intenção da consulta. Anote qual explica a oferta e recebe o contato correspondente. Se a página encontrada servir a uma etapa diferente, registre essa função.',
        'Confirme no perfil a URL que deve receber o pedido e verifique se as páginas publicadas apontam para ela. Confira o link canônico e a situação de indexação caso tenha evidência disponível.',
        repetir,
      ],
      criterio:'O registro inclui as duas URLs, as funções verificadas, o destino escolhido para a consulta e a página exibida em uma nova captura, se disponível.'};
  }
  if (!observacao.alvo || !observacao.anteriores.length) {
    return {verbo:'Conferir a presença', acao:'Revise se a página da oferta responde à consulta e registre o que a busca permite observar.',
      passos:['Confira na página da oferta se público, condições e próximo passo estão claros.', 'Registre os blocos identificados e o que ficou desconhecido.', repetir],
      criterio:'O registro relaciona a consulta à página conferida, delimita a cobertura da captura e indica o próximo teste de conteúdo.'};
  }
  return {verbo:'Comparar resultados', acao:'Compare a página da oferta com os resultados que apareceram antes do site no trecho capturado.',
    passos:[
      'Confira se a URL encontrada responde à mesma oferta. Quando há só um domínio exibido, confirme a página no navegador antes de compará-la.',
      'Compare como as páginas pertinentes apresentam a oferta, quem atendem e o próximo passo. Registre uma melhoria verificável para a página cadastrada.',
      repetir,
    ],
    criterio:'Uma ficha compara a página da oferta e os destinos confirmados, identifica uma mudança verificável e registra consulta, contexto e data da nova captura.'};
}

function prepararTarefa(dominio, oferta, observacao, contextoId) {
  const pagina = paginaDaOferta(oferta, dominio);
  observacao = {...observacao,destinoNaBusca:compararDestino(pagina,observacao.alvo)};
  const {verbo, acao, passos, criterio} = instrucoes(observacao, pagina);
  const ctx = observacao.contextoSolicitado;
  const anterior = observacao.anteriores.map(x => x.dominio).join(', ');
  const fonte = [
    'Consulta “' + observacao.termo + '” na aba Web do Google.',
    'Origem ' + texto(ctx.origemGoogle) + ', idioma solicitado ' + (texto(ctx.idiomaSolicitado) || 'desconhecido') +
      ', país solicitado ' + (texto(ctx.paisSolicitado) || 'desconhecido') + ', dispositivo ' + texto(ctx.dispositivo) +
      ', localidade declarada ' + (texto(ctx.localidadeDeclarada) || 'desconhecida') + '.',
    'Início solicitado ' + observacao.inicioSolicitado + '. Blocos web reconhecidos ' + observacao.totalBlocos + '.',
    observacao.alvo ? 'Alvo no bloco ' + observacao.alvo.ordemBloco +
      (observacao.alvo.url ? ', com URL publicada.' : ', com domínio exibido e destino desconhecido.')
      : 'Site não identificado neste trecho.',
    anterior ? 'Domínios identificados antes no mesmo trecho: ' + anterior + '.' : '',
    'Blocos sem identificação ' + observacao.blocosSemIdentificacao + '. Lacunas de continuação ' + observacao.lacunas + '.',
  ].filter(Boolean).join(' ');
  const comparacao=observacao.comparacaoAnterior;
  const evidenciaAnterior=comparacao?{tipo:'google_local',fonte:'Captura anterior declarada no navegador',
    campo:FONTE_TAREFA_GOOGLE,fonteId:comparacao.capturaId,sha256:comparacao.sha256Trecho,coletadoEm:comparacao.coletadoEm,
    trecho:'Mesma consulta, parâmetros solicitados e início '+comparacao.inicioSolicitado+'. '+comparacao.blocosAnteriores+
      ' blocos anteriores reconhecidos. '+(comparacao.ordemAnterior?'Domínio reconhecido no bloco '+comparacao.ordemAnterior+'.':'Domínio ainda sem identificação nesse recorte.')
      +(comparacao.ordemComparavelNoRecorte?' A ordem destes blocos pode ser conferida nos dois recortes.':' A cobertura e a presença do domínio precisam permanecer explícitas na comparação.')}:null;
  const id = 'google_local_' + createHash('sha256').update(JSON.stringify([
    dominio, oferta.id, chaveBuscaGoogle(observacao.termo), contextoId,
  ])).digest('hex').slice(0, 24);
  return {
    id, tipo:'conferir_busca_observada', eixo:'dados', base:'hipotese', prioridade:'investigar',
    titulo:verbo + ' para “' + observacao.termo + '”', acao, passos, criterioSucesso:criterio,
    paginaAlvo:pagina, termosRelacionados:[observacao.termo], ofertasAfetadas:[{id:oferta.id, nome:oferta.nome}],
    observacaoGoogle:observacao,
    evidencias:[{tipo:'google_local', fonte:'Captura declarada no navegador', campo:FONTE_TAREFA_GOOGLE,
      fonteId:observacao.capturaId, sha256:observacao.sha256Trecho, coletadoEm:observacao.coletadoEm, trecho:fonte},
      ...(evidenciaAnterior?[evidenciaAnterior]:[])],
    limites:['A tarefa usa o conteúdo desse recorte para orientar uma conferência. Posição absoluta e retorno comercial continuam desconhecidos.'],
  };
}

/** Connect only the exact query and confirmed offer. Positions from providers
 * and historical demand keep their original contracts. */
export function vincularObservacoesGoogle(projeto, plano, {agora = Date.now} = {}) {
  const porTermo = new Map();
  if (projeto.perfil.estado !== 'confirmado') return {porTermo, tarefas:[], plano};
  const instante = agora();
  const ofertas = new Map(projeto.perfil.ofertas.map(o => [o.id, o]));
  const candidatos = new Map(projeto.palavras.candidatos
    .filter(c => c.intencao === 'comercial' && ofertas.has(c.ofertaId))
    .map(c => [chaveBuscaGoogle(c.termo), c]));
  const capturas = new Map(projeto.googleLocal.capturas.filter(c =>
    idCaptura.test(c.capturaId) && sha256.test(c.sha256Trecho) && Date.parse(c.coletadoEm) <= instante &&
    estadosComBlocos.has(c.estado) && Array.isArray(c.blocosWeb) && c.blocosWeb.length && Array.isArray(c.resultados),
  ).map(c => [c.capturaId, c]));
  const contextos = new Set();
  for (const sequencia of projeto.googleLocal.sequencias) {
    const chave = sequencia.chaveBusca;
    const candidato = candidatos.get(chave);
    if (!candidato || porTermo.has(chave)) continue;
    const contextoId = JSON.stringify(sequencia.contextoSolicitado);
    const chaveContexto = JSON.stringify([chave, contextoId]);
    if (contextos.has(chaveContexto)) continue;
    contextos.add(chaveContexto);
    const observacao = observacaoDaSequencia(sequencia, capturas, projeto.dominio);
    if (!observacao) continue;
    const comparacaoAnterior=compararPaginaAnterior(observacao,sequencia,projeto.googleLocal.sequencias,capturas,projeto.dominio);
    porTermo.set(chave, prepararTarefa(projeto.dominio, ofertas.get(candidato.ofertaId), {...observacao,comparacaoAnterior}, contextoId));
  }
  const vagas = Math.max(0, LIMITES_TAREFAS.ativas - plano.tarefasDisponiveis.length);
  const tarefas = [...porTermo.values()].slice(0, vagas);
  const prioridades = [...plano.prioridades];
  // One useful comparison can occupy the last slot. Keep actual page findings.
  const comparacao = tarefas.find(t => t.paginaAlvo && t.observacaoGoogle.atual &&
    t.observacaoGoogle.encadeada && (t.observacaoGoogle.anteriores.length ||
      t.observacaoGoogle.destinoNaBusca.estado==='outro_caminho'));
  if (comparacao) {
    if (prioridades.length < 3) prioridades.push(comparacao);
    else {
      const posicao = prioridades.findLastIndex(t => t.base !== 'observacao');
      if (posicao !== -1) prioridades[posicao] = comparacao;
    }
  }
  return {porTermo, tarefas, plano:{...plano, prioridades,
    tarefasDisponiveis:[...plano.tarefasDisponiveis, ...tarefas]}};
}
