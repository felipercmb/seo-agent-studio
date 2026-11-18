"""Recusas específicas de artefatos de protocolo observados na validação.

Não é um juiz semântico geral. Uma saída sem essas falhas ainda exige revisão.
"""

from negocio.contrato import normalizar


def verificar_qualidade(saida,entrada,*,versao_prompt):
    erros=[]
    if not isinstance(saida,dict):return {"versao":1,"erros":["sem_saida_json"],"revisaoSemanticaPendente":True}
    if entrada.get("tarefa")!="recomendar":
        return {"versao":1,"erros":[],"revisaoSemanticaPendente":True}
    decisao=normalizar(saida.get("decisao","")).casefold()
    if decisao in ("decisão a conferir","decisao a conferir"):
        erros.append("decisao_placeholder_do_protocolo")
    if versao_prompt=="v4":
        def textos(valor):
            if isinstance(valor,str):return [valor]
            if isinstance(valor,list):return [s for item in valor for s in textos(item)]
            if isinstance(valor,dict):return [s for item in valor.values() for s in textos(item)]
            return []
        resposta=" ".join(normalizar(s).casefold() for s in textos(saida))
        fontes=" ".join(normalizar(f.get("texto","")).casefold() for f in entrada.get("fontes",[]))
        for marcador in ("Kit Base","Kit Completo"):
            chave=marcador.casefold()
            if chave in resposta and chave not in fontes:
                erros.append("exemplo_ficticio_ausente_das_fontes:"+marcador)
    return {"versao":1,"erros":erros,"revisaoSemanticaPendente":True,
        "limite":"Detecta somente placeholders e os dois kits do exemplo V4. Ausência de alerta não aprova semântica, utilidade ou uso com clientes."}
