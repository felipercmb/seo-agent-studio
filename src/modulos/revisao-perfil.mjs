const objeto = valor => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
const texto = (valor, limite) => typeof valor === 'string'
  ? valor.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, limite) : '';
const lista = (valor, limite) => Array.isArray(valor)
  ? valor.slice(0, limite).map(v => texto(v, 100)).filter(Boolean) : [];
const iguais = (antes, depois) => JSON.stringify(antes) === JSON.stringify(depois);
function atividadesDoPerfil(perfil) {
  const mapa=new Map();
  for(const a of (Array.isArray(perfil.entendimento?.atuacoes)?perfil.entendimento.atuacoes:[]).filter(a=>['programa_social','captacao','participacao'].includes(a?.tipo)).slice(0,8)){
    const item={tipo:a.tipo,nome:texto(a.nome,120),url:texto(a.url,2048) || null};
    if(item.nome)mapa.set(JSON.stringify(item),item);
  }
  return mapa;
}

function ofertasDoPerfil(perfil) {
  const ofertas = new Map();
  for (const oferta of perfil.ofertas.slice(0, 8)) {
    if (!objeto(oferta)) continue;
    const nome = texto(oferta.nome, 120);
    if (!nome) continue;
    const id = texto(oferta.id, 120) || null;
    const chave = id ? 'id:' + id : 'nome:' + nome.normalize('NFC').toLocaleLowerCase('pt-BR');
    if (ofertas.has(chave)) throw new TypeError('O perfil contém ofertas sem identificação única.');
    // The financial values stay private to the comparison and never enter its
    // public result. Unknown and absent share the same meaning; zero does not.
    ofertas.set(chave, {
      publicos:{id, nome, url:texto(oferta.url, 2048) || null},
      centralidade:texto(oferta.centralidade?.nivel,40) || null,
      jornada:oferta.jornada || null,
      entrega:oferta.entrega || null,
      economia:{contribuicaoPorVenda:oferta.economia?.contribuicaoPorVenda ?? null,
        taxaFechamento:oferta.economia?.taxaFechamento ?? null,premissas:oferta.premissasEconomicas ?? null},
    });
  }
  return ofertas;
}

function economiaMudou(antes, depois) {
  const a = antes?.economia || {}, d = depois?.economia || {};
  return (a.contribuicaoPorVenda ?? null) !== (d.contribuicaoPorVenda ?? null) ||
    (a.taxaFechamento ?? null) !== (d.taxaFechamento ?? null) || !iguais(a.premissas??null,d.premissas??null);
}

/** Records an owner's declarations without changing either profile, generating
 * evidence, executing tools or treating a correction as model training. */
export function compararRevisaoPerfil(antes, depois) {
  if (!objeto(antes) || !objeto(depois) || !Array.isArray(antes.ofertas) || !Array.isArray(depois.ofertas) ||
      antes.dominio && depois.dominio && antes.dominio !== depois.dominio) {
    throw new TypeError('Informe dois perfis do mesmo projeto para comparar a revisão.');
  }
  const campos = [];
  const entradas = [
    ['nome', p => texto(p.nome, 120)],
    ['resumo', p => texto(p.resumo, 1600)],
    ['publico', p => texto(p.publico, 500)],
    ['papel', p => texto(p.entendimento?.papel ?? p.papel, 40)],
    ['finalidade', p => texto(p.entendimento?.finalidade?.tipo,40)],
    ['regioes', p => lista(p.regioes, 5)],
    ['exclusoes', p => lista(p.exclusoes, 15)],
    ['estado', p => texto(p.estado, 40)],
  ];
  for (const [campo, obter] of entradas) {
    const a = obter(antes), d = obter(depois);
    if (!iguais(a, d)) campos.push({campo, antes:a, depois:d});
  }
  const a = ofertasDoPerfil(antes), d = ofertasDoPerfil(depois);
  const ofertas = {adicionadas:[], removidas:[], alteradas:[]};
  let economiaAlterada = false;
  for (const [chave, original] of a) {
    const atual = d.get(chave);
    if (!atual) {
      ofertas.removidas.push({...original.publicos});
      economiaAlterada ||= economiaMudou(original, null);
      continue;
    }
    const alterados = ['nome', 'url'].filter(campo => original.publicos[campo] !== atual.publicos[campo]);
    if(original.centralidade!==atual.centralidade)alterados.push('centralidade');
    if(!iguais(original.jornada,atual.jornada))alterados.push('jornada');
    if(!iguais(original.entrega,atual.entrega))alterados.push('entrega');
    if (economiaMudou(original, atual)) { alterados.push('economia'); economiaAlterada = true; }
    if (alterados.length) ofertas.alteradas.push({id:atual.publicos.id,
      antes:{nome:original.publicos.nome, url:original.publicos.url},
      depois:{nome:atual.publicos.nome, url:atual.publicos.url}, campos:alterados,
      ...(!iguais(original.entrega,atual.entrega)?{entrega:{antes:original.entrega,depois:atual.entrega}}:{}),
      ...(original.centralidade!==atual.centralidade?{centralidade:{antes:original.centralidade,depois:atual.centralidade}}:{})});
  }
  for (const [chave, atual] of d) {
    if (!a.has(chave)) {
      ofertas.adicionadas.push({...atual.publicos});
      economiaAlterada ||= economiaMudou(null, atual);
    }
  }
  if (economiaAlterada) campos.push({campo:'economia', alterado:true});
  const aa=atividadesDoPerfil(antes),ad=atividadesDoPerfil(depois);
  const atuacoes={adicionadas:[...ad.entries()].filter(([k])=>!aa.has(k)).map(([,v])=>v),
    removidas:[...aa.entries()].filter(([k])=>!ad.has(k)).map(([,v])=>v)};
  return {versao:1, origem:'declaracao_usuario', campos, ofertas, atuacoes, economiaAlterada,
    nota:'Esta revisão registra declarações do usuário, incluindo rascunhos, e não confirma fatos do site, posições ou procura no Google. Não treina modelos. Os campos de contribuição e taxa de fechamento não são copiados; apenas sua alteração é indicada. Textos revisados podem conter valores digitados. Quando a identificação de uma oferta muda, registramos remoção e adição, sem presumir equivalência por posição ou página. O recorte inclui até oito ofertas.'};
}
