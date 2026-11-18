/** Diagnóstico local sem rede, inferência, download ou alteração do banco. */
import {access, lstat, readdir, readFile, mkdtemp, open, rm, statfs} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as util from 'node:util';
import {RAIZ_PROJETO, carregarConfiguracao, validarNode} from '../lib/config.mjs';
import {criarFonteGoogleAds} from '../src/modulos/google-ads.mjs';

const CHAVES_ENV = ['PORT', 'DATA_DIR', 'SERPAPI_KEY', 'GOOGLE_ADS_DEMANDA',
  'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_ACCESS_TOKEN', 'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'GOOGLE_ADS_API_VERSION'];
const MODELO = 'data/ia/negocio/modelos/qwen35-4b-4bit-sem-pensamento';
const ARQUIVOS_MODELO = ['proveniencia-local.json', 'model.safetensors', 'config.json',
  'tokenizer.json', 'chat_template.jinja'];
const carregarModuloPadrao = nome => import(nome);

async function arquivoRegular(caminho) {
  try { return (await lstat(caminho)).isFile(); } catch { return false; }
}

async function lerAmbiente(raiz, ambiente) {
  let lido = {}, arquivoEnv = 'ausente';
  try {
    const caminho = join(raiz, '.env'), s = await lstat(caminho);
    if (!s.isFile() || s.isSymbolicLink() || s.size > 65536 || typeof util.parseEnv !== 'function') {
      return {arquivoEnv: 'invalido', env: {}};
    }
    const b = await readFile(caminho);
    if (b.length > 65536 || b.includes(0)) return {arquivoEnv: 'invalido', env: {}};
    const conteudo = new TextDecoder('utf-8', {fatal: true}).decode(b);
    lido = util.parseEnv(conteudo); arquivoEnv = 'lido';
  } catch (erro) {
    if (erro.code !== 'ENOENT') return {arquivoEnv: 'ilegivel', env: {}};
  }
  // A configuração explícita do processo tem a mesma precedência do servidor.
  // Não se usa loadEnvFile: o diagnóstico não altera o ambiente do chamador.
  const env = {};
  for (const nome of CHAVES_ENV) {
    if (Object.hasOwn(lido, nome)) env[nome] = lido[nome];
    if (Object.hasOwn(ambiente, nome) && ambiente[nome] !== undefined) env[nome] = ambiente[nome];
  }
  return {arquivoEnv, env};
}

/** Faz uma escrita descartável, sem criar o DATA_DIR nem abrir o banco existente. */
export async function sondarGravacao(diretorio) {
  let alvo = diretorio, existe = true, temporario = null;
  try {
    try {
      const s = await lstat(alvo);
      if (!s.isDirectory() || s.isSymbolicLink()) return {estado: 'alvo_invalido', diretorioExiste: true, escritaVerificada: false};
    } catch (erro) {
      if (erro.code !== 'ENOENT') throw erro;
      existe = false;
      // Verifica a permissão de criação no ancestral existente mais próximo.
      for (;;) {
        const pai = dirname(alvo);
        if (pai === alvo) throw new Error('sem_ancestral');
        alvo = pai;
        try {
          const s = await lstat(alvo);
          if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('ancestral_invalido');
          break;
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
    }
    temporario = await mkdtemp(join(alvo, '.visibilidade-diagnostico-'));
    const arquivo = await open(join(temporario, 'sonda'), 'wx', 0o600);
    try { await arquivo.writeFile('sonda local descartavel\n'); await arquivo.sync(); }
    finally { await arquivo.close(); }
    let espacoDisponivelBytes = null;
    try {
      const fs = await statfs(alvo, {bigint: true}), n = fs.bavail * fs.bsize;
      if (n >= 0n && n <= BigInt(Number.MAX_SAFE_INTEGER)) espacoDisponivelBytes = Number(n);
    } catch { /* Espaço é informativo; uma API ausente não bloqueia a sonda. */ }
    return {estado: existe ? 'gravacao_verificada' : 'criacao_no_ancestral_verificada',
      diretorioExiste: existe, escritaVerificada: true, espacoDisponivelBytes};
  } catch {
    return {estado: 'gravacao_nao_verificada', diretorioExiste: existe, escritaVerificada: false};
  } finally {
    if (temporario) await rm(temporario, {recursive: true, force: true});
  }
}

async function sondarParse5(carregarModulo) {
  try {
    const m = await carregarModulo('parse5');
    if (typeof m.parse !== 'function' || m.parse('<main>sonda local</main>')?.nodeName !== '#document') return false;
    return true;
  } catch { return false; }
}

async function sondarSQLite(carregarModulo) {
  let banco;
  try {
    const {DatabaseSync} = await carregarModulo('node:sqlite');
    banco = new DatabaseSync(':memory:');
    return banco.prepare('SELECT 1 AS sonda').get()?.sonda === 1;
  } catch { return false; }
  finally { try { banco?.close(); } catch { /* Não vaza erro do runtime. */ } }
}

async function sondarEntendimento(raiz, plataforma, arquitetura) {
  const plataformaCompativel = plataforma === 'darwin' && arquitetura === 'arm64';
  let pythonExecutavel = false;
  try { await access(join(raiz, '.venv-ia/bin/python'), constants.X_OK); pythonExecutavel = true; } catch { /* Opcional. */ }
  const scriptPresente = await arquivoRegular(join(raiz, 'ia/negocio/jornadas/executar.py'));
  const ambientePresente = await arquivoRegular(join(raiz, '.venv-ia/pyvenv.cfg'));
  const modeloPresente = (await Promise.all(ARQUIVOS_MODELO.map(n => arquivoRegular(join(raiz, MODELO, n))))).every(Boolean);
  let bibliotecasPresentes = false;
  try {
    const lib = join(raiz, '.venv-ia/lib'), versoes = await readdir(lib);
    for (const versao of versoes.filter(n => /^python3\.\d+$/.test(n))) {
      const nomes = new Set(await readdir(join(lib, versao, 'site-packages')).catch(() => []));
      if (['mlx', 'mlx_lm', 'transformers', 'outlines_core'].every(n => nomes.has(n))) { bibliotecasPresentes = true; break; }
    }
  } catch { /* Ausência de ambiente não instala nada. */ }
  const instalacaoPresente = plataformaCompativel && pythonExecutavel && ambientePresente && scriptPresente && modeloPresente && bibliotecasPresentes;
  return {estado: !plataformaCompativel ? 'plataforma_nao_suportada' : instalacaoPresente ? 'instalacao_presente_nao_testada' : 'instalacao_incompleta',
    plataformaCompativel, pythonExecutavel, ambientePresente, scriptPresente, modeloPresente,
    bibliotecasPresentes, instalacaoPresente, modeloAprovado: false,
    limite: 'Somente presença de arquivos e diretórios. Não testa GPU, dependências importadas, integridade dos pesos ou qualidade do modelo.'};
}

/** API testável. Não passa erro bruto, segredos ou caminhos de configuração à saída. */
export async function diagnosticarLocal({raiz = RAIZ_PROJETO, ambiente = process.env,
  versaoNode = process.versions.node, plataforma = process.platform, arquitetura = process.arch,
  carregarModulo = carregarModuloPadrao, verificarGravacao = sondarGravacao} = {}) {
  raiz = resolve(raiz);
  let nodeCompativel = true;
  try { validarNode(versaoNode); } catch { nodeCompativel = false; }
  const [amb, parse5, sqlite, entendimento] = await Promise.all([
    lerAmbiente(raiz, ambiente), sondarParse5(carregarModulo), sondarSQLite(carregarModulo),
    sondarEntendimento(raiz, plataforma, arquitetura),
  ]);
  let config = null;
  if (['lido', 'ausente'].includes(amb.arquivoEnv)) {
    try { config = carregarConfiguracao({env: amb.env, carregarEnv: false, raiz}); } catch { /* Sanitizado abaixo. */ }
  }
  let armazenamento = {estado: 'nao_verificado', diretorioExiste: null, escritaVerificada: false, espacoDisponivelBytes: null};
  if (config) {
    try {
      const r = await verificarGravacao(config.dataDir);
      const estados = ['alvo_invalido', 'gravacao_verificada', 'criacao_no_ancestral_verificada', 'gravacao_nao_verificada'];
      armazenamento = {estado: estados.includes(r?.estado) ? r.estado : 'gravacao_nao_verificada',
        diretorioExiste: typeof r?.diretorioExiste === 'boolean' ? r.diretorioExiste : null,
        escritaVerificada: r?.escritaVerificada === true && ['gravacao_verificada', 'criacao_no_ancestral_verificada'].includes(r.estado),
        espacoDisponivelBytes: Number.isSafeInteger(r?.espacoDisponivelBytes) && r.espacoDisponivelBytes >= 0 ? r.espacoDisponivelBytes : null};
    } catch { armazenamento.estado = 'gravacao_nao_verificada'; }
  }
  let demandaConfigurada = false;
  if (config && amb.env.GOOGLE_ADS_DEMANDA === '1') {
    // A fábrica apenas valida a configuração. Esta função nunca é executada.
    demandaConfigurada = typeof criarFonteGoogleAds({env: amb.env, fetch: () => { throw new Error('rede_desativada'); }}) === 'function';
  }
  const pronto = nodeCompativel && parse5 && sqlite && config !== null && armazenamento.escritaVerificada;
  return {versao: 1, modo: 'local', estado: pronto ? 'pronto_para_iniciar' : 'requer_correcao',
    node: {compativel: nodeCompativel, versao: /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(versaoNode) ? versaoNode : 'invalida',
      requerido: 'Node.js 22.13 ou posterior da série 22, ou série 24'},
    dependencias: {parse5: parse5 ? 'verificado' : 'nao_verificado', sqlite: sqlite ? 'verificado_em_memoria' : 'nao_verificado'},
    configuracao: {estado: config ? 'valida' : 'invalida', arquivoEnv: amb.arquivoEnv, host: '127.0.0.1', porta: config?.porta ?? null},
    armazenamento, entendimento,
    fontes: {
      posicoes: {configurada: Boolean(config?.fonteConfigurada), estado: !config ? 'configuracao_invalida' : config.fonteConfigurada ? 'configurada_nao_testada' : 'nao_configurada', consultaExecutada: false},
      demanda: {configurada: demandaConfigurada, estado: !config ? 'configuracao_invalida' : amb.env.GOOGLE_ADS_DEMANDA !== '1' ? 'nao_habilitada' : demandaConfigurada ? 'configurada_nao_testada' : 'habilitada_configuracao_invalida', consultaExecutada: false},
    },
    limites: [
      'Nenhuma chamada externa, inferência ou instalação foi executada. A sonda de escrita é removida; nenhum banco existente é aberto.',
      'Fonte configurada não comprova autorização, saldo, cota gratuita, respostas ou posições atuais. O diagnóstico não cria conta nem ativa cobrança.',
      'Instalação da IA não comprova entendimento correto ou utilidade. Revise as sugestões antes de confirmar o perfil.',
      'A coleta posterior do site exige internet. O núcleo funciona sem fontes de posições ou demanda, mantendo esses dados indisponíveis.',
      'Espaço disponível é uma fotografia do sistema de arquivos, sem reserva. A sonda não garante espaço para futuros pesos, capturas ou treinos.',
    ]};
}

export function textoDiagnostico(r) {
  const linhas = [
    'Visibilidade Aberta · diagnóstico local',
    r.estado === 'pronto_para_iniciar' ? 'Núcleo local: pronto para iniciar.' : 'Núcleo local: confira os itens não verificados antes de iniciar.',
    `Node: ${r.node.versao} (${r.node.compativel ? 'compatível' : 'incompatível'}).`,
    `HTML: ${r.dependencias.parse5}; SQLite: ${r.dependencias.sqlite}.`,
    `Configuração: ${r.configuracao.estado}; .env: ${r.configuracao.arquivoEnv}.`,
    `Dados locais: ${r.armazenamento.estado}.`,
    `Entendimento experimental: ${r.entendimento.estado}; aprovação do modelo: não.`,
    `Posições: ${r.fontes.posicoes.estado}; demanda: ${r.fontes.demanda.estado}.`,
    'Nenhuma consulta externa, inferência, instalação ou cobrança foi iniciada.',
  ];
  if (!r.node.compativel) linhas.push('Instale Node.js 22.13+ da série 22 ou Node.js 24.');
  if (r.dependencias.parse5 !== 'verificado') linhas.push('Confira as dependências instaladas com npm ci antes de iniciar.');
  if (!r.armazenamento.escritaVerificada) linhas.push('Confira DATA_DIR e a permissão de escrita do usuário que executa o aplicativo.');
  if (r.fontes.posicoes.estado === 'nao_configurada') linhas.push('Sem fonte de posições, o aplicativo mantém rankings e concorrentes não observados como indisponíveis.');
  return linhas.join('\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.includes('--help') && args.length === 1) {
    console.log('Uso: node scripts/diagnosticar-local.mjs [--json]\nVerifica o ambiente local sem rede ou carregamento de modelo.');
  } else if (args.some(a => a !== '--json') || args.length > 1) {
    console.error('Argumento inválido. Use --help ou --json.'); process.exitCode = 2;
  } else {
    diagnosticarLocal().then(r => {
      console.log(args[0] === '--json' ? JSON.stringify(r, null, 2) : textoDiagnostico(r));
      process.exitCode = r.estado === 'pronto_para_iniciar' ? 0 : 1;
    }).catch(() => { console.error('Não foi possível completar o diagnóstico local. Nenhum detalhe de configuração foi exibido.'); process.exitCode = 1; });
  }
}
