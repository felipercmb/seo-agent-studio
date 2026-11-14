import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const RAIZ_PROJETO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export class ErroConfiguracao extends Error {
  constructor(mensagem) { super(mensagem); this.name = 'ErroConfiguracao'; }
}

export function validarNode(versao = process.versions.node) {
  const [maior, menor] = String(versao).split('.').map(Number);
  if (!Number.isInteger(menor) || !(maior === 22 && menor >= 13 || maior === 24)) {
    throw new ErroConfiguracao('Este projeto requer Node.js 22 (a partir de 22.13) ou Node.js 24.');
  }
}

export function carregarDotEnv(arquivo = join(RAIZ_PROJETO, '.env')) {
  validarNode();
  const existentes = {...process.env};
  try { process.loadEnvFile(arquivo); }
  catch (erro) {
    if (erro.code !== 'ENOENT') throw new ErroConfiguracao('Não foi possível ler o arquivo .env. Verifique o caminho e a permissão de leitura.');
  } finally {
    // Keep explicit shell/service configuration above optional .env defaults.
    for (const [nome, valor] of Object.entries(existentes)) process.env[nome] = valor;
  }
}

export function carregarConfiguracao({env = process.env, carregarEnv = env === process.env,
  arquivoEnv = join(RAIZ_PROJETO, '.env'), raiz = RAIZ_PROJETO} = {}) {
  validarNode();
  if (carregarEnv) carregarDotEnv(arquivoEnv);
  const valorPorta = String(env.PORT ?? '8794').trim();
  if (!/^\d{1,5}$/.test(valorPorta) || Number(valorPorta) > 65535) {
    throw new ErroConfiguracao('PORT deve ser um número entre 0 e 65535. O padrão é 8794.');
  }
  const diretorio = env.DATA_DIR == null || env.DATA_DIR === '' ? 'data' : env.DATA_DIR;
  if (typeof diretorio !== 'string' || !diretorio.trim() || /[\u0000-\u001f\u007f]/.test(diretorio)) {
    throw new ErroConfiguracao('DATA_DIR deve indicar um diretório local válido.');
  }
  const chave = String(env.SERPAPI_KEY ?? '').trim();
  if (chave && !/^[a-zA-Z0-9_-]{16,256}$/.test(chave)) {
    throw new ErroConfiguracao('SERPAPI_KEY tem formato inválido. Confira a chave no arquivo .env sem publicá-la.');
  }
  const dataDir = resolve(raiz, diretorio);
  return Object.freeze({host: '127.0.0.1', porta: Number(valorPorta), dataDir,
    arquivoBanco: join(dataDir, 'visibilidade.sqlite'), chave, fonteConfigurada: Boolean(chave)});
}
