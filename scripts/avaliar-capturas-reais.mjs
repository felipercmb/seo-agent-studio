import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {parse} from 'parse5';

const hash = v => createHash('sha256').update(v).digest('hex');
const normal = v => String(v??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const corresponde = (oferta,grupo) => grupo.padroes.some(p => new RegExp(p,'u').test(normal(oferta)));

function textosDoHtml(html) {
  const partes=[],pilha=[parse(html)];
  while(pilha.length){const n=pilha.pop();if(n.nodeName==='#text')partes.push(n.value);
    for(const a of n.attrs||[])if(['content','name','alt','aria-label','title'].includes(a.name))partes.push(a.value);
    pilha.push(...(n.childNodes||[]).slice().reverse());}
  return normal(partes.join(' '));
}

export function evidenciaDaPropostaVerificavel(oferta,captura) {
  if(!Array.isArray(oferta.evidencias)||!oferta.evidencias.length)return false;
  return oferta.evidencias.some(e=>{
    const p=captura.paginas.find(p=>p.url===e.url&&p.sha256===e.sha256&&p.coletadoEm===e.coletadoEm);
    if(!p||typeof e.trecho!=='string'||!normal(e.trecho)||!normal(oferta.nome)||
      !normal(e.trecho).includes(normal(oferta.nome)))return false;
    return textosDoHtml(p.html).includes(normal(e.trecho));
  });
}

export function avaliarPerfilReal(perfil,rotulo) {
  const propostas = (perfil.ofertas||[]).map(o => {
    const negativa = rotulo.naoOfertas.some(n => normal(n)===normal(o.nome));
    const grupos = rotulo.gruposObrigatorios.filter(g => corresponde(o.nome,g)).map(g => g.id);
    return {nome:o.nome,grupos,classe:negativa ? 'indevida_rotulada' : grupos.length ? 'compativel_com_rotulo' : 'nao_revisada'};
  });
  const grupos = rotulo.gruposObrigatorios.map(g => ({id:g.id,
    presente:propostas.some(p => p.classe!=='indevida_rotulada'&&p.grupos.includes(g.id))}));
  const papel = perfil.entendimento?.papel ?? 'indefinido';
  return {papel:{obtido:papel,aceitaveis:rotulo.papeisAceitaveis,compativel:rotulo.papeisAceitaveis.includes(papel)},
    grupos,propostas,totalPropostas:propostas.length,
    propostasCompativeis:propostas.filter(p=>p.classe==='compativel_com_rotulo').length,
    propostasIndevidas:propostas.filter(p=>p.classe==='indevida_rotulada').length,
    propostasNaoRevisadas:propostas.filter(p=>p.classe==='nao_revisada').length};
}

async function importar(raiz,nome,opcional=false) {
  try {return await import(pathToFileURL(resolve(raiz,nome)).href);}
  catch(erro) {if(opcional&&erro.code==='ERR_MODULE_NOT_FOUND')return null;throw erro;}
}

export async function avaliarCapturas({raiz,raizDados,rotulos,splits,agora=Date.now}) {
  const [descobertaModulo,perfilModulo,palavrasModulo,diagnosticoModulo,oportunidadesModulo,contextoModulo] = await Promise.all([
    importar(raiz,'src/descoberta.mjs'),importar(raiz,'src/modulos/perfil.mjs'),importar(raiz,'src/modulos/palavras.mjs'),
    importar(raiz,'src/analise.mjs'),importar(raiz,'src/modulos/oportunidades.mjs'),importar(raiz,'src/modulos/contexto-publico.mjs',true)]);
  const resultados=[],erros=[];
  const casos=rotulos.casos.filter(c=>!splits?.length||splits.includes(c.split));
  for(const rotulo of casos){
    const inicio=performance.now();
    try {
      const bytes=await readFile(resolve(raizDados,rotulo.arquivoCaptura));
      if(hash(bytes)!==rotulo.capturaSha256)throw new Error('Captura difere do manifesto');
      const captura=JSON.parse(bytes),descoberta=descobertaModulo.descobrirTermos(captura);
      const contextoPublico=contextoModulo?.extrairContextoPublico(captura)??null;
      const perfil=perfilModulo.inferirPerfil({dominio:captura.dominio,descoberta,
        coletadoEm:captura.coletadoEm,contextoPublico});
      const diagnostico=diagnosticoModulo.analisarPaginas(captura);
      const palavras=palavrasModulo.gerarPalavras({perfil,descoberta});
      const perfilCenario={...perfil,estado:perfil.ofertas.length?'confirmado':'rascunho'};
      const palavrasCenario=palavrasModulo.gerarPalavras({perfil:perfilCenario,descoberta});
      const oportunidades=oportunidadesModulo.avaliarOportunidades({perfil:perfilCenario,palavras:palavrasCenario,
        posicoes:null,demanda:null,diagnostico},{agora});
      const perfilAvaliacao=avaliarPerfilReal(perfil,rotulo);
      const evidenciasPropostas=perfil.ofertas.map(o=>({nome:o.nome,verificavel:evidenciaDaPropostaVerificavel(o,captura)}));
      const semMetricasInventadas=oportunidades.itens.every(i=>i.observado.posicao===null&&i.observado.buscasMensais===null&&i.valorPorContato===null);
      const tarefas=(oportunidades.frentes||[]).map(f=>({oferta:f.nome,pagina:f.paginaAlvo,
        teste:f.proximoTeste,melhoriasObservadas:f.melhoriasObservadas||[]}));
      const acoesExecutaveis=tarefas.filter(t=>t.teste?.acao&&t.teste?.passos?.length&&t.teste?.criterioSucesso);
      const acoesLocais=tarefas.filter(t=>['conferir_oferta','corrigir_uso','confirmar_publicacao','validar_pagina','reler_pagina'].includes(t.teste?.tipo));
      const filaUnica=Array.isArray(oportunidades.planoDeAcao)?oportunidades.planoDeAcao:[];
      const filaLocal=filaUnica.filter(t=>['conferir_oferta','corrigir_uso','confirmar_publicacao','validar_pagina','reler_pagina'].includes(t.tipo));
      const positivos=descoberta.candidatos.filter(c=>rotulo.gruposObrigatorios.some(g=>corresponde(c.termo,g))&&!rotulo.naoOfertas.some(n=>normal(n)===normal(c.termo)));
      const estado=captura.paginas.length?'com_leitura':'sem_leitura';
      resultados.push({id:rotulo.id,split:rotulo.split,dominio:rotulo.dominio,familia:rotulo.familia,estado,
        coletadoEm:captura.coletadoEm,paginasLidas:captura.paginas.length,cobertura:captura.cobertura,
        falhasColeta:captura.falhas,latenciaMs:Math.round((performance.now()-inicio)*100)/100,
        perfilAvaliacao,evidenciasPropostas,semMetricasInventadas,
        dadosObservados:{perfil,descoberta,palavras,contextoPublico,diagnostico},
        cenarioTecnico:{natureza:'Revisão técnica simulada para exercitar o módulo; não é confirmação pela empresa. Valores comerciais desconhecidos.',
          perfilEstado:perfilCenario.estado,palavras:palavrasCenario,oportunidades},
        utilidade:{frentes:tarefas.length,acoesExecutaveis:acoesExecutaveis.length,
          acoesLocaisSemFonte:acoesLocais.length,diagnosticosObservados:diagnostico.verificacoes.filter(v=>v.estado==='atencao').length,
          tarefasUnicas:filaUnica.length,tarefasLocaisUnicas:filaLocal.length,
          limite:'A existência de passos e critério é verificação estrutural, não julgamento especializado de eficácia.'},
        coberturaTermos:{total:palavras.candidatos.length,expressosCompativeisComGrupos:positivos.length,
          vinculados:palavras.candidatos.filter(c=>c.ofertaId).length},tarefas});
    }catch(erro){erros.push({id:rotulo.id,split:rotulo.split,dominio:rotulo.dominio,erro:String(erro.message)});}
  }
  const resumo={dominiosSolicitados:casos.length,dominiosExecutados:resultados.length,
    dominiosComLeitura:resultados.filter(r=>r.estado==='com_leitura').length,
    paginas:resultados.reduce((n,r)=>n+r.paginasLidas,0),
    papeisCompativeis:{quantidade:resultados.filter(r=>r.perfilAvaliacao.papel.compativel).length,total:casos.length},
    gruposObrigatorios:{quantidade:resultados.flatMap(r=>r.perfilAvaliacao.grupos).filter(g=>g.presente).length,
      total:casos.reduce((n,c)=>n+c.gruposObrigatorios.length,0)},
    propostas:{total:resultados.reduce((n,r)=>n+r.perfilAvaliacao.totalPropostas,0),
      compativeis:resultados.reduce((n,r)=>n+r.perfilAvaliacao.propostasCompativeis,0),
      indevidas:resultados.reduce((n,r)=>n+r.perfilAvaliacao.propostasIndevidas,0),
      naoRevisadas:resultados.reduce((n,r)=>n+r.perfilAvaliacao.propostasNaoRevisadas,0)},
    propostasComReferenciaLiteral:{quantidade:resultados.flatMap(r=>r.evidenciasPropostas).filter(e=>e.verificavel).length,
      total:resultados.reduce((n,r)=>n+r.perfilAvaliacao.totalPropostas,0)},
    dominiosSemMetricasInventadas:{quantidade:resultados.filter(r=>r.semMetricasInventadas).length,total:casos.length},
    acoesLocaisSemFonte:resultados.reduce((n,r)=>n+r.utilidade.acoesLocaisSemFonte,0),
    acoesEstruturadas:resultados.reduce((n,r)=>n+r.utilidade.acoesExecutaveis,0),
    tarefasUnicas:resultados.reduce((n,r)=>n+r.utilidade.tarefasUnicas,0),
    tarefasLocaisUnicas:resultados.reduce((n,r)=>n+r.utilidade.tarefasLocaisUnicas,0),
    errosExecucao:erros.length};
  return {versao:1,geradoEm:new Date(agora()).toISOString(),raizAvaliada:resolve(raiz),resumo,resultados,erros,
    limites:['Capturas públicas reais sem autenticação; não há Google SERP, volume, conversão ou receita real.',
      'Rótulos técnicos de autodeclarações no recorte lido, sem confirmação da empresa ou revisão profissional.',
      'Propostas não revisadas permanecem visíveis; não são contadas automaticamente como corretas ou incorretas.',
      'Referência literal verifica URL/hash/data e ocorrência textual; não valida a interpretação comercial nem autentica o publicador.',
      'Bloqueios de coleta permanecem no denominador de domínios solicitados.',
      'O cenário confirmado serve somente para avaliação técnica local; não foi salvo no perfil de qualquer cliente.']};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2),opts={};
  for(let i=0;i<args.length;i+=2){if(!['--raiz','--dados','--rotulos','--saida','--splits'].includes(args[i])||!args[i+1])throw new Error('Argumentos inválidos');opts[args[i]]=args[i+1];}
  if(!opts['--rotulos']||!opts['--saida'])throw new Error('Informe --rotulos e --saida');
  const bytes=await readFile(resolve(opts['--rotulos']));
  const resultado=await avaliarCapturas({raiz:opts['--raiz']||process.cwd(),raizDados:opts['--dados']||dirname(resolve(opts['--rotulos'])),
    rotulos:JSON.parse(bytes),splits:opts['--splits']?.split(',')});
  resultado.rotulosSha256=hash(bytes);resultado.avaliadorSha256=hash(await readFile(new URL(import.meta.url)));
  await writeFile(resolve(opts['--saida']),JSON.stringify(resultado,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(resultado.resumo));
}
