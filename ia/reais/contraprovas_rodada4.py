"""Congela novas perguntas sintéticas de demanda e intenção de publicação."""
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
  'O código recebido orienta buscadores a excluir esta URL; a equipe não esclareceu por quê. Qual a primeira providência?',
  'Devo remover a instrução de exclusão se ninguém confirmou que a página é pública?',
  'Uma meta noindex aparece no HTML e não há confirmação sobre a finalidade da página.',
  'É possível classificar a regra de não indexar como intencional sem falar com o responsável?',
  'Qual decisão vem antes de modificar uma diretiva que pode impedir indexação?',
  'Há uma instrução que desaconselha indexar; não sabemos se o site pretendia ocultar esta URL.',
  'Como diferenciar erro e escolha proposital quando vemos noindex sem contexto?',
  'A análise detectou uma exclusão de buscadores. O que deve ser confirmado?',
  'Esta página tem uma regra de exclusão e sua finalidade não foi informada. Como agir?',
  'Podemos concluir pela correção da diretiva de indexação sem conhecer a intenção?',
  'Uma regra robots impede a indexação. Qual pergunta deve anteceder uma alteração?',
  'O responsável ainda não disse se o conteúdo deveria estar disponível em buscadores; há noindex no HTML.'],
 'demanda':[
  'O fato de a frase ter sido escrita confirma que alguém a utiliza em buscas?',
  'Que evidência falta para dizer que o termo desta página recebe pesquisas?',
  'A página lista uma expressão. Isso fornece a frequência de pesquisas?',
  'Como averiguar se o público está procurando esta oferta na internet?',
  'Só com o conteúdo podemos concluir que existe procura pelo tema?',
  'Este termo é uma busca comprovada ou uma hipótese extraída da página?',
  'Que fonte devemos procurar para não deduzir demanda do título?',
  'A ocorrência do texto no HTML estabelece o interesse de quem pesquisa?',
  'Quantas buscas a frase recebe: sabemos isso pela captura do site?',
  'Como validar a existência de pesquisas ligadas à expressão descoberta?',
  'Pessoas procuram esse serviço ou sabemos apenas que ele aparece no site?',
  'O que medir antes de chamar este trecho de palavra-chave com demanda?'],
}

def main():
    pasta=RAIZ/'data/ia/reais/contraprovas-rodada4'
    if pasta.exists():raise ValueError('Contraprovas já congeladas.')
    data=datetime.now(timezone.utc).isoformat();casos=[]
    for tipo,frases in PERGUNTAS.items():
        for i,pergunta in enumerate(frases):
            identidade=('p1','d1','p2')[i%3];url=f'https://ficticio-r4-{tipo}-{i}.invalid/'
            html=f'<html><head><meta name="robots" content="noindex"><title>Exemplo {i}</title></head></html>'
            e={'id':identidade,'tipo':'pagina','pagina':url,'atual':True,'observado_em':data,
               'sha256_pagina':hashlib.sha256(html.encode()).hexdigest(),
               'descricao':'Página fictícia, sem dados de procura.'}
            if tipo=='noindex':
                e['descricao']='O HTML fictício contém meta robots noindex. A intenção de publicação é desconhecida.'
                e['verificacao']={'tipo':'meta_robots_noindex','escopo':'html_inicial','intencao':'desconhecida'}
            entrada={'site':f'ficticio-r4-{tipo}-{i}.invalid','objetivo':pergunta,'evidencias':[e],
                     'dados_negocio':{'volume_busca':None,'taxa_conversao':None,'margem':None}}
            esperado={'acao':'confirmar_publicacao' if tipo=='noindex' else 'validar_demanda','evidencias':[identidade]}
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
