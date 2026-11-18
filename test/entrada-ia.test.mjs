import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepararEntradasIA} from '../src/entrada-ia.mjs';
import {lerArgumentos, prepararArquivo} from '../scripts/preparar-ia.mjs';

const AGORA = Date.parse('2026-11-14T15:00:00Z'), DATA = new Date(AGORA - 1000).toISOString();
const URL = 'https://example.org/oferta';
const hash = 'a'.repeat(64);
function oportunidade(termo = 'Contratar uma oferta', paginaAlvo = URL) {
  return {termo, paginaAlvo, posicao: 12, decisao: 'priorizar', intencao: {tipo: 'comercial'},
    acoes: [{titulo: 'Não deve vazar como fato'}], motivo: 'Não deve vazar como verdade',
    evidencias: [{tipo: 'site', url: paginaAlvo, trecho: 'Descrição original da oferta.', sha256: hash, coletadoEm: DATA},
      {tipo: 'google', fonte: 'SerpApi', fonteId: 'fonte_12345', sha256: hash, coletadoEm: DATA}],
    concorrentes: [{url: 'https://outro.org/servico', posicao: 5, fonteId: 'fonte_12345', coletadoEm: DATA}]};
}
function relatorio(oportunidades = [oportunidade()]) {
  return {versao: 1, dominio: 'example.org', metodo: 'regras-abertas-v1', geradoEm: DATA, oportunidades,
    melhorias: [{paginaAlvo: URL, evidencia: 'Nenhum title com texto foi identificado.', coletadoEm: DATA,
      titulo: 'Recomendar título', orientacao: 'Orientação não é observação.'}]};
}
const converter = r => prepararEntradasIA(r, {agora: () => AGORA});

test('exporta fatos e diagnóstico da mesma página, sem copiar a recomendação do motor', () => {
  const original = relatorio(), antes = JSON.stringify(original), r = converter(original), e = r.entradas[0].evidencias;
  assert.equal(r.site, 'example.org');
  assert.deepEqual(e.map(v => v.id), ['s1', 'p1', 'd1']);
  assert.equal(e[0].posicao, 12); assert.equal(e[0].atual, true);
  assert.ok(e.every(v => v.observado_em === DATA));
  assert.equal(e[0].concorrentes[0].posicao, 5);
  assert.deepEqual(e[0].fontes_serp,[{id:'fonte_12345',sha256:hash,observado_em:DATA,descricao:''}]);
  assert.match(e[0].descricao, /não foi analisado/);
  assert.equal(e[2].descricao, 'Nenhum title com texto foi identificado.');
  assert.doesNotMatch(JSON.stringify(r), /priorizar|comercial"|Não deve vazar|Orientação não/);
  assert.deepEqual(r.entradas[0].dados_negocio, {volume_busca: null, taxa_conversao: null, margem: null});
  assert.equal(JSON.stringify(original), antes);
});

test('posição ausente, sem fonte ou vencida não recebe atual nem concorrentes', () => {
  for (const alterar of [o => {o.posicao = null;}, o => {o.evidencias.pop();},
    o => {o.evidencias[1].coletadoEm = new Date(AGORA - 3600_000).toISOString();},
    o => {o.evidencias[1].sha256 = 'inválido';}, o => {o.evidencias[1].coletadoEm = new Date(AGORA + 1).toISOString();}]) {
    const r = relatorio(); alterar(r.oportunidades[0]);
    const serp = converter(r).entradas[0].evidencias[0];
    assert.equal(serp.posicao, null); assert.equal(serp.atual, false); assert.equal(serp.concorrentes, undefined);
    assert.equal(serp.fontes_serp, undefined);
  }
});

test('trecho de origem vencido permanece identificado, diagnóstico vencido é omitido', () => {
  const r = relatorio();
  r.oportunidades[0].evidencias[0].coletadoEm = new Date(AGORA - 24 * 3600_000).toISOString();
  r.melhorias[0].coletadoEm = r.oportunidades[0].evidencias[0].coletadoEm;
  const e = converter(r).entradas[0].evidencias;
  assert.equal(e.length, 2); assert.equal(e[0].atual, true); assert.equal(e[1].atual, false);
});

test('agrupa páginas pela ordem recebida e limita entradas e evidências', () => {
  const r = relatorio([oportunidade(), oportunidade('Outra palavra'),
    oportunidade('Segunda página', 'https://example.org/segunda'), oportunidade('Terceira', 'https://example.org/terceira'),
    oportunidade('Quarta', 'https://example.org/quarta')]);
  const saida = converter(r);
  assert.equal(saida.entradas.length, 3);
  assert.deepEqual(saida.entradas.map(e => e.evidencias[0].termo), ['Contratar uma oferta', 'Segunda página', 'Terceira']);
  assert.ok(saida.entradas.every(e => e.evidencias.length <= 3));
  assert.ok(saida.entradas[1].evidencias.every(e => e.id !== 'd1'));
});

test('uma diretiva observada não fica de fora quando as primeiras oportunidades são de outras páginas', () => {
  const bloqueada='https://example.org/reservada';
  const r=relatorio([oportunidade('Primeira','https://example.org/primeira'),
    oportunidade('Segunda','https://example.org/segunda'),oportunidade('Terceira','https://example.org/terceira'),
    oportunidade('Quarta',bloqueada)]);
  r.melhorias=[{paginaAlvo:bloqueada,verificacaoId:'diretiva-noindex-html',sha256Pagina:hash,
    evidencia:'O HTML inicial contém noindex; a intenção é desconhecida.',coletadoEm:DATA}];
  const saida=converter(r);
  assert.equal(saida.entradas.length,3);
  const e=saida.entradas.flatMap(c=>c.evidencias).find(x=>x.verificacao?.tipo==='meta_robots_noindex');
  assert.equal(e?.pagina,bloqueada);
  assert.match(saida.entradas.find(c=>c.evidencias.includes(e)).objetivo,/diretiva/);
});

test('sem relatório não fabrica fatos; diagnóstico sozinho é exportável', () => {
  assert.deepEqual(converter(null).entradas[0].evidencias, []);
  const r = relatorio([]), e = converter(r).entradas[0].evidencias;
  assert.equal(e.length, 1); assert.equal(e[0].id, 'd1');
  r.metodo = 'desconhecido'; assert.deepEqual(converter(r).entradas[0].evidencias, []);
});

test('URL de outra página, segredo e concorrente sem fonte não viram evidência', () => {
  const r = relatorio();
  r.oportunidades[0].evidencias[0].url = 'https://example.org/outra';
  r.oportunidades[0].concorrentes[0].fonteId = 'fonte_ausente';
  r.melhorias[0].paginaAlvo = 'https://example.org/?token=segredo';
  const saida = converter(r);
  assert.equal(saida.entradas[0].evidencias.length, 1);
  assert.deepEqual(saida.entradas[0].evidencias[0].concorrentes, []);
  assert.doesNotMatch(JSON.stringify(saida), /segredo|outra/);
});

test('CLI rejeita opções repetidas, endereços remotos para porta e site local', () => {
  for (const args of [[], ['--site', 'localhost'], ['--site', 'example.org', '--porta', 'https://outro.org'],
    ['--site', 'example.org', '--porta', '65536'], ['--site', 'example.org', '--site', 'outro.org'],
    ['--site', 'example.org', '--host', 'outro.org']]) assert.throws(() => lerArgumentos(args));
  assert.equal(lerArgumentos(['--site', 'https://www.example.org/']).site, 'example.org');
});

test('preparação faz uma consulta local sem redirecionamento e grava arquivo privado', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'entrada-ia-'));
  try {
    const saida = join(pasta, 'entrada.json'); let chamadas = 0;
    const resultado = await prepararArquivo({site: 'example.org', porta: 8794, saida}, {agora: () => AGORA,
      fetch: async (url, opcoes) => {
        chamadas++;
        assert.equal(url, 'http://127.0.0.1:8794/api/agente');
        assert.equal(opcoes.headers.Origin, 'http://127.0.0.1:8794');
        assert.equal(opcoes.method, 'POST'); assert.equal(opcoes.redirect, 'error');
        assert.deepEqual(JSON.parse(opcoes.body), {site: 'example.org'});
        return Response.json(relatorio());
      }});
    assert.equal(chamadas, 1); assert.equal(resultado.entradas, 1);
    assert.equal(JSON.parse(await readFile(saida, 'utf8')).entradas[0].evidencias[0].posicao, 12);
    if (process.platform !== 'win32') assert.equal((await stat(saida)).mode & 0o777, 0o600);
  } finally { await rm(pasta, {recursive: true, force: true}); }
});

test('CLI recusa domínio trocado, corpo excessivo ou falha do servidor', async () => {
  for (const resposta of [Response.json({...relatorio(), dominio: 'outro.org'}),
    new Response('x'.repeat(2 * 1024 * 1024 + 1), {headers: {'content-type': 'application/json'}}),
    new Response('falha', {status: 503})]) {
    await assert.rejects(prepararArquivo({site: 'example.org'}, {fetch: async () => resposta}));
  }
});
