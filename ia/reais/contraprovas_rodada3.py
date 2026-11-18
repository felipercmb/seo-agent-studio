"""Reserva novas formulações sintéticas, distintas das contraprovas já usadas no treino."""
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

PERGUNTAS={
 'noindex':[
  'A captura contém uma exclusão de indexação sem explicação. Qual informação pedir antes de agir?',
  'A página deveria constar nos buscadores? O responsável ainda não respondeu.',
  'Vimos noindex em uma URL, mas não conhecemos o plano de publicação. Qual a próxima etapa?',
  'O HTML restringe indexação; podemos removê-la sem saber se era necessária?',
  'Que confirmação é necessária antes de tratar a meta robots como falha?',
  'Uma exclusão pode ser deliberada. Como proceder quando não sabemos a intenção?',
  'O que fazer ao observar uma diretiva que impede indexação de finalidade desconhecida?',
  'Antes de recomendar qualquer mudança na regra noindex, o que deve ser esclarecido?',
  'Foi capturada uma orientação de não indexar. Falta confirmar algo com o dono?',
  'A diretriz de indexação desta página precisa ser apagada ou mantida?',
  'A regra que exclui a URL dos resultados foi intencional? Não temos essa informação.',
  'É seguro preservar ou corrigir esta exclusão sem consultar o responsável?'],
 'demanda':[
  'O trecho encontrado confirma que há pessoas procurando essas palavras?',
  'O que falta para demonstrar procura por este tema em pesquisas?',
  'Um termo no HTML comprova volume de consultas para ele?',
  'Podemos afirmar que este assunto é buscado pelo público usando só a página?',
  'Qual passo ajuda a distinguir uma frase do site de uma busca real?',
  'A existência do título mede quantas vezes esse assunto é pesquisado?',
  'Como obter evidência de que usuários procuram pela expressão capturada?',
  'Existe procura ou sabemos somente que o texto foi escrito nesta URL?',
  'Uma palavra listada na página basta para mostrar o interesse do mercado?',
  'Que fonte pode ajudar a confirmar se a expressão gera buscas?',
  'A quantidade de pessoas procurando o tema é conhecida a partir deste HTML?',
  'O conteúdo é prova suficiente de demanda para o termo que ele contém?'],
}

def main():
    pasta=RAIZ/'data/ia/reais/contraprovas-rodada3'
    if pasta.exists():raise ValueError('Contraprovas já congeladas.')
    data=datetime.now(timezone.utc).isoformat();casos=[]
    for tipo,frases in PERGUNTAS.items():
        for i,pergunta in enumerate(frases):
            url=f'https://teste-ficticio-r3-{tipo}-{i}.invalid/'
            html=f'<html><head><meta name="robots" content="noindex"><title>Fictício {i}</title></head></html>'
            e={'id':'p1','tipo':'pagina','pagina':url,'atual':True,'observado_em':data,
               'sha256_pagina':hashlib.sha256(html.encode()).hexdigest(),
               'descricao':'Página fictícia; nenhuma medida de procura está disponível.'}
            if tipo=='noindex':
                e['descricao']='HTML fictício com meta robots noindex; intenção do responsável desconhecida.'
                e['verificacao']={'tipo':'meta_robots_noindex','escopo':'html_inicial','intencao':'desconhecida'}
            entrada={'site':f'teste-ficticio-r3-{tipo}-{i}.invalid','objetivo':pergunta,'evidencias':[e],
                     'dados_negocio':{'volume_busca':None,'taxa_conversao':None,'margem':None}}
            esperado={'acao':'confirmar_publicacao' if tipo=='noindex' else 'validar_demanda','evidencias':['p1']}
            if validar_escolha(esperado,entrada):raise ValueError('Contraprova inválida.')
            casos.append({'id':f'{tipo}-{i}','tipo':tipo,'entrada':entrada,'esperado':esperado})
    pasta.mkdir(mode=0o700);arq=pasta/'casos.jsonl'
    with arq.open('xb') as f:
        os.chmod(arq,0o600)
        for c in casos:f.write((json.dumps(c,ensure_ascii=False,sort_keys=True)+'\n').encode())
    m={'versao':1,'natureza':'Totalmente sintético; não representa empresa ou resultado real.',
       'criacao':data,'casos':len(casos),'sha256':sha256(arq),'gerador_sha256':sha256(Path(__file__))}
    with (pasta/'manifest.json').open('x',encoding='utf-8') as f:
        os.chmod(pasta/'manifest.json',0o600);json.dump(m,f,ensure_ascii=False,indent=2);f.write('\n')
    print('Contraprovas sintéticas novas:',len(casos))

if __name__=='__main__':main()
