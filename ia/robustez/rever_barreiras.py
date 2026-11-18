"""Reaplica barreiras a escolhas já salvas; é regressão, não novo teste independente."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(IA))
from runtime import RAIZ,sha256,salvar_json
from reais.inferir_web import finalizar_web

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dados',type=Path,required=True)
    p.add_argument('--avaliacao',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Saída nova deve ficar em data/.')
    m=json.loads((a.dados/'manifest.json').read_text());r=json.loads(a.avaliacao.read_text())
    nome=f"casos-{r['split']}{'-sintetico' if r['natureza']=='sintetico' else ''}.jsonl";arquivo=a.dados/nome
    if (r['manifesto_sha256']!=sha256(a.dados/'manifest.json') or r['casos_sha256']!=sha256(arquivo) or
        r['casos_sha256']!=m['arquivos'][nome]['sha256']):raise ValueError('Avaliação ou casos incompatíveis.')
    casos={c['id']:c for c in (json.loads(l) for l in arquivo.read_text().splitlines())};mudancas=[];verificados=0
    for item in r['resultados']:
        if item['estado']=='nao_encaminhada':continue
        c=casos[item['id']];instante=datetime.fromisoformat(c['fonte']['reproducao_em'].replace('Z','+00:00'))
        novo=finalizar_web(item['escolha'],c['entrada'],item['origem'],agora=instante);verificados+=1
        if novo['estado']!=item['estado']:
            mudancas.append({'id':item['id'],'antes':item['estado'],'depois':novo['estado'],
              'motivos':novo.get('motivos_aplicabilidade',novo.get('erros',[]))})
    saida={'versao':1,'avaliacao_sha256':sha256(a.avaliacao),'casos_sha256':sha256(arquivo),
      'barreiras_sha256':sha256(IA/'reais/inferir_web.py'),'codigo_sha256':sha256(Path(__file__)),
      'escolhas_reprocessadas':verificados,'mudancas':mudancas,
      'limite':'Reavalia escolhas já observadas; não é novo teste nem revisão independente.'}
    salvar_json(a.saida,saida,exclusivo=True)
    print(json.dumps({'escolhas_reprocessadas':verificados,'mudancas':len(mudancas)},ensure_ascii=False))

if __name__=='__main__':main()
