"""JSONSchema derivado só do contrato e das fontes atuais, nunca dos alvos."""

from negocio.contrato import (validar_entrada,PAPEIS,FINALIDADES,FUNCOES,TIPOS_OFERTA,TIPOS_ATUACAO,FALTAS)


def objeto(props):return {"type":"object","properties":props,"required":list(props),"additionalProperties":False}
def texto(maximo):return {"type":"string","minLength":1,"maxLength":maximo}
def lista(item,maximo,minimo=0):return {"type":"array","items":item,"minItems":minimo,"maxItems":maximo}
def fixo(valor):return {"const":valor}


def esquema_para(entrada):
    erros=validar_entrada(entrada)
    if erros:raise ValueError("Entrada inválida para esquema: "+str(erros))
    ids=[f["id"] for f in entrada["fontes"]]
    fatos=[f["id"] for f in entrada["fontes"] if f["tipo"]!="interface"]
    def refs(permitidos,minimo=1):
        return lista({"type":"string","enum":permitidos},16,minimo) if permitidos else fixo([])
    escopo={"anyOf":[texto(120),{"type":"null"}]}
    if entrada["tarefa"]=="recomendar":
        incertezas=lista(texto(240),4,1)
        insuf=objeto({"estado":fixo("insuficiente"),"decisao":fixo(""),"alternativas":fixo([]),"criterios":fixo([]),
            "acao":fixo(""),"verificar":fixo(""),"fontes":fixo([]),"incertezas":incertezas,"hipotese":fixo(True)})
        if not fatos:return insuf
        proposta=objeto({"estado":fixo("proposta"),"decisao":texto(260),
            "alternativas":lista(objeto({"texto":texto(160),"fontes":refs(fatos)}),4),
            "criterios":lista(objeto({"texto":texto(240),"escopo":escopo,"fontes":refs(fatos)}),4,1),
            "acao":texto(420),"verificar":texto(420),"fontes":refs(ids),"incertezas":incertezas,"hipotese":fixo(True)})
        return {"type":"object","anyOf":[proposta,insuf]}
    campo=entrada["campo"]
    desconhecido="indefinido" if campo=="papel" else "indefinida" if campo=="finalidade" else []
    insuf=objeto({"estado":fixo("insuficiente"),"valor":fixo(desconhecido),"fontes":fixo([]),"faltam":fixo([campo])})
    if not fatos:return insuf
    if campo in ("papel","finalidade"):
        codigos=(PAPEIS if campo=="papel" else FINALIDADES)-{desconhecido}
        valor={"type":"string","enum":sorted(codigos)}
    else:
        props={"texto":texto(240 if campo=="condicoes" else 120)}
        if campo=="publicos":props.update(funcao={"type":"string","enum":sorted(FUNCOES)},escopo=escopo)
        elif campo=="condicoes":props["escopo"]=escopo
        else:props["tipo"]={"type":"string","enum":sorted(TIPOS_OFERTA if campo=="ofertas" else TIPOS_ATUACAO)}
        props["fontes"]=refs(fatos)
        valor=lista(objeto(props),6 if campo=="publicos" else 4,1)
    hipotese=objeto({"estado":fixo("hipotese"),"valor":valor,"fontes":refs(fatos),
        "faltam":lista({"type":"string","enum":sorted(FALTAS)},8)})
    return {"type":"object","anyOf":[hipotese,insuf]}
