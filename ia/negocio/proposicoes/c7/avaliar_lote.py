"""Roda um lote local sob código congelado; a revisão semântica é separada."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import signal
import sys
import time

IA=Path(__file__).resolve().parents[3]
RAIZ=IA.parent
sys.path.insert(0,str(IA))
os.environ.update(HF_HUB_OFFLINE="1",TRANSFORMERS_OFFLINE="1",HF_HUB_DISABLE_TELEMETRY="1",HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
from negocio.proposicoes.c7.executar import CONFIG,codigo,executar,ler_pedido,conferir_adaptador


def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def salvar(p,v,novo=False):
    with p.open("x" if novo else "w",encoding="utf8") as f:json.dump(v,f,ensure_ascii=False,indent=2,allow_nan=False);f.write("\n")
def utc():return datetime.now(timezone.utc).isoformat()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--lote",type=Path,required=True);p.add_argument("--saida",type=Path,required=True)
    p.add_argument("--limite-segundos",type=int,default=1200);p.add_argument("--ate-utc")
    p.add_argument("--adaptador",type=Path)
    p.add_argument("--congelamento",type=Path);p.add_argument("--abrir-reserva",action="store_true")
    a=p.parse_args()
    if a.saida.exists() or not 30<=a.limite_segundos<=3600:p.error("Use saída nova e prazo30a3600segundos.")
    lote=json.loads(a.lote.read_text())
    if lote.get("split") not in ("development","development_consumido","holdout") or not isinstance(lote.get("lotes"),list) or not 1<=len(lote["lotes"])<=32:
        raise ValueError("Lote inválido.")
    codigos=codigo()
    adaptador=conferir_adaptador(a.adaptador) if a.adaptador else None
    if lote["split"]=="holdout":
        if not a.abrir_reserva or a.congelamento is None:raise ValueError("Reserva exige abertura explícita e congelamento prévio.")
        cong=json.loads(a.congelamento.read_text())
        if cong.get("codigoSha256")!=codigos or cong.get("config")!=CONFIG:raise ValueError("Código/configuração diferente do congelamento.")
        if adaptador and cong.get("adaptadorSha256")!=sha(adaptador/"adapters.safetensors"):raise ValueError("Adaptador diferente do congelado.")
    limite_utc=datetime.fromisoformat(a.ate_utc.replace("Z","+00:00")) if a.ate_utc else None
    if limite_utc is not None and (limite_utc.tzinfo is None or limite_utc<=datetime.now(timezone.utc)):raise ValueError("Prazo UTC deve ser futuro e incluir timezone.")
    inicio=time.monotonic();deadline=inicio+a.limite_segundos
    if limite_utc:deadline=min(deadline,inicio+(limite_utc-datetime.now(timezone.utc)).total_seconds())
    # Guarda antes de carregar qualquer modelo/peso.
    a.saida.mkdir(parents=True,mode=0o700);(a.saida/"entradas").mkdir();(a.saida/"etapas").mkdir()
    for rel,h in codigos.items():
        d=a.saida/"codigo"/rel;d.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(RAIZ/rel,d)
        if sha(d)!=h:raise ValueError("Cópia de código inconsistente.")
    registro={"versao":1,"inicio":utc(),"split":lote["split"],"loteSha256":sha(a.lote),"codigoSha256":codigos,"config":CONFIG,
              "congelamentoSha256":sha(a.congelamento) if a.congelamento else None,"casosEsperados":len(lote["lotes"]),
              "casos":[],"tentados":[],"etapas":[],"concluido":False,"limiteAtingido":False,"erro":None,
              "novoAjustePesos":bool(adaptador),"modeloPadraoAlterado":False,"reservaAberta":lote["split"]=="holdout"}
    salvar(a.saida/"inicio.json",registro,True)
    pedidos=[];ids=set()
    for c in lote["lotes"]:
        import re
        if not isinstance(c.get("id"),str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}",c["id"]) or c["id"] in ids:raise ValueError("ID inválido/repetido.")
        ids.add(c["id"]);rel=Path(c["entrada"])
        if rel.is_absolute() or ".." in rel.parts:raise ValueError("Pedido fora do lote.")
        path=a.lote.parent/rel
        if c.get("entradaSha256")!=sha(path):raise ValueError("Pedido alterado.")
        pedido=ler_pedido(path.read_bytes())
        if pedido["base"]["dominio"]!=c["dominio"]:raise ValueError("Domínio divergente.")
        shutil.copy2(path,a.saida/"entradas"/(c["id"]+".json"));pedidos.append((c,pedido))
    def interromper(*args):raise TimeoutError("Prazo de inferência atingido.")
    if hasattr(signal,"SIGALRM"):
        signal.signal(signal.SIGALRM,interromper);signal.alarm(max(1,math.ceil(deadline-time.monotonic())))
    leitor=None
    try:
        for c,pedido in pedidos:
            if time.monotonic()>=deadline:
                registro["limiteAtingido"]=True;break
            registro["tentados"].append(c["id"]);salvar(a.saida/"progresso.json",registro)
            inicio_caso=time.monotonic();print("Iniciando "+c["id"],flush=True)
            def etapa(nome,resposta,doc,oferta):
                rel="etapas/"+c["id"]+"-"+nome+".json"
                salvar(a.saida/rel,{"geracao":resposta,"documento":doc,"ofertaExecutada":oferta},True)
                registro["etapas"].append({"caso":c["id"],"tipo":nome,"arquivo":rel,"sha256":sha(a.saida/rel)})
                salvar(a.saida/"progresso.json",registro)
            try:
                if pedido["base"]["fontes"] and leitor is None:
                    from negocio.runtime_negocio import carregar_leitor
                    leitor=carregar_leitor(adaptador=adaptador,modelo_base=CONFIG["modeloBase"])
                    registro["modelo"]=leitor[2]
                r=executar(pedido["base"],pedido["maxOfertas"],pedido.get("fontesReserva"),leitor=leitor,ao_etapa=etapa)
                nome=c["id"]+"-resultado.json";salvar(a.saida/nome,r,True)
                item={"id":c["id"],"dominio":c["dominio"],"estado":r["estado"],"arquivo":nome,"sha256":sha(a.saida/nome),
                      "ofertas":len(r["ofertas"]),"proposicoes":sum(len(o["jornada"]["proposicoes"]) for o in r["ofertas"]),
                      "recusas":len(r["recusadas"])+sum(len(o["jornada"]["recusadas"]) for o in r["ofertas"]),
                      "conclusaoMecanica":r["conclusaoMecanica"],"segundos":time.monotonic()-inicio_caso}
            except Exception as e:
                item={"id":c["id"],"dominio":c["dominio"],"estado":"falhou","erro":type(e).__name__+": "+str(e),"segundos":time.monotonic()-inicio_caso}
            registro["casos"].append(item);salvar(a.saida/"progresso.json",registro)
            print(json.dumps(item,ensure_ascii=False),flush=True)
            if leitor:
                import mlx.core as mx
                mx.clear_cache()
                registro["picoTensoresMLXGiB"]=mx.get_peak_memory()/1024**3
        registro["concluido"]=len(registro["casos"])==len(pedidos)
    except KeyboardInterrupt:
        registro["erro"]="Interrupção solicitada. Etapas anteriores preservadas."
    except Exception as e:
        registro["erro"]=type(e).__name__+": "+str(e)
    finally:
        if hasattr(signal,"SIGALRM"):signal.alarm(0)
        registro.update(fim=utc(),segundos=time.monotonic()-inicio,codigoMudouDuranteExecucao=codigo()!=codigos)
        registro["limiteAtingido"]=registro["limiteAtingido"] or time.monotonic()>=deadline
        salvar(a.saida/"execucao.json",registro,True)
        print(json.dumps({"concluido":registro["concluido"],"casos":len(registro["casos"]),"erro":registro["erro"],"limiteAtingido":registro["limiteAtingido"]}),flush=True)


if __name__=="__main__":main()
