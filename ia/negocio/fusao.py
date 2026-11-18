"""Fusão auditável de extrações de passagens distintas, sem completar fatos."""

from copy import deepcopy
from negocio.contrato import validar_saida,normalizar

LISTAS={"ofertas":4,"publicos":6,"atuacoes":4,"condicoes":4}


def fundir_lista(campo,leituras,pool):
    if campo not in LISTAS:raise ValueError("Fusão disponível apenas para campos de lista.")
    fontes={f["id"]:f for f in pool};itens=[];falhas=[];validas=0
    if len(fontes)!=len(pool):raise ValueError("ID repetido no pool de fusão.")
    for n,r in enumerate(leituras):
        entrada=r["entrada"];s=r.get("geracao",{}).get("saida")
        if entrada.get("campo")!=campo:raise ValueError("Campo trocado na fusão.")
        for f in entrada["fontes"]:
            original=fontes.get(f["id"])
            if original is None or any(original[k]!=f[k] for k in ("id","texto","tipo")):
                raise ValueError("Leitura não pertence ao pool desta captura.")
        erros=validar_saida(s,entrada)
        if erros:falhas.append({"passada":n+1,"erros":erros});continue
        validas+=1
        if s["estado"]=="hipotese":itens.extend(deepcopy(s["valor"]))
    if not validas:
        return {"entrada":None,"saida":None,"falhas":falhas,"perdas":[],"passadasValidas":0,"origem":"fusao_mecanica_sem_completar_fatos"}
    agrupados={};conflitos=set();perdas=[]
    for item in itens:
        texto=normalizar(item["texto"]).casefold()
        escopo=normalizar(item.get("escopo")).casefold()
        atributo=item.get("funcao",item.get("tipo"))
        identidade=(texto,escopo)
        if identidade in agrupados:
            anterior=agrupados[identidade]
            if anterior.get("funcao",anterior.get("tipo"))!=atributo:
                conflitos.add(identidade)
            else:anterior["fontes"]=list(dict.fromkeys(anterior["fontes"]+item["fontes"]))
        else:agrupados[identidade]=item
    candidatos=[]
    for identidade,item in agrupados.items():
        if identidade in conflitos:
            perdas.append({"texto":item["texto"],"escopo":item.get("escopo"),"motivo":"classificacoes_conflitantes_entre_passadas"})
        else:candidatos.append(item)
    # Preserve an explicit restriction before generic material fills the cap.
    if campo=="publicos":candidatos.sort(key=lambda i:0 if i["funcao"]=="excluido" else 1)
    if campo=="condicoes":
        import re
        candidatos.sort(key=lambda i:0 if re.search(r"\b(?:não|nao|indisponível|indisponivel|exceto|apenas|somente)\b",i["texto"],re.I) else 1)
    escolhidos=[];refs=[]
    for item in candidatos:
        novas=list(dict.fromkeys(refs+item["fontes"]))
        if len(escolhidos)>=LISTAS[campo] or len(novas)>16:
            perdas.append({"texto":item["texto"],"escopo":item.get("escopo"),"motivo":"limite_da_saida"});continue
        escolhidos.append(item);refs=novas
    entrada={"tarefa":"entender","campo":campo,"fontes":[{k:fontes[i][k] for k in ("id","texto","tipo")} for i in refs]}
    saida={"estado":"hipotese" if escolhidos else "insuficiente","valor":escolhidos,"fontes":refs,"faltam":[] if escolhidos else [campo]}
    erros=validar_saida(saida,entrada)
    if erros:raise ValueError("Fusão produziu contrato inválido: "+str(erros))
    return {"entrada":entrada,"saida":saida,"falhas":falhas,"perdas":perdas,"passadasValidas":validas,
        "origem":"fusao_mecanica_sem_completar_fatos","revisaoSemanticaPendente":True}
