"""Geração com vocabulário de saídas finito; garante formato, não correção."""

import json
from contrato_v2 import escolhas_possiveis, mensagens, serializar


def arvore_sequencias(sequencias, eos):
    arvore = {}
    for seq in sequencias:
        for i, token in enumerate(seq):
            arvore.setdefault(tuple(seq[:i]), set()).add(token)
        arvore.setdefault(tuple(seq), set()).add(eos)
        # mlx-lm pode calcular um token adiante mesmo após prever EOS.
        arvore.setdefault(tuple(seq + [eos]), set()).add(eos)
    return arvore


def gerar_escolha(modelo, tokenizer, entrada, restrito=True):
    import mlx.core as mx
    from mlx_lm import generate
    from mlx_lm.sample_utils import make_sampler

    prompt = tokenizer.apply_chat_template(mensagens(entrada), tokenize=True, return_dict=False,
                                            add_generation_prompt=True)
    if len(prompt) > 1152:
        raise ValueError("Entrada excede o limite; nenhuma evidência foi truncada.")
    escolhas = list(escolhas_possiveis([e["id"] for e in entrada["evidencias"]]))
    possiveis = [serializar(e) for e in escolhas]
    seqs = [tokenizer.encode(texto, add_special_tokens=False) for texto in possiveis]
    if any(tokenizer.decode(seq) != texto for seq, texto in zip(seqs, possiveis)):
        raise ValueError("O tokenizador não reproduz literalmente as opções do contrato.")
    max_tokens = max(map(len, seqs)) + 2 if restrito else 100
    processadores = None
    if restrito:
        arvore = arvore_sequencias(seqs, tokenizer.eos_token_id)
        tamanho_prompt = len(prompt)

        def limitar(tokens, logits):
            sufixo = tuple(tokens.tolist()[tamanho_prompt:])
            permitidos = arvore.get(sufixo)
            if not permitidos:
                raise RuntimeError("Sequência fora da gramática fechada.")
            indices = mx.array(sorted(permitidos), dtype=mx.int32)
            mascara = mx.full(logits.shape, float("-inf"), dtype=logits.dtype)
            mascara[:, indices] = logits[:, indices]
            return mascara

        processadores = [limitar]
    bruto = generate(modelo, tokenizer, prompt=prompt, max_tokens=max_tokens,
                     sampler=make_sampler(temp=0), logits_processors=processadores, verbose=False)
    try:
        escolha = json.loads(bruto)
    except (ValueError, TypeError):
        escolha = None
    if restrito and bruto not in possiveis:
        raise RuntimeError("Resposta restrita não está no conjunto permitido.")
    return bruto, escolha
