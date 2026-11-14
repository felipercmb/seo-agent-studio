import {parse} from 'parse5';

const MAX_PAGINAS = 3;
const MAX_HTML = 1024 * 1024;
const MAX_NOS = 80_000;
const CONTROLES = new Set(['input', 'select', 'textarea', 'button']);
const SEM_TEXTO = new Set(['script', 'style', 'template', 'noscript', 'textarea', 'option']);
const LIMITE_TRECHO = 220;

const limpar = (valor, maximo = LIMITE_TRECHO) => String(valor ?? '')
  .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, maximo);

function enderecoPublicavel(valor) {
  try {
    const url = new URL(valor);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function extrair(html) {
  const raiz = parse(html);
  const nos = [];
  const pais = new WeakMap();
  const atributos = new WeakMap();
  const ocultos = new WeakMap();
  const pilha = [{no: raiz, pai: null, oculto: false}];
  while (pilha.length) {
    if (nos.length >= MAX_NOS) throw new Error('A página excedeu o limite de elementos da análise.');
    const {no, pai, oculto} = pilha.pop();
    const a = Object.fromEntries((no.attrs || []).map(({name, value}) => [name, value]));
    const ignorado = oculto || 'hidden' in a || a['aria-hidden']?.toLowerCase() === 'true' ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(a.style || '') ||
      SEM_TEXTO.has(no.tagName);
    atributos.set(no, a);
    ocultos.set(no, ignorado);
    pais.set(no, pai);
    nos.push(no);
    const filhos = no.childNodes || [];
    for (let i = filhos.length - 1; i >= 0; i--) pilha.push({no: filhos[i], pai: no, oculto: ignorado});
  }

  // Textos de nomes são limitados desde a travessia. Valores preenchidos de
  // campos não participam de evidências nem do nome de outros elementos.
  const visivel = new WeakMap(), referenciavel = new WeakMap();
  for (let i = nos.length - 1; i >= 0; i--) {
    const no = nos[i], a = atributos.get(no);
    let bruto = '', texto = '';
    if (no.nodeName === '#text') {
      bruto = texto = limpar(no.value);
    } else if (!SEM_TEXTO.has(no.tagName)) {
      bruto = limpar((no.childNodes || []).map(filho => referenciavel.get(filho) || '').join(' '));
      texto = limpar((no.childNodes || []).map(filho => visivel.get(filho) || '').join(' '));
      if (no.tagName === 'img') bruto = texto = limpar(a.alt);
      if (limpar(a['aria-label'])) bruto = texto = limpar(a['aria-label']);
    }
    referenciavel.set(no, bruto);
    visivel.set(no, ocultos.get(no) ? '' : texto);
  }
  const elementos = nos.filter(no => no.tagName);
  const ids = new Map();
  for (const no of elementos) {
    const id = atributos.get(no).id;
    if (id && !ids.has(id)) ids.set(id, no);
  }
  const controles = elementos.filter(no => CONTROLES.has(no.tagName) &&
    atributos.get(no).type?.toLowerCase() !== 'hidden');
  const conjuntoControles = new Set(controles);
  const rotuloAncestral = new WeakMap();
  const primeiroControle = new WeakMap();
  for (const no of nos) {
    const rotulo = no.tagName === 'label' ? no : rotuloAncestral.get(pais.get(no));
    if (rotulo) {
      rotuloAncestral.set(no, rotulo);
      if (conjuntoControles.has(no) && !primeiroControle.has(rotulo)) primeiroControle.set(rotulo, no);
    }
  }
  const associacoes = new WeakMap();
  for (const no of elementos.filter(no => no.tagName === 'label')) {
    const texto = visivel.get(no);
    if (!texto) continue;
    const a = atributos.get(no);
    let controle;
    if ('for' in a) {
      controle = ids.get(a.for);
      if (!conjuntoControles.has(controle)) continue;
    } else {
      controle = primeiroControle.get(no);
    }
    if (controle) associacoes.set(controle, texto);
  }
  function nome(no) {
    const a = atributos.get(no);
    if (a['aria-labelledby']) {
      const texto = limpar(a['aria-labelledby'].trim().split(/\s+/)
        .map(id => referenciavel.get(ids.get(id)) || '').join(' '));
      if (texto) return texto;
    }
    if (limpar(a['aria-label'])) return limpar(a['aria-label']);
    if (associacoes.has(no)) return associacoes.get(no);
    if (no.tagName === 'button' || no.tagName === 'a') {
      if (visivel.get(no)) return visivel.get(no);
    }
    if (no.tagName === 'input') {
      const tipo = (a.type || 'text').toLowerCase();
      if (tipo === 'image' && limpar(a.alt)) return limpar(a.alt);
      if (['submit', 'reset'].includes(tipo)) return 'value' in a ? limpar(a.value) : 'ação padrão do navegador';
      if (tipo === 'button' && limpar(a.value)) return limpar(a.value);
    }
    return limpar(a.title);
  }
  const ativos = elementos.filter(no => !ocultos.get(no));
  const semRotulo = controles.filter(no => !ocultos.get(no) && !('disabled' in atributos.get(no)) && !nome(no));
  const semAlt = ativos.filter(no => no.tagName === 'img' && !('alt' in atributos.get(no)) &&
    !['presentation', 'none'].includes(atributos.get(no).role?.toLowerCase()) && !nome(no));
  const titulos = elementos.filter(no => no.tagName === 'title' && no.namespaceURI === 'http://www.w3.org/1999/xhtml');
  const titulo = titulos.map(no => limpar((no.childNodes || []).map(filho => filho.value || '').join(' '))).find(Boolean) || '';
  const htmlNo = elementos.find(no => no.tagName === 'html');
  const idioma = limpar(atributos.get(htmlNo)?.lang, 80);
  let idiomaValido = false;
  try { idiomaValido = !!idioma && Intl.getCanonicalLocales(idioma).length === 1; } catch {}
  const viewport = elementos.some(no => no.tagName === 'meta' &&
    atributos.get(no).name?.toLowerCase() === 'viewport' &&
    /(?:^|[,;])\s*width\s*=\s*device-width\s*(?:[,;]|$)/i.test(atributos.get(no).content || ''));
  const contatos = ativos.filter(no => {
    if (no.tagName !== 'a') return false;
    const href = (atributos.get(no).href || '').trim();
    if (/^(?:tel|mailto):\S+/i.test(href)) return true;
    if (/^https?:\/\/(?:www\.)?(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)(?:\/|$)/i.test(href)) return true;
    // Apenas um indício de caminho para contato; o destino não é acionado.
    // Parâmetros de busca não são interpretados como caminho de contato.
    try {
      const url = new URL(href, 'https://referencia.invalid');
      if (!['http:', 'https:'].includes(url.protocol)) return false;
      return /(?:^|\/)(?:contato|contact|contact-us|fale-conosco)(?:[/.]|$)/i.test(url.pathname) ||
        /^#(?:contato|contact|fale-conosco)$/i.test(url.hash);
    } catch { return false; }
  });
  return {titulo, idioma, idiomaValido, viewport, semRotulo: semRotulo.length,
    semAlt: semAlt.length, h1: ativos.filter(no => no.tagName === 'h1' && visivel.get(no)).length,
    contatos: contatos.length, controles: controles.filter(no => !ocultos.get(no) && !('disabled' in atributos.get(no))).length,
    imagens: ativos.filter(no => no.tagName === 'img').length};
}

const REGRAS = [
  {id: 'rotulos-formulario', titulo: 'Identifique os campos e botões', categoria: 'Acessibilidade',
    problema: p => p.dados.semRotulo, trecho: p => `${p.dados.semRotulo} controle(s) sem nome identificável no HTML desta página.`,
    ok: 'Os controles examinados têm um nome identificável no HTML; a clareza dos nomes precisa de revisão humana.',
    orientacao: 'Um nome informa o propósito do campo ou botão para quem usa tecnologias assistivas. A verificação não executa os formulários.',
    passos: ['Abra a página e confira quais campos e botões estão sem identificação.', 'Associe cada campo a um <label>; use um nome acessível descritivo em botões com ícones. Placeholder sozinho não substitui o rótulo.', 'Salve a alteração, consulte o site novamente e confira também com teclado e leitor de tela.'],
    esforco: 'Pode precisar de quem edita o site', prioridade: 'Ajuda a compreender e utilizar os controles de atendimento.'},
  {id: 'contato-identificavel', titulo: 'Revise o caminho para pedir atendimento', categoria: 'Atendimento',
    agregado: true, problema: p => p.dados.contatos ? 0 : 1,
    trecho: () => 'Nenhum link de telefone, e-mail, WhatsApp ou página de contato foi identificado nas páginas lidas.',
    ok: 'Foi identificado um link de contato no HTML. O destino e a entrega da mensagem não foram testados.',
    orientacao: 'Se o site recebe pedidos, confira se uma pessoa encontra como entrar em contato. Pode haver outras formas de contato que esta leitura não reconhece.',
    passos: ['Abra o site no celular e procure o caminho para pedir atendimento.', 'Se necessário, acrescente um link de contato com texto claro perto da descrição do serviço.', 'Teste o destino com alguém da equipe, sem enviar dados de clientes.'],
    esforco: 'Revisão simples; a edição depende do site', prioridade: 'Ajuda quem procura o serviço a chegar ao atendimento.'},
  {id: 'viewport-mobile', titulo: 'Confira a adaptação inicial ao celular', categoria: 'Uso no celular',
    problema: p => p.dados.viewport ? 0 : 1, trecho: () => 'A declaração viewport com width=device-width não foi identificada no HTML desta página.',
    ok: 'A declaração viewport com width=device-width foi encontrada. A usabilidade no celular não foi testada.',
    orientacao: 'A declaração orienta o navegador sobre a largura da página. Sua presença, sozinha, não garante que o layout funcione no celular.',
    passos: ['Abra a página em um celular e confira textos, botões e rolagem lateral.', 'Peça a quem edita o site para conferir a declaração <meta name="viewport" content="width=device-width, initial-scale=1">.', 'Preserve a possibilidade de ampliar a tela e repita a conferência depois da mudança.'],
    esforco: 'Pode precisar de quem edita o site', prioridade: 'Facilita começar a revisar dificuldades de uso em telas pequenas.'},
  {id: 'alternativas-imagens', titulo: 'Revise as alternativas das imagens', categoria: 'Acessibilidade',
    problema: p => p.dados.semAlt, trecho: p => `${p.dados.semAlt} imagem(ns) sem atributo alt ou nome acessível identificado nesta página.`,
    ok: 'Nenhuma imagem examinada ficou sem alternativa declarada. O conteúdo das descrições e a função decorativa precisam de revisão humana.',
    orientacao: 'Imagens que comunicam informação precisam de uma alternativa adequada. Imagens decorativas podem usar alt=""; elas não foram tratadas como erro.',
    passos: ['Confira quais imagens comunicam informações necessárias para entender o serviço.', 'Descreva essa informação no atributo alt. Para imagens apenas decorativas, use alt="".', 'Consulte novamente e peça a uma pessoa para avaliar se as descrições fazem sentido.'],
    esforco: 'Edição de conteúdo', prioridade: 'Permite transmitir informações visuais também por texto.'},
  {id: 'idioma-pagina', titulo: 'Declare o idioma da página', categoria: 'Acessibilidade',
    problema: p => p.dados.idiomaValido ? 0 : 1,
    trecho: p => p.dados.idioma ? `O atributo lang não foi reconhecido como uma etiqueta de idioma válida: ${limpar(p.dados.idioma, 60)}.` : 'O elemento html está sem atributo lang preenchido.',
    ok: 'A página declara um idioma em formato reconhecido. A correspondência com o conteúdo não foi verificada.',
    orientacao: 'A indicação de idioma ajuda tecnologias assistivas a escolher a pronúncia. O idioma correto depende do conteúdo da página.',
    passos: ['Confirme o idioma principal do conteúdo.', 'Peça a quem edita o site para declarar o idioma no elemento html, como lang="pt-BR" para português brasileiro.', 'Consulte novamente e confira a pronúncia com um leitor de tela.'],
    esforco: 'Pode precisar de quem edita o site', prioridade: 'Ajuda tecnologias assistivas a interpretar a página.'},
  {id: 'titulo-pagina', titulo: 'Dê um título à página', categoria: 'Clareza',
    problema: p => p.dados.titulo ? 0 : 1, trecho: () => 'Nenhum elemento title com texto foi identificado no HTML desta página.',
    ok: 'Foi encontrado um título de página. A clareza e a adequação ao serviço precisam de revisão humana.',
    orientacao: 'Um título descritivo ajuda a reconhecer a página em abas e outros contextos. Não garante posição no Google.',
    passos: ['Defina uma frase curta que descreva a página e identifique o negócio.', 'Preencha o título da página no editor do site.', 'Confira a aba do navegador e repita a consulta.'],
    esforco: 'Edição de conteúdo', prioridade: 'Ajuda a reconhecer o assunto e a origem da página.'},
  {id: 'titulo-principal', titulo: 'Confira o título principal do conteúdo', categoria: 'Clareza',
    problema: p => p.dados.h1 ? 0 : 1, trecho: () => 'Nenhum h1 com conteúdo textual identificável foi encontrado no HTML inicial desta página.',
    ok: 'Foi encontrado um h1 com conteúdo textual identificável no HTML. A estrutura e a clareza precisam de revisão humana.',
    orientacao: 'Um título principal facilita compreender o assunto. Conteúdo inserido depois por JavaScript não participa desta leitura.',
    passos: ['Confira se o começo da página explica o serviço ou assunto.', 'Use um título principal descritivo e marque-o como h1 no editor, quando adequado à estrutura.', 'Confira a estrutura com quem edita o site e repita a consulta.'],
    esforco: 'Edição de conteúdo', prioridade: 'Ajuda a entender rapidamente o assunto da página.'},
];

function manuais(url, semColeta = false) {
  const evidencia = {url, trecho: semColeta ? 'Não foi possível ler páginas. Esta é uma conferência sugerida, sem diagnóstico de defeito.' : 'Esta tarefa depende de uma pessoa; a leitura de HTML não confirma seu resultado.', quantidade: null};
  return [
    {id: 'servico-regiao-horarios', titulo: 'Confirme serviço, região e horários', categoria: 'Clareza', estado: 'manual', evidencia,
      orientacao: 'Peça a alguém que ainda não conhece o negócio para descobrir o que pode contratar, onde é atendido e quando pode entrar em contato.',
      passos: ['Escolha uma pessoa que não participou da criação do site.', 'Peça que localize o serviço, a região atendida e os horários sem sua ajuda.', 'Anote o que ela não encontrou e atualize apenas as informações confirmadas pelo negócio.'],
      esforco: 'Conferência com uma pessoa', prioridade: 'Ajuda a alinhar a informação do site ao atendimento que o negócio oferece.'},
    {id: 'atendimento-celular', titulo: 'Teste o pedido de atendimento no celular', categoria: 'Atendimento', estado: 'manual', evidencia,
      orientacao: 'A existência de um botão não confirma que uma pessoa consegue concluir o contato. Combine um teste com a equipe.',
      passos: ['Use um celular para encontrar o serviço e o contato.', 'Combine uma mensagem de teste identificada com a equipe, sem dados de clientes.', 'Confirme que a mensagem chegou e registre onde houve dificuldade; repita depois das correções.'],
      esforco: 'Conferência com a equipe', prioridade: 'Verifica se o caminho até o atendimento funciona para uma pessoa.'},
    {id: 'teclado-leitura', titulo: 'Confira navegação e leitura com pessoas', categoria: 'Acessibilidade', estado: 'manual', evidencia,
      orientacao: 'Teclado, foco, contraste, ampliação e leitor de tela precisam de avaliação própria. Convide pessoas com deficiência para participar quando possível.',
      passos: ['Use Tab, Shift+Tab e Enter para alcançar e acionar os controles; confira se o foco permanece visível.', 'Amplie o texto e confira se as informações continuam legíveis; peça uma avaliação de contraste.', 'Registre dificuldades e valide as correções com usuários e, quando necessário, alguém com experiência em acessibilidade.'],
      esforco: 'Conferência humana; pode exigir apoio especializado', prioridade: 'Ajuda a identificar barreiras que a leitura automática não consegue confirmar.'},
  ];
}

export function analisarPaginas({dominio, coletadoEm, paginas = [], falhas = []} = {}) {
  const recebidas = Array.isArray(paginas) ? paginas : [];
  const problemas = (Array.isArray(falhas) ? falhas : []).slice(0, 20).map(f => ({url: enderecoPublicavel(f.url), motivo: limpar(f.motivo)}));
  const lidas = [];
  for (const pagina of recebidas.slice(0, MAX_PAGINAS)) {
    const url = enderecoPublicavel(pagina?.url);
    if (!url || typeof pagina?.html !== 'string' || !pagina.html.trim() || pagina.html.length > MAX_HTML ||
        (pagina.status != null && (!Number.isInteger(pagina.status) || pagina.status < 200 || pagina.status >= 300))) {
      problemas.push({url, motivo: 'A página não forneceu HTML completo dentro dos limites da análise.'});
      continue;
    }
    try {
      lidas.push({...pagina, url, dados: extrair(pagina.html)});
    } catch {
      problemas.push({url, motivo: 'A página excedeu os limites de processamento da análise.'});
    }
  }
  if (recebidas.length > MAX_PAGINAS) problemas.push({url: '', motivo: 'A análise se limita a três páginas por consulta.'});
  const verificacoes = [];
  for (const regra of lidas.length ? REGRAS : []) {
    const afetadas = regra.agregado && lidas.some(p => !regra.problema(p)) ? [] : lidas.filter(p => regra.problema(p));
    const primeira = afetadas[0] || (regra.agregado ? lidas.find(p => !regra.problema(p)) : lidas[0]);
    const {problema, trecho, ok, agregado, ...descricao} = regra;
    verificacoes.push({...descricao, estado: afetadas.length ? 'atencao' : 'verificado',
      evidencia: {url: primeira.url, trecho: limpar(afetadas.length ? trecho(primeira) : ok),
        quantidade: afetadas.reduce((total, p) => total + problema(p), 0)},
      paginasAfetadas: afetadas.map(p => p.url)});
  }
  if (!lidas.length) verificacoes.push({id: 'coleta-publica', titulo: 'A leitura do site ficou indisponível', categoria: 'Cobertura', estado: 'indisponivel',
    evidencia: {url: '', trecho: 'Nenhuma página foi analisada. Isso não demonstra um problema no site.', quantidade: null},
    orientacao: 'Confira se o endereço abre no seu navegador. O site pode restringir consultas automáticas ou estar temporariamente inacessível para este serviço.',
    passos: ['Confira o endereço informado.', 'Abra o site no seu navegador.', 'Tente a consulta novamente mais tarde ou realize as conferências manuais sugeridas.'],
    esforco: 'Conferência simples', prioridade: 'Evita tirar conclusões sem páginas disponíveis.'});
  const humanas = manuais(lidas[0]?.url || '', !lidas.length);
  verificacoes.push(...humanas);
  const acoes = [...verificacoes.filter(v => v.estado === 'atencao'), ...humanas].slice(0, 3);
  return {
    versao: 1, dominio: limpar(dominio, 253), coletadoEm: limpar(coletadoEm, 40),
    estado: !lidas.length ? 'indisponivel' : problemas.length ? 'parcial' : 'concluido',
    paginas: lidas.map(p => ({url: p.url, coletadoEm: limpar(p.coletadoEm || coletadoEm, 40),
      bytes: Number.isSafeInteger(p.bytes) && p.bytes >= 0 ? p.bytes : null,
      sha256: /^[a-f0-9]{64}$/i.test(p.sha256 || '') ? p.sha256.toLowerCase() : null, status: p.status ?? 200})),
    verificacoes, acoes, falhas: problemas,
    limites: [
      'Leitura do HTML inicial de até três páginas públicas; não executa JavaScript, CSS, formulários ou pedidos de atendimento.',
      'Os resultados se referem apenas às páginas e ao momento da coleta. Ausência nesta leitura não comprova ausência no site inteiro.',
      'Itens verificados confirmam apenas a condição descrita. Não constituem certificação de acessibilidade, segurança ou qualidade do negócio.',
      'Acessibilidade completa exige avaliação humana. Contraste, foco, teclado, adaptação visual, clareza e entrega de mensagens não foram testados automaticamente.',
      'A ordem das ações considera compreensão dos controles, acesso ao atendimento, uso no celular e clareza do conteúdo. Esforço é uma orientação qualitativa.',
      'Esta análise não mede posições atuais no Google, receita, conversões nem desperdício de anúncios.',
    ],
  };
}
