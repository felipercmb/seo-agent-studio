"""Corpus pequeno autoral/DEV, com famílias e entidades separadas por divisão."""
from copy import deepcopy
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import random
from negocio.proposicoes.unidades import segmentar,digest
from negocio.proposicoes.nomes import catalogo_nomes
from negocio.proposicoes.contrato import validar_ofertas,validar_proposicoes
from negocio.proposicoes.c7.protocolo import mensagens


def fonte(texto,nome,entidade,*,pagina_generica=False):
    return {'id':'s01','tipo':'declaracao','texto':texto,'contexto':{'paginaId':'pag_'+hashlib.sha256(entidade.encode()).hexdigest()[:20],'url':'https://example.com/'+entidade,'tituloPagina':'Equipe e benefícios' if pagina_generica else nome,'titulos':[{'nivel':2,'texto':nome}],'campo':'p','coletadoEm':'2026-11-17T00:00:00Z','sha256':hashlib.sha256(texto.encode()).hexdigest(),'recortado':False,'classePagina':'institucional'}}


def p(sujeito,acao,objeto,tipo='usuario',escopo='uso'):
    return {'sujeito':sujeito,'tipoSujeito':tipo,'acao':acao,'objeto':objeto,'escopo':escopo}


def cenas(familia,nome,idioma):
    en=idioma=='en';sw=nome;org='Equipe '+nome if not en else nome+' team'
    if familia==0:
        ss=[f'{sw} is software for teams.',f'The {sw} tool organizes requests.', 'The operators register customer requests.', 'We are the best choice for a new future.'] if en else [f'{sw} é um software para equipes.',f'A ferramenta {sw} organiza os pedidos.','Os operadores registram os pedidos dos clientes.','Somos a melhor escolha para um futuro novo.']
        ps=[p(f'The {sw} tool','organizes','requests','ferramenta'),p('The operators','register','customer requests'),None] if en else [p(f'A ferramenta {sw}','organiza','os pedidos','ferramenta'),p('Os operadores','registram','os pedidos dos clientes'),None]
        return ss,[1,2,3],ps,[],('software','disponibiliza')
    if familia==1:
        ss=[f'{sw} is an artist booking service.',f'The {sw} agency connects event organizers with artists.','The artists perform the contracted concerts.','Maria previously founded Another Studio.'] if en else [f'{sw} é um serviço de contratação de artistas.',f'A agência {sw} conecta os contratantes aos artistas.','Os artistas realizam os shows contratados.','Maria fundou anteriormente o Outro Estúdio.']
        ps=[p(f'The {sw} agency','connects','event organizers with artists','fornecedor','prestacao_da_oferta'),p('The artists','perform','the contracted concerts','terceiro','servico_do_cliente'),None] if en else [p(f'A agência {sw}','conecta','os contratantes aos artistas','fornecedor','prestacao_da_oferta'),p('Os artistas','realizam','os shows contratados','terceiro','servico_do_cliente'),None]
        return ss,[1,2,3],ps,[],('servico','intermedeia')
    if familia==2:
        ss=[f'{sw} is a social mentoring program.',f'The foundation runs the {sw} program.','The participants attend mentoring meetings.','A former student praised an engineering course at Another University.'] if en else [f'{sw} é um programa social de mentoria.',f'A fundação executa o programa {sw}.','Os participantes frequentam os encontros de mentoria.','Um ex-aluno elogiou um curso de engenharia da Outra Universidade.']
        ps=[p('The foundation','runs',f'the {sw} program','fornecedor','prestacao_da_oferta'),p('The participants','attend','mentoring meetings','usuario','prestacao_da_oferta'),None] if en else [p('A fundação','executa',f'o programa {sw}','fornecedor','prestacao_da_oferta'),p('Os participantes','frequentam','os encontros de mentoria','usuario','prestacao_da_oferta'),None]
        return ss,[1,2,3],ps,[],('programa_social','executa')
    if familia==3:
        ss=[f'{sw} provides parking reservation software.',f'The {sw} platform confirms parking reservations.','The garage operators perform vehicle storage.','Request your space now.'] if en else [f'{sw} oferece software de reserva de estacionamento.',f'A plataforma {sw} confirma as reservas de vagas.','Os operadores dos estacionamentos realizam a guarda dos veículos.','Solicite sua vaga agora.']
        ps=[p(f'The {sw} platform','confirms','parking reservations','ferramenta'),p('The garage operators','perform','vehicle storage','terceiro','servico_do_cliente'),None] if en else [p(f'A plataforma {sw}','confirma','as reservas de vagas','ferramenta'),p('Os operadores dos estacionamentos','realizam','a guarda dos veículos','terceiro','servico_do_cliente'),None]
        return ss,[1,2,3],ps,[],('software','disponibiliza')
    if familia==4:
        ss=[f'{sw} is task management software.','In the old spreadsheet process, operators manually copy every request.',f'The {sw} tool automatically sorts the requests.','Use the best solution now.'] if en else [f'{sw} é um software de gestão de tarefas.','No processo antigo com planilha, os operadores copiam manualmente cada pedido.',f'A ferramenta {sw} organiza automaticamente os pedidos.','Use agora a melhor solução.']
        ps=[None,p(f'The {sw} tool','sorts','the requests','ferramenta'),None] if en else [None,p(f'A ferramenta {sw}','organiza','os pedidos','ferramenta'),None]
        return ss,[1,2,3],ps,[],('software','disponibiliza')
    if familia==5:
        ss=[f'{sw} is a document review service.',f'The {sw} team reviews customer documents.',f'The {sw} trial lasts 10 days and does not require a credit card.','1000 hours of internal staff training.'] if en else [f'{sw} é um serviço de revisão de documentos.',f'A equipe {sw} revisa os documentos dos clientes.',f'O teste de {sw} dura 10 dias e não exige cartão de crédito.','1000 horas de capacitação interna da equipe.']
        ps=[p(f'The {sw} team','reviews','customer documents','fornecedor','prestacao_da_oferta'),None,None] if en else [p(f'A equipe {sw}','revisa','os documentos dos clientes','fornecedor','prestacao_da_oferta'),None,None]
        return ss,[1,2,3],ps,[{'unidade':'u003','categoria':'prazo','aplicaA':f'{sw} trial' if en else f'teste de {sw}','alcance':'oferta'}],('servico','executa')
    if familia==6:
        return (['More productivity and success.','1000 hours of inspiration.','We bring together exceptional talent.'] if en else ['Mais produtividade e sucesso.','1000 horas de inspiração.','Reunimos talentos excepcionais.']),[],[],[],None
    if familia==7:
        return (['Maria worked at Another Institute in 2015.','A former student attended a course at Another University.','The team won an employer award.'] if en else ['Maria trabalhou no Outro Instituto em 2015.','Um ex-aluno frequentou um curso na Outra Universidade.','A equipe recebeu um selo de empregador.']),[],[],[],None
    if familia==8:
        ss=[f'{sw} is a free community literacy program.',f'The {sw} foundation teaches adults to read.','The adult learners attend weekly classes.','We change lives through a better tomorrow.'] if en else [f'{sw} é um programa gratuito de alfabetização comunitária.',f'A fundação {sw} ensina adultos a ler.','Os alunos adultos frequentam aulas semanais.','Transformamos vidas por um amanhã melhor.']
        ps=[p(f'The {sw} foundation','teaches','adults to read','fornecedor','prestacao_da_oferta'),p('The adult learners','attend','weekly classes','usuario','prestacao_da_oferta'),None] if en else [p(f'A fundação {sw}','ensina','adultos a ler','fornecedor','prestacao_da_oferta'),p('Os alunos adultos','frequentam','aulas semanais','usuario','prestacao_da_oferta'),None]
        return ss,[1,2,3],ps,[],('programa_social','executa')
    if familia==9:
        ss=[f'{sw} is an inventory software platform.',f'The {sw} support team configures integrations with the customer.','The warehouse staff use the platform to register stock.','The founder previously taught a university course.'] if en else [f'{sw} é uma plataforma de software de estoque.',f'A equipe de suporte {sw} configura integrações junto ao cliente.','Os funcionários do estoque utilizam a plataforma para registrar o estoque.','O fundador ensinou anteriormente um curso universitário.']
        ps=[p(f'The {sw} support team','configures','integrations','fornecedor','implementacao'),p('The warehouse staff','use','the platform','usuario'),None] if en else [p(f'A equipe de suporte {sw}','configura','integrações','fornecedor','implementacao'),p('Os funcionários do estoque','utilizam','a plataforma','usuario'),None]
        return ss,[1,2,3],ps,[],('software','disponibiliza')
    raise ValueError('Família não registrada.')


def registro(doc,alvo,*,id,split,familia,entidade,idioma,oferta=None,origem='controlado_autoral'):
    v=validar_proposicoes(alvo,doc,oferta) if oferta else validar_ofertas(alvo,doc)
    if v.get('erro') or v.get('recusadas'):raise ValueError('Alvo inválido '+id+': '+str(v))
    ms=mensagens(doc,oferta)+[{'role':'assistant','content':json.dumps(alvo,ensure_ascii=False,separators=(',',':'))}]
    return {'id':id,'split':split,'familia':familia,'entidade':entidade,'idioma':idioma,'origem':origem,'documento':doc,'oferta':oferta,'alvo':alvo,'messages':ms}


def gerar_controlados():
    rs=[]
    for fam in range(10):
        split='train' if fam<8 else 'validation'
        for variante in range(2):
            entidade=f'c7-f{fam:02}-e{variante:02}';nome=['Alvor','Bruma','Cais','Duna','Estio','Farol','Gema','Horiz','Iara','Jaspe'][fam]+['Norte','Sul'][variante]
            for idioma in ['pt','en']:
                ss,alvos,props,cond,natureza=cenas(fam,nome,idioma)
                base={'versao':1,'dominio':'example.com','fontes':[fonte(' '.join(ss),nome,entidade,pagina_generica=variante==1)]};doc=segmentar(base)
                if len(doc['unidades'])!=len(ss):raise ValueError('Divisão de frase inesperada.')
                head={'ofertas':[],'incertezas':[]}
                if natureza:
                    cat=next(x for x in catalogo_nomes(doc) if x['nomePublicado']==nome)
                    head['ofertas']=[{'nomeId':cat['id'],'natureza':natureza[0],'papel_site':natureza[1],'evidencias':['s01']}]
                pref=entidade+'-'+idioma
                rs.append(registro(doc,head,id=pref+'-oferta',split=split,familia=f'controlada-{fam:02}',entidade=entidade,idioma=idioma))
                if natureza:
                    o=validar_ofertas(head,doc)['ofertas'][0];foco=deepcopy(doc);foco['unidadesAlvo']=[doc['unidades'][x]['id'] for x in alvos]
                    alvo={'proposicoesPorUnidade':dict(zip(foco['unidadesAlvo'],props)),'condicoes':cond,'incertezas':[]}
                    rs.append(registro(foco,alvo,id=pref+'-proposicoes',split=split,familia=f'controlada-{fam:02}',entidade=entidade,idioma=idioma,oferta=o))
    return rs


def conferir(registros):
    ids=set();entidades={};familias={}
    for r in registros:
        if r['id'] in ids:raise ValueError('ID repetido.')
        ids.add(r['id'])
        for mapa,campo in [(entidades,'entidade'),(familias,'familia')]:
            anterior=mapa.setdefault(r[campo],r['split'])
            if anterior!=r['split']:raise ValueError('Contaminação de '+campo)
        if r['messages'][:-1]!=mensagens(r['documento'],r['oferta']) or json.loads(r['messages'][-1]['content'])!=r['alvo']:raise ValueError('Protocolo/alvo divergente.')
    return {'tarefas':len(registros),'entidadesDistintas':len(entidades),'familiasDistintas':len(familias),'splits':{s:{'tarefas':sum(x['split']==s for x in registros),'entidades':len({x['entidade'] for x in registros if x['split']==s}),'familias':len({x['familia'] for x in registros if x['split']==s})} for s in ['train','validation']},'paresPTENContamComoUmaEntidade':True}


def exportar(pasta,registros):
    pasta=Path(pasta);pasta.mkdir(mode=0o700);resumo=conferir(registros)
    rng=random.Random(42)
    for split,nome in [('train','train'),('validation','valid')]:
        linhas=[x for x in registros if x['split']==split];rng.shuffle(linhas)
        for arquivo,conteudos in [(nome+'.jsonl',[{'messages':x['messages']} for x in linhas]),('tarefas-'+nome+'.jsonl',linhas)]:
            with (pasta/arquivo).open('x') as f:
                for x in conteudos:f.write(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n')
    arquivos={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in pasta.glob('*.jsonl')}
    fontes=[Path(__file__),Path(__file__).with_name('protocolo.py'),Path(__file__).with_name('reais_dev.py')]
    geradores={str(p.relative_to(Path(__file__).resolve().parents[4])):hashlib.sha256(p.read_bytes()).hexdigest() for p in fontes}
    manifesto={'versao':1,'geradoEm':datetime.now(timezone.utc).isoformat(),'natureza':'controlado_autoral_com_dev_publico','resumo':resumo,'arquivosSha256':arquivos,'codigoGeracaoSha256':geradores,'protocoloSha256':hashlib.sha256(Path(__file__).with_name('protocolo.py').read_bytes()).hexdigest(),'novasReservasLidas':False,'fontesPrivadas':False,'limite':'Supervisão técnica autoral/DEV público; não é aprovação de cliente. Validação controlada não mede generalização real.'}
    with (pasta/'manifesto.json').open('x') as f:json.dump(manifesto,f,ensure_ascii=False,indent=2);f.write('\n')
    return manifesto
