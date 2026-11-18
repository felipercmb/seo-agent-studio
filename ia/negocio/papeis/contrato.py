from copy import deepcopy
import re
from negocio.quadros.contrato import conferir_entrada as conferir_quadro,TIPOS,ESCOPOS
from negocio.proposicoes.contrato import literal,normal

def conferir_entrada(e):
    if not isinstance(e,dict) or set(e)!={'versao','tarefa','documento','unidade','oferta','quadroProposto'} or e.get('tarefa')!='relacao':raise ValueError('Entrada de papéis inválida.')
    u,f=conferir_quadro({k:v for k,v in e.items() if k!='quadroProposto'})
    p=e['quadroProposto']
    if not isinstance(p,dict) or set(p)!={'estrutura','ator','acao','objeto','marcadorNominal'} or p['estrutura'] not in ('verbal','responsabilidade_nominal','atribuicao_nominal','posse_nominal'):raise ValueError('Quadro proposto incompatível.')
    for k,n in [('ator',180),('objeto',180)]:
        if not literal(p[k],u['texto'],n):raise ValueError('O quadro proposto deve preservar '+k+' literal na unidade.')
    if p['estrutura']=='verbal':
        if not literal(p['acao'],u['texto'],100) or p['marcadorNominal'] is not None:raise ValueError('Ação ou marcador incompatível com proposta verbal.')
    elif p['acao'] is not None or not literal(p['marcadorNominal'],u['texto'],120):raise ValueError('Proposta nominal precisa de marcador literal sem verbo fabricado.')
    return u,f

def validar_saida(s,e):
    u,f=conferir_entrada(e)
    if not isinstance(s,dict) or set(s)!={'estrutura','tipoAtor','escopo','negada'}:return ['saida_categorica_invalida']
    if s['estrutura'] not in ('relacao_publicada','sem_relacao') or s['tipoAtor'] not in TIPOS or s['escopo'] not in ESCOPOS or type(s['negada']) is not bool:return ['categorias_invalidas']
    if s['estrutura']=='sem_relacao' and (s['tipoAtor']!='indefinido' or s['escopo']!='indefinido' or s['negada']):return ['abstencao_com_papel_preenchido']
    if s['negada'] and not re.search(r'\b(?:não|nao|nem|nunca|sem)\b',normal(u['texto'])):return ['negacao_sem_apoio']
    return []

def projetar(s,e):
    errors=validar_saida(s,e);u,f=conferir_entrada(e);active=not errors and s['estrutura']=='relacao_publicada'
    return {'versao':1,'estado':'recusada' if errors else 'interpretacao_pendente','quadroOriginal':deepcopy(e['quadroProposto']),'quadroClassificado':{**deepcopy(e['quadroProposto']),**{k:s[k] for k in ['tipoAtor','escopo','negada']}} if active else None,'erros':errors,'unidadeLiteral':deepcopy(u),'citacoes':[deepcopy(f)],'ofertaDeclarada':deepcopy(e['oferta']),'perfilConfirmado':False,'revisaoSemantica':'pendente','modeloPadraoAlterado':False,'limite':'Classifica uma proposta fornecida; não descobre ofertas ou relações ausentes. Literalidade e classificação local não confirmam a semântica, operação real ou obrigação jurídica.'}
