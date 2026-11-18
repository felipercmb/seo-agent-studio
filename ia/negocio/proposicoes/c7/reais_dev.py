"""Supervisão técnica pequena de empresas já consumidas na rodada anterior."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from negocio.proposicoes.unidades import segmentar
from negocio.proposicoes.nomes import catalogo_nomes
from negocio.proposicoes.contrato import normal,validar_ofertas
from negocio.jornadas.recuperacao import chave
from negocio.proposicoes.c7.dados import registro,p

ANTERIOR=Path('data/experimentos-modulares/rodada-confiabilidade-20261116-2047/negocio')


def adicionar_reais(raiz):
    specs=[
      ('train','cieds','reserva4-c6-9b-v1/rv5-t02-resultado.json',('indefinido','indefinido'),[
        ('O que fazemos Somos',None,None),('Equipe Executiva Reunimos',None,None),('É Consultor na Camino',None,None)]),
      ('train','estapar','reserva4-c6-9b-v1/rv5-t04-resultado.json',('software','disponibiliza'),[
        ('Você pode reservar uma vaga',p('Você','reservar','uma vaga','usuario','uso'),None),('Somos GPTW',None,None),('+47 mil horas investidas',None,None)]),
      ('train','meetime','c5-smoke/int8-test06-resultado.json',('software','disponibiliza'),[
        ('Organize e acelere a prospecção',None,None),('Um software de Sales Engagement, como o Meetime Flow',p('Um software de Sales Engagement, como o Meetime Flow','organiza','a rotina em cadências de prospecção','ferramenta'),None),('Priorização de novos leads inbound O Meetime Flow notifica',p('O Meetime Flow','notifica','o SDR','ferramenta'),None)]),
      ('train','superfrete','reserva6-c5-9b-v1/r6-t04-resultado.json',('software','disponibiliza'),[
        ('A SuperFrete é a plataforma de frete que conecta',p('A SuperFrete','conecta','você às principais transportadoras do Brasil','ferramenta','uso'),None),('Você paga apenas o valor',p('Você','paga','o valor','usuario','transacao_do_cliente'),None),('A SuperFrete negocia desconto',p('A SuperFrete','negocia','desconto','fornecedor','fornecimento'),None)]),
      ('validation','gestaoclick','c5-smoke/int8-test07-resultado.json',('software','disponibiliza'),[
        ('No GestãoClick , o sistema de ordem de serviço online abre',p('o sistema de ordem de serviço online','abre','a OS','ferramenta'),None),('nossos times internos de Engenharia e Produto constroem',p('nossos times internos de Engenharia e Produto','constroem','soluções eficientes','fornecedor','fornecimento'),None),('O teste grátis dura 10 dias',None,{'categoria':'prazo','aplicaA':'teste grátis','alcance':'oferta'})]),
      ('validation','pluga','c5-dev-complemento/int8-test05-resultado.json',('software','disponibiliza'),[
        ('Pluga é uma plataforma de automação que conecta',p('Pluga','conecta','ferramentas','ferramenta'),None),('Atendimento',None,None)])]
    rs=[]
    for split,empresa,rel,nat,exemplos in specs:
        arquivo=Path(raiz)/ANTERIOR/rel;original=json.loads(arquivo.read_text());of=original['ofertas'][0];j=of['jornada'];fontes=j['fontesSelecionadas'];ancora=fontes[0]
        nome=of['nome'];familia='real-'+empresa
        def preparar(fontes_):
            usadas=[];vistos=set()
            for f in fontes_:
                if chave(f) in vistos:continue
                vistos.add(chave(f));usadas.append({**deepcopy(f),'id':'s'+str(len(usadas)+1).zfill(2)})
            return segmentar({'versao':1,'dominio':original['dominio'],'fontes':usadas})
        doc=preparar([ancora])
        cat=next((x for x in catalogo_nomes(doc) if normal(x['nomePublicado'])==normal(nome)),None)
        if not cat:
            # O catálogo pode conter nome mais curto literal, mas não devemos
            # criar esse alias para fazer um exemplo passar.
            raise ValueError('Nome real não catalogado na âncora: '+empresa+' '+nome)
        head={'ofertas':[{'nomeId':cat['id'],'natureza':nat[0],'papel_site':nat[1],'evidencias':['s01']}],'incertezas':[]}
        rs.append(registro(doc,head,id='real-'+empresa+'-oferta',split=split,familia=familia,entidade=original['dominio'],idioma='pt',origem='dev_publico_consumido'))
        for indice,(trecho,prop,cond) in enumerate(exemplos):
            unidade=next((u for u in j['unidades'] if trecho in u['texto']),None)
            if unidade is None:raise ValueError('Unidade real não encontrada: '+empresa+' '+trecho)
            fonte=next(f for f in fontes if f['id']==unidade['fonte']);doc=preparar([ancora,fonte]);u=next(u for u in doc['unidades'] if u['texto']==unidade['texto']);doc['unidadesAlvo']=[u['id']]
            o={'nome':nome,'natureza':nat[0],'papel_site':nat[1],'evidencias':['s01']}
            alvo={'proposicoesPorUnidade':{u['id']:prop},'condicoes':[{**cond,'unidade':u['id']}] if cond else [],'incertezas':[]}
            rec=registro(doc,alvo,id='real-'+empresa+'-rel-'+str(indice),split=split,familia=familia,entidade=original['dominio'],idioma='pt',origem='dev_publico_consumido',oferta=o)
            rec['provenienciaDev']={'resultadoOriginal':str(arquivo),'sha256':hashlib.sha256(arquivo.read_bytes()).hexdigest(),'supervisao':'Correção técnica Codex de DEV já consumido; não é validação humana/cliente nem reserva inédita.'}
            rs.append(rec)
    return rs
