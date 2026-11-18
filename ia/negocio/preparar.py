"""Monta corpus por grupo e JSONL sem truncar exemplos silenciosamente."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(IA))
from runtime import salvar_json,sha256,PASTA_MODELO
from negocio.contrato import CAMPOS,validar_entrada,validar_saida,compactar_ids,mensagens
from negocio.prompts import mensagens_para


def fontes_modelo(caso):
    return [{"id":f["id"],"texto":f["texto"],"tipo":f["tipo"]} for f in caso["fontes"]]


def elegivel(caso,corpus):
    if "elegivelTreinoExperimental" in caso:return caso["elegivelTreinoExperimental"] is True
    origem=caso.get("origemRotulos",{})
    if isinstance(origem,dict) and "elegivelTreinoExperimental" in origem:
        return origem["elegivelTreinoExperimental"] is True
    return corpus.get("elegivelTreinoExperimental") is True


def expandir_corpus(corpus,campos):
    if "cenarios" in corpus:return [c for c in corpus["casos"] if c["entrada"].get("campo","recomendar") in campos]
    saida=[]
    for c in corpus["casos"]:
        fontes=fontes_modelo(c)
        tipo=c.get("tipoCaso") or ("controle" if str(c.get("dominio") or "").endswith(".invalid") else "real")
        simulado=tipo.startswith("controle") or "simulado" in tipo
        comum={"dominio":c.get("dominio"),"grupoEmpresarial":c["grupoEmpresarial"],"split":c.get("split","desenvolvimento"),
            "natureza":"documento_simulado" if simulado else "captura_real_historica",
            "casoOrigem":c["id"],"elegivelTreinoExperimental":elegivel(c,corpus),
            "origemRotulos":c.get("origemRotulos"),"captura":c.get("captura")}
        for campo in CAMPOS:
            if campo not in campos or campo not in c.get("alvosPorCampo",{}):continue
            entrada={"tarefa":"entender","campo":campo,"fontes":fontes}
            saida.append({**comum,"id":c["id"]+"-"+campo,"entrada":entrada,"esperado":c["alvosPorCampo"][campo]})
        if "recomendar" in campos and c.get("planejamentoEsperado") is not None:
            perfil=c.get("perfilOracle")
            if perfil is None:perfil={k:c["alvosPorCampo"][k]["valor"] for k in CAMPOS if k in c.get("alvosPorCampo",{})}
            entrada={"tarefa":"recomendar","perfil":perfil,"fontes":fontes}
            saida.append({**comum,"id":c["id"]+"-recomendar","entrada":entrada,"esperado":c["planejamentoEsperado"]})
    return saida


def particionar(casos,seed=42,fracao_validacao=.2,mapa_grupos=None):
    """A company cannot train an extractor while validating its planner."""
    if not 0<fracao_validacao<1:raise ValueError("Fração inválida.")
    fixos=dict(mapa_grupos or {})
    if any(v not in ("train","validation") for v in fixos.values()):raise ValueError("Mapa congelado contém split inválido.")
    abertos={c["grupoEmpresarial"] for c in casos if c["split"] in ("desenvolvimento","development","dev")}
    estratos={}
    for grupo in abertos-set(fixos):
        exemplos=[c for c in casos if c["grupoEmpresarial"]==grupo]
        real=any(c.get("natureza")=="captura_real_historica" for c in exemplos)
        legivel=any(any(f["tipo"]!="interface" for f in c["entrada"]["fontes"]) for c in exemplos)
        estrato="real_legivel" if real and legivel else "real_insuficiente" if real else "controle"
        estratos.setdefault(estrato,[]).append(grupo)
    validos=set()
    for grupos_estrato in estratos.values():
        ordenados=sorted(grupos_estrato,key=lambda g:hashlib.sha256((str(seed)+":"+g).encode()).hexdigest())
        if len(ordenados)>1:validos.update(ordenados[:max(1,round(len(ordenados)*fracao_validacao))])
    destinos={}
    for c in casos:
        antigo=c["split"]
        if antigo in ("holdout","test","teste","TEST-SELADO"):raise ValueError("O preparador de treino não recebe TEST: "+c["id"])
        grupo=c["grupoEmpresarial"]
        novo=fixos.get(grupo) if grupo in abertos and grupo in fixos else "validation" if grupo in validos else "train" if grupo in abertos else antigo
        if novo not in ("train","validation","valid"):raise ValueError("Split não reconhecido: "+antigo)
        novo="validation" if novo=="valid" else novo
        if grupo in fixos and fixos[grupo]!=novo:raise ValueError("Split explícito diverge do mapa congelado: "+grupo)
        if grupo in destinos and destinos[grupo]!=novo:raise ValueError("Grupo em treino e validação: "+grupo)
        destinos[grupo]=novo;c["splitOrigem"]=antigo;c["split"]=novo
    return destinos


def preparar(arquivos,campos,*,seed=42,mapa_grupos=None):
    casos,usados,origens=[],set(),[]
    for entrada_arquivo in arquivos:
        p,campos_arquivo=entrada_arquivo if isinstance(entrada_arquivo,tuple) else (entrada_arquivo,campos)
        corpus=json.loads(p.read_text());origens.append({"arquivo":str(p.resolve()),"sha256":sha256(p)})
        for c in expandir_corpus(corpus,campos_arquivo):
            # The same real company may appear in both task annotation files.
            if c["id"] in usados:raise ValueError("Tarefa duplicada; selecione só os campos de cada fonte: "+c["id"])
            usados.add(c["id"])
            erros=validar_entrada(c["entrada"])+validar_saida(c["esperado"],c["entrada"])
            if erros:raise ValueError(c["id"]+": "+",".join(erros))
            entrada,esperado,mapa=compactar_ids(c["entrada"],c["esperado"])
            c.update(entrada=entrada,esperado=esperado,mapaIdsOriginais=mapa)
            casos.append(c)
    grupos=particionar(casos,seed,mapa_grupos=mapa_grupos)
    return casos,grupos,origens


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--corpus",type=Path,action="append",default=[])
    p.add_argument("--entendimento",type=Path,action="append",default=[])
    p.add_argument("--planejamento",type=Path,action="append",default=[])
    p.add_argument("--campos",default=",".join(CAMPOS))
    p.add_argument("--saida",type=Path,required=True)
    p.add_argument("--max-sequencia",type=int,default=4096)
    p.add_argument("--somente-avaliacao",action="store_true")
    p.add_argument("--seed",type=int,default=42)
    p.add_argument("--prompt",choices=("v3","v4","v5"),default="v3")
    p.add_argument("--modelo-base",choices=("qwen25-15b","qwen3-4b","qwen35-4b"),default="qwen25-15b")
    p.add_argument("--mapa-grupos",type=Path,help="Manifesto anterior: preserva a divisão por organização ao ampliar o corpus.")
    a=p.parse_args()
    if a.saida.exists():p.error("Pasta existente: escolha versão nova.")
    arquivos=[(f,set(a.campos.split(","))) for f in a.corpus]+[(f,set(CAMPOS)) for f in a.entendimento]+[(f,{"recomendar"}) for f in a.planejamento]
    if not arquivos:p.error("Informe ao menos um corpus.")
    mapa_previo=None
    if a.mapa_grupos:
        mapa_previo=json.loads(a.mapa_grupos.read_text())["grupos"]
    casos,grupos,origens=preparar(arquivos,set(a.campos.split(",")),seed=a.seed,mapa_grupos=mapa_previo)
    if not casos:raise ValueError("Corpus vazio.")
    nao_revisados=[c["id"] for c in casos if c.get("elegivelTreinoExperimental") is not True]
    if nao_revisados and not a.somente_avaliacao:raise ValueError("Sem elegibilidade técnica experimental: "+str(nao_revisados[:8]))
    from transformers import AutoTokenizer
    from negocio.modelos import verificar_base
    pasta_modelo,_=verificar_base(a.modelo_base)
    tok=AutoTokenizer.from_pretrained(str(pasta_modelo),local_files_only=True,trust_remote_code=False)
    jsonls={"train":[],"validation":[]};tamanhos=[];excedidos=[]
    for c in casos:
        ms=mensagens_para(c["entrada"],c["esperado"],versao=a.prompt)
        tokens=len(tok.apply_chat_template(ms,tokenize=True,return_dict=False))
        tamanhos.append({"id":c["id"],"tokens":tokens})
        if tokens>a.max_sequencia:excedidos.append({"id":c["id"],"tokens":tokens})
        jsonls[c["split"]].append({"messages":ms})
    if excedidos:raise ValueError("Sem truncamento silencioso; exemplos excedem orçamento: "+str(excedidos[:8]))
    if not all(jsonls.values()):raise ValueError("Treino e validação precisam de exemplos.")
    a.saida.mkdir(parents=True)
    for split,nome in (("train","train.jsonl"),("validation","valid.jsonl")):
        (a.saida/nome).write_text("".join(json.dumps(x,ensure_ascii=False)+"\n" for x in jsonls[split]))
    corpus={"versao":1,"geradoEm":datetime.now(timezone.utc).isoformat(),"casos":casos,"origens":origens,
            "limite":"Desenvolvimento por grupo; não contém novas empresas TEST desta rodada."}
    salvar_json(a.saida/"corpus-avaliacao.json",corpus,exclusivo=True)
    manifest={"versao":1,"geradoEm":corpus["geradoEm"],"somenteAvaliacao":a.somente_avaliacao,
        "elegivelTreinoExperimental":not a.somente_avaliacao and not nao_revisados,
        "revisaoHumana":False,"prontoParaUsoComClientes":False,"origens":origens,"grupos":grupos,
        "arquivos":{n:sha256(a.saida/n) for n in ("train.jsonl","valid.jsonl","corpus-avaliacao.json")},
        "tamanhos":tamanhos,"totais":{s:len(v) for s,v in jsonls.items()},"maxSequencia":a.max_sequencia,
        "contratoSha256":sha256(Path(__file__).with_name("contrato.py")),"preparadorSha256":sha256(Path(__file__))}
    manifest["mapaGruposAnterior"]={"arquivo":str(a.mapa_grupos.resolve()),"sha256":sha256(a.mapa_grupos)} if a.mapa_grupos else None
    manifest.update(prompt=a.prompt,promptFonteSha256=sha256(Path(__file__).with_name("prompts.py")),modeloTokenizacao=a.modelo_base)
    salvar_json(a.saida/"manifest.json",manifest,exclusivo=True)
    print(json.dumps({"totais":manifest["totais"],"grupos":len(grupos),"maxTokens":max(t["tokens"] for t in tamanhos),"elegivelTreinoExperimental":manifest["elegivelTreinoExperimental"]}))


if __name__=="__main__":main()
