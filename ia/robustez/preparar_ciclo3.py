"""Promove testes observados a desenvolvimento e preserva uma nova reserva por domínio."""
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

ANTIGO=RAIZ/'data/ia/robustez/dataset-interface-20261115'
OBSERVADO=RAIZ/'data/ia/robustez/estresse-interface-20261115'
REAL=RAIZ/'data/ia/robustez/interface-teste-final-20261115.jsonl'
SINTETICO=RAIZ/'data/ia/robustez/contraprovas-ciclo3-20261115'
DESTINO=RAIZ/'data/ia/robustez/dataset-ciclo3-20261115'

def linha(x):return (json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
def gravar(p,b):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b)
def ler_jsonl(p):return [json.loads(x) for x in p.read_text().splitlines() if x.strip()]

def main():
    if DESTINO.exists():raise ValueError('Não sobrescrevendo experimento anterior.')
    m=json.loads((ANTIGO/'manifest.json').read_text());ms=json.loads((OBSERVADO/'manifest.json').read_text())
    mr=json.loads(Path(str(REAL)+'.manifest.json').read_text());mc=json.loads((SINTETICO/'manifest.json').read_text())
    if sha256(REAL)!=mr['arquivo_sha256'] or sha256(OBSERVADO/'casos.jsonl')!=ms['sha256']:
        raise ValueError('Fonte de casos alterada.')
    def antigo(nome):
        p=ANTIGO/nome
        if sha256(p)!=m['arquivos'][nome]['sha256']:raise ValueError('Origem antiga alterada: '+nome)
        return p
    for split in ('valid','test'):
        if sha256(SINTETICO/f'casos-{split}.jsonl')!=mc['arquivos'][f'casos-{split}.jsonl']['sha256']:
            raise ValueError('Contraprovas novas alteradas.')
    treino_casos=ler_jsonl(antigo('casos-train.jsonl'))
    valid=[]
    for split in ('valid','test'):
        for c in ler_jsonl(antigo(f'casos-{split}.jsonl')):
            c['split']='valid';valid.append(c)
    teste=ler_jsonl(REAL)
    grupos_treino={c['grupo'] for c in treino_casos};grupos_valid={c['grupo'] for c in valid};grupos_teste={c['grupo'] for c in teste}
    if grupos_teste & (grupos_treino|grupos_valid) or grupos_treino&grupos_valid:
        raise ValueError('Domínios atravessam grupos.')
    stress_antigo=ler_jsonl(OBSERVADO/'casos.jsonl')
    treino=antigo('desenvolvimento/train.jsonl').read_bytes().splitlines(keepends=True)
    treino.extend(linha({'messages':mensagens(c['entrada'],c['esperado'])}) for c in stress_antigo for _ in range(8))
    random.Random(20261117).shuffle(treino)
    sintetico_valid=ler_jsonl(SINTETICO/'casos-valid.jsonl')
    arquivos={'casos-train.jsonl':antigo('casos-train.jsonl').read_bytes(),
      'casos-valid.jsonl':b''.join(map(linha,valid)),'casos-test.jsonl':b''.join(map(linha,teste)),
      'casos-valid-sintetico.jsonl':(SINTETICO/'casos-valid.jsonl').read_bytes(),
      'casos-test-sintetico.jsonl':(SINTETICO/'casos-test.jsonl').read_bytes(),
      'desenvolvimento/train.jsonl':b''.join(treino),
      'desenvolvimento/valid.jsonl':b''.join(linha({'messages':mensagens(c['entrada'],c['esperado'])})
        for c in valid+sintetico_valid if c['tipo']!='sem_dados')}
    DESTINO.mkdir(mode=0o700)
    for nome,b in arquivos.items():gravar(DESTINO/nome,b)
    registro={'versao':'interface-ciclo3','treino_mensagens':len(treino),'contraprovas_observadas_para_treino':len(stress_antigo),
      'repeticoes_contraprovas_observadas':8,'grupos':{'train':len(grupos_treino),'valid':len(grupos_valid),'test':len(grupos_teste)},
      'casos':{'train':len(treino_casos),'valid':len(valid),'test':len(teste),'valid_sintetico':len(sintetico_valid),
               'test_sintetico':mc['arquivos']['casos-test.jsonl']['casos']},
      'observacao':'Validação inclui teste anteriormente observado; nova reserva por domínio e novas contraprovas nunca foram avaliadas.',
      'manifesto_anterior_sha256':sha256(ANTIGO/'manifest.json'),'stress_observado_sha256':sha256(OBSERVADO/'manifest.json'),
      'teste_real_sha256':sha256(Path(str(REAL)+'.manifest.json')),'contraprovas_novas_sha256':sha256(SINTETICO/'manifest.json'),
      'gerador_sha256':sha256(Path(__file__)),
      'arquivos':{n:{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in sorted(arquivos.items())}}
    gravar(DESTINO/'manifest.json',(json.dumps(registro,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({k:registro[k] for k in ('grupos','casos','treino_mensagens')},ensure_ascii=False))

if __name__=='__main__':main()
