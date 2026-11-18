import {rotuloDeAtendimento, rotuloInstitucional, rotuloDeTema} from '../descoberta.mjs';
import {classificarDocumentoPublico} from './documentos-publicos.mjs';

const normal = valor => String(valor ?? '').normalize('NFD').replace(/\p{M}/gu, '')
  .toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
const caminhosDeCarreira = /^(?:vagas|carreiras?|trabalhe-conosco|jobs|careers)$/u;

export const conviteDeAgenciamento = valor =>
  /^(?:seja|torne-se) (?:um |uma )?artista exclusiv[oa]\b/u.test(normal(valor));

export function paginaDeCarreira(valor) {
  try {
    return new URL(valor).pathname.split('/').some(p=>caminhosDeCarreira.test(normal(decodeURIComponent(p)).replace(/_/g,'-')));
  } catch { return false; }
}

export function nomeDeComercioPublicado(valor) {
  const t = normal(valor).replace(/^(?:a|o|uma|um) /, '');
  return /^(?:loja|comercio|venda|distribuidor[ae])(?: (?:online|virtual|atacadista|varejista))? (?:de|do|da|dos|das) \S/.test(t) &&
    !/^(?:loja|comercio|venda|distribuidor[ae]).*\b(?:de|do|da) servicos?\b/.test(t);
}

export function nomeComercialPublicado(valor) {
  const t = normal(valor);
  return nomeDeComercioPublicado(t) || nomeDeProdutoPublicado(t) || /\b(?:passagens?|ingressos?|imoveis|apartamentos?|hoteis|hotel|pousada|restaurantes?|gastronomia|hospedagem|hosting|assinatura (?:digital|eletronica)|plataforma|platform|contabilidade|abertura de cnpj|crm|erp|e commerce|e-commerce|ecommerce|petshop|loja (?:online|virtual)|gestao (?:financeira|de)|sistema (?:de|erp)|software|cursos?|formacoes?|formacao|treinamentos?|mentoria|pos[- ]graduacao|mba|courses?|certificates?|degrees?|automacao|automation|agencia|agenciamento|agendamento de|corretora|imobiliaria|vps|servidores? cloud|plano de saude|reparos|reformas|manutencao|consultoria)\b/.test(t);
}

export function nomeDeAcessoPublicado(valor) {
  return /^(?:passage(?:m|ns)(?: de| aereas?| rodoviarias?)|ingressos?(?: para| de))/u.test(normal(valor));
}

export function objetoDeCompraPublicado(valor) {
  const t=String(valor??'').trim();
  const compra=/^(?:compre|comprar|adquira|adquirir|contrate|contratar|alugue|alugar)\s+(?:(?:a|o|as|os|um|uma|sua|seu|suas|seus|nossos|nossas|melhores)\s+)*(.+)$/iu.exec(t);
  let nome=compra?.[1]||t;
  // Remove only printed advertising suffixes; the result remains a literal
  // substring. Structured Product/Service names do not pass through this rule.
  nome=nome.split(/\s+(?:para|com|em)\s+(?:mais de\s+\d|at[eé]\s+\d)/iu)[0];
  if(nomeDeAcessoPublicado(nome))nome=nome.split(/\s+em\s+(?:promo[çc][ãa]o|oferta)/iu)[0];
  return nome.trim();
}

export function fragmentoSemObjetoComercial(candidato) {
  if(candidato?.evidencia?.campo!=='title'||!candidato?.termo)return false;
  const partes=String(candidato.evidencia.trecho||'').split(/\s*[|｜]\s*|\s+[–—-]\s+|:\s+/u);
  return partes.length>=3&&/\b(?:imoveis|apartamentos|casas|empreendimentos)\b/.test(normal(candidato.evidencia.trecho))&&
    partes.some(p=>normal(p)===normal(candidato.termo))&&!nomeComercialPublicado(candidato.termo);
}

/** A small category vocabulary qualifies nominal published phrases, never a
 * company name or a domain. It does not invent categories missing from HTML. */
export function nomeDeProdutoPublicado(valor) {
  const t = normal(valor).replace(/^(?:a|o|as|os|uma|um) /, '');
  const palavras=t.split(' ');
  const predicado=palavras.some((p,i)=>p==='sao'&&!['de','do','da','em','no','na','para'].includes(palavras[i-1]));
  return /^(?:compressores?|motocompressores?|equipamentos?|maquinas?|ferramentas? (?:eletricas|pneumaticas|manuais|a bateria)|moveis|artigos|roupas|camisetas|vestidos|calcados|pecas|acessorios|alimentos|cosmeticos|livros|motores?|pistolas|lavadoras?|aspiradores?|extratoras?)\b/.test(t) &&
    !predicado&&!/\b(?:perfeit[oa]|ideal|para sua necessidade|que voce|que sua|que seu|estao|esta|disponiveis|permitem|oferecem|incluem|garantem|como cortesia)\b/.test(t);
}

export function cabecalhoComercialPublicado(valor) {
  const t = normal(valor).replace(/^(?:a|o|as|os|uma|um) /, '');
  if (nomeDeComercioPublicado(t)) return true;
  // A business noun followed by its description is different from a sentence
  // that merely mentions the platform near the end of a marketing call.
  return nomeDeProdutoPublicado(t) || nomeComercialPublicado(t) && /^(?:passagens?|ingressos?|imoveis|apartamentos?|hoteis|hotel|pousada|restaurantes?|gastronomia|hospedagem|hosting|assinatura (?:digital|eletronica)|plataforma (?:de|para|crm|erp)|platform (?:for|to)|contabilidade|abertura de cnpj|crm|erp|e commerce|e-commerce|ecommerce|petshop|loja (?:online|virtual)|gestao (?:financeira|de)|sistema (?:de|erp)|software|cursos?|formacoes?|formacao|treinamentos?|mentoria|pos[- ]graduacao|mba|(?:online |professional )?(?:courses?|certificates?|degrees?)|automacao|automation|agencia|agenciamento|agendamento de|corretora|imobiliaria|vps|servidores? cloud|planos? (?!$)|criacao de loja|reparos|reformas|manutencao|consultoria)\b/.test(t);
}

export function finalidadeDaPagina(valor) {
  let partes;
  try { partes = new URL(valor).pathname.split('/').filter(Boolean).map(p=>normal(decodeURIComponent(p)).replace(/_/g,'-')); }
  catch { return 'desconhecida'; }
  if (/^(?:pt|pt-br|en|en-us|es)$/.test(partes[0] || '')) partes.shift();
  const secao=partes[0] || '';
  if (['blog','noticias','artigos','conteudos','conteudo','news','insights'].includes(secao)) return 'editorial';
  if (/^(?:vagas|carreiras|trabalhe-conosco|jobs|careers|seja-|torne-se)/.test(secao)) return 'participacao';
  if (/^(?:privacidade|privacy|termos|terms|termo-de-uso|transparencia|prestacao-de-contas|governanca)$/.test(secao) ||
      classificarDocumentoPublico({url:valor}).classe === 'politica') return 'documentacao';
  if (['suporte','ajuda','atendimento','garantia','garantias','faq','support','help','sac'].includes(secao)) return 'atendimento';
  if (['produtos','products','catalogo','loja','shop','store'].includes(secao)) return 'catalogo';
  if (/^(?:sobre|quem-somos|about|o-que-fazemos|porque-existimos|nossa-historia)/.test(secao)) return 'institucional';
  return 'publica';
}

export function declaracaoDoNegocioPublicada(valor) {
  const t=normal(valor);
  if(t.length<20||t.length>1200||/\b(?:diz nosso|segundo (?:nosso|o cliente)|depoimento|nosso entrevistado)\b/.test(t))return false;
  return /(?:^|[.!?] )(?:(?:nao )?somos\b|(?:nao )?(?:oferecemos|vendemos|fabricamos|comercializamos|prestamos|entregamos|combinamos|intermediamos|agenciamos|atendemos|mobilizamos|atuamos|disponibilizamos|desenvolvemos|implementamos|avaliamos)\b|noss[oa]s? (?:missao|proposito|objetivo|portfolio|programa|acoes|produtos|servicos|trabalho|atuacao)\b)/.test(t) ||
    /\b(?:e (?:uma?|um) (?:organizacao|ecossistema|empresa|rede|corretora|imobiliaria|fabricante|escola|cooperativa|franquia)|empresa (?:oferece|fabrica|vende|comercializa|presta)|oferece ao mercado|nossa plataforma|trabalha agenciando|formalizacao de contratos entre|produzindo e comercializando|referencia em .+seus produtos|sem fins lucrativos|com fins lucrativos|programas? (?:de|e tecnologias) (?:desenvolvimento|moradia|educacao|sociais)|solucoes de moradia|voluntariado jovem|familias em (?:situacao|comunidades))\b/.test(t);
}

export function declaracaoDoPublicoPublicada(valor) {
  const t=normal(valor);
  if(t.length<15||t.length>1600)return false;
  return /\b(?:para|atendemos|beneficiamos|voltad[oa]s? a|destinad[oa]s? a|atende|potencial de)\s+(?:(?:os|as|todos|todas|nossos|nossas) )?(?:profissionais|executivos|lideres|empresas|empreendedores|organizadores|contratantes|promotores de eventos|alunos|estudantes|hospedes|viajantes|pacientes|criancas|jovens|educadores|professores|gestores|redes de ensino|familias|moradores|comunidades)\b/.test(t) ||
    /\b(?:contamos com o apoio|nossos apoiadores|nossos parceiros|parceiros engajados|empresas parceiras|jovens voluntarios)\b/.test(t);
}

export function evidenciaContemExpressao(termo, trecho) {
  const frase = normal(termo), texto = normal(trecho);
  if (!frase || !texto) return false;
  let inicio = texto.indexOf(frase);
  while (inicio !== -1) {
    const antes = texto[inicio - 1], depois = texto[inicio + frase.length];
    // Keep language identifiers such as C++, C# and punctuation in model or
    // product names. A different word cannot borrow a substring's evidence.
    if ((!antes || !/[\p{L}\p{N}_+#]/u.test(antes)) &&
        (!depois || !/[\p{L}\p{N}_+#]/u.test(depois))) return true;
    inicio = texto.indexOf(frase, inicio + 1);
  }
  return false;
}

function participacao(valor) {
  const t = normal(valor).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return /^(?:trabalhe conosco|trabalhe com a gente|cadastre se|venha trabalhar|estamos (?:contratando|recrutando)|contratamos\b|vagas? (?:para|de)|oportunidades? (?:de emprego|de carreira|para profissionais))\b/.test(t) ||
    /^(?:junte se|faca parte) (?:a nos|ao nosso|a nossa|do nosso|da nossa|da equipe|do time|a equipe|ao time|de nossa|de nosso|como)\b/.test(t) ||
    /^(?:seja|torne se) (?:(?:um|uma|nosso|nossa) )?(?:artista|parceir[oa]|revendedor[ae]?|representante|franquead[oa]|fornecedor[ae]?|afiliad[oa]|colaborador[ae]?|consultor[ae]?|corretor[ae]?|distribuidor[ae]?)(?:s|es)?\b/.test(t);
}

function negacao(valor) {
  const t = normal(valor);
  return /^(?:(?:nao|nunca) (?:oferecemos|realizamos|fazemos|vendemos|prestamos|trabalhamos|representamos|atendemos|comercializamos|disponibilizamos|executamos)|sem |indisponivel\b|fora de linha\b|descontinuad[oa]\b|(?:servico|produto) (?:encerrado|indisponivel)\b)/.test(t);
}

function expressaoNegadaNoTrecho(termo,trecho) {
  // A description may first state one activity and deny another in a later
  // sentence. Check the denied object, rather than only the paragraph prefix.
  for(const frase of trecho.split(/[.!?;]\s*/u)) {
    const negada=/^(?:nao|nunca) (?:oferecemos|realizamos|fazemos|vendemos|prestamos|comercializamos|disponibilizamos|executamos)\s+(.+)$/u.exec(frase.trim());
    if(!negada)continue;
    const objeto=negada[1].replace(/^(?:(?:o|a|os|as) )?(?:(?:servicos?|produtos?) de )?/u,'');
    if(objeto.startsWith(termo)&&evidenciaContemExpressao(termo,objeto))return true;
  }
  return false;
}

function contextoDaFonte(candidato) {
  const campo = candidato.evidencia?.campo || '';
  const estruturada = /^(?:jsonld\.|schema:)(?:Service|Product|Offer)\./.test(campo);
  const titulo = normal(candidato.termo).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let secao = '';
  try {
    const partes = new URL(candidato.evidencia?.url).pathname.split('/').filter(Boolean).map(p => normal(decodeURIComponent(p)));
    if (/^(?:pt|pt-br|en|en-us|es)$/.test(partes[0] || '')) partes.shift();
    secao = partes[0] || '';
  } catch { /* Unknown source context cannot establish a purpose. */ }
  if (participacao(secao.replace(/-/g, ' '))) return 'participacao';
  // An editorial page can mention a service without the business offering it.
  // Its exact phrase is still available for research, with editorial provenance.
  if (['blog', 'noticias', 'artigos', 'conteudos', 'conteudo', 'news', 'insights'].includes(secao)) return 'informacao';
  if (finalidadeDaPagina(candidato.evidencia?.url) === 'documentacao') return 'institucional';
  if (candidato.tipo === 'atendimento') return 'atendimento';
  if (candidato.tipo === 'institucional') return 'institucional';
  // Service/Product markup is an explicit declaration, still subject to owner
  // review. It keeps a separately offered support or warranty service eligible.
  if (estruturada) return 'oferta';
  if (/^(?:contato|fale-conosco|contact|contact-us)$/u.test(secao)&&
      /^(?:contato|fale com|entre em contato|contact)\b/u.test(titulo)) return 'institucional';
  if (finalidadeDaPagina(candidato.evidencia?.url)==='institucional'&&
      (/\bcomece agora$/u.test(titulo)||/^(?:sobre|about|nossa historia)\b/u.test(titulo))) return 'institucional';
  if (['suporte', 'ajuda', 'atendimento', 'garantia', 'garantias', 'faq', 'support', 'help'].includes(secao)) return 'atendimento';
  if (rotuloDeAtendimento(candidato.termo)) return 'atendimento';
  // A bare combination of support labels describes a department/benefit, not
  // what is sold. An object, transaction or explicit Service declaration can
  // distinguish "garantia estendida para equipamentos" from this bare label.
  if (/^(?:garantia|assistencia|suporte|atendimento|ajuda)(?: (?:garantia|garantias|assistencia|suporte|atendimento|ajuda|e|ao|a|do|da|para|o|cliente|clientes|consumidor))*$/.test(titulo)) return 'atendimento';
  if (rotuloInstitucional(candidato.termo)) return 'institucional';
  if (/^(?:segmentos|setores|industrias|industries)$/u.test(secao)&&
      /^(?:title|h[1-3])$/u.test(campo)&&/^servicos? (?:financeiros?|bancarios?)$/u.test(titulo)) return 'informacao';
  if (rotuloDeTema(candidato.termo, campo)) return 'informacao';
  return 'oferta';
}

export function contextoDaExpressao(candidato = {}) {
  const termo = normal(candidato.termo);
  if (negacao(termo)) return 'negacao';
  const trecho = normal(candidato.evidencia?.trecho);
  if(termo&&expressaoNegadaNoTrecho(termo,trecho))return 'negacao';
  const inicio = trecho.indexOf(termo);
  // Fragments can lose a sentence's negative prefix. When the source directly
  // denies this same expression, it cannot establish an offered service.
  if (inicio > 0 && negacao(trecho) && /^[\p{L}\s-]+$/u.test(trecho.slice(0, inicio))) return 'negacao';
  if (participacao(termo)) return 'participacao';
  if (/^(?:doacao|doacoes|doe\b|donation|donate\b|captacao de recursos|apadrinhe\b)/.test(termo)) return 'captacao';
  const nomeEstruturado=/^(?:jsonld\.|schema:)(?:Service|Product|Course)\./.test(candidato.evidencia?.campo||'');
  if (!nomeEstruturado && (/\?/u.test(termo)||/^pague (?:so |somente |apenas )?(?:depois|apos|antes)\b/u.test(termo))) return 'informacao';
  if (/^(?:conhecer|explorar|ver) (?:o|a|os|as|um|uma|todos|todas)\b/.test(termo) ||
      /^(?:venda onde|seu .+ (?:comeca|vai|merece)|sua .+ (?:comeca|vai|merece)|mais do que|lider em|welcome to|bem vind[oa]|(?:o|a) (?:maior|melhor))\b/.test(termo)) return 'institucional';
  if (/^(?:somos|nossa missao|nosso proposito|nosso objetivo)\b/.test(termo) ||
      /^(?:a|o|as|os) .{1,60}\bque (?:une|cuida|acompanha|transforma|faz|entende|conecta)\b/.test(termo)) return 'institucional';
  if(!/^(?:jsonld\.|schema:)(?:Service|Product|Course)\./.test(candidato.evidencia?.campo||'')&&
    (/^(?:qualidade|velocidade|seguranca|eficiencia|performance|resultados) (?:comprovad[oa]s?|garantid[oa]s?|superior|excelente|total)\b/.test(termo)||
      /^(?:portugues|english|espanol|espanhol|francais|deutsch)(?:\s*\([a-z-]+\))?$/.test(termo)))return 'institucional';
  if(!/^(?:jsonld\.|schema:)(?:Service|Product|Course)\./.test(candidato.evidencia?.campo||'')&&
    (/^(?:aqui[, ]+)?voc[êe]\b/.test(termo)||
     /^(?:autonomia|governanca|escala|velocidade|qualidade|seguranca|performance|resultados)(?: e (?:autonomia|governanca|escala|velocidade|qualidade|seguranca|performance|resultados))?,? (?:complet[oa]|de verdade|com padrao|com governanca|com qualidade)\b/.test(termo)))return 'institucional';
  if(!/^(?:jsonld\.|schema:)(?:Service|Product|Course)\./.test(candidato.evidencia?.campo||'')&&
    /\s+(?:x|vs\.?|versus)\s+/u.test(termo))return 'informacao';
  if(!/^(?:jsonld\.|schema:)(?:Service|Product|Course)\./.test(candidato.evidencia?.campo||'')&&
    /^(?:diferenciais|vantagens|beneficios)(?: (?:de|do|da|dos|das)\s+|$)/u.test(termo))return 'informacao';
  if (/^(?:solicitar|solicite|buscar|busque|navegue|saiba|veja|acesse|visite|fale|entre em contato|reserve|inscreva|assine)\b/.test(termo) ||
      /^(?:o|a) produto(?: .+)? (?:perfeito|ideal)\b/.test(termo)) return 'institucional';
  if (/^(?:obtenha (?:a|o) (?:maxim[oa]|maior)|venda mais e (?:atenda|venda) melhor)\b/u.test(termo) &&
      !/^(?:jsonld\.|schema:)(?:Service|Product|Course)\./u.test(candidato.evidencia?.campo||'')) return 'institucional';
  if (/^(?:title|h[1-4])$/u.test(candidato.evidencia?.campo||'')) {
    if (/^(?:a era d[aeo]|uma nova forma de|controle (?:os|as|seus|suas) riscos|(?:o|a) (?:crm|erp|software|plataforma|sistema) (?:mais (?:complet[oa]|bem avaliad[oa]|avancad[oa])|com o melhor))\b/u.test(termo)) return 'institucional';
    if (/^(?:recursos|funcionalidades),? planos e precos\b|^gestao completa dentro da plataforma$/u.test(termo)) return 'informacao';
  }
  if (/^(?:title|h[1-3])$/u.test(candidato.evidencia?.campo||'')&&
      /^venda (?!d[aeo]s?\b).+\be (?:gerencie|organize|acompanhe|administre)\b/u.test(termo)) return 'informacao';
  if (/\d\s*%/.test(termo) && /\b(?:off|desconto)\b/.test(termo) &&
      !/^(?:jsonld\.|schema:)(?:Service|Product)\./.test(candidato.evidencia?.campo || '')) return 'institucional';
  if (/^(?:encontre|escolha|feche|faca|entenda|coloque|personalize|impulsione|voce\b)\b/.test(termo) &&
      !/^(?:jsonld\.|schema:)(?:Service|Product)\./.test(candidato.evidencia?.campo || '')) return 'institucional';
  if (paginaDeCarreira(candidato.evidencia?.url)) return 'participacao';
  const fonte = contextoDaFonte(candidato);
  if (fonte !== 'oferta') return fonte;
  const declaracaoEstruturada = candidato.tipo === 'produto' || /^jsonld\.(?:Service|Product|Offer)\./.test(candidato.evidencia?.campo || '') ||
    /^schema:(?:Service|Product)\./.test(candidato.evidencia?.campo || '');
  if (!declaracaoEstruturada && /^(?:o que (?:e|sao)|como\b|por que\b|quando\b|qual\b|quais\b|guia (?:de|para|completo)|dicas? (?:de|para|sobre)|noticias? (?:de|sobre)|historia (?:de|da|do))/.test(termo)) return 'informacao';
  return 'oferta';
}

export function baseDaOferta(nome) {
  const limpo = String(nome || '').trim();
  // Only inflect an explicit initial buying verb. This does not introduce a
  // new offer, artist or region and is always published as a generated hypothesis.
  const formas = [
    [/^(?:contratar|contrate)\s+(?:(?:um|uma)\s+)?(.+)$/iu, 'contratação de '],
    [/^(?:comprar|compre)\s+(?:(?:um|uma)\s+)?(.+)$/iu, 'compra de '],
    [/^(?:alugar|alugue)\s+(?:(?:um|uma)\s+)?(.+)$/iu, 'aluguel de '],
  ];
  for (const [padrao, prefixo] of formas) {
    const achado = padrao.exec(limpo);
    if (achado) return prefixo + achado[1];
  }
  return limpo;
}
