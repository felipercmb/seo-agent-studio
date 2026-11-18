"""C15: converte os controles preservados e adiciona construções de contexto."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from negocio.proposicoes.c7.dados import fonte
from negocio.proposicoes.unidades import segmentar
from negocio.quadros.dados import rel,cond
from negocio.atribuicoes.protocolo import mensagens
from negocio.atribuicoes.contrato import validar_saida

def converter(t):
    t=deepcopy(t);a=t['alvo'];e=t['entrada'];u=next(u for u in e['documento']['unidades'] if u['id']==e['unidade'])
    if e['tarefa']=='relacao':
        a['marcadorNominal']=None
        if a['estrutura']=='responsabilidade_nominal':
            for m in ['é responsabilidade do','é da','a responsabilidade pelo']:
                if m in u['texto']:a['marcadorNominal']=m;break
    else:
        a['negacaoLiteral']=None
        if a['categoria']=='exclusao':
            for m in ['não transporta','não inclui','não realiza','sem pagar pelo software da escola']:
                if m in u['texto']:a['negacaoLiteral']=m;break
    t['id']='c15-'+t['id'];t.pop('messages',None)
    return t

def nova_cena(i,n):
    o={'nome':n,'natureza':'software','papel_site':'disponibiliza'};rr={**rel(),'marcadorNominal':None};cc={**cond(),'negacaoLiteral':None};idx=0;h=n
    def nominal(ator,obj,marcador,estrutura='atribuicao_nominal',tipo='usuario',escopo='uso'):
        return {'estrutura':estrutura,'ator':ator,'acao':None,'objeto':obj,'tipoAtor':tipo,'escopo':escopo,'negada':False,'marcadorNominal':marcador}
    if i==0:t='A decisão e a execução continuam sempre do cliente.';rr=nominal('cliente','A decisão e a execução','continuam sempre do')
    elif i==1:t='Os dados coletados são de propriedade do cliente.';rr=nominal('cliente','Os dados coletados','são de propriedade do','posse_nominal',escopo='indefinido')
    elif i==2:t=f'API para automações Conecte a plataforma {n} aos seus fluxos.'
    elif i==3:t=f'Também oferecemos o App {n} para a sua equipe.'
    elif i in (4,5):
        t='A conta é necessária para quem envia documentos. O destinatário não precisa criar conta para assinar.';idx=1 if i==4 else 0
        cc={**cond('elegibilidade','assinar' if i==4 else 'quem envia documentos','unidade',alcance='atividade'),'negacaoLiteral':'não precisa criar conta' if i==4 else None}
    elif i==6:t=f'{n} é uma plataforma LMS. Nossa implantação ocorre em até 40 dias úteis após a aprovação do contrato.';idx=1;cc={**cond('prazo','implantação','unidade',gatilho='após a aprovação do contrato',alcance='atividade'),'negacaoLiteral':None}
    elif i==7:t='O LMS tem implantação em até 45 dias úteis. Os cursos prontos ficam disponíveis em até dois dias úteis após a compra.';idx=1;o={'nome':'Cursos prontos','natureza':'produto','papel_site':'vende'};cc={**cond('prazo','Os cursos prontos','unidade',gatilho='após a compra',alcance='oferta'),'negacaoLiteral':None}
    elif i==8:t='O plano Comunitário permite até dez membros por organização.';cc={**cond('limite','plano Comunitário','unidade',modalidade='plano Comunitário',alcance='oferta'),'negacaoLiteral':None}
    elif i==9:t='A equipe de suporte responde aos chamados em até três dias úteis depois da abertura do chamado.';rr={**rel('A equipe de suporte','responde','aos chamados','fornecedor','indefinido'),'marcadorNominal':None};cc={**cond('prazo','suporte','unidade',gatilho='depois da abertura do chamado',alcance='suporte'),'negacaoLiteral':None}
    elif i==10:t=f'A empresa {n} não acompanha as operações dos usuários.';rr={**rel(f'A empresa {n}','acompanha','as operações dos usuários','fornecedor','prestacao_da_oferta',negada=True),'marcadorNominal':None};cc={**cond('exclusao',f'A empresa {n}','unidade',alcance='oferta'),'negacaoLiteral':'não acompanha'}
    elif i==11:t='A orientação dos participantes é de responsabilidade dos voluntários.';o={'nome':n,'natureza':'programa_social','papel_site':'executa'};rr=nominal('voluntários','A orientação dos participantes','é de responsabilidade dos','responsabilidade_nominal','terceiro','prestacao_da_oferta')
    elif i==12:t='O envio dos arquivos continua a cargo da equipe contratante.';rr=nominal('equipe contratante','O envio dos arquivos','continua a cargo da',escopo='implementacao')
    elif i==13:t='A titularidade dos arquivos pertence à organização usuária.';rr=nominal('organização usuária','A titularidade dos arquivos','pertence à','posse_nominal',escopo='indefinido')
    elif i==14:t=f'Integração API: Utilize o App {n} para transformar os fluxos.'
    elif i==15:t='Quem envia documentos precisa de cadastro. O assinante está dispensado de cadastro para assinar.';idx=1;cc={**cond('elegibilidade','assinar','unidade',alcance='atividade'),'negacaoLiteral':'dispensado de cadastro'}
    elif i==16:t='O envio de documentos é uma atividade do remetente. Somente o remetente precisa de uma conta ativa.';idx=1;cc={**cond('elegibilidade','envio de documentos','fonte',alcance='atividade'),'negacaoLiteral':None}
    elif i==17:t='O cliente da loja paga a compra no checkout da plataforma, sem contratar uma licença de software.';rr={**rel('O cliente da loja','paga','a compra no checkout da plataforma','terceiro','transacao_do_cliente'),'marcadorNominal':None};cc={**cond('exclusao','cliente da loja','unidade',alcance='transacao_do_cliente'),'negacaoLiteral':'sem contratar uma licença de software'}
    elif i==18:t='A assinatura custa 80 reais por mês. O preço de implantação só é cobrado se o cliente contratar a migração assistida.';idx=1;cc={**cond('preco','preço de implantação','unidade',gatilho='se o cliente contratar a migração assistida',modalidade='migração assistida',alcance='atividade'),'negacaoLiteral':None}
    elif i==19:t='O suporte responde em até um dia útil. Para cursos gravados, o acesso começa em até dois dias úteis após a confirmação da matrícula.';idx=1;o={'nome':'Cursos gravados','natureza':'produto','papel_site':'vende'};cc={**cond('prazo','cursos gravados','unidade',gatilho='após a confirmação da matrícula',alcance='oferta'),'negacaoLiteral':None}
    else:raise ValueError('Família inexistente.')
    return t,h,o,idx,rr,cc

def criar(origem,saida,referencias=None):
    origem,saida=Path(origem),Path(saida)
    if saida.exists():raise ValueError('Use saída nova.')
    rows=[]
    for split in ('train','valid'):
        rows.extend(converter(json.loads(l)) for l in (origem/('tarefas-'+split+'.jsonl')).read_text().splitlines())
    for i in range(20):
        split='train' if i<12 else 'valid'
        for ei in range(4 if split=='train' else 2):
            ident=f'c15-f{i:02d}-e{ei:02d}';n=['Candeia','Jucara','Loureiro','Mangaba'][ei]+str(i);t,h,o,idx,rr,cc=nova_cena(i,n)
            d=segmentar({'versao':1,'dominio':'example.com','fontes':[fonte(t,h,ident)]});u=d['unidades'][idx]
            for tarefa,alvo in [('relacao',rr),('condicao',cc)]:rows.append({'id':ident+'-'+tarefa,'familia':'c15-f'+str(i).zfill(2),'entidade':ident,'split':split,'origem':'controlado_autoral_c15','entrada':{'versao':1,'tarefa':tarefa,'documento':d,'unidade':u['id'],'oferta':o},'alvo':alvo})
    if referencias:
        for l in Path(referencias).read_text().splitlines():
            t=json.loads(l)
            if t['split']!='train' or t.get('reservaNova') is not False:raise ValueError('Referência real não autorizada para este split.')
            rows.append(t)
    saida.mkdir(parents=True,mode=0o700);by_prompt={};deduplicadas=[]
    for r in rows:
        if validar_saida(r['alvo'],r['entrada']):raise ValueError((r['id'],validar_saida(r['alvo'],r['entrada'])))
        r['messages']=mensagens(r['entrada'])+[{'role':'assistant','content':json.dumps(r['alvo'],ensure_ascii=False,separators=(',',':'))}]
        k=json.dumps(r['messages'][:-1],ensure_ascii=False,sort_keys=True)
        if k in by_prompt:
            anterior=by_prompt[k]
            if anterior['split']!=r['split'] or anterior['alvo']!=r['alvo']:raise ValueError('Prompt duplicado com split/alvo divergente.')
            deduplicadas.append({'id':r['id'],'mantido':anterior['id']});continue
        by_prompt[k]=r
    rows=list(by_prompt.values());m={'versao':1,'natureza':'controlado_e_dev_publico_atribuicoes','empresasReservadasUsadas':False,'revisaoHumanaIndependente':False,'contagens':{},'arquivosSha256':{},'duplicatasExatasRemovidas':deduplicadas,'corpusC14OrigemSha256':hashlib.sha256((origem/'manifesto.json').read_bytes()).hexdigest(),'referenciasDevSha256':hashlib.sha256(Path(referencias).read_bytes()).hexdigest() if referencias else None}
    root=Path(__file__).resolve().parents[3]
    geradores=[Path(__file__),Path(__file__).with_name('protocolo.py'),Path(__file__).with_name('contrato.py'),root/'ia/negocio/quadros/dados.py',root/'ia/negocio/quadros/contrato.py']
    m['codigoGeracaoSha256']={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in geradores}
    for split in ('train','valid'):
        rs=[r for r in rows if r['split']==split];m['contagens'][split]=len(rs)
        for file,items in [('tarefas-'+split+'.jsonl',rs),(split+'.jsonl',[{'messages':r['messages']} for r in rs])]:
            raw=''.join(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n' for x in items);(saida/file).write_text(raw);m['arquivosSha256'][file]=hashlib.sha256(raw.encode()).hexdigest()
    (saida/'manifesto.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');return m

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--origem',type=Path,required=True);a.add_argument('--saida',type=Path,required=True);a.add_argument('--referencias',type=Path);o=a.parse_args();print(json.dumps(criar(o.origem,o.saida,o.referencias)['contagens']))
