"""Focos curtos genéricos, com todas as frases vizinhas da fonte preservadas."""
from copy import deepcopy
import re
import unicodedata
from negocio.proposicoes.unidades import digest


def normal(v):return unicodedata.normalize('NFD',v).encode('ascii','ignore').decode().lower()


def lotes_proposicoes(doc,max_lotes=2,alvos_por_lote=3,oferta=None):
    fs={f['id']:f for f in doc['fontes']}
    # O nome foi escolhido do catálogo literal; não é um alvo de avaliação.
    # Palavras de classe não devem dar vantagem a todas as frases do corpus.
    genericos={'sistema','software','plataforma','servico','servicos','produto','gestao','de','da','do','the','and','for','service','system'}
    nome={x for x in re.findall(r'\w+',normal((oferta or {}).get('nome',''))) if len(x)>3 and x not in genericos}
    linhas=[]
    for ordem,u in enumerate(doc['unidades']):
        t=normal(u['texto'])
        ator=bool(re.search(r'\b(?:usuarios?|clientes?|equipes?|empresas?|operadores?|analistas?|pessoas?|profissionais?|contratantes?|prestadores?|comerciantes?|intermediador|sdrs?|voce|nosso time|nossa equipe|users?|customers?|employees?|you)\b',t))
        ferramenta=bool(re.search(r'\b(?:software|sistema|plataforma|ferramenta|intermediador|system|platform|tool)\b',t))
        acao=bool(re.search(r'\b(?:execut\w*|realiz\w*|configur\w*|utiliz\w*|usam?|paga\w*|receb\w*|process\w*|liquid\w*|implement\w*|emite\w*|prospect\w*|organiza\w*|notifica\w*|acessa\w*|registra\w*|monta\w*|ajuda\w*|converte\w*|prioriza\w*|dispara\w*|oferece\w*|intermedia\w*|fornece\w*|integra\w*|feita|feitos|pelos?|perform\w*|uses?|pays?|processes|organizes|provides|configures)\b',t))
        cond=bool(re.search(r'\b(?:exige|requer|obrigator\w*|somente|apenas|exceto|ate|limite|maximo|minimo|gratis|gratuito|custa|cartao|requires?|only|except|free|cost|card)\b|\b\d+\s+(?:dias?|horas?|days?|hours?)\b',t))
        mkt=bool(re.search(r'\b(?:especialistas entrarao|fale com|entre em contato|nossos resultados|depoimento|mais rapido|melhor|imperdivel)\b',t))
        menciona=bool(nome & set(re.findall(r'\w+',t)))
        pergunta=bool(re.search(r'\b(?:precisa saber|tire suas duvidas|tudo o que.*saber|o que e|what is|need to know)\b',t)) and not acao
        fonte=normal(fs[u['fonte']]['texto'])
        contraste=bool(re.search(r'\b(?:em vez de|diferente de|nao combina|nesse formato|quem .{0,70}sabe|instead of|unlike)\b',fonte)) and not menciona
        nota=5*ator+5*acao+4*ferramenta+5*menciona+3*cond-6*mkt-9*pergunta-10*contraste
        linhas.append((nota,ordem,u,ator and acao,cond,ferramenta and acao))
    linhas.sort(key=lambda x:(-x[0],x[1]));selecionadas=[];ids=set();textos=set();por_fonte={}
    def add(l):
        literal=normal(l[2]['texto']).strip()
        if l[2]['id'] in ids or literal in textos or len(selecionadas)>=max_lotes*alvos_por_lote:return False
        ids.add(l[2]['id']);textos.add(literal);selecionadas.append(l);por_fonte[l[2]['fonte']]=por_fonte.get(l[2]['fonte'],0)+1
        return True
    for classe,limite in ((5,2),(3,2),(4,2)):
        n=0
        for l in linhas:
            if l[classe] and l[0]>0 and add(l):n+=1
            if n>=limite:break
    for l in sorted(linhas,key=lambda x:(por_fonte.get(x[2]['fonte'],0),-x[0],x[1])):
        if l[0]>0:add(l)
    if not selecionadas and linhas:add(linhas[0])
    lotes=[]
    for inicio in range(0,len(selecionadas),alvos_por_lote):
        alvos=selecionadas[inicio:inicio+alvos_por_lote]
        fontes={x[2]['fonte'] for x in alvos}
        lote={**deepcopy(doc),'fontes':[deepcopy(f) for f in doc['fontes'] if f['id'] in fontes],
              'unidades':[deepcopy(u) for u in doc['unidades'] if u['fonte'] in fontes],
              'unidadesAlvo':[x[2]['id'] for x in alvos]}
        lote['origemEntradaSha256']=doc['entradaSha256']
        lote['entradaSha256']=digest({'versao':1,'dominio':doc['dominio'],'fontes':lote['fontes']})
        lotes.append(lote)
    return lotes,{'maxLotes':max_lotes,'alvosPorLote':alvos_por_lote,'unidadesAlvo':[x[2]['id'] for x in selecionadas],
                  'unidadesNaoAlvo':[u['id'] for u in doc['unidades'] if u['id'] not in ids],
                  'limite':'Seleção textual genérica; frases vizinhas da mesma fonte seguem visíveis. Não prova relevância semântica nem cobertura completa.'}
