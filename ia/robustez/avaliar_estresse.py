"""Avalia contraprovas sintéticas congeladas apenas depois da seleção pela validação."""
import argparse
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'robustez')]
from runtime import RAIZ,sha256,salvar_json
from avaliar_interface import codigo,processar,agregar,carregar

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dados',type=Path,required=True)
    p.add_argument('--selecao',type=Path,required=True);p.add_argument('--adaptador',type=Path,required=True)
    p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('A saída deve ser nova e estar em data/.')
    sel=json.loads(a.selecao.read_text())
    if sel['manifesto_sha256']!=sha256(a.dados/'manifest.json') or sel['codigo_sha256']!=codigo():raise ValueError('Seleção incompatível.')
    chave=(sha256(a.adaptador/'adapters.safetensors'),sha256(a.adaptador/'adapter_config.json'))
    if chave not in {(sel[n]['adaptador_sha256'],sel[n]['config_adaptador_sha256']) for n in ('base','candidato')}:
        raise ValueError('Somente base ou candidato escolhido podem ser testados.')
    pasta=RAIZ/'data/ia/robustez/estresse-interface-20261115';m=json.loads((pasta/'manifest.json').read_text());arquivo=pasta/'casos.jsonl'
    if sha256(arquivo)!=m['sha256'] or sha256(Path(__file__).with_name('gerar_estresse.py'))!=m['gerador_sha256']:
        raise ValueError('Contraprovas alteradas.')
    casos=[json.loads(x) for x in arquivo.read_text().splitlines()];modelo,tokenizer=carregar(a.adaptador);resultados=[]
    for i,c in enumerate(casos):
        resultados.append(processar(c,modelo,tokenizer));print(f'estresse sintético: {i+1}/{len(casos)}',flush=True)
    saida={'versao':1,'natureza':'sintetica','selecao_sha256':sha256(a.selecao),'manifesto_sha256':sha256(pasta/'manifest.json'),
      'avaliador_sha256':sha256(Path(__file__)),'codigo_sha256':codigo(),'adaptador_sha256':chave[0],
      'metricas':agregar(resultados),'resultados':resultados,'limite':m['limite']}
    salvar_json(a.saida,saida,exclusivo=True);print(json.dumps(saida['metricas']['total'],ensure_ascii=False))

if __name__=='__main__':main()
