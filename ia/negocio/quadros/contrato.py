"""C14: contrato extrativo; preserva relações nominais sem inventar um verbo.

Validade literal não equivale a confirmação semântica ou negócio real.
"""
import re
from copy import deepcopy
from negocio.proposicoes.contrato import conferir_documento, literal, normal

TIPOS=['fornecedor','usuario','terceiro','ferramenta','indefinido']
ESCOPOS=['fornecimento','prestacao_da_oferta','implementacao','uso','servico_do_cliente','transacao_do_cliente','contratacao_da_oferta','indefinido']
CATEGORIAS=['nenhuma','elegibilidade','limite','preco','prazo','exclusao','canal','outro']
ALCANCES=['oferta','atividade','formulario','proposta_comercial','suporte','transacao_do_cliente','indefinido']

def conferir_entrada(e):
    if not isinstance(e,dict) or set(e)!={'versao','tarefa','documento','unidade','oferta'} or e['versao']!=1 or e['tarefa'] not in ('relacao','condicao'):
        raise ValueError('Entrada de quadro inválida.')
    fs,us=conferir_documento(e['documento'])
    u=us.get(e['unidade'])
    o=e['oferta']
    if not u or not isinstance(o,dict) or set(o)!={'nome','natureza','papel_site'} or not isinstance(o['nome'],str) or not 1<=len(o['nome'])<=120:
        raise ValueError('Unidade ou oferta ausente.')
    if o['natureza'] not in ('software','servico','produto','programa_social','indefinido') or o['papel_site'] not in ('disponibiliza','executa','vende','intermedeia','indefinido'):
        raise ValueError('Perfil de oferta inválido.')
    if len(u['texto'])>1800:
        raise ValueError('Unidade excede orçamento; nenhum trecho será cortado.')
    f=fs[u['fonte']]
    if f['tipo']=='interface' or f.get('contexto',{}).get('recortado') is True:
        raise ValueError('A fonte é interface ou recorte incompleto.')
    return u,f

def titulos(f):
    c=f.get('contexto',{})
    return [h['texto'] for h in c.get('titulos',[]) if isinstance(h,dict) and isinstance(h.get('texto'),str)]

def validar_saida(s,e):
    u,f=conferir_entrada(e);erros=[]
    if e['tarefa']=='relacao':
        campos={'estrutura','ator','acao','objeto','tipoAtor','escopo','negada'}
        if not isinstance(s,dict) or set(s)!=campos:return ['estrutura_relacao_invalida']
        if s['estrutura'] not in ('verbal','responsabilidade_nominal','sem_relacao') or s['tipoAtor'] not in TIPOS or s['escopo'] not in ESCOPOS or type(s['negada']) is not bool:
            return ['categorias_relacao_invalidas']
        if s['estrutura']=='sem_relacao':
            if any(s[k] is not None for k in ('ator','acao','objeto')) or s['tipoAtor']!='indefinido' or s['escopo']!='indefinido' or s['negada']:
                erros.append('abstencao_com_relacao_preenchida')
            return erros
        for k,n in [('ator',120),('objeto',180)]:
            if not literal(s[k],u['texto'],n):erros.append(k+'_nao_literal')
        if s['estrutura']=='verbal':
            if not literal(s['acao'],u['texto'],100):erros.append('acao_nao_literal')
            # High precision diagnostic for the failure seen in held-out pages.
            # It does not attempt to parse all Portuguese word orders.
            if isinstance(s['acao'],str) and re.match(r'^(?:conecte|contrate|solicite|descubra|acesse|oferecemos|somos|temos|reunimos)\b',normal(u['texto'])) and normal(u['texto']).startswith(normal(s['acao'])):
                erros.append('ator_nao_publicado_em_imperativo_ou_primeira_pessoa')
        else:
            if s['acao'] is not None:erros.append('verbo_inventado_para_responsabilidade_nominal')
            if not re.search(r'responsab(?:ilidade|ilidades|ilize|iliza|ilizado|ilizada|ilizados|ilizadas)|respons[aá]ve(?:l|is)',normal(u['texto'])):
                erros.append('responsabilidade_sem_marcador')
        if s['negada'] and not re.search(r'\b(?:não|nao|nunca|nem)\b',normal(u['texto'])):erros.append('negacao_sem_apoio')
    else:
        campos={'categoria','aplicaA','origemAplicacao','gatilho','modalidade','alcance'}
        if not isinstance(s,dict) or set(s)!=campos:return ['estrutura_condicao_invalida']
        if s['categoria'] not in CATEGORIAS or s['origemAplicacao'] not in ('unidade','titulo','indefinida') or s['alcance'] not in ALCANCES:return ['categorias_condicao_invalidas']
        if s['categoria']=='nenhuma':
            if any(s[k] is not None for k in ('aplicaA','gatilho','modalidade')) or s['origemAplicacao']!='indefinida' or s['alcance']!='indefinido':erros.append('abstencao_com_condicao_preenchida')
            return erros
        if s['origemAplicacao']=='unidade':
            if not literal(s['aplicaA'],u['texto'],120):erros.append('aplicacao_fora_da_unidade')
        elif s['origemAplicacao']=='titulo':
            if not any(literal(s['aplicaA'],t,120) for t in titulos(f)):erros.append('aplicacao_fora_do_titulo')
        elif s['aplicaA'] is not None:erros.append('aplicacao_sem_origem')
        for k,n in [('gatilho',240),('modalidade',120)]:
            if s[k] is not None and not literal(s[k],u['texto'],n):erros.append(k+'_nao_literal')
    return erros

def projetar(s,e):
    erros=validar_saida(s,e);u,f=conferir_entrada(e)
    return {'versao':1,'estado':'recusada' if erros else 'interpretacao_pendente','tarefa':e['tarefa'],
        'quadro':None if erros else deepcopy(s),'erros':erros,'unidadeLiteral':deepcopy(u),'citacoes':[deepcopy(f)],
        'ofertaDeclarada':deepcopy(e['oferta']),'perfilConfirmado':False,'revisaoSemantica':'pendente',
        'limite':'Campos extrativos e frase integral para revisão; não confirma papéis, validade da condição, oferta efetiva ou resultado comercial.'}
