import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, open, mkdir, writeFile, unlink, rmdir} from 'node:fs/promises';
import {resolve, dirname, join, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const DESTINO_PADRAO = join(RAIZ, 'data/ia/modular');
const MAX_JSON = 2 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const hash = dados => createHash('sha256').update(dados).digest('hex');
const objeto = valor => !!valor && typeof valor === 'object' && !Array.isArray(valor);

export class ErroDisponibilizacao extends Error {}
const falhar = mensagem => { throw new ErroDisponibilizacao(mensagem); };

async function abrirRegular(arquivo, maximo = Infinity) {
  let handle;
  try {
    const inicial = await lstat(arquivo);
    if (!inicial.isFile() || inicial.size < 1 || inicial.size > maximo) falhar('Use arquivos locais regulares, não vazios e dentro do limite de tamanho. Links simbólicos não são aceitos.');
    handle = await open(arquivo, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== inicial.size || stat.ino !== inicial.ino || stat.dev !== inicial.dev) falhar('Um arquivo mudou durante a conferência. Tente novamente após encerrar as alterações.');
    return {handle,stat};
  } catch (erro) {
    await handle?.close().catch(() => {});
    if (erro instanceof ErroDisponibilizacao) throw erro;
    falhar('Não foi possível ler um arquivo local da seleção. Confira caminho e permissão.');
  }
}

async function lerJSON(arquivo) {
  const {handle,stat} = await abrirRegular(arquivo, MAX_JSON);
  try {
    const dados = await handle.readFile();
    const final = await handle.stat();
    if (dados.length !== stat.size || final.size !== stat.size || final.mtimeMs !== stat.mtimeMs || final.ctimeMs !== stat.ctimeMs) falhar('Um arquivo mudou durante a leitura.');
    let json;
    // Keep a UTF-8 BOM visible so JSON.parse rejects it, matching the Python
    // runtime's plain UTF-8 JSON reader instead of accepting an unusable copy.
    try { json = JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(dados)); }
    catch { falhar('A seleção, a decisão e a configuração precisam ser JSON UTF-8 válido.'); }
    if (!objeto(json)) falhar('A seleção, a decisão e a configuração precisam ser objetos JSON.');
    return {dados,json,sha256:hash(dados)};
  } finally { await handle.close(); }
}

async function hashRegular(arquivo) {
  const {handle,stat} = await abrirRegular(arquivo);
  try {
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    while (true) {
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, bytes);
      if (!bytesRead) break;
      digest.update(buffer.subarray(0, bytesRead)); bytes += bytesRead;
    }
    const final = await handle.stat();
    if (bytes !== stat.size || final.size !== stat.size || final.mtimeMs !== stat.mtimeMs || final.ctimeMs !== stat.ctimeMs) falhar('Os pesos mudaram durante a conferência. Nenhuma seleção foi disponibilizada.');
    return {sha256:digest.digest('hex'),bytes};
  } finally { await handle.close(); }
}

/** Disponibiliza apenas um candidato optativo, sem trocar a seleção padrão.
 * A decisão autoriza disponibilidade experimental, nunca uso autônomo.
 * Pesos continuam na pasta original e são revalidados também pelo runtime.
 */
export async function disponibilizarCandidatoIA({selecao,decisao,destino = DESTINO_PADRAO,agora = Date.now} = {}) {
  if (![selecao,decisao,destino].every(v => typeof v === 'string' && v.trim() && !/[\p{Cc}\p{Cf}]/u.test(v))) falhar('Informe seleção, decisão e destino como caminhos locais válidos.');
  if (typeof agora !== 'function' || !Number.isFinite(agora())) falhar('O relógio local é inválido.');
  const selecaoPath = resolve(selecao), decisaoPath = resolve(decisao), destinoPath = resolve(destino);
  const selecionada = await lerJSON(selecaoPath), decidida = await lerJSON(decisaoPath);
  const s = selecionada.json, d = decidida.json;
  if (s.versao !== 1 || s.tipo !== 'acoes' || s.aprovado_para_uso_autonomo !== false || !objeto(s.candidato)) falhar('A seleção precisa declarar versão, ações e ausência de aprovação para uso autônomo.');
  if (d.estado !== 'experimental_disponivel' || d.selecao_sha256 !== selecionada.sha256 ||
      Object.hasOwn(d,'aprovado_para_uso_autonomo') && d.aprovado_para_uso_autonomo !== false) falhar('A decisão precisa autorizar disponibilidade experimental e conferir o hash exato da seleção.');
  if (typeof s.candidato.pasta !== 'string' || !isAbsolute(s.candidato.pasta) || /[\p{Cc}\p{Cf}]/u.test(s.candidato.pasta) ||
      !HASH.test(s.adaptador_sha256 || '') || !HASH.test(s.candidato.config_adaptador_sha256 || '') ||
      Object.hasOwn(s.candidato,'adaptador_sha256') && s.candidato.adaptador_sha256 !== s.adaptador_sha256 || s.candidato.base === true) {
    falhar('O candidato precisa identificar uma pasta absoluta de adaptador e hashes coerentes de pesos e configuração.');
  }
  const pesosPath = join(s.candidato.pasta,'adapters.safetensors'), configPath = join(s.candidato.pasta,'adapter_config.json');
  const config = await lerJSON(configPath), pesos = await hashRegular(pesosPath);
  if (pesos.sha256 !== s.adaptador_sha256 || config.sha256 !== s.candidato.config_adaptador_sha256) falhar('Os pesos ou a configuração diferem dos hashes da seleção. Nenhum candidato foi disponibilizado.');
  const auditoria = {versao:1,estado:'experimental_disponivel',criadoEm:new Date(agora()).toISOString(),
    aprovado_para_uso_autonomo:false,destino:destinoPath,
    selecao:{origem:selecaoPath,sha256:selecionada.sha256},decisao:{origem:decisaoPath,sha256:decidida.sha256},
    candidato:{pasta:s.candidato.pasta,adaptador_sha256:pesos.sha256,config_adaptador_sha256:config.sha256,bytesPesos:pesos.bytes},
    arquivos:['selecao-interface-candidata.json','decisao-interface-candidata.json','disponibilizacao.json'],
    limite:'Disponibilidade optativa para comparação local. Não troca a seleção padrão, não aprova decisões autônomas e não comprova resultado comercial.'};
  let criado = false;
  const escritos = [];
  try {
    await mkdir(dirname(destinoPath),{recursive:true,mode:0o700});
    try { await mkdir(destinoPath,{mode:0o700}); criado = true; }
    catch { falhar('O destino deve ser um diretório novo. Nada será substituído.'); }
    // The availability pair is published last: partial writes cannot expose a
    // selection whose matching decision has not been copied yet.
    for (const [nome,dados] of [
      ['disponibilizacao.json',JSON.stringify(auditoria,null,2)+'\n'],
      ['selecao-interface-candidata.json',selecionada.dados],
      ['decisao-interface-candidata.json',decidida.dados],
    ]) {
      const arquivo = join(destinoPath,nome);
      await writeFile(arquivo,dados,{flag:'wx',mode:0o600}); escritos.push(arquivo);
    }
    return auditoria;
  } catch (erro) {
    if (criado) {
      for (const arquivo of escritos.reverse()) await unlink(arquivo).catch(() => {});
      await rmdir(destinoPath).catch(() => {});
    }
    if (erro instanceof ErroDisponibilizacao) throw erro;
    falhar('Não foi possível gravar o candidato no diretório novo. Os arquivos anteriores foram preservados.');
  }
}

export function argumentosCandidato(argv) {
  const opcoes = {};
  for (let i=0;i<argv.length;i+=2) {
    const nome = argv[i], valor = argv[i+1];
    if (!['--selecao','--decisao','--destino'].includes(nome) || !valor || valor.startsWith('--') || Object.hasOwn(opcoes,nome.slice(2))) falhar('Use --selecao ARQUIVO --decisao ARQUIVO [--destino DIRETORIO_NOVO].');
    opcoes[nome.slice(2)] = valor;
  }
  if (!opcoes.selecao || !opcoes.decisao) falhar('Informe --selecao e --decisao.');
  return opcoes;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).length === 1 && process.argv[2] === '--help') {
    console.log('Uso local: node scripts/disponibilizar-candidato-ia.mjs --selecao ARQUIVO --decisao ARQUIVO [--destino DIRETORIO_NOVO]');
  } else {
    try { console.log(JSON.stringify(await disponibilizarCandidatoIA(argumentosCandidato(process.argv.slice(2))),null,2)); }
    catch (erro) {
      console.error(erro instanceof ErroDisponibilizacao ? erro.message : 'Não foi possível disponibilizar o candidato local.');
      process.exitCode = 1;
    }
  }
}
