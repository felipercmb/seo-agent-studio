import {normalizarSite, ErroConsulta} from './consulta.mjs';
import {criarFranquia} from './franquia.mjs';
import {analisarOportunidades} from './agente.mjs';

const TTL = 7 * 86400_000;
const MAX_REGISTROS = 24;
const MAX_BYTES = 2 * 1024 * 1024;
const TIPOS = {posicoes: 2, diagnostico: 1};
const chave = (tipo, dominio) => 'agente-evidencias-v1:' + tipo + ':' + dominio;

// The service accepts only a domain from the browser. Evidence comes from
// reports produced by this server, never client-supplied positions or prompts.
export function criarAgente({agora = Date.now, analisar = analisarOportunidades} = {}) {
  const memorias = new WeakMap(), semBanco = new Map();
  function memoria(env) {
    const db = env?.DB;
    if (!db || typeof db !== 'object') return semBanco;
    if (!memorias.has(db)) memorias.set(db, new Map());
    return memorias.get(db);
  }
  function validar(registro, tipo, dominio) {
    if (!registro || registro.versao !== 1 || registro.tipo !== tipo || registro.dominio !== dominio ||
        !Number.isFinite(registro.guardadoEm) || registro.guardadoEm > agora() || agora() - registro.guardadoEm >= TTL ||
        registro.relatorio?.versao !== TIPOS[tipo] || registro.relatorio?.dominio !== dominio) return null;
    return registro;
  }
  function guardarMemoria(mapa, id, registro) {
    for (const [k, r] of mapa) if (agora() - r.guardadoEm >= TTL) mapa.delete(k);
    mapa.delete(id);
    if (mapa.size >= MAX_REGISTROS) mapa.delete(mapa.keys().next().value);
    mapa.set(id, registro);
  }
  async function registrar(tipo, relatorio, env = {}) {
    // Failing to save this optional analysis input must not erase a successful
    // capture or change the original report's quota/availability state.
    try {
      if (!Object.hasOwn(TIPOS, tipo) || relatorio?.versao !== TIPOS[tipo]) return false;
      const dominio = normalizarSite(relatorio.dominio);
      if (relatorio.dominio !== dominio) return false;
      const serializado = JSON.stringify({versao: 1, tipo, dominio, guardadoEm: agora(), relatorio});
      if (new TextEncoder().encode(serializado).byteLength > MAX_BYTES) return false;
      const registro = JSON.parse(serializado), id = chave(tipo, dominio);
      guardarMemoria(memoria(env), id, registro);
      const banco = criarFranquia(env.DB, agora);
      if (!banco) return false;
      await banco.guardar(id, registro, TTL);
      return true;
    } catch { return false; }
  }
  async function ler(tipo, dominio, env) {
    const id = chave(tipo, dominio), banco = criarFranquia(env.DB, agora);
    const local = validar(memoria(env).get(id), tipo, dominio);
    if (banco) {
      try {
        const registro = validar(await banco.obter(id), tipo, dominio);
        if (registro && (!local || registro.guardadoEm >= local.guardadoEm)) {
          return {relatorio: registro.relatorio, persistida: true};
        }
      } catch { /* A valid in-process observation is still usable with its date. */ }
    }
    return {relatorio: local?.relatorio ?? null, persistida: false};
  }
  return {
    registrar,
    async executar(entrada, env = {}) {
      if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) ||
          Object.keys(entrada).some(k => k !== 'site')) {
        throw new ErroConsulta('Informe apenas o domínio para analisar as evidências já coletadas.');
      }
      const dominio = normalizarSite(entrada.site);
      const [ranking, diagnostico] = await Promise.all([ler('posicoes', dominio, env), ler('diagnostico', dominio, env)]);
      const relatorio = analisar({dominio, posicoes: ranking.relatorio, diagnostico: diagnostico.relatorio}, {agora});
      if ([ranking, diagnostico].some(r => r.relatorio && !r.persistida)) {
        relatorio.limites.push('Parte das evidências está disponível apenas nesta execução; não foi possível confirmar sua persistência no banco local.');
      }
      return relatorio;
    },
  };
}
