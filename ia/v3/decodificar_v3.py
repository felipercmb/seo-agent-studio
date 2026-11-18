"""Geração restrita às ações e IDs possíveis da terceira rodada."""

import json
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parent.parent / "v2"))
from decodificar import arvore_sequencias
from contrato_v3 import mensagens, escolhas_possiveis, serializar


def gerar_escolha(modelo, tokenizer, entrada):
    import mlx.core as mx
    from mlx_lm import generate
    from mlx_lm.sample_utils import make_sampler
    prompt = tokenizer.apply_chat_template(mensagens(entrada), tokenize=True, return_dict=False, add_generation_prompt=True)
    if len(prompt) > 1152:
        raise ValueError("Contexto extenso; reduza evidências sem truncagem silenciosa.")
    textos = [serializar(c) for c in escolhas_possiveis([e["id"] for e in entrada["evidencias"]])]
    sequencias = [tokenizer.encode(t, add_special_tokens=False) for t in textos]
    if any(tokenizer.decode(s) != t for s, t in zip(sequencias, textos)):
        raise ValueError("Tokenizador não reproduz as opções.")
    arvore = arvore_sequencias(sequencias, tokenizer.eos_token_id)
    def restringir(tokens, logits):
        permitidos = arvore.get(tuple(tokens.tolist()[len(prompt):]))
        if not permitidos:
            raise RuntimeError("Sequência fora da gramática de ações.")
        indices = mx.array(sorted(permitidos), dtype=mx.int32)
        mascara = mx.full(logits.shape, float("-inf"), dtype=logits.dtype)
        mascara[:, indices] = logits[:, indices]
        return mascara
    bruto = generate(modelo, tokenizer, prompt=prompt, max_tokens=max(map(len, sequencias)) + 2,
                     sampler=make_sampler(temp=0), logits_processors=[restringir], verbose=False)
    if bruto not in textos:
        raise RuntimeError("Resposta fora das escolhas permitidas.")
    return bruto, json.loads(bruto)
