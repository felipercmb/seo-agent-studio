"""Contrato de relações. Aceitação estrutural nunca é aprovação semântica.

O modelo seleciona IDs de evidência; o programa reproduz texto, página e seção.
Rótulos curtos são interpretações verificáveis contra nomes publicados. Não se
exige que o modelo copie a citação inteira nem se corrige silenciosamente sua saída.
"""
from copy import deepcopy
import re
from urllib.parse import urlsplit
from negocio.contrato import normalizar

PREDICADOS = ('oferece','intermedeia','executa','contrata','paga','recebe',
              'apoia','concede_recursos','capta_recursos')
TEMPOS = ('nao_determinada','historico','declaracao_atual')
CATEGORIAS = ('elegibilidade','limite','preco','prazo','exclusao','canal','outro')
INDICIOS_CONDICAO = {
    'elegibilidade':r'\b(?:somente|apenas|obrigatóri[oa]|requisito|exige|necessári[oa]|precisa|deve|elegível|elegiveis|permitid[oa]|proibid[oa])\b',
    'limite':r'\b(?:até|ate|máximo|maximo|mínimo|minimo|limite|menos de|mais de)\b|\d',
    'preco':r'r\$|\b(?:preço|preco|valor|gratuit[oa]|grátis|gratis|mensalidade|taxa|custo)\b',
    'prazo':r'\b(?:prazo|horas?|dias?|meses?|anos?|semanas?|segunda|terça|quarta|quinta|sexta|sábado|domingo|agendamento|vencimento)\b',
    'exclusao':r'\b(?:não|nao|nunca|exceto|sem|excluíd[oa]|indisponível|proibid[oa])\b',
    'canal':r'\b(?:contato|conosco|whatsapp|telefone|chat|formulário|formulario|e-mail|email|solicite|agende|acesse|fale)\b',
    'outro':r'\b(?:inclui|incluído|incluída|permite|permitem|somente|apenas|exige|depende|precisa|deve|gratuit[oa]|não|nao|pagamento|inscrição|inscricao|cadastro|quando|se)\b',
}


def _texto(v,n):
    return isinstance(v,str) and 0<len(v.strip())<=n and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]',v)


def _normal(v):
    return normalizar(v).casefold()


def validar_entrada(e):
    erros=[]
    if not isinstance(e,dict) or set(e)!={'versao','tarefa','dominio','fontes'} or e.get('versao')!=1 or e.get('tarefa')!='mapear_relacoes':
        return ['entrada_invalida']
    dominio=e['dominio']
    if not isinstance(dominio,str) or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,250}[a-z0-9]',dominio):erros.append('dominio_invalido')
    if not isinstance(e['fontes'],list) or len(e['fontes'])>16:return erros+['fontes_invalidas']
    ids=set();modos=set()
    for f in e['fontes']:
        if not isinstance(f,dict) or set(f) not in ({'id','texto','tipo'},{'id','texto','tipo','contexto'}):
            erros.append('fonte_invalida');continue
        if not isinstance(f['id'],str) or not re.fullmatch(r's\d{2}',f['id']) or f['id'] in ids:erros.append('id_invalido_duplicado')
        else:ids.add(f['id'])
        if not _texto(f['texto'],600) or f['tipo'] not in ('declaracao','descricao','conteudo','interface'):erros.append('texto_tipo_invalido')
        modos.add('contexto' in f)
        if 'contexto' not in f:continue
        c=f['contexto']
        if not isinstance(c,dict) or set(c)!={'paginaId','url','tituloPagina','titulos','campo','coletadoEm','sha256','recortado','classePagina'}:
            erros.append('contexto_invalido');continue
        try:
            u=urlsplit(c['url'])
            if u.scheme!='https' or u.hostname not in (dominio,'www.'+dominio) or u.username or u.password or u.port or u.query or u.fragment:raise ValueError()
        except (ValueError,TypeError,AttributeError):erros.append('url_contexto_invalida')
        if not isinstance(c['paginaId'],str) or not re.fullmatch(r'pag_[a-f0-9]{20}',c['paginaId']):erros.append('pagina_id_invalido')
        if not isinstance(c['sha256'],str) or not re.fullmatch(r'[a-f0-9]{64}',c['sha256']):erros.append('hash_invalido')
        if not isinstance(c['recortado'],bool) or c['classePagina'] not in ('editorial','politica','institucional','nao_determinada'):erros.append('classificacao_contexto_invalida')
        if c['tituloPagina'] is not None and not _texto(c['tituloPagina'],240):erros.append('titulo_pagina_invalido')
        if not _texto(c['campo'],120):erros.append('campo_contexto_invalido')
        from datetime import datetime
        try:
            if datetime.fromisoformat(c['coletadoEm'].replace('Z','+00:00')).tzinfo is None:raise ValueError()
        except (ValueError,TypeError,AttributeError):erros.append('data_contexto_invalida')
        hs=c['titulos']
        if not isinstance(hs,list) or len(hs)>6 or any(not isinstance(h,dict) or set(h)!={'nivel','texto'} or type(h['nivel']) is not int or not 1<=h['nivel']<=6 or not _texto(h['texto'],240) for h in hs):
            erros.append('cabecalhos_invalidos')
        elif any(a['nivel']>=b['nivel'] for a,b in zip(hs,hs[1:])):erros.append('hierarquia_invalida')
    if len(modos)>1:erros.append('contexto_misto')
    return erros


def _refs(item,fontes):
    refs=item.get('evidencias')
    if not isinstance(refs,list) or not 1<=len(refs)<=3 or any(not isinstance(i,str) or i not in fontes for i in refs) or len(set(refs))!=len(refs):
        return [],['referencias_invalidas']
    fs=[fontes[i] for i in refs]
    return fs,(['interface_nao_sustenta_relacao'] if any(f['tipo']=='interface' for f in fs) else [])


def _nome(v,fs,*,site=False,contexto=False):
    if site and v=='$site':return True
    if not _texto(v,120):return False
    textos=[f['texto'] for f in fs]
    if contexto:
        textos.extend(h['texto'] for f in fs for h in f.get('contexto',{}).get('titulos',[]))
    # Whole tokens prevent substring matches like 'ator' in 'contratantes'.
    padrao=r'(?<!\w)'+re.escape(_normal(v))+r'(?!\w)'
    return any(re.search(padrao,_normal(t)) for t in textos)


def _validar_item(item,fs,tipo,dominio):
    erros=[];alertas=[]
    if item['temporalidade'] not in TEMPOS:erros.append('temporalidade_invalida')
    if item['temporalidade']=='declaracao_atual' and any(f.get('contexto',{}).get('classePagina')=='editorial' for f in fs):
        erros.append('vigencia_atual_nao_comprovada_por_editorial')
    paginas={f.get('contexto',{}).get('url') for f in fs}
    if len(paginas)>1:alertas.append('relacao_entre_paginas_exige_revisao')
    if any(f.get('contexto',{}).get('recortado') for f in fs):alertas.append('evidencia_recortada')
    if tipo=='condicao':
        if item['categoria'] not in CATEGORIAS:erros.append('categoria_invalida')
        elif not any(re.search(INDICIOS_CONDICAO[item['categoria']],_normal(f['texto'])) for f in fs):
            erros.append('categoria_sem_indicio_no_segmento')
        if item['aplicacao'] is not None and not _nome(item['aplicacao'],fs,contexto=True):erros.append('aplicacao_sem_apoio_literal')
        if item['aplicacao'] is None:alertas.append('escopo_da_condicao_pendente')
        if len(fs)!=1:erros.append('condicao_exige_um_segmento_continuo')
        return erros,alertas
    if item['predicado'] not in PREDICADOS:erros.append('predicado_invalido')
    if item['polaridade'] not in ('afirma','nega'):erros.append('polaridade_invalida')
    if not _nome(item['sujeito'],fs,site=True):erros.append('sujeito_sem_apoio')
    if not _nome(item['objeto'],fs,site=True):erros.append('objeto_sem_apoio')
    if item['oferta'] is not None and not _nome(item['oferta'],fs,contexto=True):erros.append('oferta_sem_apoio')
    texto=' '.join(_normal(f['texto']) for f in fs)
    # These are scoped evidence tripwires, not a general parser or judge. In
    # particular an imperative inviting the customer to act is not proof that
    # the website company performs that action itself.
    if item['predicado']=='executa' and not re.search(r'\b(?:executa\w*|realiza\w*|presta\w*|fazemos|faz|fazem|desenvolve\w*|opera\w*)\b',texto):
        erros.append('execucao_sem_indicio_no_segmento')
    if item['predicado']=='intermedeia' and not re.search(r'\b(?:intermedi\w*|conect\w*|contrat\w*|profissiona\w*|freelancers?|parceir\w*|prestador\w*|fornecedor\w*)\b',texto):
        erros.append('intermediacao_sem_indicio_no_segmento')
    sujeito_site=item['sujeito']=='$site' or _normal(item['sujeito'])==dominio.removeprefix('www.').split('.')[0]
    if item['predicado']=='contrata' and sujeito_site and not re.search(r'\b(?:contratamos|contrata|contratam|contratou)\b',texto):
        erros.append('convite_ao_cliente_nao_prova_contratacao_pelo_site')
    if item['predicado']=='paga' and sujeito_site and not re.search(r'\b(?:pagamos|paga|pagam|pagou|repassa|repassamos)\b',texto):
        erros.append('pagador_sem_indicio_no_segmento')
    # Narrow, explainable tripwire, NOT a financial semantic judge. Other money
    # relations always remain pending explicit review before use in decisions.
    if item['predicado']=='capta_recursos' and re.search(r'\b(?:destina|destinam|concede|concedem|repassa|repassam)\b',texto) and not re.search(r'\b(?:recebe|recebem|arrecada|arrecadam|capta|captam)\b',texto):
        erros.append('captacao_conflita_com_verbo_de_destinacao')
    if item['predicado'] in ('paga','capta_recursos','concede_recursos'):alertas.append('direcao_financeira_exige_revisao')
    if item['polaridade']=='afirma' and re.search(r'\b(?:não|nao|nunca|exceto|somente|apenas)\b',texto):alertas.append('negacao_ou_restricao_no_segmento')
    if item['oferta'] is None and item['predicado'] in ('contrata','recebe','paga','executa'):alertas.append('oferta_da_relacao_pendente')
    return erros,alertas


def validar_e_renderizar(saida,entrada):
    problemas=validar_entrada(entrada)
    if problemas:raise ValueError('Entrada relacional inválida: '+str(problemas))
    resultado={'versao':1,'estado':'pendente_revisao','perfilConfirmado':False,'erros':[],
               'relacoes':[],'condicoes':[],'recusados':[],'duvidas':[],
               'limite':'Estrutura, citações e guardas específicos não aprovam significado nem uso com clientes.'}
    if not isinstance(saida,dict) or set(saida)!={'estado','relacoes','condicoes','duvidas'}:
        resultado['erros']=['estrutura_raiz_invalida'];return resultado
    if saida['estado'] not in ('hipotese','insuficiente'):resultado['erros'].append('estado_invalido')
    if not isinstance(saida['duvidas'],list) or len(saida['duvidas'])>6 or any(not _texto(v,240) for v in saida['duvidas']):resultado['erros'].append('duvidas_invalidas')
    else:resultado['duvidas']=deepcopy(saida['duvidas'])
    fontes={f['id']:f for f in entrada['fontes']}
    chaves={'relacoes':{'sujeito','predicado','objeto','oferta','polaridade','temporalidade','evidencias'},
            'condicoes':{'aplicacao','categoria','temporalidade','evidencias'}}
    for grupo in chaves:
        itens=saida[grupo]
        if not isinstance(itens,list) or len(itens)>(8 if grupo=='relacoes' else 6):
            resultado['erros'].append(grupo+'_invalidas');continue
        vistos=set()
        for indice,item in enumerate(itens):
            if not isinstance(item,dict) or set(item)!=chaves[grupo]:
                resultado['recusados'].append({'grupo':grupo,'indice':indice,'item':item,'erros':['item_invalido']});continue
            fs,erros=_refs(item,fontes);alertas=[]
            if not erros:
                e,a=_validar_item(item,fs,'condicao' if grupo=='condicoes' else 'relacao',entrada['dominio']);erros+=e;alertas+=a
            identidade=repr(sorted((k,repr(v)) for k,v in item.items()))
            if identidade in vistos:erros.append('item_duplicado')
            vistos.add(identidade)
            if erros:resultado['recusados'].append({'grupo':grupo,'indice':indice,'item':deepcopy(item),'erros':erros});continue
            # Citation text is always supplied by the program from the input.
            resultado[grupo].append({**deepcopy(item),'revisaoSemantica':'pendente','alertas':alertas,
                'citacoes':[deepcopy(f) for f in fs]})
    if saida['estado']=='insuficiente' and (saida['relacoes'] or saida['condicoes']):resultado['erros'].append('abstencao_com_afirmacao')
    if resultado['erros']:
        # A malformed/contradictory envelope must not leak otherwise valid items.
        resultado['relacoes']=[];resultado['condicoes']=[];resultado['estado']='recusada'
    elif not resultado['relacoes'] and not resultado['condicoes']:
        resultado['estado']='insuficiente' if not resultado['recusados'] else 'recusada'
    resultado['contratoIntegralValido']=not resultado['erros'] and not resultado['recusados']
    return resultado
