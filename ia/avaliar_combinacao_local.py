"""C15 proposals -> C16 role review. Conditional on the supplied offer/unit.

Gold is used only for scoring, never forwarded to the classifier. Invalid or
missing intermediate output remains unknown rather than a manufactured null.
"""
import argparse
from datetime import datetime,timezone
from copy import deepcopy
import hashlib,json,signal,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from negocio.ensaios import Leitor,salvar
from negocio.papeis import spec as papeis
from negocio.atribuicoes import spec as extracao
from classificar_papeis_local import combinar_atribuicao

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--tarefas',type=Path,required=True);p.add_argument('--extracoes',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);p.add_argument('--adaptador',type=Path);p.add_argument('--modelo-base',choices=['qwen35-4b','qwen35-9b'],default='qwen35-4b');p.add_argument('--limite-segundos',type=int,default=900);a=p.parse_args(argv)
    if a.saida.exists() or not 30<=a.limite_segundos<=1800:p.error('Use saída nova e prazo limitado.')
    raw=a.tarefas.read_bytes();tasks=[json.loads(l) for l in raw.decode().splitlines() if l.strip()];tasks=[t for t in tasks if t['entrada']['tarefa']=='relacao'];prepared=[];ids=set()
    for t in tasks:
        if not isinstance(t['id'],str) or not __import__('re').fullmatch(r'[A-Za-z0-9_-]{1,100}',t['id']) or t['id'] in ids:raise ValueError('Identidade inválida/repetida.')
        ids.add(t['id']);extracao.conferir_entrada(t['entrada']);source=a.extracoes/(t['id']+'.json');generation=json.loads(source.read_text());assert generation['tarefa']['entrada']==t['entrada'];prepared.append((t,generation,source))
    a.saida.mkdir(parents=True,mode=0o700);own='ia/'+Path(__file__).name;cod={**extracao.codigo(),**papeis.codigo(),own:hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'ia/classificar_papeis_local.py':hashlib.sha256(Path(__file__).with_name('classificar_papeis_local.py').read_bytes()).hexdigest()};started=time.monotonic();record={'inicio':datetime.now(timezone.utc).isoformat(),'tarefasSha256':hashlib.sha256(raw).hexdigest(),'codigoSha256':cod,'selecionadas':len(tasks),'ofertaFornecida':True,'unidadeFornecida':True,'relacaoCorretaFornecidaAoConferente':False,'alvosFornecidosAoModelo':False,'fimAFimDoSite':False,'modeloPadraoAlterado':False,'revisaoHumanaIndependente':False,'casos':[],'concluido':False};reader=None
    def stop(*_):raise TimeoutError('Prazo da combinação local.')
    signal.signal(signal.SIGALRM,stop);signal.alarm(a.limite_segundos)
    try:
        for t,g,source in prepared:
            first=g['geracao'].get('saida');e=t['entrada'];second=None;final=None;state='extracao_sem_geracao';combination=None
            if g['geracao'].get('estado')=='gerada' and isinstance(first,dict):
                errors=extracao.validar_saida(first,e)
                if errors:state='extracao_recusada'
                elif first['estrutura']=='sem_relacao':final=deepcopy(first);state='abstencao_do_extrator'
                else:
                    entry={**e,'quadroProposto':{k:deepcopy(first[k]) for k in ['estrutura','ator','acao','objeto','marcadorNominal']}}
                    papeis.conferir_entrada(entry)
                    if reader is None:reader=Leitor(papeis,a.adaptador,a.modelo_base);record['modeloConferente']=reader.meta
                    second=reader.gerar(entry)
                    if second.get('estado')=='gerada' and isinstance(second.get('saida'),dict):combination=combinar_atribuicao(e,first,second['saida']);state=combination['estado'];final=combination['quadro']
                    else:state='classificacao_sem_geracao'
            generated=isinstance(final,dict);errors=extracao.validar_saida(final,e) if generated else ['quadro_final_desconhecido'];gold=t['alvo']['estrutura']!='sem_relacao';active=bool(generated and final['estrutura']!='sem_relacao');exact=bool(generated and final==t['alvo'])
            score={'geradaFinal':generated,'aceitaLiteralmente':not errors,'erros':errors,'exataFinal':exact,'goldAtivo':gold,'propostaBrutaAtiva':active,'propostaAceitaAtiva':bool(active and not errors),'falsoPreenchimentoAceito':bool(not gold and active and not errors),'positivoAceitoNaoExato':bool(gold and active and not errors and not exact)}
            result={'id':t['id'],'entrada':e,'fonteExtracaoSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'extracaoOriginal':g['geracao'],'classificacao':second,'combinacao':combination,'quadroFinal':final,'estado':state,'pontuacao':score,'alvoSomenteParaAvaliacao':t['alvo']};salvar(a.saida/(t['id']+'.json'),result);record['casos'].append({'id':t['id'],'estado':state,**score});salvar(a.saida/'execucao.json',record);print(t['id']+': '+state,flush=True)
            if reader:
                import mlx.core as mx
                mx.clear_cache()
        record['concluido']=len(record['casos'])==len(tasks)
    except BaseException as err:record['erro']=type(err).__name__+': '+str(err)
    finally:
        signal.alarm(0);current={**extracao.codigo(),**papeis.codigo(),own:hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'ia/classificar_papeis_local.py':hashlib.sha256(Path(__file__).with_name('classificar_papeis_local.py').read_bytes()).hexdigest()};cs=record['casos'];record.update(fim=datetime.now(timezone.utc).isoformat(),segundos=time.monotonic()-started,codigoMudouDuranteExecucao=current!=cod,resumo={'selecionadas':len(tasks),'concluidas':len(cs),'goldAtivo':sum(x['goldAtivo'] for x in cs),'exatas':sum(x['exataFinal'] for x in cs),'positivasExatas':sum(x['goldAtivo'] and x['exataFinal'] for x in cs),'falsosPreenchimentosAceitos':sum(x['falsoPreenchimentoAceito'] for x in cs),'positivosAceitosNaoExatos':sum(x['positivoAceitoNaoExato'] for x in cs),'quadrosFinaisDesconhecidos':sum(not x['geradaFinal'] for x in cs)});salvar(a.saida/'execucao.json',record);print(json.dumps(record['resumo']),flush=True)
    if not record['concluido'] or record['codigoMudouDuranteExecucao']:raise SystemExit(1)

if __name__=='__main__':main()
