"""Adiciona regressões sintéticas já observadas e preserva o teste real original."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import sys

IA=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(IA))
sys.path.insert(0,str(IA/'v3'))
from runtime import RAIZ,sha256
from contrato_v3 import mensagens,validar_escolha

ALVOS={
    'v3-s01':('preservar_exclusao',['p1']),'v3-s02':('preservar_exclusao',['p1']),
    'v3-s03':('confirmar_publicacao',['p1']),'v3-s04':('confirmar_publicacao',['p1']),
    'v3-s05':('atualizar_coleta',['s1']),'v3-s06':('atualizar_coleta',['s1']),
    'v3-s07':('atualizar_coleta',['s1']),'v3-s08':('atualizar_coleta',['s1']),
    'v3-s09':('validar_demanda',[]),'v3-s10':('validar_demanda',['p1']),
    'v3-s11':('validar_demanda',['p1']),'v3-s12':('atualizar_coleta',['p1']),
    'v3-s13':('medir_conversao',['n1']),'v3-s14':('medir_conversao',['n1']),
    'v3-s16':('medir_conversao',['p1']),
}
H1_TEXTO=(
    'O HTML inicial não contém elemento h1; o navegador com JavaScript não foi avaliado.',
    'Na captura HTML não há h1. A versão renderizada ainda precisa ser conferida.',
    'Não foi encontrado título principal h1 no HTML inicial desta URL.',
    'O código recebido não contém h1; isto não prova a causa da posição no Google.',
    'Nenhuma marcação h1 aparece no HTML recebido, antes da execução de scripts.',
)


def linha(valor):
    return (json.dumps(valor,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()


def criar(origem,saida):
    origem=Path(origem).resolve();saida=Path(saida).resolve()
    if saida.exists(): raise ValueError('Destino já existe.')
    if not saida.is_relative_to((RAIZ/'data').resolve()): raise ValueError('Dados reais devem permanecer em data/.')
    anterior=json.loads((origem/'manifest.json').read_text(encoding='utf-8'))
    for nome,info in anterior['arquivos'].items():
        if sha256(origem/nome)!=info['sha256']: raise ValueError('Fonte alterada: '+nome)
    estresse=IA/'v3/casos_estresse.jsonl'
    if sha256(estresse)!='62bd245f78842e10ddb55fa44e75c6622d259119f10a3ca96b6557a26147b48c':
        raise ValueError('Contraprovas v3 divergentes.')
    conhecidas=[json.loads(l) for l in estresse.read_text(encoding='utf-8').splitlines()]
    regressao=[]
    for c in conhecidas:
        if c['id'] not in ALVOS: continue
        acao,refs=ALVOS[c['id']];alvo={'acao':acao,'evidencias':refs}
        erros=validar_escolha(alvo,c['entrada'])
        if erros: raise ValueError(f"Rótulo de regressão inválido {c['id']}: {erros}")
        regressao.extend(linha({'messages':mensagens(c['entrada'],alvo)}) for _ in range(4))
    for i,texto in enumerate(H1_TEXTO):
        for variante in range(6):
            entrada={'site':f'exemplo-h1-{i}-{variante}.invalid',
                     'objetivo':'Qual melhoria deve ser conferida na estrutura HTML inicial?',
                     'evidencias':[{'id':'p1','tipo':'pagina','pagina':f'https://exemplo-h1-{i}-{variante}.invalid/',
                                    'atual':True,'descricao':texto}],
                     'dados_negocio':{'volume_busca':None,'taxa_conversao':None,'margem':None}}
            alvo={'acao':'melhorar_pagina','evidencias':['p1']}
            regressao.append(linha({'messages':mensagens(entrada,alvo)}))
    treino=(origem/'desenvolvimento/train.jsonl').read_bytes().splitlines(keepends=True)+regressao
    random.Random(20261115).shuffle(treino)
    arquivos={nome:(origem/nome).read_bytes() for nome in anterior['arquivos'] if nome!='desenvolvimento/train.jsonl'}
    arquivos['desenvolvimento/train.jsonl']=b''.join(treino)
    manifesto={**anterior,'versao':'real-03', 'base_dataset_sha256':sha256(origem/'manifest.json'),
               'regressoes_sinteticas_ja_observadas':{'familias_v3':len(ALVOS),'repeticoes_por_familia':4,
                                                        'h1_familias':len(H1_TEXTO),'h1_variantes':6,
                                                        'arquivo_sha256':sha256(estresse)},
               'treino_total_mensagens':len(treino),
               'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in sorted(arquivos.items())}}
    saida.mkdir(parents=True,mode=0o700)
    for nome,conteudo in arquivos.items():
        caminho=saida/nome;caminho.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with caminho.open('xb') as f:
            os.chmod(caminho,0o600);f.write(conteudo)
    with (saida/'manifest.json').open('x',encoding='utf-8') as f:
        os.chmod(saida/'manifest.json',0o600);json.dump(manifesto,f,ensure_ascii=False,indent=2);f.write('\n')
    return manifesto


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--origem',type=Path,required=True);p.add_argument('--saida',type=Path,required=True)
    a=p.parse_args();m=criar(a.origem,a.saida)
    print(json.dumps({'contagens_reais':m['contagens'],'dominios':m['dominios_com_casos'],
                      'mensagens_treino':m['treino_total_mensagens']},ensure_ascii=False))
