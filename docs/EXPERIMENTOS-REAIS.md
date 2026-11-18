# Experimentos locais com páginas públicas

Este experimento verifica escolhas pontuais do assistente usando capturas públicas de sites reais. O HTML inicial, as análises, os conjuntos, os pesos e os resultados completos ficam somente em `data/`, que o Git ignora. As capturas foram autorizadas para este trabalho; não são um conjunto de avaliações de clientes aprovado por especialistas e não devem ser publicadas automaticamente.

Na coleta, os sites e os resolvedores DNS recebem requisições. O coletor verifica `robots.txt`, limita a leitura e registra falhas sem contornar bloqueios. O modelo e o treinamento são locais; não foram usados serviços de IA pagos, Google Ads, CRM ou fonte de posições nesta pesquisa. O HTML recebido não inclui necessariamente o conteúdo executado depois por JavaScript. Fontes, horários e hashes da resposta e do arquivo local são registrados separadamente.

Os rótulos foram criados por verificações técnicas limitadas, com dois leitores de HTML em pontos específicos e revisão pelo agente. Eles não são recomendações validadas por um especialista independente. O número de mensagens inclui muitas repetições e variações dos mesmos exemplos. Uma página real fornece contexto real; ela não fornece, sozinha, volume de busca, posição no Google, custos, vendas ou retorno de investimento.

Use organizações distintas em treino, validação e teste. Fixe os pesos e os critérios antes de abrir o teste reservado. Conte domínios e fontes, além das perguntas geradas a partir deles.

## Reproduzir uma coleta local

Crie um arquivo de escopo dentro de `data/` com domínios públicos autorizados e escolha os grupos antes de acessar os sites:

```json
{"versao":1,"sites":[
  {"site":"empresa-a.example","split":"train"},
  {"site":"empresa-b.example","split":"valid"},
  {"site":"empresa-c.example","split":"test"}
]}
```

Substitua os domínios fictícios e grave, por exemplo, em `data/ia/meu-escopo.json`. A saída precisa ser uma pasta nova:

```sh
node ia/reais/coletar.mjs --escopo data/ia/meu-escopo.json --saida data/ia/minha-coleta
node ia/reais/reanalizar.mjs data/ia/minha-coleta data/ia/minha-reanalise.json
.venv-ia/bin/python ia/reais/preparar.py \
  --fonte data/ia/minha-coleta data/ia/minha-reanalise.json --saida data/ia/meu-dataset-real
.venv-ia/bin/python ia/v2/treinar_v2.py --dados data/ia/meu-dataset-real \
  --config ia/v3/config.json --saida data/ia/meu-ajuste-real
```

É preciso preparar antes o ambiente e os conjuntos sintéticos da [terceira rodada](EXPERIMENTOS-IA-V3.md). Use empresas suficientes para que os três grupos continuem com páginas mesmo quando algumas coletas falharem. O ajuste precisa ser avaliado na validação e comparado com uma versão anterior antes de abrir o teste; treinamento concluído não indica aprovação. `ia/reais/preparar.py` e `ia/reais/preparar_comparacao.py` são os geradores do primeiro protocolo; `ia/reais/segundo_ciclo.py` documenta a promoção dos casos conhecidos a treino para esta execução específica. É necessário adaptar as fontes e reservar novos domínios e perguntas para outro ciclo. Nunca use um teste já observado como se continuasse independente. Os scripts de treinamento registram configuração, revisão e hashes de dados e pesos, e recusam sobrescrever os resultados anteriores.

## Uso no aplicativo

Depois de preparar o ambiente e selecionar um adaptador compatível conforme o [guia](TREINAR-IA.md), execute `npm start`, informe o domínio e use **Analisar com IA**. A etapa de IA recebe os relatórios existentes do servidor local; ela não inicia uma busca adicional nem envia o conteúdo a uma IA externa. O servidor e o navegador identificam o recurso como experimental, mostram a origem quando citada e ocultam sugestões bloqueadas. A presença do botão não é certificação de qualidade. Sem uma fonte compatível configurada, posições e concorrentes atuais continuam desconhecidos; sem dados comerciais, o sistema não calcula desperdício ou retorno de anúncios.

Na interface, há uma barreira adicional: uma sugestão para investigar a demanda de um termo extraído deve citar a evidência recente da página de origem. Essa barreira foi acrescentada após uma conferência da interface e tem teste específico, mas os números históricos das tabelas usam o avaliador e as barreiras da época; não foram recalculados como se já a incluíssem.
