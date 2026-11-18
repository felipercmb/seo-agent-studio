"""Catálogo genérico de expressões publicadas; não usa domínio ou referência."""
import re
from negocio.proposicoes.contrato import normal


def catalogo_nomes(doc,maximo=64):
    nomes=[];vistos=set()
    def incluir(nome,f,origem):
        nome=nome.strip()
        if not 3<=len(nome)<=120 or normal(nome) in vistos or nome.endswith('?'):
            return
        if len(nomes)>=maximo:return
        vistos.add(normal(nome));nomes.append({"id":"n"+str(len(nomes)+1).zfill(3),"nomePublicado":nome,"fonteNome":f["id"],"origemNome":origem})
    fontes=[f for f in doc["fontes"] if f["tipo"]!='interface' and not f.get('contexto',{}).get('recortado')]
    for f in fontes:
        c=f.get("contexto",{})
        for t,origem in [(c.get('tituloPagina'),"titulo_pagina"),*[(h['texto'],"titulo_secao") for h in c.get('titulos',[])]]:
            if not isinstance(t,str):continue
            principal=re.split(r"\s+[|—–]\s+|:\s+|\s+-\s+",t)[0]
            m=re.match(r"(?i)^(?:o que [ée]|por qu[eê](?: o| a)?|conheça(?: o| a)?)\s+(.+?)[?]?$",principal)
            if m:principal=m[1]
            incluir(principal,f,origem)
    fontes_com_unidade={u['fonte'] for u in doc['unidades']}
    for f in fontes:
        if f['id'] not in fontes_com_unidade:continue
        t=f['texto']
        m=re.match(r"^(.{3,70}?)\s+(?:[ée]|são|oferece|oferecemos)\s",t)
        if m:incluir(m[1],f,"texto")
        for m in re.finditer(r"\b[A-ZÀ-Ý][\wÀ-ÿ-]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ-]+){1,3}",t):
            incluir(m[0],f,"texto")
        for m in re.finditer(r"\b(?:plataforma|software|sistema|serviço|emissor|curso|produto)\s+(?:de |para )?[^.!?:;]{3,75}",t,re.I):
            candidato=re.split(r",|\s+(?:que|é|permite|oferece|com)\s",m[0],maxsplit=1)[0]
            incluir(candidato,f,"texto")
    return nomes
