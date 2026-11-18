"""Unidades contínuas ligadas à fonte original, nunca nomes empresariais fixos."""
from copy import deepcopy
import hashlib
import json
import re


def digest(v):
    return hashlib.sha256(json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def segmentar(base, *, max_unidades=64):
    """Divide só em pontuação de fim; cada unidade conserva offsets exatos.

    A divisão é editorial e pode errar abreviaturas. Não inventa sujeito,
    elimina frases, faz consulta remota ou altera a fonte original.
    """
    unidades = []
    descartes = []
    for f in base["fontes"]:
        if f["tipo"] == "interface" or f.get("contexto", {}).get("recortado") is True:
            descartes.append({"fonte": f["id"], "motivo": "interface_ou_recorte"})
            continue
        texto = f["texto"]
        cortes = [0] + [m.end() for m in re.finditer(r"[.!?]\s+(?=[A-ZÀ-Ý0-9])", texto)] + [len(texto)]
        locais=[]
        for inicio, fim in zip(cortes, cortes[1:]):
            while inicio < fim and texto[inicio].isspace():
                inicio += 1
            while fim > inicio and texto[fim - 1].isspace():
                fim -= 1
            if inicio == fim:
                continue
            locais.append({"fonte":f["id"],"inicio":inicio,"fim":fim,"texto":texto[inicio:fim]})
        if len(unidades)+len(locais)>max_unidades:
            # Nunca deixar só o começo de uma fonte e omitir uma negação ou
            # condição da última frase como se a fonte estivesse completa.
            descartes.append({"fonte":f["id"],"inicio":0,"fim":len(texto),"motivo":"fonte_inteira_fora_do_orcamento_de_unidades"})
            continue
        for u in locais:
            unidades.append({"id":"u"+str(len(unidades)+1).zfill(3),**u})
    return {"versao": 1, "dominio": base["dominio"], "fontes": deepcopy(base["fontes"]), "unidades": unidades,
            "entradaSha256": digest(base), "descartes": descartes,
            "limite": "Sentença contínua e referência exata não demonstram quem exerce um papel; interpretação permanece pendente."}


def para_modelo(documento):
    """Contexto sem hashes opacos no prompt; prova integral fica no artefato."""
    return {"dominio": documento["dominio"],
            "fontes": [{"id": f["id"], "tipo": f["tipo"],
                        "contexto": {k: f.get("contexto", {}).get(k) for k in ("url", "tituloPagina", "titulos", "campo", "classePagina")}}
                       for f in documento["fontes"]],
            "unidades": deepcopy(documento["unidades"]),
            "cobertura":{"unidades":len(documento["unidades"]),"limitada":bool(documento["descartes"]),
                         "fontesSemUnidades":[f["id"] for f in documento["fontes"] if not any(u["fonte"]==f["id"] for u in documento["unidades"])]}}
