"""Experimento isolado: mesma máscara mlx-lm0.32.2, head/CE em blocos.

Não substitui funções instaladas e não é importado pelo treinador ativo.
Suporta o caminho textual Qwen3.5 sem sharding nem transformações de logits.
"""


def perda_qwen35_em_blocos(model, batch, lengths, *, bloco=128, checkpoint=True):
    """Retorna (CE média, ntoks), mantendo a máscara do default_loss instalado.

    O backbone recebe toda a sequência: remover o prompt antes da atenção
    alteraria a tarefa. Só a projeção vocabular e a CE são divididas. As fatias
    têm tamanho estático; lengths permanece tensor e nunca é lido por item().
    O checkpoint do módulo recebe também seus parâmetros treináveis, evitando
    perder gradientes do head ou do embedding compartilhado.

    Atenção: por equivalência, preserva steps <= lengths[:, 1], inclusive o
    primeiro alvo de padding que o iterador instalado pode acrescentar depois
    do EOS. Alterar essa convenção é outro experimento, não uma otimização.
    """
    import mlx.core as mx
    import mlx.nn as nn
    from mlx.nn.utils import checkpoint as checkpoint_module

    if isinstance(bloco, bool) or not isinstance(bloco, int) or bloco < 1:
        raise ValueError("Bloco inteiro positivo necessário.")
    if len(batch.shape) != 2 or batch.shape[1] < 2:
        raise ValueError("Batch BxT com pelo menos dois tokens necessário.")
    if tuple(lengths.shape) != (batch.shape[0], 2):
        raise ValueError("lengths deve ter forma Bx2; máscara idêntica ao mlx-lm.")
    lm = getattr(model, "language_model", None)
    if lm is None or getattr(lm, "model", None) is None or getattr(lm, "args", None) is None:
        raise ValueError("Caminho textual explícito model.language_model.model necessário.")
    if getattr(lm, "sharding_group", None) is not None:
        raise ValueError("Head com sharding não foi validado neste experimento.")
    if getattr(lm.model, "pipeline_size", 1) != 1:
        raise ValueError("Pipeline distribuído não foi validado neste experimento.")
    tied = getattr(lm.args, "tie_word_embeddings", None)
    if not isinstance(tied, bool):
        raise ValueError("Convenção de embedding compartilhado deve ser explícita.")
    head = lm.model.embed_tokens if tied else getattr(lm, "lm_head", None)
    if head is None:
        raise ValueError("Projeção vocabular ausente.")

    inputs, targets = batch[:, :-1], batch[:, 1:]
    hidden = lm.model(inputs)
    if len(hidden.shape) != 3 or tuple(hidden.shape[:2]) != tuple(inputs.shape):
        raise ValueError("Backbone não retornou hidden states BxTxH.")
    steps = mx.arange(1, targets.shape[1] + 1)
    mask = mx.logical_and(steps >= lengths[:, 0:1], steps <= lengths[:, 1:])
    ntoks = mask.sum()

    def loss_bloco(h, target, ativo):
        # mx.checkpoint calcula VJPs dos argumentos. Índices da CE e a máscara
        # não são variáveis diferenciáveis, inclusive no recompute do bloco.
        target = mx.stop_gradient(target)
        ativo = mx.stop_gradient(ativo)
        logits = head.as_linear(h) if tied else head(h)
        return (nn.losses.cross_entropy(logits, target) * ativo).astype(mx.float32).sum()

    # Checkpoint também captura parâmetros do módulo explicitamente. Um simples
    # fechamento sobre head pode omitir a dependência de pesos no backward.
    calcular = checkpoint_module(head, loss_bloco) if checkpoint else loss_bloco
    total = mx.array(0.0, dtype=mx.float32)
    for inicio in range(0, targets.shape[1], bloco):
        fim = min(inicio + bloco, targets.shape[1])
        total = total + calcular(hidden[:, inicio:fim], targets[:, inicio:fim], mask[:, inicio:fim])
    return total / ntoks, ntoks
