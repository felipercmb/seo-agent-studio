# Terceira rodada de treinamento

As contraprovas da segunda rodada mostraram que o modelo podia sugerir corrigir uma exclusão intencional ou comparar resultados de buscas incompatíveis. Esta rodada acrescenta duas escolhas explícitas: **confirmar a intenção de publicação** quando ela é desconhecida e **preservar a exclusão** quando ela foi informada como proposital.

A IA continua escolhendo uma ação e referências entre opções limitadas. Orientação, prioridade e aviso são textos fixos. O controle de formato e as barreiras da integração são regras externas e não tornam a escolha da IA necessariamente correta.

## Separação dos dados

- **590 exemplos de treino**, organizados em 175 famílias. Há variações de uma mesma família; não são 590 análises independentes.
- **20 casos de validação** e **30 casos de teste** de novas famílias.
- **16 contraprovas adicionais**, reservadas até depois da seleção, para testar exclusões deliberadas ou incertas, capturas incompatíveis, falta de dados e instruções maliciosas em páginas.

Todo o conjunto da rodada anterior — inclusive o teste e as contraprovas que já haviam sido observados — foi promovido ao **treino** da rodada três. Ele não é apresentado como novo teste. Os novos conjuntos continuam sintéticos, da mesma autoria e sem revisão especializada; não demonstram desempenho em clientes reais ou melhora de tráfego e receita.

## Treinar e selecionar

No ambiente do [guia de treinamento](TREINAR-IA.md), depois de gerar os conjuntos anteriores:

```sh
python3 ia/v3/gerar_dados.py
.venv-ia/bin/python ia/v2/treinar_v2.py \
  --dados ia/v3/dados --config ia/v3/config.json --saida data/ia/minha-rodada-v3
```

Para avaliar um checkpoint na validação:

```sh
.venv-ia/bin/python ia/v2/checkpoints.py --origem data/ia/minha-rodada-v3 \
  --passo 240 --destino data/ia/meu-v3-240
.venv-ia/bin/python ia/v3/avaliar_v3.py --split valid \
  --adaptador data/ia/meu-v3-240 --saida data/ia/meu-v3-240/validacao.json
```

Avalie os pontos candidatos antes da seleção. O critério predefinido prioriza menos falhas graves identificadas na validação — por exemplo, sugerir corrigir uma exclusão intencional ou tratar uma busca antiga como comparação atual. Em seguida, considera acertos conjuntos de ação e referências, acertos de ação, referências e menor passo. Essa lista de falhas não cobre todos os riscos possíveis.

```sh
.venv-ia/bin/python ia/v3/selecionar_v3.py \
  --candidatos data/ia/meu-v3-240 --saida data/ia/minha-selecao-v3.json
```

Após congelar a escolha, avalie o modelo-base e o adaptador selecionado nas mesmas entradas. Substitua o caminho do adaptador se outro checkpoint tiver sido escolhido:

```sh
.venv-ia/bin/python ia/v3/avaliar_v3.py --split test --selecao data/ia/minha-selecao-v3.json \
  --saida data/ia/meu-v3-base-teste.json
.venv-ia/bin/python ia/v3/avaliar_v3.py --split test --selecao data/ia/minha-selecao-v3.json \
  --adaptador data/ia/meu-v3-240 --saida data/ia/meu-v3-ajustado-teste.json
.venv-ia/bin/python ia/v3/avaliar_estresse.py --selecao data/ia/minha-selecao-v3.json \
  --adaptador data/ia/meu-v3-240 --saida data/ia/meu-v3-estresse.json
```

Os scripts registram os resultados individuais, configuração e hashes; não promovem automaticamente o modelo para uso autônomo. Para outro ciclo, trate os testes já observados como desenvolvimento e prepare novos testes independentes.

## Usar com um relatório local

Com o aplicativo aberto e os dados já consultados:

```sh
node scripts/preparar-ia.mjs --site exemplo.org
.venv-ia/bin/python ia/v3/inferir_v3.py --selecao data/ia/minha-selecao-v3.json
```

O resultado fica em `data/ia/v3-recomendacoes.json`. As fontes já coletadas permanecem locais nessa etapa. A integração revalida a idade das evidências e recusa sugestões que exigem uma captura de concorrentes não disponível ou correção de indexação sem confirmação do responsável. Uma escolha aceita ainda é marcada para revisão: o relatório do site, sozinho, não comprova a intenção do proprietário nem o retorno comercial da palavra.

Depois de observar erros nas contraprovas, também foram adicionadas regras conservadoras na integração: a análise de intenção precisa citar uma busca e uma página recentes, e a classificação de exclusão como intencional é suspensa até confirmação do responsável. Essas regras têm testes de regressão, mas **ainda não foram avaliadas em um novo teste independente**; os resultados do modelo nos arquivos de teste são anteriores a essas regras.
