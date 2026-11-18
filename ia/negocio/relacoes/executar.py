"""Inferência local optativa de contexto/relações. Nunca modifica a seleção padrão.

Uso: .venv-ia/bin/python -B ia/negocio/relacoes/executar.py --contextos ...
     --saida NOVO.json [--comparar-sem-contexto]
"""
import argparse
from copy import deepcopy
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import shutil
import importlib.metadata as metadata

IA=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(IA))
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1')
from negocio.contrato import ler_json_estrito
from negocio.relacoes.contrato import validar_e_renderizar
from negocio.relacoes.protocolo import mensagens,esquema


def hash_json(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def hash_file(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def gerar(modelo,tok,entrada,*,max_tokens=1800,max_sequencia=8192):
    from mlx_lm import stream_generate
    from mlx_lm.sample_utils import make_sampler
    from negocio.protocolo import prefixo_assistente
    from negocio.decodificacao.core_mlx import preparar_indice_json,criar_processador_mlx
    ms=mensagens(entrada)
    protocolo=prefixo_assistente(tok,ms);prompt=protocolo['prompt']
    ids=tok.encode(prompt,add_special_tokens=False)
    identidade={'entradaSha256':hash_json(entrada),'mensagensSha256':hash_json(ms),
                'promptUtf8Sha256':hashlib.sha256(prompt.encode()).hexdigest(),'tokensSha256':hash_json(ids)}
    if not entrada['fontes']:
        saida={'estado':'insuficiente','relacoes':[],'condicoes':[],'duvidas':['Nenhuma fonte recuperada.']}
        return {'inferida':False,'estado':'regra_ausencia_de_fontes','saida':saida,'textoBruto':None,'identidade':identidade}
    if len(ids)+max_tokens>max_sequencia:
        return {'inferida':False,'estado':'nao_executada_orcamento','saida':None,'textoBruto':None,'tokensEntrada':len(ids),'identidade':identidade}
    inicio=time.monotonic()
    preparado=preparar_indice_json(esquema(entrada),tok,limitar_comprimento_texto=False)
    processor=criar_processador_mlx(preparado)
    partes=[];ultimo=None
    for ultimo in stream_generate(modelo,tok,prompt=prompt,max_tokens=max_tokens,sampler=make_sampler(temp=0.0),logits_processors=[processor]):
        partes.append(ultimo.text)
    bruto=''.join(partes);saida=None;erro=None
    try:saida=ler_json_estrito(bruto)
    except (TypeError,ValueError):erro='json_invalido'
    return {'inferida':True,'estado':'gerada' if saida is not None else 'recusada',
            'saida':saida,'textoBruto':bruto,'erro':erro,'tokensEntrada':len(ids),
            'tokensGerados':ultimo.generation_tokens if ultimo else 0,'fimGeracao':ultimo.finish_reason if ultimo else None,
            'segundos':time.monotonic()-inicio,'identidade':identidade,'decoder':preparado.auditoria}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--contextos',type=Path,nargs='+',required=True);p.add_argument('--saida',type=Path,required=True)
    p.add_argument('--comparar-sem-contexto',action='store_true');p.add_argument('--max-tokens',type=int,default=1800)
    p.add_argument('--modelo-base',choices=['qwen3-4b','qwen35-4b'],default='qwen35-4b')
    a=p.parse_args()
    if not 128<=a.max_tokens<=2400:p.error('Limite de resposta deve ficar entre128 e2400.')
    if a.saida.exists() or a.saida.with_suffix('.jsonl').exists():p.error('Use saída nova para preservar resultados.')
    contextos=[]
    for arquivo in a.contextos:
        ver=subprocess.run(['node',str(Path(__file__).with_name('verificar.mjs')),str(arquivo.resolve())],check=True,capture_output=True,text=True,timeout=60)
        contexto=json.loads(arquivo.read_text());verificado=json.loads(ver.stdout)
        if hash_file(arquivo)!=verificado['contextoSha256']:raise ValueError('Contexto mudou após verificação.')
        contextos.append((contexto,verificado))
    # Both conditions use exactly the same selected text and IDs. The ablation
    # omits metadata; no different retrieval or extra data is supplied.
    inicio=datetime.now(timezone.utc).isoformat()
    a.saida.parent.mkdir(parents=True,exist_ok=True)
    codigo={str(f.relative_to(IA.parent)):hash_file(f) for f in Path(__file__).parent.glob('*.py')}
    dependentes=['runtime.py','negocio/runtime_negocio.py','negocio/modelos.py','negocio/protocolo.py',
                 'negocio/decodificacao/core_mlx.py','negocio/contrato.py','negocio/recuperacao.mjs',
                 'negocio/capturas.mjs','negocio/fontes-v3.mjs']
    for f in [*(IA/n for n in dependentes),*Path(__file__).parent.glob('*.mjs')]:codigo[str(f.relative_to(IA.parent))]=hash_file(f)
    capsula=a.saida.with_suffix('.codigo');capsula.mkdir(exist_ok=False)
    for nome,h in codigo.items():
        fonte=IA.parent/nome
        if hash_file(fonte)!=h:raise ValueError('Código alterado durante congelamento: '+nome)
        destino=capsula/nome;destino.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(fonte,destino)
    from negocio.runtime_negocio import carregar_leitor
    modelo,tok,meta=carregar_leitor(modelo_base=a.modelo_base)
    resultados=[]
    with a.saida.with_suffix('.jsonl').open('x') as journal:
        for c,v in contextos:
            for modo in (['com_contexto','sem_contexto'] if a.comparar_sem_contexto else ['com_contexto']):
                e=deepcopy(c['entrada'])
                if modo=='sem_contexto':
                    for f in e['fontes']:f.pop('contexto',None)
                try:
                    g=gerar(modelo,tok,e,max_tokens=a.max_tokens)
                except Exception as erro:
                    # Failed execution is distinct from an evidence-based refusal.
                    g={'inferida':None,'estado':'erro_execucao','erro':type(erro).__name__+': '+str(erro)[:500]}
                    revisao=None
                else:
                    try:revisao=validar_e_renderizar(g['saida'],e)
                    except Exception as erro:
                        revisao=None;g['erroRevisao']=type(erro).__name__+': '+str(erro)[:500]
                r={'dominio':e['dominio'],'modo':modo,'entrada':e,'verificacao':v,'geracao':g,'revisao':revisao}
                resultados.append(r);journal.write(json.dumps(r,ensure_ascii=False)+'\n');journal.flush()
                print(json.dumps({'dominio':e['dominio'],'modo':modo,'estado':g['estado'],
                    'relacoes':len(revisao['relacoes']) if revisao else None,'condicoes':len(revisao['condicoes']) if revisao else None}),flush=True)
                import gc
                gc.collect()
                import mlx.core as mx
                mx.clear_cache()
    final={'versao':1,'inicio':inicio,'fim':datetime.now(timezone.utc).isoformat(),'modelo':meta,
        'dependencias':{n:metadata.version(n) for n in ['mlx','mlx-lm','transformers','tokenizers','outlines-core']},
        'codigo':codigo,'codigoAlterado':any(hash_file(IA.parent/f)!=h for f,h in codigo.items()),
        'resultados':resultados,'config':{'maxTokens':a.max_tokens,'maxSequencia':8192,'temperatura':0},
        'limites':['Inferência local sem API paga. Revisão semântica humana e confirmação pelo negócio pendentes.',
                  'Ablation mantém textos/modelo; contratos novos não são comparáveis como acerto de pesos com o leitor anterior.']}
    with a.saida.open('x') as f:json.dump(final,f,ensure_ascii=False,indent=2);f.write('\n')


if __name__=='__main__':main()
