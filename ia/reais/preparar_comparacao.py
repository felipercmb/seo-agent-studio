"""Pares reais e espelhados: evidência observada versus dado não medido."""

import argparse
from collections import Counter,defaultdict
from copy import deepcopy
from datetime import datetime,timedelta
import hashlib
from itertools import combinations
import json
import os
from pathlib import Path
import random
import sys

IA=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(IA))
sys.path.insert(0,str(IA/'v2'))
from runtime import RAIZ,sha256
from inferir_v2 import sanear
from comparacao.contrato import mensagens
from comparacao.inferir import preparar_par


def linha(objeto):
    return (json.dumps(objeto,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()


def preparar(entrada,instante):
    return sanear(deepcopy(entrada),agora=instante)


def construir(origem):
    origem=Path(origem)
    manifest=json.loads((origem/'manifest.json').read_text(encoding='utf-8'))
    todos=[]
    for split in ('train','valid','test'):
        arquivo=origem/f'casos-{split}.jsonl'
        if sha256(arquivo)!=manifest['arquivos'][arquivo.name]['sha256']:
            raise ValueError('Casos da fonte alterados.')
        casos=[json.loads(l) for l in arquivo.read_text(encoding='utf-8').splitlines()]
        paginas=defaultdict(dict); alertas={}
        for c in casos:
            dominio,url=c['grupo'],c['origem']['url']
            if c['tipo']=='serp': paginas[dominio][url]=c
            if c['tipo'] in ('h1','noindex'): alertas[(dominio,url)]=c
        for dominio,por_url in sorted(paginas.items()):
            for url_a,url_b in combinations(sorted(por_url),2):
                a,b=por_url[url_a],por_url[url_b]
                momento=max(datetime.fromisoformat(a['origem']['coletadoEm'].replace('Z','+00:00')),
                            datetime.fromisoformat(b['origem']['coletadoEm'].replace('Z','+00:00'))) + timedelta(seconds=1)
                base_a,base_b=preparar(a['entrada'],momento),preparar(b['entrada'],momento)
                tarefas=[('sem_diferenca_observada',base_a,base_b,'insuficiente')]
                alerta_a,alerta_b=alertas.get((dominio,url_a)),alertas.get((dominio,url_b))
                if bool(alerta_a)!=bool(alerta_b):
                    pa,pb=deepcopy(base_a),deepcopy(base_b)
                    escolhido=alerta_a or alerta_b
                    pagina=(pa if alerta_a else pb)
                    # O achado real substitui o trecho genérico do mesmo endereço.
                    pagina['evidencias']=[e for e in pagina['evidencias'] if e['tipo']!='pagina']
                    pagina['evidencias'].append(deepcopy(escolhido['entrada']['evidencias'][0]))
                    tarefas.append(('um_achado_verificado',pa,pb,'a' if alerta_a else 'b'))
                for tipo,primeiro,segundo,alvo in tarefas:
                    chave=hashlib.sha256((dominio+'|'+url_a+'|'+url_b+'|'+tipo).encode()).hexdigest()[:20]
                    for invertido in (False,True):
                        esquerda,direita=(segundo,primeiro) if invertido else (primeiro,segundo)
                        esperado='insuficiente' if alvo=='insuficiente' else ('b' if alvo=='a' else 'a') if invertido else alvo
                        todos.append({'id':f'par-{chave}-{int(invertido)}','par':'par-'+chave,'split':split,
                                      'grupo':dominio,'tipo':tipo,'entrada':preparar_par(esquerda,direita),
                                      'esperado':{'escolha':esperado},
                                      'limite':'Rótulo técnico fraco de prioridade de investigação; não mede impacto ou retorno.'})
    if len({c['id'] for c in todos})!=len(todos): raise ValueError('Pares duplicados.')
    if not all(any(c['split']==s for c in todos) for s in ('train','valid','test')):
        raise ValueError('Não há pares reais nos três grupos.')
    return todos


def escrever(origem,saida):
    origem,saida=Path(origem).resolve(),Path(saida).resolve()
    if saida.exists(): raise ValueError('Destino já existe.')
    if not saida.is_relative_to((RAIZ/'data').resolve()): raise ValueError('Dados reais devem permanecer em data/.')
    casos=construir(origem); arquivos={}
    for split in ('train','valid','test'):
        grupo=[c for c in casos if c['split']==split]
        arquivos[f'casos-{split}.jsonl']=b''.join(linha(c) for c in grupo)
        mensagens_reais=[linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in grupo]
        if split=='train':
            antigo=(IA/'comparacao/dados/desenvolvimento/train.jsonl').read_bytes().splitlines(keepends=True)
            treino=antigo+mensagens_reais*8
            random.Random(20261115).shuffle(treino)
            arquivos['desenvolvimento/train.jsonl']=b''.join(treino)
        else:
            nome='desenvolvimento/valid.jsonl' if split=='valid' else 'holdout/test.jsonl'
            arquivos[nome]=b''.join(mensagens_reais)
    saida.mkdir(parents=True,mode=0o700)
    for nome,conteudo in arquivos.items():
        arq=saida/nome;arq.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with arq.open('xb') as f:os.chmod(arq,0o600);f.write(conteudo)
    m={'versao':1,'fonte_sha256':sha256(origem/'manifest.json'),
       'origem':'Páginas públicas reais, sem posições Google ou dados comerciais.',
       'rotulos':'Rótulos técnicos fracos; não foram revisados por especialista.',
       'contagens':dict(Counter(c['split'] for c in casos)),
       'pares':{s:len({c['par'] for c in casos if c['split']==s}) for s in ('train','valid','test')},
       'dominios':{s:len({c['grupo'] for c in casos if c['split']==s}) for s in ('train','valid','test')},
       'tipos':{s:dict(Counter(c['tipo'] for c in casos if c['split']==s)) for s in ('train','valid','test')},
       'repeticoes_reais':8,'sinteticos_sha256':sha256(IA/'comparacao/dados/desenvolvimento/train.jsonl'),
       'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in sorted(arquivos.items())}}
    with (saida/'manifest.json').open('x',encoding='utf-8') as f:
        os.chmod(saida/'manifest.json',0o600);json.dump(m,f,ensure_ascii=False,indent=2);f.write('\n')
    return m


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--origem',type=Path,required=True);p.add_argument('--saida',type=Path,required=True)
    a=p.parse_args();m=escrever(a.origem,a.saida)
    print(json.dumps({k:m[k] for k in ('contagens','pares','dominios','tipos')},ensure_ascii=False))
