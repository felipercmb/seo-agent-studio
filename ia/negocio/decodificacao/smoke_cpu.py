"""Smoke real de core+MLXCPU, sem pesos, tokenizer externo ou inferência."""
import argparse
from datetime import datetime,timezone
import importlib.metadata as metadata
import json
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists():raise ValueError('Use saída nova.')
    import mlx.core as mx
    mx.set_default_device(mx.cpu)
    from negocio.decodificacao.core_mlx import _mapa_bytes,preparar_indice_json,criar_processador_mlx
    from negocio.contrato import validar_saida
    class Decoder:
        def __getstate__(self):return b'{"type":"ByteLevel"}'
    class Backend:decoder=Decoder()
    class Tokenizer:
        backend_tokenizer=Backend();eos_token_id=256;all_special_ids=[256,257]
        def get_vocab(self):return{**_mapa_bytes(),'<eos>':256,'<think>':257}
    def ensaiar(schema,esperado):
        inicio=time.monotonic();indice=preparar_indice_json(schema,Tokenizer());tempo_indice=time.monotonic()-inicio
        proc=criar_processador_mlx(indice);tokens=mx.array([257],dtype=mx.uint32);logits=mx.zeros((1,258),dtype=mx.float32)
        for byte in esperado.encode('utf-8'):
            mascarado=proc(tokens,logits);mx.eval(mascarado)
            if not bool(mx.isfinite(mascarado[0,byte]).item()):raise AssertionError('Byte válido bloqueado: '+str(byte))
            tokens=mx.concatenate([tokens,mx.array([byte],dtype=mx.uint32)])
        fim=proc(tokens,logits);mx.eval(fim)
        assert bool(mx.isfinite(fim[0,256]).item()) and not bool(mx.isfinite(fim[0,ord('x')]).item())
        return{'schemaSha256':indice.auditoria['schemaSha256'],'textoEsperado':esperado,'bytesAceitos':len(esperado.encode()),'EOSAceitoSomenteAoConcluir':True,'indiceSegundos':tempo_indice,'totalSegundos':time.monotonic()-inicio,'auditoria':indice.auditoria}
    schema={'type':'object','properties':{'estado':{'enum':['insuficiente']},'valor':{'enum':['indefinido']},'fontes':{'type':'array','maxItems':0,'items':{'type':'string'}},'faltam':{'type':'array','minItems':1,'maxItems':1,'items':{'enum':['papel']}}},'required':['estado','valor','fontes','faltam'],'additionalProperties':False}
    texto='{"estado":"insuficiente","valor":"indefinido","fontes":[],"faltam":["papel"]}'
    resultados=[ensaiar(schema,texto)]
    assert not validar_saida(json.loads(texto),{'tarefa':'entender','campo':'papel','fontes':[]})
    # Verifica nome de chave, não apenas fechamento de chaves.
    indice=preparar_indice_json(schema,Tokenizer());proc=criar_processador_mlx(indice);tokens=mx.array([257],dtype=mx.uint32);logits=mx.zeros((1,258))
    for byte in b'{"':
        proc(tokens,logits);tokens=mx.concatenate([tokens,mx.array([byte],dtype=mx.uint32)])
    masked=proc(tokens,logits);mx.eval(masked)
    assert bool(mx.isfinite(masked[0,ord('e')]).item()) and not bool(mx.isfinite(masked[0,ord('f')]).item())
    unicode_schema={'type':'object','properties':{'texto':{'enum':['ação\u200d']}},'required':['texto'],'additionalProperties':False}
    resultados.append(ensaiar(unicode_schema,'{"texto":"ação\u200d"}'))
    report={'versao':1,'executadoEm':datetime.now(timezone.utc).isoformat(),'device':str(mx.default_device()),'modeloCarregado':False,'tokenizer':'autoral256bytes_sem_download','GPUUsada':False,'inferencias':0,'core':metadata.version('outlines-core'),'mlx':metadata.version('mlx'),'chaveForaDoSchemaBloqueada':True,'resultados':resultados,'limites':['Smoke de índice/máscara/estado com vocabulário autoral, não avaliação de modelo.','Tokenizer real Qwen, memória/latência de índice grande e kernel Metal não foram testados aqui.','Estrutura não garante literalidade, escopo, ausência de alucinação ou U1–U4.']}
    a.saida.parent.mkdir(parents=True,exist_ok=True)
    with a.saida.open('x') as out:json.dump(report,out,ensure_ascii=False,indent=2);out.write('\n')
    print(json.dumps({k:report[k] for k in ('device','modeloCarregado','GPUUsada','core','chaveForaDoSchemaBloqueada')},ensure_ascii=False))

if __name__=='__main__':main()
