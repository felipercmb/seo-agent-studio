"""Inferência C14 por unidade. Experimento offline, sem substituir o motor padrão."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

RAIZ=Path(__file__).resolve().parents[3];sys.path.insert(0,str(RAIZ/'ia'))
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1',TOKENIZERS_PARALLELISM='false')
from negocio.quadros.protocolo import mensagens,esquema
from negocio.quadros.contrato import projetar,conferir_entrada

def codigo():
    paths=list(Path(__file__).parent.glob('*.py'))+[RAIZ/p for p in ['ia/negocio/proposicoes/contrato.py','ia/negocio/proposicoes/unidades.py','ia/negocio/proposicoes/c7/dados.py','ia/negocio/protocolo.py','ia/negocio/decodificacao/core_mlx.py','ia/negocio/runtime_negocio.py','ia/negocio/modelos.py','ia/negocio/treino_memoria/perda_em_blocos.py']]
    return {str(p.relative_to(RAIZ)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}

def conferir_adaptador(pasta):
    p=Path(pasta);r=json.loads((p/'treino.json').read_text())
    if r.get('estado')!='concluido' or r.get('novoAjustePesos') is not True or r.get('codigoMudouDuranteExecucao') is not False or r.get('protocoloSha256')!=hashlib.sha256(Path(__file__).with_name('protocolo.py').read_bytes()).hexdigest():raise ValueError('Adaptador C14 sem proveniência estável.')
    for n,k in [('adapters.safetensors','adaptadorSha256'),('adapter_config.json','configAdaptadorSha256')]:
        if hashlib.sha256((p/n).read_bytes()).hexdigest()!=r.get(k):raise ValueError('Adaptador alterado.')
    return p

class LeitorQuadros:
    def __init__(self,adaptador=None):
        from negocio.runtime_negocio import carregar_leitor
        self.modelo,self.tok,self.meta=carregar_leitor(adaptador=conferir_adaptador(adaptador) if adaptador else None,modelo_base='qwen35-4b')
        self.indices={}

    def gerar(self,e):
        conferir_entrada(e)
        from negocio.protocolo import prefixo_assistente
        from negocio.decodificacao.core_mlx import preparar_indice_json,criar_processador_mlx
        from negocio.contrato import ler_json_estrito
        from mlx_lm import stream_generate
        from mlx_lm.sample_utils import make_sampler
        ms=mensagens(e);prompt=prefixo_assistente(self.tok,ms)['prompt'];tokens=self.tok.encode(prompt,add_special_tokens=False)
        if len(tokens)+256>4096:return {'estado':'orcamento_excedido','inferida':False,'saida':None,'tokensEntrada':len(tokens)}
        if e['tarefa'] not in self.indices:self.indices[e['tarefa']]=preparar_indice_json(esquema(e),self.tok,limitar_comprimento_texto=False)
        processador=criar_processador_mlx(self.indices[e['tarefa']]);inicio=time.monotonic();partes=[];ultimo=None
        for ultimo in stream_generate(self.modelo,self.tok,prompt=prompt,max_tokens=256,sampler=make_sampler(temp=0),logits_processors=[processador]):partes.append(ultimo.text)
        bruto=''.join(partes);s=None;falha=None
        try:s=ler_json_estrito(bruto)
        except (ValueError,TypeError) as err:falha=type(err).__name__
        return {'estado':'gerada' if s is not None else 'json_recusado','inferida':True,'saida':s,'textoBruto':bruto,'falha':falha,
            'segundos':time.monotonic()-inicio,'tokensEntrada':len(tokens),'tokensGerados':ultimo.generation_tokens if ultimo else 0,'fimGeracao':ultimo.finish_reason if ultimo else None,
            'mensagensSha256':hashlib.sha256(json.dumps(ms,ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),
            'validacao':projetar(s,e),'modeloPadraoAlterado':False}
