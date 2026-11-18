"""Preserva diversidade da entrada; usa o pool somente como complemento."""
from copy import deepcopy
import json
import re
from negocio.jornadas.contrato import validar_base
from negocio.jornadas.recuperacao import validar_reserva,chave,normal


def recuperar_atividades(base,oferta,reserva,max_fontes=16,max_caracteres=15000):
    validar_reserva(reserva,base['dominio'])
    ancoras=oferta['citacoes'];chaves_ancora={chave(f) for f in ancoras}
    usadas=[];vistos=set();descartes=[];origens=[]
    def incluir(f,origem):
        k=chave(f)
        if k in vistos:return False
        novo={'id':'s'+str(len(usadas)+1).zfill(2),**{k:deepcopy(f[k]) for k in ('texto','tipo','contexto')}}
        custo=len(json.dumps([*usadas,novo],ensure_ascii=False,separators=(',',':')).encode('utf-16-le'))//2
        if len(usadas)>=max_fontes or custo>max_caracteres:
            descartes.append({'id':f['id'],'motivo':'orcamento_contextual','origem':origem});return False
        usadas.append(novo);vistos.add(k);origens.append({'idOriginal':f['id'],'idSelecionado':novo['id'],'origem':origem});return True
    for f in ancoras:incluir(f,'ancora')
    # Um mesmo texto sob outro título, campo, URL, captura ou hash não é a
    # mesma aplicação. Contenção só pode dedup dentro do MESMO contexto/tipo.
    # Fontes nunca são unidas, truncadas ou reescritas.
    for f in base['fontes']:
        if chave(f) in chaves_ancora:continue
        t=normal(f['texto'])
        maior=next((g for g in base['fontes'] if g['contexto']==f['contexto'] and g['tipo']==f['tipo'] and len(normal(g['texto']))>len(t) and len(t)>=80 and t in normal(g['texto'])),None)
        if maior:
            descartes.append({'id':f['id'],'motivo':'recorte_contido_em_fonte_base','representadaPor':maior['id'],'origem':'base'});continue
        incluir(f,'base')
    nome=set(re.findall(r'\w{4,}',normal(oferta['nome'])))-{'sistema','software','plataforma','servico','gestao'}
    linhas=[]
    for ordem,f in enumerate(reserva or []):
        if f['tipo']=='interface' or f['contexto']['recortado']:continue
        t=normal(f['texto']);palavras=set(re.findall(r'\w+',t))
        ator=bool(re.search(r'\b(?:usuarios?|clientes?|equipes?|operadores?|analistas?|profissionais?|customers?|users?|employees?)\b',t))
        regra=bool(re.search(r'\b(?:exige|requer|somente|apenas|exceto|limite|gratuit\w*|gratis|paga\w*|taxa|prazo|dias|horas|requires?|only|except|free|days)\b',t))
        nota=4*bool(nome&palavras)+3*ator+3*regra-6*(f['contexto']['classePagina'] in ('editorial','politica'))
        linhas.append((nota,ordem,f))
    for nota,_,f in sorted(linhas,key=lambda x:(-x[0],x[1])):
        if nota>0:incluir(f,'pool')
    nova={'versao':1,'dominio':base['dominio'],'fontes':usadas}
    if validar_base(nova):raise ValueError('Recuperação de atividades inválida.')
    ids={chave(f):f['id'] for f in usadas}
    o={k:deepcopy(oferta[k]) for k in ('nome','natureza','papel_site')}
    o['evidencias']=list(dict.fromkeys(ids[chave(f)] for f in ancoras if chave(f) in ids))
    if not o['evidencias']:raise ValueError('Âncora não preservada.')
    return nova,o,{'modo':'base_diversa_pool_complementar','fontes':len(usadas),'candidatasPool':len(reserva or []),'origens':origens,'descartes':descartes,'limite':'Preserva recortes iniciais e fontes completas; complemento textual genérico, sem prova semântica ou cobertura integral.'}
