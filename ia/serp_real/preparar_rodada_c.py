"""Promove casos examinados ao desenvolvimento e congela nova reserva sintética."""
from copy import deepcopy
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import random
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'v3'),str(IA/'serp_real')]
from runtime import RAIZ,sha256
from contrato_v3 import mensagens
from reais.inferir_web import entrada_para_modelo,sanear_web
from avaliar_manual_google import REGISTROS,entrada
from preparar_frescor import casos,OBJETIVOS,OBJETIVOS_ACOMPANHAR

ANTIGO=RAIZ/'data/ia/serp-real/dataset-manual-google-seguro-20261115'
DESTINO=RAIZ/'data/ia/serp-real/dataset-rodada-segura-20261115'
ORIGEM=RAIZ/'data/ia/serp-real'


def linha(x):return (json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
def gravar(p,b):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b)


def main():
    if DESTINO.exists():raise ValueError('Rodada já existe.')
    m=json.loads((ANTIGO/'manifest.json').read_text())
    def antigo(n):
        b=(ANTIGO/n).read_bytes()
        if hashlib.sha256(b).hexdigest()!=m['arquivos'][n]['sha256']:raise ValueError('Fonte alterada: '+n)
        return b
    vistos=[json.loads(x) for x in antigo('frescor-test.jsonl').splitlines() if x.strip()]
    treino=antigo('desenvolvimento/train.jsonl').splitlines(keepends=True)
    for c in vistos:
        instante=datetime.fromisoformat(c['fonte']['reproducao_em'].replace('Z','+00:00'))
        e=entrada_para_modelo(sanear_web(c['entrada'],agora=instante))
        treino.extend([linha({'messages':mensagens(e,c['esperado'])})]*4)
    perguntas={
      'posicao_local':['Qual a posição observada e quais sites estavam à frente?',
        'Quais sites apareceram antes na mesma consulta?', 'Como comparar os resultados que ficaram acima?'],
      'recorte_sem_posicao':['Depois das páginas examinadas, como saber a posição exata?',
        'O site não foi observado no recorte; como confirmar sua colocação?', 'Qual é a posição atual após essa busca parcial?'],
      'marca_local':['Como acompanhar a posição observada para a marca?',
        'Como monitorar a colocação encontrada para a marca?', 'Qual próximo passo para acompanhar o resultado já observado?']}
    manuais=[]
    for nome,arquivo,esperado,objetivo in REGISTROS:
        p=ORIGEM/arquivo;r=json.loads(p.read_text());base=entrada(r,objetivo);alvo={'acao':esperado,'evidencias':['s1']}
        manuais.append({'caso':nome,'registro_sha256':sha256(p),'acao':esperado})
        for pergunta in perguntas[nome]:
            e=deepcopy(base);e['objetivo']=pergunta
            treino.extend([linha({'messages':mensagens(e,alvo)})]*12)
    random.Random(20261124).shuffle(treino)
    grupo='reserva-segura'
    OBJETIVOS[grupo]=['Qual a colocação do site e que domínios aparecem antes?',
      'Quais resultados ficam à frente desta página nesta pesquisa?',
      'Onde o domínio aparece na busca e quais são seus concorrentes?',
      'Que páginas superam este resultado na consulta?']
    OBJETIVOS_ACOMPANHAR[grupo]=['Qual rotina ajuda a acompanhar essa presença observada?',
      'Como seguir a evolução da posição já registrada?',
      'O que fazer para monitorar o resultado ao longo do tempo?',
      'Que acompanhamento é possível para essa colocação?']
    reserva=casos(grupo,quantidade=12)
    arquivos={n:antigo(n) for n in ('casos-valid.jsonl','casos-valid-sintetico.jsonl','desenvolvimento/valid.jsonl','frescor-valid.jsonl')}
    arquivos['casos-train.jsonl']=antigo('casos-train.jsonl')+b''.join(map(linha,vistos))
    arquivos['desenvolvimento/train.jsonl']=b''.join(treino)
    arquivos['frescor-test.jsonl']=b''.join(map(linha,reserva))
    for n,b in arquivos.items():gravar(DESTINO/n,b)
    meta={'versao':'rodada-c','manifesto_anterior_sha256':sha256(ANTIGO/'manifest.json'),
      'gerador_sha256':sha256(Path(__file__)),'casos_anteriores_promovidos_a_treino':len(vistos),
      'registros_manuais_em_desenvolvimento':manuais,'treino_mensagens':len(treino),'teste_sintetico':len(reserva),
      'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in arquivos.items()},
      'limites':['Casos anteriormente examinados foram usados no treinamento e não são teste.',
        'Transcrições são manuais e não autenticadas. O novo teste é fictício e suas perguntas são relacionadas.',
        'Referências editoriais não comprovam resultados ou revisão especializada.']}
    gravar(DESTINO/'manifest.json',(json.dumps(meta,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({k:meta[k] for k in ('casos_anteriores_promovidos_a_treino','treino_mensagens','teste_sintetico')},ensure_ascii=False))


if __name__=='__main__':main()
