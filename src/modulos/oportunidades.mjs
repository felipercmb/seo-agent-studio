import {analisarOportunidades} from '../agente.mjs';
import {createHash} from 'node:crypto';
import {normalizarSite} from '../consulta.mjs';
import {normalizarDemanda} from './demanda.mjs';
import {especificarTesteNegocio,tarefasDeAtuacoesSociais,planejarDecisaoNegocio} from './plano-negocio.mjs';

const texto = (valor, limite = 160) => typeof valor === 'string'
  ? valor.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, limite) : '';
const chave = valor => texto(valor).normalize('NFC').toLocaleLowerCase('pt-BR');
const termoValido = valor => typeof valor === 'string' && valor.length <= 160 &&
  valor.trim().length >= 3 && !/[\p{Cc}\p{Cf}<>@]|https?:\/\//iu.test(valor);
const CONTEXTO = {pais: 'Brasil', idioma: 'Português', localidade: 'Brasil', dispositivo: 'Computador'};
const ORDEM = {melhorar: 0, investigar: 1, acompanhar: 2, adiar: 3};
const ORDEM_ATIVIDADE={principal:0,indefinida:1,complementar:2};
function centralidadeDaOferta(oferta){
  const c=oferta?.centralidade;
  return {nivel:Object.hasOwn(ORDEM_ATIVIDADE,c?.nivel)?c.nivel:'indefinida',
    natureza:c?.natureza==='declaracao_usuario'?'declaracao_usuario':'hipotese',
    motivos:(Array.isArray(c?.motivos)?c.motivos:[]).slice(0,4).map(m=>texto(m,200)).filter(Boolean),
    limite:'Importância no negócio declarada ou inferida do conteúdo; não mede procura, rentabilidade nem prioridade de anúncio.'};
}

function cenario(oferta, confirmado) {
  // Premissas v1 possuem origem, período e população próprios. O cenário novo
  // fica no módulo por oferta; nunca recuperar valores legados em cada palavra.
  if (oferta && Object.hasOwn(oferta, 'premissasEconomicas')) return null;
  const contribuicao = oferta?.economia?.contribuicaoPorVenda;
  const taxa = oferta?.economia?.taxaFechamento;
  if (!confirmado || typeof contribuicao !== 'number' || !Number.isFinite(contribuicao) ||
      typeof taxa !== 'number' || !Number.isFinite(taxa) || taxa < 0 || taxa > 1 ||
      Math.abs(contribuicao) > Number.MAX_SAFE_INTEGER / 100 || !Number.isFinite(contribuicao * taxa)) return null;
  const valor = Math.round(contribuicao * taxa * 100) / 100;
  return {valor: valor === 0 ? 0 : valor, moeda: 'BRL', natureza: 'cenario_declarado',
    ofertaId: oferta.id, escopo: 'oferta',
    contribuicaoPorVenda: contribuicao, taxaFechamento: taxa,
    explicacao: 'Contribuição por venda × proporção de contatos que fecham. Cenário da oferta, condicionado a contatos com o mesmo perfil das premissas; antes do custo de aquisição e dos custos fixos. Não é receita prevista, margem por clique ou valor comprovado desta palavra.'};
}

function urlDoDominio(valor, dominio, subdominios = false) {
  try {
    if (typeof valor !== 'string' || valor.length > 2048) return null;
    const url = new URL(valor);
    const host = normalizarSite(url.href);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port ||
        url.search || url.hash || host !== dominio && !(subdominios && host.endsWith('.' + dominio))) return null;
    return url.href;
  } catch { return null; }
}

function paginaAlvo(oferta, base, medida, posicao, dominio, instante, consulta) {
  const urlGoogle = medida && posicao !== null && urlDoDominio(base?.paginaAlvo, dominio, true);
  if (urlGoogle) return {url:urlGoogle, origem:'observada', fonte:'Google',
    coletadoEm:consulta?.paginas?.find(p => p.resultados.some(r => r.url === urlGoogle))?.coletadoEm || null};
  const evidencia = base?.evidencias?.find(e => e.tipo === 'site' && urlDoDominio(e.url, dominio) &&
    Number.isFinite(Date.parse(e.coletadoEm)) && Date.parse(e.coletadoEm) <= instante &&
    instante - Date.parse(e.coletadoEm) < 86400_000);
  if (evidencia) return {url:urlDoDominio(evidencia.url, dominio), origem:'observada', fonte:'site', coletadoEm:evidencia.coletadoEm};
  const declarada = urlDoDominio(oferta?.url, dominio);
  return declarada ? {url:declarada, origem:'declarada', fonte:'perfil', coletadoEm:null} : null;
}

function paginaDiagnosticada(diagnostico, url, dominio, instante) {
  if (diagnostico?.versao !== 1 || diagnostico.dominio !== dominio || !Array.isArray(diagnostico.paginas)) return null;
  return diagnostico.paginas.slice(0, 3).find(p => urlDoDominio(p?.url, dominio) === url &&
    p.status === 200 && /^[a-f0-9]{64}$/.test(p.sha256 || '') &&
    typeof p.coletadoEm === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(p.coletadoEm) &&
    Number.isFinite(Date.parse(p.coletadoEm)) && Date.parse(p.coletadoEm) <= instante && instante-Date.parse(p.coletadoEm) < 86400_000) || null;
}

function paginaContextual(contexto,oferta,url,dominio,instante){
  if(contexto?.versao!==1||contexto.dominio!==dominio||!Array.isArray(contexto.cobertura?.paginas))return null;
  const fonte=contexto.cobertura.paginas.slice(0,12).find(p=>urlDoDominio(p?.url,dominio)===url&&
    /^[a-f0-9]{64}$/.test(p.sha256||'')&&typeof p.coletadoEm==='string'&&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(p.coletadoEm)&&
    Number.isFinite(Date.parse(p.coletadoEm))&&Date.parse(p.coletadoEm)<=instante&&instante-Date.parse(p.coletadoEm)<86400_000);
  if(!fonte)return null;
  const evidencias=[...(Array.isArray(oferta?.evidencias)?oferta.evidencias.slice(0,8):[]),
    ...(Array.isArray(contexto.evidencias)?contexto.evidencias.slice(0,24):[]),
    ...(Array.isArray(contexto.detalhesPublicados)?contexto.detalhesPublicados.slice(0,64):[])];
  const literal=evidencias.some(e=>e?.url===url&&e.sha256===fonte.sha256&&e.coletadoEm===fonte.coletadoEm&&
    !e.verificacaoId&&!['diagnostico','google','demanda'].includes(e.tipo)&&
    /^(?:title|meta\.description|h[1-6]|p|li|jsonld\.[A-Za-z]+\.(?:name|description))$/.test(e.campo||'')&&texto(e.trecho,600));
  return literal?fonte:null;
}

function proximoTeste(tipo, acao, pagina, ofertaNome, melhoria = null) {
  const titulos = {confirmar_negocio:'Confirmar o entendimento do negócio', validar_oferta:'Relacionar a busca a uma oferta',
    conferir_intencao:'Conferir quem procura e com qual intenção', validar_economia:'Revisar as premissas comerciais da oferta',
    validar_demanda:'Conferir a procura antes de ampliar esforço', validar_pagina:'Localizar uma página adequada para a oferta',
    medir_posicao:'Completar a medição da oferta', revisar_pagina:'Testar uma melhoria na página existente',
    acompanhar_contatos:'Acompanhar contatos e preservar a presença observada',
    corrigir_uso:'Revisar o ponto observado no uso da página', conferir_oferta:'Conferir a experiência de contratação',
    confirmar_publicacao:'Confirmar a intenção de publicação', reler_pagina:'Atualizar a evidência da página'};
  const passos = melhoria?.passos?.length ? melhoria.passos : {
    confirmar_negocio:['Confira se as ofertas descritas correspondem ao negócio e quem compra cada uma.', 'Corrija o público, a área atendida e as exclusões e confirme o perfil revisado.'],
    validar_oferta:['Identifique qual oferta e qual público esta expressão representa.', 'Vincule a expressão somente à oferta confirmada ou mantenha-a fora do foco de aquisição.'],
    conferir_intencao:['Confira se a pessoa busca contratar, aprender ou encontrar atendimento nesta expressão.', 'Compare essa necessidade com a oferta e registre o próximo passo adequado para esse público.'],
    validar_economia:['Confira a contribuição da própria empresa por venda, após custos variáveis.', 'Registre o período e o perfil dos contatos usados para obter a taxa de fechamento; mantenha a premissa como desconhecida se faltar registro.'],
    validar_demanda:['Confira com a equipe se clientes usam esta expressão e quais variações conhecem.', 'Compare evidências de procura no mesmo recorte quando disponíveis; mantenha variantes agrupadas e não trate zero estimado como ausência de pessoas interessadas.'],
    validar_pagina:['Confira o inventário e abra as páginas já existentes para esta oferta.', 'Vincule a URL que melhor explica a oferta e o caminho de contratação; considere conteúdo novo apenas se as páginas atuais não atenderem à necessidade.'],
    medir_posicao:['Confira se a fonte e a cota gratuita estão disponíveis nesta instalação.', 'Solicite a medição deste plano e preserve país, idioma, dispositivo e data para comparar depois.'],
    revisar_pagina:['Abra a página existente e confira a correspondência entre oferta, público, informações e pedido de orçamento.', 'Escolha uma melhoria útil e registre o que mudou; acompanhe contatos qualificados em períodos comparáveis.'],
    acompanhar_contatos:['Preserve as informações úteis da página e registre a observação atual.', 'Acompanhe contatos qualificados e contratos sem atribuir o resultado a uma mudança isolada de posição.'],
    conferir_oferta:['Abra a página indicada e confira se explica a oferta e quem pode contratar, sem presumir que essa informação está ausente.', 'No celular, confira o caminho de contato/orçamento e se os dados necessários para encaminhar um pedido estão claros. Não envie dados reais sem autorização.', 'Registre as dúvidas encontradas e teste uma melhoria por vez; anote contatos qualificados e contratos em um período definido.'],
    reler_pagina:['Abra a URL declarada e confira se ainda corresponde à oferta.', 'Solicite uma nova leitura do site para atualizar a evidência antes de afirmar um problema ou alterar a página.'],
  }[tipo] || [];
  const criterioSucesso = tipo === 'confirmar_publicacao'
    ? 'O responsável registra se a URL deve ser pública; qualquer alteração posterior é conferida na mesma página e fonte apropriada.'
    : tipo === 'corrigir_uso'
      ? 'A mesma verificação deixa de apontar o achado na URL após a revisão, e uma pessoa confere o uso. Isso não mede ganho de ranking ou vendas.'
      : tipo === 'conferir_oferta'
        ? 'Uma pessoa do público consegue identificar a oferta e o próximo passo de contratação. Dúvidas, mudanças e contatos são registrados; não há meta de tráfego ou vendas inventada.'
        : tipo === 'reler_pagina'
          ? 'Uma leitura atual da URL confirma conteúdo, data e origem suficientes para revisar a oferta; se falhar, a limitação fica registrada.'
          : 'As informações solicitadas são conferidas e registradas com origem e período; o próximo passo pode ser decidido sem inventar dados faltantes.';
  return {tipo, titulo:titulos[tipo], acao,
    base:melhoria ? 'observacao' : 'hipotese', passos, criterioSucesso,
    comoValidar: tipo === 'validar_economia'
      ? 'Confira a contribuição e a taxa de fechamento com registros da própria oferta, em um período e grupo de contatos conhecidos. Separe custos de aquisição e custos fixos.'
      : tipo === 'validar_pagina'
        ? 'Confira o inventário atual e escolha a URL que melhor atende à oferta. Só considere outra página após verificar que as existentes não atendem à intenção; evite páginas duplicadas por variação de palavra.'
        : tipo === 'confirmar_negocio' || tipo === 'validar_oferta' || tipo === 'conferir_intencao'
          ? 'Confirme com a pessoa responsável a oferta, quem contrata e a área atendida. Registre a correção e compare com a intenção dos resultados quando houver captura.'
          : tipo === 'validar_demanda'
            ? 'Atualize a estimativa no mesmo recorte e confronte-a com contatos, consultas ou impressões disponíveis. Zero estimado pode refletir arredondamento ou procura pequena; não prova ausência de pessoas interessadas.'
            : tipo === 'corrigir_uso' || tipo === 'confirmar_publicacao'
              ? 'Repita a verificação da mesma URL e confira a experiência com uma pessoa. O achado é de uso, clareza ou publicação; ele não identifica a causa do ranking nem comprova efeito comercial.'
              : tipo === 'conferir_oferta' || tipo === 'reler_pagina'
                ? criterioSucesso
                : 'Registre a alteração; repita a medição no mesmo recorte e acompanhe contatos qualificados e contratos em períodos comparáveis. Uma variação isolada não prova que a edição causou o resultado.',
    ...(pagina ? {url:pagina.url} : {}), ...(ofertaNome ? {oferta:ofertaNome} : {})};
}

function agruparFrentes(ofertas, itens, confirmado, contexto) {
  return [...ofertas.values()].filter(Boolean).map(oferta => {
    const relacionados = itens.filter(i => i.ofertaId === oferta.id);
    const principal = relacionados[0];
    let pagina = principal?.paginaAlvo || relacionados.find(i => i.paginaAlvo)?.paginaAlvo || null;
    if(!pagina){const url=urlDoDominio(oferta.url,contexto.perfil.dominio);if(url){const leitura=paginaContextual(contexto.contextoPublico,oferta,url,contexto.perfil.dominio,contexto.agora());
      pagina={url,origem:leitura?'observada':'declarada',fonte:leitura?'site':'perfil',coletadoEm:leitura?.coletadoEm||null,...(leitura?{sha256:leitura.sha256,verificacao:'contexto_publico'}:{})};}}
    let teste = principal?.proximoTeste;
    if (!teste) teste = proximoTeste(confirmado ? 'validar_oferta' : 'confirmar_negocio',
      'Revise a descrição da oferta, as exclusões e as palavras elegíveis antes de iniciar uma medição.', pagina, oferta.nome);
    // A missing URL is a mapping task, never an automatic instruction to create
    // one landing page per keyword. Grouping prevents repeated work per synonym.
    if (confirmado && !pagina && ['medir_posicao','revisar_pagina','acompanhar_contatos'].includes(teste.tipo)) {
      teste = proximoTeste('validar_pagina', 'Confira se já existe uma página que explique esta oferta, seu público e o caminho para pedir orçamento. Vincule a URL adequada antes de propor conteúdo novo.', null, oferta.nome);
    }
    if(!teste.categoria)teste=especificarTesteNegocio({teste,perfil:contexto.perfil,oferta,pagina,contextoPublico:contexto.contextoPublico},{agora:contexto.agora});
    const testeNegocio=confirmado?planejarDecisaoNegocio({perfil:contexto.perfil,oferta,pagina,contextoPublico:contexto.contextoPublico},{agora:contexto.agora}):null;
    const bloqueante=['confirmar_publicacao','validar_economia'].includes(teste.tipo);
    const faltam = [...new Set(relacionados.flatMap(i => i.faltam))];
    if (!relacionados.length) faltam.push('Palavras elegíveis e vinculadas a esta oferta no plano atual.');
    return {ofertaId:oferta.id, nome:oferta.nome, paginaAlvo:pagina,
      centralidade:centralidadeDaOferta(oferta),
      prioridade:testeNegocio&&!bloqueante?'investigar':principal?.prioridade || 'investigar',
      motivo:principal?.motivo || 'A oferta está no perfil, mas não há palavras elegíveis vinculadas no plano atual.',
      termos:relacionados.map(i => i.termo),
      resumo:{termosPlanejados:relacionados.length,
        posicoesAtuais:relacionados.filter(i => i.observado.estado !== 'nao_medido').length,
        posicoesEncontradas:relacionados.filter(i => i.observado.posicao !== null).length,
        demandasIndividuais:relacionados.filter(i => i.observado.buscasMensais !== null).length,
        gruposCompartilhados:new Set(relacionados.map(i => i.observado.grupoDemandaId).filter(Boolean)).size},
      valorPorContato:cenario(oferta, confirmado),proximoTeste:testeNegocio&&!bloqueante?testeNegocio:teste,
      testeNegocio,testePrincipal:teste,faltam,
      melhoriasObservadas:[...new Map(relacionados.flatMap(i => i.melhoriasObservadas || []).map(m => [m.id,m])).values()],
      evidencias:[...new Map(relacionados.flatMap(i => i.evidencias).map(e => [JSON.stringify(e), e])).values()],
      limites:[
        'Uma frente agrupa uma oferta declarada, não uma estimativa de tamanho de mercado.',
        'As palavras podem se sobrepor; seus volumes e cenários por contato não são somados.',
        'O cenário financeiro pertence à oferta. Não prova o valor de cada palavra nem prevê contatos ou lucro.',
      ]};
  }).sort((a,b) => ORDEM_ATIVIDADE[a.centralidade.nivel]-ORDEM_ATIVIDADE[b.centralidade.nivel] || ORDEM[a.prioridade] - ORDEM[b.prioridade] || a.nome.localeCompare(b.nome,'pt-BR'));
}

function montarPlanoDeAcao(frentes, confirmado, contexto) {
  if (!confirmado) return [];
  const unicas = new Map();
  function adicionar(frente, teste, melhoria = null) {
    if (!teste) return;
    const pagina = melhoria ? {url:melhoria.paginaAlvo,origem:'observada',fonte:'site',coletadoEm:melhoria.coletadoEm} : frente.paginaAlvo;
    if(!teste.categoria)teste=especificarTesteNegocio({teste,perfil:contexto.perfil,
      oferta:contexto.perfil.ofertas?.find(o=>o?.id===frente.ofertaId)||{id:frente.ofertaId,nome:frente.nome,evidencias:frente.evidencias,centralidade:frente.centralidade},pagina,
      contextoPublico:contexto.contextoPublico,melhoria},{agora:contexto.agora});
    const escopo = pagina?.url || 'oferta:' + frente.ofertaId;
    const eixo=melhoria?(melhoria.verificacaoId.startsWith('diretiva-noindex-')?'publicacao':'tecnico'):
      teste.eixo||(['validar_economia','validar_demanda','medir_posicao','acompanhar_contatos'].includes(teste.tipo)?'dados':'qualificacao');
    // A technical finding belongs to the URL/rule. Different business conditions
    // remain separate; exact aliases of the same sourced decision can share it.
    const d=teste.decisaoCliente,condicoes=Array.isArray(d?.condicoesDeterminantes)?d.condicoesDeterminantes:[],
      canonico=v=>texto(v,4000).normalize('NFC').toLocaleLowerCase('pt-BR'),
      compartilhavel=eixo==='negocio'&&condicoes.length>0&&condicoes.every(e=>e.natureza==='trecho_literal'&&e.tipo!=='interface_publica'&&texto(e.trecho,600).length>=30),
      assinatura=compartilhavel?JSON.stringify([teste.experimento?.tipo,canonico(d.escolha),(d.percurso||[]).map(canonico),
        condicoes.map(e=>JSON.stringify([e.url,e.campo,e.trecho,e.coletadoEm,e.sha256,e.secao])).sort()]):null,
      fatos=d?.fatos,
      mesmaDecisao=eixo==='negocio'&&Array.isArray(fatos)&&fatos.length>0&&fatos.every(f=>Array.isArray(f.evidencias)&&f.evidencias.length>0),
      assinaturaLocal=mesmaDecisao?JSON.stringify([escopo,teste.experimento?.tipo,canonico(d.escolha),(d.percurso||[]).map(canonico),
        fatos.map(f=>JSON.stringify([canonico(f.descricao),(f.evidencias||[]).map(e=>JSON.stringify([
          e.url,e.campo,e.trecho,e.coletadoEm,e.sha256,e.secao,e.grupoId,e.tipoGrupo,e.tipoControle])).sort()])).sort()]):null;
    const chaveAcao = assinatura?'decisao_compartilhada|'+assinatura:assinaturaLocal?'decisao_na_pagina|'+assinaturaLocal:
      escopo + '|' + (melhoria ? melhoria.verificacaoId : teste.tipo+'|'+(teste.experimento?.tipo||'')+'|oferta:'+frente.ofertaId);
    if (!unicas.has(chaveAcao)) unicas.set(chaveAcao, {
      id:'acao_' + createHash('sha256').update(chaveAcao).digest('hex').slice(0, 20),
      tipo:teste.tipo,eixo,titulo:teste.titulo || melhoria?.titulo,acao:teste.acao,base:teste.base,
      prioridade:eixo==='negocio'||teste.lacuna?.natureza==='evidencia_insuficiente'?'investigar':melhoria ? melhoria.verificacaoId.startsWith('diretiva-noindex-') ? 'investigar' : 'melhorar' : frente.prioridade,
      paginaAlvo:pagina,passos:teste.passos,criterioSucesso:teste.criterioSucesso,comoValidar:teste.comoValidar,
      categoria:teste.categoria,lacuna:teste.lacuna,entregavel:teste.entregavel,dependencias:teste.dependencias,
      esforco:teste.esforco,priorizacao:teste.priorizacao,experimento:teste.experimento,
      modeloEntregavel:teste.modeloEntregavel,evidenciasNegocio:teste.evidenciasNegocio,decisaoCliente:teste.decisaoCliente,
      paginasRelacionadas:teste.paginasRelacionadas,escoposPorOferta:[],
      centralidade:frente.centralidade,
      ofertasAfetadas:[],termosRelacionados:[],evidencias:[],melhoriasObservadas:[],
      limites:['A tarefa reúne trabalho sobre uma página ou oferta; o número de palavras não aumenta o impacto nem estima retorno.',
        'Achados de uso, clareza ou publicação não comprovam a causa de uma posição nem um ganho de vendas.'],
    });
    const acao = unicas.get(chaveAcao);
    if(eixo==='negocio'){
      acao.escoposPorOferta.push({ofertaId:frente.ofertaId,nome:frente.nome,pagina,fatos:teste.decisaoCliente?.fatos||[]});
      acao.paginasRelacionadas=[...new Map([...(acao.paginasRelacionadas||[]),...(teste.paginasRelacionadas||[])]
        .filter(Boolean).map(p=>[p.url,p])).values()].slice(0,4);
      acao.evidenciasNegocio=[...new Map([...(acao.evidenciasNegocio||[]),...(teste.evidenciasNegocio||[])]
        .map(e=>[JSON.stringify([e.url,e.campo,e.trecho,e.sha256]),e])).values()].slice(0,24);
      if(acao.escoposPorOferta.length>1){
        const nomes=[...new Set(acao.escoposPorOferta.map(o=>o.nome))];
        acao.titulo=acao.titulo.split(' — ')[0]+' — '+nomes.join('; ');
        acao.decisaoCliente={...acao.decisaoCliente,objeto:nomes.join('; '),objetos:nomes,
          fatos:[...new Map(acao.escoposPorOferta.flatMap(o=>o.fatos).map(f=>[JSON.stringify([f.descricao,
            (f.evidencias||[]).map(e=>[e.url,e.campo,e.trecho,e.sha256])]),f])).values()].slice(0,24)};
        acao.experimento={...acao.experimento,ofertaId:null,ofertaIds:acao.escoposPorOferta.map(o=>o.ofertaId)};
        acao.modeloEntregavel={...acao.modeloEntregavel,campos:[{rotulo:'Ofertas relacionadas à mesma decisão',valorSugerido:nomes.join('; '),origem:'perfil_revisado'},
          ...acao.evidenciasNegocio.slice(0,10).map(e=>({rotulo:'Condição ou rótulo publicado a conferir',valorSugerido:e.trecho,origem:'trecho_publicado',evidencia:e}))]};
      }
    }
    if(ORDEM_ATIVIDADE[frente.centralidade?.nivel]<ORDEM_ATIVIDADE[acao.centralidade?.nivel])acao.centralidade=frente.centralidade;
    if (!acao.ofertasAfetadas.some(o => o.id === frente.ofertaId)) acao.ofertasAfetadas.push({id:frente.ofertaId,nome:frente.nome});
    acao.termosRelacionados = [...new Set([...acao.termosRelacionados,...frente.termos])].slice(0, 100);
    const evidencias = melhoria ? [{tipo:'diagnostico',verificacaoId:melhoria.verificacaoId,
      url:melhoria.paginaAlvo,trecho:melhoria.evidencia,coletadoEm:melhoria.coletadoEm,sha256:melhoria.sha256Pagina}]
      :eixo==='negocio'?teste.evidenciasNegocio||[]:frente.evidencias;
    acao.evidencias = [...new Map([...acao.evidencias,...evidencias].map(e => [JSON.stringify(e),e])).values()].slice(0, 32);
    if (melhoria && !acao.melhoriasObservadas.some(m => m.id === melhoria.id)) acao.melhoriasObservadas.push(melhoria);
  }
  for (const frente of frentes) {
    for (const m of frente.melhoriasObservadas) {
      const tipo = m.verificacaoId.startsWith('diretiva-noindex-') ? 'confirmar_publicacao' : 'corrigir_uso';
      adicionar(frente,proximoTeste(tipo,m.orientacao+' Repita a conferência na mesma URL; este achado não demonstra a causa do ranking.',frente.paginaAlvo,frente.nome,m),m);
    }
    if(frente.testeNegocio)adicionar(frente,frente.testeNegocio);
    const principal=frente.testePrincipal||frente.proximoTeste;
    if (!['corrigir_uso','confirmar_publicacao'].includes(principal.tipo)&&
        (!frente.testeNegocio||!['conferir_oferta','revisar_pagina','reler_pagina','validar_pagina','validar_oferta'].includes(principal.tipo))) adicionar(frente,principal);
  }
  return [...unicas.values()];
}
function ordenarPlano(plano){const faixa=t=>t.eixo==='publicacao'?0:t.tipo==='validar_economia'?1:t.eixo==='negocio'?2:t.eixo==='tecnico'?3:t.eixo==='dados'?4:5;
  return plano.sort((a,b)=>faixa(a)-faixa(b)||(ORDEM_ATIVIDADE[a.centralidade?.nivel]??1)-(ORDEM_ATIVIDADE[b.centralidade?.nivel]??1)||
    ORDEM[a.prioridade]-ORDEM[b.prioridade]||a.titulo.localeCompare(b.titulo,'pt-BR'));}

/** Regras locais e auditáveis. Nenhum modelo é treinado nem fornecedor é chamado. */
export function avaliarOportunidades({perfil, palavras, posicoes, demanda, diagnostico, capacidades,contextoPublico} = {}, {agora = Date.now} = {}) {
  const instante = typeof agora === 'function' ? agora() : NaN;
  if (!Number.isFinite(instante)) throw new TypeError('O relógio da análise é inválido.');
  let dominio = '';
  try { dominio = normalizarSite(perfil?.dominio); } catch { /* No domain means no valid position evidence. */ }
  const brutos = (Array.isArray(palavras?.candidatos) ? palavras.candidatos : []).slice(0, 100);
  const candidatos = brutos.filter(c => termoValido(c?.termo));
  const confirmado = Boolean(dominio) && perfil?.estado === 'confirmado';
  const ofertas = new Map();
  for (const oferta of (Array.isArray(perfil?.ofertas) ? perfil.ofertas : []).slice(0, 8)) {
    if (typeof oferta?.id === 'string' && texto(oferta.nome)) ofertas.set(oferta.id, ofertas.has(oferta.id) ? null : oferta);
  }
  // Reuse the existing capture verification: hashes, source, timestamp, exact
  // query, pagination, domain and country/language/device must all agree.
  const relatorioPosicoes = posicoes?.versao === 2 && posicoes.dominio === dominio
    ? {...posicoes, candidatos} : {versao: 2, dominio, candidatos, consultas: []};
  const verificacao = analisarOportunidades({dominio, posicoes: relatorioPosicoes, diagnostico}, {agora: () => instante});
  const verificadas = new Map(verificacao.oportunidades.map(o => [chave(o.termo), o]));
  const consultas = new Map((Array.isArray(relatorioPosicoes.consultas) ? relatorioPosicoes.consultas : [])
    .filter(q => termoValido(q?.termo)).map(q => [chave(q.termo), q]));
  const demandaValidada = normalizarDemanda(demanda, {agora: () => instante});
  const demandaCompativel = demandaValidada.pais === CONTEXTO.pais && demandaValidada.idioma === CONTEXTO.idioma;
  const procuras = new Map(demandaCompativel ? demandaValidada.itens.map(i => [chave(i.termo), i]) : []);
  const grupos = new Map(demandaCompativel ? demandaValidada.grupos.flatMap(g => g.termos.map(t => [chave(t), g])) : []);
  const itens = [], vistos = new Set();
  for (const candidato of candidatos) {
    const termo = texto(candidato?.termo), id = chave(termo);
    if (!id || termo.length < 3 || /[<>@]|https?:\/\//i.test(termo) || vistos.has(id)) continue;
    vistos.add(id);
    const oferta = ofertas.get(candidato.ofertaId), base = verificadas.get(id);
    const evidencias = (base?.evidencias || []).filter(e => e.tipo === 'google' || candidato.origem === 'site');
    const medida = evidencias.some(e => e.tipo === 'google');
    const posicao = medida ? base.posicao : null;
    const volume = procuras.get(id)?.buscasMensais ?? null;
    const grupo = grupos.get(id) || null;
    const comercial = candidato.intencao === 'comercial';
    const valorPorContato = cenario(oferta, confirmado);
    let pagina = paginaAlvo(oferta, base, medida, posicao, dominio, instante, consultas.get(id));
    const leituraPagina = pagina && paginaDiagnosticada(diagnostico, pagina.url, dominio, instante);
    if (pagina?.origem === 'declarada' && leituraPagina) pagina = {...pagina,origem:'observada',fonte:'site',coletadoEm:leituraPagina.coletadoEm};
    const leituraContextual=pagina?.origem==='declarada'&&paginaContextual(contextoPublico,oferta,pagina.url,dominio,instante);
    if(leituraContextual)pagina={...pagina,origem:'observada',fonte:'site',coletadoEm:leituraContextual.coletadoEm,
      sha256:leituraContextual.sha256,verificacao:'contexto_publico'};
    // Diagnoses are server-produced observations revalidated by the existing
    // verifier. Never copy a defect to another offer's page or infer a ranking
    // cause from a usability finding.
    const melhoriasObservadas = pagina ? verificacao.melhorias.filter(m => m.paginaAlvo === pagina.url).slice(0, 3) : [];
    const melhoria = melhoriasObservadas[0] || null;
    for (const m of melhoriasObservadas) evidencias.push({tipo:'diagnostico',verificacaoId:m.verificacaoId,
      url:m.paginaAlvo,trecho:m.evidencia,coletadoEm:m.coletadoEm,sha256:m.sha256Pagina,
      limite:'Achado na mesma página; não mede posição, conversão ou causa do ranking.'});
    let prioridade = 'investigar', motivo, acao, tarefa = 'medir_posicao';
    const faltam = [];
    if (!confirmado) {
      motivo = 'O entendimento do negócio ainda é um rascunho; confirme oferta, público e regiões antes de priorizar investimento.';
      acao = 'Revise e confirme o perfil do negócio, corrigindo as ofertas inferidas do site.';
      faltam.push('Confirmação do perfil pela pessoa responsável pelo negócio.');
      tarefa = 'confirmar_negocio';
    } else if (!oferta) {
      prioridade = 'adiar';
      motivo = 'A busca não está ligada a uma oferta confirmada. Um volume elevado, sozinho, não indica valor para este negócio.';
      acao = 'Confirme se existe uma oferta e um público atendido por esta busca; se não existir, retire-a do foco de aquisição.';
      faltam.push('Ligação explícita com uma oferta confirmada.');
      tarefa = 'validar_oferta';
    } else if (!comercial) {
      prioridade = 'adiar';
      motivo = 'A intenção comercial não foi estabelecida. A busca pode ajudar informação, marca ou atendimento, sem demonstrar demanda de contratação.';
      acao = 'Confira a intenção nos resultados e a utilidade para o público antes de usar a busca em uma campanha de aquisição.';
      faltam.push('Validação da intenção e da relação com a contratação.');
      tarefa = 'conferir_intencao';
    } else if (valorPorContato && valorPorContato.valor <= 0) {
      motivo = 'As premissas declaradas produzem contribuição por contato '+(valorPorContato.valor < 0 ? 'negativa' : 'igual a zero')+'. Elas precisam ser revisadas antes de justificar expansão de aquisição, independentemente da posição observada.';
      acao = 'Confira se a contribuição e a taxa de fechamento foram informadas corretamente para esta oferta. Registre o período e o perfil dos contatos antes de usar o cenário em uma decisão de investimento.';
      tarefa = 'validar_economia';
    } else if (volume === 0) {
      motivo = 'A fonte informou estimativa histórica igual a zero neste recorte. Isso pode refletir procura pequena ou arredondada e não comprova ausência de demanda; investigue antes de ampliar esforço de aquisição.';
      acao = 'Confirme se o público usa esta expressão e confronte a estimativa com buscas próximas e contatos conhecidos, sem somar variantes. Preserve a posição observada como informação separada.';
      tarefa = 'validar_demanda';
    } else if (!medida && melhoria) {
      const publicacao = melhoria.verificacaoId.startsWith('diretiva-noindex-');
      prioridade = publicacao ? 'investigar' : 'melhorar';
      motivo = 'Há um achado atual na mesma URL desta oferta: '+melhoria.titulo+'. A posição no Google não foi confirmada; o achado permite revisar uso, clareza ou intenção de publicação sem presumir a causa do ranking.';
      acao = melhoria.orientacao + ' Confira a mesma página e registre a revisão. Esta ação não depende de contratar uma fonte de posições e não garante ganho comercial ou de SEO.';
      tarefa = publicacao ? 'confirmar_publicacao' : 'corrigir_uso';
    } else if (!medida && capacidades?.posicoes?.configurada !== true && pagina) {
      motivo = pagina.origem === 'observada'
        ? 'Há conteúdo publicado relacionado à oferta, mas faltam posição e procura verificadas. É possível conferir a experiência de contratação na página existente sem afirmar um defeito ou retorno.'
        : 'A página foi declarada no perfil, mas falta uma leitura atual que confirme seu conteúdo. Verifique a URL antes de propor alterações; ranking e procura continuam desconhecidos.';
      acao = pagina.origem === 'observada'
        ? 'Confira nesta página se uma pessoa entende a oferta, sabe se é atendida e encontra como pedir contato ou orçamento. Registre as dúvidas reais e uma melhoria que possa ser verificada com o público.'
        : 'Confira se a URL declarada ainda atende à oferta e peça uma nova leitura do site. Preserve as hipóteses enquanto o conteúdo não estiver confirmado.';
      tarefa = pagina.origem === 'observada' ? 'conferir_oferta' : 'reler_pagina';
    } else if (!medida) {
      motivo = 'A busca corresponde a uma oferta confirmada e sugere contratação; falta uma posição atual verificável para decidir uma melhoria de SEO.';
      acao = 'Complete a medição quando houver fonte disponível e compare as páginas observadas com a oferta. Enquanto isso, confira a página e o caminho para pedir orçamento sem presumir falhas.';
    } else if (posicao === null) {
      motivo = 'A busca se relaciona à oferta, mas o site não apareceu no recorte consultado. Isso não determina sua posição nem a causa da ausência.';
      acao = 'Confira se há uma página adequada à oferta e amplie a medição dentro da cota. Não conclua que o site está fora do Google.';
    } else if (posicao <= 3) {
      prioridade = 'acompanhar';
      motivo = 'Há presença entre os três primeiros resultados no recorte medido. Verifique a qualidade dos contatos antes de ampliar esforço.';
      acao = 'Preserve informações úteis e acompanhe a mesma busca, a página de destino e contatos qualificados.';
      tarefa = 'acompanhar_contatos';
    } else {
      prioridade = 'melhorar';
      motivo = 'A busca tem ligação com uma oferta confirmada, sinal de contratação e presença observada. É candidata a um teste de conteúdo; a dificuldade de subir não foi medida.';
      acao = 'Revise a página existente que atende a esta busca: oferta, público, informações de contratação e caminho de orçamento. Compare com os concorrentes observados e registre uma alteração útil para testar, sem criar páginas duplicadas por variação de palavra.';
      tarefa = 'revisar_pagina';
    }
    if (!medida) faltam.push('Captura atual, íntegra e comparável dos resultados do Google.');
    if (volume === null) faltam.push(grupo
      ? 'A estimativa pertence a um grupo de variantes; falta volume individual desta palavra. Não atribua o total do grupo a cada variante.'
      : (demandaValidada.itens.length || demandaValidada.grupos.length) && !demandaCompativel
        ? 'Demanda no mesmo país e idioma da medição; os recortes disponíveis são incompatíveis.'
        : 'Estimativa histórica de demanda para este termo, com fonte, período, país e idioma.');
    if (!valorPorContato) faltam.push('Contribuição por venda e taxa de fechamento da oferta, declaradas ou medidas.');
    faltam.push('Custos de aquisição e conversões atribuídas à busca para avaliar gasto, retorno ou mudança de orçamento.');
    if (!texto(perfil?.publico, 500)) faltam.push('Quem contrata ou compra esta oferta e quais contatos são considerados qualificados.');
    if (!Array.isArray(perfil?.regioes) || !perfil.regioes.length) faltam.push('Área atendida e possibilidade de contratação fora dela. A medição disponível usa recorte nacional.');
    if (!confirmado) for (const pergunta of (Array.isArray(perfil?.perguntas) ? perfil.perguntas : []).slice(0, 4)) {
      const formulacao = texto(pergunta?.pergunta, 300);
      if (formulacao) faltam.push(formulacao);
    }
    if (candidato.origem !== 'site') faltam.push('A expressão é uma hipótese gerada a partir da oferta; não foi observada no conteúdo do site.');
    if (volume !== null) evidencias.push({tipo: 'demanda', fonte: demandaValidada.fonte,
      coletadoEm: demandaValidada.coletadoEm, pais: demandaValidada.pais, idioma: demandaValidada.idioma,
      periodoInicio: demandaValidada.periodoInicio, periodoFim: demandaValidada.periodoFim,
      termo, buscasMensais: volume, natureza: 'estimativa_historica'});
    if (grupo) evidencias.push({tipo:'demanda_compartilhada', grupoId:grupo.id, fonte:demandaValidada.fonte,
      coletadoEm:demandaValidada.coletadoEm, periodoInicio:demandaValidada.periodoInicio, periodoFim:demandaValidada.periodoFim,
      termos:grupo.termos, buscasMensaisCompartilhadas:grupo.buscasMensais,
      natureza:'estimativa_historica_compartilhada', limite:'A média descreve o grupo, sem volume individual para a palavra.'});
    const melhoriaTeste=['corrigir_uso','confirmar_publicacao'].includes(tarefa)?melhoria:null;
    const teste = especificarTesteNegocio({teste:proximoTeste(tarefa, acao, pagina, oferta?.nome,melhoriaTeste),
      perfil,oferta,pagina,contextoPublico,melhoria:melhoriaTeste,candidato},{agora:()=>instante});
    if(teste.lacuna?.natureza==='evidencia_insuficiente')prioridade='investigar';
    itens.push({termo, ofertaId: oferta?.id ?? null, prioridade, motivo, paginaAlvo:pagina, proximoTeste:teste, melhoriasObservadas,
      observado: {posicao, estado: medida ? posicao === null ? 'nao_encontrado_no_recorte' : 'encontrado' : 'nao_medido',
        buscasMensais: volume, demandaEstado: volume === null ? grupo ? 'estimativa_compartilhada' : 'indisponivel' : 'estimativa_historica',
        grupoDemandaId:grupo?.id ?? null,
        demandaContexto: volume !== null || grupo ? {pais:demandaValidada.pais,idioma:demandaValidada.idioma,
          rede:demandaValidada.rede,dispositivos:demandaValidada.dispositivos,
          periodoInicio:demandaValidada.periodoInicio,periodoFim:demandaValidada.periodoFim} : null,
        contexto: medida ? {...CONTEXTO} : null, concorrentes: medida ? base.concorrentes : []},
      acao:teste.acao, comoValidar:teste.comoValidar,
      faltam: [...new Set(faltam)], confianca: confirmado && oferta && comercial && (medida || melhoria) ? 'media' : 'baixa',
      valorPorContato,centralidade:centralidadeDaOferta(oferta), evidencias});
  }
  // Scope and intent outrank all volume. Financial scenarios are explanatory,
  // never a claim that one keyword will produce more money or clicks.
  itens.sort((a, b) => ORDEM_ATIVIDADE[a.centralidade.nivel]-ORDEM_ATIVIDADE[b.centralidade.nivel] || ORDEM[a.prioridade] - ORDEM[b.prioridade] ||
    (a.ofertaId ? 0 : 1) - (b.ofertaId ? 0 : 1) ||
    (b.observado.buscasMensais ?? -1) - (a.observado.buscasMensais ?? -1) || a.termo.localeCompare(b.termo, 'pt-BR'));
  const contexto={perfil,contextoPublico,agora:()=>instante};
  const frentes = agruparFrentes(ofertas, itens, confirmado,contexto);
  const planoDeAcao=ordenarPlano([...montarPlanoDeAcao(frentes,confirmado,contexto),...tarefasDeAtuacoesSociais({perfil,contextoPublico},{agora:()=>instante})]);
  const planoNegocio=planoDeAcao.filter(t=>t.eixo==='negocio');
  return {versao: 1, estado: !itens.length&&!planoDeAcao.length ? 'sem_dados' : confirmado ? 'parcial' : 'aguardando_confirmacao',
    metodo: 'regras-negocio-v6', geradoEm: new Date(instante).toISOString(), itens,
    frentes,planoDeAcao,planoNegocio,
    limites: [
      'A prioridade organiza investigação e testes de SEO; não recomenda aumentar ou reduzir verba automaticamente.',
      'Alinhamento à oferta e intenção vêm antes do volume. A intenção é uma hipótese e a demanda é histórica.',
      'Não somamos volumes de variações semelhantes e não estimamos tráfego incremental, CTR, lucro ou probabilidade de subir no Google.',
      'Contribuição por venda é o valor que fica para o negócio após custos variáveis. Em intermediação, use a comissão líquida desses custos, não o contrato total do artista.',
      'Cenários por contato usam premissas declaradas. Não são dinheiro por clique, orçamento recomendado ou resultados observados.',
      'Posições valem para as páginas, datas e contexto registrados. A falta de uma posição não significa zero visibilidade.',
      'As faixas de posição são critérios editoriais de organização; não demonstram dificuldade ou retorno.',
      'Esta versão usa regras locais auditáveis. Não modifica pesos de IA com correções do usuário nem altera anúncios ou páginas.',
      'Ações de uso e clareza podem ser feitas com evidência atual da página mesmo sem fonte de posições. Achados de outra URL ou vencidos não sustentam uma correção nesta oferta.',
      ...(brutos.length !== candidatos.length ? ['Candidatos inválidos ou longos demais foram descartados sem truncar a expressão em outra busca.'] : []),
      ...demandaValidada.limites,
    ]};
}
