/** Local indicators for review, not a grammar parser or semantic approval.
 * No interpretation or original source is rewritten to make a frame pass.
 */
const normal=v=>typeof v==='string'?v.normalize('NFKC').toLocaleLowerCase('pt-BR').replace(/\s+/gu,' ').trim():'';
const IMPERATIVOS=new Set(['conecte','contrate','solicite','descubra','acesse','utilize','comece','transforme','escolha','experimente']);
const PRIMEIRA_PESSOA=new Set(['oferecemos','temos','somos','reunimos','disponibilizamos']);

export function revisarEstruturaProposicao(p){
  const u=normal(p?.unidadeLiteral?.texto),s=normal(p?.sujeito),a=normal(p?.acao),o=normal(p?.objeto),motivos=[];
  if(!u)return{versao:1,estado:'sem_unidade_para_conferencia',motivos:[],explicacao:'A conferência estrutural depende da unidade literal preservada.'};
  const adjunto=/^(?:na|no|nas|nos|em|com|para)\s+([^,;:!?]{1,140})[,;:]/u.exec(u);
  const semArtigo=v=>v.replace(/^(?:a|o|as|os|um|uma)\s+/u,'');
  if(s&&adjunto&&semArtigo(adjunto[1].trim())===semArtigo(s))motivos.push('adjunto_inicial_confundido_com_sujeito');
  const verbo=a.split(' ')[0];
  if(verbo==='ideal'&&/\bideal\s+para\b/u.test(u))motivos.push('adjetivo_de_finalidade_no_campo_da_acao');
  if(IMPERATIVOS.has(verbo))motivos.push('imperativo_nao_publica_ator_da_operacao');
  if(PRIMEIRA_PESSOA.has(verbo)&&!/(?:^|\s)(?:nós|nos|eu)(?:$|\s)/u.test(s))motivos.push('primeira_pessoa_sem_sujeito_literal_explicito');
  if(/^(?:para (?:a |o )?(?:criação|criacao|gestão|gestao|emissão|emissao|treinamento|desenvolvimento|capacitação|capacitacao|aprendizagem|formação|formacao)|numa |em uma |em um |de |com |sem )/u.test(a))motivos.push('complemento_nominal_no_campo_da_acao');
  if(PRIMEIRA_PESSOA.has(s)||/^(?:temos|somos|oferecemos|reunimos)\s/u.test(s))motivos.push('fragmento_verbal_no_campo_do_sujeito');
  if(p?.tipoSujeito==='ferramenta'&&p?.escopo==='fornecimento'&&/^(?:aceita|registra|processa|automatiza)$/u.test(a)&&/pagamentos?|cobranças?|cobrancas?|cartão|cartao|boleto|pix|checkout/u.test(o))motivos.push('funcao_de_pagamento_confundida_com_fornecimento');
  if(p?.escopo==='transacao_do_cliente'&&/\b(?:teste (?:grátis|gratis|gratuito)|testar a plataforma)\b/u.test(u)&&/^(?:terá|tera|testa|avalia)$/u.test(a))motivos.push('teste_da_oferta_nao_e_transacao_do_cliente');
  if(/(?:ar|er|ir)$/u.test(verbo)&&[...u.matchAll(/\b(?:feit[oa]s?|destinad[oa]s?|desenvolvid[oa]s?)\s+para\s+(?<verbo>\p{L}+)\b/gu)].some(m=>m.groups.verbo===verbo))motivos.push('finalidade_no_campo_de_atividade');
  const explicacoes={imperativo_nao_publica_ator_da_operacao:'A ação tem forma de instrução ao leitor. Um recurso ou objeto citado no mesmo trecho não fica identificado como quem executa essa instrução.',primeira_pessoa_sem_sujeito_literal_explicito:'A publicação usa primeira pessoa, mas a proposição atribuiu a ação a outra expressão. Confira quem é o sujeito; o objeto oferecido não oferece a si próprio.',complemento_nominal_no_campo_da_acao:'O campo da ação contém um complemento nominal ou preposicional. Preserve a fonte e revise a estrutura sem fabricar um verbo.',fragmento_verbal_no_campo_do_sujeito:'A expressão usada como sujeito contém o próprio verbo da publicação. Ela não identifica por si uma pessoa, organização ou ferramenta.',funcao_de_pagamento_confundida_com_fornecimento:'O trecho descreve uma função de pagamento da ferramenta. Ele não demonstra desenvolvimento, fornecimento de licença ou quem paga pelo software.'};
  explicacoes.adjunto_inicial_confundido_com_sujeito='O trecho inicial introduz lugar, meio ou destinatário por uma preposição, separado por vírgula ou dois-pontos. A expressão foi apresentada como sujeito, mas a publicação precisa ser revista para identificar quem realiza a ação. Não substitua o ator automaticamente.';
  explicacoes.adjetivo_de_finalidade_no_campo_da_acao='O campo da ação contém o adjetivo “ideal” de uma expressão de finalidade. Preserve a descrição nominal sem apresentá-la como verbo ou operação executada por uma empresa.';
  explicacoes.teste_da_oferta_nao_e_transacao_do_cliente='O trecho trata de experimentar a própria oferta. Ele não demonstra venda, cobrança ou transação realizada pelo cliente final da empresa usuária.';
  explicacoes.finalidade_no_campo_de_atividade='A ação foi extraída de uma expressão de finalidade, como “feita para”. Confira a construção antes de apresentá-la como uma atividade com executor identificado.';
  return{versao:1,estado:motivos.length?'requer_revisao_estrutural':'sem_indicio_local',motivos,explicacao:motivos.map(m=>explicacoes[m]).join(' '),revisaoSemantica:'pendente',limite:'São indicadores conservadores para conferência; a ausência deles não certifica gramática, papéis ou escopo.'};
}

export function revisarEstruturaCondicao(c,oferta){
  const motivos=[];
  if(c?.categoria==='prazo'&&c?.alcance==='oferta'&&oferta?.natureza==='software'&&/\b(?:suporte|atendimento)\b/u.test(normal(c.aplicaA))&&!/\b(?:suporte|atendimento)\b/u.test(normal(oferta.nome)))motivos.push('prazo_de_suporte_nao_e_disponibilidade_da_oferta');
  const unidade=normal(c?.unidadeLiteral?.texto),objeto=normal(c?.aplicaA);
  if(unidade&&objeto===unidade&&objeto.split(' ').length>6)motivos.push('frase_inteira_nao_e_objeto_da_condicao');
  const duracao=/^(?:até\s+)?(?:\d+|um|uma|dois|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:dias?|horas?|meses?|semanas?|anos?)(?:\s+(?:úteis|uteis|corridos|corridas))?[.!]?$/u;
  for(const campo of ['gatilho','modalidade'])if(duracao.test(normal(c?.[campo])))motivos.push('duracao_nao_e_'+campo);
  const explicacoes={prazo_de_suporte_nao_e_disponibilidade_da_oferta:'O objeto publicado é suporte ou atendimento. Esse prazo não deve ser apresentado como disponibilidade geral, implantação ou execução da oferta.',frase_inteira_nao_e_objeto_da_condicao:'O campo do objeto repete a frase inteira da condição. Preserve a unidade e confira qual atividade ou objeto está sujeito à regra.',duracao_nao_e_gatilho:'O campo de início contém somente uma duração. A publicação ainda precisa identificar o evento a partir do qual ela é contada.',duracao_nao_e_modalidade:'O campo de modalidade contém somente uma duração. Isso não identifica uma versão, plano ou modalidade da oferta.'};
  return{versao:1,estado:motivos.length?'requer_revisao_estrutural':'sem_indicio_local',motivos,
    explicacao:motivos.map(m=>explicacoes[m]).join(' '),revisaoSemantica:'pendente'};
}
