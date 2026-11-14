import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const arquivos = readdirSync(new URL('../test/', import.meta.url))
  .filter(nome => nome.endsWith('.test.mjs')).sort().map(nome => `test/${nome}`);
const resultado = spawnSync(process.execPath, ['--test', ...arquivos], {cwd: raiz, stdio: 'inherit'});
if (resultado.error) console.error('Não foi possível iniciar os testes.');
process.exitCode = resultado.status ?? 1;
