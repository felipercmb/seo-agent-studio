export const MAX_MENSAL = 200;
export const MAX_HORA = 40;
export const MAX_DOMINIO_DIA = 20;
export const RESERVAR_SQL = `INSERT INTO rank_creditos (id, mes, hora, criado_em, dominio)
SELECT ?, ?, ?, ?, ?
WHERE (SELECT COUNT(*) FROM rank_creditos WHERE mes = ?) < ?
AND (SELECT COUNT(*) FROM rank_creditos WHERE criado_em > ?) < ?
AND (? = '' OR (SELECT COUNT(*) FROM rank_creditos WHERE dominio = ? AND criado_em > ?) < ?)
RETURNING id`;

export function criarFranquia(db, agora = Date.now) {
  if (!db?.prepare) return null;
  return {
    async obter(chave) {
      const r = await db.prepare('SELECT payload FROM rank_resultados WHERE chave = ? AND expira_em > ?')
        .bind(chave, agora()).first();
      if (!r) return null;
      try { return JSON.parse(r.payload); } catch { return null; }
    },
    async guardar(chave, valor, ttl = 3600_000) {
      await db.prepare('INSERT INTO rank_resultados (chave, expira_em, payload) VALUES (?, ?, ?) ON CONFLICT(chave) DO UPDATE SET expira_em = excluded.expira_em, payload = excluded.payload')
        .bind(chave, agora() + ttl, JSON.stringify(valor)).run();
    },
    async bloquear(chave) {
      const token = crypto.randomUUID();
      const r = await db.prepare('INSERT INTO rank_travas (chave, token, expira_em) VALUES (?, ?, ?) ON CONFLICT(chave) DO UPDATE SET token = excluded.token, expira_em = excluded.expira_em WHERE rank_travas.expira_em <= ? RETURNING token')
        .bind(chave, token, agora() + 180_000, agora()).first();
      return r?.token === token ? token : null;
    },
    async liberar(chave, token) {
      await db.prepare('DELETE FROM rank_travas WHERE chave = ? AND token = ?').bind(chave, token).run();
    },
    async saldo(dominio = '') {
      const instante = agora(), mes = new Date(instante).toISOString().slice(0, 7);
      const r = await db.prepare(`SELECT
        (SELECT COUNT(*) FROM rank_creditos WHERE mes = ?) AS mensal,
        (SELECT COUNT(*) FROM rank_creditos WHERE criado_em > ?) AS hora,
        (SELECT COUNT(*) FROM rank_creditos WHERE dominio = ? AND criado_em > ?) AS dominio`)
        .bind(mes, instante - 3600_000, dominio, instante - 86400_000).first();
      if (!r) throw new Error('Controle indisponível');
      return {mensal: Math.max(0, MAX_MENSAL - r.mensal), hora: Math.max(0, MAX_HORA - r.hora), dominio: Math.max(0, MAX_DOMINIO_DIA - r.dominio)};
    },
    async reservar(dominio = '') {
      const agoraMs = agora(), data = new Date(agoraMs).toISOString();
      const mes = data.slice(0, 7), hora = data.slice(0, 13);
      // A condição e a reserva acontecem na mesma instrução atômica. Erros ou
      // timeouts do fornecedor não devolvem crédito: podem ter consumido cota.
      return Boolean(await db.prepare(RESERVAR_SQL)
        .bind(crypto.randomUUID(), mes, hora, agoraMs, dominio, mes, MAX_MENSAL, agoraMs - 3600_000, MAX_HORA,
          dominio, dominio, agoraMs - 86400_000, MAX_DOMINIO_DIA).first());
    },
  };
}
