"""Promove o teste anterior a treino e reserva novos domínios para outro ciclo.

Os rótulos continuam técnicos e fracos. As variações são repetição/aumento de
dados, não pessoas ou avaliações independentes. Todo resultado fica em data/.
"""
from collections import Counter
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import random
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'v3')]
from runtime import RAIZ,sha256
from reais.preparar import construir
from contrato_v3 import mensagens

ANTIGOS=[('coleta-20261114','reanalise-inicial.json'),('coleta-reserva-20261114','reanalise-reserva.json')]
NOVOS=[('coleta-rodada2','reanalise-rodada2.json'),('coleta-rodada2-reserva','reanalise-rodada2-reserva.json')]
# A mesma organização já aparecia no primeiro treino com outro domínio.
EXCLUIDOS={'nuvemshop.com'}
PERGUNTAS={
 'serp':{'valid':['Como descubro a colocação de hoje e os sites acima nesta pesquisa?', 'Qual evidência falta para apontar a posição atual desta busca?'],
         'test':['Que passo confirma onde este site aparece agora e quem aparece antes?', 'Qual é a próxima verificação para identificar resultados atuais dessa pesquisa?']},
 'comercial':{'valid':['Podemos decidir como distribuir a verba usando apenas esta página?', 'Os dados disponíveis mostram o retorno da ação?'],
              'test':['Os dados desta página revelam qual investimento gera mais vendas?', 'O que falta para apontar o melhor retorno financeiro para a empresa?']},
 'demanda':{'valid':['O título encontrado comprova que existe público pesquisando essa expressão?', 'Como verificar se esse termo do conteúdo é procurado?'],
            'test':['Encontrar estas palavras na página demonstra quantas pessoas buscam por elas?', 'Como saber se há procura real pelo termo extraído desta página?']},
 'h1':{'valid':['O que conferir na estrutura que foi observada nesta página?', 'Há um elemento inicial para examinar antes de alterar o conteúdo?'],
       'test':['Qual ajuste de estrutura do HTML pode ser examinado nesta captura?', 'A captura identificou algo na estrutura que mereça conferência?']},
 'noindex':{'valid':['Qual cuidado tomar com a diretiva encontrada antes de editar a página?', 'Como investigar a diretiva observada sem presumir a intenção?'],
            'test':['Que pergunta fazer sobre a regra de indexação observada nesta URL?', 'O que verificar antes de mudar a exclusão presente no HTML?']},
}
AUMENTO_DEMANDA=[
 'O texto do site é prova de que as pessoas pesquisam este termo?',
 'Que evidência preciso reunir para saber se há procura para estas palavras?',
 'Qual o passo antes de tratar o texto da página como demanda de pesquisa?',
 'A presença da expressão no conteúdo revela o tamanho do público?',
 'Como investigar se uma palavra extraída é usada em buscas?',
 'Podemos concluir que há pesquisas só porque o título contém a expressão?',
 'Qual pesquisa deve anteceder a afirmação de que este termo tem demanda?',
 'O título da página mede a quantidade de buscas pelo assunto?',
]
AUMENTO_NOINDEX=[
 'Há diretiva no HTML e não conhecemos a intenção. Que fazer primeiro?',
 'Antes de modificar noindex, que informação deve ser confirmada?',
 'O que perguntar ao responsável sobre a publicação desta URL?',
 'A regra de exclusão observada é sempre um erro que devemos remover?',
 'Como proceder ao encontrar noindex sem saber se é proposital?',
 'Qual verificação precede qualquer mudança na diretiva detectada?',
 'Encontramos uma exclusão no código. Devemos preservá-la ou removê-la?',
 'Há um sinal de exclusão no HTML, mas a intenção não foi informada.',
]

def linha(x):return (json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()

def main():
    root=RAIZ/'data/ia/reais';destino=root/'dataset-rodada2-final'
    if destino.exists():raise ValueError('Destino já existe.')
    fontes=[(root/a,root/b) for a,b in ANTIGOS+NOVOS]
    casos,_,falhas=construir(fontes)
    novos={s['dominio'] for a,_ in NOVOS for s in json.loads((root/a/'manifest.json').read_text())['sites']}-EXCLUIDOS
    casos=[c for c in casos if c['grupo'] not in EXCLUIDOS]
    for c in casos:
        if c['grupo'] not in novos:
            c['split']='train'
        else:
            perguntas=PERGUNTAS[c['tipo']][c['split']]
            indice=int(hashlib.sha256((c['grupo']+'|'+c['origem']['url']+'|'+c['tipo']).encode()).hexdigest(),16)%len(perguntas)
            c['entrada']['objetivo']=perguntas[indice]
    grupos={s:{c['grupo'] for c in casos if c['split']==s} for s in ('train','valid','test')}
    if any(grupos[a]&grupos[b] for a,b in [('train','valid'),('train','test'),('valid','test')]):raise ValueError('Domínio cruzou grupos.')
    arquivos={};treino=[]
    fonte_anterior=root/'dataset-03'
    manifesto_antigo=json.loads((fonte_anterior/'manifest.json').read_text())
    arquivo_treino=fonte_anterior/'desenvolvimento/train.jsonl'
    if sha256(arquivo_treino)!=manifesto_antigo['arquivos']['desenvolvimento/train.jsonl']['sha256']:raise ValueError('Treino anterior alterado.')
    treino.extend(arquivo_treino.read_bytes().splitlines(keepends=True))
    aumentos=Counter()
    for split in ('train','valid','test'):
        grupo=[c for c in casos if c['split']==split]
        arquivos[f'casos-{split}.jsonl']=b''.join(linha(c) for c in grupo)
        conversas=[linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in grupo]
        if split!='train':
            arquivos['desenvolvimento/valid.jsonl' if split=='valid' else 'holdout/test.jsonl']=b''.join(conversas)
            continue
        treino.extend(conversas*3)
        for c in grupo:
            frases=AUMENTO_DEMANDA if c['tipo']=='demanda' else AUMENTO_NOINDEX if c['tipo']=='noindex' else []
            repeticoes=2 if c['tipo']=='demanda' else 8
            for frase in frases:
                entrada=deepcopy(c['entrada']);entrada['objetivo']=frase
                mensagem=linha({'messages':mensagens(entrada,c['esperado'])})
                treino.extend([mensagem]*repeticoes);aumentos[c['tipo']]+=repeticoes
    random.Random(20261117).shuffle(treino);arquivos['desenvolvimento/train.jsonl']=b''.join(treino)
    destino.mkdir(mode=0o700)
    for nome,b in arquivos.items():
        p=destino/nome;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with p.open('xb') as f:os.chmod(p,0o600);f.write(b)
    m={'versao':'real-rodada2','origem':'HTML público; sem SERP, contas ou resultados de negócios.',
       'rotulos':'Cheques técnicos fracos, sem revisão independente de especialista.',
       'splits':'Domínios do teste anterior viraram treino. Novos domínios de validação e teste foram atribuídos antes da coleta.',
       'teste_anterior_virou_treino':True,'dominios_com_casos':{s:len(g) for s,g in grupos.items()},
       'contagens':{s:sum(c['split']==s for c in casos) for s in grupos},
       'tipos':{s:dict(Counter(c['tipo'] for c in casos if c['split']==s)) for s in grupos},
       'aumentos_repetidos':dict(aumentos),'treino_total_mensagens':len(treino),
       'manifestos_fonte_sha256':[sha256(a/'manifest.json') for a,b in fontes],
       'reanalises_sha256':[sha256(b) for a,b in fontes],'exclusoes_mesma_empresa':len(EXCLUIDOS),
       'capturas_sem_paginas':len(falhas),
       'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in sorted(arquivos.items())}}
    with (destino/'manifest.json').open('x',encoding='utf-8') as f:os.chmod(destino/'manifest.json',0o600);json.dump(m,f,ensure_ascii=False,indent=2);f.write('\n')
    print(json.dumps({k:m[k] for k in ('contagens','tipos','dominios_com_casos','aumentos_repetidos','treino_total_mensagens')},ensure_ascii=False))

if __name__=='__main__':main()
