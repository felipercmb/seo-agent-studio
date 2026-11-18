"""Inclui duas transcrições locais de Google no desenvolvimento, sem simular SerpApi."""
from copy import deepcopy
from datetime import datetime
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
from reais.inferir_web import entrada_para_modelo,sanear_web

ANTIGO=RAIZ/'data/ia/serp-real/dataset-frescor-revisado-20261115'
DESTINO=RAIZ/'data/ia/serp-real/dataset-manual-google-seguro-20261115'
ARQUIVOS=[RAIZ/'data/ia/serp-real/observacao-manual-google-20261115.json',
          RAIZ/'data/ia/serp-real/observacao-manual-google-adore-20261115.json']


def linha(x):return (json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
def escrever(p,b):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b)


def caso_posicao(registro):
    r=registro['resultado'];instante=registro['verificada_em']
    if registro.get('tipo')!='transcricao_manual_pontual' or not isinstance(r.get('posicao'),int):
        raise ValueError('Transcrição de posição inválida.')
    entrada={'site':r['site'],'objetivo':'Qual a posição atual e quais sites estão à frente?',
      'evidencias':[{'id':'s1','tipo':'serp','termo':r['termo'],'pagina':r['url'],
        'posicao':r['posicao'],'atual':True,'observado_em':instante,'estado_fonte':'transcricao_manual',
        'descricao':'Observação manual de uma busca localizada e personalizada; não foi validada pela API.',
        'concorrentes':[{'pagina':c['url'],'posicao':c['posicao']} for c in r['concorrentes_acima']]}],
      'dados_negocio':{'volume_busca':None,'taxa_conversao':None,'margem':None}}
    return {'id':'google-manual-posicao','grupo':r['site'],'tipo':'posicao_manual',
      'entrada':entrada,'esperado':{'acao':'atualizar_coleta','evidencias':['s1']},
      'fonte':{'reproducao_em':instante},'limite':'Transcrição manual localizada sem página de origem identificada para a integração; não demonstra posição validada.'}


def caso_ausencia(registro):
    r=registro['resultado']
    if (registro.get('tipo')!='transcricao_manual_pontual' or r.get('posicao') is not None
            or r.get('estado')!='nao_observado_nas_paginas_examinadas'):
        raise ValueError('Transcrição de recorte inválida.')
    entrada={'site':r['site'],'objetivo':'Depois de cinco páginas, como saber a posição exata?',
      'evidencias':[{'id':'s1','tipo':'serp','termo':r['termo'],'pagina':None,'posicao':None,
        'atual':False,'observado_em':None,'estado_fonte':'desconhecida',
        'descricao':'Transcrição manual sem captura da API: posição exata desconhecida.'}],
      'dados_negocio':{'volume_busca':None,'taxa_conversao':None,'margem':None}}
    return {'id':'google-manual-recorte','grupo':r['site'],'tipo':'recorte_manual',
      'entrada':entrada,'esperado':{'acao':'atualizar_coleta','evidencias':['s1']},
      'fonte':{'reproducao_em':'2026-11-15T13:22:00Z'},
      'limite':'Não observado em cinco páginas; não prova ausência, posição ou domínio acima.'}


def main():
    if DESTINO.exists():raise ValueError('Não sobrescrevendo experimento.')
    anterior=json.loads((ANTIGO/'manifest.json').read_text())
    def antigo(n):
        p=ANTIGO/n
        if sha256(p)!=anterior['arquivos'][n]['sha256']:raise ValueError('Dados anteriores alterados: '+n)
        return p.read_bytes()
    registros=[json.loads(p.read_text()) for p in ARQUIVOS]
    casos=[caso_posicao(registros[0]),caso_ausencia(registros[1])]
    valid=[json.loads(l) for n in ('casos-valid.jsonl','frescor-valid.jsonl','frescor-test.jsonl')
           for l in antigo(n).splitlines() if l.strip()]
    if {c['grupo'] for c in casos}&{c['grupo'] for c in valid}:
        raise ValueError('As observações manuais cruzam grupos reservados.')
    treino=antigo('desenvolvimento/train.jsonl').splitlines(keepends=True)
    objetivos=[['Qual a posição atual e quais sites estão à frente?',
                'Como comparar os resultados observados antes deste site?',
                'Quais concorrentes apareceram acima nessa consulta?'],
               ['Depois de cinco páginas, como saber a posição exata?',
                'O site não apareceu no recorte; qual é a posição atual?',
                'A busca foi examinada até cinco páginas; como confirmar a posição?']]
    for c,perguntas in zip(casos,objetivos):
        instante=datetime.fromisoformat(c['fonte']['reproducao_em'].replace('Z','+00:00'))
        limpa=entrada_para_modelo(sanear_web(c['entrada'],agora=instante))
        for objetivo in perguntas:
            e=deepcopy(limpa);e['objetivo']=objetivo
            treino.extend([linha({'messages':mensagens(e,c['esperado'])})]*12)
    random.Random(20261122).shuffle(treino)
    nomes=['casos-valid.jsonl','casos-valid-sintetico.jsonl','desenvolvimento/valid.jsonl',
           'frescor-valid.jsonl','frescor-test.jsonl']
    arquivos={n:antigo(n) for n in nomes}
    arquivos['casos-train.jsonl']=antigo('casos-train.jsonl')+b''.join(map(linha,casos))
    arquivos['desenvolvimento/train.jsonl']=b''.join(treino)
    for n,b in arquivos.items():escrever(DESTINO/n,b)
    m={'versao':'frescor-com-transcricoes-manuais-1','gerador_sha256':sha256(Path(__file__)),
       'manifesto_anterior_sha256':sha256(ANTIGO/'manifest.json'),
       'registros_sha256':[sha256(p) for p in ARQUIVOS],
       'observacoes_manuais':len(casos),'treino_mensagens':len(treino),
       'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in arquivos.items()},
       'limites':['Transcrições localizadas sem captura identificada são tratadas como posição desconhecida, não como fonte validada.',
         'Casos manuais foram usados para treino; não são teste independente.',
         'Os grupos reservados de frescor são sintéticos; não medem qualidade de SEO ou resultados comerciais.']}
    escrever(DESTINO/'manifest.json',(json.dumps(m,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({k:m[k] for k in ('observacoes_manuais','treino_mensagens')},ensure_ascii=False))


if __name__=='__main__':main()
