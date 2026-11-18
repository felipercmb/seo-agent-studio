# Conferir papéis no computador local

A conferência é uma etapa experimental para revisar uma relação que outro leitor já propôs. Não descobre palavras, posições, receita ou relações ausentes. Recebe uma oferta declarada, uma unidade com sua fonte completa e o quadro proposto. Devolve uma classificação para revisão; não confirma o negócio ou substitui o perfil do cliente.

## Executar um exemplo

Use o ambiente MLX e os modelos já instalados conforme o [guia de IA](TREINAR-IA.md). Este comando não baixa pesos nem chama uma API de IA:

```sh
.venv-ia/bin/python ia/classificar_papeis_local.py \
  --entrada exemplos/conferencia-papeis-controlada.json \
  --saida data/conferencias/exemplo-novo
```

A pasta de saída deve ser nova. O exemplo é autoral controlado; não é uma empresa real ou prova de acurácia. A conferência usa a base 4B por padrão. `--modelo-base qwen35-9b` usa a base maior já instalada. Um adaptador C16 pode ser passado com `--adaptador CAMINHO_C16`, junto à base 4B compatível. Adaptadores C15 e C16 têm protocolos diferentes e não são intercambiáveis. Nenhum desses comandos troca a seleção normal do aplicativo.

## Preparar uma entrada

O arquivo do exemplo mostra o formato completo. A raiz tem `versao: 1` e de 1 a 32 `quadros`, cada um com identidade própria. Em cada entrada:

- `documento.fontes` conserva o trecho contínuo e os metadados da captura, incluindo URL e momento de coleta.
- `documento.unidades` identifica o recorte exato dentro da fonte. Não concatene pedaços distantes para fabricar uma frase.
- `unidade` aponta a unidade que deve ser analisada.
- `oferta` informa nome, natureza e papel do site como hipótese declarada.
- `quadroProposto` contém estrutura, ator, ação, objeto e marcador nominal. Os campos de texto precisam estar literalmente presentes na unidade. Uma estrutura nominal usa ação nula.

`classificacaoAnterior` é opcional. Quando fornecida, fica preservada como comparação e não vai ao modelo. A entrada prática não recebe gabarito. A conferência sugere tipo de ator, escopo e negação; os textos originais permanecem iguais.

## Ler o resultado

Uma proposta válida no contrato ainda pode estar semanticamente errada. Leia a publicação completa antes de aceitar quem executa, quem solicita ou a que oferta a ação se refere. Separe a atividade da ferramenta, a implantação pelo fornecedor e a transação entre o cliente e o comprador dele. Propriedade de dados não estabelece execução ou pagamento.

A saída mantém a entrada, a proposta anterior, a geração bruta, os erros e a projeção. Recusa de formato, ausência de geração e abstenção explícita são estados diferentes. O encadeamento conserva um resultado desconhecido quando uma etapa falha; não transforma a falha em acerto de abstenção.

Esse módulo não revisa condições. Para prazos, cadastro e certificado, confira atividade, parte afetada, plano, gatilho e exceções na publicação. Uma dispensa para assinar não vale automaticamente para enviar, e um prazo de suporte não descreve a disponibilidade geral do produto.

## Avaliar um encadeamento

`ia/avaliar_combinacao_local.py` pode encaminhar as propostas brutas reais de um ensaio C15 ao conferente. Não fornece a relação do gabarito ao modelo. O arquivo de referências serve somente à pontuação posterior. O ensaio continua condicionado à oferta e unidade fornecidas; não mede o entendimento de um site inteiro. Registre separadamente acertos positivos, preenchimentos falsos, positivos aceitos com campos errados e resultados desconhecidos.

O [guia de treino e avaliação](TREINAR-IA.md) descreve como comparar o resultado do modelo. As correções do operador ficam no perfil para a análise local; não viram automaticamente exemplos de treinamento.
