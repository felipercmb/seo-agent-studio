"""Conferência local e experimental de quadros literais, sem rótulos esperados.

Entrada: {versao:1, quadros:[{id, entrada:C16, classificacaoAnterior?:objeto}]}.
A classificação anterior fica no recibo e nunca é fornecida ao modelo.
"""
import argparse
from datetime import datetime,timezone
import hashlib,json,os
from pathlib import Path
import re,signal,sys,time
sys.path.insert(0,str(Path(__file__).resolve().parent))
from negocio.papeis import spec

def preparar(raw):
    if not isinstance(raw,bytes) or len(raw)>1048576:raise ValueError('Entrada limitada a 1 MiB.')
    def pares(items):
        out={}
        for key,value in items:
            if key in out:raise ValueError('Chave JSON duplicada: '+key)
            out[key]=value
        return out
    def constante(_):raise ValueError('Constante JSON não finita.')
    doc=json.loads(raw.decode('utf8'),object_pairs_hook=pares,parse_constant=constante)
    if not isinstance(doc,dict) or set(doc)!={'versao','quadros'} or type(doc['versao']) is not int or doc['versao']!=1 or not isinstance(doc['quadros'],list) or not 1<=len(doc['quadros'])<=32:raise ValueError('Forneça de 1 a 32 quadros, sem alvos de avaliação.')
    ids=set();rows=[]
    for item in doc['quadros']:
        if not isinstance(item,dict) or set(item)-{'id','entrada','classificacaoAnterior'} or not {'id','entrada'}<=set(item) or not isinstance(item['id'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',item['id']) or item['id'] in ids:raise ValueError('Quadro com campos ou identidade inválidos/repetidos.')
        ids.add(item['id']);row={'id':item['id'],'entrada':item['entrada'],'classificacaoAnterior':item.get('classificacaoAnterior')}
        try:spec.conferir_entrada(item['entrada']);row['estado']='pronta_para_conferencia'
        except (ValueError,TypeError,KeyError) as err:row.update(estado='recusada_entrada',erro=type(err).__name__+': '+str(err))
        rows.append(row)
    return rows

def estado_conferencia(g):
    if g.get('estado')!='gerada':return g.get('estado','geracao_indisponivel')
    if isinstance(g.get('validacao'),dict) and g['validacao'].get('estado')=='recusada':return 'recusada_contrato'
    s=g.get('saida')
    if isinstance(s,dict) and s.get('estrutura')=='sem_relacao':return 'sem_relacao_proposta'
    return 'classificacao_proposta'

def combinar_atribuicao(entrada,quadro,classificacao=None):
    """Preserves extraction, then applies a separate model proposal for review.

    Rejected/missing generations remain unknown, never synthetic abstentions.
    Only an explicit valid classifier abstention can yield sem_relacao.
    """
    from copy import deepcopy
    from negocio.atribuicoes.contrato import validar_saida as validar_extracao
    errors=validar_extracao(quadro,entrada);r={'quadroOriginal':deepcopy(quadro),'classificacaoProposta':deepcopy(classificacao),'quadro':None,'erros':errors,'perfilConfirmado':False,'revisaoSemantica':'pendente','fimAFim':False,'ofertaFornecida':True,'relacaoCorretaFornecida':False}
    if errors:return {**r,'estado':'extracao_recusada'}
    if quadro['estrutura']=='sem_relacao':return {**r,'estado':'abstencao_do_extrator','quadro':deepcopy(quadro)}
    if classificacao is None:return {**r,'estado':'classificacao_ausente'}
    e16={**entrada,'quadroProposto':{k:deepcopy(quadro[k]) for k in ['estrutura','ator','acao','objeto','marcadorNominal']}};errors=spec.validar_saida(classificacao,e16)
    if errors:return {**r,'estado':'classificacao_recusada','erros':errors}
    if classificacao['estrutura']=='sem_relacao':final={'estrutura':'sem_relacao','ator':None,'acao':None,'objeto':None,'tipoAtor':'indefinido','escopo':'indefinido','negada':False,'marcadorNominal':None}
    else:final={**deepcopy(quadro),**{k:classificacao[k] for k in ['tipoAtor','escopo','negada']}}
    errors=validar_extracao(final,entrada)
    return {**r,'estado':'proposta_recusada' if errors else 'proposta_combinada_para_revisao','quadro':None if errors else final,'erros':errors}

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--entrada',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);p.add_argument('--adaptador',type=Path);p.add_argument('--modelo-base',choices=['qwen35-4b','qwen35-9b'],default='qwen35-4b');p.add_argument('--limite-segundos',type=int,default=900);a=p.parse_args(argv)
    if a.saida.exists() or not 30<=a.limite_segundos<=1800:p.error('Use saída nova e prazo entre 30 e 1800 segundos.')
    raw=a.entrada.read_bytes();rows=preparar(raw);a.saida.mkdir(parents=True,mode=0o700);(a.saida/'entrada-original.json').write_bytes(raw)
    from negocio.ensaios import Leitor,salvar
    cod={**spec.codigo(),str(Path(__file__).resolve().relative_to(Path(__file__).resolve().parents[1])):hashlib.sha256(Path(__file__).read_bytes()).hexdigest()};started=time.monotonic();record={'inicio':datetime.now(timezone.utc).isoformat(),'entradaSha256':hashlib.sha256(raw).hexdigest(),'codigoSha256':cod,'selecionadas':len(rows),'ofertaFornecida':True,'relacaoFornecida':True,'fimAFim':False,'alvosEsperadosFornecidosAoModelo':False,'classificacaoAnteriorFornecidaAoModelo':False,'modeloPadraoAlterado':False,'revisaoHumanaIndependente':False,'casos':[],'concluido':False}
    def stop(*_):raise TimeoutError('Prazo da conferência local.')
    signal.signal(signal.SIGALRM,stop);signal.alarm(a.limite_segundos)
    try:
        ready=[x for x in rows if x['estado']=='pronta_para_conferencia'];reader=Leitor(spec,a.adaptador,a.modelo_base) if ready else None
        if reader:record['modelo']=reader.meta
        for item in rows:
            result={'id':item['id'],'estado':item['estado'],'classificacaoAnterior':item['classificacaoAnterior']}
            if item['estado']=='recusada_entrada':result['erro']=item['erro']
            else:
                g=reader.gerar(item['entrada']);result.update(estado=estado_conferencia(g),geracao=g,revisaoSemantica='pendente')
                if isinstance(g.get('saida'),dict):
                    s=g['saida'];before=item['classificacaoAnterior'];result['diferencasDeClassificacao']=[{'campo':k,'anterior':before.get(k),'proposta':s.get(k)} for k in ['tipoAtor','escopo','negada'] if isinstance(before,dict) and k in before and before[k]!=s.get(k)]
                import mlx.core as mx
                mx.clear_cache()
            salvar(a.saida/(item['id']+'.json'),result);record['casos'].append({'id':item['id'],'estado':result['estado']});salvar(a.saida/'execucao.json',record);print(item['id']+': '+result['estado'],flush=True)
        record['concluido']=len(record['casos'])==len(rows)
    except BaseException as err:record['erro']=type(err).__name__+': '+str(err)
    finally:
        signal.alarm(0);record.update(fim=datetime.now(timezone.utc).isoformat(),segundos=time.monotonic()-started,codigoMudouDuranteExecucao=spec.codigo()!={k:v for k,v in cod.items() if k!='ia/classificar_papeis_local.py'} or hashlib.sha256(Path(__file__).read_bytes()).hexdigest()!=cod['ia/classificar_papeis_local.py']);salvar(a.saida/'execucao.json',record)
    if not record['concluido'] or record['codigoMudouDuranteExecucao']:raise SystemExit(1)

if __name__=='__main__':main()
