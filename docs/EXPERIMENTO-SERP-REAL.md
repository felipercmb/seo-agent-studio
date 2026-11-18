# Experimento com posições verificadas

Este procedimento prepara uma avaliação local a partir de consultas efetivas à fonte configurada. Ter o código abaixo **não significa que uma consulta real já ocorreu**. Confira sempre o manifesto e os relatórios da execução.

Antes de consultar, defina organizações distintas para treino, validação e teste. O arquivo de plano deve conter `versao: 1` e uma lista `sites`; cada item informa `site`, `grupo`, `split` (`train`, `valid` ou `test`) e `lotes` de um a cinco. Uma organização não pode atravessar divisões. Cada lote pode solicitar até quatro páginas da fonte; a franquia local e a validação do plano gratuito continuam obrigatórias. O coletor para se um lote consumir reservas sem aceitar nenhuma captura, para evitar desperdiçar a cota com uma incompatibilidade.

Com o servidor local ativo e a fonte gratuita já configurada:

```sh
node ia/serp_real/coletar.mjs data/ia/serp-real/plano.json data/ia/serp-real/coleta 8795
node ia/serp_real/preparar.mjs data/ia/serp-real/coleta data/ia/serp-real/casos
.venv-ia/bin/python ia/serp_real/preparar_treino.py data/ia/serp-real/casos data/ia/serp-real/desenvolvimento
```

Use nomes novos a cada execução. O primeiro comando só acessa o servidor local; esse servidor acessa os sites e a SerpApi. O coletor salva os relatórios estruturados e um manifesto com hashes em `data/`, que não vai ao Git. Não recebe a chave da fonte. A preparação reproduz cada consulta na data da captura, revalida contexto, sequência de páginas e hashes pelo motor do projeto e exclui consultas repetidas entre divisões. Consultas sem posição confirmada ficam fora dos exemplos positivos. Isso não comprova ausência do site no Google.

O ajuste usa o treinador existente `ia/v2/treinar_v2.py`, apenas com `desenvolvimento/train.jsonl` e `desenvolvimento/valid.jsonl`. O teste permanece fora dessa pasta. Antes de avaliá-lo, selecione o candidato somente na validação, registre o adaptador e os hashes dos dados e do avaliador, e compare o candidato à versão anterior. `ia/serp_real/avaliar.py` mede separadamente a escolha bruta da IA e o resultado híbrido com regras; ele recusa abrir o teste sem seleção congelada e rejeita domínios ou consultas que também apareçam no desenvolvimento.

O arquivo `ia/serp_real/config.json` é a configuração deste laboratório e retoma o adaptador local `data/ia/robustez/ciclo3-120`; ele precisa existir ou ser substituído por um adaptador local já avaliado. Com dados suficientes, execute o treino em uma pasta nova:

```sh
.venv-ia/bin/python ia/v2/treinar_v2.py --config ia/serp_real/config.json \
  --dados data/ia/serp-real/desenvolvimento --saida data/ia/serp-real/ajuste
```

As capturas representam uma busca com data, país, idioma e dispositivo específicos. Após o prazo da aplicação, são exemplos históricos, não posições atuais. Hashes ajudam a identificar alterações locais, mas não provam que o Google ou a SerpApi produziram um arquivo. As ações esperadas são rótulos editoriais automáticos, não pareceres de profissionais, e não medem demanda, conversões, receita ou o efeito de uma intervenção. Dados reais e avaliações de profissionais continuam necessários antes do uso autônomo com clientes.
