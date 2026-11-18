// Trata parâmetros como uma unidade: em `max-image-preview: none`, o valor
// `none` não é a diretiva independente `none` (noindex + nofollow).
export function diretivasSemParametros(valor) {
  if (typeof valor !== 'string') return [];
  const tokens = valor.toLowerCase().match(/[a-z][a-z0-9_-]*(?:\s*:\s*[^,\s]+)?/g) || [];
  return tokens.filter(t => !t.includes(':'));
}

export function metaTemNoindex(valor) {
  return diretivasSemParametros(valor).some(t => t === 'noindex' || t === 'none');
}

export function metaTemNofollow(valor) {
  return diretivasSemParametros(valor).some(t => t === 'nofollow' || t === 'none');
}

const PARAMETRIZADAS = new Set(['max-snippet','max-image-preview','max-video-preview','unavailable_after']);
const DIRETIVAS = new Set(['all','index','noindex','follow','nofollow','none','noarchive','nosnippet',
  'notranslate','noimageindex','indexifembedded','nocache','noodp']);
const prefixo = parte => /^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i.exec(parte.trim());

/** Interpretação conservadora da representação normalizada pelo Fetch Headers.
 * Cabeçalhos repetidos podem ser mesclados por vírgula; escopos de outros
 * robôs tornam a ausência de noindex inconclusiva, nunca positiva para Google.
 */
export function classificarCabecalhoRobots(valor) {
  if (valor == null) return {estado:'ausente'};
  if (typeof valor !== 'string' || !valor.trim() || valor.length > 512 || /[\u0000-\u001f\u007f]/.test(valor)) return {estado:'inconclusivo'};
  let escopo='todos', duvida=false, leu=false;
  for (const parte of valor.split(',')) {
    let texto=parte.trim();
    if (!texto) {duvida=true;continue;}
    const p=prefixo(texto);
    if (p) {
      const nome=p[1].toLowerCase();
      if (PARAMETRIZADAS.has(nome)) {
        const parametro=p[2].trim().toLowerCase();
        leu=true;
        // Valores compostos ou não reconhecidos podem ocultar outra diretiva;
        // o parser não os transforma em uma afirmação negativa confiável.
        if (nome==='unavailable_after' || nome==='max-image-preview' && !['none','standard','large'].includes(parametro) ||
            ['max-snippet','max-video-preview'].includes(nome) && !/^(?:-1|\d+)$/.test(parametro)) duvida=true;
        continue;
      }
      escopo=nome;texto=p[2];
      if (escopo!=='googlebot') duvida=true;
    }
    const diretivas=diretivasSemParametros(texto);
    if (!diretivas.length) {duvida=true;continue;}
    leu=true;
    if ((escopo==='todos' || escopo==='googlebot') && diretivas.some(d=>d==='noindex'||d==='none')) {
      return {estado:'noindex',escopo,valor:valor.trim()};
    }
    if (diretivas.some(d=>!DIRETIVAS.has(d))) duvida=true;
  }
  return !leu || duvida ? {estado:'inconclusivo'} : {estado:'sem_noindex',valor:valor.trim()};
}

/** A descoberta prefere parar se um nofollow/none de qualquer escopo aparecer. */
export function cabecalhoPedeNaoSeguir(valor) {
  if (typeof valor !== 'string') return false;
  for (const parte of valor.split(',')) {
    const p=prefixo(parte);
    if (p && PARAMETRIZADAS.has(p[1].toLowerCase())) {
      if (metaTemNofollow(parte)) return true;
      continue;
    }
    if (metaTemNofollow(p ? p[2] : parte)) return true;
  }
  return false;
}
