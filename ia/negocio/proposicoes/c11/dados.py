"""C11: contrastes autorais, sem copiar textos/gabaritos do TEST4 consumido."""
from copy import deepcopy
from pathlib import Path
import argparse
import hashlib
import json
from negocio.proposicoes.c7.dados import conferir,exportar,fonte,p,registro
from negocio.proposicoes.c8.augmentacao import permutar
from negocio.proposicoes.unidades import segmentar
from negocio.proposicoes.nomes import catalogo_nomes
from negocio.proposicoes.contrato import validar_ofertas


def cena(f,n):
    if f==0:
        return [f'{n} é um software de pedidos.',f'A empresa usuária registra os pedidos na ferramenta {n}.',f'A ferramenta {n} organiza as informações cadastradas.','Somos a escolha perfeita para o seu futuro.'],[p('A empresa usuária','registra','os pedidos'),p(f'A ferramenta {n}','organiza','as informações cadastradas','ferramenta'),None],[],('software','disponibiliza')
    if f==1:
        return [f'{n} é um serviço de integração.',f'A equipe {n} configura as integrações para a empresa.','Suporte em etapas importantes para ajudar a empresa a organizar sua operação.','A empresa utiliza a ferramenta para consultar os registros.'],[p(f'A equipe {n}','configura','as integrações','fornecedor','implementacao'),None,p('A empresa','utiliza','a ferramenta')],[],('servico','executa')
    if f==2:
        return [f'{n} é um software para lojas B2B.','O cliente paga diretamente no checkout somente com o módulo PagamentoSeguro.','A empresa cadastra os produtos na loja.','Entre para uma nova era de resultados.'],[p('O cliente','paga','diretamente no checkout','usuario','transacao_do_cliente'),p('A empresa','cadastra','os produtos'),None],[{'unidade':'u002','categoria':'outro','aplicaA':'checkout','alcance':'transacao_do_cliente'}],('software','disponibiliza')
    if f==3:
        return [f'{n} é um serviço de aproximação profissional.',f'A agência {n} conecta as empresas aos especialistas independentes.','Os especialistas realizam os trabalhos contratados pelas empresas.','Mais eficiência para os seus negócios.'],[p(f'A agência {n}','conecta','as empresas aos especialistas independentes','fornecedor','prestacao_da_oferta'),p('Os especialistas','realizam','os trabalhos contratados pelas empresas','terceiro','servico_do_cliente'),None],[],('servico','intermedeia')
    if f==4:
        return [f'{n} é um programa social de oficinas.',f'A instituição {n} organiza as atividades do programa.','Os voluntários realizam as oficinas com os participantes.','Os participantes frequentam as oficinas oferecidas.'],[p(f'A instituição {n}','organiza','as atividades do programa','fornecedor','prestacao_da_oferta'),p('Os voluntários','realizam','as oficinas','terceiro','servico_do_cliente'),p('Os participantes','frequentam','as oficinas oferecidas','usuario','prestacao_da_oferta')],[],('programa_social','executa')
    if f==5:
        return [f'{n} é um software para equipes.','Em depoimento, uma cliente afirma que sua equipe fabrica alimentos.',f'A ferramenta {n} registra as solicitações dos usuários.','A fundadora trabalhou anteriormente em outra indústria.'],[None,p(f'A ferramenta {n}','registra','as solicitações dos usuários','ferramenta'),None],[],('software','disponibiliza')
    if f==6:
        return [f'{n} é um serviço de especialistas independentes.',f'A agência {n} encaminha os pedidos aos especialistas.','O trabalho solicitado pelo cliente é executado pelos especialistas.','Conheça uma experiência extraordinária.'],[p(f'A agência {n}','encaminha','os pedidos aos especialistas','fornecedor','prestacao_da_oferta'),p('especialistas','executado','O trabalho solicitado pelo cliente','terceiro','servico_do_cliente'),None],[],('servico','intermedeia')
    if f==7:
        return [f'{n} é um software de estoque.',f'A ferramenta {n} não transporta mercadorias.','Os operadores da empresa registram os itens em estoque.',f'A ferramenta {n} organiza os dados cadastrados.'],[None,p('Os operadores da empresa','registram','os itens em estoque'),p(f'A ferramenta {n}','organiza','os dados cadastrados','ferramenta')],[{'unidade':'u002','categoria':'exclusao','aplicaA':f'A ferramenta {n}','alcance':'oferta'}],('software','disponibiliza')
    raise ValueError('Família inexistente.')


def novos():
    rs=[];nomes=['Cedro','Flora','Moinho','Nuvem','Ponte','Ramo','Vento','Rio']
    for fam in range(8):
        split='train' if fam<6 else 'validation'
        for e in range(4 if split=='train' else 2):
            entidade=f'c10-f{fam:02d}-e{e:02d}';nome=nomes[fam]+['Leste','Serra','Vale','Lago'][e]
            frases,props,conds,natureza=cena(fam,nome)
            base={'versao':1,'dominio':'example.com','fontes':[fonte(' '.join(frases),nome,entidade)]};doc=segmentar(base)
            if len(doc['unidades'])!=4:raise ValueError('Segmentação inesperada.')
            cat=next(x for x in catalogo_nomes(doc) if x['nomePublicado']==nome)
            head={'ofertas':[{'nomeId':cat['id'],'natureza':natureza[0],'papel_site':natureza[1],'evidencias':['s01']}],'incertezas':[]}
            comum={'split':split,'familia':f'c10-contraste-{fam:02d}','entidade':entidade,'idioma':'pt','origem':'controlado_autoral_contraste_c10'}
            rs.append(permutar(registro(doc,head,id=entidade+'-oferta',**comum)))
            oferta=validar_ofertas(head,doc)['ofertas'][0];foco=deepcopy(doc);foco['unidadesAlvo']=[u['id'] for u in foco['unidades'][1:]]
            alvo={'proposicoesPorUnidade':dict(zip(foco['unidadesAlvo'],props)),'condicoes':conds,'incertezas':[]}
            rs.append(permutar(registro(foco,alvo,id=entidade+'-proposicoes',oferta=oferta,**comum)))
    return rs


def criar(origem,destino):
    origem=Path(origem);rs=[]
    for nome in ('tarefas-train.jsonl','tarefas-valid.jsonl'):rs.extend(json.loads(l) for l in (origem/nome).read_text().splitlines())
    rs.extend(novos());manifesto=exportar(destino,rs);destino=Path(destino)
    raiz=Path(__file__).resolve().parents[4]
    manifesto['codigoGeracaoSha256'][str(Path(__file__).resolve().relative_to(raiz))]=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    manifesto['corpusOrigemSha256']=hashlib.sha256((origem/'manifesto.json').read_bytes()).hexdigest()
    manifesto['C11']={'novasTarefasAutorais':56,'tarefasRealTEST4Adicionadas':0,'duasFamiliasNovasSomenteValidacao':True,'familiasEEntidadesSeparadas':True,'novosExemplosSomentePortugues':True,'apenasPadroesDeErroInformaramContrastes':True,'naoProvaGeneralizacaoReal':True}
    (destino/'manifesto.json').write_text(json.dumps(manifesto,ensure_ascii=False,indent=2)+'\n');return manifesto


if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--origem',type=Path,required=True);a.add_argument('--saida',type=Path,required=True);args=a.parse_args()
    print(json.dumps(criar(args.origem,args.saida)['resumo'],ensure_ascii=False))
