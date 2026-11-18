import test from 'node:test';
import assert from 'node:assert/strict';
import {criarFonteGoogleAds} from '../src/modulos/google-ads.mjs';
import {normalizarDemanda} from '../src/modulos/demanda.mjs';
import {avaliarOportunidades} from '../src/modulos/oportunidades.mjs';

const INSTANTE = Date.parse('2026-11-15T15:00:00Z');
const agora = () => INSTANTE;
const MESES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
  'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const env = {GOOGLE_ADS_DEMANDA: '1', GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
  GOOGLE_ADS_ACCESS_TOKEN: 'token_ficticio_de_teste_nao_real', GOOGLE_ADS_DEVELOPER_TOKEN: 'developer_ficticio_nao_real',
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: '987-654-3210'};
const entrada = {dominio: 'cliente.com.br', termos: ['Contratar artista gospel'], pais: 'Brasil', idioma: 'Português'};
function resultado(text = entrada.termos[0], volume = '90', closeVariants = []) {
  return {text, closeVariants, keywordMetrics: {avgMonthlySearches: volume,
    monthlySearchVolumes: Array.from({length: 12}, (_, i) => {
      const d = new Date(Date.UTC(2025, 10 + i, 1));
      return {year: String(d.getUTCFullYear()), month: MESES[d.getUTCMonth()], monthlySearches: volume};
    })}};
}
const fonte = (buscar, config = env) => criarFonteGoogleAds({env: config, fetch: buscar, agora});
const responder = results => async () => Response.json({results});

test('sem opt-in ou configuração completa o adaptador não existe nem usa rede', () => {
  let consultas = 0;
  const buscar = () => { consultas++; throw new Error('não pode chamar'); };
  for (const config of [{}, {...env, GOOGLE_ADS_DEMANDA: '0'}, {...env, GOOGLE_ADS_DEMANDA: undefined},
    {...env, GOOGLE_ADS_CUSTOMER_ID: ''}, {...env, GOOGLE_ADS_ACCESS_TOKEN: ''},
    {...env, GOOGLE_ADS_DEVELOPER_TOKEN: ''}, {...env, GOOGLE_ADS_API_VERSION: 'v26/../../evil'},
    {...env, GOOGLE_ADS_CUSTOMER_ID: '1234567890?token=x'}, {...env, GOOGLE_ADS_LOGIN_CUSTOMER_ID: 'outro'},
    {...env, GOOGLE_ADS_ACCESS_TOKEN: 'header\ninjetado'}]) assert.equal(fonte(buscar, config), null);
  assert.equal(consultas, 0);
});

test('requisição oficial só de planejamento usa BR, português e doze meses completos', async () => {
  let consultas = 0;
  const consultar = fonte(async (endereco, opcoes) => {
    consultas++;
    assert.equal(endereco, 'https://googleads.googleapis.com/v26/customers/1234567890:generateKeywordHistoricalMetrics');
    assert.equal(new URL(endereco).search, '');
    assert.equal(opcoes.method, 'POST');
    assert.equal(opcoes.redirect, 'error');
    assert.equal(opcoes.headers.Authorization, 'Bearer ' + env.GOOGLE_ADS_ACCESS_TOKEN);
    assert.equal(opcoes.headers['developer-token'], env.GOOGLE_ADS_DEVELOPER_TOKEN);
    assert.equal(opcoes.headers['login-customer-id'], '9876543210');
    const corpo = JSON.parse(opcoes.body);
    assert.deepEqual(corpo, {keywords: entrada.termos, geoTargetConstants: ['geoTargetConstants/2076'],
      language: 'languageConstants/1014', keywordPlanNetwork: 'GOOGLE_SEARCH', includeAdultKeywords: false,
      historicalMetricsOptions: {includeAverageCpc: false,
        yearMonthRange: {start: {year: 2025, month: 'NOVEMBER'}, end: {year: 2026, month: 'OCTOBER'}}}});
    assert.equal(opcoes.body.includes(entrada.dominio), false);
    return Response.json({results: [resultado()]});
  });
  const r = await consultar(entrada);
  assert.equal(consultas, 1);
  assert.equal(r.estado, 'disponivel');
  assert.equal(r.itens[0].buscasMensais, 90);
  assert.equal(r.periodoInicio, '2025-11');
  assert.equal(r.periodoFim, '2026-10');
  assert.equal(r.dispositivos, 'Todos os dispositivos');
  assert.equal(r.rede, 'Google Search');
  assert.equal(JSON.stringify(r).includes(env.GOOGLE_ADS_ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(r).includes('1234567890'), false);
});

test('número omitido ou nulo não vira zero; zero explícito preserva-se', async () => {
  for (const volume of [null, '', 'NaN', '-1', '9007199254740992']) {
    const r = await fonte(responder([resultado(entrada.termos[0], volume)]))(entrada);
    assert.deepEqual(r.itens, []);
  }
  const semNumero = resultado(); delete semNumero.keywordMetrics.avgMonthlySearches;
  assert.deepEqual((await fonte(responder([semNumero]))(entrada)).itens, []);
  assert.equal((await fonte(responder([resultado(entrada.termos[0], '0')]))(entrada)).itens[0].buscasMensais, 0);
});

test('janela incompleta ou mês sem número não é rotulada como média dos doze meses', async () => {
  const incompleta = resultado(); incompleta.keywordMetrics.monthlySearchVolumes.pop();
  const ausente = resultado(); delete ausente.keywordMetrics.monthlySearchVolumes[0].monthlySearches;
  const duplicada = resultado(); duplicada.keywordMetrics.monthlySearchVolumes[1] = duplicada.keywordMetrics.monthlySearchVolumes[0];
  const outroPeriodo = resultado(); outroPeriodo.keywordMetrics.monthlySearchVolumes[0].year = '2023';
  for (const item of [incompleta, ausente, duplicada, outroPeriodo]) {
    const r = await fonte(responder([item]))(entrada);
    assert.deepEqual(r.itens, []);
    assert.match(r.limites.join(' '), /período incompleto/);
  }
});

test('closeVariants preserva um grupo sem dividir ou duplicar volume por palavra', async () => {
  const variante = 'Contratação de artistas gospel';
  const r = await fonte(responder([resultado(entrada.termos[0], '500', [variante])]))({...entrada, termos: [...entrada.termos, variante]});
  assert.deepEqual(r.itens, []);
  assert.equal(r.grupos.length, 1);
  assert.equal(r.grupos[0].buscasMensais, 500);
  assert.deepEqual(r.grupos[0].termos, [...entrada.termos, variante]);
  const novamente = normalizarDemanda(normalizarDemanda(r, {agora}), {agora});
  assert.deepEqual(novamente.grupos, r.grupos);
  assert.deepEqual(novamente.cobertura, r.cobertura);
  assert.deepEqual(novamente.itens, []);
  const analise = avaliarOportunidades({perfil: {dominio: entrada.dominio, estado: 'confirmado', ofertas: []},
    palavras: {candidatos: entrada.termos.map(termo => ({termo, origem: 'hipotese', intencao: 'comercial'}))}, demanda: novamente}, {agora});
  assert.equal(analise.itens[0].observado.buscasMensais, null);
});

test('termo inesperado, grupo sobreposto e resultados duplicados não recebem média', async () => {
  for (const resultados of [
    [resultado('Termo nunca solicitado')],
    [resultado(entrada.termos[0], '400', ['Variante nunca solicitada'])],
    [resultado(), resultado()],
    [resultado(), resultado(entrada.termos[0], null)],
  ]) {
    const r = await fonte(responder(resultados))(entrada);
    assert.deepEqual(r.itens, []); assert.deepEqual(r.grupos, []);
  }
});

test('falhas de autenticação, quota e rede retornam estado neutro sem segredos', async () => {
  for (const fetch of [
    async () => { throw new Error(env.GOOGLE_ADS_ACCESS_TOKEN); },
    async () => Response.json({error: {message: env.GOOGLE_ADS_DEVELOPER_TOKEN}}, {status: 401}),
    async () => Response.json({error: {message: env.GOOGLE_ADS_ACCESS_TOKEN}}, {status: 429}),
    async () => new Response(env.GOOGLE_ADS_ACCESS_TOKEN, {status: 500}),
  ]) {
    const r = await fonte(fetch)(entrada), texto = JSON.stringify(r);
    assert.equal(r.estado, 'indisponivel');
    assert.equal(texto.includes(env.GOOGLE_ADS_ACCESS_TOKEN), false);
    assert.equal(texto.includes(env.GOOGLE_ADS_DEVELOPER_TOKEN), false);
    assert.deepEqual(r.itens, []);
  }
});

test('redirecionamento, JSON inválido e resposta excessiva são recusados', async () => {
  for (const fetch of [
    async () => new Response('', {status: 302, headers: {location: 'https://outro.com/'}}),
    async () => new Response('{', {headers: {'content-type': 'application/json'}}),
    async () => new Response('x'.repeat(1024 * 1024 + 1), {headers: {'content-type': 'application/json'}}),
    async () => new Response('{}', {headers: {'content-type': 'application/json', 'content-length': '1048577'}}),
    async () => Response.json({results: null}),
  ]) assert.equal((await fonte(fetch)(entrada)).estado, 'indisponivel');
});

test('aborto encerra uma resposta parada sem expor a causa', async () => {
  const controller = new AbortController(); let chamadas = 0;
  const consultar = fonte(async () => {
    chamadas++;
    queueMicrotask(() => controller.abort(new Error(env.GOOGLE_ADS_ACCESS_TOKEN)));
    return new Promise(() => {});
  });
  const r = await consultar(entrada, {signal: controller.signal});
  assert.equal(chamadas, 1);
  assert.equal(r.estado, 'indisponivel');
  assert.equal(JSON.stringify(r).includes(env.GOOGLE_ADS_ACCESS_TOKEN), false);
  await consultar(entrada, {signal: controller.signal});
  assert.equal(chamadas, 1);
});

test('recorte não suportado e lista vazia não disparam requisição', async () => {
  let chamadas = 0;
  const consultar = fonte(async () => { chamadas++; return Response.json({results: []}); });
  for (const e of [{...entrada, pais: 'Portugal'}, {...entrada, idioma: 'English'},
    {...entrada, termos: []}, {...entrada, termos: [env.GOOGLE_ADS_ACCESS_TOKEN + '\n']},
    {...entrada, termos: Array(101).fill('Termo')}, {...entrada, dominio: 'localhost'}, null]) {
    assert.equal((await consultar(e)).estado, 'indisponivel');
  }
  assert.equal(chamadas, 0);
});

test('normalização repetida mantém resultados, grupos, limitações e cobertura', async () => {
  const variante = 'Contratação de artistas gospel';
  const outro = 'Agência de artistas gospel';
  const r = await fonte(responder([resultado(entrada.termos[0], '400', [variante]), resultado(outro, '0')]))(
    {...entrada, termos: [...entrada.termos, variante, outro]});
  const primeira = normalizarDemanda(r, {agora}), segunda = normalizarDemanda(primeira, {agora});
  assert.deepEqual(primeira, segunda);
  assert.equal(primeira.itens.length, 1);
  assert.equal(primeira.grupos.length, 1);
  assert.equal(primeira.itens[0].buscasMensais, 0);
  assert.equal(primeira.dispositivos, 'Todos os dispositivos');
  const ausente = normalizarDemanda(null, {agora});
  assert.deepEqual(normalizarDemanda(ausente, {agora}), ausente);
});

test('timeout local não tenta novamente quando o servidor não responde', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let chamadas = 0;
  const consultar = fonte(async () => { chamadas++; return new Promise(() => {}); });
  const pendente = consultar(entrada);
  t.mock.timers.tick(15_001);
  const r = await pendente;
  assert.equal(r.estado, 'indisponivel');
  assert.equal(chamadas, 1);
});
