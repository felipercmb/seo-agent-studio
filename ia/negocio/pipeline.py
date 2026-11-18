"""Ponte de hipóteses por campo para planejamento, sem usar rótulos oracle.

O contrato mecânico não certifica a interpretação. Esta ponte mantém o vínculo
com a mesma captura e registra cada perda antes de chamar um planejador.
"""

from copy import deepcopy
import json

from negocio.contrato import CAMPOS, validar_saida, validar_entrada, normalizar


def desconhecido(campo):
    return "indefinido" if campo=="papel" else "indefinida" if campo=="finalidade" else []


def remapear_referencias(valor,mapa):
    if isinstance(valor,dict):
        return {k:[mapa.get(i,i) for i in v] if k=="fontes" and isinstance(v,list) and all(isinstance(i,str) for i in v)
                else remapear_referencias(v,mapa) for k,v in valor.items()}
    return [remapear_referencias(v,mapa) for v in valor] if isinstance(valor,list) else valor


def montar_planejamento(leituras,contexto_plano,pool,*,max_fontes=16,max_caracteres=8000):
    if not 1<=max_fontes<=16 or not 128<=max_caracteres<=12000:
        raise ValueError("Orçamento de planejamento inválido.")
    fontes={}
    for f in pool:
        if f["id"] in fontes:raise ValueError("ID repetido no pool.")
        fontes[f["id"]]=f
    aceitas={};perdas=[]
    for campo in CAMPOS:
        r=leituras.get(campo)
        if r is None:
            perdas.append({"campo":campo,"motivo":"campo_nao_executado"});continue
        entrada=r["entrada"];saida=r.get("geracao",{}).get("saida")
        if entrada.get("campo")!=campo:raise ValueError("Campo trocado na ponte.")
        for f in entrada["fontes"]:
            original=fontes.get(f["id"])
            if original is None or any(f.get(k)!=original.get(k) for k in ("id","texto","tipo")):
                raise ValueError("Fonte de leitura não coincide com o pool desta captura: "+f["id"])
        erros=validar_saida(saida,entrada)
        if erros:
            perdas.append({"campo":campo,"motivo":"saida_recusada","erros":erros});continue
        aceitas[campo]=saida
    escolhidas=[];ids=set()
    def incluir(referencias):
        if any(i not in fontes for i in referencias):raise ValueError("Referência ausente do pool.")
        novas=[fontes[i] for i in dict.fromkeys(referencias) if i not in ids]
        teste=escolhidas+novas
        custo=len(json.dumps([{"id":f["id"],"texto":f["texto"],"tipo":f["tipo"]} for f in teste],ensure_ascii=False,separators=(",",":")))
        if len(teste)>max_fontes or custo>max_caracteres:return False
        escolhidas.extend(novas);ids.update(f["id"] for f in novas);return True
    # A category and a published condition have priority over unrelated prose.
    for campo in ("papel","finalidade","condicoes","ofertas","publicos","atuacoes"):
        s=aceitas.get(campo)
        if s is None or s["estado"]=="insuficiente":continue
        if campo in ("papel","finalidade"):incluir(s["fontes"])
        else:
            for item in s["valor"]:incluir(item["fontes"])
    for f in contexto_plano:
        original=fontes.get(f["id"])
        campos_comuns=("id","texto","tipo")+tuple(k for k in ("url","campo","coletadoEm","sha256","recortado","secao") if k in f)
        if original is None or any(f.get(k)!=original.get(k) for k in campos_comuns):
            raise ValueError("Contexto de planejamento fora da captura.")
        if not incluir([f["id"]]):
            perdas.append({"campo":"recomendar","fonteId":f["id"],"motivo":"contexto_fora_do_orcamento"})
    perfil={}
    for campo in CAMPOS:
        s=aceitas.get(campo)
        perfil[campo]=desconhecido(campo)
        if s is None or s["estado"]=="insuficiente":continue
        if campo in ("papel","finalidade"):
            if all(i in ids for i in s["fontes"]):perfil[campo]=s["valor"]
            else:perdas.append({"campo":campo,"motivo":"referencias_fora_do_orcamento"})
        else:
            for item in s["valor"]:
                if all(i in ids for i in item["fontes"]):perfil[campo].append(deepcopy(item))
                else:perdas.append({"campo":campo,"texto":item["texto"],"motivo":"referencias_fora_do_orcamento"})
    entrada={"tarefa":"recomendar","perfil":perfil,"fontes":[{k:f[k] for k in ("id","texto","tipo")} for f in escolhidas]}
    erros=validar_entrada(entrada)
    if erros:raise ValueError("Entrada de planejamento inválida: "+str(erros))
    return {"entrada":entrada,"perdas":perdas,"camposMecanicamenteValidos":sorted(aceitas),
        "perfilConfirmado":False,"revisaoSemanticaPendente":True,
        "limite":"Cada hipótese foi validada contra a mesma captura. Isso não certifica semântica, utilidade ou resultado financeiro."}
