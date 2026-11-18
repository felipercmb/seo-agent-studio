# Atribuições e condições locais — C15

Experimento extrativo por unidade publicada. Recebe uma oferta declarada, a unidade-alvo e a fonte contínua completa. Separa relação verbal, responsabilidade nominal explícita, atribuição nominal de atividade e propriedade de dados. As construções nominais preservam o marcador publicado e mantêm a ação verbal nula.

A outra tarefa lê uma condição, seu objeto, origem do objeto, gatilho, modalidade, alcance e negação literal. Duração não é evento de início. A fonte inteira permanece na saída para preservar exceções e condições adicionais. Um contrato literal não certifica os papéis ou a aplicação comercial.

## Execução local

Use o ambiente e o Qwen3.5-4B já registrados nesta instalação. Os comandos não instalam pacotes ou baixam pesos. Primeiro gere o corpus C14 com `negocio.quadros.dados`; depois converta-o:

```sh
PYTHONPATH=ia .venv-ia/bin/python -m negocio.atribuicoes.dados --origem CORPUS_C14 --saida CORPUS_C15_NOVO
.venv-ia/bin/python ia/negocio/atribuicoes/treinar.py --corpus CORPUS_C15 --saida PREFLIGHT_NOVO --passos 320 --rank 32 --camadas 1
```

O segundo comando só faz preflight. Para ajustar pesos, use outra pasta nova e acrescente `--executar`. A configuração de uma camada final q/v foi exercitada no Mac desta rodada. As tentativas de quatro/oito camadas atravessando atenção linear excederam a memória; exigem um sinalizador experimental explícito e não são a opção recomendada neste host.

O limite solicitado ao MLX **não é uma barreira absoluta de alocação**. O processo também tem monitor de RSS e prazo. Não rode dois processos de inferência/treino GPU ao mesmo tempo.

```sh
.venv-ia/bin/python ia/negocio/atribuicoes/avaliar.py --tarefas CORPUS_C15/tarefas-valid.jsonl --saida BASE_NOVA
.venv-ia/bin/python ia/negocio/atribuicoes/avaliar.py --tarefas CORPUS_C15/tarefas-valid.jsonl --saida CANDIDATO_NOVO --adaptador ADAPTADOR_LOCAL
```

O diagnóstico fornece a oferta correta; não mede descoberta da oferta ou compreensão fim a fim. Resultados distinguem igualdade estrita, casos positivos, controles sem quadro, preenchimentos indevidos e aceitação literal. Uma saída aceita pode continuar com papel ou alcance incorreto.

## Continuação dos pesos

```sh
.venv-ia/bin/python ia/negocio/ensaios_continuar.py --origem ADAPTADOR_COMPLETO --corpus MESMO_CORPUS --saida PREFLIGHT_CONTINUACAO_NOVO --passos 400
```

Acrescente `--executar` em outra saída nova para executar. O adaptador inicial é copiado e conferido por hash. A origem precisa ter recibo completo, protocolo e corpus compatíveis. Configuração LoRA, máscara e pesos por campo permanecem os mesmos. Adam e a semente são reiniciados: é continuação dos pesos, **não retomada exata do estado do otimizador**. A origem e a seleção padrão do aplicativo são preservadas.

O [guia de conferência](../../../docs/CONFERENCIA-PAPEIS-LOCAL.md) descreve o que precisa de validação humana. Estes módulos continuam experimentais.
