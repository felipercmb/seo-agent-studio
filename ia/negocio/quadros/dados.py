"""C14 controlado: famílias de validação separadas, sem novos sites no treino."""
import argparse
import hashlib
import json
from pathlib import Path
from negocio.proposicoes.c7.dados import fonte
from negocio.proposicoes.unidades import segmentar
from negocio.quadros.protocolo import mensagens
from negocio.quadros.contrato import validar_saida

def rel(ator=None,acao=None,objeto=None,tipo='indefinido',escopo='indefinido',nominal=False,negada=False):
    return {'estrutura':'responsabilidade_nominal' if nominal else 'verbal' if ator else 'sem_relacao','ator':ator,'acao':acao,'objeto':objeto,'tipoAtor':tipo,'escopo':escopo,'negada':negada}

def cond(categoria='nenhuma',aplica=None,origem='indefinida',gatilho=None,modalidade=None,alcance='indefinido'):
    return {'categoria':categoria,'aplicaA':aplica,'origemAplicacao':origem,'gatilho':gatilho,'modalidade':modalidade,'alcance':alcance}

def cena(i,n):
    software={'nome':n,'natureza':'software','papel_site':'disponibiliza'}
    servico={'nome':n,'natureza':'servico','papel_site':'executa'}
    social={'nome':n,'natureza':'programa_social','papel_site':'executa'}
    r,c=rel(),cond();titulo=n;o=software
    if i==0:t=f'A plataforma {n} organiza as cobranças da escola.';r=rel(f'A plataforma {n}','organiza','as cobranças da escola','ferramenta','uso')
    elif i==1:t='Os analistas da empresa usuária registram os pedidos no sistema.';r=rel('Os analistas da empresa usuária','registram','os pedidos no sistema','usuario','uso')
    elif i==2:t=f'A equipe {n} configura as integrações da ferramenta.';r=rel(f'A equipe {n}','configura','as integrações da ferramenta','fornecedor','implementacao')
    elif i==3:t='As transportadoras contratadas pela loja realizam as entregas dos produtos.';r=rel('As transportadoras contratadas pela loja','realizam','as entregas dos produtos','terceiro','servico_do_cliente')
    elif i==4:t='O comprador paga o pedido no checkout somente com o módulo Cobrança.';r=rel('O comprador','paga','o pedido no checkout','terceiro','transacao_do_cliente');c=cond('outro','checkout','unidade',gatilho='somente com o módulo Cobrança',modalidade='módulo Cobrança',alcance='transacao_do_cliente')
    elif i==5:t='A empresa usuária contrata a licença de acesso ao software.';r=rel('A empresa usuária','contrata','a licença de acesso ao software','usuario','contratacao_da_oferta')
    elif i==6:t='A instalação é responsabilidade do cliente.';r=rel('cliente',None,'A instalação','usuario','implementacao',nominal=True)
    elif i==7:t=f'A responsabilidade pela migração dos dados é da equipe {n}.';r=rel(f'equipe {n}',None,'migração dos dados','fornecedor','implementacao',nominal=True)
    elif i==8:t=f'Conecte os seus alunos com a plataforma {n}.'
    elif i==9:t=f'Oferecemos o App {n} para a sua equipe.'
    elif i==10:t=f'{n}: mais sucesso para o seu futuro.'
    elif i==11:t='Mais de 1000 horas de formação interna da equipe.'
    elif i==12:t='A fundadora trabalhou anteriormente no Outro Instituto em 2015.'
    elif i==13:t='O plano Inicial custa 29 reais por mês.';c=cond('preco','plano Inicial','unidade',modalidade='plano Inicial',alcance='oferta')
    elif i==14:t='O teste gratuito dura 14 dias após a ativação da conta.';c=cond('prazo','teste gratuito','unidade',gatilho='após a ativação da conta',alcance='oferta')
    elif i==15:t='O prazo do suporte é de três dias úteis após a abertura do chamado.';c=cond('prazo','suporte','unidade',gatilho='após a abertura do chamado',alcance='suporte')
    elif i==16:t='O plano Equipe permite até oito usuários por organização.';c=cond('limite','plano Equipe','unidade',modalidade='plano Equipe',alcance='oferta')
    elif i==17:t='A contratação exige CNPJ ativo e representante autorizado.';c=cond('elegibilidade','contratação','unidade',alcance='oferta')
    elif i==18:t=f'A empresa {n} não transporta mercadorias.';r=rel(f'A empresa {n}','transporta','mercadorias','fornecedor','prestacao_da_oferta',negada=True);c=cond('exclusao',f'A empresa {n}','unidade',alcance='oferta')
    elif i==19:t='O cliente envia o pedido exclusivamente pelo formulário da plataforma.';r=rel('O cliente','envia','o pedido','usuario','contratacao_da_oferta');c=cond('canal','pedido','unidade',gatilho='exclusivamente pelo formulário da plataforma',alcance='formulario')
    elif i==20:t='A manutenção do cadastro é responsabilidade do cliente, exceto quando contratada a gestão assistida.';r=rel('cliente',None,'manutenção do cadastro','usuario','uso',nominal=True);c=cond('exclusao','manutenção do cadastro','unidade',gatilho='exceto quando contratada a gestão assistida',modalidade='gestão assistida',alcance='atividade')
    elif i==21:t=f'O checkout {n} registra os pagamentos dos compradores da loja.';r=rel(f'O checkout {n}','registra','os pagamentos dos compradores da loja','ferramenta','uso')
    elif i==22:t='A implantação do LMS ocorre em até 45 dias úteis após assinatura do contrato.';c=cond('prazo','implantação do LMS','unidade',gatilho='após assinatura do contrato',alcance='atividade')
    elif i==23:t='A liberação dos cursos prontos leva até dois dias úteis depois da confirmação da compra.';c=cond('prazo','liberação dos cursos prontos','unidade',gatilho='depois da confirmação da compra',alcance='atividade')
    elif i==24:t='O técnico do prestador realiza a inspeção dos equipamentos contratados.';o=servico;r=rel('O técnico do prestador','realiza','a inspeção dos equipamentos contratados','fornecedor','prestacao_da_oferta')
    elif i==25:t='O pagamento da assinatura não inclui a taxa da operação do usuário.';c=cond('exclusao','pagamento da assinatura','unidade',alcance='oferta')
    elif i==26:t='Cabe ao contratante a responsabilidade pelo envio dos arquivos.';r=rel('contratante',None,'envio dos arquivos','usuario','implementacao',nominal=True)
    elif i==27:t=f'Temos a solução {n} para aproximar as equipes.'
    elif i==28:t=f'Utilize o App {n} e transforme sua operação.'
    elif i==29:t='A secretaria escolar envia as cobranças às famílias pelo sistema.';r=rel('A secretaria escolar','envia','as cobranças às famílias pelo sistema','usuario','uso')
    elif i==30:t=f'O sistema {n} não realiza a entrega física dos produtos.';r=rel(f'O sistema {n}','realiza','a entrega física dos produtos','ferramenta','uso',negada=True);c=cond('exclusao',f'O sistema {n}','unidade',alcance='oferta')
    elif i==31:t=f'A associação {n} executa as oficinas gratuitas de leitura.';o=social;r=rel(f'A associação {n}','executa','as oficinas gratuitas de leitura','fornecedor','prestacao_da_oferta');c=cond('preco','oficinas gratuitas de leitura','unidade',alcance='oferta')
    elif i==32:t='Os voluntários acompanham os participantes nas atividades da oficina.';o=social;r=rel('Os voluntários','acompanham','os participantes nas atividades da oficina','terceiro','prestacao_da_oferta')
    elif i==33:t='A família paga a mensalidade escolar no aplicativo, sem pagar pelo software da escola.';r=rel('A família','paga','a mensalidade escolar','terceiro','transacao_do_cliente');c=cond('exclusao','família','unidade',gatilho='sem pagar pelo software da escola',alcance='transacao_do_cliente')
    elif i==34:t='A avaliação não exige cartão de crédito e termina em sete dias corridos.';c=cond('prazo','avaliação','unidade',alcance='oferta')
    elif i==35:t='A ativação ocorre em até cinco dias úteis depois do recebimento dos documentos completos.';titulo='Plano Institucional';c=cond('prazo','Plano Institucional','titulo',gatilho='depois do recebimento dos documentos completos',alcance='atividade')
    else:raise ValueError('Família inexistente.')
    return t,titulo,o,r,c

def criar(saida):
    saida=Path(saida)
    if saida.exists():raise ValueError('Use uma saída nova.')
    saida.mkdir(parents=True,mode=0o700)
    records=[]
    for i in range(36):
        split='train' if i<26 else 'valid'
        for ei in range(4 if split=='train' else 2):
            nome=['Araticum','Bromelia','Cambuca','Dourado'][ei]+str(i)
            ident=f'c14-f{i:02d}-e{ei:02d}';t,titulo,o,r,c=cena(i,nome)
            f=fonte(t,titulo,ident)
            d=segmentar({'versao':1,'dominio':'example.com','fontes':[f]})
            if len(d['unidades'])!=1:raise ValueError('A unidade foi dividida.')
            for tarefa,alvo in [('relacao',r),('condicao',c)]:
                e={'versao':1,'tarefa':tarefa,'documento':d,'unidade':d['unidades'][0]['id'],'oferta':o}
                erros=validar_saida(alvo,e)
                if erros:raise ValueError((ident,tarefa,erros))
                records.append({'id':ident+'-'+tarefa,'familia':'c14-f'+str(i).zfill(2),'entidade':ident,'split':split,'entrada':e,'alvo':alvo,
                    'messages':mensagens(e)+[{'role':'assistant','content':json.dumps(alvo,ensure_ascii=False,separators=(',',':'))}]})
    manifest={'versao':1,'natureza':'controlado_autoral_c14','revisaoHumanaIndependente':False,'novasEmpresasUsadas':False,'geradorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'arquivosSha256':{},'contagens':{}}
    for split in ('train','valid'):
        rs=[x for x in records if x['split']==split];manifest['contagens'][split]=len(rs)
        for file,rows in [('tarefas-'+split+'.jsonl',rs),(split+'.jsonl',[{'messages':r['messages']} for r in rs])]:
            raw=''.join(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n' for x in rows);(saida/file).write_text(raw);manifest['arquivosSha256'][file]=hashlib.sha256(raw.encode()).hexdigest()
    root=Path(__file__).resolve().parents[3]
    manifest['codigoSha256']={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')}
    (saida/'manifesto.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--saida',required=True,type=Path);a=p.parse_args();print(json.dumps(criar(a.saida)['contagens']))
