import {createHash} from 'node:crypto';
import {normalizarSite} from './consulta.mjs';

const HORA = 3600_000, DIA = 24 * HORA;
const CONTEXTO = {pais:'Brasil', idioma:'Português', dispositivo:'Computador', localidade:'Brasil'};
const ORDEM = {priorizar:0, desenvolver:1, proteger:2, investigar:3};
const objeto = v => !!v && typeof v === 'object' && !Array.isArray(v);
const texto = (v, limite = 300) => typeof v === 'string'
  ? v.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g,' ').trim().slice(0,limite) : '';
const chave = v => texto(v,160).normalize('NFC').toLocaleLowerCase('pt-BR');
const normal = v => chave(v).normalize('NFD').replace(/\p{M}/gu,'');
const id = v => createHash('sha256').update(v).digest('hex').slice(0,20);
const hashValido = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const pertence = (host, dominio) => host === dominio || host.endsWith('.' + dominio);
const horario = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) ? Date.parse(v) : NaN;
const recente = (v, agora, prazo) => Number.isFinite(horario(v)) && horario(v) <= agora && agora - horario(v) < prazo;
const fonteId = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(v) ? v : null;

function urlSegura(valor, dominio = null) {
  if (typeof valor !== 'string' || valor.length > 4096 || /[\p{Cc}\p{Cf}\\]/u.test(valor)) return null;
  try {
    const u = new URL(valor);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) return null;
    const host = normalizarSite(u.origin);
    if (dominio && !pertence(host,dominio)) return null;
    if ([...u.searchParams.keys()].some(k => /^(?:api[_-]?key|key|token|access_token|auth|authorization|secret|password|senha)$/i.test(k))) return null;
    u.hash = '';
    return u.href;
  } catch { return null; }
}

function intencao(candidato) {
  const termo = normal(candidato.termo);
  if (candidato.tipo === 'marca') return {tipo:'marca',rotulo:'Procura pela marca',motivo:'O termo foi classificado como marca na descoberta; não mede novos clientes.'};
  if (/^(?:como|o que|por que|porque|quando|guia|tutorial|what|how)\b/.test(termo)) {
    return {tipo:'informativa',rotulo:'Informação — hipótese',motivo:'A formulação sugere uma dúvida ou aprendizado; a intenção real precisa ser conferida nos resultados.'};
  }
  if (/\b(?:contratar|contratacao|comprar|orcamento|preco|agendar|agendamento|cotacao|buy|hire|price|quote)\b/.test(termo)) {
    return {tipo:'comercial',rotulo:'Contratação ou compra — hipótese',motivo:'Há um sinal explícito de contratação, preço ou compra no termo; isso não comprova demanda ou conversão.'};
  }
  if (['servico','produto','local'].includes(candidato.tipo)) return {tipo:'oferta',rotulo:'Relação com uma oferta — hipótese',motivo:'A descoberta relacionou o termo ao conteúdo do site. Confirme se corresponde ao que o negócio realmente oferece.'};
  return {tipo:'indefinida',rotulo:'Intenção a confirmar',motivo:'O conteúdo disponível não determina se a pessoa quer contratar, aprender ou encontrar uma marca.'};
}

function origem(candidato, dominio, agora) {
  const e = candidato.evidencia;
  if (!objeto(e)) return {evidencias:[],url:null,atual:false,motivo:'Falta uma evidência de origem verificável para este candidato.'};
  const url = urlSegura(e.url,dominio), trecho = texto(e.trecho), data = horario(e.coletadoEm);
  if (!url || !trecho || !Number.isFinite(data) || data > agora || !hashValido(e.sha256)) {
    return {evidencias:[],url:null,atual:false,motivo:candidato.origem === 'busca_relacionada'
      ? 'A busca relacionada ainda precisa ser ligada a uma página e oferta do site.'
      : 'A origem do termo não tem URL, trecho, data e identificação de conteúdo válidos.'};
  }
  const atual = recente(e.coletadoEm,agora,DIA);
  return {url,atual,evidencias:[{tipo:'site',url,trecho,coletadoEm:e.coletadoEm,fonte:'HTML público',sha256:e.sha256}],
    motivo:atual ? null : 'A evidência do conteúdo tem mais de 24 horas; releia a página antes de priorizar alterações.'};
}

function contextoValido(contexto) {
  return objeto(contexto) && Object.entries(CONTEXTO).every(([k,v]) => contexto[k] === v);
}

function hashPagina(p) {
  const captura = {termo:p.termo,resultados:p.resultados,inicio:p.inicio,pagina:p.pagina,
    contexto:p.contexto,fonte:p.fonte,coletadoEm:p.coletadoEm,profundidadeObservada:p.profundidadeObservada,
    proximoInicio:p.proximoInicio,paginacaoInterrompida:p.paginacaoInterrompida,
    paginacaoComLacuna:p.paginacaoComLacuna,limiteAtingido:p.limiteAtingido,relacionadas:p.relacionadas};
  return createHash('sha256').update(JSON.stringify(captura)).digest('hex');
}

// Revalidate the original pages, not the UI's summary or competitor array.
// A matching hash detects accidental alteration, not forgery or Google origin.
function verificarConsulta(q, termo, dominio, agora) {
  const invalida = motivo => ({valida:false,posicao:null,url:null,evidencias:[],concorrentes:[],motivo});
  if (!objeto(q) || chave(q.termo) !== chave(termo) || !Array.isArray(q.paginas) || !q.paginas.length) {
    return invalida('Falta uma captura atual do Google para esta busca.');
  }
  if (!['encontrado','nao_encontrado'].includes(q.estado) || q.paginas.length > 5 || !contextoValido(q.contexto)) {
    return invalida('A consulta não contém um contexto ou uma sequência de páginas compatível.');
  }
  const resultados = [], evidencias = [], ids = new Set(), paginasVistas = new Set();
  let inicio = 0;
  for (const [indice,p] of q.paginas.entries()) {
    if (!objeto(p) || chave(p.termo) !== chave(termo) || !recente(p.coletadoEm,agora,HORA) ||
        p.pagina !== indice+1 || p.inicio !== inicio || !contextoValido(p.contexto) ||
        p.fonte?.nome !== 'SerpApi' || !fonteId(p.fonte.id) || ids.has(p.fonte.id) ||
        p.hashEscopo !== 'captura-google-pagina-v1' || !hashValido(p.sha256) ||
        p.paginacaoInterrompida !== false || p.paginacaoComLacuna !== false ||
        typeof p.limiteAtingido !== 'boolean' || !Array.isArray(p.relacionadas) || p.relacionadas.length > 10 ||
        !Array.isArray(p.resultados) || p.resultados.length < 1 || p.resultados.length > 10 ||
        p.profundidadeObservada !== p.resultados.length || hashPagina(p) !== p.sha256) {
      return invalida('A captura está vencida, incompleta ou inconsistente. Atualize a verificação antes de usar uma posição.');
    }
    ids.add(p.fonte.id);
    const identidade = p.resultados.map(r => r?.url).join('\n');
    if (paginasVistas.has(identidade)) return invalida('A sequência repete uma página de resultados e precisa ser verificada novamente.');
    paginasVistas.add(identidade);
    for (const [i,r] of p.resultados.entries()) {
      const url = urlSegura(r?.url);
      if (!objeto(r) || !url || r.pagina !== p.pagina || r.inicio !== p.inicio ||
          r.posicaoNaPagina !== i+1 || r.posicao !== p.inicio+i+1 || r.posicao > 100 ||
          r.dominio !== normalizarSite(url)) return invalida('A posição não corresponde aos resultados da página de origem.');
      resultados.push({...r,url,coletadoEm:p.coletadoEm,fonteId:p.fonte.id});
    }
    evidencias.push({tipo:'google',coletadoEm:p.coletadoEm,fonte:p.fonte.nome,fonteId:p.fonte.id,sha256:p.sha256,
      trecho:`Página ${p.pagina}; deslocamento ${p.inicio}; ${p.resultados.length} resultados orgânicos. Brasil, português, computador.`});
    inicio = p.inicio+p.resultados.length;
    if (indice < q.paginas.length-1 && p.proximoInicio !== inicio) return invalida('Há uma lacuna entre as páginas consultadas.');
  }
  const alvo = resultados.find(r => pertence(r.dominio,dominio));
  if (!alvo) {
    if (q.estado !== 'nao_encontrado' || q.posicao !== null || q.url != null) return invalida('O resumo atribui uma posição sem resultado correspondente.');
    return {valida:true,posicao:null,url:null,evidencias,concorrentes:[],motivo:'O site não foi observado nas páginas lidas. Isso não comprova ausência no Google nem uma posição além do recorte.'};
  }
  if (q.estado !== 'encontrado' || q.posicao !== alvo.posicao || q.pagina !== alvo.pagina ||
      q.posicaoNaPagina !== alvo.posicaoNaPagina || urlSegura(q.url,dominio) !== alvo.url) {
    return invalida('O resumo e a página de origem não concordam sobre a posição do site.');
  }
  const concorrentes = [], vistos = new Set();
  for (const r of resultados) if (r.posicao < alvo.posicao && !pertence(r.dominio,dominio) && !vistos.has(r.dominio)) {
    vistos.add(r.dominio);
    if (concorrentes.length < 5) concorrentes.push({dominio:r.dominio,url:r.url,posicao:r.posicao,coletadoEm:r.coletadoEm,fonteId:r.fonteId});
  }
  return {valida:true,posicao:alvo.posicao,url:alvo.url,evidencias,concorrentes,motivo:null};
}

function paginasDoDiagnostico(diagnostico, dominio, agora) {
  if (!dominio || !objeto(diagnostico) || diagnostico.versao !== 1 || diagnostico.dominio !== dominio ||
      !Array.isArray(diagnostico.paginas) || !Array.isArray(diagnostico.verificacoes)) return new Map();
  const paginas = new Map();
  for (const p of diagnostico.paginas.slice(0,3)) {
    const url = urlSegura(p?.url,dominio);
    if (url && recente(p.coletadoEm,agora,DIA) && hashValido(p.sha256) && p.status === 200) paginas.set(url,p);
  }
  return paginas;
}

function melhoriasDoSite(diagnostico, dominio, agora) {
  const paginas = paginasDoDiagnostico(diagnostico,dominio,agora);
  if (!paginas.size) return [];
  const saida = [], vistos = new Set();
  for (const v of diagnostico.verificacoes.slice(0,50)) {
    if (v?.estado !== 'atencao' || !Array.isArray(v.paginasAfetadas)) continue;
    const url = urlSegura(v.evidencia?.url,dominio), pagina = paginas.get(url);
    // The aggregate diagnosis carries an actual excerpt only for this URL.
    // Do not copy that excerpt to every page in paginasAfetadas.
    if (!pagina || !v.paginasAfetadas.some(u => urlSegura(u,dominio) === url) || !texto(v.titulo) || !texto(v.evidencia.trecho)) continue;
    const identificador = id(texto(v.id,80)+'|'+url);
    if (vistos.has(identificador)) continue;
    vistos.add(identificador);
    saida.push({id:identificador,titulo:texto(v.titulo),paginaAlvo:url,categoria:texto(v.categoria,80),
      orientacao:texto(v.orientacao,600),passos:(Array.isArray(v.passos) ? v.passos : []).slice(0,5).map(p=>texto(p,400)).filter(Boolean),
      coletadoEm:pagina.coletadoEm,evidencia:texto(v.evidencia.trecho)});
    if (saida.length === 6) break;
  }
  return saida;
}

function recomendar(c, origemTermo, consulta, melhorias) {
  const int = intencao(c), posicao = consulta.posicao;
  let decisao = 'investigar', marco = null, motivo = consulta.motivo || origemTermo.motivo;
  if (origemTermo.atual && posicao != null) {
    if (posicao <= 3 || int.tipo === 'marca') {
      decisao='proteger';motivo=int.tipo === 'marca' ? 'Esta busca está ligada à marca; acompanhe sua presença sem confundir essa procura com aquisição de novos clientes.' : 'O site já foi observado entre os três primeiros resultados deste recorte. Preserve o conteúdo útil e monitore mudanças.';
      marco='Preservar a presença observada e a utilidade da página.';
    } else if (['comercial','oferta'].includes(int.tipo)) {
      decisao=posicao<=20 ? 'priorizar' : 'desenvolver';
      motivo=posicao<=20 ? 'Há presença observada e um sinal de relação com a oferta. Vale testar melhorias nesta página depois de confirmar a intenção e a relevância para o negócio.' : 'Há presença observada além da faixa de 20 resultados. Avalie conteúdo e adequação à busca antes de comprometer esforço; a dificuldade não foi medida.';
      marco=posicao<=10 ? 'Testar evolução em direção aos três primeiros resultados, sem garantia de ganho.' : 'Testar evolução em direção aos dez primeiros resultados, sem garantia de ganho.';
    } else motivo='A posição foi observada, mas falta confirmar como esta busca atende ao público e ao objetivo do negócio.';
  }
  if (!origemTermo.atual) motivo=origemTermo.motivo;
  const paginaAlvo = consulta.url || origemTermo.url;
  const acoes = [];
  if (decisao === 'investigar') acoes.push({titulo:'Confirmar a oportunidade antes de investir',base:'hipotese',
    descricao:'Confira se o termo corresponde ao público e à oferta. Complete ou atualize a verificação de posições e registre o que ainda não foi medido.'});
  else acoes.push({titulo:decisao === 'proteger' ? 'Preservar o que já atende à busca' : 'Revisar a resposta da página à busca',base:'hipotese',
    descricao:int.tipo === 'informativa' ? 'Verifique se a página responde à dúvida com informação útil e confiável. Não force uma oferta comercial em toda consulta.' : 'Confira se o título e o conteúdo explicam a oferta, a quem ela atende e o próximo passo. Acrescente apenas informações reais e úteis; não repita termos artificialmente.'});
  for (const m of melhorias.filter(m=>m.paginaAlvo === paginaAlvo).slice(0,2)) acoes.push({titulo:m.titulo,base:'observacao',
    descricao:m.orientacao+' Esta observação trata do uso ou da clareza da página; não demonstra a causa da posição.'});
  if (consulta.concorrentes.length) acoes.push({titulo:'Comparar os resultados que apareceram antes',base:'hipotese',
    descricao:'Abra as URLs registradas e compare intenção atendida, clareza e informações úteis. A posição acima não revela o motivo do ranking; o conteúdo desses sites não foi analisado pelo agente.'});
  const faltam=['Volume de buscas e impressões não medidos.','Cliques, conversões, margem e receita não medidos.'];
  if (origemTermo.motivo) faltam.push(origemTermo.motivo);
  if (consulta.motivo) faltam.push(consulta.motivo);
  if (int.tipo === 'oferta' || int.tipo === 'indefinida') faltam.push('Confirmar a relação do termo com a oferta e o público real.');
  return {id:id(chave(c.termo)),termo:c.termo,paginaAlvo,decisao,intencao:int,posicao,marco,motivo,
    potencial:decisao === 'priorizar' || decisao === 'desenvolver'
      ? 'Potencial qualitativo de visibilidade relevante, condicionado à existência de procura e à conversão da página. O retorno não foi estimado.'
      : decisao === 'proteger' ? 'Preservar visibilidade já observada. Não há medida de receita incremental.'
      : 'Oportunidade ainda não confirmada; reúna evidências antes de estimar resultado.',
    evidencias:[...origemTermo.evidencias,...consulta.evidencias],concorrentes:consulta.concorrentes,acoes,
    medir:['Repetir a mesma busca no mesmo país, idioma e dispositivo e comparar datas e páginas completas.',
      'Se houver dados de analytics, acompanhar cliques ou visitas orgânicas e pedidos qualificados da página, com período e denominadores comparáveis.',
      'Registrar a alteração e fatores externos; uma mudança de posição ou pedidos não prova que a edição causou o resultado.'],faltam:[...new Set(faltam)]};
}

/** Analisa apenas evidências fornecidas. Não consulta Google nem edita o site. */
export function analisarOportunidades(entrada = {}, opcoes = {}) {
  const dados = objeto(entrada) ? entrada : {};
  const agora = new Date(typeof opcoes.agora === 'function' ? opcoes.agora() : Date.now()).getTime();
  if (!Number.isFinite(agora)) throw new TypeError('O relógio da análise é inválido.');
  let dominio = '';
  try { dominio=normalizarSite(dados.dominio); } catch { /* Invalid inputs cannot establish a domain. */ }
  const posicoes = dominio && dados.posicoes?.versao === 2 && dados.posicoes.dominio === dominio ? dados.posicoes : null;
  const melhorias = melhoriasDoSite(dados.diagnostico,dominio,agora);
  const consultas = new Map();
  for (const q of (Array.isArray(posicoes?.consultas) ? posicoes.consultas : []).slice(0,100)) {
    const k=chave(q?.termo);
    if (k) consultas.set(k,consultas.has(k) ? null : q);
  }
  const oportunidades=[], vistos=new Set();
  for (const c of (Array.isArray(posicoes?.candidatos) ? posicoes.candidatos : []).slice(0,100)) {
    const termo=texto(c?.termo,160), k=chave(termo);
    if (!k || termo.length<3 || /[<>@]|https?:\/\//i.test(termo) || vistos.has(k)) continue;
    vistos.add(k);
    const candidato={...c,termo};
    oportunidades.push(recomendar(candidato,origem(candidato,dominio,agora),verificarConsulta(consultas.get(k),termo,dominio,agora),melhorias));
  }
  oportunidades.sort((a,b) => ORDEM[a.decisao]-ORDEM[b.decisao] ||
    (a.intencao.tipo === 'comercial' ? 0 : 1)-(b.intencao.tipo === 'comercial' ? 0 : 1) ||
    (a.posicao??Infinity)-(b.posicao??Infinity) || (chave(a.termo)<chave(b.termo) ? -1 : chave(a.termo)>chave(b.termo) ? 1 : 0));
  const porPagina=new Map();
  for (const o of oportunidades) if (o.paginaAlvo) {
    if (!porPagina.has(o.paginaAlvo)) {
      const acao=o.acoes.find(a=>a.base==='observacao') || o.acoes[0];
      const passo=(acao.base==='observacao' ? 'Uso e clareza: ' : '')+acao.titulo+'. '+acao.descricao;
      porPagina.set(o.paginaAlvo,{id:id(o.paginaAlvo),titulo:o.termo,paginaAlvo:o.paginaAlvo,
        decisao:o.decisao,termos:[],
        motivo:'Foco: “'+o.termo+'”'+(o.posicao!==null ? ', observado na posição '+o.posicao : ', sem posição atual confirmada')+'. '+o.motivo,
        proximoPasso:passo.length>300 ? passo.slice(0,299).replace(/\s+\S*$/,'')+'…' : passo});
    }
    porPagina.get(o.paginaAlvo).termos.push(o.termo);
  }
  const resumo={termosAnalisados:oportunidades.length,posicoesAtuais:oportunidades.filter(o=>o.posicao!==null).length,
    priorizar:0,desenvolver:0,proteger:0,investigar:0};
  for (const o of oportunidades) resumo[o.decisao]++;
  const temLeitura = paginasDoDiagnostico(dados.diagnostico,dominio,agora).size > 0 ||
    posicoes?.descoberta?.paginasLidas > 0 && recente(posicoes.descoberta.coletadoEm,agora,DIA);
  const semRecomendacoes = !oportunidades.length && !melhorias.length;
  return {versao:1,dominio,geradoEm:new Date(agora).toISOString(),metodo:'regras-abertas-v1',
    estado:semRecomendacoes && !temLeitura ? 'sem_dados' : resumo.investigar || !resumo.posicoesAtuais ||
      posicoes?.descoberta?.limitada || dados.diagnostico?.estado === 'parcial' ? 'parcial' : 'disponivel',
    resumo,oportunidades,frentes:[...porPagina.values()].slice(0,12),melhorias,
    limites:[
      'Agente local de regras abertas. Não usa um modelo de linguagem, não faz novas buscas nem altera páginas ou anúncios.',
      'As faixas 1–3, 4–20 e acima de 20 são critérios editoriais para organizar testes; não são regras do Google, probabilidades de sucesso ou medidas de dificuldade.',
      'A intenção e a relação com a oferta são hipóteses. Termos no conteúdo não comprovam procura, vendas ou margem.',
      'Sem impressões, cliques, conversões e valor econômico não é possível estimar tráfego adicional, receita, retorno ou desperdício de anúncios.',
      'Posições são recortes do Google Brasil em português e computador, válidos por até uma hora. Evidências de conteúdo ou diagnóstico com 24 horas precisam de nova leitura para priorizar alterações.',
      'Concorrentes são somente sites observados antes do domínio nas mesmas páginas. O agente não leu seu conteúdo e não identifica por que estão acima.',
      'Melhorias de acessibilidade, atendimento e clareza apoiam o uso do site; estas observações não explicam nem garantem posições no Google.',
      'Frentes agrupam URLs conhecidas, não segmentos de mercado. Mais palavras por página não significa maior potencial; mostramos até 12 frentes e 100 candidatos.',
      'A classificação de cada frente resume o primeiro trabalho sugerido para a URL; as decisões dos outros termos podem diferir. Uma melhoria observada de uso ou clareza pode ser o próximo passo sem explicar a posição no Google.',
      'Hashes identificam conjuntos de dados e permitem verificar integridade local. Não são assinaturas do Google nem validação independente da fonte.',
      ...(temLeitura && semRecomendacoes ? ['Há leitura disponível, mas estas regras não identificaram uma oportunidade ou melhoria comprovada. Isso não certifica o site nem descarta oportunidades fora da cobertura.'] : []),
    ]};
}
