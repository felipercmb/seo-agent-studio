const rotuloDNS = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const locais = new Set(["localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "arpa", "onion", "test", "invalid"]);
const categoriasPublicas = new Set(["com", "co", "org", "net", "gov", "edu", "ac", "gob", "go"]);

export class ErroConsulta extends Error {}

// Estes links não identificam o destino orgânico: a resposta do buscador pode
// ocultar o site atrás de um redirecionamento. Não os siga nem infira domínio.
export function redirecionamentoGoogleOpaco(valor) {
  let url;
  try { url = valor instanceof URL ? valor : new URL(valor); } catch { return false; }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!/^(?:[a-z0-9-]+\.)*google\.(?:com|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2,3})$/i.test(host)) return false;
  let caminho = url.pathname;
  try {
    // Some intermediaries escape the path more than once.
    for (let i = 0; i < 3; i++) {
      const novo = decodeURIComponent(caminho);
      if (novo === caminho) break;
      caminho = novo;
    }
  } catch { return true; }
  return /^\/(?:goto|url)(?:\/|$)/i.test(caminho);
}

function hostCanonico(host) {
  const dominio = host.toLowerCase().replace(/\.$/, "");
  return dominio.startsWith("www.") && dominio.split(".").length > 2 ? dominio.slice(4) : dominio;
}

export function normalizarSite(valor) {
  const invalido = () => new ErroConsulta("Informe um domínio público ou a URL de um site.");
  if (typeof valor !== "string" || valor.length > 4096) throw invalido();
  const texto = valor.trim();
  if (!texto || /[\s\\\p{Cc}\p{Cf}\p{Cs}]/u.test(texto)) throw invalido();
  const bruto = /^[a-z][a-z0-9+.-]*:\/\//i.test(texto) ? texto : "https://" + texto;
  const autoridade = /^https?:\/\/([^/?#]+)/i.exec(bruto);
  if (!autoridade || autoridade[1].includes("@") || autoridade[1].includes("%")) throw invalido();
  let url;
  try {
    url = new URL(bruto);
  } catch {
    throw invalido();
  }
  if (url.port || url.username || url.password) throw invalido();
  const dominio = hostCanonico(url.hostname);
  const partes = dominio.split(".");
  const sufixo = partes.at(-1);
  if (dominio.length > 253 || partes.length < 2 || !partes.every(p => rotuloDNS.test(p)) ||
      locais.has(sufixo) || /^\d+$/.test(sufixo) ||
      (partes.length === 2 && sufixo.length === 2 && categoriasPublicas.has(partes[0]))) {
    throw invalido();
  }
  return dominio;
}
