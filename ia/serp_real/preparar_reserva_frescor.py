"""Congela nova reserva sintética depois de examinar o teste da rodada anterior."""
import hashlib
import json
import os
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'serp_real')]
from runtime import RAIZ,sha256
from preparar_frescor import casos,OBJETIVOS,OBJETIVOS_ACOMPANHAR

ANTIGO=RAIZ/'data/ia/serp-real/dataset-manual-google-20261115'
DESTINO=RAIZ/'data/ia/serp-real/dataset-manual-reserva-b-20261115'


def gravar(p,b):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b)


def main():
    if DESTINO.exists():raise ValueError('Reserva já existe.')
    m=json.loads((ANTIGO/'manifest.json').read_text())
    arquivos={}
    for nome,info in m['arquivos'].items():
        b=(ANTIGO/nome).read_bytes()
        if hashlib.sha256(b).hexdigest()!=info['sha256']:raise ValueError('Arquivo anterior alterado: '+nome)
        if nome!='frescor-test.jsonl':arquivos[nome]=b
    grupo='reserva-b'
    OBJETIVOS[grupo]=['Qual é a classificação desta página e que concorrentes aparecem antes?',
      'Como checar a colocação e os outros sites para essa consulta?',
      'Onde o negócio aparece agora e quem está acima no resultado?',
      'Que posição e concorrentes podem ser verificados nessa pesquisa?']
    OBJETIVOS_ACOMPANHAR[grupo]=['Que acompanhamento serve para a colocação observada?',
      'Como monitorar o resultado encontrado nesta consulta?',
      'Qual passo cabe para acompanhar o ranking observado?',
      'O que fazer para acompanhar esta posição de busca?']
    novos=casos(grupo,quantidade=12)
    arquivos['frescor-test.jsonl']=b''.join((json.dumps(c,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode() for c in novos)
    for nome,b in arquivos.items():gravar(DESTINO/nome,b)
    registro={'versao':'reserva-frescor-b','manifesto_anterior_sha256':sha256(ANTIGO/'manifest.json'),
      'gerador_sha256':sha256(Path(__file__)),'gerador_cenarios_sha256':sha256(IA/'serp_real/preparar_frescor.py'),
      'teste_casos':len(novos),'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in arquivos.items()},
      'limites':['Reserva sintética; não representa posições reais ou revisão especializada.',
        'Teste anterior foi examinado e não pode ser tratado como independente para novas escolhas.',
        'Casos de mesmo tipo usam modelos de perguntas semelhantes.']}
    gravar(DESTINO/'manifest.json',(json.dumps(registro,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({'teste_casos':len(novos),'grupos':len({c['grupo'] for c in novos})},ensure_ascii=False))


if __name__=='__main__':main()
