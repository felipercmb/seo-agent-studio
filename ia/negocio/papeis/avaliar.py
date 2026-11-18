"""Conditional diagnostic of supplied frames; never end-to-end extraction."""
from pathlib import Path
import json
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from negocio import ensaios
from negocio.papeis import spec
def main():
    original=ensaios.especificacao
    ensaios.especificacao=lambda name:spec if name=='papeis' else original(name)
    try:
        ensaios.avaliar('papeis')
        out=Path(sys.argv[sys.argv.index('--saida')+1])
        (out/'ESCOPO-CLASSIFICACAO.json').write_text(json.dumps({'relacaoLiteralFornecida':True,'ofertaFornecida':True,'fimAFim':False,'descobertaDeOfertasAvaliada':False,'extracaoDeRelacoesAvaliada':False,'avaliacaoCondicionalDePapeis':True},ensure_ascii=False,indent=2)+'\n')
    finally:ensaios.especificacao=original
if __name__=='__main__':main()
