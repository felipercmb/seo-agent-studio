"""Infraestrutura comum de ensaios, sem trocar o motor padrão ou instalar recursos."""
import argparse
from datetime import datetime,timezone
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

RAIZ=Path(__file__).resolve().parents[2];sys.path.insert(0,str(RAIZ/'ia'))
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1',TOKENIZERS_PARALLELISM='false')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
agora=lambda:datetime.now(timezone.utc).isoformat()
def salvar(p,j):Path(p).write_text(json.dumps(j,ensure_ascii=False,indent=2,allow_nan=False)+'\n')

def especificacao(nome):
    if nome not in ('atribuicoes',):raise ValueError('Especificação local não permitida.')
    return importlib.import_module('negocio.'+nome+'.spec')

def conferir_corpus(pasta,spec):
    pasta=Path(pasta);m=json.loads((pasta/'manifesto.json').read_text());dados={};familias={};entidades={}
    if m.get('natureza')!='controlado_e_dev_publico_'+spec.NOME or m.get('empresasReservadasUsadas') is not False:raise ValueError('Corpus fora do protocolo.')
    for rel,h in m['codigoGeracaoSha256'].items():
        if Path(rel).is_absolute() or '..' in Path(rel).parts or sha(RAIZ/rel)!=h:raise ValueError('Gerador/protocolo mudou: '+rel)
    for split in ('train','valid'):
        for n in (split+'.jsonl','tarefas-'+split+'.jsonl'):
            if sha(pasta/n)!=m['arquivosSha256'][n]:raise ValueError('Corpus adulterado.')
        rs=[json.loads(l) for l in (pasta/('tarefas-'+split+'.jsonl')).read_text().splitlines()];ds=[json.loads(l) for l in (pasta/(split+'.jsonl')).read_text().splitlines()]
        if len(rs)!=len(ds) or len(rs)!=m['contagens'][split]:raise ValueError('Contagens divergentes.')
        for r,d in zip(rs,ds):
            if r['split']!=split or d!={'messages':r['messages']} or r['messages'][:-1]!=spec.mensagens(r['entrada']) or json.loads(r['messages'][-1]['content'])!=r['alvo'] or spec.validar_saida(r['alvo'],r['entrada']):raise ValueError('Alvo/mensagem fora do contrato: '+r['id'])
        dados[split]=rs;familias[split]={r['familia'] for r in rs};entidades[split]={r['entidade'] for r in rs}
    if familias['train']&familias['valid'] or entidades['train']&entidades['valid']:raise ValueError('Família ou entidade cruza a divisão.')
    return dados,m

def conferir_adaptador(pasta,spec):
    p=Path(pasta);r=json.loads((p/'treino.json').read_text())
    if r.get('estado')!='concluido' or r.get('novoAjustePesos') is not True or r.get('codigoMudouDuranteExecucao') is not False or r.get('protocoloSha256')!=sha(spec.PROTOCOLO):raise ValueError('Adaptador sem proveniência do protocolo.')
    for n,k in [('adapters.safetensors','adaptadorSha256'),('adapter_config.json','configAdaptadorSha256')]:
        if sha(p/n)!=r.get(k):raise ValueError('Adaptador alterado.')
    return p

class Leitor:
    def __init__(self,spec,adaptador=None,modelo_base="qwen35-4b"):
        import mlx.core as mx
        if modelo_base not in ('qwen35-4b','qwen35-9b') or adaptador is not None and modelo_base!='qwen35-4b':raise ValueError('Modelo ou adaptador incompatível.')
        mx.set_memory_limit((7 if modelo_base=='qwen35-9b' else 6)*1024**3);mx.set_cache_limit(128*1024**2)
        from negocio.runtime_negocio import carregar_leitor
        self.spec=spec;self.modelo,self.tok,self.meta=carregar_leitor(adaptador=conferir_adaptador(adaptador,spec) if adaptador else None,modelo_base=modelo_base);self.indices={}

    def gerar(self,e):
        self.spec.conferir_entrada(e)
        from negocio.protocolo import prefixo_assistente
        from negocio.decodificacao.core_mlx import preparar_indice_json,criar_processador_mlx
        from negocio.contrato import ler_json_estrito
        from mlx_lm import stream_generate
        from mlx_lm.sample_utils import make_sampler
        ms=self.spec.mensagens(e);prompt=prefixo_assistente(self.tok,ms)['prompt'];tokens=self.tok.encode(prompt,add_special_tokens=False)
        if len(tokens)+320>4096:return {'estado':'orcamento_excedido','inferida':False,'saida':None,'tokensEntrada':len(tokens)}
        if e['tarefa'] not in self.indices:self.indices[e['tarefa']]=preparar_indice_json(self.spec.esquema(e),self.tok,limitar_comprimento_texto=False)
        processador=criar_processador_mlx(self.indices[e['tarefa']]);inicio=time.monotonic();partes=[];ultimo=None
        for ultimo in stream_generate(self.modelo,self.tok,prompt=prompt,max_tokens=320,sampler=make_sampler(temp=0),logits_processors=[processador]):partes.append(ultimo.text)
        bruto=''.join(partes);s=None;falha=None
        try:s=ler_json_estrito(bruto)
        except (ValueError,TypeError) as err:falha=type(err).__name__
        return {'estado':'gerada' if s is not None else 'json_recusado','inferida':True,'saida':s,'textoBruto':bruto,'falha':falha,'segundos':time.monotonic()-inicio,
            'tokensEntrada':len(tokens),'tokensGerados':ultimo.generation_tokens if ultimo else 0,'fimGeracao':ultimo.finish_reason if ultimo else None,
            'mensagensSha256':hashlib.sha256(json.dumps(ms,ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'validacao':self.spec.projetar(s,e),'modeloPadraoAlterado':False}

def treinar(nome,argv=None):
    spec=especificacao(nome);p=argparse.ArgumentParser();p.add_argument('--corpus',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);p.add_argument('--passos',type=int,default=320);p.add_argument('--rank',type=int,default=8);p.add_argument('--camadas',type=int,default=1);p.add_argument('--gradiente-linear-experimental',action='store_true');p.add_argument('--limite-segundos',type=int,default=5400);p.add_argument('--executar',action='store_true');a=p.parse_args(argv)
    if a.saida.exists() or not 1<=a.passos<=400 or a.rank not in (8,16,32) or a.camadas not in (1,4,8) or not 60<=a.limite_segundos<=5400:p.error('Saída nova e parâmetros limitados.')
    if a.camadas>1 and not a.gradiente_linear_experimental:p.error('Gradiente por blocos lineares excedeu a memória no host testado. Use uma camada ou habilite explicitamente o ensaio de outra configuração.')
    cod=spec.codigo();dados,m=conferir_corpus(a.corpus,spec);a.saida.mkdir(parents=True,mode=0o700);inicio=time.monotonic();proc=None;rc=1
    r={'inicio':agora(),'estado':'iniciado','especificacao':nome,'modeloBase':'qwen35-4b','modeloPadraoAlterado':False,'novoAjustePesos':False,'execucaoSolicitada':a.executar,'revisaoHumanaIndependente':False,'protocoloSha256':sha(spec.PROTOCOLO),'codigoSha256':cod,'corpusManifestoSha256':sha(a.corpus/'manifesto.json'),'limiteMemoriaMLXGiB':6}
    try:
        from negocio.modelos import verificar_base
        pasta,proveniencia=verificar_base('qwen35-4b');r['modeloBaseProveniencia']=proveniencia
        from transformers import AutoTokenizer
        from negocio.ensaios_pesos import preparar_pesos
        tok=AutoTokenizer.from_pretrained(str(pasta),local_files_only=True,trust_remote_code=False);tabela=preparar_pesos(dados,tok);maior=max(len(x['ids']) for x in tabela['linhas'])
        if maior>2048:raise ValueError('Exemplo excede2048; não há truncamento.')
        salvar(a.saida/'pesos-tokens.json',tabela);r['pesosTokensSha256']=sha(a.saida/'pesos-tokens.json')
        salvar(a.saida/'tokenizacao.json',{'maxTokens':maior,'truncamento':False,'exemplos':len(tabela['linhas'])});(a.saida/'dados').mkdir()
        for n in ('train.jsonl','valid.jsonl'):shutil.copy2(a.corpus/n,a.saida/'dados'/n)
        cfg={'seed':42,'model':str(pasta),'data':str((a.saida/'dados').resolve()),'adapter_path':str(a.saida.resolve()),'train':True,'test':False,'trust_remote_code':False,'report_to':None,'fine_tune_type':'lora','optimizer':'adam','num_layers':a.camadas,'batch_size':1,'iters':a.passos,'learning_rate':2e-5,'max_seq_length':2048,'mask_prompt':True,'grad_checkpoint':True,'steps_per_report':5,'steps_per_eval':40,'val_batches':8,'save_every':40,'lora_parameters':{'keys':['self_attn.q_proj','self_attn.v_proj']+(['linear_attn.in_proj_qkv','linear_attn.out_proj'] if a.camadas>1 else []),'rank':a.rank,'scale':10.0,'dropout':0.0}}
        r.update(config=cfg,maxTokensVerificados=maior,dependencias={n:importlib.metadata.version(n) for n in ('mlx','mlx-lm','transformers')});salvar(a.saida/'config-executada.json',cfg);shutil.copy2(a.corpus/'manifesto.json',a.saida/'manifesto-dados-fonte.json')
        for rel in cod:
            q=a.saida/'codigo'/rel;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(RAIZ/rel,q)
        if spec.codigo()!=cod:raise ValueError('Código mudou no preflight.')
        if not a.executar:r['estado']='verificado_sem_treino';rc=0
        else:
            r['estado']='em_treino';salvar(a.saida/'treino.json',r)
            with (a.saida/'treino.log').open('x') as log:
                proc=subprocess.Popen([sys.executable,str(Path(__file__).with_name('ensaios_bootstrap.py')),'--config',str((a.saida/'config-executada.json').resolve()),'--metricas',str((a.saida/'metricas-gpu.json').resolve()),'--pesos',str((a.saida/'pesos-tokens.json').resolve())],cwd=RAIZ,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                limite_tempo=time.monotonic()+a.limite_segundos;amostras=[];rss_limite=8*1024**3
                while proc.poll() is None:
                    if time.monotonic()>limite_tempo:raise subprocess.TimeoutExpired(proc.args,a.limite_segundos)
                    try:
                        out=subprocess.check_output(['ps','-o','rss=','-p',str(proc.pid)],text=True).strip()
                        rss=int(out)*1024 if out else 0
                    except subprocess.CalledProcessError:
                        if proc.poll() is None:raise RuntimeError('Monitor RSS indisponível; ensaio interrompido.')
                        rss=0
                    amostras.append({'segundos':time.monotonic()-inicio,'rssBytes':rss})
                    salvar(a.saida/'monitor-memoria.json',{'limiteRSSBytes':rss_limite,'amostras':amostras,'picoRSSBytes':max(x['rssBytes'] for x in amostras),'limiteMLXSolicitadoNaoEhBarreiraDeAlocacao':True})
                    if rss>rss_limite:raise MemoryError('Processo excedeu8GiB de RSS; ensaio interrompido.')
                    time.sleep(0.5)
                rc=proc.returncode
            r['estado']='concluido' if rc==0 else 'falhou'
            if rc==0 and not all((a.saida/n).is_file() for n in ('adapters.safetensors','adapter_config.json')):raise ValueError('Treino terminou sem adaptador.')
    except subprocess.TimeoutExpired:r.update(estado='interrompido_prazo',erro='Limite de treino atingido.')
    except MemoryError as err:r.update(estado='interrompido_memoria',erro=str(err))
    except BaseException as err:r.update(estado='falhou',erro=type(err).__name__+': '+str(err))
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=10)
        for n,k in [('adapters.safetensors','adaptadorSha256'),('adapter_config.json','configAdaptadorSha256')]:
            if (a.saida/n).is_file():r[k]=sha(a.saida/n)
        r.update(fim=agora(),duracaoSegundos=time.monotonic()-inicio,codigoMudouDuranteExecucao=spec.codigo()!=cod);r['novoAjustePesos']=r['estado']=='concluido' and bool(r.get('adaptadorSha256'));salvar(a.saida/'treino.json',r);print(json.dumps({k:r.get(k) for k in ('estado','novoAjustePesos','duracaoSegundos','maxTokensVerificados','erro')},ensure_ascii=False),flush=True)
    if rc!=0 or r['estado']!='concluido' and a.executar:raise SystemExit(1)

def avaliar(nome,argv=None):
    spec=especificacao(nome);p=argparse.ArgumentParser();p.add_argument('--tarefas',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);p.add_argument('--adaptador',type=Path);p.add_argument('--modelo-base',choices=['qwen35-4b','qwen35-9b'],default='qwen35-4b');p.add_argument('--limite-segundos',type=int,default=1800);a=p.parse_args(argv)
    if a.saida.exists() or not 30<=a.limite_segundos<=5400:p.error('Saída nova e prazo limitado.')
    raw=a.tarefas.read_bytes();ts=[json.loads(l) for l in raw.decode().splitlines()];ids=set()
    import re
    for t in ts:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',t['id']) or t['id'] in ids:raise ValueError('ID inválido/repetido.')
        ids.add(t['id'])
        if spec.validar_saida(t['alvo'],t['entrada']):raise ValueError('Referência estrutural inválida: '+t['id'])
    a.saida.mkdir(parents=True,mode=0o700);cod=spec.codigo();inicio=time.monotonic();reg={'inicio':agora(),'tarefasSha256':hashlib.sha256(raw).hexdigest(),'codigoSha256':cod,'ofertaFornecida':True,'fimAFim':False,'modeloPadraoAlterado':False,'revisaoHumanaIndependente':False,'selecionadas':len(ts),'tentadas':[],'casos':[],'concluido':False}
    def parar(*_):raise TimeoutError('Prazo da avaliação.')
    signal.signal(signal.SIGALRM,parar);signal.alarm(a.limite_segundos)
    try:
        leitor=Leitor(spec,a.adaptador,a.modelo_base);reg['modelo']=leitor.meta
        for t in ts:
            print('Tarefa '+t['id'],flush=True);reg['tentadas'].append(t['id']);salvar(a.saida/'progresso.json',reg);g=leitor.gerar(t['entrada'])
            # Same metrics, with the selected contract validating the complete frame.
            s=g.get('saida');gerada=g.get('inferida') is True and g.get('estado')=='gerada' and isinstance(s,dict);erros=spec.validar_saida(s,t['entrada']) if gerada else ['nao_gerada'];ativo=lambda x:x.get('estrutura')!='sem_relacao' if t['entrada']['tarefa']=='relacao' else x.get('categoria')!='nenhuma';gold=ativo(t['alvo']);tem=bool(gerada and ativo(s))
            score={'gerada':gerada,'aceitaLiteralmente':not erros,'erros':erros,'exata':bool(gerada and s==t['alvo']),'goldAtivo':gold,'propostaBrutaAtiva':tem,'propostaAceitaAtiva':bool(tem and not erros),'falsoPreenchimentoBruto':bool(not gold and tem),'falsoPreenchimentoAceito':bool(not gold and tem and not erros),'camposCorretos':{k:bool(gerada and s.get(k)==v) for k,v in t['alvo'].items()}}
            salvar(a.saida/(t['id']+'.json'),{'tarefa':t,'geracao':g,'pontuacao':score});reg['casos'].append({'id':t['id'],'tarefa':t['entrada']['tarefa'],'familia':t.get('familia'),'entidade':t.get('entidade'),**score});import mlx.core as mx;mx.clear_cache()
        reg['concluido']=len(reg['casos'])==len(ts)
    except BaseException as err:reg['erro']=type(err).__name__+': '+str(err)
    finally:
        signal.alarm(0);import mlx.core as mx;reg.update(fim=agora(),segundos=time.monotonic()-inicio,codigoMudouDuranteExecucao=spec.codigo()!=cod,picoTensoresMLXGiB=mx.get_peak_memory()/1024**3);resumo={}
        for tarefa in ('relacao','condicao'):
            rs=[x for x in reg['casos'] if x['tarefa']==tarefa];resumo[tarefa]={'selecionadas':sum(t['entrada']['tarefa']==tarefa for t in ts),'concluidas':len(rs),'goldAtivo':sum(x['goldAtivo'] for x in rs),'goldAbstencao':sum(not x['goldAtivo'] for x in rs),'exatas':sum(x['exata'] for x in rs),'ativasExatas':sum(x['exata'] and x['goldAtivo'] for x in rs),'propostasAceitasAtivas':sum(x['propostaAceitaAtiva'] for x in rs),'falsosPreenchimentosBrutos':sum(x['falsoPreenchimentoBruto'] for x in rs),'falsosPreenchimentosAceitos':sum(x['falsoPreenchimentoAceito'] for x in rs)}
        reg['resumo']=resumo;salvar(a.saida/'execucao.json',reg);print(json.dumps(resumo,ensure_ascii=False),flush=True)
    if not reg['concluido'] or reg['codigoMudouDuranteExecucao']:raise SystemExit(1)
