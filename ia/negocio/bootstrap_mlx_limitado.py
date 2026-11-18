"""Configura o orçamento MLX antes de o treinador carregar pesos/tensores."""

import argparse
import json
import sys
from functools import partial
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config",required=True);p.add_argument("--memoria-gib",type=float,default=6.0)
    p.add_argument("--perda-blocos",type=int,choices=(0,64,128),default=0)
    a=p.parse_args()
    if not 2<=a.memoria_gib<=8:p.error("Orçamento local deve estar entre2e8GiB.")
    import mlx.core as mx
    limite=int(a.memoria_gib*1024**3);cache=128*1024**2
    mx.set_memory_limit(limite);mx.set_cache_limit(cache)
    print(json.dumps({"limiteMLXBytes":limite,"limiteCacheMLXBytes":cache,"antesDeCarregarPesos":True}),flush=True)
    import mlx_lm.lora as modulo_lora
    if a.perda_blocos:
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
        from negocio.treino_memoria.perda_em_blocos import perda_qwen35_em_blocos
        perda=partial(perda_qwen35_em_blocos,bloco=a.perda_blocos,checkpoint=True)
        modulo_lora.train=partial(modulo_lora.train,loss=perda)
        modulo_lora.evaluate=partial(modulo_lora.evaluate,loss=perda)
        print(json.dumps({"perda":"qwen35_head_ce_em_blocos","bloco":a.perda_blocos,
            "mascaraOriginalPreservada":True,"bibliotecaInstaladaAlterada":False}),flush=True)
    sys.argv=["mlx_lm.lora","--config",a.config]
    modulo_lora.main()


if __name__=="__main__":main()
