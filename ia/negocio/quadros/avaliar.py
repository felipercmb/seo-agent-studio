"""Avalia tarefas C14 com oferta fornecida. Não é teste de entendimento fim a fim."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import re
import signal
import sys
import time

RAIZ=Path(__file__).resolve().parents[3];sys.path.insert(0,str(RAIZ/'ia'))
from negocio.quadros.executar import LeitorQuadros,codigo
from negocio.quadros.contrato import validar_saida,conferir_entrada

def pontuar(alvo,g,entrada):
    s=g.get('saida');gerada=g.get('inferida') is True and g.get('estado')=='gerada' and isinstance(s,dict)
    erros=validar_saida(s,entrada) if gerada else ['nao_gerada']
    ativo=lambda x:x.get('estrutura')!='sem_relacao' if entrada['tarefa']=='relacao' else x.get('categoria')!='nenhuma'
    tem=gerada and ativo(s);gold=ativo(alvo)
    return {'gerada':gerada,'aceitaLiteralmente':not erros,'erros':erros,'exata':gerada and s==alvo,'goldAtivo':gold,
        'propostaBrutaAtiva':bool(tem),'propostaAceitaAtiva':bool(tem and not erros),'falsoPreenchimentoBruto':bool(not gold and tem),
        'falsoPreenchimentoAceito':bool(not gold and tem and not erros),'camposCorretos':{k:bool(gerada and s.get(k)==v) for k,v in alvo.items()}}

def main():
    a=argparse.ArgumentParser(description=__doc__);a.add_argument('--tarefas',type=Path,required=True);a.add_argument('--saida',type=Path,required=True);a.add_argument('--adaptador',type=Path);a.add_argument('--limite-segundos',type=int,default=1800);a.add_argument('--max-tarefas',type=int);o=a.parse_args()
    if o.saida.exists() or not 30<=o.limite_segundos<=5400:a.error('Saída nova e prazo limitado.')
    raw=o.tarefas.read_bytes();todos=[json.loads(l) for l in raw.decode().splitlines()];ts=todos[:o.max_tarefas] if o.max_tarefas else todos
    ids=set()
    for t in ts:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',t['id']) or t['id'] in ids:raise ValueError('ID inválido/repetido.')
        ids.add(t['id']);conferir_entrada(t['entrada'])
        if validar_saida(t['alvo'],t['entrada']):raise ValueError('Referência estrutural inválida.')
    o.saida.mkdir(parents=True,mode=0o700);cod=codigo();inicio=time.monotonic()
    reg={'inicio':datetime.now(timezone.utc).isoformat(),'tarefasSha256':hashlib.sha256(raw).hexdigest(),'referenciasFornecidasAntesDasPrevisoes':True,'codigoSha256':cod,'ofertaFornecida':True,'fimAFim':False,'modeloPadraoAlterado':False,'revisaoHumanaIndependente':False,'selecionadas':len(ts),'totalNoArquivo':len(todos),'tentadas':[],'casos':[],'concluido':False}
    def parar(*_):raise TimeoutError('Prazo da avaliação C14.')
    signal.signal(signal.SIGALRM,parar);signal.alarm(o.limite_segundos)
    try:
        leitor=LeitorQuadros(o.adaptador);reg['modelo']=leitor.meta
        for t in ts:
            print('Tarefa '+t['id'],flush=True);reg['tentadas'].append(t['id']);(o.saida/'progresso.json').write_text(json.dumps(reg,ensure_ascii=False,indent=2)+'\n')
            g=leitor.gerar(t['entrada']);s=pontuar(t['alvo'],g,t['entrada'])
            with (o.saida/(t['id']+'.json')).open('x') as f:json.dump({'tarefa':t,'geracao':g,'pontuacao':s},f,ensure_ascii=False,indent=2);f.write('\n')
            reg['casos'].append({'id':t['id'],'tarefa':t['entrada']['tarefa'],'familia':t.get('familia'),'entidade':t.get('entidade'),**s})
            import mlx.core as mx
            mx.clear_cache()
        reg['concluido']=len(reg['casos'])==len(ts)
    except BaseException as err:reg['erro']=type(err).__name__+': '+str(err)
    finally:
        signal.alarm(0)
        import mlx.core as mx
        reg.update(fim=datetime.now(timezone.utc).isoformat(),segundos=time.monotonic()-inicio,codigoMudouDuranteExecucao=codigo()!=cod,picoTensoresMLXGiB=mx.get_peak_memory()/1024**3)
        resumo={}
        for tarefa in ('relacao','condicao'):
            rs=[x for x in reg['casos'] if x['tarefa']==tarefa];sel=[x for x in ts if x['entrada']['tarefa']==tarefa]
            resumo[tarefa]={'selecionadas':len(sel),'concluidas':len(rs),'geradas':sum(x['gerada'] for x in rs),'goldAtivo':sum(x['goldAtivo'] for x in rs),'goldAbstencao':sum(not x['goldAtivo'] for x in rs),'exatas':sum(x['exata'] for x in rs),'ativasExatas':sum(x['exata'] and x['goldAtivo'] for x in rs),'propostasAceitasAtivas':sum(x['propostaAceitaAtiva'] for x in rs),'falsosPreenchimentosBrutos':sum(x['falsoPreenchimentoBruto'] for x in rs),'falsosPreenchimentosAceitos':sum(x['falsoPreenchimentoAceito'] for x in rs)}
        reg['resumo']=resumo
        with (o.saida/'execucao.json').open('x') as f:json.dump(reg,f,ensure_ascii=False,indent=2);f.write('\n')
        print(json.dumps(resumo,ensure_ascii=False),flush=True)
    if not reg['concluido'] or reg['codigoMudouDuranteExecucao']:raise SystemExit(1)

if __name__=='__main__':main()
