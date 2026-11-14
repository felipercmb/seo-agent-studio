import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, chmodSync, openSync, closeSync, lstatSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function migrar(sqlite, diretorio) {
  const arquivos = readdirSync(diretorio).filter(n => n.endsWith('.sql')).sort();
  if (!arquivos.length) throw new Error('Nenhuma migração SQL foi encontrada.');
  const versoes = new Set();
  const migracoes = arquivos.map(nome => {
    const versao = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(nome)?.[1];
    if (!versao || versoes.has(versao)) throw new Error('Os nomes das migrações SQL são inválidos ou repetidos.');
    versoes.add(versao);
    const caminho = join(diretorio, nome);
    if (!lstatSync(caminho).isFile()) throw new Error('A migração SQL deve ser um arquivo regular.');
    const sql = readFileSync(caminho, 'utf8');
    return {nome, sql, checksum: createHash('sha256').update(sql).digest('hex')};
  });
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (nome TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, aplicada_em TEXT NOT NULL)');
    const aplicadas = sqlite.prepare('SELECT nome, checksum FROM schema_migrations ORDER BY nome').all();
    for (let i = 0; i < aplicadas.length; i++) {
      const esperada = migracoes[i];
      if (!esperada || aplicadas[i].nome !== esperada.nome || aplicadas[i].checksum !== esperada.checksum) {
        throw new Error('Uma migração aplicada foi modificada ou removida. Restaure as migrações originais antes de abrir o banco.');
      }
    }
    for (const migracao of migracoes.slice(aplicadas.length)) {
      sqlite.exec(migracao.sql);
      sqlite.prepare('INSERT INTO schema_migrations (nome, checksum, aplicada_em) VALUES (?, ?, ?)')
        .run(migracao.nome, migracao.checksum, new Date().toISOString());
    }
    sqlite.exec('COMMIT');
  } catch (erro) {
    try { sqlite.exec('ROLLBACK'); } catch { /* Preserve the original migration error. */ }
    throw erro;
  }
}

export function abrirBanco({arquivo = join(RAIZ, 'data', 'visibilidade.sqlite'), migracoesDir = join(RAIZ, 'migrations')} = {}) {
  const caminho = resolve(arquivo);
  mkdirSync(dirname(caminho), {recursive: true, mode: 0o700});
  try { const fd = openSync(caminho, 'wx', 0o600); closeSync(fd); }
  catch (erro) { if (erro.code !== 'EEXIST') throw erro; }
  if (!lstatSync(caminho).isFile()) throw new Error('O banco deve ser um arquivo local regular.');
  chmodSync(caminho, 0o600);
  const sqlite = new DatabaseSync(caminho);
  let fechado = false;
  try {
    sqlite.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL');
    migrar(sqlite, resolve(migracoesDir));
  } catch (erro) { sqlite.close(); throw erro; }

  const preparar = (sql, parametros = []) => ({
    bind(...valores) { return preparar(sql, valores); },
    async first(coluna) {
      const linha = sqlite.prepare(sql).get(...parametros);
      if (!linha) return null;
      return coluna === undefined ? {...linha} : linha[coluna] ?? null;
    },
    async run() {
      const resultado = sqlite.prepare(sql).run(...parametros);
      return {success: true, meta: {changes: Number(resultado.changes), last_row_id: Number(resultado.lastInsertRowid)}};
    },
    async all() {
      const results = sqlite.prepare(sql).all(...parametros).map(linha => ({...linha}));
      return {success: true, results, meta: {}};
    },
  });
  return {
    prepare(sql) {
      if (fechado) throw new Error('O banco local já foi fechado.');
      return preparar(sql);
    },
    close() {
      if (fechado) return;
      sqlite.close(); fechado = true;
    },
  };
}
