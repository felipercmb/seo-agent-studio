"""C13: condições e papéis explícitos em cenários controlados; nenhum site novo usado."""
from copy import deepcopy
from pathlib import Path
import argparse
import hashlib
import json
from negocio.proposicoes.c7.dados import conferir, exportar, fonte, p, registro
from negocio.proposicoes.c8.augmentacao import permutar
from negocio.proposicoes.unidades import segmentar
from negocio.proposicoes.nomes import catalogo_nomes
from negocio.proposicoes.contrato import validar_ofertas

def cena(f,n):
    if f==0:
        return [f'{n} é um software de documentos.','O titular da conta emite os documentos na ferramenta.','Para emitir documentos é necessário ter uma conta aprovada.',f'A equipe de suporte {n} configura os acessos da ferramenta.'],[p('O titular da conta','emite','os documentos'),None,p(f'A equipe de suporte {n}','configura','os acessos da ferramenta','fornecedor','implementacao')],[{'unidade':'u003','categoria':'elegibilidade','aplicaA':'emitir documentos','alcance':'atividade'}],('software','disponibiliza')
    if f==1:
        return [f'{n} é um software de cobrança.','A empresa usuária paga a tarifa de acesso ao fornecedor.','Nos primeiros 20 dias o valor da tarifa de acesso é de 4 reais e depois desse prazo é de 7 reais.','O cliente da empresa usuária paga pelo serviço da empresa.'],[p('A empresa usuária','paga','a tarifa de acesso ao fornecedor','usuario','contratacao_da_oferta'),None,p('O cliente da empresa usuária','paga','pelo serviço da empresa','terceiro','transacao_do_cliente')],[{'unidade':'u003','categoria':'preco','aplicaA':'tarifa de acesso','alcance':'oferta'}],('software','disponibiliza')
    if f==2:
        return [f'{n} é um software de assinatura.','O remetente envia o documento pelo formulário da plataforma.','Cada signatário assina o documento enviado pelo remetente.',f'O fornecedor {n} disponibiliza a ferramenta de assinatura.'],[p('O remetente','envia','o documento pelo formulário da plataforma'),p('Cada signatário','assina','o documento','usuario','uso'),p(f'O fornecedor {n}','disponibiliza','a ferramenta de assinatura','fornecedor','fornecimento')],[{'unidade':'u002','categoria':'canal','aplicaA':'envia o documento','alcance':'formulario'}],('software','disponibiliza')
    if f==3:
        return [f'{n} é um serviço de intermediação técnica.',f'A agência {n} conecta os solicitantes aos técnicos independentes.','Os técnicos independentes executam os reparos contratados.','Os técnicos somente realizam reparos nas cidades cobertas pelo atendimento.'],[p(f'A agência {n}','conecta','os solicitantes aos técnicos independentes','fornecedor','prestacao_da_oferta'),p('Os técnicos independentes','executam','os reparos contratados','terceiro','servico_do_cliente'),p('Os técnicos','realizam','reparos','terceiro','servico_do_cliente')],[{'unidade':'u004','categoria':'elegibilidade','aplicaA':'reparos','alcance':'atividade'}],('servico','intermedeia')
    if f==4:
        return [f'{n} é um software de gestão.','A equipe usuária registra os dados da operação no sistema.','O plano Essencial permite até 8 usuários por empresa.',f'O fornecedor {n} configura a implantação para a empresa.'],[p('A equipe usuária','registra','os dados da operação'),None,p(f'O fornecedor {n}','configura','a implantação para a empresa','fornecedor','implementacao')],[{'unidade':'u003','categoria':'limite','aplicaA':'plano Essencial','alcance':'oferta'}],('software','disponibiliza')
    if f==5:
        return [f'{n} é um serviço de revisão.',f'A equipe {n} revisa os documentos enviados pelo cliente.','O prazo de resposta do suporte é de 3 dias úteis.','O cliente solicita a revisão dos documentos à equipe.'],[p(f'A equipe {n}','revisa','os documentos enviados pelo cliente','fornecedor','prestacao_da_oferta'),None,p('O cliente','solicita','a revisão dos documentos','usuario','contratacao_da_oferta')],[{'unidade':'u003','categoria':'prazo','aplicaA':'suporte','alcance':'suporte'}],('servico','executa')
    if f==6:
        return [f'{n} é um software de logística.',f'A ferramenta {n} organiza os dados de entregas.',f'A empresa {n} não transporta mercadorias.','Os transportadores contratados pelo usuário realizam as entregas.'],[p(f'A ferramenta {n}','organiza','os dados de entregas','ferramenta'),None,p('Os transportadores contratados pelo usuário','realizam','as entregas','terceiro','servico_do_cliente')],[{'unidade':'u003','categoria':'exclusao','aplicaA':f'A empresa {n}','alcance':'oferta'}],('software','disponibiliza')
    if f==7:
        return [f'{n} é um software de pedidos.','A empresa usuária recebe os pedidos no sistema.','O comprador paga no checkout somente com o módulo Cobrança.',f'A ferramenta {n} registra os pagamentos informados.'],[p('A empresa usuária','recebe','os pedidos'),p('O comprador','paga','no checkout','terceiro','transacao_do_cliente'),p(f'A ferramenta {n}','registra','os pagamentos informados','ferramenta')],[{'unidade':'u003','categoria':'outro','aplicaA':'checkout','alcance':'transacao_do_cliente'}],('software','disponibiliza')
    if f==8:
        return [f'{n} é um programa social de orientação.','Os participantes frequentam as oficinas.','A inscrição no programa exige cadastro validado pela organização.','Os voluntários realizam as atividades de orientação.'],[p('Os participantes','frequentam','as oficinas','usuario','prestacao_da_oferta'),None,p('Os voluntários','realizam','as atividades de orientação','terceiro','servico_do_cliente')],[{'unidade':'u003','categoria':'elegibilidade','aplicaA':'inscrição no programa','alcance':'oferta'}],('programa_social','executa')
    if f==9:
        return [f'{n} é um serviço de análise documental.','O cliente solicita a análise do documento ao fornecedor.','A solicitação da análise deve ser enviada pelo formulário identificado na plataforma.',f'A equipe {n} realiza a análise solicitada.'],[p('O cliente','solicita','a análise do documento','usuario','contratacao_da_oferta'),None,p(f'A equipe {n}','realiza','a análise solicitada','fornecedor','prestacao_da_oferta')],[{'unidade':'u003','categoria':'canal','aplicaA':'solicitação da análise','alcance':'atividade'}],('servico','executa')
    raise ValueError('Família inexistente.')

def novos():
    records=[]
    names=['Acacia','Buriti','Cipo','Dalia','Erva','Figueira','Goiaba','Hera','Imbuia','Jatoba']
    for family in range(10):
        split='train' if family<8 else 'validation'
        for entity in range(4 if split=='train' else 2):
            ident=f'c13-f{family:02d}-e{entity:02d}'
            name=names[family]+['Azul','Dourada','Verde','Branca'][entity]
            sentences,props,conditions,nature=cena(family,name)
            doc=segmentar({'versao':1,'dominio':'example.com','fontes':[fonte(' '.join(sentences),name,ident)]})
            if len(doc['unidades'])!=4:raise ValueError('Segmentação inesperada.')
            published=next(x for x in catalogo_nomes(doc) if x['nomePublicado']==name)
            head={'ofertas':[{'nomeId':published['id'],'natureza':nature[0],'papel_site':nature[1],'evidencias':['s01']}],'incertezas':[]}
            common={'split':split,'familia':f'c13-condicoes-{family:02d}','entidade':ident,'idioma':'pt','origem':'controlado_autoral_condicoes_c13'}
            records.append(permutar(registro(doc,head,id=ident+'-oferta',**common)))
            offer=validar_ofertas(head,doc)['ofertas'][0]
            focus=deepcopy(doc);focus['unidadesAlvo']=[u['id'] for u in focus['unidades'][1:]]
            target={'proposicoesPorUnidade':dict(zip(focus['unidadesAlvo'],props)),'condicoes':conditions,'incertezas':[]}
            records.append(permutar(registro(focus,target,id=ident+'-proposicoes',oferta=offer,**common)))
    return records

def criar(origem,destino):
    origem,destino=Path(origem),Path(destino)
    records=[]
    for file in ['tarefas-train.jsonl','tarefas-valid.jsonl']:
        records.extend(json.loads(line) for line in (origem/file).read_text().splitlines())
    records.extend(novos())
    manifest=exportar(destino,records)
    root=Path(__file__).resolve().parents[4]
    previous=json.loads((origem/'manifesto.json').read_text())
    manifest['codigoGeracaoSha256'].update(previous['codigoGeracaoSha256'])
    for file in [Path(__file__),root/'ia/negocio/proposicoes/c8/augmentacao.py']:
        manifest['codigoGeracaoSha256'][str(file.relative_to(root))]=hashlib.sha256(file.read_bytes()).hexdigest()
    manifest['corpusOrigemSha256']=hashlib.sha256((origem/'manifesto.json').read_bytes()).hexdigest()
    manifest['C13']={'tarefasNovasControladas':72,'novasPaginasReaisAdicionadas':0,'familiasNovasTreino':8,'familiasNovasSomenteValidacao':2,'nenhumaEmpresaReservadaLida':True,'limite':'Rótulos autorais controlados; não constituem revisão independente ou qualidade comercial.'}
    (destino/'manifesto.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return manifest

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--origem',type=Path,required=True);a.add_argument('--saida',type=Path,required=True);args=a.parse_args()
    print(json.dumps(criar(args.origem,args.saida)['resumo'],ensure_ascii=False))
