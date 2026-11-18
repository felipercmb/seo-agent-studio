const duracao = String.raw`\d{1,4}\s+(?:horas?|dias?|semanas?|mês|meses)(?:\s+(?:úteis|corrid[oa]s))?(?![\p{L}\p{N}])`;
const acao = String.raw`(?<acao>[^,;.!?]{8,180}?)`;
const regras = [
  ['duracao_maxima', new RegExp(String.raw`^(?<marco>(?:Assim que|Depois que|Ap[oó]s)\s+[^,;.!?]{4,160}),\s+${acao}\s+(?<prazo>(?:em )?at[eé]\s+${duracao})(?=[,;.!?]|\s|$)`, 'diu')],
  ['duracao_maxima', new RegExp(String.raw`^${acao}\s+(?<prazo>(?:em )?at[eé]\s+${duracao}),?\s+(?<marco>(?:ap[oó]s|depois d[aeo])\s+[^,;.!?]{3,160})(?=[,;.!?]|$)`, 'diu')],
  ['inicio_depois_do_marco', new RegExp(String.raw`^${acao}\s+(?<prazo>(?:somente|apenas)\s+${duracao}),?\s+(?<marco>(?:ap[oó]s|depois d[aeo])\s+[^,;.!?]{3,160})(?=[,;.!?]|$)`, 'diu')],
  ['antecedencia_minima', new RegExp(String.raw`^${acao}\s+(?:com )?(?<prazo>(?:pelo menos|no m[ií]nimo)\s+${duracao}\s+de anteced[eê]ncia)\s+(?<marco>(?:em rela[çc][ãa]o (?:a|à|ao|às|aos)|antes d[aeo])\s+[^,;.!?]{3,160})(?=[,;.!?]|$)`, 'diu')],
  ['prazo_com_condicao_adicional', new RegExp(String.raw`^${acao}\s+(?<prazo>at[eé]\s+[oa]\s+dia\s+(?:seguinte|anterior)\s+(?:a|à|ao|d[ao])\s+[^,;.!?]{3,110}),\s+(?<marco>desde que\s+[^;.!?]{4,170})(?=[;.!?]|$)`, 'diu')],
  ['prazo_declarado', new RegExp(String.raw`^(?<marco>(?:Assim que|Depois que|Ap[oó]s)\s+[^,;.!?]{4,160}),\s+${acao}\s+(?<prazo>(?:com\s+(?:o\s+)?|no\s+)?prazo de\s+${duracao})(?=[,;.!?]|\s|$)`, 'diu')],
  ['imediato_sob_condicao', /^(?<marco>Se\s+[^,;.!?]{4,160}),\s+(?<acao>[^,;.!?]{8,180}?(?:cai(?:r[aá])?|chega(?:r[aá])?|fica dispon[ií]vel|(?:[eé]|ser[aá]) confirmad[oa]))\s+(?<prazo>na hora|imediatamente)(?=[,;.!?]|\s|$)/diu],
];
const sentencas = new Intl.Segmenter('pt-BR', {granularity:'sentence'});

/** Recover explicit deadlines and their references inside a complete passage.
 * Linking the sentence to a service, plan or responsible party is a separate review. */
export function lerPrazosPublicados(trecho) {
  if (typeof trecho !== 'string' || !trecho.trim() || trecho.length > 1600) return [];
  const prazos = [];
  for (const {segment,index} of sentencas.segment(trecho)) {
    const frase = segment.trim();
    if (/[?]["”']?$/u.test(frase)) continue;
    const inicio = index + segment.indexOf(frase);
    for (const [tipo, regra] of regras) {
      const m = regra.exec(frase);
      if (!m) continue;
      const campos = {};
      for (const campo of ['marco','acao','prazo']) {
        const [a,b] = m.indices.groups[campo];
        const texto = frase.slice(a,b).trim();
        const offset = inicio + a + frase.slice(a,b).indexOf(texto);
        campos[campo] = {texto,inicio:offset,fim:offset+texto.length};
      }
      prazos.push({tipo,frase,unidadeOffsets:'utf16_no_trecho',...campos});
      break;
    }
    if (prazos.length >= 3) break;
  }
  return prazos;
}
