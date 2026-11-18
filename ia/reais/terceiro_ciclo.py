"""Promove resultados observados a desenvolvimento e reserva novos sites e perguntas."""
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
from reais.preparar import construir
from reais.segundo_ciclo import ANTIGOS,NOVOS
from contrato_v3 import mensagens

PERGUNTAS={
 'serp':{
  'valid':['É possível indicar a posição desta consulta sem observar resultados atuais?',
           'Qual coleta falta para comparar a página com resultados de outras empresas?',
           'Como verificar hoje a presença e os resultados anteriores para esta expressão?',
           'O HTML do site permite saber sua classificação atual em uma pesquisa?'],
  'test':['Que evidência é necessária antes de informar a ordem dos sites no Google?',
          'Como saber qual site vem primeiro nessa consulta neste momento?',
          'Posso apontar concorrentes à frente sem capturar a página de resultados?',
          'O que falta para conhecer a colocação atual desta página na pesquisa?']},
 'comercial':{
  'valid':['Somente este conteúdo indica qual campanha paga é lucrativa?',
           'Como decidir qual página terá melhor retorno sem dados de vendas?',
           'Quais métricas faltam para comparar o retorno financeiro das alternativas?',
           'O texto da página demonstra que determinada verba está sendo desperdiçada?'],
  'test':['É possível apontar a opção de maior lucro sem custos e conversões?',
          'Quero saber o retorno do investimento desta página; o que precisamos medir?',
          'Estes dados indicam quanto dinheiro foi gasto em anúncios sem resultado?',
          'Como escolher a alternativa de maior receita usando só a captura do site?']},
 'demanda':{
  'valid':['A frase escrita no site comprova que as pessoas pesquisam esse assunto?',
           'Qual informação mostra se o termo presente na página tem procura?',
           'Uma palavra no título já basta para afirmar que há buscas por ela?',
           'Como confirmar que existe interesse de busca na expressão encontrada?',
           'O texto da página mede a quantidade de pessoas pesquisando esse tema?',
           'Que dado comprovaria procura pelas palavras retiradas do HTML?'],
  'test':['Pessoas buscam esta expressão ou sabemos somente que ela consta na página?',
          'O que precisamos consultar para confirmar a procura por este assunto?',
          'Encontrar um termo no HTML é suficiente para provar interesse nas buscas?',
          'De que maneira validar se o público pesquisa as palavras desta URL?',
          'O site por si só revela a frequência de pesquisa do termo encontrado?',
          'Há evidência de usuários procurando essa frase ou apenas de que ela foi escrita?']},
 'h1':{
  'valid':['Qual aspecto verificado da estrutura inicial deve ser conferido?',
           'Há um ponto da marcação recebida que merece uma revisão?'],
  'test':['O que verificar na estrutura do HTML observada para tornar a página mais clara?',
          'Esta captura oferece uma melhoria verificável de estrutura para examinar?']},
 'noindex':{
  'valid':['A diretiva encontrada exige qual verificação antes de qualquer alteração?',
           'O que perguntar antes de mudar a orientação de indexação desta página?'],
  'test':['Como investigar a instrução de exclusão sem presumir que seja um erro?',
          'Que confirmação vem antes de editar a diretiva registrada no HTML?']},
}
REFORCOS=[
 'Pessoas realmente pesquisam a expressão retirada desta página?',
 'O termo extraído demonstra procura ou somente está no texto?',
 'O que confirma que o público busca estas palavras?',
 'A presença do tema no HTML mede interesse nas buscas?',
 'Qual fonte devemos consultar antes de afirmar que essa frase é pesquisada?',
 'Como verificar demanda orgânica pela expressão encontrada?',
 'Este título comprova que usuários procuram o assunto?',
 'Temos volume de busca ou só uma ocorrência da expressão no site?',
 'Antes de supor que pessoas pesquisam por isso, qual dado falta?',
 'Pode haver palavras no site que ninguém procura? Como conferir?',
 'Encontramos uma expressão, mas não sabemos se há procura. Qual a próxima etapa?',
 'A frase está no conteúdo; por si só ela demonstra quantos usuários a buscam?',
]

def linha(x):return (json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()

def main():
    raiz=RAIZ/'data/ia/reais';origem=raiz/'dataset-rodada2-final';destino=raiz/'dataset-rodada3-final'
    if destino.exists():raise ValueError('Destino já existe.')
    anterior=json.loads((origem/'manifest.json').read_text());casos=[]
    for split in ('train','valid','test'):
        arq=origem/f'casos-{split}.jsonl'
        if sha256(arq)!=anterior['arquivos'][arq.name]['sha256']:raise ValueError('Casos anteriores alterados.')
        for linha_ in arq.read_text().splitlines():
            c=json.loads(linha_);c['split']='train';casos.append(c)
    old={c['grupo'] for c in casos}
    fontes=[(raiz/a,raiz/b) for a,b in ANTIGOS+NOVOS+[('coleta-rodada3','reanalise-rodada3.json')]]
    coletados,_,_=construir(fontes)
    novos={s['dominio'] for s in json.loads((raiz/'coleta-rodada3/manifest.json').read_text())['sites']}
    if old & novos:raise ValueError('Novo escopo cruza domínios já observados.')
    for c in coletados:
        if c['grupo'] not in novos:continue
        perguntas=PERGUNTAS[c['tipo']][c['split']]
        indice=int(hashlib.sha256((c['grupo']+'|'+c['origem']['url']+'|'+c['tipo']).encode()).hexdigest(),16)%len(perguntas)
        c['entrada']['objetivo']=perguntas[indice];casos.append(c)
    grupos={s:{c['grupo'] for c in casos if c['split']==s} for s in ('train','valid','test')}
    if any(grupos[a]&grupos[b] for a,b in [('train','valid'),('train','test'),('valid','test')]):raise ValueError('Domínio cruzou grupos.')
    treino_antigo=origem/'desenvolvimento/train.jsonl'
    if sha256(treino_antigo)!=anterior['arquivos']['desenvolvimento/train.jsonl']['sha256']:raise ValueError('Treino anterior alterado.')
    treino=treino_antigo.read_bytes().splitlines(keepends=True);arquivos={};reforcos=0
    contraprovas=raiz/'contraprovas-rodada2';cm=json.loads((contraprovas/'manifest.json').read_text())
    if sha256(contraprovas/'casos.jsonl')!=cm['sha256']:raise ValueError('Contraprovas anteriores alteradas.')
    conhecidos=[json.loads(l) for l in (contraprovas/'casos.jsonl').read_text().splitlines()]
    # Contraprovas já observadas são desenvolvimento, nunca novo teste.
    treino.extend(linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in conhecidos for _ in range(5))
    for split in ('train','valid','test'):
        grupo=[c for c in casos if c['split']==split]
        arquivos[f'casos-{split}.jsonl']=b''.join(linha(c) for c in grupo)
        conversas=[linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in grupo]
        if split!='train':
            arquivos['desenvolvimento/valid.jsonl' if split=='valid' else 'holdout/test.jsonl']=b''.join(conversas)
            continue
        treino.extend(conversas*4)
        for c in grupo:
            if c['tipo']!='demanda':continue
            for pergunta in REFORCOS:
                entrada=deepcopy(c['entrada']);entrada['objetivo']=pergunta
                treino.append(linha({'messages':mensagens(entrada,c['esperado'])}));reforcos+=1
    random.Random(20261120).shuffle(treino);arquivos['desenvolvimento/train.jsonl']=b''.join(treino)
    destino.mkdir(mode=0o700)
    for nome,b in arquivos.items():
        p=destino/nome;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with p.open('xb') as f:os.chmod(p,0o600);f.write(b)
    m={'versao':'real-rodada3','origem':'HTML público, sem posições Google ou métricas comerciais.',
       'rotulos':'Checagens técnicas fracas, sem revisão independente de especialista.',
       'splits':'Todo teste observado anteriormente passou a treino. Novos domínios e perguntas são reservados.',
       'dominios_com_casos':{s:len(g) for s,g in grupos.items()},
       'contagens':{s:sum(c['split']==s for c in casos) for s in grupos},
       'tipos':{s:dict(Counter(c['tipo'] for c in casos if c['split']==s)) for s in grupos},
       'reforcos_demanda':reforcos,'treino_total_mensagens':len(treino),
       'contraprovas_observadas_agora_treino':len(conhecidos),'contraprovas_sha256':sha256(contraprovas/'manifest.json'),
       'dataset_anterior_sha256':sha256(origem/'manifest.json'),'coleta_nova_sha256':sha256(raiz/'coleta-rodada3/manifest.json'),
       'reanalise_nova_sha256':sha256(raiz/'reanalise-rodada3.json'),'gerador_sha256':sha256(Path(__file__)),
       'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in sorted(arquivos.items())}}
    with (destino/'manifest.json').open('x',encoding='utf-8') as f:os.chmod(destino/'manifest.json',0o600);json.dump(m,f,ensure_ascii=False,indent=2);f.write('\n')
    print(json.dumps({k:m[k] for k in ('contagens','tipos','dominios_com_casos','reforcos_demanda','treino_total_mensagens')},ensure_ascii=False))

if __name__=='__main__':main()
