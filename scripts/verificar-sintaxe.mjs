import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const arquivos = ['server.mjs', ...['src', 'lib', 'scripts', 'test'].flatMap(pasta =>
  readdirSync(new URL(`../${pasta}/`, import.meta.url))
    .filter(nome => nome.endsWith('.mjs')).map(nome => `${pasta}/${nome}`))];
let falhas = 0;
for (const arquivo of arquivos) {
  const resultado = spawnSync(process.execPath, ['--check', arquivo], {cwd: raiz, stdio: 'inherit'});
  if (resultado.status !== 0) falhas++;
}
const html = readFileSync(new URL('../src/portal.html', import.meta.url), 'utf8');
for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  const resultado = spawnSync(process.execPath, ['--check', '--input-type=module'],
    {input: script[1], encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit']});
  if (resultado.status !== 0) falhas++;
}
if (falhas) process.exitCode = 1;
else console.log(`Sintaxe válida em ${arquivos.length} módulos e nos scripts da interface.`);
