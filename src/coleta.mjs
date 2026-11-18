import {parse} from 'parse5';
import {normalizarSite} from './consulta.mjs';
import {metaTemNofollow,cabecalhoPedeNaoSeguir,classificarCabecalhoRobots} from './robots-diretivas.mjs';

const PRODUTO = 'ConsultaVisibilidade';
const AGENTE = PRODUTO + '/1.0 (diagnostico publico de paginas)';
const RESOLVERS = ['https://dns.google/resolve', 'https://cloudflare-dns.com/dns-query'];
const REDIRECIONAMENTOS = new Set([301, 302, 303, 307, 308]);
const MAX_HTML = 1024 * 1024;
const MAX_ROBOTS = 64 * 1024;
const MAX_DNS = 24 * 1024;
const MAX_XML = 512 * 1024;
const MAX_DESCOBERTA = 4 * 1024 * 1024;
const RECURSO = /\.(?:pdf|zip|gz|xml|json|txt|jpe?g|png|gif|webp|svg|ico|mp[34]|webm|docx?|xlsx?|css|js|woff2?|ttf)(?:$|\/)/i;
const CAMINHO_SENSIVEL = /(?:^|[/_.-])(?:admin|wp-admin|wp-json|login|logout|logoff|signout|signin|signup|register|cadastro|entrar|sair|account|conta|checkout|carrinho|cart|delete|remove|unsubscribe|subscribe|cancel|reset|password|senha|confirm|activate|submit|api|graphql|oauth)(?:$|[/_.-])/i;

class FalhaColeta extends Error {
  constructor(mensagem, codigo = 'indisponivel', host = null) {
    super(mensagem);
    this.codigo = codigo;
    this.host = host;
  }
}
const falha = (mensagem, codigo, host) => new FalhaColeta(mensagem, codigo, host);

function numeroIPv4(ip) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return null;
  const partes = ip.split('.');
  if (partes.some(p => Number(p) > 255 || (p.length > 1 && p.startsWith('0')))) return null;
  return partes.reduce((n, p) => n * 256 + Number(p), 0);
}

function emRede4(ip, rede, bits) {
  const divisor = 2 ** (32 - bits);
  return Math.floor(ip / divisor) === Math.floor(numeroIPv4(rede) / divisor);
}

function numeroIPv6(ip) {
  if (!/^[\da-f:]+$/i.test(ip) || ip.includes(':::') || ip.split('::').length > 2) return null;
  const duplo = ip.includes('::');
  const [esq, dir = ''] = ip.split('::');
  const esquerda = esq ? esq.split(':') : [];
  const direita = dir ? dir.split(':') : [];
  if (![...esquerda, ...direita].every(p => /^[\da-f]{1,4}$/i.test(p))) return null;
  const faltam = 8 - esquerda.length - direita.length;
  if (duplo ? faltam < 1 : faltam !== 0) return null;
  return [...esquerda, ...Array(duplo ? faltam : 0).fill('0'), ...direita]
    .reduce((n, p) => (n << 16n) + BigInt(parseInt(p, 16)), 0n);
}

function emRede6(ip, rede, bits) {
  const deslocamento = BigInt(128 - bits);
  return ip >> deslocamento === numeroIPv6(rede) >> deslocamento;
}

// Conservative public-unicast allowlist. IPv4-mapped IPv6 and transition
// networks are deliberately rejected instead of trying alternate transports.
export function enderecoPublico(ip) {
  if (typeof ip !== 'string') return false;
  const v4 = numeroIPv4(ip);
  if (v4 !== null) {
    const proibidas = [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
      ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
    ];
    return !proibidas.some(([rede, bits]) => emRede4(v4, rede, bits));
  }
  const v6 = numeroIPv6(ip);
  if (v6 === null || !emRede6(v6, '2000::', 3)) return false;
  return ![['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]
    .some(([rede, bits]) => emRede6(v6, rede, bits));
}

export function destinoPermitido(valor, dominio, base) {
  let url;
  try { url = new URL(valor, base); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) return null;
  if (url.hostname !== dominio && url.hostname !== 'www.' + dominio) return null;
  if (url.href.length > 2048 || /[\u0000-\u0020\\]/.test(valor)) return null;
  let caminho;
  try { caminho = decodeURIComponent(url.pathname); } catch { return null; }
  if (CAMINHO_SENSIVEL.test(caminho) || /[\u0000-\u001f\\]/.test(caminho)) return null;
  // An empty fragment is never sent in the HTTP request. Treat / and /# as
  // one document so navigation placeholders cannot spend another page slot.
  url.hash = '';
  return url;
}

function normalizarOctetos(texto) {
  return texto.replace(/[^\x00-\x7f]/gu, c => encodeURIComponent(c))
    .replace(/%([\da-f]{2})/gi, (_, hex) => {
      const c = String.fromCharCode(parseInt(hex, 16));
      return /^[a-z\d._~-]$/i.test(c) ? c : '%' + hex.toUpperCase();
    });
}

// No regex generated from robots.txt: wildcard-heavy rules cannot cause
// catastrophic regex backtracking. Parts are searched monotonically.
function regraCombina(padrao, caminho) {
  const fim = padrao.endsWith('$');
  const partes = (fim ? padrao.slice(0, -1) : padrao).split('*');
  const primeira = partes.shift();
  if (!caminho.startsWith(primeira)) return false;
  let posicao = primeira.length;
  if (!partes.length) return !fim || posicao === caminho.length;
  for (let i = 0; i < partes.length; i++) {
    const parte = partes[i];
    if (fim && i === partes.length - 1) return caminho.endsWith(parte) && caminho.length - parte.length >= posicao;
    const achado = caminho.indexOf(parte, posicao);
    if (achado < 0) return false;
    posicao = achado + parte.length;
  }
  return true;
}

export function criarPoliticaRobots(texto) {
  const grupos = [];
  let atual = null, teveDiretiva = false;
  for (const original of texto.split(/\r?\n/)) {
    const linha = original.replace(/#.*/, '').trim();
    const separador = linha.indexOf(':');
    if (separador < 0) continue;
    const nome = linha.slice(0, separador).trim().toLowerCase();
    const valor = linha.slice(separador + 1).trim();
    if (nome === 'user-agent') {
      if (!atual || teveDiretiva) {
        atual = {agentes: [], regras: []};
        grupos.push(atual);
        teveDiretiva = false;
      }
      if (valor) atual.agentes.push(valor.toLowerCase());
    } else if (atual) {
      if (nome === 'allow' || nome === 'disallow') {
        teveDiretiva = true;
        if (valor) atual.regras.push({permite: nome === 'allow', padrao: normalizarOctetos(valor)});
      }
    }
  }
  const produto = PRODUTO.toLowerCase();
  const especificidade = g => Math.max(-1, ...g.agentes.map(a => a === '*' ? 0 : produto.includes(a) ? a.length : -1));
  const melhor = Math.max(-1, ...grupos.map(especificidade));
  const regras = melhor < 0 ? [] : grupos.filter(g => especificidade(g) === melhor).flatMap(g => g.regras);
  return caminho => {
    const alvo = normalizarOctetos(caminho);
    let maior = -1, permite = true;
    for (const regra of regras) {
      if (!regraCombina(regra.padrao, alvo)) continue;
      const peso = regra.padrao.replace(/\*/g, '').replace(/\$$/, '').length;
      if (peso > maior || peso === maior && regra.permite) {
        maior = peso;
        permite = regra.permite;
      }
    }
    return permite;
  };
}

function atributos(no) { return Object.fromEntries((no.attrs || []).map(a => [a.name, a.value])); }

function textoNo(no) {
  const partes = [], pilha = [no];
  let visitados = 0;
  while (pilha.length && visitados++ < 1000) {
    const n = pilha.pop();
    if (n.nodeName === '#text') partes.push(n.value);
    else if (!['script', 'style', 'template'].includes(n.tagName)) pilha.push(...(n.childNodes || []).slice().reverse());
  }
  return partes.join(' ').slice(0, 1000);
}

function seguirLinks(raiz) {
  const pilha = [raiz];
  let n = 0;
  while (pilha.length && n++ < 25000) {
    const no = pilha.pop(), a = atributos(no);
    if (no.tagName === 'meta' && /^(?:robots|ConsultaVisibilidade)$/i.test(a.name || '') &&
        metaTemNofollow(a.content)) return false;
    if (!['script', 'style', 'template'].includes(no.tagName)) pilha.push(...(no.childNodes || []));
  }
  return true;
}

function diversificarLinks(links) {
  const grupos = new Map();
  for (const link of links) {
    const grupo = new URL(link.url).pathname.split('/').filter(Boolean)[0] || '/';
    if (!grupos.has(grupo)) grupos.set(grupo, []);
    grupos.get(grupo).push(link);
  }
  const saida = [];
  while (grupos.size) for (const [grupo, itens] of grupos) {
    saida.push(itens.shift());
    if (!itens.length) grupos.delete(grupo);
  }
  return saida;
}

const ROTA_OPERACAO=/(?:^|\/)(?:como-funciona|how-it-works|sobre(?:-nos)?|quem-somos|about(?:-us)?)(?:\/|$)/u;
const ROTA_PRECOS=/(?:^|\/)(?:planos(?:-precos|-e-precos)?|precos|tarifas|pricing)(?:\/|$)/u;
const ROTA_TERMOS_COMERCIAIS=/(?:^|\/)(?:termos(?:-de-(?:uso|contratacao)|-uso|-comerciais|-e-condicoes)|terms-of-(?:use|service)|politica-de-compra)(?:\/|$)/u;
function classeDaRotaDeNegocio(url){
  const caminho=decodeURIComponent(url.pathname).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  if(ROTA_TERMOS_COMERCIAIS.test(caminho))return 'termos_comerciais';
  if(ROTA_OPERACAO.test(caminho))return 'como_funciona';
  if(ROTA_PRECOS.test(caminho))return 'planos_e_precos';
  return null;
}
function preservarRotasDeNegocio(links){
  const ordenados=diversificarLinks(links);
  for(const [classe,posicao] of [['como_funciona',2],['planos_e_precos',3],['termos_comerciais',4]]){
    const i=ordenados.findIndex(l=>l.classe===classe);
    if(i>posicao)ordenados.splice(posicao,0,...ordenados.splice(i,1));
  }
  return ordenados.slice(0,200).map(l=>l.url);
}

export function selecionarLinks(html, base, dominio, objetivo = 'diagnostico') {
  const raiz = parse(html), pilha = [raiz], vistos = new Set([new URL(base).href]);
  if (objetivo === 'descoberta' && !seguirLinks(raiz)) return [];
  const links = [];
  let visitados = 0;
  while (pilha.length && visitados++ < 25000) {
    const no = pilha.pop(), a = atributos(no);
    if ('hidden' in a || a['aria-hidden'] === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(a.style || '')) continue;
    if (no.tagName === 'a' && a.href && !('download' in a) && !/(?:^|\s)nofollow(?:\s|$)/i.test(a.rel || '')) {
      let url = destinoPermitido(a.href, dominio, base);
      if(!url&&objetivo==='descoberta'&&a.href.includes('#')){
        const candidata=destinoPermitido(a.href.split('#',1)[0],dominio,base);
        if(candidata&&classeDaRotaDeNegocio(candidata)==='termos_comerciais')url=candidata;
      }
      if (url && !vistos.has(url.href) && !RECURSO.test(url.pathname)) {
        vistos.add(url.href);
        const pistas = (decodeURIComponent(url.pathname) + ' ' + textoNo(no)).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
        const classe=objetivo==='descoberta'?classeDaRotaDeNegocio(url):null;
        const peso = objetivo === 'descoberta'
          ? classe==='termos_comerciais'?1:classe?2:
            /(?:privacidade|privacy|termos-de-uso|terms|cookies)/.test(pistas) ? 0 : /servic|soluco|produt|catalog|oferta|imoveis|apartament|empreendimento|artista|shows?|contrata/.test(pistas) ? 4 : /contato|contact/.test(pistas) ? 2 : 1
          : objetivo === 'busca'
          ? /servic|soluco|produt|catalog|oferta|imoveis|apartament|empreendimento/.test(pistas) ? 3 : /contato|contact|fale\s*conosco|atendimento/.test(pistas) ? 2 : /sobre|quem\s*somos|about/.test(pistas) ? 1 : 0
          : /contato|contact|fale\s*conosco|atendimento/.test(pistas) ? 3 : /sobre|quem\s*somos|about/.test(pistas) ? 2 : /servic|soluco/.test(pistas) ? 1 : 0;
        if (peso) links.push({url: url.href, peso, ordem: links.length, classe});
      }
    }
    if (!['script', 'style', 'template'].includes(no.tagName)) pilha.push(...(no.childNodes || []).slice().reverse());
  }
  const ordenados = links.sort((a, b) => b.peso - a.peso || a.ordem - b.ordem);
  if (objetivo === 'descoberta') return preservarRotasDeNegocio(ordenados);
  if (objetivo === 'busca') {
    const escolhidos = [ordenados.find(l => l.peso === 3), ordenados.find(l => l.peso === 2)].filter(Boolean);
    for (const link of ordenados) if (escolhidos.length < 2 && !escolhidos.includes(link)) escolhidos.push(link);
    return escolhidos.map(l => l.url);
  }
  return ordenados.slice(0, 2).map(l => l.url);
}

async function corpoLimitado(resposta, maximo, signal, aoLer) {
  if (Number(resposta.headers.get('content-length')) > maximo) {
    await resposta.body?.cancel();
    throw falha('A página excede o limite de leitura desta consulta.');
  }
  if (!resposta.body) return new Uint8Array();
  const leitor = resposta.body.getReader(), partes = [];
  let total = 0;
  const cancelar = () => { leitor.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancelar, {once: true});
  try {
    for (;;) {
      const {done, value} = await leitor.read();
      if (done) break;
      aoLer?.(value.byteLength);
      total += value.byteLength;
      if (total > maximo) throw falha('A página excede o limite de leitura desta consulta.');
      partes.push(value);
    }
  } catch (erro) {
    await leitor.cancel().catch(() => {});
    throw erro;
  } finally { signal?.removeEventListener('abort', cancelar); leitor.releaseLock(); }
  const corpo = new Uint8Array(total);
  let offset = 0;
  for (const parte of partes) { corpo.set(parte, offset); offset += parte.length; }
  return corpo;
}

function textoCorpo(corpo, tipo) {
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(tipo || '')?.[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(corpo); }
  catch { return new TextDecoder().decode(corpo); }
}

// Restricted sitemap XML reader. It never resolves entities or loads external
// resources, rejects DTDs, and accepts loc only at the documented tree paths.
export function lerSitemap(texto, base, dominio) {
  if (typeof texto !== 'string' || texto.length > MAX_XML || /<!DOCTYPE|<!ENTITY|<!\[/i.test(texto)) throw falha('O sitemap não é um XML simples permitido.');
  const fonte = texto.replace(/^\uFEFF/, '').replace(/^\s*<\?xml\s[^?]*\?>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Ignore sitemap style declarations without accessing their resources.
    .replace(/^\s*<\?xml-stylesheet\s+[^?]{1,2048}\?>/i, '');
  const pilha = [], urls = [], tokens = fonte.match(/<[^>]*>|[^<]+/g) || [];
  let raiz = null, terminou = false, local = '', entradas = 0;
  if (tokens.join('') !== fonte) throw falha('O sitemap não tem uma estrutura XML válida.');
  if (tokens.length > 20_000) throw falha('O sitemap excede o limite de elementos.');
  for (const token of tokens) {
    if (token.startsWith('<')) {
      const fechar = /^<\/([a-zA-Z][\w:.-]*)\s*>$/.exec(token);
      if (fechar) {
        const nome = fechar[1];
        if (pilha.pop() !== nome) throw falha('O sitemap não tem uma estrutura XML válida.');
        if (nome === 'loc' && pilha.length === 2 &&
            ((raiz === 'urlset' && pilha[1] === 'url') || (raiz === 'sitemapindex' && pilha[1] === 'sitemap'))) {
          if (++entradas > 5000) throw falha('O sitemap excede o limite de endereços.');
          if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(local)) throw falha('O sitemap contém entidades não permitidas.');
          const valor = local.trim().replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, entidade => {
            const nomes = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'"};
            if (nomes[entidade]) return nomes[entidade];
            const n = entidade[2]?.toLowerCase() === 'x' ? parseInt(entidade.slice(3, -1), 16) : Number(entidade.slice(2, -1));
            return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\uFFFD';
          });
          const url = destinoPermitido(valor, dominio, base);
          if (url && !/\.gz$/i.test(url.pathname) && (raiz === 'sitemapindex' || !RECURSO.test(url.pathname))) urls.push(url.href);
        }
        if (!pilha.length) terminou = true;
      } else {
        const abrir = /^<([a-zA-Z][\w:.-]*)(?:\s+[a-zA-Z_:][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*(\/?)>$/.exec(token);
        if (!abrir || terminou || pilha.length > 16) throw falha('O sitemap não tem uma estrutura XML válida.');
        const nome = abrir[1];
        if (!pilha.length) {
          if (raiz || !['urlset', 'sitemapindex'].includes(nome)) throw falha('O sitemap não contém um índice de endereços reconhecido.');
          raiz = nome;
        }
        if (nome === 'loc') local = '';
        if (!abrir[2]) pilha.push(nome);
        else if (!pilha.length) terminou = true;
      }
    } else if (pilha.at(-1) === 'loc') {
      local += token;
      if (local.length > 2048) throw falha('O sitemap contém um endereço excessivamente longo.');
    } else if (!pilha.length && token.trim()) throw falha('O sitemap não tem uma estrutura XML válida.');
  }
  if (!raiz || !terminou || pilha.length) throw falha('O sitemap não tem uma estrutura XML válida.');
  return {tipo: raiz, urls: [...new Set(urls)].slice(0, 200), limitada: entradas > 200};
}

function ordenarIndicesDeSitemap(urls) {
  function tipo(url) {
    const nome = new URL(url).pathname.split('/').at(-1).toLowerCase();
    if (/^(?:page|pages|pagina|paginas|product|products|produto|produtos|services?|servicos?)[-_]sitemap/u.test(nome)) return 0;
    if (/^(?:post|author|category|tag|categoria|autor|blog)[-_]sitemap/u.test(nome)) return 2;
    return 1;
  }
  return [...urls].sort((a,b)=>tipo(a)-tipo(b));
}

export async function coletarSite(valor, opcoes = {}) {
  const dominio = normalizarSite(valor);
  const inicio = 'https://' + dominio + '/';
  const dataAtual = () => {
    const valorAgora = typeof opcoes.agora === 'function' ? opcoes.agora() : new Date();
    return new Date(valorAgora).toISOString();
  };
  const coletadoEm = dataAtual(), paginas = [], falhas = [];
  const descoberta = opcoes.objetivo === 'descoberta';
  const limitePaginas = descoberta ? 12 : 3;
  let bytesLidos = 0, limitada = false, xmlLidos = 0, xmlConsultados = 0;
  const transporte = opcoes.fetch || globalThis.fetch.bind(globalThis);
  let requisicoes = 0;
  const limiteRequisicoes = Number.isInteger(opcoes.limiteRequisicoes)
    ? Math.max(1, Math.min(40, opcoes.limiteRequisicoes)) : opcoes.objetivo === 'busca' ? 24 : 40;
  const fetchImpl = (url, init) => {
    if (++requisicoes > limiteRequisicoes) throw falha('O limite de requisições foi atingido antes de concluir a leitura.');
    return transporte(url, init);
  };
  const duracao = Math.max(1, Math.min(20000, opcoes.tempoTotalMs || 20000));
  const tempoRequisicao = Math.max(1, Math.min(6000, opcoes.tempoRequisicaoMs || 6000));
  const prazo = Date.now() + duracao;
  const politicas = new Map();
  const mapasDeclarados = new Map();

  async function lerCorpo(resposta, maximo, signal) {
    const restante = descoberta ? MAX_DESCOBERTA - bytesLidos : maximo;
    if (restante <= 0) { await resposta.body?.cancel(); throw falha('O limite total de leitura foi atingido.'); }
    return corpoLimitado(resposta, Math.min(maximo, restante), signal, n => {
      // A transport chunk may cross the boundary; only the allowed bytes are
      // considered read, and corpoLimitado discards that response entirely.
      bytesLidos += descoberta ? Math.min(n, Math.max(0, MAX_DESCOBERTA - bytesLidos)) : n;
    });
  }

  async function noPrazo(tarefa) {
    const restante = Math.min(tempoRequisicao, prazo - Date.now());
    if (restante <= 0) throw falha('O site demorou além do limite desta consulta. Tente novamente mais tarde.', 'tempo');
    const controlador = new AbortController();
    let timer;
    const limite = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controlador.abort();
        reject(falha('O site demorou além do limite desta consulta. Tente novamente mais tarde.', 'tempo'));
      }, restante);
    });
    try { return await Promise.race([tarefa(controlador.signal), limite]); }
    finally { clearTimeout(timer); }
  }

  async function verificarDNS(host) {
    for (let indice = 0; indice < RESOLVERS.length; indice++) {
      const resolver = RESOLVERS[indice], provedor = new URL(resolver).hostname;
      const erroDNS = (codigo, tentarProvedor = false) => {
        const mensagem = codigo === 'TEMPO' ? 'A confirmação do endereço público demorou além do limite desta consulta.' :
          'Não foi possível confirmar o endereço público deste site.';
        const erro = falha(mensagem + ' (DNS ' + codigo + ' em ' + provedor + '.)', 'dns', host);
        erro.tentarProvedor = tentarProvedor;
        return erro;
      };
      // Evaluate both address families before deciding whether to retry a
      // provider. A semantic rejection from either family must not be hidden
      // by a transport failure from the other one.
      const resultados = await Promise.allSettled(['A', 'AAAA'].map(async tipo => {
        try {
          return await noPrazo(async signal => {
            const parametros = new URLSearchParams({name: host, type: tipo});
            if (provedor === 'dns.google') parametros.set('edns_client_subnet', '0.0.0.0/0');
            const resposta = await fetchImpl(resolver + '?' + parametros, {
              method: 'GET', redirect: 'manual', signal, headers: {Accept: 'application/dns-json'},
            });
            if (resposta.status !== 200) {
              await resposta.body?.cancel();
              throw erroDNS('HTTP_' + resposta.status, true);
            }
            const corpo = textoCorpo(await lerCorpo(resposta, MAX_DNS, signal));
            let dados;
            try { dados = JSON.parse(corpo); } catch { throw erroDNS('JSON_INVALIDO', true); }
            if (!dados || typeof dados !== 'object' || !Number.isInteger(dados.Status) ||
                'Answer' in dados && !Array.isArray(dados.Answer)) throw erroDNS('RESPOSTA_INVALIDA', true);
            if (dados.Status !== 0) throw erroDNS('STATUS_' + dados.Status);
            if (dados.TC) throw erroDNS('TRUNCADO');
            const enderecos = (dados.Answer || []).filter(r => r?.type === 1 || r?.type === 28).map(r => r.data);
            if (enderecos.some(ip => !enderecoPublico(ip))) {
              throw falha('Esta consulta só aceita sites com endereços públicos de internet. (DNS ENDERECO_RESTRITO em ' + provedor + '.)');
            }
            return enderecos;
          });
        } catch (erro) {
          if (erro instanceof FalhaColeta) {
            if (erro.codigo === 'tempo') throw erroDNS('TEMPO', true);
            throw erro;
          }
          throw erroDNS('TRANSPORTE', true);
        }
      }));
      const erros = resultados.filter(r => r.status === 'rejected').map(r => r.reason);
      const rejeicao = erros.find(erro => !erro.tentarProvedor);
      if (rejeicao) throw rejeicao;
      if (erros.length) {
        if (indice + 1 < RESOLVERS.length && Date.now() < prazo) continue;
        throw erros[0];
      }
      const enderecos = resultados.flatMap(r => r.value);
      if (!enderecos.length) throw erroDNS('SEM_ENDERECOS');
      return;
    }
    // O preflight acima não substitui a validação do socket. O servidor local
    // injeta lib/rede-publica.mjs para resolver e fixar um IP público em cada
    // conexão HTTPS, inclusive depois de redirecionamentos.
  }

  async function politicaPara(url) {
    if (!politicas.has(url.origin)) {
      const r = await buscar(url.origin + '/robots.txt', 'robots');
      const texto = textoCorpo(r.corpo, r.tipo);
      if (r.status !== 404 && (/^\s*</.test(texto) || r.status !== 200)) {
        throw falha('Não foi possível confirmar a permissão de leitura em robots.txt.');
      }
      politicas.set(url.origin, r.status === 404 ? () => true : criarPoliticaRobots(texto));
      if (descoberta && r.status === 200) {
        const mapas = texto.split(/\r?\n/).map(l => /^\s*sitemap\s*:\s*(\S+)\s*(?:#.*)?$/i.exec(l)?.[1])
          .filter(Boolean).map(valor => destinoPermitido(valor, dominio)).filter(u => u && !/\.gz$/i.test(u.pathname));
        mapasDeclarados.set(url.origin, [...new Set(mapas.map(u => u.href))].slice(0, 2));
      }
    }
    return politicas.get(url.origin);
  }

  async function buscar(endereco, modo) {
    let url = destinoPermitido(endereco, dominio);
    if (!url) throw falha('O site direcionou a consulta para um endereço fora do escopo permitido.');
    for (let salto = 0; salto <= 3; salto++) {
      if (modo !== 'robots' && !(await politicaPara(url))(url.pathname)) throw falha('A leitura desta página não é permitida pelo robots.txt do site.');
      await verificarDNS(url.hostname);
      const resultado = await noPrazo(async signal => {
        let resposta;
        try {
          resposta = await fetchImpl(url.href, {method: 'GET', redirect: 'manual', signal,
            headers: {'User-Agent': AGENTE, Accept: modo === 'robots' ? 'text/plain' : modo === 'xml' ? 'application/xml, text/xml' : 'text/html'}});
        } catch (erro) {
          if (erro instanceof FalhaColeta) throw erro;
          throw falha('Não foi possível estabelecer uma conexão com este endereço do site.', 'conexao', url.hostname);
        }
        if (resposta.headers.get('cf-mitigated')?.trim().toLowerCase() === 'challenge') {
          await resposta.body?.cancel();
          throw falha('O site apresentou uma verificação de acesso e não liberou a página para esta consulta automática.');
        }
        if (REDIRECIONAMENTOS.has(resposta.status)) {
          const location = resposta.headers.get('location');
          await resposta.body?.cancel();
          return {redireciona: location};
        }
        if (modo === 'robots' && resposta.status === 404) {
          await resposta.body?.cancel();
          return {status: 404, corpo: new Uint8Array(), tipo: 'text/plain', url: url.href};
        }
        if (resposta.status !== 200) {
          await resposta.body?.cancel();
          throw falha(modo === 'robots' ? 'Não foi possível confirmar a permissão de leitura em robots.txt.' : 'A página não liberou o conteúdo para esta consulta (HTTP ' + resposta.status + ').');
        }
        const tipo = resposta.headers.get('content-type') || '';
        const aceita = modo === 'robots' ? /^text\/plain(?:;|$)/i.test(tipo) : modo === 'xml' ? /^(?:application|text)\/(?:[a-z0-9.-]+\+)?xml(?:;|$)/i.test(tipo) : /^text\/html(?:;|$)/i.test(tipo);
        if (!aceita) {
          await resposta.body?.cancel();
          throw falha(modo === 'robots' ? 'Não foi possível confirmar a permissão de leitura em robots.txt.' : modo === 'xml' ? 'O endereço não retornou um sitemap XML que pudesse ser analisado.' : 'O endereço não retornou uma página HTML que pudesse ser analisada.');
        }
        const corpo = await lerCorpo(resposta, modo === 'robots' ? MAX_ROBOTS : modo === 'xml' ? MAX_XML : MAX_HTML, signal);
        const cabecalho=resposta.headers.get('x-robots-tag');
        return {status: resposta.status, corpo, tipo, url: url.href,
          cabecalhoRobots:classificarCabecalhoRobots(cabecalho), segueLinks:!cabecalhoPedeNaoSeguir(cabecalho)};
      });
      if (!('redireciona' in resultado)) return resultado;
      const proxima = resultado.redireciona && destinoPermitido(resultado.redireciona, dominio, url);
      if (!proxima || modo === 'robots' && proxima.pathname !== '/robots.txt' || modo === 'xml' && /\.gz$/i.test(proxima.pathname)) throw falha('O site direcionou a consulta para um endereço fora do escopo permitido.');
      url = proxima;
    }
    throw falha('A página redirecionou mais vezes que o limite desta consulta.');
  }

  async function adicionar(url) {
    try {
      const r = await buscar(url, 'html');
      if (paginas.some(p => p.url === r.url)) return;
      const html = textoCorpo(r.corpo, r.tipo);
      const hash = await crypto.subtle.digest('SHA-256', r.corpo);
      const sha256 = Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join('');
      const cabecalhoRobots={...r.cabecalhoRobots};
      if(['noindex','sem_noindex'].includes(cabecalhoRobots.estado)){
        const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cabecalhoRobots.valor));
        cabecalhoRobots.sha256=Array.from(new Uint8Array(h),v=>v.toString(16).padStart(2,'0')).join('');
      }
      paginas.push({url: r.url, html, status: r.status, coletadoEm: dataAtual(), bytes: r.corpo.length, sha256,cabecalhoRobots,
        ...(descoberta ? {segueLinks: r.segueLinks} : {})});
    } catch (erro) {
      falhas.push({url, motivo: erro instanceof FalhaColeta ? erro.message : 'Não foi possível ler esta página agora. O site pode limitar consultas automáticas.'});
      return erro;
    }
  }

  const primeiraFalha = await adicionar(inicio);
  // Try the conventional public www host only for connectivity/DNS failure
  // on the apex. An access restriction, robots refusal or unsafe redirect
  // never triggers an alternate-host attempt.
  if (!paginas.length && primeiraFalha instanceof FalhaColeta && primeiraFalha.host === dominio &&
      ['dns', 'conexao'].includes(primeiraFalha.codigo) && Date.now() < prazo) {
    await adicionar('https://www.' + dominio + '/');
    if (paginas.length) falhas[0].motivo += ' A análise continuou pelo endereço com www.';
  }
  if (paginas.length && descoberta) {
    const fila = [], vistos = new Set([inicio, ...paginas.map(p => p.url)]);
    const enfileirar = urls => {
      for (const url of urls) {
        if (vistos.has(url)) continue;
        vistos.add(url);
        if (fila.length < 200) fila.push(url);
        else limitada = true;
      }
    };
    const linksPagina = pagina => pagina.segueLinks === false ? [] : selecionarLinks(pagina.html, pagina.url, dominio, 'descoberta');
    const primeira = paginas[0];
    enfileirar(linksPagina(primeira));
    const mapas = [...new Set([...(mapasDeclarados.get(new URL(primeira.url).origin) || []), new URL('/sitemap.xml', primeira.url).href])];
    const mapasVistos = new Set();
    while (mapas.length && xmlConsultados < 2 && requisicoes + 3 <= limiteRequisicoes && Date.now() < prazo && bytesLidos < MAX_DESCOBERTA) {
      const endereco = mapas.shift();
      if (mapasVistos.has(endereco)) continue;
      mapasVistos.add(endereco); xmlConsultados++;
      try {
        const r = await buscar(endereco, 'xml');
        const mapa = lerSitemap(textoCorpo(r.corpo, r.tipo), r.url, dominio);
        xmlLidos++;
        limitada ||= mapa.limitada;
        if (mapa.tipo === 'sitemapindex') mapas.unshift(...ordenarIndicesDeSitemap(mapa.urls));
        else enfileirar(mapa.urls);
      } catch (erro) {
        falhas.push({url: endereco, motivo: erro instanceof FalhaColeta ? erro.message : 'Não foi possível ler este sitemap.'});
      }
    }
    if (mapas.length) limitada = true;
    while (fila.length && paginas.length < limitePaginas) {
      if (Date.now() >= prazo || requisicoes + 3 > limiteRequisicoes || bytesLidos >= MAX_DESCOBERTA) { limitada = true; break; }
      const url = fila.shift(), antes = paginas.length;
      if (paginas.some(p => p.url === url)) continue;
      await adicionar(url);
      if (paginas.length > antes) {
        const pagina = paginas.at(-1);
        vistos.add(pagina.url);
        enfileirar(linksPagina(pagina));
      }
    }
    limitada ||= fila.length > 0;
  } else if (paginas.length) {
    const primeira = paginas[0];
    for (const link of selecionarLinks(primeira.html, primeira.url, dominio, opcoes.objetivo)) {
      if (Date.now() >= prazo) {
        falhas.push({url: link, motivo: 'O limite de tempo foi atingido antes da leitura desta página.'});
        continue;
      }
      await adicionar(link);
    }
  }
  return {dominio, coletadoEm, paginas, falhas, ...(descoberta ? {cobertura: {
    paginasLidas: paginas.length, limitePaginas, limiteBytes: MAX_DESCOBERTA, bytesLidos,
    requisicoes: Math.min(requisicoes, limiteRequisicoes), limiteRequisicoes, sitemapsLidos: xmlLidos, sitemapsConsultados: xmlConsultados,
    limitada: limitada || falhas.length > 0,
  }} : {})};
}
