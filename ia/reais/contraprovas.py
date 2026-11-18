"""Congela contraprovas sintéticas antes da escolha do segundo ajuste."""
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'v3')]
from runtime import RAIZ,sha256
from contrato_v3 import validar_escolha

NOINDEX=[
 'Uma página diz que não deve ser indexada e o dono não explicou por quê. Como agir?',
 'O sinal no HTML impede indexação. Devemos retirar a regra de imediato?',
 'Qual informação falta antes de mudar a configuração de indexação desta página?',
 'Como tratar uma meta robots de exclusão quando desconhecemos o objetivo da página?',
 'É possível afirmar que a diretiva observada é um defeito?',
 'Antes de editar o código que exclui a URL dos buscadores, qual é a pergunta adequada?',
 'O responsável não informou se esta página deveria ser pública. Qual é a verificação seguinte?',
 'Uma regra noindex foi observada, sem confirmação da finalidade. O que conferir?',
 'O site deve manter ou remover a regra de exclusão descoberta na captura?',
 'Recebi evidência de noindex, mas não sei se essa escolha foi deliberada.',
]
DEMANDA=[
 'O conteúdo capturado comprova que existem pesquisas por essa expressão?',
 'Como saber se o assunto da página é buscado por clientes em potencial?',
 'Há um termo no título. Isso revela o volume de buscas?',
 'Posso apresentar este texto como uma palavra procurada sem dados de pesquisa?',
 'O que falta medir antes de afirmar que existe procura por essa frase?',
 'Como conferir se as palavras desta URL representam uma busca real?',
 'Podemos estimar a demanda a partir do conteúdo sem dados externos?',
 'Ter a expressão no site significa que as pessoas a digitam no Google?',
 'Qual a próxima investigação para não confundir conteúdo com demanda?',
 'Esta palavra aparece na página. Sabemos quantas vezes ela é pesquisada?',
]

def main():
    pasta=RAIZ/'data/ia/reais/contraprovas-rodada2'
    if pasta.exists():raise ValueError('Contraprovas já congeladas.')
    casos=[]
    data=datetime.now(timezone.utc).isoformat()
    for tipo,frases in [('noindex',NOINDEX),('demanda',DEMANDA)]:
        for i,pergunta in enumerate(frases):
            url=f'https://empresa-sintetica-{tipo}-{i}.invalid/'
            corpo=f'<html><head><meta name="robots" content="noindex"><title>Exemplo {i}</title></head></html>'
            e={'id':'p1','tipo':'pagina','pagina':url,'atual':True,'observado_em':data,
               'sha256_pagina':hashlib.sha256(corpo.encode()).hexdigest(),
               'descricao':'Texto fictício criado para a contraprova. Nenhuma métrica de demanda foi medida.'}
            if tipo=='noindex':
                e['descricao']='O HTML fictício contém meta robots noindex. A intenção do responsável é desconhecida.'
                e['verificacao']={'tipo':'meta_robots_noindex','escopo':'html_inicial','intencao':'desconhecida'}
            entrada={'site':f'empresa-sintetica-{tipo}-{i}.invalid','objetivo':pergunta,'evidencias':[e],
                     'dados_negocio':{'volume_busca':None,'taxa_conversao':None,'margem':None}}
            esperado={'acao':'confirmar_publicacao' if tipo=='noindex' else 'validar_demanda','evidencias':['p1']}
            if validar_escolha(esperado,entrada):raise ValueError('Contraprova inválida.')
            casos.append({'id':f'{tipo}-{i}','tipo':tipo,'entrada':entrada,'esperado':esperado})
    pasta.mkdir(mode=0o700);arq=pasta/'casos.jsonl'
    with arq.open('xb') as f:
        os.chmod(arq,0o600)
        for caso in casos:f.write((json.dumps(caso,ensure_ascii=False,sort_keys=True)+'\n').encode())
    manifesto={'versao':1,'natureza':'Totalmente sintético; não representa empresa ou resultado real.',
               'criacao':data,'casos':len(casos),'sha256':sha256(arq),'gerador_sha256':sha256(Path(__file__))}
    with (pasta/'manifest.json').open('x',encoding='utf-8') as f:
        os.chmod(pasta/'manifest.json',0o600);json.dump(manifesto,f,ensure_ascii=False,indent=2);f.write('\n')
    print('Contraprovas sintéticas congeladas:',len(casos))

if __name__=='__main__':main()
