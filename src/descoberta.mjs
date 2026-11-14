import {parse} from 'parse5';
import {normalizarSite} from './consulta.mjs';
import {destinoPermitido} from './coleta.mjs';

const MAX_HTML = 1024 * 1024;
const MAX_NOS = 30_000;
const MAX_JSON = 65_536;
const MAX_PAGINAS = 12;
const MAX_TERMOS = 100;
const MAX_TOTAL = 4 * 1024 * 1024;
const IGNORAR = new Set(['style', 'template', 'noscript', 'form', 'input', 'textarea', 'select', 'svg']);
const TIPOS_MARCA = new Set(['LocalBusiness', 'Organization', 'Corporation', 'ProfessionalService', 'Store', 'RealEstateAgent', 'Restaurant', 'HomeAndConstructionBusiness']);
const CHAVES_ESTRUTURA = ['@graph', 'hasOfferCatalog', 'itemListElement', 'itemOffered', 'makesOffer', 'offers', 'service', 'provider', 'mainEntity', 'item'];
const GENERICOS = new Set(['inicio', 'home', 'contato', 'fale conosco', 'sobre', 'sobre nos', 'quem somos', 'servicos', 'nossos servicos', 'produtos', 'nossos produtos', 'solucoes', 'nossas solucoes', 'saiba mais', 'conheca', 'menu', 'blog', 'noticias', 'depoimentos', 'clientes', 'nossos clientes', 'entre em contato', 'bem vindo', 'bem vinda', 'politica de privacidade', 'termos de uso', 'cookies', 'resultados', 'contate nos', 'empreendimentos', 'condominios', 'imoveis', 'apartamentos', 'casas', 'lancamentos', 'encontre seu imovel', 'pesquise seu imovel', 'busque seu imovel']);
// A short procedural service can be useful without additional words. Other
// one-word headings may just be categories; explicit Service data below does
// not need this heuristic because it declares what is offered.
const PROCEDIMENTOS = new Set(['alinhamento', 'balanceamento', 'dedetizacao', 'desentupimento', 'impermeabilizacao', 'funilaria', 'serralheria', 'fisioterapia', 'psicoterapia', 'podologia', 'depilacao']);
const limpar = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
const chave = v => limpar(v).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const atributos = no => Object.fromEntries((no.attrs || []).map(a => [a.name, a.value]));
const COMERCIAL = /\b(?:conserto|troca|revisao|manutencao|alinhamento|balanceamento|consultoria|licenciamento|gestao|agencia|servico|servicos|producao|produto|produtos|imoveis|imovel|apartamento|locacao|aluguel|venda|assessoria|instalacao|reparo|tratamento|limpeza|auditoria|projeto|desenvolvimento|seguro|curso|aula|terapia|fisioterapia|dedetizacao|impermeabilizacao|show|shows|contratacao|contratar)\b/;

function contextoComercial(url) {
  let caminho;
  try { caminho = chave(decodeURIComponent(new URL(url).pathname)); } catch { return null; }
  if (/^(?:artistas?|shows?|atracoes|talentos|contratar)\s+\S/.test(caminho)) return 'entidade';
  if (/^(?:produtos?|loja|catalogo|imoveis|empreendimentos)\s+\S/.test(caminho)) return 'produto';
  if (/^(?:servicos?|solucoes|consultoria)\s+\S/.test(caminho)) return 'servico';
  return null;
}

function pareceNomePessoal(termo) {
  const palavras = termo.split(/\s+/);
  return palavras.length >= 2 && palavras.length <= 5 && !COMERCIAL.test(chave(termo)) &&
    palavras.every(p => /^(?:d[aeo]s?|e|&)$/i.test(p) || /^[\p{Lu}][\p{L}]+$/u.test(p));
}

function aceitavel(texto) {
  const normal = chave(texto);
  return texto.length >= 3 && texto.length <= 90 && texto.split(/\s+/).length <= 10 && /\p{L}/u.test(texto) &&
    !['artistas', 'nossos artistas', 'catalogo', 'catalogo de artistas', 'ver todos', 'ver mais', 'equipe', 'nossa equipe', 'nossa missao', 'nossos valores', 'nossa visao', 'biografia'].includes(normal) &&
    !GENERICOS.has(normal) && !/^(?:politica de |termos de |bem vind[oa]|todos os direitos|inscreva se|aceitar cookies|\d+ (?:encontrad|result|imoveis)|nenhum[a]? |nao ha |sem resultados)/.test(normal) &&
    !/^(?:pront[oa]s? (?:para|pra)\b|(?:veja|assista|solicite|peca|agende|fale|clique|saiba|conheca|descubra|venha|transforme|realize|compre|confira|aproveite)\b|perguntas frequentes\b|entre em contato\b|(?:mais de )?\d+ anos\b)/.test(normal) &&
    !/^(?:seu|sua|seus|suas)\b.*\b(?:comeca|comecam|merece|merecem|precisa|precisam|ganha|ganham|encontra|encontram|vai|vao|pode|podem)\b/.test(normal) &&
    !/^(?:o|a|os|as) melhor(?:es)?\b|^(?:excelencia|qualidade|inovacao|confianca) (?:que|para|em cada)\b/.test(normal) &&
    !/(?:\uFFFD|Ã[§£µ¡©­³ºª´€‰]|Â[©®\u00a0]|â€|ðŸ)/u.test(texto) &&
    !/(?:[<>]|https?:\/\/|www\.|\S+@\S+|\b(?:site|intitle|inurl|filetype):|\d[\d\s().+/-]{6,}\d)/i.test(texto);
}

function cabecalhoDescritivo(termo) {
  const palavras = chave(termo).split(' ');
  if (palavras.length === 1) return PROCEDIMENTOS.has(palavras[0]);
  // A coordination of bare labels (such as "Samba e Pagode" or "Moda e
  // Beleza") does not establish a service. Never manufacture a surrounding
  // commercial phrase from the heading and the site's business category.
  if (/^[\p{L}\p{N}]+(?: e [\p{L}\p{N}]+)+$/u.test(chave(termo))) return palavras.some(p => PROCEDIMENTOS.has(p));
  return true;
}

function fragmentos(texto) {
  // No truncation into invented phrases: only published editorial separators.
  return limpar(texto).split(/\s*[|｜]\s*|\s+[–—-]\s+|\s*;\s*/u)
    .map(s => s.replace(/^[\s.:!]+|[\s.:!]+$/g, '').trim()).filter(aceitavel).slice(0, 8);
}

function textoVisivel(no) {
  const partes = [], pilha = [no];
  let n = 0, tamanho = 0;
  while (pilha.length && n++ < 2000 && tamanho < 1500) {
    const atual = pilha.pop(), a = atributos(atual);
    if (IGNORAR.has(atual.tagName) || atual.tagName === 'script' || 'hidden' in a || a['aria-hidden']?.toLowerCase() === 'true' ||
        /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(a.style || '')) continue;
    if (atual.nodeName === '#text') { partes.push(atual.value); tamanho += atual.value.length; }
    else pilha.push(...(atual.childNodes || []).slice().reverse());
  }
  return limpar(partes.join(' '));
}

function contextoSchema(valor) {
  if (typeof valor === 'string') return /^https?:\/\/schema\.org\/?$/.test(valor);
  if (Array.isArray(valor)) return valor.some(contextoSchema);
  return valor && typeof valor === 'object' && contextoSchema(valor['@vocab']);
}

function tiposSchema(no) {
  const tipos = Array.isArray(no['@type']) ? no['@type'] : [no['@type']];
  return tipos.filter(t => typeof t === 'string').map(t => t.replace(/^https?:\/\/schema\.org\//, ''));
}

function localidades(no) {
  const saida = [];
  const areas = Array.isArray(no.areaServed) ? no.areaServed : [no.areaServed];
  for (const area of areas.slice(0, 6)) {
    if (typeof area === 'string' && aceitavel(limpar(area))) saida.push(limpar(area));
    else if (area && typeof area === 'object' && tiposSchema(area).some(t => ['City', 'AdministrativeArea', 'Place'].includes(t)) && aceitavel(limpar(area.name))) saida.push(limpar(area.name));
  }
  return [...new Set(saida)].slice(0, 3);
}

function extrair(pagina, adicionar, marcas, locais, dominio) {
  const raiz = parse(pagina.html), pilha = [raiz], cabecalhos = [];
  const contextoPagina = contextoComercial(pagina.url);
  const metadados = [raiz];
  let ancorasPermitidas = pagina.segueLinks !== false, visitados = 0;
  while (metadados.length && visitados++ < MAX_NOS) {
    const no = metadados.pop(), a = atributos(no);
    if (no.tagName === 'meta' && /^(?:robots|ConsultaVisibilidade)$/i.test(a.name || '') &&
        /(?:^|[\s,])(?:nofollow|none)(?:$|[\s,])/i.test(a.content || '')) ancorasPermitidas = false;
    if (!IGNORAR.has(no.tagName) && no.tagName !== 'script') metadados.push(...(no.childNodes || []));
  }
  let nos = 0, jsons = 0;
  while (pilha.length) {
    if (++nos > MAX_NOS) throw new Error('Limite de elementos');
    const no = pilha.pop(), a = atributos(no);
    if (IGNORAR.has(no.tagName) || /(?:^|[\s_-])(?:team|equipe|author|autor|review|depoimento|testimonial|comment|customer)(?:$|[\s_-])/i.test((a.class || '') + ' ' + (a.id || '')) ||
        'hidden' in a || a['aria-hidden']?.toLowerCase() === 'true' ||
        /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(a.style || '')) continue;
    if (['title', 'h1', 'h2', 'h3'].includes(no.tagName)) {
      const texto = textoVisivel(no);
      for (const parte of fragmentos(texto)) cabecalhos.push({termo: parte, campo: no.tagName, trecho: parte,
        contexto: ['title', 'h1'].includes(no.tagName) ? contextoPagina : null});
    }
    if (no.tagName === 'meta' && a.name?.toLowerCase() === 'description' && /[|｜;]|\s[–—-]\s/u.test(a.content || '')) {
      for (const parte of fragmentos(a.content)) if (COMERCIAL.test(chave(parte)) && parte.split(/\s+/).length <= 7) {
        cabecalhos.push({termo: parte, campo: 'meta.description.fragmento', trecho: parte});
      }
    }
    if (ancorasPermitidas && no.tagName === 'a' && a.href && !('download' in a) && !/(?:^|\s)nofollow(?:\s|$)/i.test(a.rel || '')) {
      const url = destinoPermitido(a.href, dominio, pagina.url), tipo = url && contextoComercial(url.href);
      if (tipo && !/\.[a-z0-9]{2,5}$/i.test(url.pathname)) for (const parte of fragmentos(textoVisivel(no))) {
        if (tipo === 'entidade' || tipo === 'produto' || cabecalhoDescritivo(parte) && !pareceNomePessoal(parte)) {
          adicionar(parte, tipo, 'a.texto', parte, tipo === 'entidade' ? 75 : 65, pagina,
            tipo === 'entidade' ? {rotulo: 'Artista publicado no catálogo'} : {});
        }
      }
    }
    if (no.tagName === 'script') {
      if (a.type?.trim().toLowerCase() !== 'application/ld+json' || ++jsons > 4) continue;
      const bruto = (no.childNodes || []).filter(n => n.nodeName === '#text').map(n => n.value).join('');
      if (!bruto || bruto.length > MAX_JSON) continue;
      let doc;
      try { doc = JSON.parse(bruto); } catch { continue; }
      const fila = (Array.isArray(doc) ? doc : [doc]).slice(0, 100).map(valor => ({valor, schema: false, ofertaDe: null}));
      let objetos = 0;
      while (fila.length && objetos++ < 500) {
        const {valor, schema, ofertaDe} = fila.shift();
        if (!valor || typeof valor !== 'object' || Array.isArray(valor)) continue;
        const valido = Object.hasOwn(valor, '@context') ? contextoSchema(valor['@context']) : schema;
        if (!valido) continue;
        const tipos = tiposSchema(valor), nome = limpar(valor.name);
        if (tipos.some(t => TIPOS_MARCA.has(t)) && aceitavel(nome)) {
          marcas.add(chave(nome));
          adicionar(nome, 'marca', 'jsonld.name', nome, 100, pagina);
        }
        if (tipos.includes('Service')) {
          const tiposServico = (Array.isArray(valor.serviceType) ? valor.serviceType : [valor.serviceType]).slice(0, 5).map(limpar).filter(aceitavel);
          const servicos = [...tiposServico, nome].filter(aceitavel);
          for (const servico of servicos) {
            const campo = tiposServico.includes(servico) ? 'jsonld.Service.serviceType' : 'jsonld.Service.name';
            adicionar(servico, 'servico', campo, servico, 95, pagina);
            for (const local of localidades(valor)) {
              locais.add(chave(local));
              const consulta = servico + ' em ' + local;
              if (aceitavel(consulta)) adicionar(consulta, 'local', campo + '+areaServed', servico + '; área atendida: ' + local, 100, pagina);
            }
          }
        }
        if (tipos.includes('Product') && aceitavel(nome)) adicionar(nome, 'produto', 'jsonld.Product.name', nome, 95, pagina);
        if (tipos.some(t => ['MusicGroup', 'PerformingGroup', 'DanceGroup', 'TheaterGroup'].includes(t)) && aceitavel(nome)) {
          adicionar(nome, 'entidade', 'jsonld.' + tipos[0] + '.name', nome, 90, pagina, {rotulo: 'Artista publicado no catálogo'});
        }
        if (tipos.some(t => ['Offer', 'AggregateOffer'].includes(t)) && aceitavel(nome)) {
          const tiposItem = valor.itemOffered && typeof valor.itemOffered === 'object' ? tiposSchema(valor.itemOffered) : [];
          const tipoOferta = tiposItem.includes('Product') ? 'produto' : tiposItem.includes('Service') ? 'servico' : ofertaDe;
          if (tipoOferta) adicionar(nome, tipoOferta, 'jsonld.Offer.name', nome, 85, pagina);
        }
        if (tipos.some(t => TIPOS_MARCA.has(t))) {
          const endereco = valor.address;
          if (endereco && typeof endereco === 'object' && aceitavel(limpar(endereco.addressLocality))) locais.add(chave(endereco.addressLocality));
        }
        for (const campo of CHAVES_ESTRUTURA) {
          const filhos = Array.isArray(valor[campo]) ? valor[campo] : [valor[campo]];
          for (const filho of filhos.slice(0, 100)) if (filho && typeof filho === 'object') fila.push({valor: filho, schema: valido,
            ofertaDe: campo === 'offers' ? tipos.includes('Product') ? 'produto' : tipos.includes('Service') ? 'servico' : null : null});
        }
      }
      continue;
    }
    pilha.push(...(no.childNodes || []).slice().reverse());
  }
  return cabecalhos;
}

export function descobrirTermos({dominio, coletadoEm, paginas = [], falhas = [], cobertura: coberturaColeta} = {}) {
  paginas = Array.isArray(paginas) ? paginas : [];
  const limites = [
    'As buscas são hipóteses extraídas do conteúdo publicado. Elas não representam todas as palavras do site nem comprovam procura, volume ou posição no Google.',
    'A extração usa títulos, H1, H2, H3, âncoras comerciais internas, fragmentos editoriais de descrições e declarações estruturadas do HTML inicial de até doze páginas; não executa scripts nem lê formulários.',
    'Até cem buscas podem ser descobertas. Slogans, chamadas para ação, dados pessoais e rótulos isolados sem contexto comercial são descartados; o limite não é preenchido artificialmente.',
    'Informações estruturadas são declarações do próprio site e podem estar incorretas ou desatualizadas. A posição exige uma consulta separada ao Google.',
  ];
  let alvo;
  try { alvo = normalizarSite(dominio); }
  catch { return {candidatos: [], limites: [...limites, 'O domínio não pôde ser validado para a descoberta.'],
    cobertura: {paginasLidas: 0, limitePaginas: MAX_PAGINAS, limiteTermos: MAX_TERMOS, termosDescobertos: 0, limitada: true}}; }
  const registros = [], marcas = new Set(), locais = new Set(), cabecalhos = [];
  let ordem = 0, incompletas = 0, paginasLidas = 0, bytes = 0, truncada = false;
  function adicionar(termo, tipo, campo, trecho, peso, pagina, extras = {}) {
    if (!aceitavel(termo)) return;
    if (registros.length >= 3000) { truncada = true; return; }
    registros.push({termo, tipo, ...extras, peso, ordem: ordem++, evidencia: {url: pagina.url, campo, trecho: limpar(trecho).slice(0, 240),
      coletadoEm: limpar(pagina.coletadoEm || coletadoEm) || null, sha256: /^[a-f\d]{64}$/i.test(pagina.sha256 || '') ? pagina.sha256.toLowerCase() : null}});
  }
  const paginasVistas = new Set();
  for (const pagina of (Array.isArray(paginas) ? paginas : []).slice(0, MAX_PAGINAS)) {
    let url;
    try { url = new URL(pagina.url); } catch { incompletas++; continue; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
        ![alvo, 'www.' + alvo].includes(url.hostname) || typeof pagina.html !== 'string' || !pagina.html.trim() ||
        pagina.html.length > MAX_HTML || (pagina.status != null && pagina.status !== 200)) { incompletas++; continue; }
    if (paginasVistas.has(url.href)) continue;
    paginasVistas.add(url.href);
    const tamanho = new TextEncoder().encode(pagina.html).byteLength;
    if (tamanho > MAX_HTML || bytes + tamanho > MAX_TOTAL) { incompletas++; continue; }
    bytes += tamanho;
    const inicioRegistros = registros.length;
    try {
      const marcasPagina = new Set(), locaisPagina = new Set();
      cabecalhos.push(...extrair({...pagina, url: url.href}, adicionar, marcasPagina, locaisPagina, alvo).map(c => ({...c, pagina: {...pagina, url: url.href}})));
      paginasLidas++;
      for (const marca of marcasPagina) marcas.add(marca);
      for (const local of locaisPagina) locais.add(local);
    }
    catch { registros.splice(inicioRegistros); incompletas++; }
  }
  const rotuloDominio = chave(alvo.split('.')[0]).replace(/\s/g, '');
  // A name must actually occur in the page. The hostname only helps classify
  // a published title fragment; it never manufactures a keyword by itself.
  for (const c of cabecalhos) {
    if (c.campo === 'title' && chave(c.termo).replace(/\s/g, '') === rotuloDominio) marcas.add(chave(c.termo));
  }
  const ehMarca = k => marcas.has(k) || (k.length >= 6 && k.split(' ').length >= 2 && [...marcas].some(m => m.startsWith(k + ' ')));
  for (const c of cabecalhos) {
    const k = chave(c.termo);
    const tipo = ehMarca(k) ? 'marca' : c.contexto || ([...locais].some(local => k.endsWith(' em ' + local) || k.endsWith(' no ' + local) || k.endsWith(' na ' + local)) ? 'local' : 'servico');
    if (!['marca', 'produto', 'entidade'].includes(tipo) && (!cabecalhoDescritivo(c.termo) || pareceNomePessoal(c.termo))) continue;
    adicionar(c.termo, tipo, c.campo, c.trecho, tipo === 'marca' ? 90 : c.campo === 'title' ? 85 : c.campo === 'h1' ? 80 : c.campo === 'h2' ? 70 : 60, c.pagina,
      tipo === 'entidade' ? {rotulo: 'Artista publicado no catálogo'} : {});
  }
  const unicos = new Map();
  for (const r of registros) {
    const k = limpar(r.termo).normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR'), anterior = unicos.get(k);
    if (ehMarca(chave(r.termo)) && r.tipo !== 'marca') r.tipo = 'marca';
    if (!anterior || r.peso > anterior.peso) unicos.set(k, r);
  }
  const ordenados = [...unicos.values()].sort((a, b) => b.peso - a.peso || a.ordem - b.ordem);
  const elegiveis = ordenados.filter(c => c.tipo !== 'marca' || c === ordenados.find(r => r.tipo === 'marca'));
  const escolhidos = ['servico', 'produto', 'entidade', 'marca', 'local'].map(tipo => elegiveis.find(c => c.tipo === tipo)).filter(Boolean);
  const porPagina = new Map();
  for (const candidato of elegiveis) if (!escolhidos.includes(candidato)) {
    if (!porPagina.has(candidato.evidencia.url)) porPagina.set(candidato.evidencia.url, []);
    porPagina.get(candidato.evidencia.url).push(candidato);
  }
  while (porPagina.size && escolhidos.length < MAX_TERMOS) for (const [url, candidatos] of porPagina) {
    if (escolhidos.length >= MAX_TERMOS) break;
    escolhidos.push(candidatos.shift());
    if (!candidatos.length) porPagina.delete(url);
  }
  if (incompletas || falhas?.length) limites.push('Parte das páginas ficou fora da leitura; a descoberta de buscas também pode estar incompleta.');
  if (!escolhidos.length) limites.push('Não houve conteúdo suficiente para sugerir buscas com evidência. Nenhum termo foi inferido apenas do domínio.');
  const limitada = truncada || Boolean(incompletas || falhas?.length || coberturaColeta?.limitada || paginas.length > MAX_PAGINAS || elegiveis.length > MAX_TERMOS);
  if (limitada) limites.push('Os limites de páginas, conteúdo ou termos e eventuais falhas deixam esta descoberta parcial; ela não é um inventário completo do Google.');
  return {candidatos: escolhidos.slice(0, MAX_TERMOS).map(({peso, ordem, ...c}) => c), limites,
    cobertura: {paginasLidas, limitePaginas: MAX_PAGINAS, limiteTermos: MAX_TERMOS, termosDescobertos: elegiveis.length, limitada}};
}
