"""Reexecuta casos sintéticos já observados; isto não é novo teste independente."""
import argparse
import json
from pathlib import Path
import sys
import time

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'robustez')]
from runtime import RAIZ,sha256,salvar_json
from avaliar_prospectivo import codigo,processar,agregar
from reais.inferir_web import carregar

ORIGEM=RAIZ/'data/ia/robustez/contraprovas-ciclo3-20261115'
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--adaptador',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Use saída nova em data/.')
    m=json.loads((ORIGEM/'manifest.json').read_text());arquivo=ORIGEM/'casos-test.jsonl'
    if sha256(arquivo)!=m['arquivos'][arquivo.name]['sha256']:raise ValueError('Contraprovas alteradas.')
    versao=codigo();pesos=sha256(a.adaptador/'adapters.safetensors');config=sha256(a.adaptador/'adapter_config.json')
    casos=[json.loads(l) for l in arquivo.read_text().splitlines() if l.strip()]
    modelo,tokenizer=carregar(a.adaptador);inicio=time.monotonic();resultados=[]
    for i,c in enumerate(casos):
        resultados.append(processar(c,modelo,tokenizer));print(f'regressão sintética: {i+1}/{len(casos)}',flush=True)
    if codigo()!=versao:raise ValueError('Código mudou durante a avaliação.')
    saida={'versao':1,'natureza':'sintetico_ja_observado','casos_sha256':sha256(arquivo),
      'manifesto_sha256':sha256(ORIGEM/'manifest.json'),'codigo_sha256':versao,'adaptador_sha256':pesos,
      'config_adaptador_sha256':config,'duracao_segundos':time.monotonic()-inicio,
      'metricas':agregar(resultados),'resultados':resultados,
      'limite':'Os cenários são fictícios e já haviam sido observados; esta é uma regressão, não teste independente nem dado atual do Google.'}
    salvar_json(a.saida,saida,exclusivo=True);print(json.dumps(saida['metricas']['total'],ensure_ascii=False))

if __name__=='__main__':main()
