"""Combina capturas SERP de treino com o desenvolvimento anterior, sem ler o teste."""
import argparse
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
from reais.inferir_web import sanear_web,entrada_para_modelo

ANTIGO=RAIZ/'data/ia/robustez/dataset-ciclo3-20261115'

def linha(obj):return (json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
def salvar(p,b):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b)
def ler(p):return [json.loads(x) for x in p.read_text().splitlines() if x.strip()]
def normal(s):return ' '.join(s.casefold().split())
def termos(entrada):
    return {normal(e['termo']) for e in entrada.get('evidencias',[]) if isinstance(e,dict)
            and e.get('tipo')=='serp' and isinstance(e.get('termo'),str)}
def converter(c):
    instante=datetime.fromisoformat(c['fonte']['reproducao_em'].replace('Z','+00:00'))
    return {'messages':mensagens(entrada_para_modelo(sanear_web(c['entrada'],agora=instante)),c['esperado'])}

def preparar(origem,destino):
    origem,destino=origem.resolve(),destino.resolve()
    if not origem.is_relative_to((RAIZ/'data').resolve()) or not destino.is_relative_to((RAIZ/'data').resolve()) or destino.exists():
        raise ValueError('Use origem e saída nova dentro de data/.')
    m=json.loads((origem/'manifest.json').read_text());antigo=json.loads((ANTIGO/'manifest.json').read_text())
    for split in ('train','valid'):
        n=f'casos-{split}.jsonl'
        if sha256(origem/n)!=m['arquivos'][n]['sha256']:raise ValueError('Casos novos alterados.')
    for n in ('casos-train.jsonl','casos-valid.jsonl','desenvolvimento/train.jsonl','desenvolvimento/valid.jsonl'):
        if sha256(ANTIGO/n)!=antigo['arquivos'][n]['sha256']:raise ValueError('Dados antigos alterados.')
    novos={s:ler(origem/f'casos-{s}.jsonl') for s in ('train','valid')}
    if not all(novos.values()):raise ValueError('São necessários exemplos reais de treino e de validação antes do ajuste.')
    velhos={s:ler(ANTIGO/f'casos-{s}.jsonl') for s in ('train','valid')}
    grupos={s:{c['entrada'].get('site') for c in novos[s]+velhos[s]} for s in ('train','valid')}
    if grupos['train']&grupos['valid']:raise ValueError('Um domínio aparece no treino e na validação.')
    treino_antigo=ler(ANTIGO/'desenvolvimento/train.jsonl')
    consultas_antigas=set()
    for item in treino_antigo:
        try:consultas_antigas.update(termos(json.loads(item['messages'][1]['content'])))
        except (KeyError,IndexError,TypeError,ValueError):raise ValueError('Conversa antiga inválida.')
    validos=[];repetidos=0
    for c in novos['valid']:
        if termos(c['entrada'])&consultas_antigas:repetidos+=1
        else:validos.append(c)
    if not validos:raise ValueError('Validação real insuficiente após remover consultas já vistas no treino.')
    novos['valid']=validos
    treino=[linha(x) for x in treino_antigo]
    treino += [linha(converter(c)) for c in novos['train'] for _ in range(8)]
    random.Random(20261118).shuffle(treino)
    valid_antigo=(ANTIGO/'desenvolvimento/valid.jsonl').read_bytes().splitlines(keepends=True)
    valid=valid_antigo+[linha(converter(c)) for c in novos['valid']]
    arquivos={'casos-train.jsonl':b''.join(linha(c) for c in velhos['train']+novos['train']),
      'casos-valid.jsonl':b''.join(linha(c) for c in velhos['valid']+novos['valid']),
      'desenvolvimento/train.jsonl':b''.join(treino),'desenvolvimento/valid.jsonl':b''.join(valid)}
    destino.mkdir(mode=0o700)
    for n,b in arquivos.items():salvar(destino/n,b)
    manifesto={'versao':'serp-real-desenvolvimento-v1','origem_manifesto_sha256':sha256(origem/'manifest.json'),
      'anterior_manifesto_sha256':sha256(ANTIGO/'manifest.json'),'gerador_sha256':sha256(Path(__file__)),
      'casos_serp_treino':len(novos['train']),'casos_serp_validacao':len(novos['valid']),
      'consultas_validacao_repetidas_descartadas':repetidos,'repeticoes_treino_serp':8,
      'treino_mensagens':len(treino),'validacao_mensagens':len(valid),
      'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in arquivos.items()},
      'limites':['Teste reservado não é lido por este processo.',
        'Rótulos SERP são preferências editoriais automáticas, não revisão de especialista.',
        'Capturas são históricas durante o treino e não medem impacto comercial.']}
    salvar(destino/'manifest.json',json.dumps(manifesto,ensure_ascii=False,indent=2).encode()+b'\n')
    return manifesto

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('origem',type=Path);p.add_argument('destino',type=Path);a=p.parse_args()
    try:
        m=preparar(a.origem,a.destino)
        print(json.dumps({k:m[k] for k in ('casos_serp_treino','casos_serp_validacao','treino_mensagens','validacao_mensagens')},ensure_ascii=False))
    except ValueError as e:p.error(str(e))
