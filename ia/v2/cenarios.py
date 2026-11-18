"""Cenários autorais fictícios. Separação por família antes das variações.

Cada linha: ação editorial, objetivo, evidências (tipo, descrição, essencial).
Os textos simulam o que uma coleta hipotética teria observado; não são fontes reais.
"""

TREINO = {
    "corrigir_indexacao": [
        ("A oferta deveria aparecer nas buscas.", [("pagina", "O responsável confirmou que o noindex desta página pública foi aplicado por engano.", True), ("serp", "Um resultado antigo ainda exibe a página.", False)]),
        ("Revisar a página ativa da oferta.", [("pagina", "A oferta continua disponível, mas seu endereço retorna erro permanente por configuração indevida confirmada.", True)]),
        ("Verificar impedimentos confirmados.", [("pagina", "O servidor envia noindex para o destino comercial; o responsável confirmou que isso é acidental.", True), ("pagina", "Outra página do site funciona normalmente.", False)]),
    ],
    "melhorar_pagina": [
        ("Escolher uma mudança útil para quem busca a oferta.", [("serp", "A consulta é compatível com o serviço descrito no destino.", True), ("pagina", "A página oferece o serviço, mas não esclarece a área atendida.", True)]),
        ("Identificar uma lacuna observada.", [("pagina", "Há formulário de contato, porém sem rótulos associados aos campos observados.", True)]),
        ("Melhorar o atendimento de quem chega à oferta.", [("pagina", "A página apresenta o produto, mas o caminho para solicitar atendimento não é identificado no HTML coletado.", True), ("serp", "A consulta corresponde à oferta.", False)]),
    ],
    "validar_intencao": [
        ("Ver se a consulta corresponde à oferta.", [("serp", "A palavra é ambígua: pode representar profissão ou formação.", True), ("pagina", "O destino oferece um curso, não uma contratação.", True)]),
        ("Investigar adequação do destino.", [("serp", "A busca solicita instruções para conserto caseiro.", True), ("pagina", "O resultado do site é exclusivamente uma página de venda de serviço.", True)]),
        ("Escolher se vale trabalhar este termo.", [("serp", "O termo descreve atendimento numa cidade diferente da oferta.", True), ("pagina", "A empresa afirma atender apenas outra região.", True)]),
    ],
    "validar_demanda": [
        ("Escolher por onde começar.", [("pagina", "Somente o nome do serviço foi extraído; não há consulta nem procura observada.", True)]),
        ("Descobrir oportunidades.", []),
        ("Investigar termos sugeridos.", [("pagina", "A lista candidata veio de palavras do título; não há volume ou busca observada.", True)]),
    ],
    "medir_conversao": [
        ("Comparar o retorno financeiro das ofertas.", [("negocio", "Não são registrados contatos qualificados, vendas ou margem por oferta.", True), ("serp", "Existe posição observada para uma consulta.", False)]),
        ("Identificar onde há desperdício de investimento.", [("negocio", "Só existe gasto total de anúncios; não há despesas por termo nem conversões atribuídas.", True)]),
        ("Escolher investimento pela receita.", [("serp", "Duas consultas aparecem em posições diferentes.", False), ("negocio", "A empresa não relaciona vendas às páginas de destino e não registrou margem.", True)]),
    ],
    "atualizar_coleta": [
        ("Avaliar posição atual.", [("serp_antiga", "A captura é antiga e não comprova a posição atual.", True)]),
        ("Comparar os resultados atuais.", [("serp_antiga", "A coleta terminou em erro e não trouxe a resposta completa da fonte.", True)]),
        ("Verificar onde o site aparece.", [("serp_antiga", "A busca foi interrompida antes da profundidade solicitada.", True), ("pagina", "A página pública menciona a oferta.", False)]),
    ],
    "acompanhar": [
        ("Decidir o próximo passo para esta página.", [("serp", "A página correta está nas primeiras posições da consulta de marca.", True), ("pagina", "Oferta, informações e contato foram conferidos sem lacunas identificadas.", True)]),
        ("Reavaliar uma correção concluída.", [("pagina", "A informação de contato já foi corrigida e conferida novamente.", True), ("serp", "A consulta observada permanece relevante.", True)]),
        ("Verificar necessidade de mudança imediata.", [("serp", "A busca de marca leva à página adequada.", True), ("pagina", "Nenhum problema específico foi observado no destino verificado.", True)]),
    ],
    "comparar_concorrentes": [
        ("Entender a concorrência na busca.", [("serp_rivais", "Há outros domínios acima na mesma consulta e contexto; não se examinou o conteúdo deles.", True)]),
        ("Investigar diferenças sem assumir causas.", [("serp_rivais", "Os resultados da mesma busca mostram concorrentes na frente.", True), ("pagina", "Ainda não se comparou o conteúdo dos destinos concorrentes.", True)]),
        ("Preparar comparação de páginas.", [("serp_rivais", "A captura comparável identifica os domínios acima da página; as páginas deles não foram lidas.", True), ("pagina", "Não foi confirmada falha específica no destino próprio.", False)]),
    ],
}

VALIDACAO = {
    "corrigir_indexacao": [
        ("Checar impedimento de publicação.", [("pagina", "O proprietário confirmou a exclusão acidental por diretiva noindex na página que deve ser pública.", True)]),
        ("Qual correção verificar primeiro?", [("serp", "Há resultado anterior na consulta.", False), ("pagina", "Cabeçalho noindex acidental foi confirmado para o mesmo destino comercial.", True)]),
    ],
    "melhorar_pagina": [
        ("Avaliar acessibilidade do atendimento.", [("pagina", "A ação para enviar mensagem foi identificada sem nome acessível no HTML.", True)]),
        ("Definir mudança baseada na página.", [("serp", "A consulta corresponde à oferta.", True), ("pagina", "O serviço está descrito, mas não há informação sobre o prazo de atendimento observado.", True)]),
    ],
    "validar_intencao": [
        ("Conferir se o destino atende à busca.", [("serp", "A expressão buscada pode significar peça física ou serviço de instalação.", True), ("pagina", "O destino comercializa somente a peça.", True)]),
        ("Avaliar busca local.", [("pagina", "A empresa atende apenas a capital.", True), ("serp", "A consulta pede atendimento no interior.", True)]),
    ],
    "validar_demanda": [
        ("Descobrir uma oportunidade inicial.", [("pagina", "Um catálogo de serviços existe, mas não há medições de consulta ou procura.", True)]),
        ("Começar análise sem conta conectada.", []),
    ],
    "medir_conversao": [
        ("Apontar a oferta com maior retorno.", [("negocio", "Há custos totais, mas não se sabe quais consultas geraram clientes nem a margem.", True), ("serp", "As posições pertencem à mesma região.", False)]),
        ("Escolher orçamento usando resultado comercial.", [("negocio", "A empresa acompanha visitas, mas não contatos, vendas ou origem dos clientes.", True)]),
    ],
    "atualizar_coleta": [
        ("Saber quem está à frente hoje.", [("serp_antiga", "Os resultados são de datas diferentes e não podem ser comparados na mesma consulta.", True)]),
        ("Ver posição no contexto solicitado.", [("serp_antiga", "A única leitura ocorreu em outro dispositivo e região.", True)]),
    ],
    "acompanhar": [
        ("Escolher intervenção para o resultado de marca.", [("pagina", "Destino de marca correto, com contato e oferta claros; nenhum defeito identificado.", True), ("serp", "Busca de marca leva ao destino correto.", True)]),
        ("Decidir após ajuste de conteúdo.", [("pagina", "A informação ausente foi incluída e a nova captura confirmou a correção.", True), ("serp", "O mesmo destino aparece para a consulta observada.", True)]),
    ],
    "comparar_concorrentes": [
        ("Investigar resultados anteriores.", [("serp_rivais", "Os concorrentes estão acima na mesma busca, sem análise dos respectivos conteúdos.", True)]),
        ("Levantar hipóteses para uma consulta.", [("pagina", "Ainda não há defeito específico confirmado na página própria.", False), ("serp_rivais", "A mesma pesquisa lista outros destinos antes do site.", True)]),
    ],
}

# Famílias próprias, novas e não usadas na seleção. Todas artificiais e sem revisão especializada.
TESTE = {
    "corrigir_indexacao": [
        ("Verificar publicação da oferta.", [("pagina", "A equipe confirmou que a tag noindex não deveria estar no destino público.", True), ("serp", "Uma captura anterior ainda mostra o endereço.", False)]),
        ("Atuar sobre erro confirmado.", [("pagina", "O endereço da oferta ativa retorna página não encontrada por um erro de publicação confirmado.", True)]),
        ("Rever rastreamento indevido.", [("pagina", "O administrador confirmou que robots bloqueia acidentalmente o destino comercial público.", True)]),
        ("Examinar exclusão do destino.", [("pagina", "Cabeçalho da oferta contém exclusão acidental confirmada, embora a página inicial esteja correta.", True), ("pagina", "A página inicial está acessível.", False)]),
    ],
    "melhorar_pagina": [
        ("Melhorar a página observada.", [("pagina", "O formulário observado tem campos sem identificação acessível.", True)]),
        ("Qual conteúdo da oferta testar?", [("pagina", "O texto da oferta não informa as condições de atendimento, confirmadas como ausentes.", True)]),
        ("Escolher próximo ajuste para visitantes.", [("serp", "A consulta corresponde ao serviço oferecido.", True), ("pagina", "O destino não apresenta o escopo do serviço solicitado.", True)]),
        ("Revisar acesso ao contato.", [("pagina", "O botão de contato inspecionado não possui um nome acessível identificável.", True), ("serp", "Um resultado aponta para o mesmo destino.", False)]),
    ],
    "validar_intencao": [
        ("A consulta é adequada à oferta?", [("serp", "Quem busca o termo pode querer um manual ou uma empresa para executar o serviço.", True), ("pagina", "A página oferece apenas execução do serviço.", True)]),
        ("Decidir se esta palavra corresponde ao negócio.", [("pagina", "A empresa afirma atender outra região do país.", True), ("serp", "A consulta pede uma cidade fora daquela região.", True)]),
        ("Investigar divergência de formato.", [("serp", "A busca pede comparação de preços entre opções.", True), ("pagina", "O destino apresenta uma única oferta sem comparação.", True)]),
        ("Verificar uma consulta ambígua.", [("pagina", "O negócio vende equipamento e não oferece capacitação.", True), ("serp", "O termo tanto pode indicar treinamento quanto compra de equipamento.", True)]),
    ],
    "validar_demanda": [
        ("Escolher o primeiro trabalho de busca.", []),
        ("Encontrar oportunidades para o catálogo.", [("pagina", "Os nomes das ofertas foram extraídos do catálogo; nenhuma procura foi medida.", True)]),
        ("Priorizar a lista gerada por uma ferramenta.", [("pagina", "A lista de palavras veio apenas do conteúdo próprio e não possui fonte de demanda.", True)]),
        ("Avaliar potencial da oferta nova.", [("pagina", "Há uma oferta nova descrita, ainda sem termos observados em buscas.", True)]),
    ],
    "medir_conversao": [
        ("Dizer onde o orçamento retorna mais.", [("serp", "Uma página ocupa posição favorável.", False), ("negocio", "Não existe acompanhamento de contatos, vendas ou margem por página.", True)]),
        ("Avaliar se anúncios estão sendo desperdiçados.", [("negocio", "O total gasto é conhecido, mas não há custos por consulta ou conversões atribuídas.", True)]),
        ("Escolher qual oferta gera mais resultado financeiro.", [("negocio", "As visitas são registradas, porém não se sabe quantas geram clientes ou qual a margem.", True)]),
        ("Indicar aumento de investimento.", [("serp", "Duas consultas têm posições diferentes.", False), ("negocio", "Os dados de vendas e resultado por oferta estão ausentes.", True)]),
    ],
    "atualizar_coleta": [
        ("Comparar posições atuais.", [("serp_antiga", "O único registro é antigo e não permite afirmar a colocação de hoje.", True)]),
        ("Concluir verificação de busca.", [("serp_antiga", "O serviço de consulta retornou erro antes de completar os resultados.", True)]),
        ("Saber se o concorrente está à frente.", [("serp_antiga", "A posição do concorrente veio de outra data e dispositivo; não há comparação no mesmo contexto.", True)]),
        ("Determinar presença no recorte.", [("serp_antiga", "A consulta foi interrompida antes de verificar as páginas planejadas.", True), ("pagina", "A oferta está descrita no site.", False)]),
    ],
    "acompanhar": [
        ("Intervir ou acompanhar a busca de marca?", [("serp", "A consulta de marca leva ao destino correto.", True), ("pagina", "Informações e contato foram conferidos, sem defeito específico observado.", True)]),
        ("Escolher passo após corrigir a página.", [("pagina", "A ausência de contato foi corrigida e confirmada na captura mais recente.", True), ("serp", "O destino continua associado à consulta.", True)]),
        ("Rever a página já alinhada.", [("pagina", "Serviço, área e contato estão presentes e correspondem à busca; nenhuma falha concreta identificada.", True), ("serp", "A consulta aponta ao destino esperado.", True)]),
        ("Há uma mudança necessária no resultado de marca?", [("serp", "Resultado de marca apresenta a página correta.", True), ("pagina", "Não foi identificada uma lacuna específica na página analisada.", True)]),
    ],
    "comparar_concorrentes": [
        ("Investigar a concorrência sem supor causa.", [("serp_rivais", "Domínios anteriores foram capturados na mesma busca; seus conteúdos não foram examinados.", True)]),
        ("Entender quais destinos comparar.", [("serp_rivais", "A página está abaixo de outros resultados no mesmo contexto e horário.", True), ("pagina", "As páginas concorrentes ainda não foram estudadas.", True)]),
        ("Levantar hipóteses sobre outra empresa à frente.", [("serp_rivais", "A mesma consulta mostra um diretório acima do site.", True), ("pagina", "Não foi verificada uma falha própria que explique a ordem.", False)]),
        ("Onde buscar ideias para este termo?", [("serp_rivais", "Foram observados destinos de concorrentes acima; não se conhece a causa nem o conteúdo deles.", True)]),
    ],
}
