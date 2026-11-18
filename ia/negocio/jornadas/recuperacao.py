"""Recuperação local por oferta, sem alvos, rótulos ou nomes empresariais fixos."""
from copy import deepcopy
import json,re,unicodedata
from negocio.jornadas.contrato import validar_base

PRAZO_PUBLICADO = re.compile(
    r'\b(?:reembolso|cancelamento|antecedencia|(?:em )?ate \d+ (?:dias|horas)|'
    r'(?:apos|depois de|assim que).{3,90}(?:prazo|cobranca|dias|horas)|'
    r'cobranca de|taxa por|sujeit[oa] (?:a|ao)|desde que|somente (?:para|apos)|'
    r'after .{3,90} within|refund|cancellation)\b'
)
RELACAO_PUBLICADA = re.compile(
    r'\b(?:e responsavel por|sao responsaveis por|cabe a|compete a|'
    r'e quem|sao quem|conecta .{3,90} (?:ao?s?|com)|'
    r'permite .{3,90} (?:solicitar|aprovar|configurar)|is responsible for)\b'
)

def normal(v):return ' '.join(unicodedata.normalize('NFKD',v).encode('ascii','ignore').decode().lower().split())
def chave(f):return json.dumps({k:f[k] for k in ('texto','tipo','contexto')},ensure_ascii=False,sort_keys=True,separators=(',',':'))

def validar_reserva(reserva,dominio):
    if reserva is None:return []
    if not isinstance(reserva,list) or len(reserva)>640:raise ValueError('Reserva excede640fontes.')
    ids=set()
    for f in reserva:
        if not isinstance(f,dict) or set(f)!={'id','texto','tipo','contexto'} or not isinstance(f['id'],str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{1,159}',f['id']) or f['id'] in ids:
            raise ValueError('Fonte de reserva inválida/repetida.')
        ids.add(f['id'])
        if validar_base({'versao':1,'dominio':dominio,'fontes':[{**f,'id':'s01'}]}):raise ValueError('Contexto de reserva inválido.')
    return reserva

def recuperar_jornada(base,oferta,reserva,*,max_fontes=16,max_caracteres=15000):
    validar_reserva(reserva,base['dominio'])
    if not reserva:return deepcopy(base),{k:deepcopy(oferta[k]) for k in ('nome','natureza','papel_site','evidencias')},{'fontes':len(base['fontes']),'modo':'base_sem_reserva'}
    nome=normal(oferta['nome']);palavras=set(re.findall(r'[a-z0-9]{3,}',nome))-{'para','uma','com','dos','das','the','and','for'}
    ancoras=oferta['citacoes'];usadas=[];vistos=set();duplicados=set();descartes=[]
    if not nome:raise ValueError('A oferta precisa de um nome para recuperar evidências.')
    frase=re.compile(r'(?<![a-z0-9_+#])'+re.escape(nome)+r'(?![a-z0-9_+#])')
    def documento(f):
        c=f['contexto']
        return c['url'],c['sha256']
    mesmas_paginas={documento(f) for f in ancoras}
    def incluir(f,ancora=False):
        k=chave(f)
        if k in vistos:return False
        t=normal(f['texto']);hs=' '.join(normal(h['texto']) for h in f['contexto']['titulos'])
        sem_repeticao=json.dumps([t,hs,f['contexto']['classePagina']])
        if not ancora and sem_repeticao in duplicados:return False
        novo={k:deepcopy(f[k]) for k in ('texto','tipo','contexto')};novo={'id':'s'+str(len(usadas)+1).zfill(2),**novo}
        custo=len(json.dumps([*usadas,novo],ensure_ascii=False,separators=(',',':')).encode('utf-16-le'))//2
        if len(usadas)>=max_fontes or custo>max_caracteres:
            descartes.append({'id':f['id'],'motivo':'orcamento_contextual'});return False
        usadas.append(novo);vistos.add(k);duplicados.add(sem_repeticao);return True
    for f in ancoras:incluir(f,True)
    linhas=[]
    for ordem,f in enumerate(reserva):
        if f['tipo']=='interface' or f['contexto']['recortado']:continue
        t=normal(f['texto']);h=' '.join(normal(x['texto']) for x in f['contexto']['titulos'])
        if f['contexto']['campo']=='jsonld.Question.name':continue
        exato=bool(frase.search(t) or frase.search(h))
        mesmo_documento=documento(f) in mesmas_paginas
        comuns=len(palavras&set(re.findall(r'[a-z0-9]{3,}',t+' '+h)))
        ator=bool(re.search(r'\b(?:clientes?|empresas?|usuarios?|signatarios?|profissionais|contratantes?|prestadores?|colaboradores?|funcionarios?|pessoas?|customers?|users?|employees?|professionals?|freelancers?)\b',t))
        regra=bool(re.search(r'\b(?:inclui|exige|somente|apenas|limite|gratuit|gratis|paga|cobrad|taxa|prazo|dias|horas|users|documents|only|requires|free|fee|not|days)\w*\b|\d',t))
        definicao=bool(re.search(r'\b(?:diferenca|nao e|significa|e quem|sao quem|means|is the|who|rather than|unlike)\b',t))
        nota=10*exato+3*comuns+5*ator+5*regra+4*definicao+8*mesmo_documento
        if f['contexto']['classePagina']=='editorial':nota-=10
        if f['contexto']['classePagina']=='politica':nota-=5
        if len(t.split())<5:nota-=10
        linhas.append((nota,ordem,f,ator,regra))
    linhas.sort(key=lambda l:(-l[0],l[1]))
    # Reserve space for complementary actor and condition statements, then fill
    # by relevance. Sources stay intact and have their full metadata.
    for classe in (3,4):
        n=0
        for l in linhas:
            if l[classe] and l[0]>=4 and incluir(l[2]):n+=1
            if n>=4:break
    # Complement the offer's direct context with complete, already selected
    # publications. Their presence does not prove that their scope is shared.
    complementares=[]
    for sinal in (PRAZO_PUBLICADO, RELACAO_PUBLICADA):
        n=0
        for f in base['fontes']:
            if len(complementares)>=max_fontes//4 or n>=2:
                break
            ctx=f.get('contexto')
            corpo=normal(f['texto'])
            if not ctx or f['tipo']=='interface' or ctx['recortado'] or ctx['classePagina']=='editorial' or ctx['campo']=='jsonld.Question.name':
                continue
            if not corpo.endswith('?') and sinal.search(corpo) and incluir(f):
                complementares.append(usadas[-1]['id'])
                n+=1
    for nota,_,f,_,_ in linhas:
        if nota>=4:incluir(f)
    nova={'versao':1,'dominio':base['dominio'],'fontes':usadas}
    if validar_base(nova):raise ValueError('Recuperação produziu contexto inválido.')
    ids={chave(f):f['id'] for f in usadas}
    o={k:deepcopy(oferta[k]) for k in ('nome','natureza','papel_site')}
    o['evidencias']=list(dict.fromkeys(ids[chave(f)] for f in ancoras if chave(f) in ids))
    if not o['evidencias']:raise ValueError('Âncora da oferta não cabe no contexto de jornada.')
    if complementares:o['fontesComEscopoAberto']=complementares
    return nova,o,{'modo':'reserva_por_oferta','fontes':len(usadas),'candidatas':len(reserva),
                  'fontesComplementares':len(complementares),'idsComEscopoAberto':complementares,'descartes':descartes,
                  'limite':'Relevância textual e página da âncora orientam a seleção. O vínculo de cada trecho continua em revisão. Perdas por orçamento ficam registradas.'}
