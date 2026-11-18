"""Validação de tarefas com oferta fornecida; NÃO é entendimento fim a fim."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import time
import unicodedata

IA=Path(__file__).resolve().parents[3];RAIZ=IA.parent;sys.path.insert(0,str(IA))
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
from negocio.proposicoes.c12.executar import CONFIG,codigo,gerar,conferir_adaptador
from negocio.proposicoes.contrato import validar_ofertas,validar_proposicoes


def norm(v):
    if isinstance(v,str):return ' '.join(unicodedata.normalize('NFKC',v).casefold().split())
    if isinstance(v,list):return sorted([norm(x) for x in v],key=lambda x:json.dumps(x,sort_keys=True))
    if isinstance(v,dict):return {k:norm(x) for k,x in sorted(v.items())}
    return v


def pontuar(alvo,geracao):
    fim=geracao.get('inferida') is True and geracao.get('estado')=='gerada' and isinstance(geracao.get('saida'),dict)
    campos=('proposicoesPorUnidade','condicoes') if 'proposicoesPorUnidade' in alvo else ('ofertas',)
    saida=geracao.get('saida') if fim else {}
    exata=fim and all(k in saida and norm(saida[k])==norm(alvo[k]) for k in campos)
    gold=alvo.get('proposicoesPorUnidade',{});pred=saida.get('proposicoesPorUnidade',{}) if fim else {}
    if not isinstance(pred,dict):pred={}
    verdadeiros=sum(v is not None and norm(pred.get(k))==norm(v) for k,v in gold.items()) if fim else 0
    goldn=sum(v is not None for v in gold.values());predn=sum(v is not None for v in pred.values())
    falsos=sum(v is None and pred.get(k) is not None for k,v in gold.items()) if fim else 0
    return {'concluida':fim,'exata':bool(exata),'proposicoesGold':goldn,'proposicoesPreditas':predn,'proposicoesExatas':verdadeiros,'falsosEmUnidadeNull':falsos,'unidadesNullGold':sum(v is None for v in gold.values()),'estruturaPresente':fim and all(k in saida for k in campos)}


def salvar(p,v):
    with Path(p).open('x') as f:json.dump(v,f,ensure_ascii=False,indent=2,allow_nan=False);f.write('\n')


def main():
    a=argparse.ArgumentParser(description=__doc__);a.add_argument('--corpus',type=Path,required=True);a.add_argument('--saida',type=Path,required=True);a.add_argument('--adaptador',type=Path);a.add_argument('--limite-segundos',type=int,default=900);a.add_argument('--max-tarefas',type=int)
    o=a.parse_args()
    if o.saida.exists() or not 30<=o.limite_segundos<=1800:a.error('Pasta nova e prazo30a1800.')
    from negocio.proposicoes.c12.treinar import conferir_corpus
    conferir_corpus(o.corpus)
    arq=o.corpus/'tarefas-valid.jsonl';todos=[json.loads(l) for l in arq.read_text().splitlines()];tarefas=todos[:o.max_tarefas] if o.max_tarefas else todos
    adaptador=conferir_adaptador(o.adaptador) if o.adaptador else None;cod=codigo();o.saida.mkdir(mode=0o700);inicio=time.monotonic()
    reg={'inicio':datetime.now(timezone.utc).isoformat(),'natureza':'Tarefas condicionais de validação controlada/DEV; relações recebem oferta de referência. NÃO é fim a fim nem reserva nova.','config':CONFIG,'codigoSha256':cod,'corpusTarefasSha256':hashlib.sha256(arq.read_bytes()).hexdigest(),'selecionadas':len(tarefas),'totalValidacao':len(todos),'casos':[],'tentados':[],'concluido':False,'ouroReservadoNovoLido':False,'modeloPadraoAlterado':False}
    def parar(*args):raise TimeoutError('Prazo da validação de tarefas.')
    signal.signal(signal.SIGALRM,parar);signal.alarm(o.limite_segundos)
    try:
        from negocio.runtime_negocio import carregar_leitor
        model,tok,meta=carregar_leitor(adaptador=adaptador,modelo_base='qwen35-4b');reg['modelo']=meta
        for t in tarefas:
            print('Tarefa '+t['id'],flush=True)
            reg['tentados'].append(t['id'])
            (o.saida/'progresso.json').write_text(json.dumps(reg,ensure_ascii=False,indent=2)+'\n')
            g=gerar(model,tok,t['documento'],t['oferta']);v=validar_proposicoes(g.get('saida'),t['documento'],t['oferta']) if t['oferta'] else validar_ofertas(g.get('saida'),t['documento']);score=pontuar(t['alvo'],g)
            salvar(o.saida/(t['id']+'.json'),{'tarefa':t,'geracao':g,'validado':v,'pontuacao':score})
            reg['casos'].append({'id':t['id'],'familia':t['familia'],'entidade':t['entidade'],'idioma':t['idioma'],'origem':t['origem'],**score})
            import mlx.core as mx
            mx.clear_cache()
        reg['concluido']=len(reg['casos'])==len(tarefas)
    except BaseException as e:reg['erro']=type(e).__name__+': '+str(e)
    finally:
        signal.alarm(0);reg.update(fim=datetime.now(timezone.utc).isoformat(),segundos=time.monotonic()-inicio,codigoMudouDuranteExecucao=codigo()!=cod)
        reg['resumo']={'selecionadas':len(tarefas),'tentadas':len(reg['tentados']),'concluidas':sum(x['concluida'] for x in reg['casos']),'exatas':sum(x['exata'] for x in reg['casos']),'entidadesSelecionadas':len({x['entidade'] for x in tarefas}),'familiasSelecionadas':len({x['familia'] for x in tarefas}),'falsosEmUnidadeNull':sum(x['falsosEmUnidadeNull'] for x in reg['casos']),'proposicoesExatas':sum(x['proposicoesExatas'] for x in reg['casos']),'proposicoesPreditas':sum(x['proposicoesPreditas'] for x in reg['casos']),'proposicoesGold':sum(v is not None for x in tarefas for v in x['alvo'].get('proposicoesPorUnidade',{}).values()),'unidadesNullGold':sum(v is None for x in tarefas for v in x['alvo'].get('proposicoesPorUnidade',{}).values())}
        salvar(o.saida/'execucao.json',reg);print(json.dumps(reg['resumo'],ensure_ascii=False),flush=True)

if __name__=='__main__':main()
