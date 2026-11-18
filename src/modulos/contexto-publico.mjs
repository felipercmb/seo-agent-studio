import {parse} from 'parse5';
import {createHash} from 'node:crypto';
import {normalizarSite} from '../consulta.mjs';
import {tituloDeEvento} from '../descoberta.mjs';
import {cabecalhoComercialPublicado, declaracaoDoNegocioPublicada, declaracaoDoPublicoPublicada, finalidadeDaPagina, nomeDeProdutoPublicado} from './linguagem-negocio.mjs';
import {extrairInteracoesDaPagina} from './interacoes-publicas.mjs';
import {extrairPerguntasPublicadas} from './perguntas-publicadas.mjs';
import {extrairMediacoesDaFonte,limiteDeOrcamentos} from './mediacao-publicada.mjs';
import {lerPrazosPublicados} from './prazos-publicados.mjs';
import {attrs as atributos,oculto,terceiro,estruturais,navegacaoSemantica,controleApresentacao,
  controleEscolha,feedbackFormulario,ignorados,textoProjetado,escopoDeTitulos,registrarTitulo} from './texto-publicado-dom.mjs';

const MAX_HTML = 1024 * 1024, MAX_TOTAL = 4 * 1024 * 1024, MAX_PAGINAS = 12;
const MAX_EVIDENCIAS = 24, MAX_NOS = 30_000;
const MAX_FONTES_DE_PRAZO_POR_PAGINA = 4;
const ORGANIZACOES = new Set(['Organization', 'Corporation', 'LocalBusiness', 'ProfessionalService', 'Store', 'OnlineStore', 'OnlineBusiness', 'EducationalOrganization', 'School', 'CollegeOrUniversity', 'NGO', 'Hotel', 'LodgingBusiness', 'BedAndBreakfast', 'Restaurant', 'FoodEstablishment', 'RealEstateAgent', 'InsuranceAgency', 'TravelAgency', 'EmploymentAgency']);
const texto = valor => typeof valor === 'string' ? valor.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim() : '';
const tipoSchema = valor => (Array.isArray(valor) ? valor : [valor]).filter(v => typeof v === 'string').map(v => v.replace(/^https?:\/\/schema\.org\//, ''));
function schemaValido(valor) {
  if (typeof valor === 'string') return /^https?:\/\/schema\.org\/?$/.test(valor);
  if (Array.isArray(valor)) return valor.some(schemaValido);
  return valor && typeof valor === 'object' && schemaValido(valor['@vocab']);
}
/** Reads bounded public descriptions already fetched by the site's collector.
 * It makes no requests, executes no page scripts, and never stores raw HTML. */
export function extrairContextoPublico(coleta = {}) {
  const dominio = normalizarSite(coleta.dominio);
  const registros = [], paginasVistas = new Set(), coberturaPaginas = [], detalhesPorUrl=[],interacoesPorPagina=[],perguntasPorPagina=[];
  const fontesDePrazo = [], fontesDeMediacao = [];
  let paginasLidas = 0, bytes = 0, limitada = false, fontesDescontinuas = 0;
  const adicionar = (tipo, campo, trecho, pagina, secao = null, rotuloDeBloco = null, titulos = []) => {
    const limpo = texto(trecho);
    if (!limpo || registros.length >= 288) { if (registros.length >= 288) limitada = true; return; }
    // Names and titles must retain their exact public wording. Descriptions
    // may be excerpted and are explicitly treated as descriptions, not offers.
    if (['servico', 'produto'].includes(tipo) && limpo.length > 120) { limitada = true; return; }
    if (tipo === 'titulo' && limpo.length > 600) { limitada = true; return; }
    if (limpo.length > 600) limitada = true;
    registros.push({tipo, url:pagina.url, campo, trecho:limpo.slice(0, 600),
      coletadoEm:pagina.coletadoEm, sha256:pagina.sha256,recortado:limpo.length>600,intencaoPagina:finalidadeDaPagina(pagina.url),
      ...(secao ? {secao:texto(secao).slice(0, 120)} : {}), ...(rotuloDeBloco ? {rotuloDeBloco} : {}),
      ...(titulos.length?{titulos:titulos.map(h=>({...h,texto:h.texto.slice(0,240)}))}:{})});
  };
  const paginas = Array.isArray(coleta.paginas) ? coleta.paginas : [];
  for (const pagina of paginas.slice(0, MAX_PAGINAS)) {
    try {
      const url = new URL(pagina.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || pagina.url.includes('#') ||
          normalizarSite(url.href) !== dominio || typeof pagina.html !== 'string' || !pagina.html.trim() ||
          pagina.html.length > MAX_HTML || pagina.status != null && pagina.status !== 200) { limitada = true; continue; }
      if (paginasVistas.has(url.href)) continue;
      const tamanho = Buffer.byteLength(pagina.html, 'utf8');
      if (tamanho > MAX_HTML || bytes + tamanho > MAX_TOTAL) { limitada = true; continue; }
      const hash = createHash('sha256').update(pagina.html).digest('hex');
      if (pagina.sha256 && pagina.sha256 !== hash) { limitada = true; continue; }
      bytes += tamanho; paginasVistas.add(url.href);
      const data = pagina.coletadoEm || coleta.coletadoEm;
      const fonte = {url:url.href, coletadoEm:typeof data === 'string' && Number.isFinite(Date.parse(data)) ? data : null, sha256:hash};
      const documento=parse(pagina.html);
      const pilha = [{no:documento,visivel:false,navegacao:false,escopo:{titulos:[]}}];
      const partesVisiveis=[], detalhes=[], prazosDaPagina=new Map(), mediacoesDaPagina=new Map(), cacheTexto=new WeakMap(), ultimoElemento=new WeakMap();
      let nos=0,jsons=0,h1=0,paginaLimitada=false,descontinuas=0;
      function lerTexto(no){
        if (!cacheTexto.has(no)) {
          const p=textoProjetado(no);
          const descontinua=p.omissoes.length>0&&p.segmentos.length!==1;
          if(p.limitada||descontinua)descontinuas++;
          cacheTexto.set(no,p.limitada||descontinua?'':texto(p.omissoes.length?p.segmentos[0]:p.texto));
        }
        return cacheTexto.get(no);
      }
      while (pilha.length) {
        if (++nos > MAX_NOS) { limitada = true; paginaLimitada = true; break; }
        const item=pilha.pop(),no=item.no,a=atributos(no);
        const navegacao=item.navegacao||estruturais.has(no.tagName)||navegacaoSemantica(a);
        if(ignorados.has(no.tagName)||oculto(a)||terceiro(a)||controleApresentacao(a)||
          controleEscolha(a)||feedbackFormulario(a))continue;
        const local=escopoDeTitulos(no,item.escopo);
        if (no.nodeName === '#text' && item.visivel) partesVisiveis.push(no.value);
        if (no.tagName === 'title') adicionar('titulo','title',lerTexto(no),fonte);
        const publicavel=item.visivel&&!navegacao;
        const cabecalho = /^h[1-6]$/.test(no.tagName);
        const evento = publicavel && cabecalho && tituloDeEvento(no, fonte, dominio);
        if (publicavel && cabecalho && !evento){
          const titulo=lerTexto(no);
          registrarTitulo(local,Number(no.tagName[1]),titulo);
          if(no.tagName==='h1'&&h1++<2)adicionar('titulo','h1',titulo,fonte);
          if (no.tagName !== 'h1' && cabecalhoComercialPublicado(titulo.replace(/^\+?\s*\d+\s+/,''))) adicionar('titulo',no.tagName,titulo,fonte);
          else if (/\b(?:missão|missao|propósito|proposito|programa|voluntariado|doa[çc][\p{L}]*|doe|apadrinhe|capta[çc][\p{L}]*)\b/iu.test(titulo)) adicionar('declaracao',no.tagName,titulo,fonte);
          else if(declaracaoDoPublicoPublicada(titulo)||declaracaoDoNegocioPublicada(titulo))adicionar('declaracao',no.tagName,titulo,fonte);
        }
        const secao=local.titulos.at(-1)?.texto||'';
        if (publicavel&&no.tagName === 'p') {
          const trecho=lerTexto(no),intencao=finalidadeDaPagina(fonte.url);
          const anterior=ultimoElemento.get(no.parentNode);
          const rotulo=anterior?.tagName==='p'?lerTexto(anterior):'';
          const rotuloDeBloco=/^servi[çc]o com garantia$/iu.test(rotulo)?rotulo:null;
          const mediacoes=extrairMediacoesDaFonte({trecho,secao,contexto:{titulos:local.titulos}},dominio);
          if(mediacoesDaPagina.size<4&&mediacoes.some(m=>m.forma==='intermediacao_entre_partes')){
            mediacoesDaPagina.set(trecho,{tipo:'declaracao',campo:'p',trecho,secao:secao.slice(0,120),
              titulos:local.titulos.map(h=>({...h,texto:h.texto.slice(0,240)})),...fonte,recortado:false});
          }
          if (declaracaoDoNegocioPublicada(trecho) || declaracaoDoPublicoPublicada(trecho) ||
              mediacoes.length ||
              /^(?:missão|missao|propósito|proposito|o que fazemos)$/iu.test(secao) && trecho.length>=20 ||
              ['catalogo','publica'].includes(intencao) && trecho.length<=120 && nomeDeProdutoPublicado(trecho)) {
            adicionar('declaracao','p',trecho,fonte,secao,rotuloDeBloco,local.titulos);
          }
        }
        if(no.tagName&&no.parentNode)ultimoElemento.set(no.parentNode,no);
        if(publicavel&&['p','li','dd'].includes(no.tagName)&&prazosDaPagina.size<MAX_FONTES_DE_PRAZO_POR_PAGINA) {
          const trecho=lerTexto(no);
          if(trecho.length<=600&&/\b(?:at[eé]|prazo de|anteced[eê]ncia|na hora|imediatamente|somente|apenas)(?![\p{L}\p{N}])/iu.test(trecho)&&
            !prazosDaPagina.has(trecho)&&lerPrazosPublicados(trecho).length) {
            prazosDaPagina.set(trecho,{tipo:'declaracao',campo:no.tagName,trecho,secao:secao.slice(0,120),
              titulos:local.titulos.map(h=>({...h,texto:h.texto.slice(0,240)})),...fonte,recortado:false});
          }
        }
        if(publicavel&&!evento&&(cabecalho||no.tagName==='p'||no.tagName==='li')&&detalhes.length<160) {
          const trecho=lerTexto(no);
          if(trecho.length<=1600&&(trecho.length>=(cabecalho?5:25)||!cabecalho&&limiteDeOrcamentos.test(trecho)))detalhes.push({tipo:cabecalho?'cabecalho':no.tagName==='li'?'item':'paragrafo',
            campo:no.tagName,trecho:trecho.slice(0,360),secao:secao.slice(0,120),
            titulos:local.titulos.map(h=>({...h,texto:h.texto.slice(0,240)})),...fonte,recortado:trecho.length>360});
        }
        if (no.tagName === 'meta' && a.name?.toLowerCase() === 'description') adicionar('descricao', 'meta.description', a.content, fonte);
        if (no.tagName === 'meta' && a.property?.toLowerCase() === 'og:description') adicionar('descricao', 'meta.og:description', a.content, fonte);
        if (no.tagName === 'script') {
          if (a.type?.toLowerCase().trim() !== 'application/ld+json') continue;
          if (++jsons > 4) { limitada = true; continue; }
          const bruto = (no.childNodes || []).map(n => n.value || '').join('');
          if (bruto.length > 65_536) { limitada = true; continue; }
          let valor;
          try { valor = JSON.parse(bruto); } catch { continue; }
          if (Array.isArray(valor) && valor.length > 100) limitada = true;
          const fila = (Array.isArray(valor) ? valor : [valor]).slice(0, 100).map(v => ({v, schema:false}));
          let objetos = 0;
          while (fila.length && objetos++ < 500) {
            const {v, schema} = fila.shift();
            if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
            const valido = Object.hasOwn(v, '@context') ? schemaValido(v['@context']) : schema;
            if (!valido) continue;
            const tipos = tipoSchema(v['@type']);
            if (tipos.includes('Service')) adicionar('servico', 'jsonld.Service.name', v.name, fonte);
            if (tipos.includes('Course')) adicionar('servico', 'jsonld.Course.name', v.name, fonte);
            if (tipos.includes('Product')) adicionar('produto', 'jsonld.Product.name', v.name, fonte);
            if (tipos.some(t => ORGANIZACOES.has(t))) {
              let propria = true;
              if (typeof v.url === 'string') {
                try { propria = normalizarSite(new URL(v.url, fonte.url).href) === dominio; } catch { propria = false; }
              }
              if (propria) {
                const tipo = tipos.find(t=>ORGANIZACOES.has(t) && !['Organization','Corporation','LocalBusiness','OnlineBusiness'].includes(t)) || 'Organization';
                adicionar('organizacao', 'jsonld.'+tipo+'.name', v.name, fonte);
                adicionar('organizacao', 'jsonld.'+tipo+'.description', v.description, fonte);
              }
            }
            for (const chave of ['@graph', 'hasOfferCatalog', 'itemListElement', 'itemOffered', 'offers', 'service', 'mainEntity', 'provider']) {
              const filhos = Array.isArray(v[chave]) ? v[chave] : [v[chave]];
              for (const filho of filhos.slice(0, 100)) if (filho && typeof filho === 'object') fila.push({v:filho, schema:valido});
            }
          }
          if (fila.length) limitada = true;
          continue;
        }
        const visivel=item.visivel || no.tagName === 'body';
        pilha.push(...(no.childNodes || []).slice().reverse().map(filho=>({no:filho,visivel,navegacao,escopo:local})));
      }
      paginasLidas++;
      fontesDescontinuas+=descontinuas;
      paginaLimitada||=descontinuas>0;
      coberturaPaginas.push({...fonte,caracteresTextoVisivel:texto(partesVisiveis.join(' ')).length,
        htmlInicial:true,limitada:paginaLimitada});
      interacoesPorPagina.push({url:fonte.url,...extrairInteracoesDaPagina(documento,fonte)});
      perguntasPorPagina.push({url:fonte.url,...extrairPerguntasPublicadas(documento,fonte)});
      fontesDePrazo.push(...prazosDaPagina.values());
      fontesDeMediacao.push(...mediacoesDaPagina.values());
      const vistos=new Set(),unicos=detalhes.filter(d=>{const chave=JSON.stringify([d.campo,d.trecho,d.titulos]);if(vistos.has(chave))return false;vistos.add(chave);return true;});
      const prioridade=d=>declaracaoDoPublicoPublicada(d.trecho)?0:
        d.tipo!=='cabecalho'&&/\b(?:presencial|remot[oa]|ao vivo|carga hor[áa]ria|dura[çc][ãa]o|inclui|inclu[íi]d[oa]|exige|requisito|modalidade|trilha|cortesia|gratuit[oa]|formato)\b/iu.test(d.trecho)?0:
        declaracaoDoNegocioPublicada(d.trecho)?1:d.tipo!=='cabecalho'&&d.trecho.length>=45?2:
        d.tipo==='cabecalho'&&cabecalhoComercialPublicado(d.trecho)?2:d.tipo==='cabecalho'?4:3;
      const ordenados=unicos.map((d,i)=>({d,i,p:prioridade(d)})).sort((a,b)=>a.p-b.p||a.i-b.i);
      const filas=new Map();
      for(const {d} of ordenados){const chave=d.secao||d.campo;if(!filas.has(chave))filas.set(chave,[]);filas.get(chave).push(d);}
      const equilibrados=[];
      while(equilibrados.length<24&&[...filas.values()].some(f=>f.length))for(const fila of filas.values())if(fila.length&&equilibrados.length<24)equilibrados.push(fila.shift());
      detalhesPorUrl.push({url:fonte.url,candidatos:unicos.length,selecionaveis:equilibrados,limitada:paginaLimitada||detalhes.length>=160});
    } catch { limitada = true; }
  }
  // Repeated navigation/footer descriptions do not consume every slot; retain
  // the first dated source and keep the per-page reading coverage separately.
  const mapaUnicos=new Map();
  for(const e of registros){const chave=JSON.stringify([e.tipo==='descricao'?'descricao':e.campo,e.trecho]);if(!mapaUnicos.has(chave))mapaUnicos.set(chave,e);}
  const unicos=[...mapaUnicos.values()];
  const escolhidos = [];
  for (const tipo of ['titulo', 'descricao', 'organizacao']) {
    const primeira = unicos.find(e => e.tipo === tipo);
    if (primeira) escolhidos.push(primeira);
  }
  const prioridadeDeclaracao=e=>e.tipo!=='declaracao'?5:
    extrairMediacoesDaFonte(e,dominio).length?0:
    /^(?:missão|missao|propósito|proposito)$/iu.test(e.secao||'')&&e.campo==='p'||/^(?:somos|nossa miss[ãa]o|nosso prop[óo]sito)/iu.test(e.trecho)?0:
    /^(?:programa|projeto|iniciativa)\b/iu.test(e.trecho)||declaracaoDoPublicoPublicada(e.trecho)?1:
    /^(?:doa[çc]|doe|apadrinhe)/iu.test(e.trecho)?4:2;
  const declaracoesOrdenadas=unicos.filter(e=>e.tipo==='declaracao').sort((a,b)=>prioridadeDeclaracao(a)-prioridadeDeclaracao(b));
  for (const tipo of ['servico','produto','declaracao']) {
    let usados=0;
    for(const e of tipo==='declaracao'?declaracoesOrdenadas:unicos) if(e.tipo===tipo&&!escolhidos.includes(e)&&usados++<8&&escolhidos.length<MAX_EVIDENCIAS) escolhidos.push(e);
  }
  const restantesPorPagina=new Map();
  for(const e of unicos)if(!escolhidos.includes(e)) {
    if(!restantesPorPagina.has(e.url))restantesPorPagina.set(e.url,[]);
    restantesPorPagina.get(e.url).push(e);
  }
  while(escolhidos.length<MAX_EVIDENCIAS&&[...restantesPorPagina.values()].some(f=>f.length)) {
    for(const fila of restantesPorPagina.values())if(fila.length&&escolhidos.length<MAX_EVIDENCIAS)escolhidos.push(fila.shift());
  }
  const detalhesPublicados=[];
  const filasDetalhes=detalhesPorUrl.map(p=>({p,fila:p.selecionaveis.slice()}));
  // Reserve four records for each URL before a richer page consumes extras.
  for(let rodada=0;rodada<4;rodada++)for(const {fila} of filasDetalhes)if(fila.length&&detalhesPublicados.length<64)detalhesPublicados.push(fila.shift());
  while(detalhesPublicados.length<64&&filasDetalhes.some(p=>p.fila.length))for(const {fila} of filasDetalhes)if(fila.length&&detalhesPublicados.length<64)detalhesPublicados.push(fila.shift());
  const porPagina=detalhesPorUrl.map(p=>({url:p.url,candidatos:p.candidatos,selecionados:detalhesPublicados.filter(d=>d.url===p.url).length,
    limitada:p.limitada||p.candidatos>detalhesPublicados.filter(d=>d.url===p.url).length}));
  const interacoesPublicas=[],filasInteracoes=interacoesPorPagina.map(p=>p.itens.slice());
  for(let rodada=0;rodada<4;rodada++)for(const fila of filasInteracoes)if(fila.length&&interacoesPublicas.length<48)interacoesPublicas.push(fila.shift());
  while(interacoesPublicas.length<48&&filasInteracoes.some(f=>f.length))for(const fila of filasInteracoes)if(fila.length&&interacoesPublicas.length<48)interacoesPublicas.push(fila.shift());
  const perguntasPublicadas=[],filasPerguntas=perguntasPorPagina.map(p=>p.itens.slice());
  while(perguntasPublicadas.length<48&&filasPerguntas.some(f=>f.length))for(const fila of filasPerguntas)if(fila.length&&perguntasPublicadas.length<48)perguntasPublicadas.push(fila.shift());
  return {versao:1, dominio, coletadoEm:coleta.coletadoEm || null, evidencias:escolhidos,
    perguntasPublicadas,coberturaPerguntas:{itens:perguntasPublicadas.length,limiteTotal:48,limitePagina:12,
      porPagina:perguntasPorPagina.map(p=>({url:p.url,selecionados:perguntasPublicadas.filter(f=>f.url===p.url).length,descartes:p.descartes,limitada:p.limitada||p.itens.length>perguntasPublicadas.filter(f=>f.url===p.url).length})),
      limitada:Boolean(limitada||coleta.cobertura?.limitada||coleta.falhas?.length||perguntasPorPagina.some(p=>p.limitada)||filasPerguntas.some(f=>f.length))},
    interacoesPublicas,coberturaInteracoes:{itens:interacoesPublicas.length,limiteTotal:48,limitePagina:8,limiteRotulo:120,
      porPagina:interacoesPorPagina.map(p=>({url:p.url,candidatos:p.candidatos,selecionados:interacoesPublicas.filter(i=>i.url===p.url).length,
        limitada:p.limitada||p.candidatos>interacoesPublicas.filter(i=>i.url===p.url).length})),
      limitada:Boolean(limitada||coleta.cobertura?.limitada||coleta.falhas?.length||interacoesPorPagina.some(p=>p.limitada)||interacoesPorPagina.reduce((n,p)=>n+p.itens.length,0)>48)},
    fontesDePrazo,...(fontesDeMediacao.length?{fontesDeMediacao}:{}),
    detalhesPublicados,coberturaDetalhes:{trechos:detalhesPublicados.length,limiteTotal:64,limitePorPagina:24,limiteCaracteres:360,
      porPagina,fontesDescontinuasDescartadas:fontesDescontinuas,limitada:Boolean(porPagina.some(p=>p.limitada)||detalhesPublicados.some(d=>d.recortado)||limitada||paginas.length>MAX_PAGINAS||coleta.cobertura?.limitada||coleta.falhas?.length)},
    cobertura:{paginasLidas, paginas:coberturaPaginas, limitePaginas:MAX_PAGINAS, evidencias:escolhidos.length, limiteEvidencias:MAX_EVIDENCIAS,
      limitada:Boolean(limitada || paginas.length > MAX_PAGINAS || unicos.length > MAX_EVIDENCIAS || coleta.cobertura?.limitada || coleta.falhas?.length)},
    limites:[
      'Descrições e nomes são declarações publicadas pelo site, não confirmação independente do negócio.',
      'O contexto usa títulos, descrições, cabeçalhos nominais, declarações e nomes estruturados do HTML inicial já coletado. Não executa scripts nem lê depoimentos. Formulários só fornecem rótulos públicos em coleção separada; valores, opções e conteúdo preenchido não são lidos.',
      'Caracteres visíveis descrevem somente o HTML inicial lido. Pouco texto não comprova que a página renderizada por JavaScript não contenha informações.',
      'São retidas até 24 evidências de até 12 páginas. Uma descrição não é transformada inteira em palavra-chave ou oferta.',
      'Os detalhes de apoio usam até 64 trechos (24 por página, 360 caracteres), com reserva por URL e seleção por seção. A seleção não inventaria todas as modalidades ou condições; recortes são sinalizados.',
      'Cada página preserva até quatro trechos completos com prazos reconhecidos. A ficha usa a URL da oferta e conserva os vínculos ainda pendentes.',
      'Interações públicas são nomes de controles e botões do HTML inicial, sem preenchimento ou envio. Não provam oferta, papel comercial, disponibilidade, funcionamento ou conversão. São até 48 rótulos, oito por página.',
      'Perguntas e respostas de FAQPage são uma coleção separada com ponteiros e hash do JSON-LD. São declarações estruturadas; não confirmam exibição na página, autoria efetiva, adequação ao cliente ou atividade própria da empresa.',
    ]};
}
