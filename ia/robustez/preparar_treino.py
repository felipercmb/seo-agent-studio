"""Prepara dados locais com entradas reais da interface e teste por domínio reservado."""
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
from contrato_v3 import mensagens

ORIGEM=RAIZ/'data/ia/robustez/interface-ampliada-20261115.jsonl'
ANTIGO=RAIZ/'data/ia/reais/dataset-rodada4-final'
CONTRAS=RAIZ/'data/ia/reais/contraprovas-rodada4'
DESTINO=RAIZ/'data/ia/robustez/dataset-interface-20261115'
OBJETIVOS=[
 'Escolher uma próxima melhoria com as evidências disponíveis. O retorno comercial não foi medido.',
 'Qual é uma próxima revisão útil considerando somente os dados disponíveis?',
 'O que vale investigar agora, sem presumir posição ou retorno?',
 'Indique um próximo passo sustentado pelas evidências desta análise.',
]

def linha(obj):return (json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
def gravar(caminho,dados):
    caminho.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(caminho,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(dados)

def main():
    if DESTINO.exists():raise ValueError('O experimento já existe; escolha um novo destino.')
    m=json.loads(Path(str(ORIGEM)+'.manifest.json').read_text())
    if sha256(ORIGEM)!=m['arquivo_sha256']:raise ValueError('Contextos da interface alterados.')
    reais=[json.loads(l) for l in ORIGEM.read_text().splitlines()]
    grupos={s:{c['grupo'] for c in reais if c['split']==s} for s in ('train','valid','test')}
    if grupos['train']&grupos['valid'] or grupos['train']&grupos['test'] or grupos['valid']&grupos['test']:
        raise ValueError('Domínio repetido entre grupos.')
    anterior=json.loads((ANTIGO/'manifest.json').read_text())
    antigos=[]
    for split in ('train','valid','test'):
        p=ANTIGO/f'casos-{split}.jsonl'
        if sha256(p)!=anterior['arquivos'][p.name]['sha256']:raise ValueError('Casos antigos alterados.')
        for linha_ in p.read_text().splitlines():
            c=json.loads(linha_)
            if c['grupo'] in grupos['valid']|grupos['test']:raise ValueError('Caso antigo cruza domínio reservado.')
            antigos.append(c)
    cm=json.loads((CONTRAS/'manifest.json').read_text())
    if sha256(CONTRAS/'casos.jsonl')!=cm['sha256']:raise ValueError('Contraprovas antigas alteradas.')
    contras=[json.loads(l) for l in (CONTRAS/'casos.jsonl').read_text().splitlines()]
    treino=[linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in antigos]
    treino += [linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in contras for _ in range(2)]
    produtivos=[c for c in reais if c['split']=='train']
    for c in produtivos:
        # Variações neutras não anunciam a ação correta; a primeira é a pergunta da interface.
        objetivos=OBJETIVOS if c['tipo']!='diretiva' else [c['entrada']['objetivo']]
        for objetivo in objetivos:
            entrada=deepcopy(c['entrada']);entrada['objetivo']=objetivo
            treino.extend([linha({'messages':mensagens(entrada,c['esperado'])})]*2)
    random.Random(20261115).shuffle(treino)
    arquivos={}
    for split in ('train','valid','test'):
        cs=[c for c in reais if c['split']==split]
        arquivos[f'casos-{split}.jsonl']=b''.join(map(linha,cs))
        if split in ('valid','test'):
            nome='desenvolvimento/valid.jsonl' if split=='valid' else 'holdout/test.jsonl'
            arquivos[nome]=b''.join(linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in cs)
    arquivos['desenvolvimento/train.jsonl']=b''.join(treino)
    DESTINO.mkdir(mode=0o700)
    for nome,b in arquivos.items():gravar(DESTINO/nome,b)
    manifesto={'versao':'interface-20261115','natureza':'Capturas públicas; rótulos são preferências editoriais, não revisão independente.',
       'reserva':'Todos os casos anteriores, inclusive antigos testes e contraprovas, passaram ao desenvolvimento. Novos domínios foram separados antes das coletas.',
       'reproducao':'As datas originais são preservadas; avaliação simula o instante após cada coleta.',
       'origem_sha256':sha256(ORIGEM),'manifesto_origem_sha256':sha256(Path(str(ORIGEM)+'.manifest.json')),
       'manifesto_anterior_sha256':sha256(ANTIGO/'manifest.json'),'contraprovas_anteriores_sha256':sha256(CONTRAS/'manifest.json'),
       'gerador_sha256':sha256(Path(__file__)),'dominios':{s:len(g) for s,g in grupos.items()},
       'contagens':{s:sum(c['split']==s for c in reais) for s in grupos},
       'tipos_desenvolvimento':{s:dict(Counter(c['tipo'] for c in reais if c['split']==s)) for s in ('train','valid')},
       'treino_mensagens':len(treino),'casos_antigos_para_treino':len(antigos),'contraprovas_antigas_para_treino':len(contras),
       'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in sorted(arquivos.items())}}
    gravar(DESTINO/'manifest.json',(json.dumps(manifesto,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({k:manifesto[k] for k in ('dominios','contagens','tipos_desenvolvimento','treino_mensagens')},ensure_ascii=False))

if __name__=='__main__':main()
