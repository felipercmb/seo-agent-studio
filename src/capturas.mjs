import {coletarSite} from './coleta.mjs';

// Compartilha apenas durante o processamento recente. HTML nunca vai para o banco
// nem para a resposta pública; no máximo três domínios ficam na memória.
export function criarCapturas({coletar = coletarSite, agora = Date.now, objetivo = 'busca'} = {}) {
  const recentes = new Map();
  return async dominio => {
    const instante = agora();
    for (const [host, item] of recentes) if (instante - item.instante >= 60_000) recentes.delete(host);
    if (recentes.has(dominio)) return recentes.get(dominio).promessa;
    if (recentes.size >= 3) recentes.delete(recentes.keys().next().value);
    const promessa = coletar(dominio, {objetivo, limiteRequisicoes: objetivo === 'descoberta' ? 40 : 24});
    recentes.set(dominio, {instante, promessa});
    try { return await promessa; }
    catch (erro) { recentes.delete(dominio); throw erro; }
  };
}
