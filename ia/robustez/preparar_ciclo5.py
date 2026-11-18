"""Inclui no desenvolvimento a antiga reserva já examinada, com novo teste externo pendente."""
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

ANTIGO=RAIZ/'data/ia/robustez/dataset-ciclo4-20261115'
REAL=RAIZ/'data/ia/robustez/interface-ciclo4-reserva-20261115.jsonl'
DESTINO=RAIZ/'data/ia/robustez/dataset-ciclo5-20261115'
def linha(x):return (json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
def ler(p):return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
def gravar(p,b):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b)
def main():
    if DESTINO.exists():raise ValueError('Não sobrescrevendo experimento.')
    antigo=json.loads((ANTIGO/'manifest.json').read_text());real=json.loads(Path(str(REAL)+'.manifest.json').read_text())
    if sha256(REAL)!=real['arquivo_sha256']:raise ValueError('Antiga reserva alterada.')
    def anterior(n):
        p=ANTIGO/n
        if sha256(p)!=antigo['arquivos'][n]['sha256']:raise ValueError('Dados anteriores alterados: '+n)
        return p
    treinados=ler(anterior('casos-train.jsonl'));valid=ler(anterior('casos-valid.jsonl'));vistos=ler(REAL)
    for c in vistos:c['split']='train'
    gt={c['grupo'] for c in treinados+vistos};gv={c['grupo'] for c in valid}
    if gt&gv:raise ValueError('Domínios de treino e validação se cruzam.')
    treino=anterior('desenvolvimento/train.jsonl').read_bytes().splitlines(keepends=True)
    for c in vistos:
        if c['tipo']=='sem_dados':continue
        objetivos=[c['entrada']['objetivo']]
        if c['tipo']!='diretiva':objetivos += ['Qual próximo passo é sustentado pelas evidências disponíveis?',
          'O que vale investigar agora sem supor resultados comerciais?']
        for objetivo in objetivos:
            entrada=deepcopy(c['entrada']);entrada['objetivo']=objetivo
            treino.extend([linha({'messages':mensagens(entrada,c['esperado'])})]*3)
    random.Random(20261120).shuffle(treino)
    arquivos={'casos-train.jsonl':b''.join(linha(c) for c in treinados+vistos),
      'casos-valid.jsonl':anterior('casos-valid.jsonl').read_bytes(),
      'casos-valid-sintetico.jsonl':anterior('casos-valid-sintetico.jsonl').read_bytes(),
      'desenvolvimento/train.jsonl':b''.join(treino),
      'desenvolvimento/valid.jsonl':anterior('desenvolvimento/valid.jsonl').read_bytes()}
    DESTINO.mkdir(mode=0o700)
    for n,b in arquivos.items():gravar(DESTINO/n,b)
    m={'versao':'interface-ciclo5','origem_sha256':sha256(REAL),'origem_manifesto_sha256':sha256(Path(str(REAL)+'.manifest.json')),
      'manifesto_anterior_sha256':sha256(ANTIGO/'manifest.json'),'gerador_sha256':sha256(Path(__file__)),
      'antiga_reserva_treino':len(vistos),'antiga_reserva_com_dados':sum(c['tipo']!='sem_dados' for c in vistos),
      'treino_mensagens':len(treino),'grupos':{'train':len(gt),'valid':len(gv)},
      'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in arquivos.items()},
      'limites':['A reserva anterior foi examinada e agora é treinamento, não teste.',
        'Páginas públicas sem posições atuais do Google ou dados comerciais.',
        'Rótulos são preferências editoriais não revisadas por especialista.']}
    gravar(DESTINO/'manifest.json',(json.dumps(m,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({k:m[k] for k in ('antiga_reserva_treino','antiga_reserva_com_dados','treino_mensagens','grupos')},ensure_ascii=False))
if __name__=='__main__':main()
