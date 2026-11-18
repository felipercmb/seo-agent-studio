/** Coleta pública de sites predefinidos. Os arquivos e HTML ficam somente em data/. */
import {mkdir, open, readFile, realpath} from 'node:fs/promises';
import {resolve, join, dirname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {coletarSite} from '../../src/coleta.mjs';
import {analisarPaginas} from '../../src/analise.mjs';
import {descobrirTermos} from '../../src/descoberta.mjs';
import {normalizarSite} from '../../src/consulta.mjs';
import {criarFetchPublico} from '../../lib/rede-publica.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const hash = dados => createHash('sha256').update(dados).digest('hex');

export function validarEscopo(escopo) {
  if (!escopo || escopo.versao !== 1 || !Array.isArray(escopo.sites) || !escopo.sites.length || escopo.sites.length > 20) {
    throw new Error('O escopo precisa ter de um a vinte sites.');
  }
  const vistos = new Set();
  return escopo.sites.map((item, indice) => {
    if (!item || !['train','valid','test'].includes(item.split) || typeof item.site !== 'string') {
      throw new Error('Cada site precisa de domínio e split train, valid ou test.');
    }
    const dominio = normalizarSite(item.site);
    if (vistos.has(dominio)) throw new Error('Um mesmo domínio não pode aparecer em mais de um grupo.');
    vistos.add(dominio);
    return {id: `site-${String(indice + 1).padStart(2,'0')}`, dominio, split: item.split};
  });
}

async function gravarPrivado(caminho, dados) {
  const arquivo = await open(caminho, 'wx', 0o600);
  try { await arquivo.writeFile(dados); } finally { await arquivo.close(); }
}

export async function coletarEmpresas(escopo, pasta, {coletar = coletarSite, fetchPublico = criarFetchPublico()} = {}) {
  const sites = validarEscopo(escopo), destino = resolve(pasta);
  // A pasta de execução precisa ser nova para não alterar capturas anteriores.
  await mkdir(destino, {recursive: false, mode: 0o700});
  await gravarPrivado(join(destino,'escopo.json'), JSON.stringify({versao:1, sites}, null, 2) + '\n');
  const resumo = [];
  for (const site of sites) {
    const pastaSite = join(destino, site.id);
    await mkdir(pastaSite, {mode: 0o700});
    let coleta;
    try {
      coleta = await coletar(site.dominio, {fetch: fetchPublico, objetivo: 'diagnostico', limiteRequisicoes: 40});
    } catch (erro) {
      coleta = {dominio: site.dominio, coletadoEm: new Date().toISOString(), paginas: [],
        falhas: [{url: '', motivo: 'Coleta não concluída: ' + String(erro?.message || 'erro').slice(0, 200)}]};
    }
    const arquivos = [];
    for (const [indice, pagina] of coleta.paginas.entries()) {
      const arquivo = `pagina-${String(indice + 1).padStart(2,'0')}.html`, corpo = Buffer.from(pagina.html, 'utf8');
      await gravarPrivado(join(pastaSite,arquivo), corpo);
      arquivos.push({arquivo, url: pagina.url, coletadoEm: pagina.coletadoEm, status: pagina.status,
        bytes_rede: pagina.bytes, sha256_rede: pagina.sha256, sha256_utf8_local: hash(corpo),
        ...(pagina.cabecalhoRobots ? {cabecalhoRobots:pagina.cabecalhoRobots} : {})});
    }
    const diagnostico = analisarPaginas(coleta), descoberta = descobrirTermos(coleta);
    const registro = {versao:1, id:site.id, dominio:site.dominio, split:site.split,
      coletadoEm:coleta.coletadoEm, arquivos, falhas:coleta.falhas, diagnostico, descoberta,
      posicoesGoogle:'nao_consultadas', contasConectadas:false,
      limites:['HTML inicial; não executa JavaScript.', 'A coleta do site não mede procura, posição no Google, conversão ou retorno.']};
    const dados = JSON.stringify(registro, null, 2) + '\n';
    await gravarPrivado(join(pastaSite,'registro.json'), dados);
    resumo.push({id:site.id, dominio:site.dominio, split:site.split, paginas:arquivos.length,
      alertas:diagnostico.verificacoes.filter(v=>v.estado==='atencao').length,
      termos:descoberta.candidatos?.length ?? 0, falhas:coleta.falhas.length, sha256_registro:hash(dados)});
    console.log(`${site.id} ${site.split}: ${arquivos.length} página(s), ${coleta.falhas.length} falha(s)`);
  }
  const manifest = {versao:1, inicio:escopo.inicio ?? null, concluidoEm:new Date().toISOString(),
    escopo_sha256:hash(await readFile(join(destino,'escopo.json'))), sites:resumo,
    fontes:'Páginas públicas visitadas sem login. Sites e resolvedores DNS recebem requisições; não há API de IA ou SERP.',
    rotulos:'Ainda não revisados; não são recomendações aprovadas por especialista.'};
  await gravarPrivado(join(destino,'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

async function main() {
  const args = process.argv.slice(2), opcoes = {};
  for (let i=0; i<args.length; i+=2) {
    if (!['--escopo','--saida'].includes(args[i]) || !args[i+1] || opcoes[args[i]]) {
      throw new Error('Use --escopo data/ia/.../escopo.json --saida data/ia/.../nova-pasta');
    }
    opcoes[args[i]] = args[i+1];
  }
  if (!opcoes['--escopo'] || !opcoes['--saida']) throw new Error('Informe --escopo e --saida.');
  const entrada = resolve(RAIZ, opcoes['--escopo']), saida = resolve(RAIZ, opcoes['--saida']);
  // Dados reais ficam em data/; esta ferramenta não grava no diretório versionável.
  const permitido = resolve(RAIZ, 'data') + '/';
  if (!saida.startsWith(permitido)) throw new Error('A saída de dados reais deve ficar na pasta data/.');
  await mkdir(dirname(saida), {recursive:true, mode:0o700});
  const pastaReal = await realpath(dirname(saida)), dataReal = await realpath(resolve(RAIZ,'data'));
  if (pastaReal !== dataReal && !pastaReal.startsWith(dataReal + sep)) throw new Error('A pasta de saída aponta para fora de data/.');
  const escopo = JSON.parse(await readFile(entrada,'utf8'));
  await coletarEmpresas(escopo, saida);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (erro) { console.error(erro.message); process.exitCode = 1; }
}
