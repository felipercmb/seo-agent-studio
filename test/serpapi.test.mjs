import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ErroFonte, verificarContaGratuita, consultarGoogle} from '../src/serpapi.mjs';

const CHAVE = 'chave_ficticia_apenas_para_testes_1234567890123456789012345678901234';
const AGORA = '2026-11-14T15:00:00.000Z';
const agora = () => AGORA;
const entrada = {termo: 'consultoria ambiental', dominio: 'cliente.com.br', chave: CHAVE};
const conta = () => ({account_status: 'Active', plan_id: 'free', plan_name: 'Free Plan', plan_monthly_price: 0,
  plan_renewal_date: '2026-12-14', searches_per_month: 250, plan_searches_left: 249,
  extra_credits: 0, total_searches_left: 249, this_month_usage: 1, this_hour_searches: 0,
  account_rate_limit_per_hour: 50, api_key: CHAVE, account_email: 'privado@exemplo.com'});
const serp = () => ({
  search_metadata: {id: 'captura_123456', status: 'Success', created_at: '2026-11-14 14:59:30 UTC',
    processed_at: '2026-11-14 14:59:32 UTC', google_url: 'https://www.google.com.br/search?q=consultoria+ambiental'},
  search_parameters: {engine: 'google', q: entrada.termo, gl: 'br', hl: 'pt', google_domain: 'google.com.br',
    device: 'desktop', location_requested: 'Brazil', location_used: 'Brazil', start: 0},
  search_information: {page_number: 1, query_displayed: entrada.termo, organic_results_state: 'Results for exact spelling'},
  organic_results: [
    {position: 1, title: 'Concorrente A', link: 'https://rival.com.br/servico'},
    {position: 2, title: 'Concorrente A — outra página', link: 'https://www.rival.com.br/ambiental'},
    {position: 3, title: 'Cliente', link: 'https://loja.cliente.com.br/ambiental'},
  ],
  ads: [{position: 1, title: 'Anúncio', link: 'https://cliente.com.br/'}],
  local_results: {places: [{position: 1, website: 'https://cliente.com.br/'}]},
});
function transporte({account = conta(), search = serp(), responder} = {}) {
  const chamadas = [];
  const fetch = async (endereco, init) => {
    const url = new URL(endereco);
    chamadas.push({url, init});
    assert.equal(url.origin, 'https://serpapi.com');
    assert.equal(url.searchParams.get('api_key'), CHAVE);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.method, 'GET');
    if (responder) return responder(url, init);
    if (url.pathname === '/account.json') return Response.json(account);
    assert.equal(url.pathname, '/search.json');
    return Response.json(search);
  };
  return {fetch, chamadas, agora};
}
const codigo = esperado => erro => {
  assert.ok(erro instanceof ErroFonte);
  assert.equal(erro.codigo, esperado);
  assert.ok(!erro.message.includes(CHAVE));
  assert.ok(!erro.message.includes('privado@exemplo.com'));
  return true;
};

test('conta gratuita retorna apenas cota normalizada e nunca identidade ou chave', async () => {
  const t = transporte();
  assert.deepEqual(await verificarContaGratuita(CHAVE, t), {plano: 'free', limiteMensal: 250, restantes: 249,
    renovacaoEm: '2026-12-14', limitePorHora: 50, usadasNestaHora: 0, verificadoEm: AGORA});
  assert.equal(t.chamadas.length, 1);
  assert.equal(t.chamadas[0].url.pathname, '/account.json');
});

test('recusa contas pagas, créditos extras e formas desconhecidas antes de pesquisar', async t => {
  for (const alteracao of [
    {plan_id: 'starter'}, {plan_name: 'Starter Plan'}, {plan_monthly_price: 25}, {extra_credits: 1},
    {plan_id: undefined}, {plan_monthly_price: '0'}, {searches_per_month: 1000},
    {plan_searches_left: '249'}, {plan_searches_left: -1}, {total_searches_left: 250},
    {this_month_usage: 0}, {account_rate_limit_per_hour: 51}, {this_hour_searches: -1},
    {plan_renewal_date: null}, {plan_renewal_date: '2026-02-31'}, {plan_renewal_date: 'amanhã'},
  ]) await t.test(JSON.stringify(alteracao), async () => {
    const tr = transporte({account: {...conta(), ...alteracao}});
    await assert.rejects(consultarGoogle(entrada, tr), codigo('plano_incompativel'));
    assert.equal(tr.chamadas.length, 1);
  });
});

test('cota mensal ou horária esgotada impede qualquer busca', async () => {
  for (const alteracao of [
    {plan_searches_left: 0, total_searches_left: 0, this_month_usage: 250}, {this_hour_searches: 50},
  ]) {
    const tr = transporte({account: {...conta(), ...alteracao}});
    await assert.rejects(consultarGoogle(entrada, tr), codigo('cota'));
    assert.equal(tr.chamadas.length, 1);
  }
});

test('posição e concorrentes vêm da mesma primeira página orgânica, com contexto e hash', async () => {
  const tr = transporte();
  const r = await consultarGoogle(entrada, tr);
  assert.equal(r.estado, 'encontrado');
  assert.equal(r.posicao, 3);
  assert.equal(r.url, 'https://loja.cliente.com.br/ambiental');
  assert.equal(r.profundidadeObservada, 3);
  assert.deepEqual(r.resultados.map(x => x.posicao), [1, 2, 3]);
  assert.deepEqual(r.acima.map(x => [x.dominio, x.posicao]), [['rival.com.br', 1]]);
  assert.deepEqual(r.contexto, {pais: 'Brasil', idioma: 'Português', dispositivo: 'Computador', localidade: 'Brasil'});
  assert.equal(r.coletadoEm, '2026-11-14T14:59:30.000Z');
  assert.deepEqual(r.fonte, {nome: 'SerpApi', id: 'captura_123456'});
  const captura = {termo: r.termo, resultados: r.resultados, inicio: r.inicio, pagina: r.pagina,
    contexto: r.contexto, fonte: r.fonte, coletadoEm: r.coletadoEm, profundidadeObservada: r.profundidadeObservada,
    proximoInicio: r.proximoInicio, paginacaoInterrompida: r.paginacaoInterrompida,
    paginacaoComLacuna: r.paginacaoComLacuna, limiteAtingido: r.limiteAtingido, relacionadas: r.relacionadas};
  assert.equal(r.hashEscopo, 'captura-google-pagina-v1');
  assert.equal(r.sha256, createHash('sha256').update(JSON.stringify(captura)).digest('hex'));
  assert.equal(tr.chamadas.length, 2);
  const params = Object.fromEntries(tr.chamadas[1].url.searchParams);
  assert.deepEqual(params, {engine: 'google', q: entrada.termo, gl: 'br', hl: 'pt', google_domain: 'google.com.br',
    device: 'desktop', location: 'Brazil', start: '0', no_cache: 'true', output: 'json', api_key: CHAVE});
  assert.ok(!JSON.stringify(r).includes(CHAVE));
});

test('ausência só vale para os resultados observados e domínio parecido não corresponde', async () => {
  const search = serp();
  search.organic_results[2].link = 'https://cliente.com.br.concorrente.net/';
  const r = await consultarGoogle(entrada, transporte({search}));
  assert.equal(r.estado, 'nao_encontrado');
  assert.equal(r.posicao, null);
  assert.equal(r.url, null);
  assert.equal(r.profundidadeObservada, 3);
  assert.deepEqual(r.acima, []);
});

test('hash identifica a captura compartilhada e independe do domínio procurado', async () => {
  const a = await consultarGoogle(entrada, transporte());
  const b = await consultarGoogle({...entrada, dominio: 'rival.com.br'}, transporte());
  const c = await consultarGoogle({...entrada, dominio: 'ausente.com.br'}, transporte());
  assert.equal(a.posicao, 3);
  assert.equal(b.posicao, 1);
  assert.equal(c.estado, 'nao_encontrado');
  assert.notDeepEqual(a.acima, b.acima);
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.sha256, c.sha256);
  const search = serp(); search.organic_results[0].title = 'Título alterado';
  const alterada = await consultarGoogle(entrada, transporte({search}));
  assert.notEqual(a.sha256, alterada.sha256);
});

test('lista vazia nunca declara que o domínio está fora do Google', async () => {
  const search = serp();
  search.organic_results = [];
  const r = await consultarGoogle(entrada, transporte({search}));
  assert.equal(r.estado, 'indisponivel');
  assert.equal(r.profundidadeObservada, 0);
  assert.equal(r.posicao, null);
});

test('recusa contexto diferente, correção da busca e página posterior', async t => {
  const alteracoes = [
    d => { d.search_parameters.engine = 'bing'; }, d => { d.search_parameters.q = 'outro termo'; },
    d => { d.search_parameters.gl = 'us'; }, d => { d.search_parameters.hl = 'en'; },
    d => { d.search_parameters.device = 'mobile'; }, d => { d.search_parameters.google_domain = 'google.com'; },
    d => { d.search_parameters.location_requested = 'Portugal'; }, d => { d.search_parameters.location_used = 'São Paulo'; },
    d => { delete d.search_parameters.location_used; }, d => { d.search_parameters.start = 10; },
    d => { d.search_parameters.tbm = 'nws'; }, d => { d.search_parameters.udm = 14; },
    d => { d.search_information.page_number = 2; }, d => { d.search_information.query_displayed = 'termo corrigido'; },
    d => { d.search_information.organic_results_state = 'Results for corrected spelling'; },
    d => { d.search_metadata.google_url += '&start=10'; }, d => { d.search_parameters = 'inválido'; },
    d => { d.search_information = 1; },
  ];
  for (let n = 0; n < alteracoes.length; n++) await t.test(`contexto ${n}`, async () => {
    const search = serp(); alteracoes[n](search);
    await assert.rejects(consultarGoogle(entrada, transporte({search})), codigo('indisponivel'));
  });
});

test('aceita start omitido como na resposta oficial da primeira página', async () => {
  const search = serp(); delete search.search_parameters.start;
  assert.equal((await consultarGoogle(entrada, transporte({search}))).posicao, 3);
});

test('rejeita capturas antigas, futuras, sem data ou datas inválidas', async t => {
  for (const data of [undefined, '2026-11-14 13:59:59 UTC', '2026-11-14 15:00:01 UTC',
    '2026-02-31 14:59:30 UTC', '14/11/2026', '2026-11-14T14:59:30-03:00']) await t.test(String(data), async () => {
    const search = serp(); search.search_metadata.created_at = data;
    await assert.rejects(consultarGoogle(entrada, transporte({search})), codigo('indisponivel'));
  });
  for (const data of ['2026-11-14 14:59:29 UTC', '2026-11-14 15:00:01 UTC']) {
    const search = serp(); search.search_metadata.processed_at = data;
    await assert.rejects(consultarGoogle(entrada, transporte({search})), codigo('indisponivel'));
  }
});

test('rejeita posições com lacunas, duplicadas, fora de ordem ou página excessiva', async () => {
  for (const ranks of [[2, 3, 4], [1, 1, 2], [1, 3, 2], ['1', 2, 3], Array.from({length: 11}, (_, i) => i + 1)]) {
    const search = serp(); search.organic_results = ranks.map(position => ({position, title: 'Resultado', link: 'https://exemplo.com/'}));
    await assert.rejects(consultarGoogle(entrada, transporte({search})), codigo('indisponivel'));
  }
});

test('rejeita respostas sem captura confiável ou com bloqueio', async () => {
  const alteracoes = [d => { d.error = `Google blocked request ${CHAVE}`; },
    d => { d.search_metadata.status = 'Processing'; }, d => { delete d.search_metadata; },
    d => { d.search_metadata.id = CHAVE; }, d => { delete d.organic_results; },
    d => { d.organic_results = {}; }, d => { d.organic_results[0].title = '\u0000'; }];
  for (const alterar of alteracoes) {
    const search = serp(); alterar(search);
    await assert.rejects(consultarGoogle(entrada, transporte({search})), codigo('indisponivel'));
  }
});

test('URLs públicas não carregam credenciais nem devolvem a chave', async () => {
  const search = serp();
  search.organic_results[2].link += `?api_key=${CHAVE}&token=outro&servico=seo#${CHAVE}`;
  search.organic_results[2].title += ` ${CHAVE}`;
  const r = await consultarGoogle(entrada, transporte({search}));
  assert.equal(r.url, 'https://loja.cliente.com.br/ambiental?servico=seo');
  assert.ok(!JSON.stringify(r).includes(CHAVE));
  assert.match(r.resultados[2].titulo, /\[redigido\]/);
  for (const link of ['javascript:alert(1)', 'https://usuario:senha@exemplo.com/', 'http://127.0.0.1/',
    `https://exemplo.com/${CHAVE}`, `https://exemplo.com/?outro=${CHAVE}`]) {
    const s = serp(); s.organic_results[0].link = link;
    await assert.rejects(consultarGoogle(entrada, transporte({search: s})), codigo('indisponivel'));
  }
});

test('rejeita página inteira quando um resultado usa redirecionamento opaco do Google', async () => {
  for (const link of [
    'https://google.com/goto?source=example',
    'https://www.google.com.br/goto/opaque',
    'https://www.google.co.uk/url?source=example',
    'https://google.de/%67oto?source=example',
    'https://google.com/%2567oto?source=example',
  ]) {
    const search = serp();
    search.organic_results[0].link = link;
    // The target appears elsewhere, but the competitor list and ranking
    // cannot be trusted if another result's destination is unknown.
    await assert.rejects(consultarGoogle(entrada, transporte({search})), codigo('indisponivel'));
  }
  for (const link of ['https://www.google.com/about/', 'https://google.com.evil.net/goto',
    'https://rival.com.br/goto']) {
    const search = serp(); search.organic_results[0].link = link;
    const resultado = await consultarGoogle(entrada, transporte({search}));
    assert.equal(resultado.estado, 'encontrado');
    assert.equal(resultado.posicao, 3);
  }
});

test('erros HTTP são tipados sem refletir corpo e nunca são repetidos', async () => {
  for (const [status, esperado] of [[401, 'configuracao'], [403, 'configuracao'], [402, 'cota'], [429, 'cota'],
    [302, 'indisponivel'], [500, 'indisponivel']]) {
    const tr = transporte({responder: url => url.pathname === '/account.json' ? Response.json(conta())
      : new Response(CHAVE, {status, headers: {location: 'https://externo.com/'}})});
    await assert.rejects(consultarGoogle(entrada, tr), codigo(esperado));
    assert.equal(tr.chamadas.length, 2);
  }
});

test('erros JSON, MIME e corpos grandes falham sem expor resposta', async () => {
  const respostas = [
    () => Response.json({error: `Your account has run out of searches ${CHAVE}`}),
    () => Response.json({error: `erro interno ${CHAVE}`}),
    () => new Response(`{${CHAVE}`, {headers: {'content-type': 'application/json'}}),
    () => new Response(CHAVE, {headers: {'content-type': 'text/html'}}),
    () => new Response('{}', {headers: {'content-type': 'application/json', 'content-length': String(512 * 1024 + 1)}}),
    () => new Response(JSON.stringify({valor: 'x'.repeat(512 * 1024)}), {headers: {'content-type': 'application/json'}}),
    () => Response.json([]),
  ];
  for (let i = 0; i < respostas.length; i++) {
    const tr = transporte({responder: respostas[i]});
    await assert.rejects(verificarContaGratuita(CHAVE, tr), codigo(i === 0 ? 'cota' : 'indisponivel'));
    assert.equal(tr.chamadas.length, 1);
  }
});

test('configuração ou termo inválidos não iniciam tráfego', async () => {
  const tr = transporte();
  for (const valores of [{chave: ''}, {chave: 'curta'}, {dominio: 'localhost'}, {termo: 'site:cliente.com.br'},
    {termo: ''}, {termo: 'x'.repeat(161)}, {termo: '\nconsultoria'}]) {
    await assert.rejects(consultarGoogle({...entrada, ...valores}, tr), codigo('configuracao'));
  }
  assert.equal(tr.chamadas.length, 0);
});

test('fetch global é ligado ao globalThis para execução no Worker', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async function (endereco, init) {
    assert.equal(this, globalThis);
    assert.equal(init.redirect, 'manual');
    return Response.json(new URL(endereco).pathname === '/account.json' ? conta() : serp());
  });
  assert.equal((await consultarGoogle(entrada, {agora})).estado, 'encontrado');
  assert.equal(mock.mock.calls.length, 2);
});

test('interrompe a requisição após 12 segundos sem repetir a chamada', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let chamadas = 0, sinal;
  const promessa = verificarContaGratuita(CHAVE, {agora, fetch: async (_, init) => {
    chamadas++;
    sinal = init.signal;
    return new Promise(() => {});
  }});
  const rejeicao = assert.rejects(promessa, codigo('indisponivel'));
  t.mock.timers.tick(11_999);
  assert.equal(sinal.aborted, false);
  t.mock.timers.tick(1);
  await rejeicao;
  assert.equal(sinal.aborted, true);
  assert.equal(chamadas, 1);
});

test('falha de rede não devolve mensagem interna contendo segredo', async () => {
  let chamadas = 0;
  await assert.rejects(verificarContaGratuita(CHAVE, {agora, fetch: async () => {
    chamadas++; throw new Error(`request https://serpapi.com/account.json?api_key=${CHAVE}`);
  }}), codigo('indisponivel'));
  assert.equal(chamadas, 1);
});

test('hook de reserva só executa depois de confirmar conta gratuita e antes da busca', async () => {
  const ordem = [];
  const tr = transporte({responder: url => {
    ordem.push(url.pathname);
    return Response.json(url.pathname === '/account.json' ? conta() : serp());
  }});
  const r = await consultarGoogle(entrada, {...tr, antesDaBusca: async () => { ordem.push('reservar'); }});
  assert.equal(r.estado, 'encontrado');
  assert.deepEqual(ordem, ['/account.json', 'reservar', '/search.json']);
});

test('plano pago, chave inválida e cota esgotada não executam hook nem busca', async () => {
  const casos = [
    {account: {...conta(), plan_id: 'starter'}, esperado: 'plano_incompativel'},
    {chave: '', esperado: 'configuracao'},
    {account: {...conta(), plan_searches_left: 0, total_searches_left: 0, this_month_usage: 250}, esperado: 'cota'},
    {account: {...conta(), this_hour_searches: 50}, esperado: 'cota'},
  ];
  for (const caso of casos) {
    const tr = transporte(caso), valores = {...entrada, chave: caso.chave ?? CHAVE};
    let reservas = 0;
    await assert.rejects(consultarGoogle(valores, {...tr, antesDaBusca: async () => { reservas++; }}), codigo(caso.esperado));
    assert.equal(reservas, 0);
    assert.ok(tr.chamadas.every(c => c.url.pathname === '/account.json'));
  }
});

test('erro no hook é propagado e impede a busca sem repetir preflight', async () => {
  const tr = transporte(), recusa = new Error('reserva não autorizada');
  let reservas = 0;
  await assert.rejects(consultarGoogle(entrada, {...tr, antesDaBusca: async () => {
    reservas++; throw recusa;
  }}), erro => erro === recusa);
  assert.equal(reservas, 1);
  assert.deepEqual(tr.chamadas.map(c => c.url.pathname), ['/account.json']);
});

function paginaSerp(inicio = 10, pagina = 2, quantidade = 3) {
  const d = serp();
  d.search_parameters.start = inicio;
  d.search_information.page_number = pagina;
  d.search_metadata.google_url += '&start=' + inicio;
  d.organic_results = Array.from({length: quantidade}, (_, i) => ({position: i + 1, title: 'Resultado ' + (i + 1),
    link: `https://${i ? 'rival.com.br' : 'cliente.com.br'}/pagina-${inicio}-${i}`}));
  return d;
}
function proxima(inicio, alteracoes = {}) {
  const u = new URL('https://serpapi.com/search.json');
  const p = {engine: 'google', q: entrada.termo, gl: 'br', hl: 'pt', google_domain: 'google.com.br',
    device: 'desktop', location: 'Brazil', start: String(inicio), ...alteracoes};
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  return u.href;
}

test('posição da página é preservada e offset confirmado calcula 11 ou 8, sem num', async () => {
  for (const inicio of [10, 7]) {
    const tr = transporte({search: paginaSerp(inicio)});
    let reservas = 0;
    const r = await consultarGoogle({...entrada, inicio, pagina: 2}, {...tr, antesDaBusca: async () => { reservas++; }});
    assert.equal(r.estado, 'encontrado');
    assert.equal(r.posicao, inicio + 1);
    assert.equal(r.pagina, 2);
    assert.equal(r.inicio, inicio);
    assert.deepEqual(r.resultados.map(x => [x.posicao, x.posicaoNaPagina, x.pagina, x.inicio]),
      [[inicio + 1, 1, 2, inicio], [inicio + 2, 2, 2, inicio], [inicio + 3, 3, 2, inicio]]);
    assert.equal(r.proximoInicio, null);
    assert.equal(reservas, 1);
    assert.equal(tr.chamadas.length, 2);
    assert.equal(tr.chamadas[1].url.searchParams.get('start'), String(inicio));
    assert.equal(tr.chamadas[1].url.searchParams.has('num'), false);
  }
});

test('página posterior exige offset confirmado, página e layout coerentes', async () => {
  for (const alterar of [d => { delete d.search_parameters.start; }, d => { d.search_parameters.start = 0; },
    d => { d.search_information.page_number = 1; }, d => { d.search_parameters.ibp = 'htl;jobs'; },
    d => { d.search_parameters.tbm = 'nws'; }, d => { d.search_parameters.udm = 14; },
    d => { d.search_parameters.q = 'outro termo'; }, d => { d.search_parameters.location_used = 'Portugal'; },
    d => { d.search_information.organic_results_state = 'Empty showing fixed spelling results'; },
    d => { d.search_metadata.google_url += '&start=0'; }]) {
    const search = paginaSerp(); alterar(search);
    await assert.rejects(consultarGoogle({...entrada, inicio: 10, pagina: 2}, transporte({search})), codigo('indisponivel'));
  }
});

test('continuação só expõe offset sanitizado e não inicia uma segunda página', async () => {
  const search = paginaSerp(7);
  search.serpapi_pagination = {current: 2, next: proxima(10, {api_key: CHAVE})};
  const tr = transporte({search});
  const r = await consultarGoogle({...entrada, inicio: 7, pagina: 2}, tr);
  assert.equal(r.proximoInicio, 10);
  assert.equal(r.paginacaoInterrompida, false);
  assert.equal(r.paginacaoComLacuna, false);
  assert.ok(!JSON.stringify(r).includes(CHAVE));
  assert.equal(tr.chamadas.length, 2);
});

test('next malicioso ou incoerente preserva captura válida e nunca é seguido', async () => {
  const urls = [
    `https://outro.com/search.json?api_key=${CHAVE}`, proxima(13).replace('serpapi.com', 'serpapi.com.evil.net'),
    proxima(13).replace('https:', 'http:'), proxima(13).replace('serpapi.com', 'nome:senha@serpapi.com'),
    proxima(13).replace('/search.json', '/account.json'), proxima(13, {q: 'consulta alterada'}),
    proxima(13, {gl: 'us'}), proxima(13, {hl: 'en'}), proxima(13, {device: 'mobile'}),
    proxima(13, {location: 'Portugal'}), proxima(13, {google_domain: 'google.com'}),
    proxima(13, {ibp: 'htl;jobs'}), proxima(13, {no_cache: 'false'}), proxima(13) + '&q=duplicado',
    proxima(12), proxima(10), proxima(0), proxima(20), 'não é uma URL', 13,
  ];
  for (const next of urls) {
    const search = paginaSerp(); search.serpapi_pagination = {current: 2, next};
    const tr = transporte({search});
    const r = await consultarGoogle({...entrada, inicio: 10, pagina: 2}, tr);
    assert.equal(r.estado, 'encontrado');
    assert.equal(r.posicao, 11);
    assert.equal(r.proximoInicio, null);
    assert.equal(r.paginacaoInterrompida, true);
    assert.equal(r.paginacaoComLacuna, next === proxima(20));
    assert.ok(!JSON.stringify(r).includes(CHAVE));
    assert.equal(tr.chamadas.length, 2);
  }
});

test('não inventa continuação a partir de next_link obsoleto nem de página vazia', async () => {
  const search = paginaSerp(); search.serpapi_pagination = {current: 2, next_link: proxima(13)};
  const r = await consultarGoogle({...entrada, inicio: 10, pagina: 2}, transporte({search}));
  assert.equal(r.proximoInicio, null);
  assert.equal(r.paginacaoInterrompida, false);
  search.organic_results = [];
  search.serpapi_pagination.next = proxima(20);
  const vazio = await consultarGoogle({...entrada, inicio: 10, pagina: 2}, transporte({search}));
  assert.equal(vazio.estado, 'indisponivel');
  assert.equal(vazio.proximoInicio, null);
  assert.equal(vazio.paginacaoInterrompida, true);
});

test('índice contraditório no bloco de continuação interrompe somente a paginação', async () => {
  const search = paginaSerp(); search.serpapi_pagination = {current: 1, next: proxima(13)};
  const r = await consultarGoogle({...entrada, inicio: 10, pagina: 2}, transporte({search}));
  assert.equal(r.estado, 'encontrado');
  assert.equal(r.posicao, 11);
  assert.equal(r.proximoInicio, null);
  assert.equal(r.paginacaoInterrompida, true);
});

test('limite nominal de cem não cria continuação nem publica posições além do limite', async () => {
  const search = paginaSerp(97, 11, 10); search.serpapi_pagination = {current: 11, next: proxima(107)};
  const r = await consultarGoogle({...entrada, inicio: 97, pagina: 11}, transporte({search}));
  assert.deepEqual(r.resultados.map(x => x.posicao), [98, 99, 100]);
  assert.equal(r.profundidadeObservada, 3);
  assert.equal(r.proximoInicio, null);
  assert.equal(r.limiteAtingido, true);
});

test('parâmetros de paginação inválidos não iniciam preflight nem reservam', async () => {
  const tr = transporte();
  let reservas = 0;
  for (const p of [{inicio: -1}, {inicio: 100}, {inicio: '10', pagina: 2}, {inicio: 0.5},
    {pagina: 0}, {pagina: '2'}, {inicio: 0, pagina: 2}, {inicio: 10, pagina: 1}]) {
    await assert.rejects(consultarGoogle({...entrada, ...p}, {...tr, antesDaBusca: async () => { reservas++; }}), codigo('configuracao'));
  }
  assert.equal(tr.chamadas.length, 0);
  assert.equal(reservas, 0);
});

test('página posterior continua bloqueada para plano pago antes do hook', async () => {
  const tr = transporte({account: {...conta(), plan_id: 'starter'}});
  let reservas = 0;
  await assert.rejects(consultarGoogle({...entrada, inicio: 10, pagina: 2}, {...tr,
    antesDaBusca: async () => { reservas++; }}), codigo('plano_incompativel'));
  assert.equal(reservas, 0);
  assert.deepEqual(tr.chamadas.map(c => c.url.pathname), ['/account.json']);
});

test('buscas relacionadas são hipóteses limitadas com origem, data e captura, sem nova chamada', async () => {
  const search = serp();
  search.related_searches = [
    {query: '  gestão   ambiental  ', serpapi_link: `https://evil.net/?api_key=${CHAVE}`},
    {query: 'GESTÃO AMBIENTAL'}, {query: entrada.termo}, {query: `consulta ${CHAVE}`},
    {query: '<script>roubar()</script>'}, {query: 'https://outro.com'}, {query: 'email@exemplo.com'},
    {query: 'site:cliente.com.br'}, {query: 'x'.repeat(161)}, {items: [{name: 'Nome de produto'}]},
    ...Array.from({length: 15}, (_, i) => ({query: 'consultoria alternativa ' + i})),
  ];
  const tr = transporte({search});
  const r = await consultarGoogle(entrada, tr);
  assert.equal(r.relacionadas.length, 10);
  assert.deepEqual(r.relacionadas[0], {termo: 'gestão ambiental', termoOrigem: entrada.termo,
    fonteId: 'captura_123456', coletadoEm: '2026-11-14T14:59:30.000Z'});
  assert.ok(r.relacionadas.every(x => x.termoOrigem === entrada.termo && x.fonteId === r.fonte.id && x.coletadoEm === r.coletadoEm));
  assert.ok(!JSON.stringify(r).includes(CHAVE));
  assert.ok(!r.relacionadas.some(x => 'posicao' in x));
  assert.equal(tr.chamadas.length, 2);
});
