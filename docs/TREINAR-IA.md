# Treinar o assistente local

Este módulo ajusta de verdade os parâmetros de um modelo aberto com **QLoRA**. É um piloto supervisionado: aprende a escolher uma próxima ação e referenciar as evidências recebidas. A análise por regras continua disponível. Com o ambiente, os pesos e uma seleção local presentes, a interface oferece também uma análise experimental de até três contextos; os textos de orientação são padronizados e exigem revisão.

**Resultado observado do primeiro treino:** ação esperada em 8 de 16 casos e todos os critérios mecânicos em apenas 3 de 16, com piora na validade do JSON. O piloto ainda não está aprovado para orientar clientes sozinho. Veja [respostas, comparação e configuração executada](../ia/resultados/piloto-v1/README.md).

O ponto de partida é [Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct), na [conversão MLX de quatro bits](https://huggingface.co/mlx-community/Qwen2.5-1.5B-Instruct-4bit/tree/8b403126fc14f14cfc99bb4cfa72ecbc129ea677), com revisão fixa. O treinamento usa [MLX-LM 0.32.2](https://github.com/ml-explore/mlx-lm/blob/v0.32.2/mlx_lm/LORA.md), com perda somente na resposta do assistente. Não é treinamento do modelo inteiro a partir do zero.

A [segunda rodada](EXPERIMENTOS-IA-V2.md) usa conjuntos mais diversos, inclui contraprovas e seleciona a ação e as referências em um formato limitado. Ela é independente do piloto inicial descrito abaixo.

## O que o piloto aprende

Uma ação por contexto: corrigir um impedimento de indexação confirmado, melhorar informações da página, investigar intenção ou demanda, medir conversões, atualizar uma coleta, acompanhar uma posição ou comparar concorrentes. Cada resposta inclui prioridade, IDs de evidência, justificativa, próximo passo e limitação.

Os números continuam nos dados observados. O modelo não recebe licença para inventar posição, volume de busca ou receita. A checagem de saída recusa JSON inválido, referências inexistentes e algarismos em texto livre. **Essas verificações não comprovam que uma explicação seja verdadeira ou adequada**: uma alucinação escrita sem algarismos ainda é possível. As recomendações aceitas pelo formato continuam exigindo revisão.

## Dados e avaliação

O conjunto público contém **96 casos de treino, 16 de validação e 16 de teste**. São negócios fictícios em domínios `.invalid`, com respostas editoriais controladas e sem revisão de especialistas. Os 96 casos de treino representam **24 famílias com quatro variações cada**; não são 96 análises independentes.

Domínios e famílias de cenário ficam em um único split. Validação e teste contêm composições reservadas, mas compartilham conceitos, vocabulário e autoria com o treino. Isso mede generalização limitada dentro do gerador sintético, não qualidade no mundo real. Há conflitos, ausência de dados, resultados antigos e instruções maliciosas dentro de evidências.

O teste fica fora da pasta lida pelo treinamento. Manifest, hashes dos dados, revisão do modelo, dependências, prompt, código do avaliador, decodificador e adaptador tornam a comparação auditável. A geração recusa substituir silenciosamente um dataset existente diferente. Não ajuste o modelo usando os erros do teste final; um novo ciclo precisa de novos casos reservados.

## Requisitos

O primeiro backend de treinamento é para **Mac com Apple Silicon**. O ambiente do piloto usa Apple M4, 16 GiB de RAM e Python 3.14. Os pesos baixados ocupam cerca de 880 MB; reserve também espaço para o ambiente Python, cache e experimentos. O aplicativo Node continua independente dessa dependência e suporta seus sistemas já documentados. Treinamento Linux/CUDA e Windows não estão implementados neste módulo.

Não há API paga, assinatura, cadastro ou cobrança automática. O download inicial acessa PyPI e Hugging Face. Depois dele, o treino e a inferência usam arquivos locais e não enviam relatórios para uma IA externa. Isso não muda as conexões normais do coletor de sites e da fonte opcional de posições.

Na raiz do projeto:

```sh
python3 -m venv .venv-ia
.venv-ia/bin/python -m pip install -r ia/requirements-macos.lock.txt
.venv-ia/bin/python ia/gerar_dataset.py
.venv-ia/bin/python ia/preparar_modelo.py
```

O comando de download usa uma revisão fixa, não executa código remoto de modelos e registra hashes locais. A instalação das dependências não inclui os pesos; o download é uma etapa explícita. `data/`, `.venv-ia/` e adaptadores locais não entram no Git.

## Executar um experimento

Escolha a configuração antes de ver os resultados de teste. A configuração inicial em `ia/piloto.json` usa 120 passos, lote unitário, oito camadas com adaptadores de rank oito, taxa de aprendizagem de 0,0001 e sequência máxima de 1.536 tokens. O programa verifica o tamanho real das conversas antes do treino e recusa truncá-las silenciosamente.

```sh
# Modelo-base: mesmos casos e instruções usados na comparação posterior.
.venv-ia/bin/python ia/avaliar.py --saida data/ia/base-teste.json

# Ajuste dos pesos do adaptador. Usa somente treino e validação.
.venv-ia/bin/python ia/treinar.py --saida data/ia/piloto-v1

# Modelo ajustado, com o mesmo teste e decodificador.
.venv-ia/bin/python ia/avaliar.py \
  --adaptador data/ia/piloto-v1 --saida data/ia/treinado-teste.json

.venv-ia/bin/python ia/comparar.py \
  --base data/ia/base-teste.json \
  --treinado data/ia/treinado-teste.json \
  --saida data/ia/comparacao.json
```

Use pastas e caminhos novos em outro experimento: treino e avaliações recusam sobrescrever resultados. A pasta do adaptador guarda configuração executada, log, metadados e `adapters.safetensors`. A avaliação mantém inclusive respostas que falharam e o denominador de todos os casos.

Os critérios deste primeiro piloto medem JSON, contrato, ação e prioridade esperadas, referências obrigatórias e presença lexical de uma limitação de retorno. O detector lexical pode errar. Mesmo aprovação em todos os critérios **não equivale a recomendação correta para um cliente**, nem comprova aumento de tráfego ou vendas. O comparador experimental de duas oportunidades não é apresentado na interface.

## Analisar as evidências de um site

Para usar a opção **Analisar com IA** na interface, instale o ambiente acima, treine e selecione o adaptador da [terceira rodada](EXPERIMENTOS-IA-V3.md) ou faça um [experimento local com páginas reais](EXPERIMENTOS-REAIS.md). Copie a seleção que você avaliou para `data/ia/selecao-interface.json` e reinicie `npm start`. O aplicativo também reconhece `data/ia/reais/selecao-acoes.json` ou `data/ia/v3-selecao.json` se não houver seleção explícita para a interface. Pesos, seleções e capturas não acompanham o Git: cada pessoa precisa prepará-los localmente. A opção não aparece se os arquivos necessários estiverem ausentes.

A interface envia somente o domínio ao servidor local, que monta a entrada a partir dos relatórios que já produziu. A IA não executa novas consultas, não recebe a chave da fonte nem envia o relatório a serviços externos. Os bloqueios podem recusar sugestões; os testes disponíveis ainda não demonstram confiabilidade suficiente para decisões sem revisão humana. Esta etapa depende de Apple Silicon com MLX; o diagnóstico por regras continua independente da IA.

Quando houver uma seleção e uma decisão experimental íntegras em `data/ia/robustez/`, a interface pode oferecer também **Experimentar novo ajuste**; na ausência delas, usa a seleção anterior em `data/ia/reais/`, se estiver íntegra. A opção não substitui a seleção padrão e exige revisão humana. Esses arquivos não acompanham o repositório; os [resultados anteriores](EXPERIMENTOS-REAIS.md) e o [experimento mais recente](EXPERIMENTOS-ROBUSTEZ.md) explicam suas limitações.

O [experimento de robustez da interface](EXPERIMENTOS-ROBUSTEZ.md) testa entradas no formato efetivamente usado pelo aplicativo, preserva os arquivos locais e oferece um roteiro de revisão humana cega aos rótulos automáticos.

O [procedimento para capturas SERP](EXPERIMENTO-SERP-REAL.md) prepara coleta, conjuntos separados e avaliação da IA e das regras com uma fonte gratuita já configurada. Ele não declara que uma coleta real foi executada.

Também é possível usar o primeiro piloto pelo terminal:

Inicie o aplicativo e consulte o site normalmente. Depois, em outro terminal, exporte as evidências já disponíveis:

```sh
node scripts/preparar-ia.mjs --site exemplo.org
.venv-ia/bin/python ia/inferir.py
```

A exportação lê somente o servidor local em `127.0.0.1:8794`; use `--porta` se necessário. Não dispara novas consultas ao Google. Ela prepara até três contextos, agrupados por página quando a URL é conhecida, sem passar recomendações do motor como se fossem fatos. Essa seleção ainda segue a ordem do motor existente; não é uma otimização global de todo o site feita pela IA.

No fluxo `/projeto`, a seleção dos contextos prioriza termos publicados ligados
a ofertas, preservando a prioridade de diretivas de publicação observadas.
Ela informa o recorte em `ia.selecao`; não é uma análise de todas as páginas
nem transforma o vínculo comercial em fato enviado ao modelo.

`data/ia/recomendacoes.json` contém entradas, respostas, IDs, erros de validação e o hash do adaptador. Uma resposta fora do contrato fica `recusada`; uma resposta bem formada fica `revisao_necessaria`. Nenhuma altera o site, anúncios ou orçamento. Se o contexto exceder o limite do piloto, a inferência informa o problema em vez de cortar evidências sem aviso.

Os horários são conferidos novamente: posições sem data válida ou com mais de uma hora perdem o valor atual; conteúdo de página usa validade de um dia. A exportação parte de relatórios validados pelo servidor, mas não transforma um JSON editado manualmente em evidência autêntica.

Sem posição, demanda, conversão ou margem, o agente deve indicar o que falta medir. Saber que uma página poderia subir no Google não identifica sozinho o serviço com maior retorno financeiro.

## Comparar um adaptador sem trocar o padrão

O fluxo modular pode manter `ia` e `iaCandidata` separadamente. Ambas são
reclassificadas como históricas quando suas evidências mudam ou expiram.
A candidata só aparece quando a instalação local encontra uma seleção e uma
decisão experimental compatíveis. O navegador não escolhe comandos, caminhos
ou arquivos do modelo.

Para disponibilizar um experimento já avaliado, use arquivos de seleção e
decisão locais, com seus caminhos reais:

```sh
node scripts/disponibilizar-candidato-ia.mjs --selecao CAMINHO_DA_SELECAO --decisao CAMINHO_DA_DECISAO
```

O comando confere os hashes dos pesos e da configuração, exige a declaração
`aprovado_para_uso_autonomo: false` e cria um diretório novo em `data/ia/modular`.
Ele não copia pesos nem substitui uma seleção existente ou a padrão. Reinicie
o servidor para atualizar a disponibilidade. A remoção ou troca de candidatos
deve ser feita conscientemente no sistema de arquivos local; o comando recusa
sobrescrita.

Em novos treinos, informe `--origem-rotulos` com a origem correta dos exemplos.
Permutações da mesma evidência não contam como análises independentes. Mantenha
um manifesto com domínios, divisões, hashes e o momento do congelamento. O
avaliador recusa uma divisão vazia e registra separadamente ação e referências
exatas, referências mínimas suficientes, recusas e substituições por regras.

## Evoluir para uso com clientes

O próximo conjunto precisa de análises revisadas por profissionais, com as evidências disponíveis **na data da decisão**, ações sugeridas, justificativas, discordâncias e critérios de sucesso. Resultados posteriores devem ficar separados das entradas históricas para evitar vazamento de informação. Obtenha autorização antes de incluir dados de clientes; não publique relatórios reais por padrão.

Para avaliar utilidade, reserve clientes e períodos inteiros e faça revisão cega das respostas do modelo-base e do ajustado. Acompanhe erros de evidência, recomendações inadequadas, abstinências úteis e resultados de intervenções. Mudanças de posição ou receita isoladas não provam que uma recomendação as causou.

Testes de código, sem baixar modelo ou instalar MLX:

```sh
python3 -m unittest discover -s ia -p 'test_*.py'
npm test
```

O código e os casos sintéticos seguem a licença do projeto. O modelo-base e sua conversão têm licença Apache-2.0; consulte as condições antes de redistribuir pesos ou adaptadores. A licença MIT do aplicativo não substitui licenças dos modelos.
