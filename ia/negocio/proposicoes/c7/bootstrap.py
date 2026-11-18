"""Treino único sob6GiB; registra pico de tensores, sem editar dependências."""
import argparse
from datetime import datetime,timezone
from functools import partial
import json
from pathlib import Path
import sys
import time


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',required=True);p.add_argument('--metricas',required=True);a=p.parse_args()
    import mlx.core as mx
    mx.set_memory_limit(6*1024**3);mx.set_cache_limit(128*1024**2)
    import mlx_lm.lora as lora
    sys.path.insert(0,str(Path(__file__).resolve().parents[3]))
    from negocio.treino_memoria.perda_em_blocos import perda_qwen35_em_blocos
    loss=partial(perda_qwen35_em_blocos,bloco=128,checkpoint=True)
    lora.train=partial(lora.train,loss=loss);lora.evaluate=partial(lora.evaluate,loss=loss)
    inicio=time.monotonic();erro=None
    try:
        sys.argv=['mlx_lm.lora','--config',a.config];lora.main()
    except BaseException as e:
        erro=type(e).__name__+': '+str(e);raise
    finally:
        r={'fim':datetime.now(timezone.utc).isoformat(),'segundos':time.monotonic()-inicio,'picoTensoresMLXGiB':mx.get_peak_memory()/1024**3,'limiteTensoresMLXGiB':6,'cacheBytes':128*1024**2,'erro':erro,'perda':'CE em blocos128; máscara original mlx-lm preservada; prompt mascarado','bibliotecaInstaladaAlterada':False}
        with Path(a.metricas).open('x') as f:json.dump(r,f,ensure_ascii=False,indent=2);f.write('\n')
        print(json.dumps(r,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
