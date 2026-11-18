from copy import deepcopy
import re
from negocio.relacoes.contrato import validar_entrada as validar_fontes,_nome,_normal

TIPOS=('software','servico','produto','programa_social','indefinido')
PAPEIS=('disponibiliza','executa','vende','intermedeia','indefinido')
ATORES=('compradores','executores','beneficiarios','pagadores')
CATEGORIAS=('elegibilidade','limite','preco','prazo','exclusao','canal','outro')
INDICIOS_EN={
    'elegibilidade':r'\b(?:only|must|required|requires|eligible|allowed|permitted)\b',
    'limite':r'\b(?:up to|maximum|minimum|limit|more than|less than)\b|\d',
    'preco':r'\b(?:price|cost|fee|free|paid|payment)\b|\$|€',
    'prazo':r'\b(?:days?|hours?|months?|years?|weeks?|deadline|monday|friday)\b',
    'exclusao':r'\b(?:not|never|except|without|excluded|unavailable)\b',
    'canal':r'\b(?:contact|email|chat|phone|form|request|schedule)\b',
    'outro':r'\b(?:includes?|requires?|depends|must|free|not|payment|register|when|if)\b',
}


def validar_base(base):
    if not isinstance(base,dict) or set(base)!={'versao','dominio','fontes'}:return ['base_invalida']
    return validar_fontes({**base,'tarefa':'mapear_relacoes'})


def _refs(ids,base,maximo=3):
    fs={f['id']:f for f in base['fontes']}
    if not isinstance(ids,list) or not 1<=len(ids)<=maximo or any(not isinstance(i,str) or i not in fs for i in ids) or len(set(ids))!=len(ids):return [],['fontes_invalidas']
    escolhidas=[fs[i] for i in ids]
    return escolhidas,(['interface_nao_prova_fato'] if any(f['tipo']=='interface' for f in escolhidas) else [])


def _duvidas(v):
    return isinstance(v,list) and len(v)<=6 and all(isinstance(x,str) and 0<len(x)<=240 for x in v)


def validar_ofertas(saida,base):
    erros=validar_base(base)
    if erros:raise ValueError(str(erros))
    r={'ofertas':[],'recusadas':[],'duvidas':[],'revisaoSemantica':'pendente','perfilConfirmado':False}
    if not isinstance(saida,dict) or set(saida)!={'ofertas','duvidas'} or not isinstance(saida['ofertas'],list) or len(saida['ofertas'])>3 or not _duvidas(saida['duvidas']):
        r['erro']='estrutura_invalida';return r
    r['duvidas']=deepcopy(saida['duvidas']);nomes=set()
    for i,o in enumerate(saida['ofertas']):
        e=[];fs=[]
        if not isinstance(o,dict) or set(o)!={'nome','natureza','papel_site','evidencias'}:e=['oferta_invalida']
        else:
            fs,e=_refs(o['evidencias'],base)
            if o['natureza'] not in TIPOS or o['papel_site'] not in PAPEIS:e.append('tipo_papel_invalido')
            if not _nome(o['nome'],fs,contexto=True):e.append('nome_sem_apoio')
            chave=_normal(o['nome'])
            if chave in nomes:e.append('oferta_duplicada')
            nomes.add(chave)
            if o['natureza']=='software' and o['papel_site']=='executa':e.append('software_disponibilizado_nao_prova_execucao_da_atividade_do_usuario')
        if e:r['recusadas'].append({'indice':i,'item':o,'erros':e})
        else:r['ofertas'].append({**deepcopy(o),'citacoes':deepcopy(fs),'revisaoSemantica':'pendente'})
    return r


def validar_jornada(saida,base,oferta):
    if validar_base(base):raise ValueError('Base inválida.')
    r={k:[] for k in ATORES};r.update(condicoes=[],recusados=[],duvidas=[],revisaoSemantica='pendente',perfilConfirmado=False)
    if not isinstance(saida,dict) or set(saida)!=set(ATORES)|{'condicoes','duvidas'} or not _duvidas(saida.get('duvidas')):
        r['erro']='estrutura_invalida';return r
    r['duvidas']=deepcopy(saida['duvidas'])
    fontes_em_aberto=set(oferta.get('fontesComEscopoAberto',()))
    for campo in ATORES:
        if not isinstance(saida[campo],list) or len(saida[campo])>2:r['erro']='atores_invalidos';continue
        for i,a in enumerate(saida[campo]):
            if not isinstance(a,dict) or set(a)!={'grupo','evidencias'}:
                r['recusados'].append({'campo':campo,'indice':i,'erros':['ator_invalido']});continue
            fs,e=_refs(a['evidencias'],base)
            if not _nome(a['grupo'],fs,site=True):e.append('grupo_sem_apoio')
            elif fontes_em_aberto:
                fontes_do_grupo=[f for f in fs if _nome(a['grupo'],[f],site=True)]
                if all(f['id'] in fontes_em_aberto for f in fontes_do_grupo) and not _nome(oferta['nome'],fontes_do_grupo,contexto=True):
                    e.append('grupo_publicado_com_escopo_a_confirmar')
            if _normal(a['grupo'])==_normal(oferta['nome']) and a['grupo']!='$site':
                e.append('nome_da_oferta_nao_identifica_ator')
            if re.fullmatch(r'(?:software|sistema|plataforma|produto|serviço|servico|veículo|veiculo|plano|modalidade)(?:\s.*)?',_normal(a['grupo'])):
                e.append('item_ou_modalidade_nao_e_ator')
            t=' '.join(_normal(f['texto']) for f in fs)
            if campo=='pagadores' and not re.search(r'\b(?:paga\w*|pagamento|pay\w*|paid|fee|taxa\w*|custo\w*)\b',t):e.append('pagador_nao_publicado')
            if campo=='executores' and a['grupo']=='$site' and oferta['papel_site']=='intermedeia':e.append('intermediacao_nao_prova_execucao_propria')
            if campo=='beneficiarios' and a['grupo']=='$site' and not re.search(r'\b(?:receb\w*|benefici\w*|utiliza\w*|usamos|receive\w*|uses)\b',t):e.append('beneficiario_proprio_sem_apoio')
            if e:r['recusados'].append({'campo':campo,'indice':i,'item':a,'erros':e})
            else:r[campo].append({**deepcopy(a),'citacoes':deepcopy(fs),'revisaoSemantica':'pendente'})
    if not isinstance(saida['condicoes'],list) or len(saida['condicoes'])>4:r['erro']='condicoes_invalidas'
    else:
        from negocio.relacoes.contrato import INDICIOS_CONDICAO
        for i,c in enumerate(saida['condicoes']):
            if not isinstance(c,dict) or set(c)!={'categoria','evidencia','aplicacao'}:
                r['recusados'].append({'campo':'condicoes','indice':i,'erros':['condicao_invalida']});continue
            fs,e=_refs([c['evidencia']],base,1)
            if c['categoria'] not in CATEGORIAS or c['aplicacao'] not in ('esta_oferta','formulario','indefinida'):e.append('categoria_aplicacao_invalida')
            elif not any(re.search(INDICIOS_CONDICAO[c['categoria']]+'|'+INDICIOS_EN[c['categoria']],_normal(f['texto'])) for f in fs):e.append('condicao_sem_indicio')
            if c['aplicacao']=='esta_oferta' and not _nome(oferta['nome'],fs,contexto=True):e.append('condicao_sem_vinculo_com_oferta')
            if e:r['recusados'].append({'campo':'condicoes','indice':i,'item':c,'erros':e})
            else:r['condicoes'].append({**deepcopy(c),'oferta':oferta['nome'] if c['aplicacao']=='esta_oferta' else None,'citacoes':deepcopy(fs),'revisaoSemantica':'pendente'})
    if r.get('erro'):
        for k in (*ATORES,'condicoes'):r[k]=[]
    return r
