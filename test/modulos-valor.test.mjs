import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {avaliarOportunidades} from '../src/modulos/oportunidades.mjs';
import {normalizarDemanda} from '../src/modulos/demanda.mjs';
import {analisarPaginas} from '../src/analise.mjs';

const INSTANTE = Date.parse('2026-11-15T15:00:00Z');
const DATA = '2026-11-15T14:55:00Z';
const DOMINIO = 'cliente.com.br';
const TERMO = 'Contratação de artista gospel';
const CONTEXTO = {pais: 'Brasil', idioma: 'Português', dispositivo: 'Computador', localidade: 'Brasil'};
const agora = () => INSTANTE;
const hash = valor => createHash('sha256').update(valor).digest('hex');
const oferta = (economia = {contribuicaoPorVenda: 500, taxaFechamento: 0.1}) =>
  ({id: 'oferta1', nome: 'Contratação de artista gospel', url: 'https://cliente.com.br/contrate', economia});
const perfil = ofertas => ({dominio: DOMINIO, estado: 'confirmado', ofertas: ofertas ?? [oferta()]});
const candidato = (termo = TERMO, extras = {}) => ({termo, tipo: 'servico', origem: 'site',
  ofertaId: 'oferta1', intencao: 'comercial', evidencia: {url: 'https://cliente.com.br/contrate', campo: 'h1',
    trecho: TERMO, coletadoEm: DATA, sha256: hash('html publicado')}, ...extras});

function demanda(itens = [{termo: TERMO, buscasMensais: 90}], extras = {}) {
  return {fonte: 'Fonte simulada para teste local', coletadoEm: DATA, pais: 'BR', idioma: 'pt',
    periodoInicio: '2025-11', periodoFim: '2026-10', itens, ...extras};
}

function posicoes({posicao = 7, data = DATA, contexto = CONTEXTO} = {}) {
  const p = {termo: TERMO, resultados: Array.from({length: 10}, (_, i) => {
    const dominio = i + 1 === posicao ? DOMINIO : `concorrente${i + 1}.com.br`;
    return {url: `https://${dominio}/contrate`, dominio, titulo: `Resultado ${i + 1}`,
      pagina: 1, inicio: 0, posicaoNaPagina: i + 1, posicao: i + 1};
  }), inicio: 0, pagina: 1, contexto: {...contexto}, fonte: {nome: 'SerpApi', id: 'fixture_pagina_01'},
  coletadoEm: data, profundidadeObservada: 10, proximoInicio: null, paginacaoInterrompida: false,
  paginacaoComLacuna: false, limiteAtingido: false, relacionadas: []};
  p.sha256 = hash(JSON.stringify(p));
  p.hashEscopo = 'captura-google-pagina-v1';
  const alvo = p.resultados.find(r => r.dominio === DOMINIO);
  const q = {termo: TERMO, estado: alvo ? 'encontrado' : 'nao_encontrado', posicao: alvo?.posicao ?? null,
    posicaoNaPagina: alvo?.posicaoNaPagina ?? null, pagina: alvo?.pagina ?? null, url: alvo?.url ?? null,
    paginas: [p], resultados: p.resultados, acima: [], coletadoEm: data, contexto: {...contexto}, concluida: true};
  return {versao: 2, dominio: DOMINIO, candidatos: [candidato()], consultas: [q]};
}

function analisar(extra = {}) {
  return avaliarOportunidades({perfil: perfil(), palavras: {candidatos: [candidato()]}, ...extra}, {agora});
}

test('demanda ausente não se transforma em zero ou métricas inventadas', () => {
  for (const entrada of [null, undefined, {}, {itens: [{termo: TERMO, buscasMensais: 999}]}]) {
    const r = normalizarDemanda(entrada, {agora});
    assert.equal(r.estado, 'indisponivel');
    assert.deepEqual(r.itens, []);
  }
  const item = analisar().itens[0];
  assert.equal(item.observado.buscasMensais, null);
  assert.equal(item.observado.posicao, null);
  assert.equal(item.prioridade, 'investigar');
});

test('zero explícito é preservado; duplicidade, número ausente e negativo são descartados', () => {
  const r = normalizarDemanda(demanda([
    {termo: 'Serviço sem estimativa', buscasMensais: null},
    {termo: 'Contratar banda', buscasMensais: 0},
    {termo: 'Volume inválido', buscasMensais: -8},
    {termo: 'Busca repetida', buscasMensais: 100},
    {termo: 'busca repetida', buscasMensais: 999},
  ]), {agora});
  assert.equal(r.estado, 'parcial');
  assert.deepEqual(r.itens.map(i => [i.termo, i.buscasMensais]), [['Contratar banda', 0]]);
  assert.equal(r.pais, 'Brasil');
  assert.equal(r.idioma, 'Português');
});

test('demanda vencida, futura, período invertido ou data inexistente não orientam prioridade', () => {
  const variacoes = [
    {coletadoEm: '2026-06-01T00:00:00Z', periodoFim: '2026-05'},
    {coletadoEm: '2026-11-16T00:00:00Z'},
    {periodoInicio: '2026-10', periodoFim: '2026-09'},
    {periodoFim: '2026-02-30'},
    {periodoFim: '2026-11'},
    {coletadoEm: '2026-02-30T00:00:00Z', periodoFim: '2026-01'},
    {coletadoEm: '2026-11-15'},
  ];
  for (const extras of variacoes) {
    assert.equal(normalizarDemanda(demanda(undefined, extras), {agora}).estado, 'indisponivel');
    assert.equal(analisar({demanda: demanda(undefined, extras)}).itens[0].observado.buscasMensais, null);
  }
});

test('demanda do país ou idioma errado permanece indisponível para o recorte Brasil', () => {
  for (const extras of [{pais: 'Portugal'}, {idioma: 'English'}]) {
    const r = analisar({demanda: demanda(undefined, extras)}).itens[0];
    assert.equal(r.observado.buscasMensais, null);
    assert.ok(r.faltam.some(f => f.includes('incompatíveis')));
  }
});

test('oferta comercial supera termo amplo de muito volume', () => {
  const r = analisar({palavras: {candidatos: [
    candidato('show', {ofertaId: null, intencao: 'indefinida'}), candidato(),
  ]}, demanda: demanda([{termo: 'show', buscasMensais: 1_000_000}, {termo: TERMO, buscasMensais: 90}])});
  assert.equal(r.itens[0].termo, TERMO);
  assert.equal(r.itens[0].prioridade, 'investigar');
  assert.equal(r.itens[1].prioridade, 'adiar');
  assert.equal(r.itens[1].valorPorContato, null);
  assert.match(r.itens[1].motivo, /volume elevado, sozinho/);
});

test('perfil não confirmado impede prioridade econômica e cálculo financeiro', () => {
  const r = analisar({perfil: {...perfil(), estado: 'rascunho'}, posicoes: posicoes(), demanda: demanda()});
  assert.equal(r.estado, 'aguardando_confirmacao');
  assert.equal(r.itens[0].prioridade, 'investigar');
  assert.equal(r.itens[0].confianca, 'baixa');
  assert.equal(r.itens[0].valorPorContato, null);
  assert.match(r.itens[0].acao, /confirme o perfil/);
});

test('valor econômico é cenário por contato da oferta e não receita ou custo por clique', () => {
  const r = analisar().itens[0];
  assert.equal(r.valorPorContato.valor, 50);
  assert.equal(r.valorPorContato.natureza, 'cenario_declarado');
  assert.match(r.valorPorContato.explicacao, /antes do custo de aquisição/);
  assert.match(r.valorPorContato.explicacao, /Não é receita prevista/);
  assert.ok(r.faltam.some(f => f.includes('Custos de aquisição')));
  assert.equal(Object.hasOwn(r, 'roi'), false);
  assert.equal(Object.hasOwn(r, 'verbaRecomendada'), false);
});

test('economia incompleta, fração inválida e strings não são convertidas em retorno', () => {
  for (const economia of [
    {contribuicaoPorVenda: null, taxaFechamento: 0.5},
    {contribuicaoPorVenda: 1000, taxaFechamento: 50},
    {contribuicaoPorVenda: 1000, taxaFechamento: '0.5'},
    {contribuicaoPorVenda: Infinity, taxaFechamento: 0.5},
    {contribuicaoPorVenda: Number.MAX_VALUE, taxaFechamento: 0.5},
    {contribuicaoPorVenda: 1000},
  ]) assert.equal(analisar({perfil: perfil([oferta(economia)])}).itens[0].valorPorContato, null);
  assert.equal(analisar({perfil: perfil([oferta({contribuicaoPorVenda: 0, taxaFechamento: 0})])}).itens[0].valorPorContato.valor, 0);
});

test('posição íntegra gera hipótese de melhoria e concorrentes somente observados antes', () => {
  const item = analisar({posicoes: posicoes(), demanda: demanda()}).itens[0];
  assert.equal(item.prioridade, 'melhorar');
  assert.equal(item.observado.posicao, 7);
  assert.equal(item.observado.buscasMensais, 90);
  assert.equal(item.observado.estado, 'encontrado');
  assert.equal(item.confianca, 'media');
  assert.equal(item.observado.concorrentes.length, 5);
  assert.ok(item.observado.concorrentes.every(c => c.posicao < 7));
  assert.ok(item.evidencias.some(e => e.tipo === 'google'));
  assert.match(item.motivo, /dificuldade de subir não foi medida/);
});

test('topo observado acompanha; ausência no recorte não fabrica posição', () => {
  assert.equal(analisar({posicoes: posicoes({posicao: 2})}).itens[0].prioridade, 'acompanhar');
  const item = analisar({posicoes: posicoes({posicao: null})}).itens[0];
  assert.equal(item.prioridade, 'investigar');
  assert.equal(item.observado.posicao, null);
  assert.equal(item.observado.estado, 'nao_encontrado_no_recorte');
  assert.deepEqual(item.observado.concorrentes, []);
  assert.match(item.motivo, /não determina sua posição/);
});

test('capturas antigas, futuras, contexto incompatível e resumo adulterado são recusados', () => {
  const adulterada = posicoes();
  adulterada.consultas[0].posicao = 1;
  const dominioDiferente = {...posicoes(), dominio: 'outro.com.br'};
  const paginaAdulterada = posicoes();
  paginaAdulterada.consultas[0].paginas[0].resultados[0].url = 'https://cliente.com.br/contrate';
  for (const captura of [
    posicoes({data: '2026-11-15T13:55:00Z'}), posicoes({data: '2026-11-15T15:05:00Z'}),
    posicoes({contexto: {...CONTEXTO, dispositivo: 'Celular'}}), adulterada, dominioDiferente, paginaAdulterada,
  ]) {
    const item = analisar({posicoes: captura}).itens[0];
    assert.equal(item.prioridade, 'investigar');
    assert.equal(item.observado.posicao, null);
    assert.equal(item.observado.estado, 'nao_medido');
    assert.deepEqual(item.observado.concorrentes, []);
  }
});

test('hipótese de palavra nunca é apresentada como observação publicada no site', () => {
  const item = analisar({palavras: {candidatos: [candidato(TERMO, {origem: 'hipotese'})]}, posicoes: posicoes()}).itens[0];
  assert.ok(item.evidencias.every(e => e.tipo !== 'site'));
  assert.ok(item.faltam.some(f => f.includes('hipótese gerada')));
  assert.equal(item.observado.posicao, 7);
});

test('consulta repetida, captura sem hash e candidato estrangeiro não ganham certeza', () => {
  const duplicada = posicoes();
  duplicada.consultas.push(structuredClone(duplicada.consultas[0]));
  assert.equal(analisar({posicoes: duplicada}).itens[0].observado.posicao, null);
  const semHash = posicoes();
  delete semHash.consultas[0].paginas[0].sha256;
  assert.equal(analisar({posicoes: semHash}).itens[0].observado.posicao, null);
  assert.equal(avaliarOportunidades({}, {agora}).estado, 'sem_dados');
});

test('metadados de anúncio não viram custo, dificuldade orgânica ou orçamento', () => {
  const r = normalizarDemanda(demanda([{termo: TERMO, buscasMensais: 0, cpc: 120, concorrencia: 'alta'}]), {agora});
  assert.equal(Object.hasOwn(r.itens[0], 'cpc'), false);
  assert.equal(Object.hasOwn(r.itens[0], 'concorrencia'), false);
  const item = analisar({demanda: r}).itens[0];
  assert.equal(item.observado.buscasMensais, 0);
  assert.equal(item.observado.demandaEstado, 'estimativa_historica');
  assert.equal(item.prioridade, 'investigar');
});

test('busca longa não empresta volume ao seu prefixo nem é truncada em outro candidato', () => {
  const prefixo = 'Consultoria '.padEnd(160, 'x');
  const longa = prefixo + ' em uma cidade';
  const dados = normalizarDemanda(demanda([{termo:longa,buscasMensais:900}]), {agora});
  assert.deepEqual(dados.itens, []);
  const analise = analisar({palavras:{candidatos:[candidato(longa)]},demanda:demanda([{termo:prefixo,buscasMensais:900}])});
  assert.deepEqual(analise.itens, []);
  assert.match(analise.limites.join(' '), /sem truncar/);
  const grupo = normalizarDemanda(demanda([], {grupos:[{termoCanonico:longa,termos:[longa,'Outra busca'],buscasMensais:900}]}), {agora});
  assert.deepEqual(grupo.grupos, []);
});

test('estimativa compartilhada é explicada e a frente não soma variantes nem cenários', () => {
  const variante = 'Contratação de artista gospel em São Paulo';
  const r = analisar({palavras:{candidatos:[candidato(),candidato(variante)]},
    demanda:demanda([], {grupos:[{termoCanonico:TERMO,termos:[TERMO,variante],buscasMensais:900}]})});
  assert.equal(r.frentes.length, 1);
  assert.equal(r.frentes[0].resumo.termosPlanejados, 2);
  assert.equal(r.frentes[0].resumo.gruposCompartilhados, 1);
  assert.equal(r.frentes[0].resumo.demandasIndividuais, 0);
  assert.equal(r.frentes[0].valorPorContato.valor, 50);
  assert.ok(r.itens.every(i => i.observado.demandaEstado === 'estimativa_compartilhada' && i.observado.buscasMensais === null));
  assert.ok(r.itens.every(i => i.faltam.some(f => f.includes('grupo de variantes'))));
  assert.ok(r.itens.every(i => i.evidencias.some(e => e.tipo === 'demanda_compartilhada')));
  assert.equal(Object.hasOwn(r.frentes[0], 'volumeTotal'), false);
});

test('zero estimado pede validação da procura e preserva posição observada', () => {
  const item = analisar({posicoes:posicoes(),demanda:demanda([{termo:TERMO,buscasMensais:0}])}).itens[0];
  assert.equal(item.prioridade, 'investigar');
  assert.equal(item.proximoTeste.tipo, 'validar_demanda');
  assert.equal(item.observado.posicao, 7);
  assert.equal(item.observado.buscasMensais, 0);
  assert.match(item.proximoTeste.comoValidar, /não prova ausência/);
  assert.match(item.motivo, /arredondada/);
});

test('cenário econômico zero exige conferir premissas em vez de recomendar aquisição', () => {
  const item = analisar({perfil:perfil([oferta({contribuicaoPorVenda:0,taxaFechamento:0.1})]),posicoes:posicoes()}).itens[0];
  assert.equal(item.valorPorContato.valor, 0);
  assert.equal(item.valorPorContato.escopo, 'oferta');
  assert.equal(item.proximoTeste.tipo, 'validar_economia');
  assert.equal(item.prioridade, 'investigar');
  assert.equal(item.observado.posicao, 7);
  assert.match(item.acao, /informadas corretamente/);
});

test('contribuição negativa declarada é preservada e pede revisão econômica sem inferir gasto real', () => {
  const item=analisar({perfil:perfil([oferta({contribuicaoPorVenda:-800,taxaFechamento:0.1})]),posicoes:posicoes()}).itens[0];
  assert.equal(item.valorPorContato.valor,-80);
  assert.equal(item.valorPorContato.contribuicaoPorVenda,-800);
  assert.equal(item.valorPorContato.natureza,'cenario_declarado');
  assert.equal(item.proximoTeste.tipo,'validar_economia');
  assert.equal(item.prioridade,'investigar');
  assert.equal(item.observado.posicao,7);
  assert.match(item.motivo,/negativa/);
  assert.equal(Object.hasOwn(item,'prejuizoReal'),false);
  assert.equal(Object.hasOwn(item,'verbaRecomendada'),false);
  const zerada=analisar({perfil:perfil([oferta({contribuicaoPorVenda:-800,taxaFechamento:0})])}).itens[0];
  assert.equal(zerada.valorPorContato.valor,0);
  assert.equal(zerada.proximoTeste.tipo,'validar_economia');
  const desconhecida=analisar({perfil:perfil([oferta({contribuicaoPorVenda:-800,taxaFechamento:null})])}).itens[0];
  assert.equal(desconhecida.valorPorContato,null);
});

test('frente sem URL pede localizar página existente antes de propor conteúdo novo', () => {
  const r = analisar({perfil:perfil([{...oferta(),url:null}]),
    palavras:{candidatos:[candidato(TERMO,{origem:'hipotese',evidencia:null})]}});
  assert.equal(r.frentes[0].paginaAlvo, null);
  assert.equal(r.frentes[0].proximoTeste.tipo, 'validar_pagina');
  assert.match(r.frentes[0].proximoTeste.acao, /já existe uma página/);
  assert.match(r.frentes[0].proximoTeste.comoValidar, /evite páginas duplicadas/);
  assert.equal(Object.hasOwn(r.frentes[0], 'criarLandingPage'), false);
});

test('página observada na busca prevalece sobre URL apenas declarada da oferta', () => {
  const r = analisar({perfil:perfil([{...oferta(),url:'https://cliente.com.br/outro-servico'}]),posicoes:posicoes()});
  assert.equal(r.itens[0].paginaAlvo.url, 'https://cliente.com.br/contrate');
  assert.equal(r.itens[0].paginaAlvo.origem, 'observada');
  assert.equal(r.itens[0].paginaAlvo.fonte, 'Google');
  assert.equal(r.frentes[0].proximoTeste.tipo, 'revisar_pagina');
  assert.equal(r.frentes[0].proximoTeste.url, 'https://cliente.com.br/contrate');
});

test('URL do perfil não confirma conteúdo atual e URLs de terceiros não viram alvo', () => {
  const hipotese = {palavras:{candidatos:[candidato(TERMO,{origem:'hipotese',evidencia:null})]}};
  const r = analisar(hipotese).itens[0];
  assert.equal(r.paginaAlvo.origem, 'declarada');
  assert.equal(r.paginaAlvo.coletadoEm, null);
  assert.equal(analisar({...hipotese,perfil:perfil([{...oferta(),url:'https://outro.com.br/pagina'}])}).itens[0].paginaAlvo, null);
});

test('perguntas do negócio e dados faltantes continuam explícitos antes da confirmação', () => {
  const r = analisar({perfil:{...perfil(),estado:'rascunho',perguntas:[{pergunta:'Quem paga pela intermediação?'}]}});
  assert.ok(r.itens[0].faltam.includes('Quem paga pela intermediação?'));
  assert.ok(r.itens[0].faltam.some(f => f.includes('Quem contrata')));
  assert.ok(r.itens[0].faltam.some(f => f.includes('Área atendida')));
  assert.equal(r.frentes[0].proximoTeste.tipo, 'confirmar_negocio');
});

test('domínio inválido não permite perfil confirmado nem cenário monetário', () => {
  const r = analisar({perfil:{...perfil(),dominio:'localhost'}});
  assert.equal(r.estado, 'aguardando_confirmacao');
  assert.equal(r.itens[0].valorPorContato, null);
  assert.equal(r.itens[0].confianca, 'baixa');
});

test('página alvo na segunda página conserva subdomínio e a data da captura que a contém', () => {
  const relatorio = posicoes({posicao:null});
  const q = relatorio.consultas[0], primeira = q.paginas[0];
  const assinar = p => {
    delete p.sha256; delete p.hashEscopo;
    p.sha256 = hash(JSON.stringify(p)); p.hashEscopo = 'captura-google-pagina-v1';
  };
  primeira.coletadoEm = '2026-11-15T14:20:00Z';
  primeira.proximoInicio = 10;
  assinar(primeira);
  const segunda = structuredClone(primeira);
  segunda.inicio = 10; segunda.pagina = 2; segunda.fonte.id = 'fixture_pagina_02';
  segunda.coletadoEm = DATA; segunda.proximoInicio = null;
  segunda.resultados = segunda.resultados.map((r,i) => ({...r,pagina:2,inicio:10,posicao:i+11,
    ...(i===2 ? {dominio:'eventos.cliente.com.br',url:'https://eventos.cliente.com.br/contrate'} : {url:r.url+'-2'})}));
  assinar(segunda);
  const alvo = segunda.resultados[2];
  q.paginas.push(segunda); q.estado = 'encontrado'; q.posicao = 13; q.posicaoNaPagina = 3;
  q.pagina = 2; q.url = alvo.url; q.resultados = [...primeira.resultados,...segunda.resultados];
  const item = analisar({posicoes:relatorio}).itens[0];
  assert.equal(item.observado.posicao, 13);
  assert.equal(item.paginaAlvo.url, alvo.url);
  assert.equal(item.paginaAlvo.coletadoEm, DATA);
  assert.equal(item.paginaAlvo.fonte, 'Google');
});

function diagnosticoSite({url='https://cliente.com.br/contrate',data=DATA,noindex=false,rotulo=false}={}) {
  const html='<html lang="pt-BR"><head><title>Contratação de artista gospel</title><meta name="viewport" content="width=device-width, initial-scale=1">'+
    (noindex?'<meta name="robots" content="noindex">':'')+'</head><body><h1>Contratação de artista gospel</h1><form>'+
    (rotulo?'<label for="nome">Seu nome</label>':'')+'<input id="nome"><button>Enviar pedido</button></form><a href="mailto:contato@cliente.com.br">Contato</a></body></html>';
  return analisarPaginas({dominio:DOMINIO,coletadoEm:data,paginas:[{url,html,status:200,coletadoEm:data,sha256:hash(html)}]});
}

test('sem fonte, achado atual na mesma página produz ação observável de uso em vez de travar na medição', () => {
  const r=analisar({diagnostico:diagnosticoSite(),capacidades:{posicoes:{configurada:false}}});
  const item=r.itens[0],frente=r.frentes[0];
  assert.equal(item.observado.posicao,null);
  assert.equal(item.proximoTeste.tipo,'corrigir_uso');
  assert.equal(item.proximoTeste.base,'observacao');
  assert.ok(item.proximoTeste.passos.length>=2);
  assert.match(item.proximoTeste.criterioSucesso,/não mede ganho de ranking ou vendas/);
  assert.equal(frente.melhoriasObservadas[0].verificacaoId,'rotulos-formulario');
  assert.equal(frente.melhoriasObservadas[0].paginaAlvo,frente.paginaAlvo.url);
  assert.ok(item.evidencias.some(e=>e.tipo==='diagnostico'&&e.sha256&&e.url===item.paginaAlvo.url));
  assert.match(item.motivo,/não foi confirmada/);
  assert.equal(Object.hasOwn(frente,'ganhoEstimado'),false);
});

test('achado em outra URL, vencido, futuro ou sem hash não sustenta correção da oferta', () => {
  const semHash=diagnosticoSite();semHash.paginas[0].sha256=null;
  for(const diagnostico of [diagnosticoSite({url:'https://cliente.com.br/outra-pagina'}),
    diagnosticoSite({data:'2026-11-14T14:55:00Z'}),diagnosticoSite({data:'2026-11-15T15:05:00Z'}),semHash]){
    const item=analisar({diagnostico,capacidades:{posicoes:{configurada:false}}}).itens[0];
    assert.equal(item.proximoTeste.tipo,'conferir_oferta');
    assert.equal(item.proximoTeste.base,'hipotese');
    assert.deepEqual(item.melhoriasObservadas,[]);
    assert.ok(item.evidencias.every(e=>e.tipo!=='diagnostico'));
  }
});

test('conteúdo atual sem defeito observado recebe checklist de contratação sem inventar problema', () => {
  const item=analisar({diagnostico:diagnosticoSite({rotulo:true}),capacidades:{posicoes:{configurada:false}}}).itens[0];
  assert.equal(item.proximoTeste.tipo,'conferir_oferta');
  assert.equal(item.proximoTeste.base,'hipotese');
  assert.ok(item.proximoTeste.passos.some(p=>p.includes('sem presumir')));
  assert.match(item.motivo,/sem afirmar um defeito/);
  assert.equal(item.observado.buscasMensais,null);
  assert.equal(item.prioridade,'investigar');
});

test('noindex observado continua pedindo intenção de publicação antes de propor edição', () => {
  const item=analisar({diagnostico:diagnosticoSite({noindex:true}),capacidades:{posicoes:{configurada:false}}}).itens[0];
  assert.equal(item.proximoTeste.tipo,'confirmar_publicacao');
  assert.equal(item.prioridade,'investigar');
  assert.ok(item.proximoTeste.passos[0].includes('responsável'));
  assert.ok(!item.proximoTeste.acao.includes('Remova'));
});

test('fonte configurada permite medir; sem fonte a oferta tem um teste manual executável', () => {
  const comFonte=analisar({capacidades:{posicoes:{configurada:true}}}).itens[0];
  const semFonte=analisar({capacidades:{posicoes:{configurada:false}}}).itens[0];
  assert.equal(comFonte.proximoTeste.tipo,'medir_posicao');
  assert.equal(semFonte.proximoTeste.tipo,'conferir_oferta');
  assert.ok(semFonte.proximoTeste.passos.length>=2);
  assert.ok(semFonte.faltam.some(f=>f.includes('Captura atual')));
});

test('URL só declarada pede leitura; diagnóstico atual da mesma URL confirma somente a página', () => {
  const palavras={candidatos:[candidato(TERMO,{origem:'hipotese',evidencia:null})]};
  const declarada=analisar({palavras,capacidades:{posicoes:{configurada:false}}}).itens[0];
  assert.equal(declarada.proximoTeste.tipo,'reler_pagina');
  assert.equal(declarada.paginaAlvo.origem,'declarada');
  const lida=analisar({palavras,diagnostico:diagnosticoSite({rotulo:true}),capacidades:{posicoes:{configurada:false}}}).itens[0];
  assert.equal(lida.proximoTeste.tipo,'conferir_oferta');
  assert.equal(lida.paginaAlvo.origem,'observada');
  assert.equal(lida.observado.posicao,null);
  assert.ok(lida.evidencias.every(e=>e.tipo!=='site'));
});

test('plano operacional reúne achado repetido por URL e verificação preservando ofertas e termos', () => {
  const segunda={...oferta(),id:'oferta2',nome:'Contratação de bandas'};
  const palavras={candidatos:[candidato(),candidato('Orçamento para artista gospel',{origem:'hipotese'}),
    candidato('Contratação de bandas',{origem:'hipotese',ofertaId:'oferta2'})]};
  const r=analisar({perfil:perfil([oferta(),segunda]),palavras,diagnostico:diagnosticoSite(),capacidades:{posicoes:{configurada:false}}});
  assert.equal(r.frentes.length,2);
  assert.equal(r.planoDeAcao.length,1);
  const tarefa=r.planoDeAcao[0];
  assert.equal(tarefa.tipo,'corrigir_uso');
  assert.equal(tarefa.base,'observacao');
  assert.equal(tarefa.ofertasAfetadas.length,2);
  assert.equal(tarefa.termosRelacionados.length,3);
  assert.equal(tarefa.melhoriasObservadas.length,1);
  assert.equal(tarefa.evidencias.length,1);
  assert.equal(tarefa.evidencias[0].url,tarefa.paginaAlvo.url);
  assert.match(tarefa.evidencias[0].sha256,/^[a-f0-9]{64}$/);
  assert.equal(tarefa.evidencias[0].coletadoEm,DATA);
  assert.equal(Object.hasOwn(tarefa,'impactoEstimado'),false);
  assert.ok(tarefa.evidenciasNegocio.every(e=>e.natureza==='trecho_literal'&&!e.verificacaoId));
  assert.ok(tarefa.evidenciasNegocio.every(e=>!e.trecho.includes('controle(s) sem nome')));
});

test('texto calculado pelo diagnóstico nunca vira declaração publicada do negócio',()=>{
  const r=analisar({diagnostico:diagnosticoSite(),capacidades:{posicoes:{configurada:false}},contextoPublico:{versao:1,dominio:DOMINIO,evidencias:[
    {tipo:'diagnostico',campo:'p',url:'https://cliente.com.br/contrate',trecho:'9 controle(s) sem nome identificável',coletadoEm:DATA,sha256:hash('html publicado')},
    {tipo:'declaracao',verificacaoId:'controles-nome',campo:'p',url:'https://cliente.com.br/contrate',trecho:'9 controle(s) sem nome identificável',coletadoEm:DATA,sha256:hash('html publicado')},
  ]}});
  assert.ok(r.planoDeAcao[0].evidencias.some(e=>e.tipo==='diagnostico'));
  assert.ok(r.planoDeAcao[0].evidenciasNegocio.every(e=>!e.trecho.includes('controle(s) sem nome')));
});

test('duas verificações da mesma página ficam como tarefas distintas e publicação depende de intenção', () => {
  const r=analisar({diagnostico:diagnosticoSite({noindex:true}),capacidades:{posicoes:{configurada:false}}});
  assert.equal(r.planoDeAcao.length,2);
  assert.equal(r.planoDeAcao[0].tipo,'confirmar_publicacao');
  assert.equal(r.planoDeAcao[1].tipo,'corrigir_uso');
  assert.notEqual(r.planoDeAcao[0].id,r.planoDeAcao[1].id);
  assert.ok(r.planoDeAcao.every(a=>a.evidencias.length===1));
  const semConfirmacao=analisar({perfil:{...perfil(),estado:'rascunho'},diagnostico:diagnosticoSite()});
  assert.deepEqual(semConfirmacao.planoDeAcao,[]);
});

function analisarNegocio(nome,papel,extras={}){
  const url='https://cliente.com.br/contrate';
  const e={url,campo:'jsonld.Service.name',trecho:nome,coletadoEm:DATA,sha256:hash('fixture negócio '+nome)};
  const o={...oferta(),nome,evidencias:[e]};
  const p={...perfil([o]),nome:'Negócio teste',publico:'Equipe responsável por eventos',regioes:['Espírito Santo'],
    entendimento:{papel,natureza:'declaracao_usuario'}};
  return analisar({perfil:p,palavras:{candidatos:[candidato(nome,{evidencia:e})]},capacidades:{posicoes:{configurada:false}},...extras});
}
test('intermediação artística produz ficha local de pedido e mantém cachê e disponibilidade desconhecidos',()=>{
  const r=analisarNegocio('Agenciamento de artistas gospel','intermediacao'),t=r.planoDeAcao[0];
  assert.equal(t.experimento.tipo,'pedido_artistico');
  assert.equal(t.categoria,'contratacao');
  assert.equal(t.paginaAlvo.url,'https://cliente.com.br/contrate');
  assert.ok(t.entregavel.includes('Agenciamento de artistas gospel'));
  assert.ok(t.modeloEntregavel.campos.some(c=>/artista/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.ok(t.modeloEntregavel.campos.some(c=>/data/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.ok(t.modeloEntregavel.campos.some(c=>/local/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.ok(t.modeloEntregavel.campos.some(c=>c.valorSugerido==='Equipe responsável por eventos'&&c.origem==='declaracao_usuario'));
  assert.equal(t.base,'hipotese');
  assert.equal(t.lacuna.natureza,'hipotese');
  assert.equal(t.esforco.natureza,'estimativa_editorial');
  assert.ok(t.priorizacao.criterios.some(c=>c.criterio==='retorno_comercial'&&c.valor==='nao_medido'));
  assert.equal(Object.hasOwn(t,'receitaEsperada'),false);
});
test('produto e software têm entregas distintas sem inventar condições de entrega ou demonstração',()=>{
  const compra=analisarNegocio('Equipamentos para cozinha','produtos').planoDeAcao[0];
  const software=analisarNegocio('Software de gestão de estoque','servicos').planoDeAcao[0];
  assert.equal(compra.categoria,'compra');
  assert.equal(compra.experimento.tipo,'ficha_compra');
  assert.ok(compra.modeloEntregavel.campos.some(c=>/condicoes de entrega/i.test(c.rotulo.normalize('NFD').replace(/\p{M}/gu,''))&&c.valorSugerido===null));
  assert.equal(software.experimento.tipo,'avaliacao_sistema');
  assert.ok(software.modeloEntregavel.campos.some(c=>/processo/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.ok(software.modeloEntregavel.campos.some(c=>/demonstração, se disponível/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.notDeepEqual(compra.passos,software.passos);
});
test('leitura inicial pequena pede conferência renderizada e não afirma falta de conteúdo ou uma SPA',()=>{
  const base=analisarNegocio('Consultoria de engenharia','servicos');
  const p=base.frentes[0].paginaAlvo;
  const contextoPublico={versao:1,dominio:DOMINIO,evidencias:[],cobertura:{paginas:[{url:p.url,sha256:'a'.repeat(64),coletadoEm:DATA,caracteresTextoVisivel:35,htmlInicial:true,limitada:false}]}};
  const t=analisarNegocio('Consultoria de engenharia','servicos',{contextoPublico}).planoDeAcao[0];
  assert.equal(t.categoria,'verificabilidade');
  assert.equal(t.lacuna.natureza,'evidencia_insuficiente');
  assert.match(t.acao,/amostra do HTML inicial/);
  assert.ok(t.passos.some(p=>p.includes('se o conteúdo já atende')));
  assert.ok(!/site não tem|site é uma SPA|falta conteúdo/.test(t.acao));
});
test('HTML limitado não transforma sinal de diagnóstico em ordem de edição da experiência renderizada',()=>{
  const contextoPublico={versao:1,dominio:DOMINIO,evidencias:[],cobertura:{paginas:[{url:'https://cliente.com.br/contrate',sha256:'a'.repeat(64),coletadoEm:DATA,caracteresTextoVisivel:20,htmlInicial:true,limitada:true}]}};
  const r=analisar({diagnostico:diagnosticoSite(),contextoPublico,capacidades:{posicoes:{configurada:false}}});
  const t=r.planoDeAcao[0];assert.equal(t.categoria,'verificabilidade');
  assert.equal(t.base,'hipotese');assert.equal(t.prioridade,'investigar');
  assert.equal(t.lacuna.natureza,'evidencia_insuficiente');
  assert.ok(t.passos.some(p=>p.includes('Só proponha alteração se')));
  assert.match(t.titulo,/Conferir no navegador/);
  assert.equal(r.itens[0].prioridade,'investigar');
  assert.ok(t.evidencias.some(e=>e.tipo==='diagnostico'));
});
test('evidência do negócio fora da URL, futura ou antiga não é usada para preencher uma ficha',()=>{
  const r=analisarNegocio('Manutenção de equipamentos','servicos',{contextoPublico:{versao:1,dominio:DOMINIO,evidencias:[
    {url:'https://cliente.com.br/outra-pagina',campo:'meta.description',trecho:'Oferecemos software de gestão',coletadoEm:DATA,sha256:'b'.repeat(64)},
    {url:'https://cliente.com.br/contrate',campo:'meta.description',trecho:'Software de gestão',coletadoEm:'2026-11-14T14:55:00Z',sha256:'c'.repeat(64)},
    {url:'https://cliente.com.br/contrate',campo:'meta.description',trecho:'Software de gestão',coletadoEm:'2026-11-15T15:05:00Z',sha256:'d'.repeat(64)},
  ]}});
  const t=r.planoDeAcao[0];assert.equal(t.experimento.tipo,'escopo_servico');
  assert.ok(t.evidenciasNegocio.every(e=>e.campo!=='meta.description'));
  assert.ok(t.modeloEntregavel.campos.some(c=>/equipamento/i.test(c.rotulo)));
});
test('menção a software ou artistas fora do nome da atividade não cria uma nova jornada especializada',()=>{
  const contextoPublico={versao:1,dominio:DOMINIO,evidencias:[
    {url:'https://cliente.com.br/contrate',campo:'meta.description',trecho:'Não vendemos software. Atendemos empresas que usam sistemas de gestão.',coletadoEm:DATA,sha256:'a'.repeat(64)},
  ]};
  const t=analisarNegocio('Manutenção de equipamentos','servicos',{contextoPublico}).planoDeAcao[0];
  assert.equal(t.experimento.tipo,'escopo_servico');
  const artistas=analisarNegocio('Intermediação de imóveis','intermediacao',{contextoPublico:{...contextoPublico,
    evidencias:[{...contextoPublico.evidencias[0],trecho:'Não representamos artistas; o imóvel já hospedou um show.'}]}}).planoDeAcao[0];
  assert.equal(artistas.experimento.tipo,'pedido_intermediacao');
});
test('atividade social sem oferta gera ficha de participação e não proposta de venda ou doação inventada',()=>{
  const e={url:'https://cliente.com.br/programa',campo:'meta.description',trecho:'Programa de educação comunitária',coletadoEm:DATA,sha256:'a'.repeat(64)};
  const p={...perfil([]),entendimento:{papel:'indefinido',finalidade:{tipo:'social',natureza:'hipotese'},atuacoes:[{tipo:'programa_social',nome:e.trecho,evidencias:[e]}]}};
  const r=analisar({perfil:p,palavras:{candidatos:[]}}),t=r.planoDeAcao[0];
  assert.equal(r.estado,'parcial');assert.equal(r.itens.length,0);assert.equal(r.frentes.length,0);
  assert.equal(t.categoria,'participacao');assert.deepEqual(t.ofertasAfetadas,[]);
  assert.equal(t.atuacoesRelacionadas[0].tipo,'programa_social');
  assert.ok(!/orçamento|venda|doação/i.test(t.acao));
  assert.ok(t.modeloEntregavel.campos.some(c=>/Custo ou gratuidade/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.equal(t.evidencias[0].url,e.url);
  assert.equal(Object.hasOwn(t,'valorPorContato'),false);
});
test('atividade corrigida pelo usuário pode começar sem página, preservando origem declarada',()=>{
  const p={...perfil([]),entendimento:{finalidade:{tipo:'social'},atuacoes:[{tipo:'participacao',nome:'Oficinas comunitárias',natureza:'declaracao_usuario',evidencias:[]}]}};
  const t=analisar({perfil:p,palavras:{candidatos:[]}}).planoDeAcao[0];
  assert.equal(t.paginaAlvo,null);assert.deepEqual(t.evidencias,[]);
  assert.equal(t.atuacoesRelacionadas[0].natureza,'declaracao_usuario');
  assert.ok(t.dependencias.some(d=>d.tipo==='pagina_da_atividade'&&d.estado==='pendente'));
});
test('finalidade social preserva compra comercial explicitamente declarada em Product',()=>{
  const e={url:'https://cliente.com.br/loja',campo:'jsonld.Product.name',trecho:'Camiseta institucional',coletadoEm:DATA,sha256:'a'.repeat(64)};
  const o={...oferta(),nome:e.trecho,url:e.url,evidencias:[e]};
  const r=analisar({perfil:{...perfil([o]),entendimento:{papel:'produtos',finalidade:{tipo:'social'},atuacoes:[]}},
    palavras:{candidatos:[candidato(e.trecho,{tipo:'produto',evidencia:e})]},capacidades:{posicoes:{configurada:false}}});
  assert.equal(r.planoDeAcao[0].categoria,'compra');
  assert.equal(r.planoDeAcao[0].experimento.tipo,'ficha_compra');
});
test('entendimento conflitante é esclarecido antes de escolher uma jornada comercial',()=>{
  const p={...perfil(),entendimento:{papel:'servicos',qualidade:{estado:'conflitante',motivos:['Finalidades distintas']}}};
  const t=analisar({perfil:p,capacidades:{posicoes:{configurada:false}}}).planoDeAcao[0];
  assert.equal(t.categoria,'verificabilidade');
  assert.equal(t.lacuna.natureza,'evidencia_insuficiente');
  assert.ok(!t.modeloEntregavel);
  assert.match(t.acao,/declarações|responsável/);
});
test('hospedagem pede destino, datas e hóspedes sem inventar disponibilidade ou tarifas',()=>{
  const t=analisarNegocio('Hotéis e hospedagem','servicos').planoDeAcao[0];
  assert.equal(t.experimento.tipo,'pedido_hospedagem');
  assert.ok(t.modeloEntregavel.campos.some(c=>/destino/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.ok(t.modeloEntregavel.campos.some(c=>/datas de entrada/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.ok(t.modeloEntregavel.campos.some(c=>/hóspedes/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.ok(t.modeloEntregavel.campos.some(c=>/tarifas.*confirmar/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.match(t.acao,/Hotéis e hospedagem/);
});
test('compressores pedem aplicação e ficha técnica em vez de encaminhar serviço genérico',()=>{
  const t=analisarNegocio('Compressores de ar','produtos').planoDeAcao[0];
  assert.equal(t.experimento.tipo,'especificacao_equipamento');assert.equal(t.categoria,'compra');
  assert.ok(t.modeloEntregavel.campos.some(c=>/aplicação/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.ok(t.modeloEntregavel.campos.some(c=>/ficha técnica/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.ok(t.modeloEntregavel.campos.some(c=>/requisitos técnicos/i.test(c.rotulo)&&c.valorSugerido===null));
});
test('curso, assinatura de conteúdo e assinatura eletrônica não são confundidos entre si',()=>{
  const curso=analisarNegocio('Cursos online de formação','servicos').planoDeAcao[0];
  const assinatura=analisarNegocio('Assinatura de conteúdo profissional','servicos').planoDeAcao[0];
  const documento=analisarNegocio('Assinatura eletrônica de documentos','servicos').planoDeAcao[0];
  assert.equal(curso.experimento.tipo,'ficha_inscricao');
  assert.equal(assinatura.experimento.tipo,'ficha_assinatura');
  assert.equal(documento.experimento.tipo,'escopo_servico');
  assert.ok(curso.modeloEntregavel.campos.some(c=>/acesso e duração/i.test(c.rotulo)&&c.valorSugerido===null));
  assert.ok(assinatura.modeloEntregavel.campos.some(c=>/modalidades/i.test(c.rotulo)&&c.valorSugerido===null));
});
test('doador, beneficiário e voluntário recebem percursos distintos e apoio genérico não inventa doações',()=>{
  const atuacoes=[{tipo:'captacao',nome:'Doações para os programas'},{tipo:'programa_social',nome:'Programa de educação'},
    {tipo:'participacao',nome:'Voluntariado comunitário'},{tipo:'captacao',nome:'Apoio institucional'}].map(a=>({...a,natureza:'declaracao_usuario',evidencias:[]}));
  const p={...perfil([]),entendimento:{finalidade:{tipo:'social'},atuacoes}};
  const tarefas=analisar({perfil:p,palavras:{candidatos:[]}}).planoDeAcao;
  const porNome=new Map(tarefas.map(t=>[t.atuacoesRelacionadas[0].nome,t]));
  assert.equal(tarefas.length,4);
  assert.equal(porNome.get('Doações para os programas').experimento.percurso,'doacao');
  assert.equal(porNome.get('Programa de educação').experimento.percurso,'beneficiario');
  assert.equal(porNome.get('Voluntariado comunitário').experimento.percurso,'voluntariado');
  assert.equal(porNome.get('Apoio institucional').experimento.percurso,'apoio');
  assert.ok(porNome.get('Programa de educação').modeloEntregavel.campos.some(c=>/elegibilidade/i.test(c.rotulo)));
  assert.ok(porNome.get('Doações para os programas').modeloEntregavel.campos.some(c=>/transparência/i.test(c.rotulo)));
  assert.ok(!/doação/i.test(porNome.get('Apoio institucional').acao));
  assert.ok(tarefas.every(t=>t.ofertasAfetadas.length===0&&t.evidencias.length===0));
});

function contextoDetalhado(nome,trechos,extras={}){
  const url='https://cliente.com.br/contrate',sha256=hash('fixture negócio '+nome);
  return {versao:1,dominio:DOMINIO,evidencias:[],detalhesPublicados:trechos.map(e=>({tipo:'paragrafo',campo:'p',url,sha256,coletadoEm:DATA,recortado:false,...e})),
    cobertura:{paginas:[{url,sha256,coletadoEm:DATA,caracteresTextoVisivel:2000,htmlInicial:true,limitada:false}]},...extras};
}
test('trajetórias publicadas viram comparação concreta sem transferir condições entre modalidades',()=>{
  const nome='Cursos de gestão',contextoPublico=contextoDetalhado(nome,[
    {tipo:'item',campo:'li',secao:'Trilha inicial de gestão',trecho:'Aulas gravadas para começar, com acesso por seis meses.'},
    {tipo:'item',campo:'li',secao:'Formação prática de gestão',trecho:'Aulas online ao vivo e projeto em grupo.'},
    {tipo:'item',campo:'li',secao:'MBA em gestão',trecho:'Imersão presencial e mentoria para profissionais de gestão.'},
  ]);
  const t=analisarNegocio(nome,'servicos',{contextoPublico}).planoDeAcao[0];
  assert.match(t.titulo,/Comparar trajetórias e condições publicadas/);
  assert.ok(t.passos.some(p=>p.includes('Trilha inicial de gestão')&&p.includes('MBA em gestão')));
  assert.ok(t.passos.some(p=>p.includes('associação correta')&&p.includes('Não copie condições')));
  assert.ok(t.modeloEntregavel.campos.some(c=>c.valorSugerido==='Aulas online ao vivo e projeto em grupo.'&&c.evidencia.campo==='li'));
  assert.ok(t.decisaoCliente.incertezas.length>0);
  assert.ok(t.evidenciasNegocio.every(e=>e.natureza==='trecho_literal'));
  assert.equal(t.base,'hipotese');assert.equal(t.lacuna.natureza,'hipotese');
  for(const alvo of ['Trilha inicial de gestão','Formação prática de gestão','MBA em gestão']){
    assert.ok(t.entregavel.includes(alvo));assert.ok(t.criterioSucesso.includes(alvo));assert.ok(t.experimento.objetivo.includes(alvo));
  }
  assert.doesNotMatch(t.entregavel,/Registro da distinção entre aulas ao vivo/);
});
test('uma única modalidade não é apresentada como diferença entre várias trajetórias',()=>{
  const nome='Cursos de fotografia',contextoPublico=contextoDetalhado(nome,[{tipo:'cabecalho',campo:'h3',secao:'Formação em fotografia',trecho:'Formação em fotografia'},
    {secao:'Formação em fotografia',trecho:'Aulas presenciais para profissionais iniciantes.'}]);
  const t=analisarNegocio(nome,'servicos',{contextoPublico}).planoDeAcao[0];
  assert.doesNotMatch(t.titulo,/Comparar as trajetórias/);assert.doesNotMatch(t.acao,/diferença entre/);
});
test('cortesia vinculada à atividade preserva condição e não vira contratação avulsa',()=>{
  const nome='Equipamentos de surfe',contextoPublico=contextoDetalhado(nome,[{secao:nome,trecho:'Os equipamentos de surfe estão disponíveis como cortesia para hóspedes; consulte a equipe sobre uso e disponibilidade.'}]);
  const t=analisarNegocio(nome,'servicos',{contextoPublico}).planoDeAcao[0];
  assert.equal(t.experimento.tipo,'conferir_vinculo_da_comodidade');assert.equal(t.categoria,'uso');
  assert.match(t.acao,/atividade principal/);
  assert.ok(t.passos.some(p=>p.includes('Não trate a comodidade como venda')));
  assert.ok(t.modeloEntregavel.campos.some(c=>c.origem==='trecho_publicado'&&c.valorSugerido.includes('cortesia para hóspedes')));
});
test('cortesia negada, recortada ou ligada a outra atividade não muda a jornada da oferta',()=>{
  const nome='Equipamentos de surfe';
  for(const detalhe of [
    {secao:nome,trecho:'Os equipamentos de surfe não estão disponíveis como cortesia.'},
    {secao:nome,trecho:'Os equipamentos de surfe estão disponíveis como cortesia',recortado:true},
    {secao:'Brindes',trecho:'A camiseta da recepção é uma cortesia para hóspedes.'},
  ]){
    const t=analisarNegocio(nome,'servicos',{contextoPublico:contextoDetalhado(nome,[detalhe])}).planoDeAcao[0];
    assert.notEqual(t.experimento.tipo,'comodidade_vinculada');
  }
});
test('detalhe de outra captura ou outra URL não preenche a ficha atual',()=>{
  const nome='Cursos de gestão';
  for(const adulteracao of [{sha256:'a'.repeat(64)},{coletadoEm:'2026-11-14T14:55:00Z'},
    {coletadoEm:'2026-11-15T15:05:00Z'},{url:'https://cliente.com.br/outra'}]){
    const t=analisarNegocio(nome,'servicos',{contextoPublico:contextoDetalhado(nome,[{trecho:'Aulas online ao vivo com mentoria profissional.',...adulteracao}])}).planoDeAcao[0];
    assert.ok(t.modeloEntregavel.campos.every(c=>c.valorSugerido!=='Aulas online ao vivo com mentoria profissional.'));
  }
});
test('restaurante tem encaminhamento de mesa e Course explícito mantém inscrição sem nome genérico de curso',()=>{
  const restaurante=analisarNegocio('Restaurantes e gastronomia','servicos').planoDeAcao[0];
  assert.equal(restaurante.experimento.tipo,'reserva_restaurante');
  assert.ok(restaurante.modeloEntregavel.campos.some(c=>/Data, horário e quantidade/.test(c.rotulo)));
  const nome='Gestão de Projetos e Metodologias Ágeis',e={url:'https://cliente.com.br/contrate',campo:'jsonld.Course.name',trecho:nome,coletadoEm:DATA,sha256:hash('fixture negócio '+nome)};
  const curso=analisarNegocio(nome,'servicos',{perfil:{...perfil([{...oferta(),nome,evidencias:[e]}]),entendimento:{papel:'servicos'}},palavras:{candidatos:[candidato(nome,{evidencia:e})]}}).planoDeAcao[0];
  assert.equal(curso.experimento.tipo,'ficha_inscricao');
});

test('condição de outra atividade na mesma página não preenche nem fundamenta a ficha da aula',()=>{
  const nome='Aula de culinária baiana',contextoPublico=contextoDetalhado(nome,[
    {secao:'Piquenique na praia',trecho:'Oferecemos três modalidades de piquenique no hotel para a família.'},
    {secao:nome,trecho:'A aula de culinária baiana inclui encontro presencial na cozinha, com orientação da equipe.'},
  ]);
  const t=analisarNegocio(nome,'servicos',{contextoPublico}).planoDeAcao[0];
  assert.ok(t.modeloEntregavel.campos.some(c=>c.origem==='trecho_publicado'&&c.valorSugerido.includes('encontro presencial na cozinha')));
  assert.ok(t.modeloEntregavel.campos.every(c=>!String(c.valorSugerido).includes('piquenique')));
  assert.ok(t.evidenciasNegocio.every(e=>!e.trecho.includes('piquenique')));
});
test('achado de nomes acessíveis é conferido na jornada de mesa, sem supor que todo controle é de reserva',()=>{
  const nome='Restaurantes e gastronomia',contextoPublico=contextoDetalhado(nome,[{secao:'Restaurantes',trecho:'Atuamos na gastronomia com restaurantes em três cidades.'}]);
  const t=analisarNegocio(nome,'servicos',{contextoPublico,diagnostico:diagnosticoSite()}).planoDeAcao[0];
  assert.equal(t.tipo,'corrigir_uso');assert.equal(t.base,'observacao');
  assert.ok(t.passos.some(p=>p.includes('restaurante e a unidade')&&p.includes('reserva de mesa')));
  assert.ok(t.passos.some(p=>p.includes('não prova que todos pertençam')));
  assert.ok(t.evidencias.some(e=>e.tipo==='diagnostico'));
  assert.ok(t.evidenciasNegocio.every(e=>e.natureza==='trecho_literal'&&!/controle\(s\)/.test(e.trecho)));
});
test('leitura contextual atual confirma a página já coletada sem inventar posição ou mandar reler',()=>{
  const nome='Cursos de gestão',contextoPublico=contextoDetalhado(nome,[{trecho:'Cursos de gestão online com aulas ao vivo.'}]);
  const r=analisarNegocio(nome,'servicos',{contextoPublico,palavras:{candidatos:[candidato('Contratar cursos de gestão',{origem:'hipotese',evidencia:null})]}}),i=r.itens[0];
  assert.equal(i.paginaAlvo.origem,'observada');assert.equal(i.paginaAlvo.verificacao,'contexto_publico');
  assert.equal(i.paginaAlvo.coletadoEm,DATA);assert.equal(i.proximoTeste.tipo,'conferir_oferta');
  assert.equal(i.observado.posicao,null);assert.equal(i.observado.buscasMensais,null);
  assert.ok(i.evidencias.every(e=>e.tipo!=='site'&&e.tipo!=='google'));
});
test('cobertura contextual sem trecho literal coincidente ou fora da validade não confirma página',()=>{
  const nome='Cursos de gestão',url='https://cliente.com.br/contrate';
  const o={...oferta(),nome,evidencias:[]};
  const p={...perfil([o]),entendimento:{papel:'servicos'}};
  for(const alteracao of [{sha256:'b'.repeat(64)},{coletadoEm:'2026-11-14T14:55:00Z'},
    {coletadoEm:'2026-11-15T15:05:00Z'},{url:'https://cliente.com.br/outra'}]){
    const contextoPublico=contextoDetalhado(nome,[{trecho:nome,...alteracao}]);
    const r=analisar({perfil:p,contextoPublico,palavras:{candidatos:[candidato('Contratar cursos de gestão',{origem:'hipotese',evidencia:null})]},capacidades:{posicoes:{configurada:false}}});
    assert.equal(r.itens[0].paginaAlvo.origem,'declarada');assert.equal(r.itens[0].proximoTeste.tipo,'reler_pagina');
  }
  const contextoPublico=contextoDetalhado(nome,[]);contextoPublico.evidencias=[{tipo:'diagnostico',campo:'p',trecho:'9 controles',url,sha256:contextoPublico.cobertura.paginas[0].sha256,coletadoEm:DATA}];
  const r=analisar({perfil:p,contextoPublico,palavras:{candidatos:[candidato('Contratar cursos de gestão',{origem:'hipotese',evidencia:null})]},capacidades:{posicoes:{configurada:false}}});
  assert.equal(r.itens[0].paginaAlvo.origem,'declarada');
});
test('importância declarada organiza tarefas de ofertas antes de atividade complementar sem estimar retorno',()=>{
  const principal={...oferta(),id:'principal',nome:'Hospedagem',centralidade:{nivel:'principal',natureza:'declaracao_usuario'}};
  const complementar={...oferta(),id:'complementar',nome:'Aulas de culinária',url:'https://cliente.com.br/experiencias',centralidade:{nivel:'complementar',natureza:'hipotese'}};
  const r=analisar({perfil:perfil([complementar,principal]),palavras:{candidatos:[candidato(complementar.nome,{ofertaId:complementar.id}),candidato(principal.nome,{ofertaId:principal.id})]},capacidades:{posicoes:{configurada:false}}});
  assert.equal(r.frentes[0].ofertaId,principal.id);assert.equal(r.planoDeAcao[0].ofertasAfetadas[0].id,principal.id);
  assert.equal(r.planoDeAcao[0].centralidade.natureza,'declaracao_usuario');
  assert.equal(r.itens[0].observado.buscasMensais,null);assert.equal(Object.hasOwn(r.planoDeAcao[0],'receitaEsperada'),false);
});
test('condição publicada de aulas ao vivo e gravadas gera conferência dessa diferença, sem inventar agenda',()=>{
  const nome='Pós-graduação em gestão de projetos',contextoPublico=contextoDetalhado(nome,[{secao:nome,trecho:'A pós-graduação em gestão de projetos tem 360 horas, com aulas ao vivo e gravadas.'},
    {secao:nome,trecho:'Professores focados somente em carreira acadêmica.'}]);
  const t=analisarNegocio(nome,'servicos',{contextoPublico}).planoDeAcao[0];
  assert.match(t.titulo,/distinção entre aulas ao vivo e gravadas/);
  assert.ok(t.passos.some(p=>p.includes('encontra como conferir a agenda')&&p.includes('não prometa horários')));
  assert.ok(t.modeloEntregavel.campos.every(c=>!String(c.valorSugerido).includes('Professores focados')));
  assert.match(t.entregavel,/aulas ao vivo e conteúdo gravado/);
});
test('programa publicado para educadores e redes não vira matrícula direta ou promessa de gratuidade',()=>{
  const nome='Propostas educacionais',e={url:'https://cliente.com.br/programa',campo:'p',trecho:'Desenvolvemos propostas educacionais para professores, gestores e redes de ensino.',coletadoEm:DATA,sha256:hash('programa educacional')};
  const p={...perfil([]),entendimento:{papel:'indefinido',finalidade:{tipo:'social'},atuacoes:[{nome,tipo:'programa_social',evidencias:[e]}]}};
  const t=analisar({perfil:p,palavras:{candidatos:[]}}).planoDeAcao[0];
  assert.match(t.titulo,/encaminhamento institucional/);
  assert.ok(t.passos.some(p=>p.includes('parceria')&&p.includes('não presuma matrícula direta, custo ou gratuidade')));
  assert.ok(!t.modeloEntregavel.campos.some(c=>/Custo ou gratuidade/.test(c.rotulo)&&c.valorSugerido!==null));
  assert.deepEqual(t.ofertasAfetadas,[]);assert.equal(Object.hasOwn(t,'valorPorContato'),false);
});
test('página de contato usa nomes realmente publicados para conferir a unidade e o próximo passo de reserva',()=>{
  const nome='Hotéis',url='https://cliente.com.br/contato/',sha256=hash('fixture negócio '+nome),e={url,campo:'h2',trecho:nome,coletadoEm:DATA,sha256};
  const contextoPublico=contextoDetalhado(nome,[{url,tipo:'cabecalho',campo:'h3',trecho:'Hotel da cidade A'},
    {url,tipo:'cabecalho',campo:'h3',trecho:'Hotel da cidade B'}],{cobertura:{paginas:[{url,sha256,coletadoEm:DATA,caracteresTextoVisivel:700,htmlInicial:true,limitada:false}]}});
  const p={...perfil([{...oferta(),nome,url,evidencias:[e]}]),entendimento:{papel:'servicos'}};
  const t=analisar({perfil:p,palavras:{candidatos:[candidato(nome,{evidencia:e})]},contextoPublico,capacidades:{posicoes:{configurada:false}}}).planoDeAcao[0];
  assert.match(t.titulo,/unidade publicada ao canal de reserva/);
  assert.match(t.acao,/Hotel da cidade A/);assert.match(t.acao,/Não presume.*disponibilidade ou tarifas/);
  assert.ok(t.modeloEntregavel.campos.some(c=>c.valorSugerido==='Hotel da cidade B'&&c.evidencia.url===url));
  assert.ok(t.passos.some(p=>p.includes('contato por um formulário novo')));
});
test('fila de diagnóstico conserva o tipo Course e a importância da oferta ao especificar seu percurso',()=>{
  const nome='Gestão de Projetos e Metodologias Ágeis',e={url:'https://cliente.com.br/contrate',campo:'jsonld.Course.name',trecho:nome,coletadoEm:DATA,sha256:hash('fixture negócio '+nome)};
  const o={...oferta(),nome,evidencias:[e],centralidade:{nivel:'principal',natureza:'declaracao_usuario',motivos:['Atividade principal confirmada']}};
  const p={...perfil([o]),entendimento:{papel:'servicos'}};
  const t=analisar({perfil:p,palavras:{candidatos:[candidato(nome,{evidencia:e})]},diagnostico:diagnosticoSite(),capacidades:{posicoes:{configurada:false}}}).planoDeAcao[0];
  assert.ok(t.passos.some(p=>p.includes('público e o formato da formação')&&p.includes('inscrição')));
  assert.equal(t.centralidade.nivel,'principal');
  assert.ok(t.priorizacao.criterios.some(c=>c.criterio==='importancia_no_negocio'&&c.valor==='principal'));
  assert.ok(t.evidenciasNegocio.some(e=>e.campo==='jsonld.Course.name'));
});
test('dois cursos da mesma URL conservam rascunhos individuais e compartilham somente o achado técnico',()=>{
  const url='https://cliente.com.br/contrate',sha256=hash('catalogo com dois cursos');
  const cursos=[['curso-dados','Curso de Análise de Dados'],['curso-projetos','Curso de Gestão de Projetos']].map(([id,nome])=>({...oferta(),id,nome,url,
    evidencias:[{url,campo:'jsonld.Course.name',trecho:nome,coletadoEm:DATA,sha256}]}));
  const entrada={perfil:{...perfil(cursos),entendimento:{papel:'servicos'}},palavras:{candidatos:cursos.map(o=>candidato(o.nome,{ofertaId:o.id,evidencia:o.evidencias[0]}))},capacidades:{posicoes:{configurada:false}}};
  const semAchado=analisar(entrada).planoDeAcao;
  assert.equal(semAchado.length,2);assert.equal(new Set(semAchado.map(t=>t.id)).size,2);
  for(const o of cursos){const t=semAchado.find(t=>t.ofertasAfetadas.some(x=>x.id===o.id));assert.equal(t.ofertasAfetadas.length,1);
    assert.equal(t.experimento.ofertaId,o.id);assert.equal(t.modeloEntregavel.campos[0].valorSugerido,o.nome);}
  const compartilhado=analisar({...entrada,diagnostico:diagnosticoSite()}).planoDeAcao;
  assert.equal(compartilhado.length,1);assert.equal(compartilhado[0].tipo,'corrigir_uso');
  assert.equal(compartilhado[0].ofertasAfetadas.length,2);assert.equal(compartilhado[0].melhoriasObservadas.length,1);
});

function contextoComInteracoes(nome,rotulos,trechos=[],alterar={}){
  const c=contextoDetalhado(nome,trechos),p=c.cobertura.paginas[0];
  c.interacoesPublicas=rotulos.map((r,i)=>({id:'i'+i,grupoId:'g1',tipoGrupo:'formulario',tipo:'campo',rotulo:r,trecho:r,campo:'label.texto',url:p.url,sha256:p.sha256,coletadoEm:DATA,
    acao:'indefinida',natureza:'interface_publica',modo:'nao_preenchido',htmlInicial:true,...(r==='Buscar'?{tipo:'botao',campo:'button.texto',acao:'buscar'}:{}),...alterar}));
  return c;
}
test('decisão com condições públicas permanece separada do achado técnico, sem escondê-lo',()=>{
  const nome='Pós-graduação em gestão de projetos',contextoPublico=contextoDetalhado(nome,[{secao:nome,trecho:'A pós-graduação em gestão de projetos combina aulas ao vivo e gravadas.'}]);
  const r=analisarNegocio(nome,'servicos',{contextoPublico,diagnostico:diagnosticoSite()});
  assert.equal(r.planoNegocio.length,1);assert.equal(r.planoDeAcao[0].eixo,'negocio');
  assert.ok(r.planoDeAcao.some(t=>t.eixo==='tecnico'&&t.melhoriasObservadas.length===1));
  assert.equal(r.frentes[0].testeNegocio,r.frentes[0].proximoTeste);assert.equal(r.planoNegocio[0].base,'hipotese');
  assert.equal(r.planoNegocio[0].prioridade,'investigar');
  assert.ok(r.planoNegocio[0].evidencias.every(e=>e.tipo!=='diagnostico'));
  assert.ok(r.planoNegocio[0].decisaoCliente.fatos.every(f=>f.evidencias.length>0));
});
test('publicação e economia declarada conservam prioridade antes da decisão de negócio',()=>{
  const nome='Cursos online',contextoPublico=contextoDetalhado(nome,[{secao:nome,trecho:'Cursos online com aulas ao vivo e gravadas.'}]);
  const publicacao=analisarNegocio(nome,'servicos',{contextoPublico,diagnostico:diagnosticoSite({noindex:true})});
  assert.equal(publicacao.planoDeAcao[0].eixo,'publicacao');assert.ok(publicacao.planoNegocio.length>0);
  const o={...oferta({contribuicaoPorVenda:-30,taxaFechamento:0.5}),nome,evidencias:[{url:'https://cliente.com.br/contrate',campo:'jsonld.Course.name',trecho:nome,coletadoEm:DATA,sha256:hash('fixture negócio '+nome)}]};
  const economia=analisarNegocio(nome,'servicos',{contextoPublico,perfil:{...perfil([o]),entendimento:{papel:'servicos'}}});
  assert.equal(economia.planoDeAcao[0].tipo,'validar_economia');assert.ok(economia.planoNegocio.length>0);
});
test('passagens exigem origem, destino, data e busca no mesmo grupo estrutural público',()=>{
  const nome='Passagens de ônibus online',contextoPublico=contextoComInteracoes(nome,['Origem','Destino','Data de ida','Data de volta','Buscar']);
  const r=analisarNegocio(nome,'intermediacao',{contextoPublico}),t=r.planoNegocio[0];
  assert.equal(t.experimento.tipo,'escolher_trajeto_e_bilhete');
  assert.ok(t.decisaoCliente.percurso.includes('Origem')&&t.decisaoCliente.percurso.includes('Destino'));
  assert.ok(t.passos.some(p=>p.includes('sem enviar a busca')));
  assert.ok(t.decisaoCliente.fatos.some(f=>f.evidencias[0].natureza==='rotulo_literal'));
  assert.equal(r.itens[0].observado.posicao,null);assert.equal(r.itens[0].observado.buscasMensais,null);
  const dividido=structuredClone(contextoPublico);dividido.interacoesPublicas[1].grupoId='outro-formulario';
  assert.equal(analisarNegocio(nome,'intermediacao',{contextoPublico:dividido}).planoNegocio.length,0);
  const pagina=structuredClone(contextoPublico);pagina.interacoesPublicas.forEach(e=>e.tipoGrupo='pagina');
  assert.equal(analisarNegocio(nome,'intermediacao',{contextoPublico:pagina}).planoNegocio.length,0);
});
test('controle isolado, grupo adulterado ou evidência temporal divergente não comprovam uma decisão pública',()=>{
  const nome='Passagens de ônibus online';
  for(const mudanca of [{modo:'preenchido'},{natureza:'diagnostico'},{htmlInicial:false},{sha256:'f'.repeat(64)},
    {coletadoEm:'2026-11-14T14:55:00Z'},{coletadoEm:'2026-11-15T15:05:00Z'},{url:'https://terceiro.com.br/'}]){
    const c=contextoComInteracoes(nome,['Origem','Destino','Data de ida','Buscar'],[],mudanca);
    assert.equal(analisarNegocio(nome,'intermediacao',{contextoPublico:c}).planoNegocio.length,0);
  }
  const c=contextoComInteracoes(nome,['Origem','Destino','Data de ida','Buscar']);c.interacoesPublicas.forEach(e=>e.value='DADO_PRIVADO');
  assert.ok(!JSON.stringify(analisarNegocio(nome,'intermediacao',{contextoPublico:c}).planoNegocio).includes('DADO_PRIVADO'));
});
test('o botão de orçamento de outro serviço não é usado para encaminhar a oferta',()=>{
  const nome='Reparos de ar-condicionado',c=contextoComInteracoes(nome,['Chuveiro elétrico plástico comum · pedir orçamento'],[
    {secao:nome,trecho:'Reparos de ar-condicionado com garantia de três meses. Peça seu orçamento à equipe local.'}
  ],{tipo:'botao',tipoGrupo:'pagina',acao:'solicitar_orcamento',campo:'button.texto'});
  const t=analisarNegocio(nome,'servicos',{contextoPublico:c}).planoNegocio[0];
  assert.ok(t);assert.ok(t.evidenciasNegocio.every(e=>!e.trecho.includes('Chuveiro')));
  assert.ok(t.decisaoCliente.fatos.some(f=>f.descricao.includes('garantia')));
});
test('catálogo e canal de compra não atribuem tecnologia de marca a cada modelo nem presumem checkout',()=>{
  const nome='Metais e produtos para banheiro',c=contextoComInteracoes(nome,['Buscar produtos','Onde encontrar'],[
    {secao:'Produtos',trecho:'Produtos para banheiro e cozinha, com linhas e tecnologias disponíveis no catálogo.'}
  ],{tipo:'link',tipoGrupo:'pagina',acao:'buscar',campo:'a.texto'});
  const t=analisarNegocio(nome,'produtos',{contextoPublico:c}).planoNegocio[0];
  assert.equal(t.experimento.tipo,'distinguir_catalogo_e_canal_de_compra');
  assert.ok(t.passos.some(p=>p.includes('não pode ser atribuído automaticamente')));
  assert.ok(t.decisaoCliente.incertezas.some(p=>p.includes('checkout')));
});
test('um checklist sem condição ou interação específica fica fora da fila de negócio',()=>{
  const r=analisarNegocio('Serviço de qualidade','servicos');
  assert.equal(r.planoNegocio.length,0);assert.ok(r.planoDeAcao.every(t=>t.eixo==='qualificacao'));
  assert.equal(r.frentes[0].testeNegocio,null);
});
test('entrega B2B usa responsabilidade publicada sem converter equipe em produto autônomo ou ROI',()=>{
  const nome='Equipes de software',c=contextoComInteracoes(nome,['Contato'],[
    {secao:nome,trecho:'Nosso modelo de entrega de software atende demandas do requisito ao deploy.'},
    {secao:nome,trecho:'Humanos definem prioridades e validam decisões críticas; agentes estruturam a execução.'}
  ],{tipo:'link',tipoGrupo:'pagina',acao:'contatar',campo:'a.texto'});
  const t=analisarNegocio(nome,'servicos',{contextoPublico:c}).planoNegocio[0];
  assert.equal(t.experimento.tipo,'definir_demanda_e_validacao_da_entrega');
  assert.ok(t.passos.some(p=>p.includes('condição observável de aceite')));
  assert.ok(t.decisaoCliente.fatos.some(f=>f.descricao.includes('Humanos definem prioridades')));
  assert.ok(t.decisaoCliente.resultadoAConferir.includes('não presume software pronto'));
});
test('fila social distingue finalidade territorial, fomento e influência sem inventar benefício aberto',()=>{
  const nome='Programa de desenvolvimento local',url='https://cliente.com.br/contrate',sha256=hash('fixture negócio '+nome),
    e={url,campo:'p',trecho:'Programa de desenvolvimento local com presença no território.',coletadoEm:DATA,sha256};
  const c=contextoDetalhado(nome,[{secao:'Desenvolvimento local',trecho:e.trecho},
    {secao:'Fomento a agentes',trecho:'Investimentos para apoiar iniciativas locais.'},
    {secao:'Programas de influência',trecho:'Atuação para influenciar a opinião pública e enfrentar desigualdades.'}]);
  const p={...perfil([]),entendimento:{papel:'indefinido',finalidade:{tipo:'social'},atuacoes:[{nome,tipo:'programa_social',evidencias:[e]}]}};
  const r=analisar({perfil:p,palavras:{candidatos:[]},contextoPublico:c}),t=r.planoNegocio[0];
  assert.equal(t.experimento.tipo,'escolher_frente_de_atuacao_social');assert.equal(t.decisaoCliente.percurso.length,3);
  assert.ok(t.passos.some(p=>p.includes('não presuma edital ou benefício aberto')));
  assert.deepEqual(t.ofertasAfetadas,[]);assert.equal(Object.hasOwn(t,'valorPorContato'),false);
});
test('a mesma decisão com condição pública compartilhada reúne ofertas e preserva páginas e fatos de cada uma',()=>{
  const u1='https://cliente.com.br/projetos',u2='https://cliente.com.br/squads',h1=hash('projetos'),h2=hash('squads'),
    e1={url:u1,campo:'p',trecho:'Entregamos projetos e equipes de tecnologia.',coletadoEm:DATA,sha256:h1},
    e2={url:u2,campo:'p',trecho:'Squads de software é o modelo de entrega de software de requisitos ao deploy.',coletadoEm:DATA,sha256:h2},
    papel={url:u1,campo:'p',trecho:'Squads de software: humanos definem prioridades e validam decisões críticas.',coletadoEm:DATA,sha256:h1};
  const ofertas=[{...oferta(),id:'projetos',nome:'projetos e equipes de tecnologia',url:u1,evidencias:[e1]},
    {...oferta(),id:'squads',nome:'Squads de software',url:u2,evidencias:[e2]}];
  const contextoPublico={versao:1,dominio:DOMINIO,evidencias:[e1,e2,papel],detalhesPublicados:[],cobertura:{paginas:[
    {url:u1,sha256:h1,coletadoEm:DATA,caracteresTextoVisivel:900},{url:u2,sha256:h2,coletadoEm:DATA,caracteresTextoVisivel:900}]},
    interacoesPublicas:[u1,u2].map((url,i)=>({url,sha256:i?h2:h1,coletadoEm:DATA,tipo:'link',tipoGrupo:'pagina',grupoId:'grupo'+i,rotulo:'Contato',trecho:'Contato',campo:'a.texto',acao:'contatar',natureza:'interface_publica',modo:'nao_preenchido',htmlInicial:true}))};
  const r=analisar({perfil:{...perfil(ofertas),entendimento:{papel:'servicos'}},palavras:{candidatos:ofertas.map(o=>candidato(o.nome,{ofertaId:o.id,evidencia:o.evidencias[0]}))},contextoPublico,capacidades:{posicoes:{configurada:false}}});
  assert.equal(r.planoNegocio.length,1);const t=r.planoNegocio[0];assert.equal(t.ofertasAfetadas.length,2);assert.equal(t.escoposPorOferta.length,2);
  assert.deepEqual(new Set(t.paginasRelacionadas.map(p=>p.url)),new Set([u1,u2]));
  assert.equal(t.decisaoCliente.objetos.length,2);assert.ok(t.decisaoCliente.fatos.some(f=>f.descricao===e1.trecho));assert.ok(t.decisaoCliente.fatos.some(f=>f.descricao===e2.trecho));
  assert.equal(t.experimento.ofertaId,null);assert.equal(r.frentes.length,2);
});
test('cursos com condições próprias na mesma URL continuam como decisões distintas',()=>{
  const url='https://cliente.com.br/contrate',sha256=hash('dois cursos com condições diferentes'),
    nomes=['Curso de Dados','Curso de Projetos'],ofertas=nomes.map((nome,i)=>({...oferta(),id:'curso'+i,nome,url,
      evidencias:[{url,campo:'jsonld.Course.name',trecho:nome,sha256,coletadoEm:DATA}]}));
  const c={versao:1,dominio:DOMINIO,evidencias:[],cobertura:{paginas:[{url,sha256,coletadoEm:DATA,caracteresTextoVisivel:1500}]},
    detalhesPublicados:nomes.map((nome,i)=>({url,sha256,coletadoEm:DATA,tipo:'paragrafo',campo:'p',secao:nome,trecho:nome+' tem '+(i?'60':'30')+' horas com aulas ao vivo e gravadas.',recortado:false}))};
  const r=analisar({perfil:{...perfil(ofertas),entendimento:{papel:'servicos'}},palavras:{candidatos:ofertas.map(o=>candidato(o.nome,{ofertaId:o.id,evidencia:o.evidencias[0]}))},contextoPublico:c,capacidades:{posicoes:{configurada:false}}});
  assert.equal(r.planoNegocio.length,2);assert.ok(r.planoNegocio.every(t=>t.ofertasAfetadas.length===1));
  assert.ok(r.planoNegocio.some(t=>t.decisaoCliente.fatos.some(f=>f.descricao.includes('30 horas'))));
  assert.ok(r.planoNegocio.some(t=>t.decisaoCliente.fatos.some(f=>f.descricao.includes('60 horas'))));
});
test('aliases na mesma página compartilham a decisão somente quando escolha, percurso e fatos são idênticos',()=>{
  const url='https://cliente.com.br/contrate',sha256=hash('modalidades públicas compartilhadas'),
    nomes=['Cursos de gestão','Trilhas, cursos e MBA de gestão'],ofertas=nomes.map((nome,i)=>({...oferta(),id:'alias'+i,nome,url,
      evidencias:[{url,campo:'jsonld.Service.name',trecho:nome,sha256,coletadoEm:DATA}]}));
  const c={versao:1,dominio:DOMINIO,evidencias:[],cobertura:{paginas:[{url,sha256,coletadoEm:DATA,caracteresTextoVisivel:1500}]},
    detalhesPublicados:[{secao:'Trilha de gestão',trecho:'Aulas gravadas de gestão com acesso por seis meses.'},
      {secao:'MBA em gestão',trecho:'Aulas de gestão ao vivo com mentoria para profissionais.'}].map(e=>({...e,url,sha256,coletadoEm:DATA,tipo:'item',campo:'li',recortado:false}))};
  const r=analisar({perfil:{...perfil(ofertas),entendimento:{papel:'servicos'}},palavras:{candidatos:ofertas.map(o=>candidato(o.nome,{ofertaId:o.id,evidencia:o.evidencias[0]}))},contextoPublico:c,capacidades:{posicoes:{configurada:false}}});
  assert.equal(r.planoNegocio.length,1);const t=r.planoNegocio[0];
  assert.equal(t.ofertasAfetadas.length,2);assert.equal(t.escoposPorOferta.length,2);assert.equal(t.paginasRelacionadas.length,1);
  assert.equal(t.experimento.tipo,'comparar_modalidades');assert.equal(t.experimento.ofertaId,null);
});
test('engenharia e desenvolvimento de software são escopo de serviço, não avaliação de um sistema pronto',()=>{
  for(const nome of ['Engenharia de software','Desenvolvimento de software','Projetos e equipes de software']){
    const r=analisarNegocio(nome,'servicos');
    assert.equal(r.planoNegocio.length,0);
    assert.equal(r.planoDeAcao[0].experimento.tipo,'escopo_servico');
    assert.ok(!r.planoDeAcao[0].titulo.includes('avaliação do sistema'));
  }
  assert.equal(analisarNegocio('Sistema de gestão ERP','servicos').planoDeAcao[0].experimento.tipo,'avaliacao_sistema');
});
