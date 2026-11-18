# Contexto das evidências e relações do negócio

Módulo local experimental, adicionado sem substituir o aplicativo ou os modelos anteriores. Seu objetivo é descrever relações publicadas no site com evidências inspecionáveis: quem oferece, intermedeia, executa, contrata, paga, recebe ou apoia; a qual oferta/programa uma condição se aplica.

## Executar no ambiente local

Na raiz do repositório, com o ambiente MLX e os pesos locais já preparados:

```sh
node scripts/analisar-relacoes.mjs --site exemplo.com.br --saida data/minha-analise-nova
```

O comando lê páginas públicas com o coletor existente e seus limites/robots, prepara o contexto, executa a IA no computador e salva a revisão em Markdown. A pasta de saída precisa ser nova. Nenhuma análise, seleção anterior ou perfil confirmado é sobrescrito.

Para repetir uma captura existente, sem nova coleta:

```sh
node scripts/analisar-relacoes.mjs --captura data/captura-existente.json --saida data/repeticao-nova
```

Opcionalmente use `--python /caminho/do/ambiente/bin/python` e `--modelo-base qwen3-4b`. O padrão deste módulo novo é `qwen35-4b`, em modo experimental; isso não altera a seleção do aplicativo antigo. O comando não instala bibliotecas, não baixa modelos e não chama API de inferência. O backend validado é MLX em Apple Silicon. Ele usa os pesos fixados e verificados por `ia/negocio/modelos.py`, com limite de memória MLX de 6 GiB; o limite não é uma garantia sobre toda a RAM do processo.

## Arquivos gerados

- `captura.json`: HTML e metadados públicos, quando houve coleta nova.
- `contexto.json`: fontes escolhidas, contexto integral e correspondência de IDs.
- `relacoes.json` e `relacoes.jsonl`: entrada, saída bruta, referências, falhas e hipóteses para revisão.
- `REVISAO.md`: relações e condições com suas citações, páginas, seções e alertas.
- `manifesto.json`: hashes dos resultados e identificação do modo experimental.

O material fica em `data/`, ignorada pelo Git. Capturas reais não devem ser redistribuídas automaticamente. Código e casos controlados estão fora dessa pasta.

## Como o contexto chega ao modelo

`ia/negocio/fontes-v3.mjs` mantém os exportadores antigos e acrescenta a cada fonte: URL, título da página, caminho de cabeçalhos, campo HTML, data da coleta, hash do HTML, indicação de recorte e classe editorial indicativa. A classe de página é uma heurística de URL; não comprova a vigência do conteúdo.

Cabeçalhos são limitados pelo contêiner DOM para não transportar a condição de uma seção para uma seção irmã. Trechos iguais em seções diferentes continuam com origens distintas. Alguns layouts em `div` podem perder um cabeçalho relevante; essa perda conservadora precisa aparecer na revisão, sem inventar o vínculo.

`preparar.mjs` recupera trechos inteiros e conta também os caracteres dos metadados. Não corta uma condição para caber no orçamento. `verificar.mjs` reconstrói a entrada a partir da captura e confere os hashes antes da inferência. Isso verifica proveniência e reprodutibilidade; não comprova a verdade de uma declaração do site.

## O que é uma relação

Cada hipótese registra sujeito, predicado, objeto, oferta, polaridade, temporalidade e IDs de evidências. `$site` representa a organização do domínio analisado; os outros nomes precisam de apoio nas fontes. Uma condição seleciona um segmento contínuo e identifica a oferta/programa/formulário afetado, quando possível.

O modelo não reescreve a citação inteira. O programa usa os IDs para renderizar o texto original e o contexto. Um item recusado não apaga os outros estruturalmente válidos; o resultado informa a recusa e não transforma as partes restantes em perfil confirmado.

Há guardas específicos para referências inválidas, fonte de interface usada como fato, nome sem apoio, condição sem segmento contínuo, vigência atual presumida de editorial e alguns conflitos de direção financeira. Eles não substituem revisão semântica: uma relação pode citar um texto real e ainda atribuir o papel à pessoa errada.

Todas as saídas mantêm `perfilConfirmado:false` e revisão semântica pendente. O módulo não fornece prioridade de anúncio, ranking, procura ou lucro. Ele prepara evidências e hipóteses para a etapa seguinte de confirmação e análise.

## Comparação controlada do contexto

Para um arquivo de contexto já preparado:

```sh
.venv-ia/bin/python -B ia/negocio/relacoes/executar.py --contextos data/contexto.json --saida data/comparacao-nova.json --comparar-sem-contexto
```

As duas condições usam o mesmo modelo, textos selecionados, IDs e protocolo. A segunda omite os metadados de contexto. As respostas são preservadas integralmente. Como os comprimentos dos prompts diferem, essa comparação mede o pacote de contexto, não qual metadado isolado causou um efeito. O contrato relacional novo também não deve ser tratado como ganho de pesos sobre os placares anteriores.

## Verificações do módulo

```sh
node --test test/contexto-relacional.test.mjs test/analisar-relacoes.test.mjs
PYTHONPATH=ia .venv-ia/bin/python -B -m unittest ia.test_relacoes_contextuais
```

Esses testes verificam mecanismos de software e controles específicos. A compreensão do negócio precisa ser revisada em empresas novas, incluindo omissões, relações incorretas e bloqueios de coleta. A aprovação para uso autônomo não decorre de um JSON válido ou de um teste de software aprovado.
