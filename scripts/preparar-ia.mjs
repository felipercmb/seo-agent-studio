import {mkdir, open, rename, unlink} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {normalizarSite} from '../src/consulta.mjs';
import {prepararEntradasIA} from '../src/entrada-ia.mjs';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const MAX_BYTES = 2 * 1024 * 1024;

export function lerArgumentos(args) {
  const opcoes = {};
  if (args.length === 1 && args[0] === '--help') return {ajuda: true};
  for (let i = 0; i < args.length; i += 2) {
    const nome = args[i], valor = args[i + 1];
    if (!['--site', '--porta', '--saida'].includes(nome) || !valor || valor.startsWith('--') || Object.hasOwn(opcoes, nome.slice(2))) {
      throw new Error('Use --site domínio, com --porta e --saida opcionais.');
    }
    opcoes[nome.slice(2)] = valor;
  }
  opcoes.site = normalizarSite(opcoes.site);
  opcoes.porta ??= '8794';
  if (!/^\d{1,5}$/.test(opcoes.porta) || Number(opcoes.porta) < 1 || Number(opcoes.porta) > 65535) {
    throw new Error('Informe uma porta local válida.');
  }
  opcoes.porta = Number(opcoes.porta);
  opcoes.saida = resolve(opcoes.saida || resolve(RAIZ, 'data/ia/entrada.json'));
  return opcoes;
}

async function lerRelatorio(resposta) {
  if (!resposta.ok || !resposta.headers.get('content-type')?.includes('application/json') || !resposta.body) {
    await resposta.body?.cancel();
    throw new Error('O servidor local não forneceu um relatório válido. Abra o aplicativo e consulte o site primeiro.');
  }
  const partes = [], leitor = resposta.body.getReader();
  let tamanho = 0;
  try {
    while (true) {
      const {done, value} = await leitor.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > MAX_BYTES) throw new Error('O relatório local excedeu o limite de leitura.');
      partes.push(value);
    }
  } finally { await leitor.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(partes).toString('utf8')); }
  catch { throw new Error('O servidor local retornou um relatório ilegível.'); }
}

export async function prepararArquivo(opcoes, {fetch = globalThis.fetch, agora = Date.now} = {}) {
  const {site, porta, saida} = lerArgumentos(['--site', opcoes.site, '--porta', String(opcoes.porta ?? 8794),
    '--saida', opcoes.saida || resolve(RAIZ, 'data/ia/entrada.json')]);
  const origem = `http://127.0.0.1:${porta}`;
  let resposta;
  try {
    resposta = await fetch(origem + '/api/agente', {method: 'POST', redirect: 'error',
      headers: {'Content-Type': 'application/json', Origin: origem}, body: JSON.stringify({site}),
      signal: AbortSignal.timeout(10_000)});
  } catch { throw new Error('Não foi possível consultar o aplicativo local. Inicie npm start e confira a porta.'); }
  const relatorio = await lerRelatorio(resposta);
  if (relatorio?.dominio !== site || relatorio?.versao !== 1 || relatorio?.metodo !== 'regras-abertas-v1') {
    throw new Error('O relatório local não corresponde ao domínio ou à versão esperada.');
  }
  const entrada = prepararEntradasIA(relatorio, {agora});
  await mkdir(dirname(saida), {recursive: true, mode: 0o700});
  const temporario = saida + '.' + randomUUID() + '.tmp';
  try {
    const arquivo = await open(temporario, 'wx', 0o600);
    try { await arquivo.writeFile(JSON.stringify(entrada, null, 2) + '\n', 'utf8'); }
    finally { await arquivo.close(); }
    await rename(temporario, saida);
  } finally { await unlink(temporario).catch(() => {}); }
  return {saida, entradas: entrada.entradas.length};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opcoes = lerArgumentos(process.argv.slice(2));
    if (opcoes.ajuda) console.log('node scripts/preparar-ia.mjs --site exemplo.org [--porta 8794] [--saida data/ia/entrada.json]\nLê somente as evidências já salvas no aplicativo local. Não consulta Google.');
    else {
      const resultado = await prepararArquivo(opcoes);
      console.log(`Entrada local para IA salva em ${resultado.saida} (${resultado.entradas} contexto(s)).`);
    }
  } catch (erro) {
    console.error(erro.message);
    process.exitCode = 1;
  }
}
