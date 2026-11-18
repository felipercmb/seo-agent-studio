"""Observa o pipeline padrão4B, sem adaptar prompts/modelo ao candidato novo."""
import argparse
from datetime import datetime,timezone
import gc
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import time

IA=Path(__file__).resolve().parent
RAIZ=IA.parent
sys.path.insert(0,str(IA))
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1')
CONFIG_BASELINE={'pipeline':'jornadas_padrao','modeloBase':'qwen35-4b','maxOfertas':1,'novoAjustePesos':False,'modeloPadraoAlterado':False,'comparacao':'Pipeline padrão4B versus novo9B+protocolo+recuperação+regras; não isola ganho de pesos, modelo ou protocolo.'}

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def utc():return datetime.now(timezone.utc).isoformat()
def salvar(p,v,novo=False):
    with Path(p).open('x' if novo else 'w',encoding='utf8') as f:json.dump(v,f,ensure_ascii=False,indent=2,allow_nan=False);f.write('\n')

def codigo_baseline():
    arquivos=list((IA/'negocio/jornadas').glob('*.py'))
    arquivos += [IA/p for p in ('negocio/modelos.py','negocio/runtime_negocio.py','negocio/protocolo.py','negocio/contrato.py','negocio/relacoes/contrato.py','negocio/decodificacao/core_mlx.py')]
    arquivos.append(Path(__file__))
    return {str(p.relative_to(RAIZ)):sha(p) for p in arquivos}

def pedido_bytes(bruto,dominio):
    if len(bruto)>1048576:raise ValueError('Entrada acima de1MiB.')
    from negocio.jornadas.contrato import validar_base
    from negocio.jornadas.recuperacao import validar_reserva
    def pares(valores):
        d={}
        for k,v in valores:
            if k in d:raise ValueError('Chave repetida no pedido.')
            d[k]=v
        return d
    def constante(v):raise ValueError('Constante JSON inválida.')
    d=json.loads(bruto.decode('utf8'),object_pairs_hook=pares,parse_constant=constante)
    if not isinstance(d,dict) or set(d) not in ({'base','maxOfertas'},{'base','maxOfertas','fontesReserva'}) or type(d['maxOfertas']) is not int or d['maxOfertas']!=1:raise ValueError('Pedido incompatível com comparação de uma oferta.')
    if validar_base(d['base']) or d['base']['dominio']!=dominio:raise ValueError('Base/domínio inválido.')
    validar_reserva(d.get('fontesReserva'),dominio)
    return d

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--lote',type=Path,required=True);p.add_argument('--saida',type=Path,required=True)
    p.add_argument('--congelamento',type=Path,required=True);p.add_argument('--abrir-reserva',action='store_true')
    p.add_argument('--limite-segundos',type=int,default=1200);p.add_argument('--ate-utc',required=True)
    a=p.parse_args()
    if a.saida.exists() or not 30<=a.limite_segundos<=3600:p.error('Saída deve ser nova e prazo30a3600segundos.')
    codigos=codigo_baseline();cong=json.loads(a.congelamento.read_text())
    if cong.get('codigoBaselineSha256')!=codigos or cong.get('configBaseline')!=CONFIG_BASELINE:raise ValueError('Baseline não corresponde ao congelamento.')
    lote=json.loads(a.lote.read_text())
    if lote.get('split')!='holdout' or not a.abrir_reserva or not isinstance(lote.get('lotes'),list) or not 1<=len(lote['lotes'])<=32:raise ValueError('Reserva exige abertura explícita e lote1a32casos.')
    ate=datetime.fromisoformat(a.ate_utc.replace('Z','+00:00'))
    if ate.tzinfo is None or ate<=datetime.now(timezone.utc):raise ValueError('Prazo deve ser futuro UTC.')
    inicio=time.monotonic();deadline=min(inicio+a.limite_segundos,inicio+(ate-datetime.now(timezone.utc)).total_seconds())
    a.saida.mkdir(parents=True,mode=0o700);(a.saida/'entradas').mkdir();(a.saida/'etapas').mkdir()
    for rel,h in codigos.items():
        destino=a.saida/'codigo'/rel;destino.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(RAIZ/rel,destino)
        if sha(destino)!=h:raise ValueError('Snapshot do baseline inconsistente.')
    registro={'versao':1,'inicio':utc(),'split':'holdout','config':CONFIG_BASELINE,'codigoSha256':codigos,'congelamentoSha256':sha(a.congelamento),'loteSha256':sha(a.lote),'casosEsperados':len(lote['lotes']),'casos':[],'tentados':[],'etapas':[],'concluido':False,'loteProcessadoIntegralmente':False,'limiteAtingido':False,'erro':None,'reservaAberta':True,'novoAjustePesos':False,'modeloPadraoAlterado':False,'instrumentacao':'Wrapper observa cada retorno de gerar, sem modificar mensagens, esquema, saída ou configuração. Uma chamada executar por entrada; modelo carregado uma vez. Se gerar é interrompida antes de retornar, não há prefixo bruto recuperado; tentativa permanece falha no denominador.'}
    salvar(a.saida/'inicio.json',registro,True)
    pedidos=[];ids=set()
    for c in lote['lotes']:
        if not isinstance(c.get('id'),str) or not re.fullmatch('[A-Za-z0-9_-]{1,100}',c['id']) or c['id'] in ids:raise ValueError('ID inválido ou repetido.')
        ids.add(c['id']);rel=Path(c['entrada'])
        if rel.is_absolute() or '..' in rel.parts:raise ValueError('Entrada fora da pasta do lote.')
        arq=a.lote.parent/rel
        if sha(arq)!=c['entradaSha256']:raise ValueError('SHA da entrada mudou.')
        pedido=pedido_bytes(arq.read_bytes(),c['dominio']);shutil.copy2(arq,a.saida/'entradas'/(c['id']+'.json'));pedidos.append((c,pedido))
    def interromper(*args):raise TimeoutError('Prazo global da comparação atingido.')
    signal.signal(signal.SIGALRM,interromper);signal.alarm(max(1,math.ceil(deadline-time.monotonic())))
    leitor=None
    import negocio.jornadas.executar as modulo
    gerar_original=modulo.gerar
    try:
        for c,pedido in pedidos:
            if time.monotonic()>=deadline:registro['limiteAtingido']=True;break
            registro['tentados'].append(c['id']);salvar(a.saida/'progresso.json',registro)
            inicio_caso=time.monotonic();contador=[0];print('Iniciando '+c['id'],flush=True)
            def observar(modelo,tok,base,oferta=None):
                g=gerar_original(modelo,tok,base,oferta);contador[0]+=1
                rel='etapas/'+c['id']+'-'+str(contador[0]).zfill(2)+'.json'
                salvar(a.saida/rel,{'geracao':g,'documento':base,'ofertaExecutada':oferta},True)
                registro['etapas'].append({'caso':c['id'],'arquivo':rel,'sha256':sha(a.saida/rel)})
                salvar(a.saida/'progresso.json',registro);return g
            modulo.gerar=observar
            try:
                if pedido['base']['fontes'] and leitor is None:
                    from negocio.runtime_negocio import carregar_leitor
                    leitor=carregar_leitor(modelo_base='qwen35-4b')
                    if leitor[2].get('modeloBase')!='qwen35-4b':raise ValueError('Modelo baseline não é4B.')
                    registro['modelo']=leitor[2]
                r=modulo.executar(pedido['base'],1,pedido.get('fontesReserva'),leitor=leitor)
                nome=c['id']+'-resultado.json';salvar(a.saida/nome,r,True)
                item={'id':c['id'],'dominio':c['dominio'],'entradaSha256':c['entradaSha256'],'estado':r['estado'],'arquivo':nome,'sha256':sha(a.saida/nome),'ofertas':len(r['ofertas']),'inferencias':len(r.get('inferencias',[])),'inferenciasConcluidas':sum(x.get('estado')=='gerada' and x.get('inferida') is True for x in r.get('inferencias',[])),'segundos':time.monotonic()-inicio_caso}
            except Exception as e:
                item={'id':c['id'],'dominio':c['dominio'],'entradaSha256':c['entradaSha256'],'estado':'falhou','erro':type(e).__name__+': '+str(e),'segundos':time.monotonic()-inicio_caso}
            finally:modulo.gerar=gerar_original
            registro['casos'].append(item);salvar(a.saida/'progresso.json',registro);print(json.dumps(item,ensure_ascii=False),flush=True);gc.collect()
            if leitor:
                import mlx.core as mx
                mx.clear_cache();registro['picoTensoresMLXGiB']=mx.get_peak_memory()/1024**3
        registro['loteProcessadoIntegralmente']=len(registro['casos'])==len(pedidos)
        registro['concluido']=registro['loteProcessadoIntegralmente'] and not any(x['estado']=='falhou' for x in registro['casos'])
    except KeyboardInterrupt:registro['erro']='Interrupção solicitada; tentativas permanecem no denominador.'
    except Exception as e:registro['erro']=type(e).__name__+': '+str(e)
    finally:
        modulo.gerar=gerar_original;signal.alarm(0)
        registro.update(fim=utc(),segundos=time.monotonic()-inicio,codigoMudouDuranteExecucao=codigo_baseline()!=codigos)
        registro['limiteAtingido']=registro['limiteAtingido'] or time.monotonic()>=deadline
        salvar(a.saida/'execucao.json',registro,True);print(json.dumps({'concluido':registro['concluido'],'casos':len(registro['casos']),'erro':registro['erro']}),flush=True)

if __name__=='__main__':main()
