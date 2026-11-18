"""Bootstrap comum de ensaios locais; alterações restritas a este subprocesso."""
import argparse
from datetime import datetime,timezone
from functools import partial
import json
from pathlib import Path
import sys
import time

def main():
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--metricas',required=True);p.add_argument('--pesos',required=True);a=p.parse_args()
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    import mlx.core as mx
    mx.set_memory_limit(6*1024**3);mx.set_cache_limit(128*1024**2)
    import mlx_lm.lora as lora
    from negocio.ensaios_pesos import indexar,empacotar,perda_ponderada
    tabela=indexar(json.loads(Path(a.pesos).read_text()));import mlx_lm.tuner.trainer as trainer
    original=trainer.iterate_batches
    def iterador(*args,**kwargs):
        for batch,lengths in original(*args,**kwargs):yield batch,mx.array(empacotar(batch.tolist(),lengths.tolist(),tabela),dtype=mx.int32)
    loss=partial(perda_ponderada,bloco=128,checkpoint=True)
    lora.train=partial(lora.train,loss=loss,iterate_batches=iterador);lora.evaluate=partial(lora.evaluate,loss=loss,iterate_batches=iterador)
    inicio=time.monotonic();erro=None
    try:sys.argv=['mlx_lm.lora','--config',a.config];lora.main()
    except BaseException as e:erro=type(e).__name__+': '+str(e);raise
    finally:
        r={'fim':datetime.now(timezone.utc).isoformat(),'segundos':time.monotonic()-inicio,'picoTensoresMLXGiB':mx.get_peak_memory()/1024**3,'limiteTensoresMLXGiB':6,'limiteMLXSolicitadoNaoEhBarreiraDeAlocacao':True,'cacheBytes':128*1024**2,'erro':erro,'perda':'CE ponderada em blocos de 128, alvo de offset até comprimento real exclusivo','incluiPaddingNaPerda':False,'bibliotecaInstaladaAlterada':False}
        with Path(a.metricas).open('x') as f:json.dump(r,f,ensure_ascii=False,indent=2);f.write('\n')
        print(json.dumps(r,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
