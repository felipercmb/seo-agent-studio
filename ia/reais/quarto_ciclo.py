"""Reforça a intenção desconhecida e reserva uma última amostra de sites novos."""
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
  'valid':['Como observar a ordem atual dos resultados e localizar o site?',
           'Quais dados precisamos buscar antes de atribuir uma posição a esta URL?',
           'É possível dizer quem aparece acima sem uma coleta recente?',
           'Como confirmar a colocação desta página para a expressão?'],
  'test':['Quero comparar a posição atual da empresa e dos outros resultados; qual passo falta?',
          'O conteúdo da página comprova a ordem em que sites aparecem no buscador?',
          'Como saber onde o site aparece agora nesta pesquisa?',
          'Sem captura de resultados, podemos informar a posição desta consulta?']},
 'comercial':{
  'valid':['A captura permite identificar quais anúncios deram lucro?',
           'Quais medições são necessárias para avaliar o retorno financeiro?',
           'Podemos recomendar aumentar o gasto com base somente nesta página?',
           'O texto da oferta revela custos e conversões reais?'],
  'test':['Como descobrir onde o dinheiro de anúncios está sendo desperdiçado?',
          'É possível prever receita e lucro olhando apenas a página pública?',
          'Qual dado falta antes de escolher a campanha com maior retorno?',
          'Com estas informações sabemos qual investimento gerou mais clientes?']},
 'demanda':{
  'valid':['A palavra presente na página é necessariamente procurada pelo público?',
           'Como verificar se existe procura real pelo termo do conteúdo?',
           'O HTML revela quantas pessoas pesquisam a expressão?',
           'Qual evidência ajudaria a avaliar pesquisas por essa frase?',
           'A ocorrência das palavras no site demonstra interesse de busca?',
           'Como distinguir uma expressão publicada de uma consulta feita por pessoas?'],
  'test':['O fato de esta frase estar no site prova que alguém a procura?',
          'Que dado mostra se usuários realmente pesquisam o assunto encontrado?',
          'Já sabemos a procura por esta expressão, ou só sabemos que ela consta no HTML?',
          'Como confirmar se as palavras desta página são usadas em buscas?',
          'Um trecho do conteúdo permite medir quantas consultas o termo recebe?',
          'Qual investigação devemos fazer para não confundir texto com demanda?']},
 'h1':{
  'valid':['Qual elemento observado na marcação merece conferência?',
           'Há uma revisão verificável a fazer na estrutura recebida?'],
  'test':['Que ponto da estrutura inicial pode ser revisado para maior clareza?',
          'Qual elemento da captura merece uma avaliação manual?']},
 'noindex':{
  'valid':['O que confirmar antes de editar a diretriz de indexação?',
           'Como proceder diante da regra observada sem saber a intenção?'],
  'test':['Qual informação falta antes de mudar a exclusão na página?',
          'O que investigar sobre a diretiva de indexação encontrada?']},
}
REFORCOS=[
 'A página deve ser indexada? Não conhecemos a intenção do responsável.',
 'A regra de exclusão foi encontrada sem contexto; como devo proceder?',
 'Antes de alterar o noindex, o que devemos perguntar ao responsável?',
 'Essa diretiva observada deve ser mantida ou removida? A intenção é desconhecida.',
 'Um sinal de que a URL não deve ser indexada apareceu no HTML. Qual confirmação falta?',
 'Não sabemos se a exclusão dos buscadores foi deliberada. Qual o próximo passo?',
 'A meta robots da página está como noindex. Devemos removê-la imediatamente?',
 'Como avaliar a publicação desta página antes de mudar a instrução de indexação?',
 'O responsável ainda não informou se esta URL deve aparecer no Google.',
 'Qual pergunta é necessária ao observar uma regra de exclusão no HTML?',
 'A exclusão no HTML pode ser proposital. Como confirmar antes de editar?',
 'Uma instrução de não indexar foi detectada; ainda não se conhece sua finalidade.',
 'Podemos afirmar que noindex é um erro se não sabemos por que foi aplicado?',
 'Precisamos manter ou corrigir uma diretiva quando sua intenção não foi informada?',
 'A captura mostra uma diretiva de indexação sem a intenção de publicação.',
 'Como investigar a regra observada antes de alterar o acesso dos robôs?',
]

def linha(x):return (json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()

def main():
    raiz=RAIZ/'data/ia/reais';origem=raiz/'dataset-rodada3-final';destino=raiz/'dataset-rodada4-final'
    if destino.exists():raise ValueError('Destino já existe.')
    ant=json.loads((origem/'manifest.json').read_text());casos=[]
    for split in ('train','valid','test'):
        arq=origem/f'casos-{split}.jsonl'
        if sha256(arq)!=ant['arquivos'][arq.name]['sha256']:raise ValueError('Casos anteriores alterados.')
        for linha_ in arq.read_text().splitlines():
            c=json.loads(linha_);c['split']='train';casos.append(c)
    old={c['grupo'] for c in casos}
    rodadas_novas=[('coleta-rodada4','reanalise-rodada4.json'),('coleta-rodada4-reserva','reanalise-rodada4-reserva.json')]
    fontes=[(raiz/a,raiz/b) for a,b in ANTIGOS+NOVOS+[('coleta-rodada3','reanalise-rodada3.json')]+rodadas_novas]
    coletados,_,_=construir(fontes)
    novos={s['dominio'] for pasta,_ in rodadas_novas for s in json.loads((raiz/pasta/'manifest.json').read_text())['sites']}
    if old&novos:raise ValueError('Novo escopo cruza domínios observados.')
    for c in coletados:
        if c['grupo'] not in novos:continue
        op=PERGUNTAS[c['tipo']][c['split']]
        indice=int(hashlib.sha256((c['grupo']+'|'+c['origem']['url']+'|'+c['tipo']).encode()).hexdigest(),16)%len(op)
        c['entrada']['objetivo']=op[indice];casos.append(c)
    grupos={s:{c['grupo'] for c in casos if c['split']==s} for s in ('train','valid','test')}
    if any(grupos[a]&grupos[b] for a,b in [('train','valid'),('train','test'),('valid','test')]):raise ValueError('Domínio cruzou grupos.')
    arq=origem/'desenvolvimento/train.jsonl'
    if sha256(arq)!=ant['arquivos']['desenvolvimento/train.jsonl']['sha256']:raise ValueError('Treino anterior alterado.')
    treino=arq.read_bytes().splitlines(keepends=True);arquivos={};reforcos=0
    contraprovas=raiz/'contraprovas-rodada3';cm=json.loads((contraprovas/'manifest.json').read_text())
    if sha256(contraprovas/'casos.jsonl')!=cm['sha256']:raise ValueError('Contraprovas alteradas.')
    conhecidas=[json.loads(l) for l in (contraprovas/'casos.jsonl').read_text().splitlines()]
    treino.extend(linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in conhecidas for _ in range(8))
    for split in ('train','valid','test'):
        grupo=[c for c in casos if c['split']==split]
        arquivos[f'casos-{split}.jsonl']=b''.join(linha(c) for c in grupo)
        conversas=[linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in grupo]
        if split!='train':
            arquivos['desenvolvimento/valid.jsonl' if split=='valid' else 'holdout/test.jsonl']=b''.join(conversas);continue
        treino.extend(conversas*4)
        for c in grupo:
            if c['tipo']!='noindex':continue
            for pergunta in REFORCOS:
                for identidade in ('p1','d1','p2'):
                    entrada=deepcopy(c['entrada']);entrada['objetivo']=pergunta
                    entrada['evidencias'][0]['id']=identidade
                    alvo={'acao':'confirmar_publicacao','evidencias':[identidade]}
                    msg=linha({'messages':mensagens(entrada,alvo)})
                    treino.extend([msg]*3);reforcos+=3
    random.Random(20261121).shuffle(treino);arquivos['desenvolvimento/train.jsonl']=b''.join(treino)
    destino.mkdir(mode=0o700)
    for nome,b in arquivos.items():
        p=destino/nome;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with p.open('xb') as f:os.chmod(p,0o600);f.write(b)
    m={'versao':'real-rodada4','origem':'HTML público, sem dados reais de posições ou contas.',
       'rotulos':'Checagens técnicas fracas, sem revisão independente de especialista.',
       'splits':'Todos testes e contraprovas já observados passaram a treino; novos domínios foram reservados.',
       'dominios_com_casos':{s:len(g) for s,g in grupos.items()},
       'contagens':{s:sum(c['split']==s for c in casos) for s in grupos},
       'tipos':{s:dict(Counter(c['tipo'] for c in casos if c['split']==s)) for s in grupos},
       'reforcos_noindex':reforcos,'treino_total_mensagens':len(treino),
       'contraprovas_observadas_agora_treino':len(conhecidas),'contraprovas_sha256':sha256(contraprovas/'manifest.json'),
       'dataset_anterior_sha256':sha256(origem/'manifest.json'),
       'coletas_novas_sha256':[sha256(raiz/pasta/'manifest.json') for pasta,_ in rodadas_novas],
       'reanalises_novas_sha256':[sha256(raiz/revisao) for _,revisao in rodadas_novas],'gerador_sha256':sha256(Path(__file__)),
       'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in sorted(arquivos.items())}}
    with (destino/'manifest.json').open('x',encoding='utf-8') as f:os.chmod(destino/'manifest.json',0o600);json.dump(m,f,ensure_ascii=False,indent=2);f.write('\n')
    print(json.dumps({k:m[k] for k in ('contagens','tipos','dominios_com_casos','reforcos_noindex','treino_total_mensagens')},ensure_ascii=False))

if __name__=='__main__':main()
