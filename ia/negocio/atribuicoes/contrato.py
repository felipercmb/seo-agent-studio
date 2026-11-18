"""C15 amplia quadros sem reescrever os registros/treinos C14 anteriores."""
from copy import deepcopy
import re
from negocio.quadros.contrato import conferir_entrada,titulos,TIPOS,ESCOPOS,CATEGORIAS,ALCANCES
from negocio.quadros.contrato import validar_saida as validar_c14
from negocio.proposicoes.contrato import literal,normal

ESTRUTURAS=['verbal','responsabilidade_nominal','atribuicao_nominal','posse_nominal','sem_relacao']

def validar_saida(s,e):
    u,f=conferir_entrada(e)
    if not isinstance(s,dict):return ['estrutura_invalida']
    if e['tarefa']=='relacao':
        if set(s)!={'estrutura','ator','acao','objeto','tipoAtor','escopo','negada','marcadorNominal'}:return ['estrutura_relacao_invalida']
        if s['estrutura'] not in ESTRUTURAS or s['tipoAtor'] not in TIPOS or s['escopo'] not in ESCOPOS or type(s['negada']) is not bool:return ['categorias_relacao_invalidas']
        antigo={k:v for k,v in s.items() if k!='marcadorNominal'}
        if s['estrutura'] in ('verbal','sem_relacao','responsabilidade_nominal'):
            erros=validar_c14(antigo,e)
        else:
            erros=[]
            for k,n in [('ator',120),('objeto',180)]:
                if not literal(s[k],u['texto'],n):erros.append(k+'_nao_literal')
            if s['acao'] is not None:erros.append('acao_verbal_inventada_para_atribuicao_nominal')
            if s['negada'] and not re.search(r'\b(?:não|nao|nem|nunca)\b',normal(u['texto'])):erros.append('negacao_sem_apoio')
        if s['estrutura'] in ('verbal','sem_relacao'):
            if s['marcadorNominal'] is not None:erros.append('marcador_nominal_em_estrutura_nao_nominal')
        elif not literal(s['marcadorNominal'],u['texto'],120):erros.append('marcador_nominal_nao_literal')
        if s['estrutura']=='verbal':
            acao=normal(s.get('acao'));verbo=acao.split()[0] if acao else '';ator=normal(s.get('ator'))
            if verbo in {'conecte','contrate','solicite','acesse','utilize','descubra','comece','experimente'}:erros.append('instrucao_nao_publica_ator_operacional')
            if verbo in {'oferecemos','temos','somos','reunimos'} and not re.search(r'\b(?:nós|nos|eu)\b',normal(s.get('ator'))):erros.append('primeira_pessoa_sem_ator_literal')
            if re.match(r'^(?:para (?:a |o )?(?:criação|criacao|gestão|gestao|emissão|emissao)|numa |em uma |em um |de |com |sem )',acao):erros.append('complemento_nominal_no_campo_da_acao')
            if re.match(r'^(?:temos|somos|oferecemos|reunimos)\s',ator):erros.append('fragmento_verbal_no_campo_do_ator')
        return sorted(set(erros))
    if set(s)!={'categoria','aplicaA','origemAplicacao','gatilho','modalidade','alcance','negacaoLiteral'}:return ['estrutura_condicao_invalida']
    antigo={k:v for k,v in s.items() if k!='negacaoLiteral'};erros=[]
    if s['origemAplicacao']=='fonte':
        if s['categoria']=='nenhuma' or not literal(s['aplicaA'],f['texto'],120):erros.append('aplicacao_fora_da_fonte')
        antigo.update(aplicaA=None,origemAplicacao='indefinida')
    erros+=validar_c14(antigo,e)
    if s['categoria']!='nenhuma':
        if isinstance(s['aplicaA'],str) and normal(s['aplicaA'])==normal(u['texto']) and len(s['aplicaA'].split())>6:erros.append('frase_inteira_nao_e_objeto_da_condicao')
        duracao=r'^(?:até\s+)?(?:\d+|um|uma|dois|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:dias?|horas?|meses?|semanas?|anos?)\b'
        if isinstance(s['gatilho'],str) and re.search(duracao,normal(s['gatilho'])):erros.append('duracao_nao_e_gatilho')
        if isinstance(s['modalidade'],str) and re.search(duracao,normal(s['modalidade'])):erros.append('duracao_nao_e_modalidade')
    if s['categoria']=='nenhuma' and s['negacaoLiteral'] is not None:erros.append('abstencao_com_negacao_preenchida')
    elif s['negacaoLiteral'] is not None and not literal(s['negacaoLiteral'],u['texto'],160):erros.append('negacao_condicao_nao_literal')
    return sorted(set(erros))

def projetar(s,e):
    erros=validar_saida(s,e);u,f=conferir_entrada(e)
    return {'versao':2,'estado':'recusada' if erros else 'interpretacao_pendente','tarefa':e['tarefa'],'quadro':None if erros else deepcopy(s),'erros':erros,
        'unidadeLiteral':deepcopy(u),'citacoes':[deepcopy(f)],'ofertaDeclarada':deepcopy(e['oferta']),'perfilConfirmado':False,'revisaoSemantica':'pendente',
        'limite':'Marcador nominal, campos e contexto preservados para revisão. Posse não confirma execução nem pagamento; atribuição de atividade não estabelece responsabilidade jurídica.'}
