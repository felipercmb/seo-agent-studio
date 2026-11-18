import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const hash = valor => createHash('sha256').update(valor).digest('hex');
const chave = valor => String(valor ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
const CONTEXTO = {pais:'Brasil', idioma:'Português', dispositivo:'Computador', localidade:'Brasil'};

export function descobertaControlada(caso, instante) {
  const data = new Date(instante).toISOString();
  return {candidatos:caso.publicado.map((c, i) => ({termo:c.termo,tipo:c.tipo,
    evidencia:{url:c.url || `https://${caso.dominio}/servicos`, campo:c.campo || 'h2',
      trecho:c.trecho || c.termo, coletadoEm:data, sha256:hash(`fixture:${caso.id}:${i}:${c.termo}`)}})),
    cobertura:{paginasLidas:1, limitePaginas:12, termosDescobertos:caso.publicado.length, limitada:false},
    limites:['Entrada controlada sintética dos módulos; não é uma captura real de site ou do Google.']};
}

function captura(caso, candidato, medida, instante) {
  const data = new Date(instante - (medida.idadeMs ?? 60_000)).toISOString();
  const resultados = Array.from({length:10}, (_, i) => {
    const dominio = i + 1 === medida.posicao ? caso.dominio : `rival-fixture-${i + 1}.com.br`;
    return {url:`https://${dominio}/oferta`, dominio, titulo:`Resultado fictício ${i + 1}`,
      pagina:1, inicio:0, posicaoNaPagina:i+1, posicao:i+1};
  });
  const p = {termo:candidato.termo,resultados,inicio:0,pagina:1,contexto:{...CONTEXTO,...medida.contexto},
    fonte:{nome:'SerpApi',id:`fixture_${caso.id.replace(/[^a-zA-Z0-9_-]/g, '_')}_${hash(candidato.termo).slice(0,8)}`},
    coletadoEm:data,profundidadeObservada:10,proximoInicio:null,paginacaoInterrompida:false,
    paginacaoComLacuna:false,limiteAtingido:false,relacionadas:[]};
  p.sha256 = hash(JSON.stringify(p));
  p.hashEscopo = 'captura-google-pagina-v1';
  if (medida.corrompida) p.sha256 = '0'.repeat(64);
  const alvo = resultados.find(r => r.dominio === caso.dominio);
  return {termo:candidato.termo,estado:alvo ? 'encontrado' : 'nao_encontrado',posicao:alvo?.posicao ?? null,
    posicaoNaPagina:alvo?.posicaoNaPagina ?? null,pagina:alvo?.pagina ?? null,url:alvo?.url ?? null,
    paginas:[p],resultados,acima:[],coletadoEm:data,contexto:{...p.contexto},concluida:true};
}

export async function carregarModulos(raiz) {
  const carregar = caminho => import(pathToFileURL(resolve(raiz,caminho)).href);
  const [perfil,palavras,oportunidades] = await Promise.all([
    carregar('src/modulos/perfil.mjs'), carregar('src/modulos/palavras.mjs'), carregar('src/modulos/oportunidades.mjs')]);
  return {...perfil,...palavras,...oportunidades};
}

export function executarCaso(caso, modulos, instante) {
  const inicio = performance.now();
  const descoberta = descobertaControlada(caso, instante);
  const inferido = modulos.inferirPerfil({dominio:caso.dominio,descoberta,coletadoEm:new Date(instante).toISOString()});
  let perfil = inferido;
  if (caso.declarado) perfil = modulos.corrigirPerfil(perfil,{...caso.declarado,confirmado:caso.confirmado !== false});
  const palavras = modulos.gerarPalavras({perfil,descoberta});
  const consultas = [];
  for (const medida of caso.medidas || []) {
    const c = palavras.candidatos.find(c => chave(c.termo) === chave(medida.termo));
    if (c) consultas.push(captura(caso,c,medida,instante));
  }
  const posicoes = {versao:2,dominio:caso.dominio,estado:consultas.length ? 'verificado' : 'fonte_nao_configurada',
    candidatos:palavras.candidatos,consultas,descoberta:{...descoberta.cobertura,coletadoEm:new Date(instante).toISOString()}};
  const demanda = caso.demanda ? {fonte:'Fixture declaradamente simulada',coletadoEm:new Date(instante-1000).toISOString(),
    pais:'Brasil',idioma:'Português',periodoInicio:'2025-11',periodoFim:'2026-10',...caso.demanda} : null;
  const oportunidades = modulos.avaliarOportunidades({perfil,palavras,posicoes,demanda},{agora:() => instante});
  const saida = {inferido,perfil,palavras,posicoes,oportunidades};
  const checagens = [];
  const conferir = (categoria,id,esperado,obtido,passou) => checagens.push({categoria,id,esperado,obtido,passou});
  for (const nome of caso.esperado.ofertasObrigatorias || []) {
    const encontrado = inferido.ofertas.some(o => chave(o.nome) === chave(nome));
    conferir('ofertas_obrigatorias',nome,true,encontrado,encontrado);
  }
  for (const oferta of inferido.ofertas) {
    const suporte = (caso.esperado.ofertasAceitaveis || []).some(n => chave(n) === chave(oferta.nome));
    conferir('ofertas_propostas',oferta.nome,'suportada',suporte ? 'suportada' : 'indevida',suporte);
  }
  for (const nome of caso.esperado.ofertasProibidas || []) {
    const ausente = !inferido.ofertas.some(o => chave(o.nome) === chave(nome));
    conferir('ofertas_proibidas',nome,'ausente',ausente ? 'ausente' : 'presente',ausente);
  }
  for (const item of caso.esperado.palavras || []) {
    const c = palavras.candidatos.find(c => chave(c.termo) === chave(item.termo));
    const oferta = perfil.ofertas.find(o => o.id === c?.ofertaId)?.nome ?? null;
    if (item.ausente) conferir('exclusoes',item.termo,'ausente',c ? 'presente' : 'ausente',!c);
    else {
      conferir('cobertura_palavras',item.termo,'presente',c ? 'presente' : 'ausente',!!c);
      if ('oferta' in item) conferir('vinculos',item.termo,item.oferta,oferta,!!c && chave(oferta) === chave(item.oferta));
      if (item.intencao) conferir('intencoes',item.termo,item.intencao,c?.intencao ?? null,c?.intencao === item.intencao);
    }
  }
  for (const e of caso.esperado.oportunidades || []) {
    const item = oportunidades.itens.find(i => chave(i.termo) === chave(e.termo));
    conferir('cobertura_recomendacoes',e.termo,'presente',!!item,!!item);
    if (!item) continue;
    if (e.prioridades) conferir('acoes_adequadas',e.termo,e.prioridades,item.prioridade,e.prioridades.includes(item.prioridade));
    if ('posicao' in e) conferir('posicoes',e.termo,e.posicao,item.observado?.posicao,item.observado?.posicao === e.posicao);
    if ('volume' in e) conferir('volumes',e.termo,e.volume,item.observado?.buscasMensais,item.observado?.buscasMensais === e.volume);
    if ('valor' in e) conferir('cenarios',e.termo,e.valor,item.valorPorContato?.valor ?? null,(item.valorPorContato?.valor ?? null) === e.valor);
    conferir('explicacoes',e.termo,'acao e verificação não vazias',!!(item.acao?.trim() && item.comoValidar?.trim() && item.motivo?.trim()),!!(item.acao?.trim() && item.comoValidar?.trim() && item.motivo?.trim()));
  }
  return {id:caso.id,split:caso.split,familia:caso.familia,dominio:caso.dominio,natureza:caso.natureza,
    latenciaMs:Math.round((performance.now()-inicio)*100)/100,entrada:{descoberta,declarado:caso.declarado??null,demanda},saida,checagens};
}

export async function avaliarCasos(corpus, modulos, splits) {
  const instante = Date.parse(corpus.relogioReferencia);
  const casos = corpus.casos.filter(c => !splits?.length || splits.includes(c.split));
  const resultados = [], erros = [];
  for (const caso of casos) {
    try { resultados.push(executarCaso(caso,modulos,instante)); }
    catch (erro) { erros.push({id:caso.id,split:caso.split,erro:String(erro.message)}); }
  }
  const metricas = {};
  for (const r of resultados) for (const c of r.checagens) {
    metricas[c.categoria] ??= {aprovados:0,total:0};
    metricas[c.categoria].total++; metricas[c.categoria].aprovados += Number(c.passou);
  }
  return {versao:1,relogioReferencia:corpus.relogioReferencia,natureza:'avaliação técnica sintética; não mede vendas ou posições reais',
    casosSolicitados:casos.length,casosExecutados:resultados.length,errosExecucao:erros,metricas,
    casosIntegralmenteAprovados:resultados.filter(r => r.checagens.every(c => c.passou)).length,
    falhas:resultados.flatMap(r => r.checagens.filter(c => !c.passou).map(c => ({caso:r.id,...c}))),resultados};
}

async function main() {
  const args = process.argv.slice(2), opcoes = {};
  for (let i=0; i<args.length; i+=2) {
    if (!['--raiz','--casos','--saida','--splits'].includes(args[i]) || !args[i+1]) throw new Error('Argumentos inválidos');
    opcoes[args[i]] = args[i+1];
  }
  if (!opcoes['--casos'] || !opcoes['--saida']) throw new Error('Informe --casos e --saida');
  const bytes = await readFile(resolve(opcoes['--casos']));
  const corpus = JSON.parse(bytes);
  const modulos = await carregarModulos(opcoes['--raiz'] || process.cwd());
  const resultado = await avaliarCasos(corpus,modulos,opcoes['--splits']?.split(','));
  resultado.corpusSha256 = hash(bytes);
  resultado.raizAvaliada = resolve(opcoes['--raiz'] || process.cwd());
  await writeFile(resolve(opcoes['--saida']),JSON.stringify(resultado,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({casos:resultado.casosSolicitados,executados:resultado.casosExecutados,
    integralmenteAprovados:resultado.casosIntegralmenteAprovados,erros:resultado.errosExecucao.length,
    metricas:resultado.metricas,falhas:resultado.falhas.length}));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
