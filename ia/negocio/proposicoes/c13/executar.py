"""Candidato v3: relações por atividade. Stdin local; padrão do produto intacto."""
import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import time

IA=Path(__file__).resolve().parents[3]
RAIZ=IA.parent
sys.path.insert(0,str(IA))
os.environ.update(HF_HUB_OFFLINE="1",TRANSFORMERS_OFFLINE="1",HF_HUB_DISABLE_TELEMETRY="1",HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
from negocio.jornadas.contrato import validar_base
from negocio.jornadas.recuperacao import recuperar_jornada,validar_reserva
from negocio.contrato import ler_json_estrito
from negocio.proposicoes.unidades import segmentar,digest
from negocio.proposicoes.c13.protocolo import mensagens,esquema
from negocio.proposicoes.contrato import validar_ofertas,validar_proposicoes,projetar_jornada
from negocio.proposicoes.lotes import lotes_proposicoes
from negocio.proposicoes.nomes import catalogo_nomes
from negocio.proposicoes.recuperacao import recuperar_atividades

CONFIG={"candidato":"proposicoes-c13-4b","modeloBase":"qwen35-4b","temperatura":0,"maxTokensOfertas":500,"maxTokensProposicoes":750,
        "maxSequencia":8192,"maxProposicoes":6,"maxCondicoes":3,"maxUnidades":64,"limiteMemoriaMLXGiB":6,
        "maxOfertasIdentificadas":1,"maxLotesProposicoes":2,"maxProposicoesPorLote":3,"maxCondicoesPorLote":1,
        "relacaoOrigem":"Classificação programática do verbo literal, ou indefinida; não uma decisão semântica do modelo.",
        "origem":"Experimento C13: mesmo4B/corpus223/protocolo C12, LoRA rank32 na mesma camada; modelo não promovido.","modeloPadraoAlterado":False}


def codigo():
    relativos=[p.relative_to(RAIZ) for p in Path(__file__).parent.glob("*.py")]
    relativos += [p.relative_to(RAIZ) for p in Path(__file__).parent.parent.glob("*.py")]
    relativos += [p.relative_to(RAIZ) for p in Path(__file__).parent.with_name('c10').glob('*.py')]
    relativos += [p.relative_to(RAIZ) for p in Path(__file__).parent.with_name('c7').glob('*.py')]
    relativos += [p.relative_to(RAIZ) for p in Path(__file__).parent.with_name('c8').glob('*.py')]
    relativos += [Path(x) for x in ("ia/negocio/jornadas/recuperacao.py","ia/negocio/jornadas/contrato.py","ia/negocio/relacoes/contrato.py",
        "ia/negocio/modelos.py","ia/negocio/runtime_negocio.py","ia/negocio/protocolo.py","ia/negocio/decodificacao/core_mlx.py")]
    return {str(r):hashlib.sha256((RAIZ/r).read_bytes()).hexdigest() for r in relativos}


def conferir_adaptador(pasta):
    pasta=Path(pasta).resolve()
    d=json.loads((pasta/"treino.json").read_text())
    if d.get("modeloBase")!="qwen35-4b" or d.get("estado")!="concluido" or d.get("codigoMudouDuranteExecucao") is not False or d.get("novoAjustePesos") is not True:
        raise ValueError("Adaptador sem recibo de treino C13 concluído e estável.")
    for arquivo,campo in (("adapters.safetensors","adaptadorSha256"),("adapter_config.json","configAdaptadorSha256")):
        if hashlib.sha256((pasta/arquivo).read_bytes()).hexdigest()!=d.get(campo):raise ValueError("Adaptador alterado após treino.")
    atual=hashlib.sha256(Path(__file__).with_name("protocolo.py").read_bytes()).hexdigest()
    if d.get("protocoloSha256")!=atual:raise ValueError("Adaptador de outro protocolo.")
    return pasta


def gerar(modelo,tok,doc,oferta=None):
    if oferta and not doc["unidades"]:
        return {"estado":"nao_executada_sem_unidades","inferida":False,"saida":None,"motivo":"Nenhuma fonte inteira coube na representação; não inferir ausência de atividade."}
    if not oferta and not catalogo_nomes(doc):
        return {"estado":"nao_executada_sem_nomes","inferida":False,"saida":None,"motivo":"Nenhuma expressão literal foi catalogada; não inventar nome de oferta."}
    from negocio.decodificacao.core_mlx import preparar_indice_json,criar_processador_mlx
    from negocio.protocolo import prefixo_assistente
    from mlx_lm import stream_generate
    from mlx_lm.sample_utils import make_sampler
    ms=mensagens(doc,oferta)
    prompt=prefixo_assistente(tok,ms)["prompt"]
    tokens=tok.encode(prompt,add_special_tokens=False)
    limite=CONFIG["maxTokensProposicoes"] if oferta else CONFIG["maxTokensOfertas"]
    identidade={"mensagensSha256":digest(ms),"promptSha256":hashlib.sha256(prompt.encode()).hexdigest(),"tokensSha256":digest(tokens),"tokensEntrada":len(tokens)}
    if len(tokens)+limite>CONFIG["maxSequencia"]:
        return {"estado":"nao_executada_orcamento","inferida":False,"saida":None,"identidade":identidade,"maxTokensSaida":limite}
    inicio=time.monotonic()
    indice=preparar_indice_json(esquema(doc,oferta),tok,limitar_comprimento_texto=False)
    processador=criar_processador_mlx(indice)
    partes=[];ultimo=None;falha=None
    try:
        for ultimo in stream_generate(modelo,tok,prompt=prompt,max_tokens=limite,sampler=make_sampler(temp=0),logits_processors=[processador]):
            partes.append(ultimo.text)
    except Exception as e:
        falha={"tipo":type(e).__name__,"mensagem":str(e),"estado":"interrompida_tempo" if isinstance(e,TimeoutError) else "falhou_geracao"}
    bruto="".join(partes)
    if falha:
        saida=None;estado=falha["estado"]
    else:
        try:
            saida=ler_json_estrito(bruto);estado="gerada"
        except (TypeError,ValueError):
            saida=None;estado="recusada_json"
    return {"estado":estado,"inferida":True,"saida":saida,"textoBruto":bruto,"identidade":identidade,
            "tokensGerados":ultimo.generation_tokens if ultimo else 0,"fimGeracao":ultimo.finish_reason if ultimo else None,
            "segundos":time.monotonic()-inicio,"maxTokensSaida":limite,"falha":falha}


def executar(base,max_ofertas=1,fontes_reserva=None,*,leitor=None,gerador=None,ao_etapa=None,adaptador=None):
    if validar_base(base):
        raise ValueError("Base inválida.")
    if type(max_ofertas) is not int or not 1<=max_ofertas<=3:
        raise ValueError("Limite de ofertas inválido.")
    validar_reserva(fontes_reserva,base["dominio"])
    codigos=codigo()
    r={"versao":3,"candidato":CONFIG["candidato"],"dominio":base["dominio"],"entradaSha256":digest(base),
       "perfilConfirmado":False,"revisaoSemantica":"pendente","ofertas":[],"recusadas":[],"inferencias":[],"avisos":[],
       "config":CONFIG.copy(),"codigo":codigos,"modelo":None,"novoAjustePesos":False,"modeloPadraoAlterado":False,"codigoMudouDuranteExecucao":False}
    if not base["fontes"]:
        return {**r,"estado":"sem_fontes","ofertasIdentificadas":0,"ofertasAnalisadas":0,
                "incertezas":["A captura não forneceu fontes. Isso não significa que o negócio não tenha ofertas."],
                "conclusaoMecanica":{"completa":False,"motivo":"sem_fontes","qualidadeSemantica":"nao_avaliada"}}
    if leitor is None and gerador is None:
        from negocio.runtime_negocio import carregar_leitor
        leitor=carregar_leitor(adaptador=conferir_adaptador(adaptador) if adaptador else None,modelo_base=CONFIG["modeloBase"])
    modelo,tok,meta=leitor if leitor is not None else (None,None,{"inferenciasInjetadasParaTeste":True})
    if gerador is None and meta.get("modeloBase")!=CONFIG["modeloBase"]:raise ValueError("Leitor C13 exige modelo4B com identidade real.")
    r["modelo"]=meta
    r["novoAjustePesos"]=bool(meta.get("adaptadorSha256"))
    chamar=(lambda d,o=None:gerador(d,o)) if gerador is not None else (lambda d,o=None:gerar(modelo,tok,d,o))
    doc=segmentar(base,max_unidades=CONFIG["maxUnidades"])
    r["catalogoNomes"]=catalogo_nomes(doc)
    primeiro=chamar(doc);r["inferencias"].append(primeiro)
    if ao_etapa is not None:ao_etapa("ofertas",primeiro,doc,None)
    ofertas=validar_ofertas(primeiro.get("saida"),doc)
    r["recusadas"]=ofertas["recusadas"]
    r["incertezas"]=ofertas["incertezas"]
    r["incertezasRecusadas"]=ofertas["incertezasRecusadas"]
    r["ofertasIdentificadas"]=len(ofertas["ofertas"])
    r["unidadesCabeca"]={"quantidade":len(doc["unidades"]),"descartes":doc["descartes"]}
    for oferta in ofertas["ofertas"][:max_ofertas]:
        gc.collect()
        if leitor is not None:
            import mlx.core as mx
            mx.clear_cache()
        especifica,ancorada,recuperacao=recuperar_atividades(base,oferta,fontes_reserva)
        unidade=segmentar(especifica,max_unidades=CONFIG["maxUnidades"])
        lotes,selecoes=lotes_proposicoes(unidade,max_lotes=CONFIG["maxLotesProposicoes"],oferta=ancorada)
        if gerador is not None:lotes=[unidade]
        val={"proposicoes":[],"condicoes":[],"recusadas":[],"incertezas":[],"incertezasRecusadas":[],"revisaoSemantica":"pendente","perfilConfirmado":False}
        for li,lote in enumerate(lotes):
            g=chamar(lote,ancorada);r["inferencias"].append(g)
            if ao_etapa is not None:ao_etapa("proposicoes_"+str(len(r["ofertas"])+1).zfill(2)+"_lote"+str(li+1).zfill(2),g,lote,ancorada)
            v=validar_proposicoes(g.get("saida"),lote,ancorada)
            for p in v["proposicoes"]:
                p["id"]="p"+str(len(val["proposicoes"])+1).zfill(2);val["proposicoes"].append(p)
            for c in v["condicoes"]:
                c["id"]="c"+str(len(val["condicoes"])+1).zfill(2);val["condicoes"].append(c)
            val["recusadas"] += [{**x,"lote":li+1} for x in v["recusadas"]]
            val["incertezas"] = list(dict.fromkeys([*val["incertezas"],*v["incertezas"]]))[:4]
            val["incertezasRecusadas"] += v["incertezasRecusadas"]
            if v.get("erro"):val["erro"]=v["erro"]
        jornada=projetar_jornada(val,ancorada)
        jornada.update(fontesSelecionadas=especifica["fontes"],entradaSha256=digest(especifica),unidades=unidade["unidades"],
                       recuperacao=recuperacao,descartesDeUnidades=unidade["descartes"],incertezasRecusadas=val["incertezasRecusadas"],selecaoDeProposicoes=selecoes)
        if val.get("erro"):
            jornada["erro"]=val["erro"]
        r["ofertas"].append({**oferta,"jornada":jornada})
    r["ofertasAnalisadas"]=len(r["ofertas"])
    r["estado"]="revisao_necessaria" if r["ofertas"] else "insuficiente"
    if ofertas.get("erro"):
        r["erroCabeca"]=ofertas["erro"]
        r["avisos"].append("Cabeça incompatível; não concluir ausência de oferta. Revise a publicação e a extração.")
    r["limite"]="Relações com sujeito, ação, objeto e escopo publicados para revisão. Conclusão mecânica não certifica interpretação, serviço real ou valor comercial."
    r["codigoMudouDuranteExecucao"]=codigo()!=codigos
    r["conclusaoMecanica"]={"completa":all(i.get("estado")=="gerada" and i.get("inferida") is True for i in r["inferencias"]),
        "cabecaAceitaSemRecusa":not ofertas.get("erro") and not ofertas["recusadas"],
        "estruturaAceita":not ofertas.get("erro") and not any(o["jornada"].get("erro") for o in r["ofertas"]),
        "proposicoesECondicoesRecusadas":sum(len(o["jornada"]["recusadas"]) for o in r["ofertas"]),
        "qualidadeSemantica":"nao_avaliada"}
    return r


def ler_pedido(bruto):
    if not isinstance(bruto,bytes) or len(bruto)>1048576:
        raise ValueError("Pedido deve ter até1MiB.")
    def pares(lista):
        r={}
        for k,v in lista:
            if k in r:raise ValueError("Chave repetida no pedido.")
            r[k]=v
        return r
    def constante(v):raise ValueError("Constante JSON não finita.")
    d=json.loads(bruto.decode("utf8"),object_pairs_hook=pares,parse_constant=constante)
    if not isinstance(d,dict) or set(d) not in ({"base","maxOfertas"},{"base","maxOfertas","fontesReserva"}) or type(d["maxOfertas"]) is not int or not 1<=d["maxOfertas"]<=3:
        raise ValueError("Pedido incompatível.")
    return d


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--limite-segundos",type=int,default=330)
    p.add_argument("--adaptador",type=Path)
    a=p.parse_args()
    if not 30<=a.limite_segundos<=900:
        p.error("Prazo local entre30e900segundos.")
    d=ler_pedido(sys.stdin.buffer.read(1048577))
    def parar(*args):raise TimeoutError("Prazo da inferência local atingido.")
    if hasattr(signal,"SIGALRM"):
        signal.signal(signal.SIGALRM,parar);signal.alarm(a.limite_segundos)
    try:
        r=executar(d["base"],d["maxOfertas"],d.get("fontesReserva"),adaptador=a.adaptador)
        print(json.dumps(r,ensure_ascii=False,allow_nan=False),flush=True)
    finally:
        if hasattr(signal,"SIGALRM"):signal.alarm(0)


if __name__=="__main__":main()
