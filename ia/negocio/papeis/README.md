# Conferência de papéis de uma relação fornecida — C16

Este módulo experimental recebe **uma relação já proposta**, com ator, ação/indicador nominal e objeto literais na unidade. Classifica se a proposta merece ser mantida para revisão e sugere tipo de ator, escopo e negação. Ele não descobre o negócio, a oferta ou relações que o extrator deixou de encontrar.

Os campos de texto vêm da entrada e não são reescritos pelo modelo. Um classificador pode recusar a proposta ou errar sua classificação; formato e citação literal não certificam a semântica. A projeção preserva a proposta original, a fonte completa e `revisaoSemantica: pendente`. O módulo não muda o perfil ou a seleção padrão do aplicativo.

## Corpus e diagnóstico

O gerador deriva propostas canônicas do corpus C15 conhecido e produz trocas controladas de sujeito/objeto. Acrescenta instruções indevidamente atribuídas ao objeto quando há texto literal para formar essa proposta. Casos sem proposta classificável ficam no relatório de descartes. As divisões conservam famílias e entidades separadas; variantes da mesma unidade continuam dependentes.

**Os quadros corretos são fornecidos nos casos canônicos positivos.** A pontuação mede classificação condicional, não extração. A reserva real final não alimenta o corpus. As referências técnicas não têm revisão independente de especialista.

```sh
PYTHONPATH=ia .venv-ia/bin/python -m negocio.papeis.dados --origem CORPUS_C15 --saida CORPUS_C16_NOVO
.venv-ia/bin/python ia/negocio/papeis/treinar.py --corpus CORPUS_C16 --saida PREFLIGHT_NOVO --passos 400 --rank 32 --camadas 1
```

Sem `--executar`, o treino só verifica dados, fontes, mensagens e tokenização. Para treinar, use outra pasta nova e acrescente `--executar`. Usa o mesmo treinador local auditado, com a especificação C16 selecionada apenas no subprocesso; nenhum arquivo da biblioteca instalada é alterado. Requer o modelo e o ambiente já presentes, sem baixar pesos. Os limites de memória e as condições de uso do host são os descritos no [C15](../atribuicoes/README.md).

```sh
.venv-ia/bin/python ia/negocio/papeis/avaliar.py --tarefas CORPUS_C16/tarefas-valid.jsonl --saida BASE_NOVA
.venv-ia/bin/python ia/negocio/papeis/avaliar.py --tarefas CORPUS_C16/tarefas-valid.jsonl --saida CANDIDATO_NOVO --adaptador ADAPTADOR_C16
```

As saídas incluem `ESCOPO-CLASSIFICACAO.json`, que explicita o fornecimento da relação e da oferta. Os protocolos de C15 e C16 são diferentes; um adaptador não é carregado como se fosse o outro. Consulte os resultados e limites no [relatório desta rodada](../../../docs/CONFERENCIA-PAPEIS-LOCAL.md).

## Conferir propostas sem fornecer gabarito

O comando abaixo usa o [exemplo autoral controlado](../../../exemplos/conferencia-papeis-controlada.json), sem consultar um site ou receber uma resposta esperada:

```sh
.venv-ia/bin/python ia/classificar_papeis_local.py --entrada exemplos/conferencia-papeis-controlada.json --saida CONFERENCIA_NOVA
```

Para usar um adaptador C16 local concluído, acrescente `--adaptador CAMINHO_C16`. A entrada aceita de 1 a 32 quadros com fonte, unidade e oferta. `classificacaoAnterior` é opcional: fica preservada no recibo e não vai ao modelo. Saídas inválidas continuam como recusas/desconhecidos; diferenças são propostas para revisão, sem substituir o perfil do cliente.

O diagnóstico `ia/avaliar_combinacao_local.py` também pode encaminhar **propostas reais do C15**, em vez de relações corretas do gabarito, à conferência C16. Mantém extração original, classificação posterior e quadro final separados. Uma etapa inválida ou sem geração não vira um acerto artificial de abstenção. Esse encadeamento ainda recebe oferta/unidade e não mede descoberta do negócio nem corrige condições.

O [passo a passo de conferência local](../../../docs/CONFERENCIA-PAPEIS-LOCAL.md) explica a entrada sem gabarito, os estados de saída e a separação entre papéis e condições.
