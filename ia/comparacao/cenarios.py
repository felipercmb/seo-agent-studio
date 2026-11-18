"""Pares hipotéticos: primeira opção observável versus a segunda, ou insuficiência."""

TREINO_PRIORIZAR = [
    ("A página do serviço tem formulário com campos sem nome acessível.", "A outra oferta apenas aparece em uma lista de termos sugeridos."),
    ("O destino da oferta está sem orientação de contato, observada no HTML.", "A segunda palavra foi gerada pelo título e não possui captura."),
    ("A descrição da oferta não informa a área atendida, conferida na página.", "O outro termo não tem posição ou conteúdo analisado."),
    ("Um botão de contato do destino foi inspecionado sem nome acessível.", "O concorrente mencionado na outra opção ainda não foi verificado."),
    ("A página de serviço omite o que está incluído na oferta, observação conferida.", "O outro destino não foi coletado e a posição é desconhecida."),
    ("Na página examinada, o campo de mensagem não tem rótulo associado.", "A segunda alternativa é só um termo extraído do site."),
    ("O escopo do serviço está ausente da página de oferta observada.", "A captura antiga da outra alternativa já não mostra dados atuais."),
    ("O caminho de solicitação de atendimento não é encontrado na página coletada.", "Para a outra consulta não há fonte ou página identificada."),
    ("O formulário para contato possui rótulos ausentes na página inspecionada.", "Não foi verificada a intenção da outra palavra nem seu destino."),
    ("A área de atendimento não consta da oferta verificada.", "A outra opção veio apenas de uma lista automática de candidatos."),
    ("Na oferta examinada, um botão de ação está sem nome acessível.", "Uma coleta da outra palavra falhou e não trouxe resultados."),
    ("As condições do atendimento não aparecem no destino correspondente.", "Da segunda opção só se conhece uma expressão do título da página."),
]
TREINO_INSUFICIENTE = [
    ("Uma consulta tem posição observada, mas não há demanda, conversão ou margem.", "A outra consulta tem outra posição observada, também sem dados comerciais.", "retorno"),
    ("Uma opção tem um botão sem nome acessível.", "A outra tem um campo de formulário sem rótulo.", "ambos"),
    ("O primeiro candidato foi extraído do site sem captura.", "O segundo também é apenas uma palavra sugerida.", "ambos"),
    ("A primeira página tem uma lacuna de escopo observada.", "A segunda tem ausência de informação de contato observada.", "ambos"),
    ("Uma página aparece na primeira página; não há volume ou vendas.", "A outra aparece mais abaixo; não há volume ou vendas.", "retorno"),
    ("Uma captura está vencida e não há página analisada.", "A fonte falhou para a segunda e também não há página analisada.", "ambos"),
]
VALID_PRIORIZAR = [
    ("O botão de orçamento coletado não apresenta nome acessível.", "A outra opção é apenas uma lista de possíveis palavras."),
    ("O destino da oferta não descreve a área de atendimento observada.", "A segunda palavra não foi pesquisada nem tem página alvo conhecida."),
    ("O campo de telefone do formulário não tem rótulo associado no HTML.", "O segundo destino não foi inspecionado e a captura é antiga."),
    ("A página não informa o escopo do serviço, conforme a coleta.", "Não há evidência sobre a outra palavra além do título do site."),
]
VALID_INSUFICIENTE = [
    ("Há posição para uma palavra, mas não há dados de receita.", "Outra palavra tem posição diferente e também não tem dados comerciais.", "retorno"),
    ("Uma página apresenta campo sem rótulo.", "A outra apresenta botão sem nome acessível.", "ambos"),
]
TEST_PRIORIZAR = [
    ("A captura da oferta mostra campo de contato sem rótulo acessível.", "O segundo termo foi sugerido sem observação de busca ou página."),
    ("A página inspecionada não apresenta o caminho para pedir atendimento.", "A segunda consulta não teve página de destino identificada."),
    ("A página do serviço não explica a região atendida, conforme a coleta.", "O registro da outra pesquisa falhou antes de trazer evidências."),
    ("O botão de enviar na página observada não tem nome acessível.", "A alternativa está numa lista de candidatos sem captura válida."),
    ("O escopo da oferta não está descrito no destino analisado.", "O outro termo não possui posição atual ou conteúdo examinado."),
    ("No formulário analisado, o campo de e-mail não tem identificação associada.", "O outro contexto só traz posição antiga e desconhecida no presente."),
]
TEST_INSUFICIENTE = [
    ("O primeiro termo tem uma posição observada sem dados de demanda ou vendas.", "O segundo tem posição diferente sem demanda ou vendas atribuídas.", "retorno"),
    ("A primeira página tem uma lacuna de contato observada.", "A segunda apresenta um botão sem nome acessível observado.", "ambos"),
    ("A primeira palavra é uma candidata ainda não verificada.", "Da outra palavra também não há posição ou conteúdo coletado.", "ambos"),
]
