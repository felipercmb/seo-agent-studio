"""Segundo ciclo: contrabalança exemplos da interface com sinais SERP fictícios."""
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
from contrato_v3 import mensagens,validar_escolha
from reais.inferir_web import bloqueios_web,barreiras_web

ORIGEM=RAIZ/'data/ia/robustez/dataset-interface-20261115'
DESTINO=RAIZ/'data/ia/robustez/dataset-equilibrado-20261115'
ANTIGO=IA/'v3/dados/casos-train.jsonl'

def linha(x):return (json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
def gravar(p,b):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b)

def exemplos_sinteticos():
    casos=[];tipos=['demanda','diagnostico','atualizar','comparar','acompanhar']
    for tipo in tipos:
      for i in range(40):
        site=f'exemplo-equilibrio-{tipo}-{i}.invalid';url=f'https://{site}/oferta'
        page={'id':'p1','tipo':'pagina','pagina':url,'atual':True,'observado_em':'2026-11-14T12:00:00Z',
          'sha256_pagina':hashlib.sha256(url.encode()).hexdigest(),
          'descricao':['Página apresenta um curso fictício.','Página descreve uma oficina fictícia.',
                       'Página publica um produto fictício.','Página descreve uma clínica fictícia.'][i%4]}
        serp={'id':'s1','tipo':'serp','pagina':url,'termo':['curso fictício','oficina fictícia','produto fictício','serviço fictício'][i%4],
          'posicao':None,'atual':False,'observado_em':None,'estado_fonte':'nao_configurada',
          'descricao':'Fonte de posições não está configurada; posição e concorrentes são desconhecidos.'}
        objetivo='Escolher uma próxima melhoria com as evidências disponíveis. O retorno comercial não foi medido.'
        ev=[serp,page]
        if tipo=='demanda':
            alvo={'acao':'validar_demanda','evidencias':['p1']}
        elif tipo=='diagnostico':
            diag={**page,'id':'d1','descricao':['Nenhum h1 textual foi identificado no HTML inicial.',
                'Há imagens sem alternativa textual declarada.',
                'O HTML inicial não apresentou um título identificável.',
                'Um controle visível não apresentou nome acessível identificável.'][i%4]}
            ev.append(diag);alvo={'acao':'melhorar_pagina','evidencias':['d1']}
        elif tipo=='atualizar':
            objetivo=['O que falta para saber a posição atual neste termo?',
              'Qual o próximo passo para verificar concorrentes no Google?',
              'Como consultar a posição sem uma fonte configurada?',
              'Antes de informar a ordem dos resultados, o que verificar?'][i%4]
            alvo={'acao':'atualizar_coleta','evidencias':['s1']}
        else:
            serp.update(atual=True,observado_em='2026-11-14T12:00:00Z',estado_fonte='consultavel_ou_parcial',
              posicao=[8,17,29,46,82][i%5] if tipo=='comparar' else [1,2,3][i%3],
              descricao='Posição simulada na mesma consulta, dispositivo e local.')
            if tipo=='comparar':
                serp['concorrentes']=[{'pagina':'https://outra-empresa.invalid/','posicao':2}]
                alvo={'acao':'comparar_concorrentes','evidencias':['s1']}
            else:alvo={'acao':'acompanhar','evidencias':['s1']}
        entrada={'site':site,'objetivo':objetivo,'evidencias':ev,
          'dados_negocio':{'volume_busca':None,'taxa_conversao':None,'margem':None}}
        if validar_escolha(alvo,entrada) or bloqueios_web(alvo,entrada) or barreiras_web(alvo,entrada):
            raise ValueError('Exemplo sintético incompatível: '+tipo)
        casos.append({'entrada':entrada,'esperado':alvo})
    return casos

def main():
    if DESTINO.exists():raise ValueError('Não sobrescrevendo experimento.')
    ant=json.loads((ORIGEM/'manifest.json').read_text());arquivos={}
    for nome in ('casos-train.jsonl','casos-valid.jsonl','casos-test.jsonl','desenvolvimento/valid.jsonl','holdout/test.jsonl'):
        b=(ORIGEM/nome).read_bytes()
        if hashlib.sha256(b).hexdigest()!=ant['arquivos'][nome]['sha256']:raise ValueError('Origem alterada: '+nome)
        arquivos[nome]=b
    b=(ORIGEM/'desenvolvimento/train.jsonl').read_bytes()
    if hashlib.sha256(b).hexdigest()!=ant['arquivos']['desenvolvimento/train.jsonl']['sha256']:raise ValueError('Treino anterior alterado.')
    treino=b.splitlines(keepends=True)
    sinteticos=exemplos_sinteticos()
    treino.extend(linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in sinteticos for _ in range(3))
    anteriores=[]
    for texto in ANTIGO.read_text().splitlines():
        c=json.loads(texto)
        if c['esperado']['acao'] not in ('acompanhar','comparar_concorrentes','validar_intencao'):continue
        if validar_escolha(c['esperado'],c['entrada']) or bloqueios_web(c['esperado'],c['entrada']) or barreiras_web(c['esperado'],c['entrada']):continue
        anteriores.append(c)
    treino.extend(linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in anteriores for _ in range(2))
    random.Random(20261116).shuffle(treino);arquivos['desenvolvimento/train.jsonl']=b''.join(treino)
    DESTINO.mkdir(mode=0o700)
    for nome,dados in arquivos.items():gravar(DESTINO/nome,dados)
    m={'versao':'interface-equilibrada-20261115','origem_manifesto_sha256':sha256(ORIGEM/'manifest.json'),
       'casos_sinteticos_novos':len(sinteticos),'repeticoes_sinteticos':3,
       'casos_sinteticos_antigos':len(anteriores),'repeticoes_antigos':2,'arquivo_sintetico_antigo_sha256':sha256(ANTIGO),
       'treino_mensagens':len(treino),'validacao':'Mesmos domínios usados para desenvolvimento e seleção.',
       'reserva':'O teste original permanece fechado, sem novos exemplos desses domínios no treinamento.',
       'limite':'Posições e concorrentes dos novos exemplos são inteiramente fictícios.',
       'gerador_sha256':sha256(Path(__file__)),
       'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in sorted(arquivos.items())}}
    gravar(DESTINO/'manifest.json',(json.dumps(m,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({k:m[k] for k in ('casos_sinteticos_novos','casos_sinteticos_antigos','treino_mensagens')},ensure_ascii=False))

if __name__=='__main__':main()
