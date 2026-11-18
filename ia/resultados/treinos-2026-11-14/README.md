# Treinamentos locais de 14 de novembro de 2026

Foram executados quatro ajustes QLoRA no Mac: duas variantes do agente de ações, um comparador de oportunidades e uma terceira rodada do agente de ações. Todos partiram do mesmo Qwen2.5-1.5B quantizado; os pesos originais ficaram congelados. Os treinamentos somaram aproximadamente **24 minutos**, além do tempo de preparação e avaliação. Os adaptadores e logs completos ficaram em `data/ia/` no computador.

**O sistema continua experimental e depende de revisão humana.** Os exemplos, expectativas e contraprovas são sintéticos, escritos pela mesma autoria e não revisados por um especialista em SEO. Os números não demonstram aumento de tráfego, de posições ou de receita em clientes reais.

## Agente de ações: segunda rodada

A variante selecionada na validação usou o checkpoint de 240 passos entre oito candidatos das variantes A e B. Em 24 casos de validação, ela coincidiu com a ação esperada e o conjunto exato de referências em 22. A seleção foi congelada antes de abrir o teste.

| Medida em 32 casos reservados | Modelo-base | Modelo ajustado |
| --- | ---: | ---: |
| Ação editorial esperada | 17/32 | 32/32 |
| Ação e referências exatas, juntas | 10/32 | 20/32 |

Na geração restrita usada na comparação, o JSON foi válido em todos os casos **por construção da gramática**. Em uma geração livre adicional, o modelo-base produziu objeto JSON em 24/32 casos e cumpriu o contrato em 0/32; o ajustado produziu objeto e cumpriu o contrato em 32/32. Mesmo assim, ele continuou citando um conjunto de referências diferente do alvo em 12/32 casos.

Em outras 16 contraprovas, que só perguntavam se ações específicas previamente definidas como proibidas foram evitadas, o modelo-base evitou essas ações em 9 e o ajustado em **8**. O modelo sugeriu, por exemplo, corrigir uma exclusão intencional e comparar capturas incompatíveis. As barreiras de integração definidas antes do teste bloquearam as oito saídas que infringiram esses critérios. Isso não estabelece proteção geral.

- [Modelo-base: teste](v2b-base-teste.json) · [ajustado: teste](v2b-treinado-teste.json).
- [Modelo-base: contraprovas](v2b-base-estresse.json) · [ajustado: contraprovas](v2b-treinado-estresse.json) · [auditoria das barreiras](v2b-auditoria-barreiras.json).
- [Geração livre do modelo-base](v2b-base-livre.json) · [geração livre do ajustado](v2b-treinado-livre.json) · [seleção e validação](v2-selecao.json).

## Agente de ações: terceira rodada

Os dados da segunda rodada, **inclusive os testes já observados**, foram promovidos ao treino. A terceira rodada adicionou as ações de confirmar a intenção de publicação e preservar uma exclusão informada como intencional. Os novos conjuntos continham 590 exemplos de treino em 175 famílias, 20 casos de validação e 30 novos casos de teste. O checkpoint de 240 passos foi selecionado pela validação antes da avaliação final.

| Medida nos 30 novos casos | Modelo-base | Modelo ajustado |
| --- | ---: | ---: |
| Ação editorial esperada | 9/30 | 29/30 |
| Ação e referências exatas, juntas | 8/30 | 27/30 |
| Falhas graves **predefinidas** | 2/30 | 0/30 |

As falhas graves são um subconjunto específico, como sugerir corrigir uma exclusão intencional ou comparar resultados antigos. Não abrangem todos os erros possíveis. O modelo ajustado não escolheu nenhuma das ações previamente proibidas nas 16 novas contraprovas, mas isso **não significa 16 recomendações corretas**: em uma delas, classificou uma questão de exclusão intencional como investigação de intenção de busca; em outras, sugeriu validar demanda quando deveria confirmar a intenção de publicação.

Depois de observar esses erros, foram adicionadas barreiras para exigir uma página e uma busca recentes na análise de intenção e para não tratar uma exclusão como intencional sem confirmar com o responsável. Elas têm testes de regressão, mas **ainda não foram verificadas em outro conjunto independente**. Os resultados da tabela mostram as escolhas brutas do modelo, anteriores a essas barreiras.

- [Modelo-base: teste](v3-base-teste.json) · [ajustado: teste](v3-treinado-teste.json).
- [Modelo-base: contraprovas](v3-base-estresse.json) · [ajustado: contraprovas](v3-treinado-estresse.json) · [seleção e validação](v3-selecao.json).
- [Como treinar e usar a terceira rodada](../../../docs/EXPERIMENTOS-IA-V3.md).

Os testes das rodadas dois e três são diferentes. **Não se deve comparar seus percentuais como se fossem a mesma amostra.** Os casos da segunda rodada foram observados e depois usados no treino da terceira.

## Comparador de oportunidades

O comparador escolhe qual de dois contextos parece ter evidência mais específica para investigar primeiro ou declara `insuficiente`. A escolha não representa previsão de retorno. Cada caso aparece novamente com a ordem das alternativas invertida.

| Medida no teste reservado | Modelo-base | Modelo ajustado |
| --- | ---: | ---: |
| Decisão esperada | 7/18 | 18/18 |
| Pares corretos nas duas ordens | 0/9 | 9/9 |
| Priorização sem base quando o alvo era insuficiente | 5/6 | 0/6 |

Em 16 contraprovas adicionais, o modelo ajustado coincidiu com o alvo em **13/16**, com os dois lados corretos em 5 de 8 pares. Em um dos oito casos cujo alvo era `insuficiente`, priorizou uma alternativa. As três falhas ocorreram em pares inconsistentes ao inverter a ordem e ficaram inconclusivas pelo verificador da integração. Isso é uma observação desses casos, não garantia para todos os pares.

Ao ler um relatório local previamente coletado de `python.org`, tanto o modelo-base quanto o ajustado mudaram de escolha ao inverter a ordem nas três comparações disponíveis; a integração marcou as três como inconclusivas. Essa foi uma prova de funcionamento sem avaliação profissional do conteúdo, e evidencia que o bom resultado sintético não garante utilidade em um relatório real.

- [Modelo-base: teste](comparacao-base-teste.json) · [ajustado: teste](comparacao-treinado-teste.json).
- [Modelo-base: contraprovas](comparacao-base-estresse.json) · [ajustado: contraprovas](comparacao-treinado-estresse.json) · [auditoria de inversão](comparacao-auditoria-barreiras.json) · [seleção](comparacao-selecao.json).
- [Como treinar e comparar oportunidades](../../../docs/EXPERIMENTOS-IA-V2.md#comparar-hipóteses-duas-a-duas).

## O que está salvo

As configurações e resultados sintéticos estão neste diretório; os pesos, logs integrais, relatórios do aplicativo e testes locais permanecem em `data/ia/`, que é ignorado pelo Git. O projeto não enviou dados de clientes ou pesos treinados a serviços externos nesta rodada.

Para uma avaliação convincente, o próximo conjunto precisa de análises de clientes autorizadas e revisadas por profissionais, com fontes e informações disponíveis no momento da decisão. É necessário reservar clientes e períodos não vistos para testar o modelo. Sem dados de demanda, conversão, custo e margem, a aplicação não pode dizer qual palavra terá maior retorno ou onde existe desperdício em anúncios.
