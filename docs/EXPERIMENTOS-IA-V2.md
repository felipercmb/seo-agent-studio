# Segunda rodada de treinamento local

Esta rodada parte do mesmo Qwen2.5-1.5B quantizado, com QLoRA. Os pesos do modelo original ficam congelados; apenas adaptadores pequenos são treinados. A finalidade é ajudar a escolher uma próxima investigação ou melhoria e citar as evidências usadas. Não há treinamento com dados de clientes.

## Mudanças em relação ao piloto

- Mais famílias e variações sintéticas, incluindo situações com página excluída intencionalmente, dados desatualizados, ausência de mensuração comercial e instruções contidas em páginas.
- A IA escolhe uma ação e referências de evidências. Uma gramática limita as respostas possíveis e gera JSON bem formado, com IDs presentes na entrada. **Isso não garante que a ação ou as referências escolhidas sejam corretas.**
- A prioridade, a orientação e a limitação exibidas são textos fixos associados à ação, identificados como tais. Não são explicações independentes produzidas pelo modelo.
- Os campos antigos sem data válida são rebaixados na inferência. Posições e concorrentes desatualizados são removidos do contexto apresentado à IA.
- O candidato é escolhido apenas pela validação. O teste reservado e contraprovas são executados somente após congelar a seleção.

O formato curto diminui o espaço para texto numérico inventado, mas uma classificação ainda pode ser equivocada ou citar evidências inadequadas. Uma orientação correta em um caso não prova que funcionará em outro. Nenhuma saída altera o site, uma campanha ou orçamento.

## Dados

O conjunto **A** contém 368 exemplos de treino, 16 de validação e 32 de teste. O treino compreende 80 famílias; muitas linhas são variações, não observações independentes. Todos os casos da primeira rodada, inclusive seu teste já observado, foram usados **somente no treino** desta rodada.

O conjunto **B** mantém os 32 casos de teste do A byte a byte e adiciona contrafactuais de prudência ao desenvolvimento: são **418 exemplos em 90 famílias de treino** e **24 famílias de validação**. Existem ainda 16 contraprovas separadas para ações proibidas em contextos de dados ausentes, intenção de indexação desconhecida, capturas incompatíveis ou instruções maliciosas.

Famílias e setores de teste são diferentes dos de treino e validação. Todos os conjuntos, porém, são escritos pela mesma autoria e compartilham conceitos e vocabulário. São hipóteses editoriais controladas, **não análises revisadas por profissionais nem dados independentes de clientes**. A proporção de acertos pode superestimar a capacidade fora desses cenários.

## Reproduzir

Use o ambiente Python e o modelo baixado como descrito em [Treinar o assistente local](TREINAR-IA.md). Os comandos abaixo usam Apple Silicon e não dependem de serviços de IA pagos. Cada saída deve ser nova; os scripts preservam experimentos anteriores.

```sh
python3 ia/v2/gerar_dados.py
python3 ia/v2/gerar_dados_b.py

.venv-ia/bin/python ia/v2/treinar_v2.py \
  --dados ia/v2/dados-b --config ia/v2/config-b.json \
  --saida data/ia/minha-rodada-b
```

Para cada ponto que será candidato, prepare uma pasta e avalie-a no conjunto de validação. O exemplo abaixo avalia o passo 240:

```sh
.venv-ia/bin/python ia/v2/checkpoints.py \
  --origem data/ia/minha-rodada-b --passo 240 \
  --destino data/ia/meu-candidato-240

.venv-ia/bin/python ia/v2/avaliar_v2.py \
  --dados ia/v2/dados-b --split valid \
  --adaptador data/ia/meu-candidato-240 \
  --saida data/ia/meu-candidato-240/validacao.json
```

Repita para os demais checkpoints decididos antes da seleção. A regra do seletor escolhe o maior número de acertos conjuntos de ação e referências; em empate, usa acerto de ação, de referências e depois o menor passo. Ele grava os hashes dos candidatos e da validação:

```sh
.venv-ia/bin/python ia/v2/selecionar_v2.py \
  --dados ia/v2/dados-b \
  --candidatos data/ia/meu-candidato-240 \
  --saida data/ia/minha-selecao.json
```

Depois de congelar a seleção, compare o modelo-base e o candidato escolhido no teste:

```sh
.venv-ia/bin/python ia/v2/avaliar_v2.py --dados ia/v2/dados-b \
  --split test --selecao data/ia/minha-selecao.json \
  --saida data/ia/meu-base-teste.json

# Substitua o caminho pelo candidato escolhido na seleção.
.venv-ia/bin/python ia/v2/avaliar_v2.py --dados ia/v2/dados-b \
  --split test --selecao data/ia/minha-selecao.json \
  --adaptador data/ia/meu-candidato-240 --saida data/ia/meu-ajustado-teste.json

.venv-ia/bin/python ia/v2/avaliar_estresse.py --selecao data/ia/minha-selecao.json \
  --adaptador data/ia/meu-candidato-240 --saida data/ia/meu-estresse.json
```

Os arquivos de avaliação incluem cada resposta, alvo, código e hashes. O teste de estresse só verifica se certas ações proibidas apareceram; passar não comprova segurança geral. Uma vez observado um teste, não o use para apresentar uma nova rodada como se fosse inédita.

## Usar com os relatórios existentes

Com o servidor local aberto e após uma consulta no aplicativo:

```sh
node scripts/preparar-ia.mjs --site exemplo.org
.venv-ia/bin/python ia/v2/inferir_v2.py --selecao data/ia/minha-selecao.json
```

A exportação usa os relatórios já guardados; não faz uma nova busca no Google. O arquivo local `data/ia/v2-recomendacoes.json` contém as escolhas, seus IDs, as evidências citadas e os avisos. Uma escolha que infringe o contrato é recusada; as demais continuam com revisão necessária.

A integração aplica barreiras adicionais: acompanhar uma posição requer captura atual citada; comparar concorrentes requer uma captura atual com concorrente anterior; melhorar uma página requer evidência recente dela. Uma indicação de correção de indexação é recusada na integração atual porque o relatório não confirma a intenção de publicação do responsável. Esses bloqueios são regras externas ao modelo e não tornam verdadeiras as demais escolhas. Os testes do modelo registram suas decisões antes dessas barreiras.

Sem volume de buscas, conversão e margem, essa análise **não informa qual campo ou palavra terá maior retorno financeiro**. Uma posição observada pode fundamentar uma hipótese de teste; não mede demanda, receita ou desperdício em anúncios.

## Comparar hipóteses duas a duas

Um segundo adaptador experimental foi preparado para escolher qual de dois contextos tem uma evidência mais específica para investigar ou responder `insuficiente`. O experimento usa 216 variações em 18 famílias de treino, 12 casos de validação em seis famílias e 18 casos de teste em nove famílias. Cada par aparece também invertido; a avaliação registra tanto acertos individuais quanto pares em que as duas ordens estão corretas.

Os pares são fictícios, escritos pela mesma autoria e sem revisão especializada. Os rótulos representam hipóteses editoriais, não resultados de intervenções reais. Quando a questão pede retorno financeiro sem dados comerciais, a resposta alvo é `insuficiente`.

Reprodução do treinamento e avaliação de um candidato:

```sh
python3 ia/comparacao/gerar_dados.py
.venv-ia/bin/python ia/v2/treinar_v2.py \
  --dados ia/comparacao/dados --config ia/comparacao/config.json \
  --saida data/ia/minha-comparacao

.venv-ia/bin/python ia/v2/checkpoints.py \
  --origem data/ia/minha-comparacao --passo 120 \
  --destino data/ia/meu-comparador-120
.venv-ia/bin/python ia/comparacao/avaliar.py --split valid \
  --adaptador data/ia/meu-comparador-120 --saida data/ia/meu-comparador-120/validacao.json
.venv-ia/bin/python ia/comparacao/selecionar.py \
  --candidatos data/ia/meu-comparador-120 --saida data/ia/minha-comparacao-selecao.json
```

Na prática, avalie os checkpoints candidatos antes de selecionar. Como alguns pontos treinados priorizaram uma opção quando faltavam dados, adotamos na validação um critério que **primeiro minimiza essas falsas priorizações**; depois considera pares corretos, casos corretos e menor passo. Essa política foi decidida após observar a validação e antes do teste. Só depois rode o teste reservado para o modelo-base e para o escolhido:

```sh
.venv-ia/bin/python ia/comparacao/avaliar.py --split test \
  --selecao data/ia/minha-comparacao-selecao.json --saida data/ia/comparacao-base-teste.json
.venv-ia/bin/python ia/comparacao/avaliar.py --split test \
  --selecao data/ia/minha-comparacao-selecao.json --adaptador data/ia/meu-comparador-120 \
  --saida data/ia/comparacao-ajustada-teste.json
```

Depois de exportar duas ou três entradas pelo aplicativo, execute:

```sh
.venv-ia/bin/python ia/comparacao/inferir.py --selecao data/ia/minha-comparacao-selecao.json
```

O arquivo `data/ia/comparacoes.json` apresenta os contextos e escolhas duas a duas. A integração repete cada comparação com a ordem invertida e marca como inconclusivo quando as escolhas se contradizem, se o modelo se abstém ou se o contexto escolhido não tem evidência recente. Consistência na ordem é uma verificação útil, mas **não comprova a qualidade ou a causalidade da escolha**. As comparações não formam automaticamente um ranking total do site.
