import {normalizarSite} from '../../src/consulta.mjs';

const CAMPOS = new Set(['papel','finalidade','ofertas','publicos','atuacoes','condicoes','recomendar']);
const TIPOS = new Set(['declaracao','descricao','conteudo','interface']);
const literal = texto => String(texto || '').normalize('NFKC').replace(/\s+/gu,' ').trim();
const normal = texto => String(texto || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/gu,' ').trim();
function contemTextoCompleto(origem,trecho) {
  const texto=literal(origem),alvo=literal(trecho);let inicio=texto.indexOf(alvo);
  while(inicio!==-1){const antes=texto[inicio-1],depois=texto[inicio+alvo.length],parte=ch=>ch&&/[\p{L}\p{N}_+#]/u.test(ch);if(!parte(antes)&&!parte(depois))return true;inicio=texto.indexOf(alvo,inicio+1);}return false;
}
const campoTitulo = campo => /^h[1-4]$/.test(campo || '');
const campoBloco = campo => campo === 'bloco.titulo-conteudo';
const editorial = url => /\/(?:blog|noticias|artigos|insights|news|sala-de-imprensa)(?:\/|$)/u.test(normal(new URL(url).pathname));
const institucional = url => /\/(?:sobre|quem-somos|about|o-que-fazemos|porque-existimos)(?:\/|$)/u.test(normal(new URL(url).pathname));

// Published, generic query vocabulary. No organization, source IDs, annotated
// targets, provider account or measured business outcome enters the score.
const PADROES = {
  identidade: /\b(?:somos|nossa empresa|nosso negocio|nossa plataforma|nosso sistema|e uma (?:empresa|organizacao|plataforma|cooperativa|agencia)|fabricamos|produzimos|prestamos|intermediamos|agenciamos|agenciamento|conectamos|atuamos|oferecemos|entregamos|desenvolvemos|implementamos|comercializamos|we (?:are|provide|offer)|our (?:company|platform|software))\b/u,
  modelo: /\b(?:plataforma|agenciamento|intermediacao|corretora|imobiliaria|fabricante|fabrica|industria|multinacional|grupo empresarial|loja|software|consultoria|servicos|produtos)\b/u,
  social: /\b(?:sem fins lucrativos|organizacao da sociedade civil|organizacao nao governamental|missao|proposito|justica social|desenvolvimento social|pobreza|voluntariado|doacao|beneficiarios)\b/u,
  transacao: /\b(?:comprar|compre|contratar|contrate|contratacao|vendemos|comercializamos|assinatura|assine|plano|planos|locacao|aluguel|matricula)\b/u,
  oferta: /\b(?:oferecemos|oferece|ofertam|produzimos|produzem|fabricacao|comercializacao|catalogo|portfolio|servicos?|produtos?|cursos?|planos?|modalidades?|solucao|solucoes|pacotes?|products?|services?|solutions?|software|courses?|plans?)\b/u,
  publico: /\b(?:para|atendemos|destinado|destinados|voltado|beneficiarios|colaboradores|profissionais|clientes|pacientes|fornecedores|voluntarios|moradores|alunos|estudantes|empresas|contratantes|prestadores|compradores|participantes)\b/u,
  relacao: /\b(?:conectamos|conectando|intermediamos|agenciamos|prestados por|operados por|entre as partes|para profissionais|para clientes|para empresas|candidatos|inscricao|selecao)\b/u,
  atuacao: /\b(?:programa|programas|projeto|projetos|frente|frentes|iniciativa|iniciativas|voluntariado|voluntarios|doe|doacao|participar|inscricao|selecao|publicacoes|acoes locais)\b/u,
  condicao: /\b(?:condicao|condicoes|inclui|incluido|incluida|exige|obrigatorio|requisito|requisitos|disponivel|disponiveis|indisponivel|indisponiveis|exceto|apenas|somente|exclusivo|limitado|limite|duracao|gratuito|gratuita|gratis|taxa|mensalidade|horario|garantia|vagas|selecionado|modalidades|documentos|parcelas|combinaveis)\b/u,
  quantidade: /\b(?:ate|mais de|a partir de|menos de)\s+\d|\b\d+[.,]?\d*\s*(?:h|horas|dias|meses|anos|produtos|documentos|usuarios|visitas|cursos)\b/u,
  exclusao: /\b(?:indisponivel|indisponiveis|nao disponivel|nao disponiveis|nao atendemos|nao elegivel|nao elegiveis|nao e permitido|nao pode|nao podera|nao consegue|exceto|excluido|excluidos|not available|not eligible|excluded|except)\b/u,
  canal: /\b(?:fale conosco|falar com|contato|encontrar|buscar|agendar|reservar|solicitar|inscreva|cadastrar|orcamento|especialista|conheca as|saiba mais)\b/u,
  regra: /\b(?:obrigatorio|exige|requisito|somente|apenas|exclusivo|depende|sujeito|precisa|deve|cortesia|incluido|incluida|cancelamento|prazo|garantia|limitado|gratuito|gratuita|gratis|taxa|mensalidade|horario|without|requires|only|included|warranty|free|fee|limit)\b/u,
  funcionamento: /\b(?:inclui|cobre|cobrem|conta com|modulos|funcionalidades|permite|permitem|integrad[oa]s?|integracao|sincronizacao|emissao|controle de|gestao de|automatiz\w*|software|sistema|online|presencial|ao vivo|gravadas?|streaming|na nuvem|web|works|features|includes|integration)\b/u,
  promessa: /\b(?:o melhor|os melhores|excelencia|imperdivel|mais eficiencia|mais produtividade|sem burocracia|de sucesso|qualidade garantida|velocidade comprovada)\b/u,
  rotuloAuxiliar: /^(?:home|inicio|contato|fale conosco|saiba mais|ver mais|nossos clientes|parceiros|menu|noticias|blog|beneficios|vantagens|diferenciais|por que|depoimentos|na midia)(?:$|[\s:])/u,
  pergunta: /^(?:\d+\s*[.:-]?\s*)?(?:o que|o qual|qual|quais|como|por que|porque|quanto|quantos|quantas|onde|quando|what|which|how|why|where|when)\b/u,
};

export const POLITICA_RECUPERACAO_NEGOCIO = Object.freeze({
  versao: 2,
  limiteFontes: 16,
  limiteCaracteres: 4500,
  limiteInsumo: 240,
  reservaPaginas: 4,
  maxInterfacesRecomendacao: 2,
  deduplicacao: 'Texto NFKC+espaços e seção iguais; metadados repetidos podem compartilhar um representante. As origens alternativas são auditadas, sem afirmar equivalência semântica.',
  nota: 'Pontuação editorial de relevância do contexto, sem interpretação como confiança, ranking no Google ou retorno comercial.',
});

function pontuar(fonte, campo) {
  const t = normal(fonte.texto), motivos = [];
  let pontos = 0;
  const somar = (valor, motivo) => { pontos += valor; motivos.push({criterio:motivo,pontos:valor}); };
  if (fonte.tipo === 'interface') {
    if (campo !== 'recomendar') return {pontos:-100,motivos:[{criterio:'interface_nao_prova_entendimento',pontos:-100}]};
    somar(PADROES.canal.test(t) ? 5 : -5, 'rotulo_de_interface_como_canal_apenas');
    return {pontos,motivos};
  }
  const nomeEstruturado=/^jsonld\.(?:Organization|Corporation|WebSite|WebPage|Person)\.name$/u.test(fonte.campo||'');
  const itemEstruturado=/^jsonld\.(?:Product|Service|Course|Hotel|Restaurant|SoftwareApplication|FinancialProduct|Offer|OfferCatalog)\.(?:name|description)$/u.test(fonte.campo||'');
  const pergunta=PADROES.pergunta.test(t)||/\?$/.test(t);
  const nominal=campoTitulo(fonte.campo)&&fonte.texto.length<=120&&t.split(' ').length<=16&&!pergunta&&!PADROES.rotuloAuxiliar.test(t);
  const enunciadoIdentidade=fonte.texto.length>=45&&PADROES.identidade.test(t);
  const blocoSubstantivo=campoBloco(fonte.campo)&&fonte.texto.length>=60&&!PADROES.rotuloAuxiliar.test(t);
  if (fonte.tipo === 'declaracao'&&!nomeEstruturado) somar(1,'tipo_declaracao');
  if (fonte.tipo === 'descricao') somar(1,'tipo_descricao');
  if (!fonte.recortado) somar(1,'trecho_nao_recortado');
  if (blocoSubstantivo) somar(2,'nome_e_conteudo_preservados_no_bloco_dom');
  if(nomeEstruturado)somar(-8,'nome_da_entidade_isolado_nao_descreve_atividade');
  if(PADROES.rotuloAuxiliar.test(t)&&fonte.texto.length<100)somar(-5,'rotulo_auxiliar_sem_explicacao');
  if(pergunta&&(/^jsonld\.Question\.name$/u.test(fonte.campo||'')||campoTitulo(fonte.campo)))somar(-8,'pergunta_sem_resposta_na_fonte');
  if (editorial(fonte.url)) somar(-5,'pagina_editorial_nao_e_catalogo_da_empresa');
  if (/^[“"«]|\b(?:nosso entrevistado|diz nosso cliente|segundo nosso cliente)\b/u.test(t)) somar(-5,'relato_ou_citacao_nao_e_declaracao_propria');
  const aplicar = (padrao, peso, nome) => { if (padrao.test(t)) somar(peso,nome); };
  if (campo === 'papel') {
    aplicar(PADROES.identidade,7,'verbo_de_atuacao_propria');
    aplicar(PADROES.modelo,4,'modelo_de_atividade');
    aplicar(PADROES.relacao,5,'relacao_entre_atores');
    if (institucional(fonte.url)) somar(2,'pagina_institucional');
    if (/jsonld\.\w+\.description$/u.test(fonte.campo || '')) somar(2,'descricao_estruturada');
  } else if (campo === 'finalidade') {
    aplicar(PADROES.social,7,'finalidade_ou_proposito_publicado');
    aplicar(PADROES.identidade,4,'declaracao_propria');
    aplicar(PADROES.transacao,4,'atividade_comercial_declarada');
    if (institucional(fonte.url)) somar(2,'pagina_institucional');
  } else if (campo === 'ofertas') {
    aplicar(PADROES.oferta,6,'objeto_ou_portfolio_publicado');
    aplicar(PADROES.transacao,2,'contexto_de_aquisicao');
    if(enunciadoIdentidade)somar(5,'atividade_propria_com_objeto_no_enunciado');
    if(itemEstruturado)somar(8,'declaracao_estruturada_de_item');
    if(nominal)somar(4,'nome_nominal_publicado_em_cabecalho');
    if(blocoSubstantivo)somar(2,'descricao_completa_de_item_ou_modalidade');
  } else if (campo === 'publicos') {
    aplicar(PADROES.publico,6,'grupo_ou_destinatario_publicado');
    aplicar(PADROES.relacao,5,'papel_no_percurso');
    aplicar(PADROES.exclusao,8,'restricao_de_elegibilidade_preservada');
  } else if (campo === 'atuacoes') {
    aplicar(PADROES.atuacao,7,'frente_ou_acao_publicada');
    aplicar(PADROES.social,4,'contexto_institucional_ou_social');
    aplicar(PADROES.identidade,3,'declaracao_propria');
  } else {
    aplicar(PADROES.regra,6,'regra_ou_condicao_publicada');
    if(fonte.texto.length>=35)aplicar(PADROES.funcionamento,4,'funcionamento_ou_modalidade_publicados');
    aplicar(PADROES.quantidade,4,'limite_ou_duracao_publicada');
    aplicar(PADROES.exclusao,8,'negacao_e_excecao_preservadas');
    if(blocoSubstantivo)somar(1,'nome_e_descricao_disponiveis_sem_concatenacao');
    if(PADROES.promessa.test(t)&&!PADROES.exclusao.test(t)&&!PADROES.regra.test(t))somar(-3,'promessa_qualitativa_nao_e_requisito');
    if(campoTitulo(fonte.campo)&&!PADROES.exclusao.test(t))somar(-2,'titulo_solitario_nao_descreve_condicao');
    if (campo === 'recomendar') {
      aplicar(PADROES.oferta,3,'alternativa_publicada');
      aplicar(PADROES.canal,2,'proximo_passo_publicado');
      aplicar(PADROES.relacao,2,'percurso_entre_atores');
    }
  }
  return {pontos,motivos};
}

function validarFonte(fonte, dominio) {
  if (!fonte || typeof fonte.id !== 'string' || fonte.id.length > 160 ||
      typeof fonte.texto !== 'string' || !fonte.texto.trim() || fonte.texto.length > 600 ||
      !TIPOS.has(fonte.tipo) || !/^[a-f0-9]{64}$/u.test(fonte.sha256 || '') ||
      !Number.isFinite(Date.parse(fonte.coletadoEm))) return false;
  try {
    const url = new URL(fonte.url);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      !url.search && !url.hash && !fonte.url.includes('#') && normalizarSite(url.href) === dominio;
  } catch { return false; }
}

const custo = fontes => JSON.stringify({fontes:fontes.map(({id,texto,tipo})=>({id,texto,tipo}))}).length;
const termos = texto => new Set(normal(texto).match(/[\p{L}\p{N}+#]{3,}/gu)||[]);
function sobreposicao(a,b){let comuns=0;for(const t of a)if(b.has(t))comuns++;return comuns/Math.max(1,a.size+b.size-comuns);}

/** Reads only the pool and generic field query. It never accepts gold labels,
 * model targets or a domain-specific keyword list. Sources are never shortened
 * or combined; exact original objects are retained for the audit. */
export function recuperarFontesNegocio(pool, {campo, maxFontes=16, maxCaracteres=4500}={}) {
  if (!CAMPOS.has(campo)) throw new TypeError('Campo de recuperação inválido.');
  if (!Number.isInteger(maxFontes) || maxFontes < 1 || maxFontes > 16 ||
      !Number.isInteger(maxCaracteres) || maxCaracteres < 128 || maxCaracteres > 12000) throw new TypeError('Orçamento de recuperação inválido.');
  const dominio = normalizarSite(pool?.dominio), insumo = Array.isArray(pool?.fontes) ? pool.fontes : [];
  const candidatos = [], descartes = [], porId = new Set(), duplicatas = new Map(),equivalentes=[],originaisValidos=[];
  for (const [ordem,fonte] of insumo.slice(0,240).entries()) {
    if (!validarFonte(fonte,dominio) || porId.has(fonte?.id)) { descartes.push({id:fonte?.id || null,motivo:'metadados_invalidos_ou_id_repetido'}); continue; }
    porId.add(fonte.id);
    const pontuacao = pontuar(fonte,campo), chave = literal(fonte.texto)+'\n'+literal(fonte.secao||'');
    const linha = {fonte,ordem,...pontuacao,termos:termos(fonte.texto),aspectos:pontuacao.motivos.filter(m=>m.pontos>=4).map(m=>m.criterio)};
    originaisValidos.push(linha);
    if (duplicatas.has(chave)) {
      const anterior = duplicatas.get(chave);
      const troca=linha.pontos>anterior.pontos,retida=troca?linha:anterior,outra=troca?anterior:linha;
      const motivo=retida.fonte.url===outra.fonte.url?'texto_repetido_na_mesma_pagina':'texto_e_secao_repetidos_em_outra_pagina';
      descartes.push({id:outra.fonte.id,motivo});equivalentes.push({grupo:chave,alternativaId:outra.fonte.id,url:outra.fonte.url,sha256:outra.fonte.sha256,coletadoEm:outra.fonte.coletadoEm,mesmoTextoLiteral:true,relacaoSemanticaConfirmada:false});
      if(troca)duplicatas.set(chave,linha);
    } else duplicatas.set(chave,linha);
  }
  for (const linha of duplicatas.values()) {
    if (linha.pontos >= 3) candidatos.push(linha);
    else descartes.push({id:linha.fonte.id,motivo:linha.fonte.tipo==='interface'?'interface_fora_da_tarefa':'sem_relevancia_minima',pontos:linha.pontos});
  }
  candidatos.sort((a,b)=>b.pontos-a.pontos || a.ordem-b.ordem);
  const selecionados=[],ids=new Set(),paginas=new Map(),secoes=new Map(),vizinhos=[],substituicoes=[];
  let interfaces=0;
  function recontar(){paginas.clear();secoes.clear();interfaces=0;ids.clear();for(const s of selecionados){const f=s.fonte;ids.add(f.id);paginas.set(f.url,(paginas.get(f.url)||0)+1);const secao=f.url+'\n'+normal(f.secao||f.campo);secoes.set(secao,(secoes.get(secao)||0)+1);if(f.tipo==='interface')interfaces++;}}
  function adicionar(linha,motivo) {
    if (!linha || ids.has(linha.fonte.id)) return false;
    const f=linha.fonte;
    if (f.tipo==='interface' && interfaces>=2) return false;
    if (selecionados.some(s=>s.fonte.url===f.url && s.fonte.tipo!== 'interface' &&
        campoBloco(s.fonte.campo) && contemTextoCompleto(s.fonte.texto,f.texto))) return false;
    const redundantes=campoBloco(f.campo)&&!f.recortado?selecionados.filter(s=>s.fonte.tipo!=='interface'&&s.fonte.url===f.url&&s.fonte.sha256===f.sha256&&s.fonte.coletadoEm===f.coletadoEm&&contemTextoCompleto(f.texto,s.fonte.texto)):[];
    const proposta=[...selecionados.filter(s=>!redundantes.includes(s)),linha];
    if (proposta.length>maxFontes||custo(proposta.map(s=>s.fonte))>maxCaracteres) return false;
    if(redundantes.length){for(const s of redundantes){selecionados.splice(selecionados.indexOf(s),1);substituicoes.push({fonteId:s.fonte.id,blocoId:f.id,motivo:'bloco_original_contem_fonte_sem_concatenar'});}for(let i=vizinhos.length-1;i>=0;i--)if(redundantes.some(s=>[vizinhos[i].fonteId,vizinhos[i].contextoId].includes(s.fonte.id)))vizinhos.splice(i,1);recontar();}
    selecionados.push({...linha,motivoSelecao:motivo});ids.add(f.id);
    paginas.set(f.url,(paginas.get(f.url)||0)+1);
    const secao=f.url+'\n'+normal(f.secao || f.campo);secoes.set(secao,(secoes.get(secao)||0)+1);
    if(f.tipo==='interface')interfaces++;
    return true;
  }
  // Reserve context from up to four relevant pages before a long page fills
  // the whole allowance. A low-relevance contact page is not forced in.
  const melhoresPaginas = new Map();
  for(const c of candidatos)if(c.fonte.tipo!=='interface'&&!melhoresPaginas.has(c.fonte.url))melhoresPaginas.set(c.fonte.url,c);
  for(const c of [...melhoresPaginas.values()].slice(0,Math.min(4,maxFontes)))adicionar(c,'reserva_de_pagina_relevante');
  // Keep a scope neighbour before unrelated high-scoring material consumes
  // every slot. Neighbours are valid original pool sources even when their
  // heading alone does not meet the generic relevance threshold.
  function incluirContexto(escolhido) {
    if(escolhido.fonte.tipo==='interface')return;
    const f=escolhido.fonte;
    const relacionados=originaisValidos.filter(c=>c.fonte.tipo!=='interface'&&c.fonte.id!==f.id&&c.fonte.url===f.url&&c.fonte.sha256===f.sha256&&c.fonte.coletadoEm===f.coletadoEm);
    const bloco=relacionados.filter(c=>campoBloco(c.fonte.campo)&&!c.fonte.recortado&&c.fonte.texto.length>f.texto.length&&contemTextoCompleto(c.fonte.texto,f.texto)).sort((a,b)=>a.fonte.texto.length-b.fonte.texto.length)[0];
    const titulo=!bloco&&f.secao?relacionados.filter(c=>campoTitulo(c.fonte.campo)&&literal(c.fonte.texto)===literal(f.secao)&&c.ordem<escolhido.ordem).sort((a,b)=>b.ordem-a.ordem)[0]:null;
    const vizinho=bloco||titulo;
    if(vizinho&&(ids.has(vizinho.fonte.id)||adicionar(vizinho,bloco?'bloco_dom_contem_trecho':'titulo_vizinho_de_leitura'))&&ids.has(f.id)&&!vizinhos.some(v=>v.fonteId===f.id&&v.contextoId===vizinho.fonte.id))vizinhos.push({fonteId:f.id,contextoId:vizinho.fonte.id,origem:bloco?'bloco_dom_publicado':'ordem_de_leitura',relacaoSemanticaConfirmada:false});
  }
  for(const c of [...selecionados])if(ids.has(c.fonte.id))incluirContexto(c);
  while (selecionados.length < maxFontes) {
    const disponiveis=candidatos.filter(c=>!ids.has(c.fonte.id));
    const aspectosVistos=new Set(selecionados.flatMap(s=>s.aspectos));
    const ajuste=new Map(disponiveis.map(c=>[c,c.pontos-.5*(paginas.get(c.fonte.url)||0)-(secoes.get(c.fonte.url+'\n'+normal(c.fonte.secao||c.fonte.campo))||0)+2*c.aspectos.filter(a=>!aspectosVistos.has(a)).length-4*Math.max(0,...selecionados.map(s=>sobreposicao(c.termos,s.termos)))]));
    disponiveis.sort((a,b)=>ajuste.get(b)-ajuste.get(a)||b.pontos-a.pontos||a.ordem-b.ordem);
    let entrou=false;
    for(const c of disponiveis)if(adicionar(c,'relevancia_com_diversidade')){incluirContexto(c);entrou=true;break;}
    if(!entrou)break;
  }
  const fontes=selecionados.map(s=>structuredClone(s.fonte));
  return {versao:2,modo:'end_to_end',campo,fontes,auditoria:{
    fontesNoPool:insumo.length,limiteInsumo:240,insumoLimitado:insumo.length>240,
    limiteFontes:maxFontes,limiteCaracteres:maxCaracteres,caracteresModelo:custo(fontes),
    projecaoContada:'JSON de {fontes:[{id,texto,tipo}]} antes de mapear IDs; o tokenizador precisa conferir o orçamento exato.',
    paginas:[...paginas].map(([url,quantidade])=>({url,quantidade})),escoposVizinhos:vizinhos,substituicoesPorBloco:substituicoes,equivalentesNaoExibidos:equivalentes.filter(e=>!ids.has(e.alternativaId)).map(({grupo,...e})=>({...e,retidaId:duplicatas.get(grupo).fonte.id})),
    fontesDeContexto:selecionados.filter(s=>!candidatos.includes(s)&&!candidatos.some(c=>c.fonte.id===s.fonte.id)).map(s=>({id:s.fonte.id,pontos:s.pontos,motivoSelecao:s.motivoSelecao})),
    candidatos:candidatos.map(c=>({id:c.fonte.id,pontos:c.pontos,motivos:c.motivos,selecionada:ids.has(c.fonte.id),motivoSelecao:selecionados.find(s=>s.fonte.id===c.fonte.id)?.motivoSelecao||null})),
    descartes:descartes.filter(d=>!ids.has(d.id)),
  },limites:[
    'Seleção genérica baseada somente no pool e no campo solicitado. Não usa alvos, marcas, gold IDs, embeddings pagos ou chamadas externas.',
    'Relevância editorial não confirma a semântica, a oferta, o público, a condição, uma posição no Google ou retorno comercial.',
    'Fontes são preservadas inteiras; trechos já recortados no exportador continuam sinalizados. Não completar uma condição cortada.',
    'Título vizinho indica ordem de leitura. Vizinhança sozinha não prova que uma condição pertence a uma oferta.',
    'A seleção usa um pool já limitado de HTML inicial. Uma fonte ausente do pool não pode ser recuperada aqui.',
  ]};
}
