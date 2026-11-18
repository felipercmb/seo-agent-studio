"""Apoio literal e projeção por atividade; nenhuma aprovação semântica automática."""
from copy import deepcopy
import re
import unicodedata
from negocio.jornadas.contrato import validar_base,INDICIOS_EN
from negocio.relacoes.contrato import INDICIOS_CONDICAO
from negocio.proposicoes.protocolo import NATUREZAS, PAPEIS, RELACOES, TIPOS_SUJEITO, ESCOPOS, CONDICOES, ALCANCES


def normal(v):
    return " ".join(unicodedata.normalize("NFKC", v).casefold().split()) if isinstance(v, str) else ""


def texto(v, limite):
    return isinstance(v, str) and 0 < len(v.strip()) <= limite and not re.search(r"[\x00-\x1f\x7f]", v)


def literal(v, corpo, limite):
    return texto(v, limite) and re.search(r"(?<!\w)" + re.escape(normal(v)) + r"(?!\w)", normal(corpo)) is not None


def conferir_documento(doc):
    base = {k:doc[k] for k in ("versao", "dominio", "fontes")}
    if validar_base(base):
        raise ValueError("Fontes de negócio inválidas.")
    fs = {f["id"]:f for f in doc["fontes"]}
    ids = set()
    if not isinstance(doc.get("unidades"), list) or len(doc["unidades"]) > 64:
        raise ValueError("Unidades inválidas.")
    for u in doc["unidades"]:
        if not isinstance(u, dict) or set(u) != {"id", "fonte", "inicio", "fim", "texto"}:
            raise ValueError("Unidade inválida.")
        if not isinstance(u["id"], str) or not re.fullmatch(r"u\d{3}", u["id"]) or u["id"] in ids or u["fonte"] not in fs:
            raise ValueError("Identidade de unidade inválida.")
        ids.add(u["id"])
        if type(u["inicio"]) is not int or type(u["fim"]) is not int or not 0 <= u["inicio"] < u["fim"] <= len(fs[u["fonte"]]["texto"]):
            raise ValueError("Intervalo da unidade inválido.")
        if fs[u["fonte"]]["texto"][u["inicio"]:u["fim"]] != u["texto"]:
            raise ValueError("Unidade alterada em relação à fonte.")
    return fs, {u["id"]:u for u in doc["unidades"]}


def incertezas(valores):
    aceitas, recusadas = [], []
    if not isinstance(valores, list):
        return [], [{"motivo":"lista_invalida"}]
    for i, v in enumerate(valores):
        if i < 4 and texto(v, 180):
            aceitas.append(v)
        else:
            recusadas.append({"indice":i,"valor":deepcopy(v),"motivo":"incerteza_invalida"})
    return aceitas, recusadas


def validar_ofertas(saida, doc):
    fs, _ = conferir_documento(doc)
    r = {"ofertas":[],"recusadas":[],"incertezas":[],"incertezasRecusadas":[],"perfilConfirmado":False,"revisaoSemantica":"pendente"}
    if not isinstance(saida, dict) or set(saida) != {"ofertas","incertezas"} or not isinstance(saida["ofertas"],list) or len(saida["ofertas"]) > 3:
        return {**r,"erro":"estrutura_invalida"}
    r["incertezas"],r["incertezasRecusadas"] = incertezas(saida["incertezas"])
    nomes = set()
    for i,o in enumerate(saida["ofertas"]):
        erros=[]
        if isinstance(o,dict) and set(o)=={"nomeId","natureza","papel_site","evidencias"}:
            from negocio.proposicoes.nomes import catalogo_nomes
            mapa={x["id"]:x for x in catalogo_nomes(doc)}
            ancora=mapa.get(o["nomeId"]) if isinstance(o["nomeId"],str) else None
            if ancora and isinstance(o["evidencias"],list) and all(isinstance(x,str) for x in o["evidencias"]):
                o={"nomePublicado":ancora["nomePublicado"],"fonteNome":ancora["fonteNome"],"origemNome":ancora["origemNome"],
                   "natureza":o["natureza"],"papel_site":o["papel_site"],"evidencias":list(dict.fromkeys([ancora["fonteNome"],*o["evidencias"]]))}
        if not isinstance(o,dict) or set(o) != {"nomePublicado","fonteNome","origemNome","natureza","papel_site","evidencias"}:
            erros=["oferta_invalida"]
        else:
            refs=o["evidencias"]
            if not isinstance(refs,list) or not 1<=len(refs)<=3 or any(not isinstance(x,str) or x not in fs for x in refs) or len(set(refs))!=len(refs):
                erros.append("referencias_invalidas")
            if o["natureza"] not in NATUREZAS or o["papel_site"] not in PAPEIS:
                erros.append("natureza_papel_invalido")
            f=fs.get(o["fonteNome"]) if isinstance(o["fonteNome"],str) else None
            origem=o["origemNome"]
            publicado = f["texto"] if f and origem=="texto" else " ".join(h["texto"] for h in f.get("contexto",{}).get("titulos",[])) if f and origem=="titulo_secao" else f.get("contexto",{}).get("tituloPagina") or "" if f and origem=="titulo_pagina" else ""
            if not f or not literal(o["nomePublicado"], publicado, 120):
                erros.append("nome_publicado_sem_apoio")
            if f and (f["tipo"]=="interface" or f.get("contexto",{}).get("recortado") is True):
                erros.append("nome_em_interface_ou_recorte")
            if isinstance(refs,list) and o["fonteNome"] not in refs:
                erros.append("fonte_do_nome_nao_citada")
            k=normal(o["nomePublicado"])
            if k in nomes:
                erros.append("oferta_duplicada")
            nomes.add(k)
        if erros:
            r["recusadas"].append({"indice":i,"item":deepcopy(o),"erros":erros})
        else:
            r["ofertas"].append({"nome":o["nomePublicado"],"nomePublicado":o["nomePublicado"],"fonteNome":o["fonteNome"],"origemNome":o["origemNome"],
                "natureza":o["natureza"],"papel_site":o["papel_site"],"evidencias":deepcopy(o["evidencias"]),
                "citacoes":[deepcopy(fs[x]) for x in o["evidencias"]],"revisaoSemantica":"pendente"})
    return r


def validar_proposicoes(saida,doc,oferta):
    fs, us = conferir_documento(doc)
    r={"proposicoes":[],"condicoes":[],"recusadas":[],"incertezas":[],"incertezasRecusadas":[],"revisaoSemantica":"pendente","perfilConfirmado":False}
    if isinstance(saida,dict) and set(saida)=={'proposicoesPorUnidade','condicoes','incertezas'}:
        grupos=saida['proposicoesPorUnidade'];alvos=doc.get('unidadesAlvo',[u['id'] for u in doc['unidades']])
        if not isinstance(grupos,dict) or set(grupos)!=set(alvos) or len(grupos)>6:
            return {**r,'erro':'unidades_agrupadas_invalidas'}
        lista=[]
        for uid,p in grupos.items():
            if p is None:continue
            if not isinstance(p,dict) or set(p)!={'sujeito','tipoSujeito','acao','objeto','escopo'}:
                return {**r,'erro':'proposicao_agrupada_invalida'}
            lista.append({'unidade':uid,**p})
        saida={'proposicoes':lista,'condicoes':saida['condicoes'],'incertezas':saida['incertezas']}
    if not isinstance(saida,dict) or set(saida)!={"proposicoes","condicoes","incertezas"} or not isinstance(saida["proposicoes"],list) or len(saida["proposicoes"])>6 or not isinstance(saida["condicoes"],list) or len(saida["condicoes"])>3:
        return {**r,"erro":"estrutura_invalida"}
    r["incertezas"],r["incertezasRecusadas"]=incertezas(saida["incertezas"])
    for i,p in enumerate(saida["proposicoes"]):
        erros=[]
        origem_relacao="modelo"
        if isinstance(p,dict) and set(p)=={"unidade","sujeito","tipoSujeito","acao","objeto","escopo"} and isinstance(p["acao"],str):
            from negocio.proposicoes.verbos import classificar
            p={**p,"relacao":classificar(p["acao"])}
            origem_relacao="regra_verbo_literal"
        if not isinstance(p,dict) or set(p)!={"unidade","sujeito","tipoSujeito","relacao","acao","objeto","escopo"}:
            erros=["proposicao_invalida"]
        else:
            u=us.get(p["unidade"]) if isinstance(p["unidade"],str) else None
            if not u:
                erros.append("unidade_inexistente")
            if doc.get("unidadesAlvo") is not None and p["unidade"] not in doc["unidadesAlvo"]:
                erros.append("unidade_fora_dos_alvos")
            for campo,limite in (("sujeito",120),("acao",160),("objeto",180)):
                if not u or not literal(p[campo],u["texto"],limite):
                    erros.append(campo+"_fora_da_mesma_unidade")
            if p["tipoSujeito"] not in TIPOS_SUJEITO or p["relacao"] not in RELACOES or p["escopo"] not in ESCOPOS:
                erros.append("tipo_relacao_escopo_invalido")
        if erros:
            r["recusadas"].append({"campo":"proposicoes","indice":i,"item":deepcopy(p),"erros":erros})
            continue
        f=fs[u["fonte"]]
        r["proposicoes"].append({**deepcopy(p),"relacaoOrigem":origem_relacao,"id":"p"+str(len(r["proposicoes"])+1).zfill(2),"unidadeLiteral":deepcopy(u),
            "evidencias":[f["id"]],"citacoes":[deepcopy(f)],"natureza":"interpretacao_publicacao","revisaoSemantica":"pendente"})
    for i,c in enumerate(saida["condicoes"]):
        erros=[]
        if not isinstance(c,dict) or set(c)!={"unidade","categoria","aplicaA","alcance"}:
            erros=["condicao_invalida"]
        else:
            u=us.get(c["unidade"]) if isinstance(c["unidade"],str) else None
            if not u:
                erros.append("unidade_inexistente")
            if doc.get("unidadesAlvo") is not None and c["unidade"] not in doc["unidadesAlvo"]:
                erros.append("unidade_fora_dos_alvos")
            if c["categoria"] not in CONDICOES or c["alcance"] not in ALCANCES:
                erros.append("categoria_alcance_invalido")
            elif u and not re.search(INDICIOS_CONDICAO[c["categoria"]]+"|"+INDICIOS_EN[c["categoria"]],normal(u["texto"])):
                erros.append("categoria_sem_indicio_literal")
            if c["aplicaA"] is not None and (not u or not literal(c["aplicaA"],u["texto"],120)):
                erros.append("aplicacao_nao_literal")
        if erros:
            r["recusadas"].append({"campo":"condicoes","indice":i,"item":deepcopy(c),"erros":erros})
            continue
        f=fs[u["fonte"]]
        aplicacao="formulario" if c["alcance"]=="formulario" else "esta_atividade" if c["aplicaA"] is not None else "indefinida"
        r["condicoes"].append({**deepcopy(c),"id":"c"+str(len(r["condicoes"])+1).zfill(2),"aplicacao":aplicacao,
            "oferta":oferta["nome"],"evidencia":f["id"],"unidadeLiteral":deepcopy(u),"citacoes":[deepcopy(f)],"revisaoSemantica":"pendente"})
    return r


def projetar_jornada(val,oferta):
    campos=("compradores","executores","beneficiarios","pagadores")
    j={c:[] for c in campos};vistos={c:{} for c in campos}
    j.update(proposicoes=deepcopy(val["proposicoes"]),condicoes=deepcopy(val["condicoes"]),
             fornecimento=[],operacoesAutomatizadas=[],transacoesDoCliente=[],naoProjetadas=[],
             incertezas=deepcopy(val["incertezas"]),recusadas=deepcopy(val["recusadas"]),perfilConfirmado=False,revisaoSemantica="pendente")
    def adicionar(campo,p,grupo=None,natureza="relacao_publicada"):
        g=grupo or p["sujeito"]
        chave=(normal(g),normal(p["acao"]),normal(p["objeto"]),p["escopo"],natureza)
        if chave in vistos[campo]:
            return
        item={"grupo":g,"atividade":p["acao"]+" "+p["objeto"],"acao":p["acao"],"objeto":p["objeto"],
              "escopo":p["escopo"],"natureza":natureza,"proposicoes":[p["id"]],"evidencias":deepcopy(p["evidencias"]),
              "citacoes":deepcopy(p["citacoes"]),"revisaoSemantica":"pendente"}
        j[campo].append(item);vistos[campo][chave]=item
    for p in val["proposicoes"]:
        rel,tipo,esc=p["relacao"],p["tipoSujeito"],p["escopo"]
        if esc=="transacao_do_cliente":
            j["transacoesDoCliente"].append(deepcopy(p));continue
        if tipo=="ferramenta" and rel!="destina_se_a":
            j["operacoesAutomatizadas"].append(deepcopy(p));continue
        if esc=="fornecimento" or rel in ("desenvolve","disponibiliza"):
            j["fornecimento"].append(deepcopy(p))
            if rel!="destina_se_a":
                continue
        if rel=="destina_se_a":
            adicionar("compradores",p,p["objeto"],"publico_potencial")
            adicionar("beneficiarios",p,p["objeto"],"publico_potencial")
        elif tipo=="indefinido" or esc=="indefinido":
            j["naoProjetadas"].append(deepcopy(p))
        elif rel=="executa":
            adicionar("executores",p)
        elif rel in ("utiliza","recebe"):
            adicionar("beneficiarios",p)
        elif rel in ("solicita","contrata") and esc in ("contratacao_da_oferta","implementacao","uso"):
            adicionar("compradores",p)
        elif rel=="paga" and esc=="contratacao_da_oferta":
            adicionar("pagadores",p)
        else:
            j["naoProjetadas"].append(deepcopy(p))
    j["faltam"]=[{"campo":c,"estado":"nao_identificado_no_recorte","limite":"Ausência de relação publicada nesta seleção não prova ausência no negócio."} for c in campos if not j[c]]
    j["limite"]="Papéis são apresentados com atividade e escopo. Apoio literal não certifica semântica, operação real ou pagamento; nenhuma confirmação automática."
    return j
