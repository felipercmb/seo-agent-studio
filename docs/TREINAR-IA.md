# Treinar o assistente local

Este módulo ajusta de verdade os parâmetros de um modelo aberto com **QLoRA**. É um piloto supervisionado: aprende a escolher uma próxima ação e explicá-la com referências às evidências recebidas. A análise por regras na interface continua disponível; o modelo experimental é executado separadamente pelo terminal.

**Resultado observado do primeiro treino:** ação esperada em 8 de 16 casos e todos os critérios mecânicos em apenas 3 de 16, com piora na validade do JSON. O piloto ainda não está aprovado para orientar clientes sozinho. Veja [respostas, comparação e configuração executada](../ia/resultados/piloto-v1/README.md).

O ponto de partida é [Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct), na [conversão MLX de quatro bits](https://huggingface.co/mlx-community/Qwen2.5-1.5B-Instruct-4bit/tree/8b403126fc14f14cfc99bb4cfa72ecbc129ea677), com revisão fixa. O treinamento usa [MLX-LM 0.32.2](https://github.com/ml-explore/mlx-lm/blob/v0.32.2/mlx_lm/LORA.md), com perda somente na resposta do assistente. Não é treinamento do modelo inteiro a partir do zero.

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

Os critérios medem JSON, contrato, ação e prioridade esperadas, referências obrigatórias e presença lexical de uma limitação de retorno. O detector lexical pode errar. Mesmo aprovação em todos os critérios **não equivale a recomendação correta para um cliente**, nem comprova aumento de tráfego ou vendas. O comparador nunca ativa o modelo automaticamente na interface.

## Analisar as evidências de um site

Inicie o aplicativo e consulte o site normalmente. Depois, em outro terminal, exporte as evidências já disponíveis:

```sh
node scripts/preparar-ia.mjs --site exemplo.org
.venv-ia/bin/python ia/inferir.py
```

A exportação lê somente o servidor local em `127.0.0.1:8794`; use `--porta` se necessário. Não dispara novas consultas ao Google. Ela prepara até três contextos, agrupados por página quando a URL é conhecida, sem passar recomendações do motor como se fossem fatos. Essa seleção ainda segue a ordem do motor existente; não é uma otimização global de todo o site feita pela IA.

`data/ia/recomendacoes.json` contém entradas, respostas, IDs, erros de validação e o hash do adaptador. Uma resposta fora do contrato fica `recusada`; uma resposta bem formada fica `revisao_necessaria`. Nenhuma altera o site, anúncios ou orçamento. Se o contexto exceder o limite do piloto, a inferência informa o problema em vez de cortar evidências sem aviso.

Os horários são conferidos novamente: posições sem data válida ou com mais de uma hora perdem o valor atual; conteúdo de página usa validade de um dia. A exportação parte de relatórios validados pelo servidor, mas não transforma um JSON editado manualmente em evidência autêntica.

Sem posição, demanda, conversão ou margem, o agente deve indicar o que falta medir. Saber que uma página poderia subir no Google não identifica sozinho o serviço com maior retorno financeiro.

## Evoluir para uso com clientes

O próximo conjunto precisa de análises revisadas por profissionais, com as evidências disponíveis **na data da decisão**, ações sugeridas, justificativas, discordâncias e critérios de sucesso. Resultados posteriores devem ficar separados das entradas históricas para evitar vazamento de informação. Obtenha autorização antes de incluir dados de clientes; não publique relatórios reais por padrão.

Para avaliar utilidade, reserve clientes e períodos inteiros e faça revisão cega das respostas do modelo-base e do ajustado. Acompanhe erros de evidência, recomendações inadequadas, abstinências úteis e resultados de intervenções. Mudanças de posição ou receita isoladas não provam que uma recomendação as causou.

Testes de código, sem baixar modelo ou instalar MLX:

```sh
python3 -m unittest discover -s ia -p 'test_*.py'
npm test
```

O código e os casos sintéticos seguem a licença do projeto. O modelo-base e sua conversão têm licença Apache-2.0; consulte as condições antes de redistribuir pesos ou adaptadores. A licença MIT do aplicativo não substitui licenças dos modelos.
