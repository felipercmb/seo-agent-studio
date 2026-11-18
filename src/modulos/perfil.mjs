import {createHash} from 'node:crypto';
import {normalizarSite, ErroConsulta} from '../consulta.mjs';
import {evidenciaContemExpressao, nomeDeComercioPublicado, nomeDeProdutoPublicado, nomeComercialPublicado, cabecalhoComercialPublicado,objetoDeCompraPublicado,fragmentoSemObjetoComercial} from './linguagem-negocio.mjs';
import {candidatosDeDeclaracoes, finalidadePublicada, naturezaDaAtuacao, inferirEntendimentoNegocio, centralidadeDaOferta, condicaoDeCortesia, mediacoesPublicadas, candidatosMediados} from './entendimento-negocio.mjs';
import {normalizarJornada} from './jornadas.mjs';
import {normalizarPremissasEconomicas} from './premissas-economicas.mjs';
import {normalizarEntregaOferta} from './entrega-oferta.mjs';

const MAX_OFERTAS = 8;
const PAPEIS = new Set(['intermediacao', 'servicos', 'produtos', 'misto', 'indefinido']);
const FINALIDADES = new Set(['comercial', 'social', 'indefinida']);
const ATUACOES = new Set(['programa_social', 'captacao', 'participacao']);
const CENTRALIDADES = new Set(['principal', 'complementar', 'indefinida']);
const normal = valor => valor.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
const objeto = valor => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
const falhar = mensagem => { throw new ErroConsulta(mensagem); };
function texto(valor, campo, maximo, vazio = true) {
  if (typeof valor !== 'string' || valor.length > maximo || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(valor)) {
    falhar(`O campo ${campo} deve ser um texto de até ${maximo} caracteres.`);
  }
  const limpo = valor.replace(/\s+/g, ' ').trim();
  if (!vazio && !limpo) falhar(`Preencha o campo ${campo}.`);
  return limpo;
}
function lista(valor, campo, maxItens, maxTexto) {
  if (!Array.isArray(valor) || valor.length > maxItens) falhar(`O campo ${campo} aceita até ${maxItens} itens.`);
  const resultado = valor.map(v => texto(v, campo, maxTexto, false));
  if (new Set(resultado.map(normal)).size !== resultado.length) falhar(`Remova itens repetidos em ${campo}.`);
  return resultado;
}
function campos(valor, permitidos, mensagem) {
  if (!objeto(valor) || Object.keys(valor).some(k => !permitidos.includes(k))) falhar(mensagem);
}
function urlOferta(valor, dominio) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string' || valor.length > 2048) falhar('A página da oferta deve ser uma URL pública do próprio site.');
  let url;
  try { url = new URL(valor); } catch { falhar('A página da oferta deve ser uma URL pública do próprio site.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash || normalizarSite(url.href) !== dominio) {
    falhar('Use uma página do próprio domínio, sem parâmetros, senha ou fragmentos.');
  }
  return url.href;
}
function economia(valor, anterior = {}) {
  campos(valor, ['contribuicaoPorVenda', 'taxaFechamento'], 'Informe apenas contribuição por venda e taxa de fechamento.');
  const resultado = {};
  for (const campo of ['contribuicaoPorVenda', 'taxaFechamento']) {
    const n = Object.hasOwn(valor, campo) ? valor[campo] : anterior[campo] ?? null;
    const maximo = campo === 'taxaFechamento' ? 1 : 1_000_000_000;
    const minimo = campo === 'taxaFechamento' ? 0 : -1_000_000_000;
    if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < minimo || n > maximo)) {
      falhar(campo === 'taxaFechamento' ? 'A taxa de fechamento deve estar entre 0 e 1, ou ser desconhecida.' : 'A contribuição deve ser um número entre menos um bilhão e um bilhão, ou ser desconhecida.');
    }
    resultado[campo] = n;
  }
  return resultado;
}
const idOferta = (dominio, nome) => 'oferta_' + createHash('sha256').update(dominio + '\n' + normal(nome)).digest('hex').slice(0, 16);
const idAtuacao = (dominio, tipo, nome) => 'atuacao_' + createHash('sha256').update(dominio + '\n' + tipo + '\n' + normal(nome)).digest('hex').slice(0, 16);

function evidenciaSegura(candidato, dominio) {
  const e = candidato?.evidencia;
  if (!objeto(e) || typeof e.trecho !== 'string' || !e.trecho.trim() || typeof e.campo !== 'string' ||
      !evidenciaContemExpressao(candidato.termo, e.trecho)) return null;
  try {
    const url = urlOferta(e.url, dominio);
    if (!url) return null;
    return {url, campo: e.campo.slice(0, 80), trecho: e.trecho.slice(0, 600),
      coletadoEm: typeof e.coletadoEm === 'string' && Number.isFinite(Date.parse(e.coletadoEm)) ? e.coletadoEm : null,
      sha256: /^[a-f0-9]{64}$/i.test(e.sha256 || '') ? e.sha256.toLowerCase() : null,
      ...(typeof e.recortado==='boolean'||e.trecho.length>600?{recortado:e.recortado===true||e.trecho.length>600}:{})};
  } catch { return null; }
}

function candidatosContextuais(contexto, dominio) {
  if (!objeto(contexto) || contexto.versao !== 1 || contexto.dominio !== dominio || !Array.isArray(contexto.evidencias)) return [];
  const encontrados = [];
  for (const e of contexto.evidencias.slice(0, 24)) {
    if (!['servico', 'produto', 'titulo'].includes(e?.tipo) || typeof e.trecho !== 'string') continue;
    const frases = ['servico', 'produto'].includes(e.tipo) ? [e.trecho] : e.trecho.split(/\s*[|｜]\s*|\s+[–—-]\s+|:\s+/u);
    for (const frase of frases) {
      const nome = e.tipo==='titulo'?objetoDeCompraPublicado(frase):frase.trim();
      if (nome.length < 3 || nome.length > 120 || nome.split(/\s+/).length > 16) continue;
      const n = normal(nome);
      if (e.tipo === 'titulo' && !nomeComercialPublicado(nome)) continue;
      if (['h2', 'h3','h4'].includes(e.campo) && !cabecalhoComercialPublicado(nome)) continue;
      if (e.tipo === 'titulo' && /^(?:crie|monte|conheca|comece|descubra|compre|venda|transforme|conhecer|start|learn|build|automate)\b/.test(n)) continue;
      const candidato = {termo:nome, tipo:e.tipo === 'produto' || nomeDeComercioPublicado(nome) || nomeDeProdutoPublicado(nome) ? 'produto' : 'servico',
        evidencia:{url:e.url, campo:e.campo, trecho:e.trecho, coletadoEm:e.coletadoEm, sha256:e.sha256}};
      if (evidenciaSegura(candidato, dominio)) encontrados.push(candidato);
    }
  }
  return encontrados;
}

function descricaoPublicada(contexto, dominio) {
  if (contexto?.versao !== 1 || contexto.dominio !== dominio || !Array.isArray(contexto.evidencias)) return null;
  for (const e of contexto.evidencias.slice(0, 24)) {
    if (!(e?.campo === 'meta.description' || e.tipo==='organizacao'&&/^jsonld\.\w+\.description$/.test(e?.campo || '')) || typeof e.trecho !== 'string'||e.trecho.length<20) continue;
    const evidencia = evidenciaSegura({termo:e.trecho, evidencia:e}, dominio);
    if (evidencia) return {texto:e.trecho.slice(0, 600), url:evidencia.url, campo:evidencia.campo,
      coletadoEm:evidencia.coletadoEm, sha256:evidencia.sha256};
  }
  return null;
}

function perguntasDoPerfil(perfil) {
  const perguntas = [];
  const social=perfil.entendimento?.finalidade?.tipo==='social';
  if (!perfil.publico?.trim()) perguntas.push({id: 'publico', pergunta: social?'Quem é beneficiado, quem participa e quem apoia as atividades?':'Quem compra suas ofertas e quem recebe o serviço ou produto?',
    motivo: 'O público e o comprador podem ser diferentes; isso muda a intenção das buscas relevantes.'});
  if (!perfil.entendimento || perfil.entendimento.papel === 'indefinido' || perfil.entendimento.natureza === 'hipotese') {
    perguntas.push({id: 'papel', pergunta: social?'Quais atividades são programas sociais e existe alguma venda ou intermediação?':'A empresa presta o serviço, vende o produto ou faz a intermediação?',
      motivo: 'A descrição do site é um ponto de partida e precisa da confirmação de quem conhece o negócio.'});
  }
  if (!perfil.regioes?.length) perguntas.push({id: 'regioes', pergunta: 'Quais regiões a empresa consegue atender?',
    motivo: 'Uma região mencionada numa palavra não comprova a área de atendimento.'});
  if (perfil.ofertas.some(o => o.economia?.contribuicaoPorVenda == null || o.economia?.taxaFechamento == null)) {
    perguntas.push({id: 'economia', pergunta: 'Se souber, qual contribuição fica por venda e que proporção dos contatos fecha?',
      motivo: 'Resposta opcional para cenários declarados; esses valores não podem ser deduzidos do volume de buscas.'});
  }
  return perguntas.slice(0, 4);
}

/** Deterministic starting profile: published declarations still require owner review. */
export function inferirPerfil({dominio, descoberta = {}, coletadoEm = null, contextoPublico = null}) {
  const host = normalizarSite(dominio);
  const publicados = Array.isArray(descoberta.candidatos) ? descoberta.candidatos.slice(0, 100) : [];
  const contextuais = [...candidatosContextuais(contextoPublico, host),...candidatosDeDeclaracoes(contextoPublico,host)];
  const mediacoes = mediacoesPublicadas(contextoPublico, host);
  const candidatosDeMediacao=candidatosMediados(mediacoes);
  const paginaDosOrcamentos=mediacoes.find(m=>m.forma==='comparacao_de_orcamentos')?.evidencia.url;
  const explicitamentePublicados=[...contextuais,...publicados].filter(c=>!paginaDosOrcamentos||
    c.evidencia?.url!==paginaDosOrcamentos||c.tipo==='marca'||c.declaracaoTransacional||
    /^(?:jsonld\.|schema:)(?:Service|Product)\.name$/u.test(c.evidencia?.campo||'')||
    c.evidencia?.campo==='p'&&/^(?:prestamos|fabricamos|oferecemos|entregamos)\b/u.test(normal(c.evidencia.trecho)));
  const candidatos = [...explicitamentePublicados,...candidatosDeMediacao];
  const finalidade=finalidadePublicada(contextoPublico,host);
  const marca = candidatos.find(c => c.tipo === 'marca' && typeof c.termo === 'string' && evidenciaSegura(c, host));
  const nomeOrganizacao = contextoPublico?.dominio === host && contextoPublico.evidencias?.find(e =>
    e.tipo==='organizacao'&&/^jsonld\.\w+\.name$/.test(e.campo || '') && typeof e.trecho === 'string' && e.trecho.length <= 120 && evidenciaSegura({termo:e.trecho, evidencia:e}, host));
  const elegiveis = [], vistas = new Set();
  for (const candidato of candidatos) {
    if (!['servico', 'produto'].includes(candidato?.tipo) || typeof candidato.termo !== 'string' || candidato.termo.length > 120) continue;
    const nome = candidato.termo.trim();
    const tituloCompleto=contextoPublico?.dominio===host&&candidato.evidencia?.campo==='title'&&contextoPublico.evidencias?.find(e=>e.campo==='title'&&e.url===candidato.evidencia.url&&evidenciaContemExpressao(nome,e.trecho));
    const contextualizado=tituloCompleto?{...candidato,evidencia:{...tituloCompleto}}:candidato;
    const evidencia = evidenciaSegura(contextualizado, host);
    if (!nome || !evidencia || fragmentoSemObjetoComercial(contextualizado)||naturezaDaAtuacao(candidato,finalidade) !== 'oferta' || condicaoDeCortesia(candidato,contextoPublico,host) || vistas.has(normal(nome))) continue;
    vistas.add(normal(nome));
    elegiveis.push({id: idOferta(host, nome), nome, url: candidato.urlNaoIdentificada ? null : evidencia.url, origem: 'site', evidencias: [evidencia],
      centralidade:centralidadeDaOferta({...candidato,evidencia},contextoPublico,host),
      economia: {contribuicaoPorVenda: null, taxaFechamento: null}});
  }
  const ordemCentralidade={principal:0,indefinida:1,complementar:2};
  elegiveis.sort((a,b)=>ordemCentralidade[a.centralidade.nivel]-ordemCentralidade[b.centralidade.nivel]);
  const ofertas = elegiveis.slice(0, MAX_OFERTAS);
  const descricao = descricaoPublicada(contextoPublico, host);
  const entendimento = inferirEntendimentoNegocio({dominio:host,ofertas,candidatos,contextoPublico,mediacoes});
  if (descricao) entendimento.descricaoPublicada = descricao;
  const abertura = entendimento.papel === 'intermediacao'
    ? 'As declarações publicadas sugerem que a empresa atua na intermediação. '
    : '';
  const perfil = {
    versao: 1, dominio: host, estado: 'rascunho', nome: marca?.termo.slice(0, 120) || nomeOrganizacao?.trecho || host,
    resumo: descricao ? `${abertura}Na descrição publicada, o site apresenta: “${descricao.texto}”.${ofertas.length ? ' Nomes de ofertas a revisar: '+ofertas.slice(0, 3).map(o=>o.nome).join('; ')+'.' : ''} Confirme o entendimento e descreva o que faltar.`
      : entendimento.finalidade.tipo==='social' ? `Os trechos publicados sugerem uma finalidade social.${entendimento.proposito?' A organização publica: “'+entendimento.proposito.texto+'”.':''} Confirme o propósito, os beneficiários e as atividades; programas e doações não são ofertas de venda por si só.`
      : ofertas.length ? `${abertura}O conteúdo consultado menciona: ${ofertas.map(o => o.nome).join('; ')}. Confirme quais destas ofertas fazem parte do negócio.` : 'A leitura não identificou ofertas com evidência suficiente. Descreva o negócio e suas ofertas para continuar.',
    publico: '', regioes: [], exclusoes: [], ofertas, entendimento,
    coletadoEm: typeof coletadoEm === 'string' && Number.isFinite(Date.parse(coletadoEm)) ? coletadoEm : null,
    cobertura: {...(objeto(descoberta.cobertura) ? descoberta.cobertura : {}), ofertasIdentificadas: ofertas.length,
      ofertasElegiveis:elegiveis.length, ofertasLimitadas:elegiveis.length>MAX_OFERTAS,
      limitada:Boolean(descoberta.cobertura?.limitada || contextoPublico?.cobertura?.limitada || elegiveis.length>MAX_OFERTAS),
      evidenciasContextuais: contextoPublico?.dominio === host ? contextoPublico.evidencias?.length || 0 : 0},
    limites: [
      'Este perfil inicial usa regras sobre termos publicados; não é uma compreensão completa ou confirmada do negócio.',
      'A leitura cobre somente as páginas acessíveis dentro dos limites do coletor. Uma oferta não encontrada pode existir em outras páginas.',
      'Nomes de artistas, marcas ou temas publicados não demonstram representação, exclusividade ou um serviço contratado.',
      'Correções atualizam o contexto da análise local. Elas não treinam automaticamente a IA nem são enviadas para treinamento.',
      'Valores comerciais permanecem desconhecidos até serem informados. A contribuição por venda é a receita da própria empresa menos custos variáveis; em intermediação, considere a comissão, não o valor integral do contrato.',
      'Descrições publicadas ajudam a revisar o negócio. Nomes recuperados de títulos e dados estruturados preservam o trecho literal; publicidade da própria empresa não é validação independente.',
      'Públicos sugeridos são grupos citados pelo site, não confirmação de quem paga. Beneficiários, participantes e apoiadores podem ter jornadas distintas.',
      'Importância principal ou complementar é uma hipótese sobre o negócio e pode ser corrigida. Ela não mede volume de busca, posição, rentabilidade ou prioridade de anúncio.',
    ],
  };
  perfil.perguntas = perguntasDoPerfil(perfil);
  return perfil;
}

/** Corrections are trusted as owner declarations, never relabelled as observations. */
export function corrigirPerfil(anterior, entrada) {
  campos(entrada, ['nome', 'resumo', 'publico', 'regioes', 'exclusoes', 'ofertas', 'papel', 'finalidade', 'atuacoes', 'confirmado'], 'Envie apenas os campos editáveis do perfil.');
  if (!objeto(anterior) || anterior.versao !== 1 || !Array.isArray(anterior.ofertas)) falhar('O perfil anterior não pôde ser validado.');
  const dominio = normalizarSite(anterior.dominio);
  if (Object.hasOwn(entrada, 'confirmado') && typeof entrada.confirmado !== 'boolean') falhar('Confirme o perfil com verdadeiro ou falso.');
  const perfil = structuredClone(anterior);
  if (!perfil.entendimento) perfil.entendimento = {versao:2,papel:'indefinido', natureza:'hipotese', evidencias:[]};
  if (Object.hasOwn(entrada, 'papel')) {
    if (!PAPEIS.has(entrada.papel)) falhar('Escolha um papel válido para o negócio.');
    perfil.entendimento = {...perfil.entendimento,papel: entrada.papel, natureza: 'declaracao_usuario', evidencias: []};
  }
  if(Object.hasOwn(entrada,'finalidade')) {
    if(!FINALIDADES.has(entrada.finalidade))falhar('Escolha uma finalidade válida para a organização.');
    perfil.entendimento.finalidade={tipo:entrada.finalidade,natureza:'declaracao_usuario',evidencias:[]};
  }
  for (const [campo, maximo] of [['nome', 120], ['resumo', 1600], ['publico', 500]]) {
    if (Object.hasOwn(entrada, campo)) perfil[campo] = texto(entrada[campo], campo, maximo, campo !== 'nome');
  }
  if (Object.hasOwn(entrada, 'regioes')) perfil.regioes = lista(entrada.regioes, 'regiões', 5, 100);
  if (Object.hasOwn(entrada, 'exclusoes')) perfil.exclusoes = lista(entrada.exclusoes, 'exclusões', 15, 100);
  if(Object.hasOwn(entrada,'atuacoes')) {
    if(!Array.isArray(entrada.atuacoes)||entrada.atuacoes.length>8)falhar('Cadastre até oito atividades não comerciais.');
    const vistas=new Set(),anteriores=Array.isArray(anterior.entendimento?.atuacoes)?anterior.entendimento.atuacoes:[];
    const naoComerciais=entrada.atuacoes.map(item=>{
      campos(item,['tipo','nome','url'],'Cada atividade aceita apenas tipo, nome e página.');
      if(!ATUACOES.has(item.tipo))falhar('Escolha programa social, captação ou participação.');
      const nome=texto(item.nome,'nome da atividade',120,false),url=urlOferta(item.url,dominio),id=idAtuacao(dominio,item.tipo,nome);
      if(vistas.has(id))falhar('Remova atividades repetidas.');
      vistas.add(id);
      const antiga=anteriores.find(a=>a.tipo===item.tipo&&a.nome===nome&&a.url===url);
      return {id,tipo:item.tipo,nome,url,natureza:'declaracao_usuario',evidencias:structuredClone(antiga?.evidencias||[])};
    });
    perfil.entendimento.atuacoes=[...(perfil.entendimento.atuacoes||[]).filter(a=>a.tipo==='oferta'),...naoComerciais];
  }
  if (Object.hasOwn(entrada, 'ofertas')) {
    if (!Array.isArray(entrada.ofertas) || entrada.ofertas.length > MAX_OFERTAS) falhar(`Cadastre até ${MAX_OFERTAS} ofertas.`);
    const vistos = new Set();
    perfil.ofertas = entrada.ofertas.map(item => {
      campos(item, ['id', 'nome', 'url', 'economia','centralidade','jornada','premissasEconomicas','entrega'], 'Revise os campos da oferta, jornada e premissas comerciais.');
      const nome = texto(item.nome, 'nome da oferta', 120, false), id = idOferta(dominio, nome);
      if (vistos.has(id)) falhar('Remova ofertas repetidas.');
      vistos.add(id);
      if (Object.hasOwn(item, 'id') && (typeof item.id !== 'string' || !anterior.ofertas.some(o => o.id === item.id))) falhar('A identificação de uma oferta não pertence a este perfil.');
      const antiga = anterior.ofertas.find(o => o.id === id && normal(o.nome) === normal(nome));
      const url = Object.hasOwn(item, 'url') ? urlOferta(item.url, dominio) : antiga?.url ?? null;
      const valores = Object.hasOwn(item, 'economia') ? economia(item.economia, antiga?.economia) : economia({}, antiga?.economia);
      const jornada=Object.hasOwn(item,'jornada')?normalizarJornada(item.jornada):antiga?.jornada;
      const entrega=Object.hasOwn(item,'entrega')?normalizarEntregaOferta(item.entrega):antiga?.entrega;
      let premissas=antiga?.premissasEconomicas;
      if(Object.hasOwn(item,'premissasEconomicas')){
        try{premissas=normalizarPremissasEconomicas(item.premissasEconomicas,{ofertaId:id});}
        catch(e){falhar(e.message);}
      }
      let centralidade=antiga&&antiga.nome===nome&&antiga.url===url?structuredClone(antiga.centralidade):undefined;
      if(Object.hasOwn(item,'centralidade')) {
        if(!CENTRALIDADES.has(item.centralidade))falhar('Escolha importância principal, complementar ou indefinida.');
        centralidade={nivel:item.centralidade,natureza:'declaracao_usuario',motivos:['Importância informada pelo usuário'],evidencias:[]};
      }
      const preservada = antiga && antiga.nome === nome && antiga.url === url && JSON.stringify(antiga.economia) === JSON.stringify(valores);
      return {id, nome, url, origem: preservada ? antiga.origem : 'usuario',
        evidencias: antiga && antiga.url === url ? structuredClone(antiga.evidencias || []) : [],
        ...(centralidade?{centralidade}:{}),economia: valores,
        ...(jornada?{jornada:structuredClone(jornada)}:{}),...(entrega?{entrega:structuredClone(entrega)}:{}),...(premissas?{premissasEconomicas:structuredClone(premissas)}:{})};
    });
  }
  // Every edit needs an explicit confirmation in this request. An old confirmation
  // cannot silently certify a new offer or a changed business description.
  perfil.estado = entrada.confirmado === true ? 'confirmado' : 'rascunho';
  if (perfil.estado === 'confirmado' && !perfil.ofertas.length && !perfil.entendimento.atuacoes?.some(a=>ATUACOES.has(a.tipo))) falhar('Inclua ao menos uma oferta ou atividade para confirmar o negócio.');
  perfil.origemRevisao = 'usuario';
  if (!perfil.entendimento) perfil.entendimento = {papel:'indefinido', natureza:'hipotese', evidencias:[]};
  if (perfil.entendimento.natureza === 'hipotese' && Object.hasOwn(entrada, 'ofertas') &&
      JSON.stringify(perfil.ofertas.map(o => [o.nome, o.url])) !== JSON.stringify(anterior.ofertas.map(o => [o.nome, o.url]))) {
    // A changed list cannot keep a stale site-derived business interpretation.
    perfil.entendimento = {...perfil.entendimento,papel:'indefinido', natureza:'hipotese', evidencias:[]};
  }
  if(Object.hasOwn(entrada,'ofertas')||Array.isArray(perfil.entendimento.atuacoes)) {
    const atividades=(perfil.entendimento.atuacoes||[]).filter(a=>a.tipo!=='oferta');
    perfil.entendimento.atuacoes=[...perfil.ofertas.map(o=>({id:idAtuacao(dominio,'oferta',o.nome),tipo:'oferta',nome:o.nome,url:o.url,
      natureza:o.origem==='usuario'?'declaracao_usuario':'hipotese',evidencias:structuredClone(o.evidencias||[])})),...atividades];
  }
  perfil.perguntas = perguntasDoPerfil(perfil);
  return perfil;
}
