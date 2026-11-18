# Jornadas de negócio com evidências

O experimento separa a oferta dos papéis de comprador, executor, beneficiário e pagador. O modelo propõe nomes e seleciona IDs; o programa copia as citações com página, seção e hash. Uma aceitação pelo contrato prova formato e apoio textual restrito, e continua com `revisaoSemantica: pendente` e `perfilConfirmado: false`.

`preparar.mjs` fornece a base inicial e um pool de fontes contextualizadas. `recuperacao.py` seleciona fontes adicionais por oferta com orçamento explícito, preserva as âncoras e remapeia os IDs sem cortar os trechos. A seleção é textual; não aprova o significado dos papéis. `executar.py` usa somente o modelo local registrado, sem requisição remota ou promoção automática de pesos.

## Dados controlados e treinamento

O gerador autoral tem 96 documentos, 48 entidades fictícias, 12 famílias e pares PT/EN dependentes. A divisão por família/entidade resulta em 128 tarefas de treino, 32 de validação e 28 reservadas. Não são 96 empresas reais nem rótulos revisados por especialista humano. Os autores conhecem os alvos; a reserva controlada não é um teste humano cego.

Execute a partir da raiz do projeto, com o ambiente e o modelo local já instalados. Nenhum destes comandos instala dependências ou baixa pesos:

```sh
.venv-ia/bin/python ia/negocio/jornadas/dados_controlados.py --saida CAMINHO_NOVO_CORPUS
.venv-ia/bin/python ia/negocio/jornadas/treinar.py --corpus CAMINHO_CORPUS --saida CAMINHO_NOVO_PREFLIGHT
```

Sem `--executar`, o segundo comando só verifica manifesto, divisões, mensagens, referências e tokenização. Não abre os alvos reservados, carrega pesos ou usa GPU. Se o protocolo mudar, regenere o corpus em uma pasta nova. Se a conversa exceder o limite informado, o preflight falha e conserva o recibo; não há truncamento silencioso.

O treino é um experimento LoRA separado, habilitado explicitamente:

```sh
.venv-ia/bin/python ia/negocio/jornadas/treinar.py --corpus CAMINHO_CORPUS --saida CAMINHO_NOVO_ADAPTADOR --passos 64 --max-sequencia 2048 --executar
```

A configuração fixa Qwen3.5-4B registrado, última camada q/v, rank 8, batch 1, máscara do prompt, checkpoint de gradiente, perda em blocos de 128 e orçamento de tensores MLX de 6 GiB. O limite não inclui toda a RAM do processo. O prazo padrão é 2400 segundos. Rode somente um treino/inferência GPU de cada vez no computador. Pesos anteriores e seleção padrão permanecem intactos. Recibos diferenciam tentativa de treino de adaptador efetivamente gravado, registram hashes, configuração, código, logs e dados copiados. Um loss menor não comprova interpretação melhor.

## Avaliação do candidato

```sh
.venv-ia/bin/python ia/negocio/jornadas/avaliar.py --corpus CAMINHO_CORPUS --saida CAMINHO_NOVO_BASE --split validation
.venv-ia/bin/python ia/negocio/jornadas/avaliar.py --corpus CAMINHO_CORPUS --saida CAMINHO_NOVO_CANDIDATO --split validation --adaptador CAMINHO_ADAPTADOR
```

O padrão `--modo cascata` identifica ofertas e encaminha a primeira aceita para a jornada; não escolhe uma oferta correta do gabarito para esconder erro de roteamento. Se nenhuma oferta for aceita, a jornada fica não executada e conserva as omissões. `--modo condicional` é um diagnóstico separado com a oferta de referência fornecida, e não recebe pontuação de compreensão em cascata. `--limite-casos N` escolhe somente o prefixo da ordem do corpus e registra a seleção.

As métricas separam estrutura, acordo de conteúdo, conteúdo com referências, precisão/recall por campo, papéis desconhecidos inventados, omissões, recusas e roteamento. Conteúdo usa apenas normalização Unicode, caso e espaços; não contém sinônimos ou exceções por empresa. Listas e IDs de fontes aceitam ordem diferente, enquanto duplicatas continuam como excesso. Um nome correto com fonte inventada pode coincidir no conteúdo, mas falha na referência e no contrato. Itens recusados continuam contando como falsos positivos da saída bruta. Sem itens gerados ou esperados, precisão/recall são `null` quando o denominador é zero, nunca 100% artificial.

Cada etapa salva saída bruta, resultado validado e identidade do prompt; uma etapa anterior é preservada se a seguinte falhar. A avaliação carrega o modelo uma vez e não altera o produto. Resultados controlados não demonstram resultado comercial, posições atuais do Google ou prontidão autônoma para clientes. Compare também empresas reais com dados reservados e revisão independente.

O resumo conserva os casos e as tarefas selecionados no denominador, mostra tentados, fluxos concluídos, casos interrompidos e não iniciados, e inclui as etapas parciais nas métricas observadas. Um fluxo concluído pode conter uma jornada não executada por falta de oferta aceita; isso não é uma constatação de ausência real da oferta. Precisão/recall de itens usam somente saídas observadas e precisam ser lidos junto à cobertura. Uma geração interrompida ou recusada por orçamento não pode ganhar acerto de roteamento, mesmo se o alvo estiver vazio. A avaliação não impõe prazo de parede próprio; registra exceções e interrupção manual. Um processo encerrado à força antes do `finally` conserva o recibo incremental sem estado de conclusão.

O executor pode recusar dúvidas extensas por inteiro sem modificar ofertas, atores ou condições. A saída bruta e `posProcessamento` ficam salvos. A avaliação separa estruturas válidas antes/depois desse tratamento e conta gerações tratadas; o tratamento é programático, aplicado igualmente à base e ao candidato, e não deve ser apresentado como melhoria dos pesos. `conferir_comparabilidade(base, candidato)` recusa comparar recibos incompletos ou com código, dependências, configuração, manifesto de dados, seleção, divisão, modo ou proveniência de modelo-base diferentes. Essa conferência técnica não comprova significância nem generalização.

Para abrir a reserva controlada, use `--split reserve --abrir-reserva --congelamento REGISTRO.json` depois de congelar código, candidato, configuração e critérios. O registro deve conter `versao: 1` e `codigoSha256` com os SHA atuais de `ia/negocio/jornadas/{avaliar,contrato,protocolo,executar,recuperacao}.py`. O avaliador verifica esses fontes antes de abrir os alvos. O registro prova uma versão declarada, não que o autor nunca conheceu os padrões do corpus. Não reabra a reserva repetidamente para ajustar o candidato e a chamar de teste novo.

## Verificação CPU

```sh
.venv-ia/bin/python -m unittest ia.test_jornadas_contrato ia.test_jornadas_treino ia.test_jornadas_avaliacao ia.test_jornadas_dados
```

São testes de contratos, integridade e contabilidade das métricas com dados autorais ou inferências falsas injetadas. Não executam um modelo real e não medem a qualidade do agente.
