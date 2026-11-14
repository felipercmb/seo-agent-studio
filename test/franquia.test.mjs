import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {criarFranquia, MAX_HORA, MAX_MENSAL, MAX_DOMINIO_DIA} from '../src/franquia.mjs';

const migracao = ['0000_ranking_gratuito.sql', '0001_cota_dominio.sql']
  .map(nome => readFileSync(new URL('../migrations/' + nome, import.meta.url), 'utf8')).join('\n');

// Duas conexões SQLite independentes, com o contrato assíncrono de D1.
// O SQL usado nos testes é o SQL de produção, não um contador simulado.
function preparar(t) {
  const pasta = mkdtempSync(join(tmpdir(), 'ranking-franquia-'));
  const a = new DatabaseSync(join(pasta, 'dados.sqlite'));
  a.exec(migracao);
  const b = new DatabaseSync(join(pasta, 'dados.sqlite'));
  t.after(() => { a.close(); b.close(); rmSync(pasta, {recursive: true, force: true}); });
  const adaptar = sqlite => ({prepare(sql) {
    return {bind(...valores) { return {
      async first() { await Promise.resolve(); return sqlite.prepare(sql).get(...valores) ?? null; },
      async run() { await Promise.resolve(); return sqlite.prepare(sql).run(...valores); },
    }; }};
  }});
  let instante = Date.parse('2026-11-14T15:00:00Z');
  const agora = () => instante;
  return {
    a: criarFranquia(adaptar(a), agora), b: criarFranquia(adaptar(b), agora), sqlite: a,
    avancar: ms => { instante += ms; }, definir: data => { instante = Date.parse(data); },
  };
}

test('dois consumidores partilham 40 reservas por hora e 200 por mês de forma atômica', async t => {
  const s = preparar(t);
  assert.equal(MAX_HORA, 40);
  assert.equal(MAX_MENSAL, 200);
  for (let hora = 0; hora < 5; hora++) {
    const reservas = await Promise.all(Array.from({length: 100}, (_, i) => (i % 2 ? s.a : s.b).reservar()));
    assert.equal(reservas.filter(Boolean).length, 40);
    assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM rank_creditos').get().n, (hora + 1) * 40);
    s.avancar(3600_000);
  }
  assert.deepEqual(await Promise.all([s.a.reservar(), s.b.reservar()]), [false, false]);
  assert.equal(s.sqlite.prepare('SELECT COUNT(DISTINCT id) AS n FROM rank_creditos').get().n, 200);
  s.definir('2026-12-01T00:00:00Z');
  assert.equal(await s.b.reservar(), true);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM rank_creditos').get().n, 201);
});

test('virada da hora ou do mês não libera a janela móvel antes de 60 minutos', async t => {
  const s = preparar(t);
  s.definir('2026-11-30T23:59:59.999Z');
  assert.equal((await Promise.all(Array.from({length: 45}, () => s.a.reservar()))).filter(Boolean).length, 40);
  s.avancar(1);
  assert.equal((await Promise.all(Array.from({length: 45}, () => s.b.reservar()))).filter(Boolean).length, 0);
  s.avancar(3599_998);
  assert.equal(await s.b.reservar(), false);
  s.avancar(1);
  assert.equal((await Promise.all(Array.from({length: 45}, () => s.b.reservar()))).filter(Boolean).length, 40);
  assert.deepEqual(s.sqlite.prepare('SELECT mes, COUNT(*) AS n FROM rank_creditos GROUP BY mes ORDER BY mes').all()
    .map(r => ({...r})), [{mes: '2026-11', n: 40}, {mes: '2026-12', n: 40}]);
});

test('dois consumidores limitam o mesmo domínio a vinte reservas e compartilham o saldo global', async t => {
  const s = preparar(t);
  assert.equal(MAX_DOMINIO_DIA, 20);
  assert.deepEqual(await s.a.saldo('cliente-a.com.br'), {mensal: 200, hora: 40, dominio: 20});
  const a = await Promise.all(Array.from({length: 100}, (_, i) => (i % 2 ? s.a : s.b).reservar('cliente-a.com.br')));
  assert.equal(a.filter(Boolean).length, 20);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM rank_creditos WHERE dominio = ?').get('cliente-a.com.br').n, 20);
  assert.deepEqual(await s.b.saldo('cliente-a.com.br'), {mensal: 180, hora: 20, dominio: 0});
  assert.deepEqual(await s.a.saldo('cliente-b.com.br'), {mensal: 180, hora: 20, dominio: 20});
  const b = await Promise.all(Array.from({length: 100}, (_, i) => (i % 2 ? s.a : s.b).reservar('cliente-b.com.br')));
  assert.equal(b.filter(Boolean).length, 20);
  assert.deepEqual(await s.a.saldo('cliente-b.com.br'), {mensal: 160, hora: 0, dominio: 0});
  assert.deepEqual(await s.b.saldo('cliente-c.com.br'), {mensal: 160, hora: 0, dominio: 20});
  assert.equal(await s.b.reservar('cliente-c.com.br'), false);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM rank_creditos').get().n, 40);
  s.avancar(3600_000);
  assert.equal(await s.a.reservar('cliente-c.com.br'), true);
  assert.equal(await s.b.reservar('cliente-a.com.br'), false);
  assert.deepEqual(await s.a.saldo('cliente-c.com.br'), {mensal: 159, hora: 39, dominio: 19});
});

test('limite por domínio usa 24 horas corridas e não renova na virada do dia ou do mês', async t => {
  const s = preparar(t);
  s.definir('2026-11-30T23:59:59.999Z');
  assert.equal((await Promise.all(Array.from({length: 30}, (_, i) => (i % 2 ? s.a : s.b).reservar('cliente.com.br')))).filter(Boolean).length, 20);
  s.avancar(1);
  assert.deepEqual(await s.b.saldo('cliente.com.br'), {mensal: 200, hora: 20, dominio: 0});
  assert.equal(await s.b.reservar('cliente.com.br'), false);
  s.avancar(3599_999);
  assert.deepEqual(await s.a.saldo('cliente.com.br'), {mensal: 200, hora: 40, dominio: 0});
  assert.equal(await s.a.reservar('cliente.com.br'), false);
  s.avancar(23 * 3600_000 - 1);
  assert.equal(await s.b.reservar('cliente.com.br'), false);
  s.avancar(1);
  assert.deepEqual(await s.a.saldo('cliente.com.br'), {mensal: 200, hora: 40, dominio: 20});
  assert.equal(await s.b.reservar('cliente.com.br'), true);
  assert.deepEqual(await s.a.saldo('cliente.com.br'), {mensal: 199, hora: 39, dominio: 19});
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM rank_creditos').get().n, 21);
});

test('domínios novos não contornam as duzentas reservas globais do mês', async t => {
  const s = preparar(t);
  for (let hora = 0; hora < 5; hora++) {
    const resultados = await Promise.all(Array.from({length: 80}, (_, i) =>
      (i % 2 ? s.a : s.b).reservar(`cliente-${hora}-${i % 2}.com.br`)));
    assert.equal(resultados.filter(Boolean).length, 40);
    assert.equal(s.sqlite.prepare('SELECT MAX(n) AS maior FROM (SELECT COUNT(*) AS n FROM rank_creditos GROUP BY dominio)').get().maior, 20);
    s.avancar(3600_000);
  }
  assert.deepEqual(await s.a.saldo('outro-cliente.com.br'), {mensal: 0, hora: 40, dominio: 20});
  const recusadas = await Promise.all(Array.from({length: 40}, (_, i) => (i % 2 ? s.a : s.b).reservar(`outro-${i}.com.br`)));
  assert.ok(recusadas.every(v => v === false));
  assert.equal(s.sqlite.prepare('SELECT COUNT(DISTINCT id) AS n FROM rank_creditos').get().n, 200);
});

test('trava tem dono, expira em 180 segundos e token antigo não libera novo dono', async t => {
  const s = preparar(t);
  const antigo = await s.a.bloquear('cliente.com.br');
  assert.equal(typeof antigo, 'string');
  assert.equal(await s.b.bloquear('cliente.com.br'), null);
  s.avancar(179_999);
  assert.equal(await s.b.bloquear('cliente.com.br'), null);
  s.avancar(1);
  const novo = await s.b.bloquear('cliente.com.br');
  assert.equal(typeof novo, 'string');
  assert.notEqual(novo, antigo);
  await s.a.liberar('cliente.com.br', antigo);
  assert.equal(await s.a.bloquear('cliente.com.br'), null);
  await s.b.liberar('cliente.com.br', novo);
  assert.equal(typeof await s.a.bloquear('cliente.com.br'), 'string');
});

test('cache compartilhado mantém datas de evidência e expira sem renovar na leitura', async t => {
  const s = preparar(t);
  const relatorio = {dominio: 'cliente.com.br', geradoEm: '2026-11-14T14:59:00Z',
    consultas: [{coletadoEm: '2026-11-14T14:58:30Z', posicao: 3, sha256: 'a'.repeat(64)}]};
  await s.a.guardar('cliente.com.br', relatorio, 60_000);
  s.avancar(59_999);
  assert.deepEqual(await s.b.obter('cliente.com.br'), relatorio);
  s.avancar(1);
  assert.equal(await s.a.obter('cliente.com.br'), null);
  await s.b.guardar('cliente.com.br', {...relatorio, geradoEm: '2026-11-14T15:01:00Z'}, 10_000);
  assert.equal((await s.a.obter('cliente.com.br')).geradoEm, '2026-11-14T15:01:00Z');
});

test('ausência de D1 e cache corrompido não produzem evidências', async t => {
  assert.equal(criarFranquia(undefined), null);
  assert.equal(criarFranquia({}), null);
  const s = preparar(t);
  s.sqlite.prepare('INSERT INTO rank_resultados VALUES (?, ?, ?)').run('ruim', Date.parse('2030-01-01'), '{');
  assert.equal(await s.a.obter('ruim'), null);
});
