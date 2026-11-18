const chave = valor => JSON.stringify(valor || null);

export function registrarHistorico(projeto, acao, agora = Date.now, revisaoPerfil = null, capturaGoogle = null) {
  const observacoes = (projeto.oportunidades?.itens || []).filter(i =>
    ['encontrado', 'nao_encontrado_no_recorte'].includes(i.observado?.estado)).map(i => ({
    termo: i.termo, posicao: i.observado.posicao, estado: i.observado.estado,
    contexto: i.observado.contexto, coletadoEm: projeto.posicoes?.consultas?.find(q => q.termo === i.termo)?.coletadoEm,
    evidencias: (i.evidencias || []).filter(e => e.tipo === 'google'),
  }));
  const comparacoes = [];
  if (acao === 'medir') {
    for (const atual of observacoes) {
      const antes = [...(projeto.historico || [])].reverse()
        .filter(h => h.acao === 'medir' && h.planoId === projeto.posicoes?.planoId)
        .flatMap(h => h.observacoes || []).find(o => o.termo === atual.termo &&
          chave(o.contexto) === chave(atual.contexto) && Number.isInteger(o.posicao) &&
          Date.parse(o.coletadoEm) < Date.parse(atual.coletadoEm));
      if (antes && antes.coletadoEm !== atual.coletadoEm &&
          Number.isFinite(Date.parse(antes.coletadoEm)) && Date.parse(antes.coletadoEm) < Date.parse(atual.coletadoEm) &&
          atual.contexto && chave(antes.contexto) === chave(atual.contexto) &&
          Number.isInteger(antes.posicao) && Number.isInteger(atual.posicao)) {
        comparacoes.push({termo: atual.termo, antes: antes.posicao, agora: atual.posicao,
          variacao: antes.posicao - atual.posicao, contexto: atual.contexto,
          de: antes.coletadoEm, ate: atual.coletadoEm,
          limite: 'Variação entre duas capturas comparáveis; não comprova efeito de uma intervenção.'});
      }
    }
  }
  const item = {id: crypto.randomUUID(), criadoEm: new Date(agora()).toISOString(),
    acao, revisao: projeto.revisao, planoId: projeto.posicoes?.planoId || null,
    resumo: {perfil: projeto.perfil.estado, palavras: projeto.palavras.candidatos.length,
      verificadas: observacoes.length, fonte: projeto.posicoes?.estado || 'nao_consultada'},
    observacoes: acao === 'medir' ? observacoes : [], comparacoes,
    ...(acao === 'salvar_perfil' && revisaoPerfil?.versao === 1 ? {revisaoPerfil} : {})};
  if (acao === 'registrar_google_local' && capturaGoogle) {
    const {capturaId, termo, coletadoEm, estado, totalBlocosWeb, encontrados, ordemDominioExibido} = capturaGoogle;
    item.resumo.googleLocal = {capturaId, termo, coletadoEm, estado, totalBlocosWeb,
      ordemBloco:encontrados?.[0]?.ordemBloco ?? ordemDominioExibido ?? null};
  }
  return [...(projeto.historico || []), item].slice(-24);
}
