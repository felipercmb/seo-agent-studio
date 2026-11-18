const lista=v=>Array.isArray(v)?v:[];
const normal=v=>typeof v==='string'?v.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/gu,' ').trim():'';
const relato=/\b(?:depoimentos?|testimonials?|reviews?|casos? de sucesso|cases? de sucesso|historias? de sucesso|customer stor(?:y|ies)|success stor(?:y|ies)|quem usa recomenda|o que (?:os |nossos )?clientes (?:dizem|contam|falam))\b/u;
const resultadoCliente=/\b(?:clientes|empresas|equipes|organizacoes|construtoras|negocios)\s+que\s+(?:transformaram|revolucionaram|cresceram|otimizaram|mudaram|alcancaram)\b/u;

/** A contextual label is a reason to withhold a claim of own activity.
 * No label is treated as independent verification of the speaker's identity. */
export function classificarOrigemPublicada(f={}){
  const secoes=[f.secao,...lista(f.contexto?.titulos??f.titulos).map(h=>h?.texto),f.contexto?.tituloPagina].map(normal).filter(Boolean);
  const marcador=secoes.find(s=>relato.test(s)||resultadoCliente.test(s));
  if(marcador)return{estado:'relato_ou_resultado_de_terceiro',motivo:'rotulo_contextual_de_cliente_ou_depoimento',marcador,atividadePropriaConfirmada:false};
  const trecho=normal(f.trecho||f.texto);
  const avaliacao=/^["“”']?\s*(?:[⭐★]\ufe0f?\s*){3,5}/u.exec(trecho);
  if(avaliacao)return{estado:'relato_ou_resultado_de_terceiro',motivo:'formato_de_avaliacao_publicada_sem_autoria_verificada',marcador:avaliacao[0],autoriaConfirmada:false,atividadePropriaConfirmada:false};
  return{estado:'nao_determinada',motivo:'sem_rotulo_explicito_de_terceiro',atividadePropriaConfirmada:false};
}
