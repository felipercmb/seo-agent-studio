import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {parse} from 'parse5';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normal = valor => String(valor ?? '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const match = (texto,padroes) => padroes.some(p => new RegExp(p,'u').test(normal(texto)));
const clonar = valor => structuredClone(valor);

export function selecionarCasos(corpus,splits) {
  if (!Array.isArray(corpus?.casos) || !Array.isArray(splits) || !splits.length) throw new Error('Informe a divisão explicitamente.');
  const casos = corpus.casos.filter(c => splits.includes(c.split));
  if (!casos.length) throw new Error('A divisão solicitada não contém casos; não produzir uma avaliação vazia.');
  if (new Set(casos.map(c=>c.id)).size !== casos.length || new Set(casos.map(c=>c.dominio)).size !== casos.length) throw new Error('IDs ou domínios repetidos no conjunto.');
  return casos;
}

export function resumirRevisaoSemantica(registros) {
  // Passing a schema, ID or literal citation is intentionally insufficient.
  const tarefas = registros.flatMap(r => r.tarefas || []);
  const passa = t => ['U1','U2','U3','U4'].every(k => t[k] === true) && typeof t.justificativa === 'string' && t.justificativa.trim().length > 0;
  return {empresasAvaliadas:registros.length,tarefasAvaliadas:tarefas.length,
    tarefasUteis:tarefas.filter(passa).length,
    empresasComTarefaUtil:registros.filter(r=>(r.tarefas||[]).some(passa)).length,
    limite:'Revisão técnica por agente segundo rubrica congelada; não parecer humano profissional nem resultado comercial.'};
}

function textoHtml(html) {
  const partes=[];
  function visitar(n) {
    if (['script','style','svg'].includes(n.nodeName)) return;
    if (n.nodeName==='#text') partes.push(n.value);
    for (const a of n.attrs||[]) if (['content','alt','aria-label','title'].includes(a.name)) partes.push(a.value);
    for (const c of n.childNodes||[]) visitar(c);
  }
  visitar(parse(html));return normal(partes.join(' '));
}

function referencia(e,captura) {
  const url=e?.url || e?.paginaAlvo;
  const sha=e?.sha256 || e?.sha256Pagina;
  const p=captura.paginas.find(p=>p.url===url && p.sha256===sha && p.coletadoEm===e?.coletadoEm);
  if (!p) return {estado:'nao_corresponde_captura'};
  const trecho=e?.trecho || e?.evidencia;
  return {estado:trecho && textoHtml(p.html).includes(normal(trecho)) ? 'literal_no_html' : 'derivacao_ou_trecho_nao_literal',
    url:p.url,sha256:p.sha256,coletadoEm:p.coletadoEm};
}

function indicadoresPerfil(perfil,rotulo,captura) {
  const atua = perfil.entendimento?.atuacoes || [];
  const nomes = [...(perfil.ofertas||[]).map(o=>({nome:o.nome,tipo:'oferta',fonte:'ofertas',evidencias:o.evidencias||[]})),
    ...atua.filter(a=>['oferta','programa_social'].includes(a.tipo)).map(a=>({...a,fonte:'atuacoes'}))];
  const grupos = rotulo.negocio.gruposCentrais.map(g=>({id:g.id,
    correspondenciasLexicais:nomes.filter(o=>match(o.nome,g.padroes)).map(o=>({nome:o.nome,tipo:o.tipo,fonte:o.fonte})),
    limite:'Candidato lexical para revisão semântica; não equivale a recuperar corretamente a atividade.'}));
  const propostas = (perfil.ofertas||[]).map(o=>({nome:o.nome,
    negativaExataRotulada:rotulo.negocio.naoOfertas.some(n=>normal(n)===normal(o.nome)),
    gruposLexicais:rotulo.negocio.gruposCentrais.filter(g=>match(o.nome,g.padroes)).map(g=>g.id),
    referencias:(o.evidencias||[]).map(e=>referencia(e,captura))}));
  return {grupos,propostas,papel:{obtido:perfil.entendimento?.papel || 'indefinido',aceitaveis:rotulo.negocio.papeisAceitaveis,
    enumCompativel:rotulo.negocio.papeisAceitaveis.includes(perfil.entendimento?.papel || 'indefinido'),
    entendimentoMinimo:rotulo.negocio.entendimentoMinimo,exigeRevisaoDoSentido:true},
    finalidade:perfil.entendimento?.finalidade || null,proposito:perfil.entendimento?.proposito || null,
    publicos:perfil.entendimento?.publicos || [],publicosEsperados:rotulo.negocio.publicosEsperados,
    qualidade:perfil.entendimento?.qualidade || null,
    fonteInsuficiente:rotulo.leitura.fonteInsuficiente,corpoPoucoLegivel:rotulo.leitura.corpoPoucoLegivel};
}

async function importar(raiz,arquivo,opcional=false) {
  try {return await import(pathToFileURL(resolve(raiz,arquivo)).href);}
  catch(erro) {if(opcional&&erro.code==='ERR_MODULE_NOT_FOUND') return null;throw erro;}
}

export async function avaliarNegocioUtilidade({raiz,raizDados,corpus,splits}) {
  const casos=selecionarCasos(corpus,splits),agora=Date.parse(corpus.congeladoEm);
  if(!Number.isFinite(agora)) throw new Error('Relógio de avaliação ausente.');
  const [mDesc,mPerfil,mPal,mDiag,mOport,mContexto,mIA]=await Promise.all([
    importar(raiz,'src/descoberta.mjs'),importar(raiz,'src/modulos/perfil.mjs'),
    importar(raiz,'src/modulos/palavras.mjs'),importar(raiz,'src/analise.mjs'),
    importar(raiz,'src/modulos/oportunidades.mjs'),importar(raiz,'src/modulos/contexto-publico.mjs',true),
    importar(raiz,'src/modulos/ia.mjs',true)]);
  const resultados=[],erros=[];
  for(const caso of casos) {
    const inicio=performance.now();
    try {
      const bytes=await readFile(resolve(raizDados,caso.arquivoCaptura));
      if(hash(bytes)!==caso.capturaSha256) throw new Error('Hash da captura diverge do rótulo.');
      const captura=JSON.parse(bytes),descoberta=mDesc.descobrirTermos(captura);
      const contextoPublico=mContexto?.extrairContextoPublico(captura) || null;
      const perfil=mPerfil.inferirPerfil({dominio:captura.dominio,descoberta,coletadoEm:captura.coletadoEm,contextoPublico});
      const diagnostico=mDiag.analisarPaginas(captura);
      function executar(estagio,perfilEtapa) {
        const palavras=mPal.gerarPalavras({perfil:perfilEtapa,descoberta});
        const oportunidades=mOport.avaliarOportunidades({perfil:perfilEtapa,palavras,diagnostico,
          posicoes:null,demanda:null,coleta:captura,contextoPublico},{agora:()=>agora});
        const projeto={dominio:captura.dominio,perfil:perfilEtapa,palavras,descoberta,diagnostico,contextoPublico,
          coletadoEm:captura.coletadoEm,posicoes:null,capacidades:{posicoes:{configurada:false}}};
        const ia=mIA?.prepararIAProjeto(projeto,{agora:()=>agora}) || null;
        const primeirasConsultas=palavras.candidatos.slice(0,5);
        const fila=oportunidades.planoDeAcao||[];
        return {estagio,perfil:perfilEtapa,palavras,oportunidades,selecaoIA:ia,
          paraRevisao:{primeirasConsultas,primeirasTarefas:fila.slice(0,3),
            criterio:'Aplicar rubrica U1-U4 e rótulos do negócio; nenhum crédito automático por campo preenchido, ID ou ação.'},
          controles:{ofertas:perfilEtapa.ofertas.length,consultas:palavras.candidatos.length,tarefas:fila.length,
            contextosIA:ia?.entrada?.entradas?.length ?? 0,
            nenhumDadoGoogleOuFinanceiroObservado:oportunidades.itens.every(i=>i.observado.posicao===null && i.observado.buscasMensais===null && i.valorPorContato===null),
            economiaDesconhecida:perfilEtapa.ofertas.every(o=>o.economia.contribuicaoPorVenda===null && o.economia.taxaFechamento===null),
            aguardaConfirmacaoPerfil:perfilEtapa.estado!=='confirmado',
            confirmacaoSimulada:estagio==='confirmacao_tecnica_simulada_sem_alterar_proposta',
            exigeRevisaoHumana:true}};
      }
      const rascunho=executar('fluxo_real_sem_confirmacao',perfil);
      // A controlled branch exercises the plan only. It does not correct the
      // business, write a client project or claim owner approval.
      const simulado=clonar(perfil);
      if(simulado.ofertas.length || simulado.entendimento?.atuacoes?.length) simulado.estado='confirmado';
      const condicional=executar('confirmacao_tecnica_simulada_sem_alterar_proposta',simulado);
      resultados.push({id:caso.id,dominio:caso.dominio,split:caso.split,familia:caso.familia,
        capturaSha256:caso.capturaSha256,paginasCapturadas:captura.paginas.length,falhasColeta:captura.falhas,
        leituraRotulada:caso.leitura,rotulos:caso,perfilIndicadores:indicadoresPerfil(perfil,caso,captura),
        rascunho,condicional,contextoPublico,diagnostico,
        latenciaMs:Math.round((performance.now()-inicio)*100)/100,
        limiteSimulacao:'Somente ensaio técnico em memória, sem confirmação real da empresa, edição de sua proposta, treino ou gravação em cliente.'});
    } catch(erro) {erros.push({id:caso.id,dominio:caso.dominio,split:caso.split,erro:String(erro.message)});}
  }
  return {versao:1,geradoEm:new Date().toISOString(),relogioReferencia:corpus.congeladoEm,
    raizAvaliada:resolve(raiz),splits,denominadores:{organizacoesSolicitadas:casos.length,
      executadas:resultados.length,comHtml:resultados.filter(r=>r.paginasCapturadas>0).length,
      comGrupoCentralRotulado:casos.filter(c=>c.negocio.gruposCentrais.length).length,
      gruposCentrais:casos.reduce((n,c)=>n+c.negocio.gruposCentrais.length,0),
      comPublicoRotulado:casos.filter(c=>c.negocio.publicosEsperados.length).length,
      paresPublicoRotulados:casos.reduce((n,c)=>n+c.negocio.publicosEsperados.length,0),
      semContextoIA:resultados.filter(r=>r.rascunho.controles.contextosIA===0).length,erros:erros.length},
    resultados,erros,estadoRevisaoSemantica:'pendente',
    limites:['Matching lexical auxilia a revisão, não mede entendimento nem utilidade.',
      'Sem inferência de modelo neste script. Contextos IA são projeções determinísticas.',
      'Falhas, fontes fracas e ausência de elegibilidade ficam visíveis nos denominadores.',
      'Só a rubrica congelada e a revisão técnica semântica podem classificar tarefa útil; não há avaliação profissional externa.']};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const opts={},args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2) {
    if(!['--raiz','--dados','--rotulos','--saida','--splits'].includes(args[i])||!args[i+1]) throw new Error('Argumentos inválidos.');
    opts[args[i]]=args[i+1];
  }
  if(!opts['--rotulos']||!opts['--saida']||!opts['--splits']) throw new Error('Informe rótulos, saída nova e splits explicitamente.');
  const bytes=await readFile(resolve(opts['--rotulos']));
  const resultado=await avaliarNegocioUtilidade({raiz:opts['--raiz']||process.cwd(),raizDados:opts['--dados']||dirname(resolve(opts['--rotulos'])),
    corpus:JSON.parse(bytes),splits:opts['--splits'].split(',')});
  resultado.rotulosSha256=hash(bytes);resultado.avaliadorSha256=hash(await readFile(new URL(import.meta.url)));
  await writeFile(resolve(opts['--saida']),JSON.stringify(resultado,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(resultado.denominadores));
}
