"""FSM/máscara nativasCPU. Não importa MLX, tokenizer externo ou pesos."""
import argparse
import ctypes
from datetime import datetime,timezone
import importlib.metadata as metadata
import json
import math
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from negocio.decodificacao.core_mlx import _mapa_bytes,preparar_indice_json,ProcessadorSerial

class Decoder:
    def __getstate__(self):return b'{"type":"ByteLevel"}'
class Backend:decoder=Decoder()
class Tokenizer:
    backend_tokenizer=Backend();eos_token_id=256;all_special_ids=[256,257]
    def get_vocab(self):return{**_mapa_bytes(),'<eos>':256,'<think>':257}
class Tokens:
    def __init__(self,values):self.values=values;self.shape=(len(values),)
    def __len__(self):return len(self.values)
    def __getitem__(self,i):return self.values[i]
class Logits:
    def __init__(self,values=None):self.values=values or [[0.0]*258];self.shape=(1,len(self.values[0]))

def processador(preparado):
    from outlines_core import Guide
    def alocar(n):return(ctypes.c_uint32*((n+31)//32))()
    def preencher(guia,mascara):guia.write_mask_into(ctypes.addressof(mascara),len(mascara),ctypes.sizeof(ctypes.c_uint32))
    def aplicar(logits,mascara):return Logits([[v if (mascara[i//32]>>(i%32))&1 else -math.inf for i,v in enumerate(logits.values[0])]])
    return ProcessadorSerial(Guide(preparado.indice),preparado.eos,preparado.max_token_id,alocar,preencher,aplicar)

def ensaiar(schema,esperado):
    t=time.monotonic();indice=preparar_indice_json(schema,Tokenizer());compilacao=time.monotonic()-t;proc=processador(indice);ids=[257]
    for byte in esperado.encode():
        permitido=proc(Tokens(ids),Logits()).values[0]
        if not math.isfinite(permitido[byte]):raise AssertionError('Byte válido bloqueado: '+str(byte))
        ids.append(byte)
    fim=proc(Tokens(ids),Logits()).values[0]
    assert math.isfinite(fim[256]) and not math.isfinite(fim[ord('x')])
    return{'textoEsperado':esperado,'bytesAceitos':len(esperado.encode()),'EOSAoConcluir':True,'compilacaoSegundos':compilacao,'totalSegundos':time.monotonic()-t,'auditoria':indice.auditoria}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists():raise ValueError('Use saída nova.')
    schema={'type':'object','properties':{'estado':{'enum':['insuficiente']},'valor':{'enum':['indefinido']},'fontes':{'type':'array','maxItems':0,'items':{'type':'string'}},'faltam':{'type':'array','minItems':1,'maxItems':1,'items':{'enum':['papel']}}},'required':['estado','valor','fontes','faltam'],'additionalProperties':False}
    texto='{"estado":"insuficiente","valor":"indefinido","fontes":[],"faltam":["papel"]}'
    rs=[ensaiar(schema,texto)]
    pref='{"estado":"insuficiente","valor":"indefinido","fontes":[],"falta';pr=processador(preparar_indice_json(schema,Tokenizer()));ids=[257]
    for byte in pref.encode():pr(Tokens(ids),Logits());ids.append(byte)
    allowed=pr(Tokens(ids),Logits()).values[0]
    assert math.isfinite(allowed[ord('m')]) and not math.isfinite(allowed[ord('n')])
    rs.append(ensaiar({'type':'object','properties':{'texto':{'enum':['ação\u200d']}},'required':['texto'],'additionalProperties':False},'{"texto":"ação\u200d"}'))
    report={'versao':1,'executadoEm':datetime.now(timezone.utc).isoformat(),'core':metadata.version('outlines-core'),'modeloCarregado':False,'MLXImportado':False,'GPUUsada':False,'inferencias':0,'tokenizer':'autoral256bytes','faltamAceitoFaltanBloqueado':True,'resultados':rs,'limites':['TesteCPU de compilaçãoFSM, avanço serial e bitmask nativo; logits são doubles, não tensoresMLX.','Integração realMLX pendente porque importmlx.core no ambiente original aborta/bloqueia.','Sem tokenizerQwen, pesos ou kernelMetal; não prova desempenho, literalidade ouU1–U4.']}
    a.saida.parent.mkdir(parents=True,exist_ok=True)
    with a.saida.open('x') as f:json.dump(report,f,ensure_ascii=False,indent=2);f.write('\n')
    print(json.dumps({k:report[k] for k in ('core','MLXImportado','GPUUsada','faltamAceitoFaltanBloqueado')},ensure_ascii=False))

if __name__=='__main__':main()
