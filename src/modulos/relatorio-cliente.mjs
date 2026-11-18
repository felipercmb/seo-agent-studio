import {normalizarSite} from '../consulta.mjs';
import {normalizarDemanda} from './demanda.mjs';
import {construirMapaInvestigacao} from './mapa-investigacao.mjs';

const MAX_TAREFAS = 64;
const lista = valor => Array.isArray(valor) ? valor : [];
const texto = (valor, maximo = 2000) => typeof valor === 'string'
  ? valor.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, maximo) : '';
const escapar = valor => texto(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/[\\`*_{}\[\]()#+!|\-.]/g, '\\$&');
const inteiro = valor => Number.isSafeInteger(valor) && valor >= 0;
function instante(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(valor)) return null;
  const numero = Date.parse(valor);
  if (!Number.isFinite(numero)) return null;
  return new Date(numero).toISOString().slice(0, 19) === valor.slice(0, 19) ? numero : null;
}
const data = valor => instante(valor) === null ? 'não informada' : new Date(valor).toISOString();
function urlSegura(valor) {
  try {
    if (typeof valor !== 'string' || valor.length > 2048) return null;
    const url = new URL(valor);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash) return null;
    normalizarSite(url.href);
    return url;
  } catch { return null; }
}
function link(valor) {
  const url = urlSegura(valor);
  if (!url) return null;
  const destino = url.href.replace(/[()\[\]<>"'\s]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return '[' + escapar(url.hostname + url.pathname) + '](' + destino + ')';
}
function unicas(valores, chave) {
  const mapa = new Map();
  for (const valor of valores) if (!mapa.has(chave(valor))) mapa.set(chave(valor), valor);
  return [...mapa.values()];
}
const chaveEvidencia = e => JSON.stringify([e?.url, e?.verificacaoId, e?.trecho, e?.coletadoEm, e?.fonte, e?.sha256,e?.tipo,e?.campo,e?.natureza]);
const origemCampo = origem => ({trecho_publicado:'trecho publicado a conferir',declaracao_usuario:'declarado pelo usuário',perfil_revisado:'perfil revisado',hipotese_controlada:'caso proposto e fictício para testar; não é necessidade observada do cliente',a_confirmar:'a confirmar'}[origem] || 'origem a confirmar');
function criterioPublico(item) {
  const nomes={atividade_revisada:'Revisão da atividade',importancia_no_negocio:'Importância na atuação',declaracao_publicada_atual:'Fonte pública recente',intencao_da_busca:'Intenção da busca',retorno_comercial:'Retorno comercial',base_da_tarefa:'Base da tarefa',execucao_local:'Execução'};
  const valores={perfil_confirmado:'perfil confirmado',rascunho:'rascunho',principal:'principal',complementar:'complementar',indefinida:'a esclarecer',disponivel:'disponível',nao_identificada_nesta_pagina:'não identificada nesta página',comercial:'possível intenção comercial',informacional:'informacional',navegacional:'navegacional',nao_classificada:'a esclarecer',nao_medido:'não medido',achado_registrado:'achado registrado',conferencia_proposta:'conferência proposta',sem_servico_pago:'sem serviço pago'};
  if(!Object.hasOwn(nomes,item?.criterio)||!Object.hasOwn(valores,item?.valor))return null;
  return nomes[item.criterio]+': '+valores[item.valor]+(item.natureza==='declaracao_usuario'?' (declaração do usuário)':item.natureza==='hipotese'?' (hipótese)':'');
}
function tarefasUnicas(valores) {
  const mapa = new Map();
  for (const tarefa of lista(valores).slice(0, 512)) {
    if (!tarefa || typeof tarefa !== 'object' || !texto(tarefa.titulo) || !texto(tarefa.acao)) continue;
    const chave = JSON.stringify([texto(tarefa.tipo), texto(tarefa.titulo), texto(tarefa.acao), urlSegura(tarefa.paginaAlvo?.url)?.href || null,
      texto(tarefa.experimento?.tipo),texto(tarefa.experimento?.ofertaId)]);
    if (!mapa.has(chave)) mapa.set(chave, {...tarefa, passos:[], ofertasAfetadas:[], atuacoesRelacionadas:[], evidencias:[]});
    const registro = mapa.get(chave);
    if (tarefa.base === 'observacao') registro.base = 'observacao';
    if (!texto(registro.criterioSucesso) && texto(tarefa.criterioSucesso)) registro.criterioSucesso = tarefa.criterioSucesso;
    if (!texto(registro.comoValidar) && texto(tarefa.comoValidar)) registro.comoValidar = tarefa.comoValidar;
    registro.passos = unicas([...registro.passos, ...lista(tarefa.passos)].map(v => texto(v)).filter(Boolean), v => v).slice(0, 12);
    registro.ofertasAfetadas = unicas([...registro.ofertasAfetadas, ...lista(tarefa.ofertasAfetadas)]
      .filter(o => texto(o?.nome)), o => texto(o.nome)).slice(0, 8);
    registro.atuacoesRelacionadas=unicas([...registro.atuacoesRelacionadas,...lista(tarefa.atuacoesRelacionadas)].filter(a=>texto(a?.nome)),a=>JSON.stringify([a.tipo,a.nome])).slice(0,8);
    registro.evidencias = unicas([...registro.evidencias, ...lista(tarefa.evidencias),...lista(tarefa.evidenciasNegocio),...lista(tarefa.decisaoCliente?.fatos).slice(0,8).flatMap(f=>lista(f?.evidencias).slice(0,3))]
      .filter(e => e && typeof e === 'object' && texto(e.trecho) && (urlSegura(e.url) || texto(e.fonte))), chaveEvidencia).slice(0, 12);
  }
  return [...mapa.values()];
}
function observacoesValidas(projeto, referencia) {
  if (referencia === null) return [];
  return lista(projeto.oportunidades?.itens).slice(0, 100).flatMap(item => {
    const o = item?.observado;
    const encontrada = o?.estado === 'encontrado' && Number.isInteger(o.posicao) && o.posicao >= 1 && o.posicao <= 100;
    const ausente = o?.estado === 'nao_encontrado_no_recorte' && o.posicao === null;
    if (!texto(item?.termo) || !encontrada && !ausente) return [];
    const e = lista(item.evidencias).find(e => {
      const momento = instante(e?.coletadoEm);
      return e?.tipo === 'google' && texto(e.fonte) && momento !== null && momento <= referencia && referencia - momento < 3600_000;
    });
    return e ? [{item, evidencia:e, encontrada}] : [];
  });
}

/** Receives a server-validated project and makes a local Markdown plan.
 * No network requests, arbitrary object serialization or financial field export. */
export function criarRelatorioCliente(projeto) {
  if (projeto?.versao !== 1 || !projeto.perfil || typeof projeto.perfil !== 'object' ||
      !Number.isSafeInteger(projeto.revisao) || projeto.revisao < 1) throw new Error('Projeto incompatível para exportação.');
  const dominio = normalizarSite(projeto.dominio);
  const perfil = projeto.perfil;
  const referencia = instante(projeto.avaliadoEm) ?? instante(projeto.geradoEm);
  const tarefas = tarefasUnicas(projeto.prioridades?.tarefasDisponiveis || projeto.oportunidades?.planoDeAcao);
  const observacoes = observacoesValidas(projeto, referencia);
  const demanda = referencia === null ? normalizarDemanda(null) : normalizarDemanda(projeto.demanda, {agora:() => referencia});
  const cobertura = projeto.descoberta?.cobertura;
  const paginas = inteiro(cobertura?.paginasLidas) ? cobertura.paginasLidas : null;
  const limitePaginas = inteiro(cobertura?.limitePaginas) && cobertura.limitePaginas > 0 ? cobertura.limitePaginas : null;
  const palavras = Array.isArray(projeto.palavras?.candidatos) ? projeto.palavras.candidatos.length : null;
  const linhas = [];
  const adicionar = (...partes) => linhas.push(...partes);
  const fonteDoEntendimento=e=>{
    if(!link(e?.url)||!texto(e?.trecho))return;
    const hash=typeof e.sha256==='string'&&/^[a-f0-9]{64}$/.test(e.sha256)?e.sha256:null;
    adicionar('  - Referência: '+escapar(e.trecho)+'. Fonte: '+link(e.url)+'. Leitura: '+data(e.coletadoEm)+(hash?'. SHA-256: '+hash:'')+'.');
  };
  adicionar('# Plano de trabalho para ' + escapar(perfil.nome || dominio), '',
    'Site: ' + escapar(dominio), '',
    'Revisão ' + projeto.revisao + '. Data da avaliação: ' + (referencia === null ? 'não informada' : new Date(referencia).toISOString()) + '.', '',
    'Perfil: ' + (perfil.estado === 'confirmado' ? 'confirmado pelo usuário desta instalação.' : 'rascunho que precisa de revisão do responsável pelo negócio.'), '',
    '## Entendimento do negócio', '', escapar(perfil.resumo), '');
  if (texto(perfil.publico)) adicionar('Público informado: ' + escapar(perfil.publico) + '.', '');
  if (lista(perfil.regioes).length) adicionar('Regiões informadas: ' + perfil.regioes.map(escapar).join('; ') + '.', '');
  const finalidade=perfil.entendimento?.finalidade;
  if(finalidade?.tipo)adicionar('Finalidade: '+escapar(finalidade.tipo)+
    (finalidade.natureza==='declaracao_usuario'?' (declarada pelo usuário).':' (hipótese da leitura pública a revisar).'),'');
  const proposito=perfil.entendimento?.proposito;
  if(texto(proposito?.texto)){adicionar('Propósito proposto a partir do site (a revisar): '+escapar(proposito.texto),'');lista(proposito.evidencias).slice(0,3).forEach(fonteDoEntendimento);adicionar('');}
  const territorios=lista(perfil.entendimento?.territorios).filter(t=>texto(t?.texto)).slice(0,6);
  if(territorios.length){adicionar('Territórios citados na atuação (não identificam público humano nem confirmam região de atendimento comercial):','');for(const t of territorios){adicionar('- '+escapar(t.texto));lista(t.evidencias).slice(0,3).forEach(fonteDoEntendimento);}adicionar('');}
  const atividades=lista(perfil.entendimento?.atuacoes).filter(a=>a?.tipo!=='oferta' && texto(a?.nome)).slice(0,8);
  if(atividades.length)adicionar('Atividades não comerciais registradas: '+atividades.map(a=>escapar(a.nome)).join('; ')+'.','');
  const regras=perfil.entendimento?.condicoesPorAtividade;
  if(lista(regras?.itens).length){
    adicionar('Requisitos publicados por atividade (interpretações a revisar):','');
    for(const x of regras.itens.slice(0,12)){adicionar('- '+escapar(x.fraseLiteral),'  A conferir: '+escapar(x.pergunta));fonteDoEntendimento(x.fonte);}
    for(const c of lista(regras.comparacoes)){adicionar(escapar(c.proposta));for(const caso of lista(c.casosFicticios))adicionar('- Caso fictício “'+escapar(caso.atividade)+'”: '+escapar(caso.verificar));}adicionar('');
  }
  const nominais=lista(perfil.entendimento?.atribuicoesNominais?.itens).slice(0,12);
  if(nominais.length){
    adicionar('Atribuições nominais publicadas (interpretações a revisar; não confirmam execução ou responsabilidade jurídica):','');
    for(const n of nominais){adicionar('- '+escapar(n.fraseLiteral),'  Objeto: '+escapar(n.objeto?.texto)+'. Parte citada: '+escapar(n.ator?.texto)+'. Marcador literal: '+escapar(n.marcador?.texto)+'.','  A conferir: '+escapar(n.pergunta));fonteDoEntendimento(n.fonte);}adicionar('');
  }
  const relacoes=lista(perfil.entendimento?.relacoes).filter(r=>texto(r?.texto)).slice(0,6);
  if(relacoes.length){
    adicionar('Relações de atuação propostas a partir do site (hipóteses, sem confirmação jurídica ou financeira):','');
    for(const r of relacoes){
      adicionar('- '+escapar(r.texto)+(r.recortado?' (trecho recortado; conferir a declaração completa).':''));
      lista(r.evidencias).slice(0,3).forEach(fonteDoEntendimento);
    }
    adicionar('');
  }
  const descricao = perfil.entendimento?.descricaoPublicada;
  if (texto(descricao?.texto) && link(descricao.url)) adicionar('Descrição publicada de referência: ' + escapar(descricao.texto), '',
    'Fonte: ' + link(descricao.url) + '. Leitura: ' + data(descricao.coletadoEm) + '.', '');
  const mapa=construirMapaInvestigacao(projeto,{agora:()=>referencia??Date.now()});
  if(mapa.porOferta.length){
    adicionar('## Ofertas, responsabilidades e buscas a investigar', '',
      'O perfil e as responsabilidades abaixo são declarações desta instalação. A confirmação não comprova intenção de busca, execução real ou retorno comercial. Esta seleção não altera a fila de medição e não recomenda verba.', '');
    for(const oferta of mapa.porOferta){
      const original=lista(perfil.ofertas).find(o=>o.id===oferta.ofertaId),j=original?.jornada;
      adicionar('### '+escapar(oferta.nome),'');
      if(oferta.entrega){const tipos={software:'software ou plataforma',servico:'serviço',produto:'produto',indefinido:'a esclarecer'},papeis={disponibiliza:'disponibiliza a ferramenta ou oferta',executa:'executa a atividade descrita',vende:'vende o produto',intermedeia:'intermedeia entre as partes',indefinido:'a esclarecer'};
        adicionar('Tipo desta oferta: '+(tipos[oferta.entrega.tipoOferta]||'a esclarecer')+'. Papel da organização: '+(papeis[oferta.entrega.papelOrganizacao]||'a esclarecer')+' (declarações do usuário). Isso não define quem executa a rotina do cliente.','');}
      for(const [campo,rotulo] of [['objetivo','Necessidade que pretende resolver'],['comprador','Quem solicita ou contrata'],['executor','Quem executa'],['beneficiario','Quem usa ou recebe'],['pagador','Quem paga']]){
        adicionar('- '+rotulo+': '+(j?.natureza==='declaracao_usuario'&&texto(j[campo])?escapar(j[campo])+' (declarado pelo usuário).':'a esclarecer.'));
      }
      adicionar('');if(oferta.pagina)adicionar('Página vinculada no perfil: '+link(oferta.pagina.url)+'. O vínculo não comprova conteúdo ou adequação.','');
      if(oferta.primeirasBuscas.length){
        adicionar('Primeiras expressões para conferir (intenção por regras, como hipótese):','');
        for(const b of oferta.primeirasBuscas)adicionar('- **'+escapar(b.termo)+'** — '+escapar(b.questao)+' Origem: '+(b.origem==='site'?'expressão publicada.':'sugestão a validar.'));
        adicionar('');
      }
      if(oferta.outrasBuscas)adicionar(oferta.outrasBuscas+' outras expressões continuam na seleção completa do projeto.','');
      adicionar(escapar(oferta.proximoPasso),'');
    }
  }
  if(mapa.semVinculo.quantidade)adicionar('Expressões sem vínculo com uma oferta nesta seleção: '+mapa.semVinculo.primeirasBuscas.map(b=>escapar(b.termo)).join('; ')+'. Antes de priorizar aquisição, esclareça se a intenção corresponde ao que a organização oferece. Ausência de vínculo não significa falta de utilidade ou demanda.','');
  adicionar('## Cobertura e dados disponíveis', '',
    '- Leitura pública: ' + (paginas === null ? 'quantidade de páginas não informada.' : paginas + ' página(s)' + (limitePaginas ? ' de um limite de ' + limitePaginas : '') + '.'),
    '- Cobertura da descoberta: ' + (cobertura?.limitada === true ? 'parcial; há limites ou falhas na leitura.' : cobertura?.limitada === false ? 'dentro do recorte informado; isso não representa o site ou o Google inteiro.' : 'não informada.'),
    '- Palavras candidatas: ' + (palavras === null ? 'quantidade não informada.' : palavras + '. São sugestões de investigação, não todas as pesquisas do Google.'),
    '- Posições atuais: ' + (observacoes.some(o => o.encontrada) ? observacoes.filter(o => o.encontrada).length + ' busca(s) com posição observada, no recorte e datas abaixo.' : 'ainda não confirmadas; falta de captura não significa posição zero.'),
    '- Capturas sem o site no recorte: ' + (observacoes.some(o => !o.encontrada) ? observacoes.filter(o => !o.encontrada).length + '. Isso não determina a posição nem demonstra ausência no Google.' : 'nenhuma captura desse tipo confirmada neste relatório.'),
    '- Procura: ' + (demanda.itens.length || demanda.grupos.length ? 'há estimativas históricas com fonte, período e recorte; elas não medem vendas.' : 'não há estimativa válida disponível nesta análise.'), '');
  if (observacoes.length) {
    adicionar('### Observações de busca', '');
    for (const {item, evidencia, encontrada} of observacoes.slice(0, 20)) {
      const contexto = item.observado.contexto || {};
      const recorte = [contexto.pais, contexto.idioma, contexto.dispositivo, contexto.localidade].map(v => texto(v)).filter(Boolean).join('; ');
      adicionar('- **' + escapar(item.termo) + ':** ' + (encontrada ? 'posição ' + item.observado.posicao : 'site não observado nas páginas lidas') +
        '. Fonte: ' + escapar(evidencia.fonte) + '. Captura: ' + data(evidencia.coletadoEm) + (recorte ? '. Recorte: ' + escapar(recorte) : '') + '.');
    }
    adicionar('');
    if (observacoes.length > 20) adicionar('Este resumo inclui vinte observações; o projeto local preserva as demais.', '');
  }
  if (demanda.itens.length || demanda.grupos.length) {
    adicionar('Fonte de procura: ' + escapar(demanda.fonte) + '. Consulta: ' + data(demanda.coletadoEm) + '.', '',
      'Período histórico: ' + escapar(demanda.periodoInicio) + ' a ' + escapar(demanda.periodoFim) +
      '. Recorte: ' + escapar(demanda.pais) + '; ' + escapar(demanda.idioma) + '.', '',
      'Variantes podem compartilhar volume e não são somadas. Estimativa ausente é diferente de zero; o recorte de procura pode agregar dispositivos.', '');
  }
  const pendencias=lista(projeto.prioridades?.pendenciasDeOferta).filter(p=>p?.natureza==='pendencia_de_atribuicao'&&p.recomendacaoComercial===false).slice(0,12);
  if(pendencias.length){
    adicionar('## Publicações com escopo a revisar','','Confira a qual atividade cada trecho se refere. Estas publicações aguardam vínculo com a oferta; não sustentam uma recomendação de edição.','');
    for(const p of pendencias){
      adicionar('### '+escapar(p.ofertaNome||'Oferta a revisar'),'',escapar(p.motivo||'O vínculo entre a publicação e esta oferta precisa de revisão.'),'');
      lista(p.fontesRecusadas).slice(0,4).forEach(fonteDoEntendimento);adicionar('');
      if(lista(p.fontesRecusadas).length>4)adicionar('Quatro trechos apresentados neste resumo; o JSON do projeto preserva os demais.','');
    }
  }
  adicionar('## Tarefas recomendadas', '');
  if (perfil.estado !== 'confirmado') adicionar('Revise o perfil e as ofertas antes de tomar decisões comerciais. O rascunho não confirma as atividades da empresa.', '');
  if (!tarefas.length) adicionar('Ainda não há tarefas operacionais sustentadas para este projeto. Confira a leitura e revise as ofertas; as informações faltantes permanecem desconhecidas.', '');
  for (const [indice, tarefa] of tarefas.slice(0, MAX_TAREFAS).entries()) {
    const observada = tarefa.base === 'observacao' && tarefa.evidencias.length > 0;
    adicionar('### ' + (indice + 1) + '. ' + escapar(tarefa.titulo), '',
      '**Base:** ' + (observada ? 'observação registrada; confira a origem e a data abaixo.' : 'hipótese ou conferência a realizar.'), '', escapar(tarefa.acao), '');
    const eixo={negocio:'Decisão do visitante',tecnico:'Conferência da página',publicacao:'Intenção de publicação',dados:'Dados que faltam',qualificacao:'Confirmar a atuação'}[tarefa.eixo];
    if(eixo)adicionar('Finalidade desta tarefa: '+eixo+'.','');
    const pagina = link(tarefa.paginaAlvo?.url);
    if (pagina) adicionar('Página: ' + pagina + '.', '');
    const relacionadas=unicas(lista(tarefa.paginasRelacionadas).slice(0,4).filter(p=>p?.url!==tarefa.paginaAlvo?.url).map(p=>link(p?.url)).filter(Boolean),p=>p);
    if(relacionadas.length)adicionar('Páginas relacionadas à mesma decisão: '+relacionadas.join('; ')+'.','');
    if (tarefa.ofertasAfetadas.length) adicionar('Ofertas relacionadas: ' + tarefa.ofertasAfetadas.map(o => escapar(o.nome)).join('; ') + '.', '');
    if(tarefa.atuacoesRelacionadas.length)adicionar('Atividades relacionadas: '+tarefa.atuacoesRelacionadas.map(a=>escapar(a.nome)).join('; ')+'.','');
    if(texto(tarefa.lacuna?.descricao))adicionar('Base da investigação: '+escapar(tarefa.lacuna.descricao),'');
    const decisao=tarefa.decisaoCliente;
    if(decisao && typeof decisao==='object'){
      adicionar('**Decisão do visitante a conferir:**','');
      if(texto(decisao.objeto))adicionar('Objeto: '+escapar(decisao.objeto),'');
      if(texto(decisao.objetivo))adicionar('Objetivo: '+escapar(decisao.objetivo),'');
      if(texto(decisao.escolha))adicionar('Escolha: '+escapar(decisao.escolha),'');
      for(const f of lista(decisao.fatos).slice(0,8))if(texto(f?.descricao))adicionar('- Base usada: '+escapar(f.descricao));
      adicionar('');
      for(const escopo of lista(decisao.escoposPorOferta).slice(0,8)){
        if(!texto(escopo?.nome))continue;
        adicionar('Escopo da oferta: '+escapar(escopo.nome),'');const paginaEscopo=link(typeof escopo.pagina==='string'?escopo.pagina:escopo.pagina?.url);
        if(paginaEscopo)adicionar('Fonte do escopo: '+paginaEscopo+'.','');
        for(const f of lista(escopo.fatos).slice(0,4)){if(texto(f?.descricao))adicionar('- Base desse escopo: '+escapar(f.descricao));lista(f?.evidencias).slice(0,2).forEach(fonteDoEntendimento);}
        adicionar('');
      }
      if(lista(decisao.percurso).length){adicionar('Percurso a conferir:','');decisao.percurso.slice(0,8).forEach((p,i)=>{if(texto(p))adicionar((i+1)+'. '+escapar(p));});adicionar('');}
      if(lista(decisao.restricoes).length){adicionar('Condições publicadas a respeitar:','');for(const x of decisao.restricoes.slice(0,8))if(texto(x))adicionar('- '+escapar(x));adicionar('');}
      if(lista(decisao.incertezas).length){adicionar('Ainda precisa confirmar:','');for(const x of decisao.incertezas.slice(0,8))if(texto(x))adicionar('- '+escapar(x));adicionar('');}
      if(texto(decisao.resultadoAConferir))adicionar('Resultado a conferir: '+escapar(decisao.resultadoAConferir),'');
    }
    if(texto(tarefa.entregavel))adicionar('**O que produzir:** '+escapar(tarefa.entregavel),'');
    if(lista(tarefa.modeloEntregavel?.campos).length){adicionar('Rascunho para preencher e revisar:','');
      for(const c of tarefa.modeloEntregavel.campos.slice(0,12))if(texto(c?.rotulo))adicionar('- '+escapar(c.rotulo)+': '+(typeof c.valorSugerido==='string'?escapar(c.valorSugerido):'a preencher')+' ('+origemCampo(c.origem)+').');
      adicionar('');if(texto(tarefa.modeloEntregavel.limite))adicionar(escapar(tarefa.modeloEntregavel.limite),'');}
    if(lista(tarefa.dependencias).length){adicionar('Dependências:','');for(const d of tarefa.dependencias.slice(0,12))if(texto(d?.descricao))adicionar('- '+escapar(d.descricao)+(d.estado==='disponivel'?' (disponível).':' (pendente).'));adicionar('');}
    if(texto(tarefa.esforco?.motivo))adicionar('Esforço estimado, sujeito à revisão: '+escapar(tarefa.esforco.motivo),'');
    const criterios=lista(tarefa.priorizacao?.criterios).slice(0,12).map(criterioPublico).filter(Boolean);
    if(criterios.length){adicionar('Critérios da ordem de trabalho:','');criterios.forEach(c=>adicionar('- '+escapar(c)+'.'));adicionar('');}
    if(texto(tarefa.priorizacao?.limite))adicionar(escapar(tarefa.priorizacao.limite),'');
    for (const [numero, passo] of tarefa.passos.entries()) adicionar((numero + 1) + '. ' + escapar(passo));
    adicionar('');
    adicionar('**Como conferir a conclusão:** ' + escapar(texto(tarefa.criterioSucesso) || texto(tarefa.comoValidar) || 'Registre o resultado desta conferência e os dados faltantes antes de decidir a próxima ação.') + '.', '');
    if (tarefa.evidencias.length) {
      adicionar('Evidências:', '');
      for (const e of tarefa.evidencias) {
        const tipo=e.tipo==='diagnostico'?'Achado derivado do HTML':e.tipo==='interface_publica'||e.natureza==='rotulo_literal'?'Rótulo observado na interface (HTML inicial; ação não executada)':e.tipo==='negocio_publicado'||e.natureza==='trecho_literal'?'Trecho publicado':e.tipo==='google'?'Observação de busca':e.tipo==='google_local'?'Recorte declarado do navegador':'Referência registrada';
        const hash=typeof e.sha256==='string'&&/^[a-f0-9]{64}$/.test(e.sha256)?e.sha256:null;
        const captura=e.tipo==='google_local'&&/^gl1_[a-f0-9]{64}$/u.test(e.fonteId||'')?e.fonteId:null;
        adicionar('- '+tipo+': ' + escapar(e.trecho) + ' Fonte: ' + (link(e.url) || escapar(e.fonte)) + '. Leitura: ' + data(e.coletadoEm) +
          (captura?'. Captura local: '+escapar(captura):texto(e.campo)?'. Origem na página: '+escapar(e.campo):'')+(hash?'. SHA-256 da página/captura: '+hash:'')+'.');
      }
      adicionar('');
    } else adicionar('Evidência desta tarefa: ainda não registrada; a ação permanece uma conferência.', '');
  }
  if (tarefas.length > MAX_TAREFAS || lista(projeto.oportunidades?.planoDeAcao).length > 512) adicionar('Este arquivo contém até 64 tarefas únicas. Consulte o projeto local para ver as demais.', '');
  if(projeto.tarefas?.versao===1){
    adicionar('## Execução registrada', '', 'Registros declarados nesta instalação. Atividade encerrada não significa resultado positivo ou ganho comercial.', '');
    for(const t of lista(projeto.tarefas.itens).slice(0,256)){
      adicionar('- **'+escapar(t.origem?.titulo||t.id)+'**: '+escapar(t.estado)+(t.arquivada?' (arquivada).':'.')+
        (t.responsavel?' Responsável: '+escapar(t.responsavel)+'.':'')+(t.implementadoEm?' Implementação: '+data(t.implementadoEm)+'.':''));
      if(t.verificacao)adicionar('  - Resultado declarado: '+escapar(t.verificacao.resultado)+'. Método: '+escapar(t.verificacao.metodo)+'. Registro: '+escapar(t.verificacao.evidencia)+'.');
    }
    adicionar('');
  }
  const origensPendentes=lista(projeto.prioridades?.pendenciasDeOrigem).filter(f=>f?.recomendacaoComercial===false&&f.atribuicao?.estado==='relato_ou_resultado_de_terceiro').slice(0,12);
  if(origensPendentes.length){
    adicionar('## Relatos de clientes preservados para revisão','','O contexto indica relato ou resultado de cliente; não comprova atividade própria da organização analisada. Essas publicações não sustentam uma recomendação de edição.','');
    for(const f of origensPendentes){adicionar('- Contexto: '+escapar(f.atribuicao.marcador),'- Trecho preservado: '+escapar(f.trecho));const u=urlSegura(f.url);if(u&&normalizarSite(u.href)===dominio)adicionar('- Fonte: '+link(f.url)+'.');if(/^[a-f0-9]{64}$/u.test(f.sha256||''))adicionar('- SHA-256: '+f.sha256+'.');adicionar('');}
  }
  const perguntasPublicadas=lista(projeto.contextoPublico?.perguntasPublicadas).filter(f=>f?.natureza==='resposta_estruturada_publicada').slice(0,12);
  if(perguntasPublicadas.length){
    adicionar('## Respostas já declaradas pelo site','','Respostas encontradas nos dados estruturados das páginas lidas. Visibilidade e alcance ainda precisam de conferência. Elas não confirmam a execução própria ou adequação ao cliente.','');
    for(const f of perguntasPublicadas){
      adicionar('- Pergunta: '+escapar(f.pergunta),'- Resposta publicada: '+escapar(f.trecho));
      const u=urlSegura(f.url);if(u&&normalizarSite(u.href)===dominio)adicionar('- Fonte: '+link(f.url)+'. Coleta: '+data(f.coletadoEm)+'.');
      if(/^[a-f0-9]{64}$/u.test(f.sha256||''))adicionar('- SHA-256 da página: '+f.sha256+'.');adicionar('');
    }
  }
  const capturasLocais=lista(projeto.googleLocal?.capturas).filter(c=>c?.metodo==='captura_declarada_pagina_aberta'&&c.dominio===dominio).slice(-20);
  if(capturasLocais.length){
    adicionar('## Capturas locais do navegador','','Observações declaradas pelo operador. Conteúdo e horário não autenticados pelo Google; não substituem a fonte de posições. A ordem é dos links reconhecidos em cada página, sem posição absoluta.','');
    for(const s of lista(projeto.googleLocal?.sequencias).filter(s=>s?.dominio===dominio).slice(0,12)){
      adicionar('Sequência: '+escapar(s.termo)+'. Páginas distintas: '+s.paginasCapturadas+'; ligadas desde a primeira: '+s.paginasEncadeadas+'.');
      for(const e of lista(s.encontros))adicionar('- Site como '+e.ordemNaPagina+'º link reconhecido na página com início solicitado '+e.inicioSolicitado+'. '+(e.naSequenciaDesdePrimeira?'Na sequência desde a primeira página.':'Página avulsa, sem continuidade demonstrada.'));
      if(lista(s.lacunas).length)adicionar('- Há próxima página indicada ainda sem captura.');
      if(lista(s.conflitos).length)adicionar('- Capturas do mesmo horário têm trechos diferentes; conferir antes de comparar.');
      if(lista(s.linksEmMaisDeUmaPagina).length)adicionar('- Links repetidos entre páginas; ordens não somadas.');
      adicionar('Mesmos parâmetros solicitados em até 15 minutos; localização efetiva desconhecida. Posição absoluta desconhecida.','');
    }
    for(const c of capturasLocais){
      adicionar('- Busca: '+escapar(c.termo)+'. Captura: '+data(c.coletadoEm)+'. '+(c.atual?'Recente no momento desta análise.':'Histórica; não confirma estado atual.'));
      adicionar('  - Início solicitado na URL: '+(inteiro(c.inicioSolicitado)?c.inicioSolicitado:'desconhecido')+'. Ordem do site entre links reconhecidos desta página: '+(Number.isSafeInteger(c.ordemNaPagina)&&c.ordemNaPagina>0?c.ordemNaPagina:'desconhecida')+'.');
      if(typeof c.sha256Trecho==='string'&&/^[a-f0-9]{64}$/u.test(c.sha256Trecho))adicionar('  - SHA-256 do trecho: '+c.sha256Trecho+'.');
      if(!c.termoNaSelecao)adicionar('  - Expressão fora da seleção atual do perfil.');
      for(const x of lista(c.concorrentesAntes).slice(0,10))if(texto(x?.dominio))adicionar('  - Link observado antes nesta página: '+escapar(x.dominio)+'.');
    }
    adicionar('','Uma ausência no trecho, página bloqueada ou layout não reconhecido não determina posição zero nem ausência no Google. Localidade efetiva e personalização permanecem desconhecidas.','');
  }
  adicionar('## Como acompanhar', '',
    'Registre a alteração, a data e a página. Repita a verificação no mesmo contexto e confira o uso com uma pessoa. Contatos qualificados e contratos exigem registros próprios; uma mudança isolada não prova causalidade.', '',
    '## Limites', '',
    'O perfil pode incluir declarações do usuário e do próprio site. Os achados automáticos se limitam ao HTML e às páginas lidas; conteúdo após JavaScript precisa de conferência.', '',
    'Este plano não certifica a causa do ranking, a qualidade completa do site ou um ganho de vendas. Sem gastos, conversões e atribuição não determina desperdício nem redistribuição de orçamento.', '',
    'A exportação resume até vinte observações, 64 tarefas e doze evidências por tarefa. Os detalhes completos permanecem no projeto local.', '',
    'Não inclui os campos financeiros de contribuição e taxa de fechamento. Textos e evidências podem conter valores publicados ou digitados.', '');
  return {versao:1, dominio, revisao:projeto.revisao, formato:'markdown', arquivo:'plano-' + dominio + '-r' + projeto.revisao + '.md', conteudo:linhas.join('\n')};
}
