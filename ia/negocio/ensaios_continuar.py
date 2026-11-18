"""Continua somente pesos LoRA de um ensaio local completo e verificável.

O estado do otimizador não foi salvo pelo ensaio anterior. Portanto isto é
continuação dos pesos, com Adam e ordem aleatória reiniciados, não retomada
exata do treinamento. Não altera o adaptador de origem nem a seleção do app.
"""
import argparse
from copy import deepcopy
from pathlib import Path
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from negocio.ensaios import RAIZ,agora,sha,salvar,especificacao,conferir_adaptador,conferir_corpus

def preparar_config(origem,corpus,saida,passos,spec):
    """CPU-only integrity check. Does not import MLX, load a model or download."""
    origem=conferir_adaptador(origem,spec)
    import json
    previous=json.loads((origem/'treino.json').read_text())
    if type(passos) is not int or not 1<=passos<=400:raise ValueError('Continuação limitada a400passos por ensaio.')
    if previous.get('modeloBase')!='qwen35-4b' or previous.get('corpusManifestoSha256')!=sha(Path(corpus)/'manifesto.json'):raise ValueError('Continuação exige o mesmo modelo-base e corpus.')
    cfg=deepcopy(previous['config'])
    if cfg.get('num_layers')!=1 or cfg.get('lora_parameters',{}).get('keys')!=['self_attn.q_proj','self_attn.v_proj']:raise ValueError('Continuação suporta somente a configuração de memória já exercitada: última camada q/v.')
    if cfg.get('lora_parameters',{}).get('rank') not in (8,16,32):raise ValueError('Rank não suportado.')
    cfg.update(data=str((Path(saida)/'dados').resolve()),adapter_path=str(Path(saida).resolve()),resume_adapter_file=str((Path(saida)/'adaptador-inicial.safetensors').resolve()),iters=passos)
    return cfg,previous

def codigo(spec):return {**spec.codigo(),str(Path(__file__).relative_to(RAIZ)):sha(__file__)}

def main(argv=None, *, spec=None):
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--origem',type=Path,required=True);p.add_argument('--corpus',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);p.add_argument('--passos',type=int,default=400);p.add_argument('--limite-segundos',type=int,default=5400);p.add_argument('--semente',type=int);p.add_argument('--executar',action='store_true');a=p.parse_args(argv)
    if a.saida.exists() or not 60<=a.limite_segundos<=5400:p.error('Use saída nova e prazo entre60e5400segundos.')
    if a.semente is not None and not 0<=a.semente<2**32:p.error('A semente precisa ser um inteiro de 32 bits sem sinal.')
    spec=spec or especificacao('atribuicoes')
    dados,manifest=conferir_corpus(a.corpus,spec)
    cfg,previous=preparar_config(a.origem,a.corpus,a.saida,a.passos,spec)
    if a.semente is not None:cfg['seed']=a.semente
    cod=codigo(spec);a.saida.mkdir(parents=True,mode=0o700);started=time.monotonic();proc=None;rc=1
    r={'inicio':agora(),'estado':'iniciado','especificacao':spec.NOME,'modeloBase':'qwen35-4b','modeloPadraoAlterado':False,'novoAjustePesos':False,'execucaoSolicitada':a.executar,'revisaoHumanaIndependente':False,'protocoloSha256':sha(spec.PROTOCOLO),'codigoSha256':cod,'corpusManifestoSha256':sha(a.corpus/'manifesto.json'),'limiteMemoriaMLXSolicitadoGiB':6,'limiteMLXNaoEhBarreiraDeAlocacao':True,'config':cfg,'origemAdaptadorSha256':sha(a.origem/'adapters.safetensors'),'origemReciboSha256':sha(a.origem/'treino.json'),'passosAdicionais':a.passos,'passosDaOrigem':previous['config']['iters'],'estadoOtimizadorRetomado':False,'sementeDaOrigem':previous['config']['seed'],'sementeReiniciada':cfg['seed'],'modeloBaseProveniencia':previous.get('modeloBaseProveniencia')}
    try:
        from negocio.modelos import verificar_base
        pasta,proveniencia=verificar_base('qwen35-4b')
        if Path(cfg['model']).resolve()!=pasta.resolve():raise ValueError('Modelo-base diverge da instalação registrada.')
        from transformers import AutoTokenizer
        from negocio.ensaios_pesos import preparar_pesos
        tok=AutoTokenizer.from_pretrained(str(pasta),local_files_only=True,trust_remote_code=False);table=preparar_pesos(dados,tok);largest=max(len(x['ids']) for x in table['linhas'])
        if largest>2048:raise ValueError('Exemplo excede2048tokens; nenhum truncamento.')
        r.update(maxTokensVerificados=largest,modeloBaseProveniencia=proveniencia);salvar(a.saida/'pesos-tokens.json',table);salvar(a.saida/'tokenizacao.json',{'maxTokens':largest,'truncamento':False});(a.saida/'dados').mkdir()
        for n in ('train.jsonl','valid.jsonl'):shutil.copy2(a.corpus/n,a.saida/'dados'/n)
        shutil.copy2(a.origem/'adapters.safetensors',a.saida/'adaptador-inicial.safetensors');shutil.copy2(a.corpus/'manifesto.json',a.saida/'manifesto-dados-fonte.json');salvar(a.saida/'config-executada.json',cfg)
        for rel in cod:
            q=a.saida/'codigo'/rel;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(RAIZ/rel,q)
        if codigo(spec)!=cod or sha(a.saida/'adaptador-inicial.safetensors')!=r['origemAdaptadorSha256']:raise ValueError('Código ou peso inicial mudou no preflight.')
        if not a.executar:r['estado']='verificado_sem_treino';rc=0
        else:
            r['estado']='em_treino';salvar(a.saida/'treino.json',r);samples=[]
            with (a.saida/'treino.log').open('x') as log:
                proc=subprocess.Popen([sys.executable,str(Path(__file__).with_name('ensaios_bootstrap.py')),'--config',str((a.saida/'config-executada.json').resolve()),'--metricas',str((a.saida/'metricas-gpu.json').resolve()),'--pesos',str((a.saida/'pesos-tokens.json').resolve())],cwd=RAIZ,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                deadline=time.monotonic()+a.limite_segundos
                while proc.poll() is None:
                    if time.monotonic()>deadline:raise TimeoutError('Prazo da continuação.')
                    raw=subprocess.run(['ps','-o','rss=','-p',str(proc.pid)],capture_output=True,text=True).stdout.strip();rss=int(raw)*1024 if raw else 0;samples.append({'segundos':time.monotonic()-started,'rssBytes':rss});salvar(a.saida/'monitor-memoria.json',{'limiteRSSBytes':8*1024**3,'picoRSSBytes':max(x['rssBytes'] for x in samples),'amostras':samples})
                    if rss>8*1024**3:raise MemoryError('Processo excedeu8GiB de RSS.')
                    time.sleep(.5)
                rc=proc.returncode
            r['estado']='concluido' if rc==0 else 'falhou'
            if rc==0 and not all((a.saida/n).is_file() for n in ('adapters.safetensors','adapter_config.json')):raise ValueError('Continuação terminou sem adaptador.')
    except BaseException as err:r.update(estado='interrompido' if isinstance(err,(TimeoutError,MemoryError)) else 'falhou',erro=type(err).__name__+': '+str(err))
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=10)
        for name,key in [('adapters.safetensors','adaptadorSha256'),('adapter_config.json','configAdaptadorSha256')]:
            if (a.saida/name).is_file():r[key]=sha(a.saida/name)
        r.update(fim=agora(),duracaoSegundos=time.monotonic()-started,codigoMudouDuranteExecucao=codigo(spec)!=cod,origemIntacta=sha(a.origem/'adapters.safetensors')==r['origemAdaptadorSha256']);r['novoAjustePesos']=r['estado']=='concluido' and bool(r.get('adaptadorSha256'));salvar(a.saida/'treino.json',r);print({k:r.get(k) for k in ['estado','novoAjustePesos','origemIntacta','duracaoSegundos','erro']},flush=True)
    if rc!=0 or a.executar and r['estado']!='concluido':raise SystemExit(1)

if __name__=='__main__':main()
