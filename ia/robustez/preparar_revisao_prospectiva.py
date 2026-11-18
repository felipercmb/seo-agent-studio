"""Prepara cópia verificável do teste prospectivo para o roteiro de revisão humana."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(IA))
from runtime import RAIZ,sha256

def gravar(p,b):
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--casos',type=Path,required=True)
    p.add_argument('--avaliacao',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    destino=a.saida.resolve()
    if destino.exists() or not destino.is_relative_to((RAIZ/'data').resolve()):p.error('Use uma pasta nova em data/.')
    r=json.loads(a.avaliacao.read_text());raw=a.casos.read_bytes()
    if r.get('natureza')!='real' or r.get('casos_sha256')!=hashlib.sha256(raw).hexdigest():raise ValueError('Casos e avaliação não conferem.')
    casos=[json.loads(l) for l in raw.splitlines() if l.strip()]
    if len(casos)!=len(r['resultados']) or {c['id'] for c in casos}!={x['id'] for x in r['resultados']}:
        raise ValueError('Identificadores não conferem.')
    destino.mkdir(parents=True,mode=0o700);gravar(destino/'casos-test.jsonl',raw)
    m={'versao':1,'origem':'Teste prospectivo real; os rótulos automáticos continuam ocultos no roteiro.',
      'avaliacao_original_sha256':sha256(a.avaliacao),'casos_originais_sha256':sha256(a.casos),
      'arquivos':{'casos-test.jsonl':{'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}}}
    gravar(destino/'manifest.json',(json.dumps(m,ensure_ascii=False,indent=2)+'\n').encode())
    resultados=[]
    for x in r['resultados']:
        resultados.append({'id':x['id'],'dominio':x['dominio'],'tipo':x['tipo'],'origem':x['origem_exibida'],
          'escolha':x.get('escolha_exibida'),'escolha_original':x.get('escolha_original'),
          'ajustada_por_regra':x.get('ajustada_por_regra',False),'aceita':x['aceita'],'motivos':x.get('motivos',[])})
    convertido={'versao':1,'split':'test','manifesto_sha256':sha256(destino/'manifest.json'),
      'casos_sha256':sha256(destino/'casos-test.jsonl'),'adaptador_sha256':r['adaptador_sha256'],
      'avaliacao_original_sha256':sha256(a.avaliacao),'resultados':resultados}
    gravar(destino/'avaliacao-revisao.json',(json.dumps(convertido,ensure_ascii=False,indent=2)+'\n').encode())
    print('Roteiro de revisão preparado localmente para',len(casos),'contextos; nenhuma revisão foi criada.')

if __name__=='__main__':main()
