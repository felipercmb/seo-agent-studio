"""Treinador C14 offline; sem --executar apenas confere e tokeniza os dados."""
import argparse
from datetime import datetime,timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

RAIZ=Path(__file__).resolve().parents[3];sys.path.insert(0,str(RAIZ/'ia'))
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1',TOKENIZERS_PARALLELISM='false')
from negocio.quadros.executar import codigo
from negocio.quadros.protocolo import mensagens
from negocio.quadros.contrato import validar_saida
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
agora=lambda:datetime.now(timezone.utc).isoformat()

def conferir_corpus(pasta):
    pasta=Path(pasta);m=json.loads((pasta/'manifesto.json').read_text());splits={};familias={};entidades={}
    if m.get('natureza')!='controlado_autoral_c14' or m.get('novasEmpresasUsadas') is not False:raise ValueError('Corpus fora do protocolo.')
    for rel,h in m['codigoSha256'].items():
        if Path(rel).is_absolute() or '..' in Path(rel).parts or sha(RAIZ/rel)!=h:raise ValueError('Código mudou após gerar o corpus: '+rel)
    for split in ('train','valid'):
        for name in (split+'.jsonl','tarefas-'+split+'.jsonl'):
            if sha(pasta/name)!=m['arquivosSha256'][name]:raise ValueError('Corpus alterado.')
        rs=[json.loads(l) for l in (pasta/('tarefas-'+split+'.jsonl')).read_text().splitlines()]
        ds=[json.loads(l) for l in (pasta/(split+'.jsonl')).read_text().splitlines()]
        if len(rs)!=len(ds) or len(rs)!=m['contagens'][split]:raise ValueError('Contagem divergente.')
        for r,d in zip(rs,ds):
            if r['split']!=split or d!={'messages':r['messages']} or r['messages'][:-1]!=mensagens(r['entrada']) or json.loads(r['messages'][-1]['content'])!=r['alvo'] or validar_saida(r['alvo'],r['entrada']):raise ValueError('Alvo ou mensagem inválida: '+r['id'])
        splits[split]=rs;familias[split]={r['familia'] for r in rs};entidades[split]={r['entidade'] for r in rs}
    if familias['train']&familias['valid'] or entidades['train']&entidades['valid']:raise ValueError('Vazamento de família ou entidade.')
    return splits,m

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--corpus',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);p.add_argument('--passos',type=int,default=160);p.add_argument('--rank',type=int,default=16);p.add_argument('--camadas',type=int,default=1);p.add_argument('--limite-segundos',type=int,default=2700);p.add_argument('--executar',action='store_true');a=p.parse_args()
    if a.saida.exists() or not 1<=a.passos<=400 or a.rank not in (8,16,32) or a.camadas not in (1,4,8) or not 60<=a.limite_segundos<=5400:p.error('Saída nova, até400 passos e parâmetros limitados.')
    cod=codigo();dados,m=conferir_corpus(a.corpus);a.saida.mkdir(parents=True,mode=0o700);inicio=time.monotonic();proc=None;retorno=1
    r={'inicio':agora(),'estado':'iniciado','modeloBase':'qwen35-4b','modeloPadraoAlterado':False,'novoAjustePesos':False,'execucaoSolicitada':a.executar,'revisaoHumanaIndependente':False,'protocoloSha256':sha(Path(__file__).with_name('protocolo.py')),'codigoSha256':cod,'corpusManifestoSha256':sha(a.corpus/'manifesto.json'),'limiteMemoriaMLXGiB':6}
    try:
        from negocio.modelos import verificar_base
        pasta,proveniencia=verificar_base('qwen35-4b');r['modeloBaseProveniencia']=proveniencia
        from transformers import AutoTokenizer
        from negocio.protocolo import prefixo_assistente
        tok=AutoTokenizer.from_pretrained(str(pasta),local_files_only=True,trust_remote_code=False);tamanhos=[]
        for split,rs in dados.items():
            for item in rs:
                ids=tok.apply_chat_template(item['messages'],tokenize=True,return_dict=False)
                fronteira=prefixo_assistente(tok,item['messages'][:-1]);prefixo=tok.encode(fronteira['prompt'],add_special_tokens=False)
                if ids[:len(prefixo)]!=prefixo:raise ValueError('Prompt e alvo sem prefixo tokenizado comum.')
                tamanhos.append({'id':item['id'],'split':split,'tokens':len(ids),'tokensPrompt':len(prefixo),'tokensSha256':hashlib.sha256(json.dumps(ids).encode()).hexdigest()})
        maior=max(x['tokens'] for x in tamanhos)
        if maior>2048:raise ValueError('Exemplo excede2048; nenhum alvo foi cortado.')
        (a.saida/'tokenizacao.json').write_text(json.dumps({'exemplos':tamanhos,'maxTokens':maior,'truncamento':False},indent=2)+'\n')
        (a.saida/'dados').mkdir()
        for n in ('train.jsonl','valid.jsonl'):shutil.copy2(a.corpus/n,a.saida/'dados'/n)
        cfg={'seed':42,'model':str(pasta),'data':str((a.saida/'dados').resolve()),'adapter_path':str(a.saida.resolve()),'train':True,'test':False,'trust_remote_code':False,'report_to':None,'fine_tune_type':'lora','optimizer':'adam','num_layers':a.camadas,'batch_size':1,'iters':a.passos,'learning_rate':2e-5,'max_seq_length':2048,'mask_prompt':True,'grad_checkpoint':True,'steps_per_report':5,'steps_per_eval':40,'val_batches':8,'save_every':40,'lora_parameters':{'keys':['self_attn.q_proj','self_attn.v_proj'],'rank':a.rank,'scale':10.0,'dropout':0.0}}
        r.update(config=cfg,maxTokensVerificados=maior,dependencias={n:importlib.metadata.version(n) for n in ('mlx','mlx-lm','transformers')})
        (a.saida/'config-executada.json').write_text(json.dumps(cfg,indent=2)+'\n');shutil.copy2(a.corpus/'manifesto.json',a.saida/'manifesto-dados-fonte.json')
        for rel in cod:
            q=a.saida/'codigo'/rel;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(RAIZ/rel,q)
        if codigo()!=cod:raise ValueError('Código mudou no preflight.')
        if not a.executar:r['estado']='verificado_sem_treino';retorno=0
        else:
            r['estado']='em_treino';(a.saida/'treino.json').write_text(json.dumps(r,indent=2)+'\n')
            with (a.saida/'treino.log').open('x') as log:
                proc=subprocess.Popen([sys.executable,str(Path(__file__).with_name('bootstrap.py')),'--config',str((a.saida/'config-executada.json').resolve()),'--metricas',str((a.saida/'metricas-gpu.json').resolve())],cwd=RAIZ,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                retorno=proc.wait(timeout=a.limite_segundos)
            r['estado']='concluido' if retorno==0 else 'falhou'
            if retorno==0 and not all((a.saida/n).is_file() for n in ('adapters.safetensors','adapter_config.json')):raise ValueError('Treino terminou sem adaptador.')
    except subprocess.TimeoutExpired:r.update(estado='interrompido_prazo',erro='Limite de treino atingido.')
    except BaseException as err:r.update(estado='falhou',erro=type(err).__name__+': '+str(err))
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=10)
        for n,k in [('adapters.safetensors','adaptadorSha256'),('adapter_config.json','configAdaptadorSha256')]:
            if (a.saida/n).is_file():r[k]=sha(a.saida/n)
        r.update(fim=agora(),duracaoSegundos=time.monotonic()-inicio,codigoMudouDuranteExecucao=codigo()!=cod)
        r['novoAjustePesos']=r['estado']=='concluido' and bool(r.get('adaptadorSha256'))
        (a.saida/'treino.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:r.get(k) for k in ('estado','novoAjustePesos','duracaoSegundos','maxTokensVerificados','erro')},ensure_ascii=False),flush=True)
    if retorno!=0:raise SystemExit(1)

if __name__=='__main__':main()
