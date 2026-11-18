"""Recalcula resultado em subconjunto de domínios excluídos antes do teste."""
import argparse
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(IA))
from runtime import RAIZ,sha256,salvar_json

def filtrar(resultado,exclusao):
    if resultado.get('split')!='test' or exclusao.get('antesDeObservarResultadosDeTeste') is not True:
        raise ValueError('É necessário um teste e uma exclusão definida previamente.')
    dominios=set(exclusao['dominios']);originais=resultado['resultados']
    linhas=[r for r in originais if r['dominio'] not in dominios]
    if not linhas or len(linhas)==len(originais):raise ValueError('Filtro não removeu um domínio ou não deixou casos.')
    chaves=linhas[0]['criterios']
    metricas={k:{'quantidade':sum(r['criterios'][k] for r in linhas),'total':len(linhas)} for k in chaves}
    tipos={}
    for tipo in sorted({r['tipo'] for r in linhas}):
        grupo=[r for r in linhas if r['tipo']==tipo]
        tipos[tipo]={'total':len(grupo),'acao':sum(r['criterios']['acao_esperada'] for r in grupo),
                     'ambos':sum(r['criterios']['acao_e_referencias'] for r in grupo),
                     'criticas':sum(r['criterios']['escolha_critica'] for r in grupo)}
    por_dominio={}
    for dominio in sorted({r['dominio'] for r in linhas}):
        grupo=[r for r in linhas if r['dominio']==dominio]
        por_dominio[dominio]={'total':len(grupo),'acao':sum(r['criterios']['acao_esperada'] for r in grupo),
                              'ambos':sum(r['criterios']['acao_e_referencias'] for r in grupo)}
    return {**resultado,'metricas':metricas,'por_tipo':tipos,'por_dominio':por_dominio,'resultados':linhas,
            'amostra_derivada':'Exclusões de domínio definidas previamente; o manifesto continua identificando o conjunto completo.',
            'dominios_incluidos':len(por_dominio),'casos_excluidos':len(originais)-len(linhas)}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for n in ('resultado','exclusao','saida'):p.add_argument('--'+n,type=Path,required=True)
    a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Saída deve ser nova e ficar em data/.')
    r=json.loads(a.resultado.read_text());e=json.loads(a.exclusao.read_text());s=filtrar(r,e)
    s.update(resultado_original_sha256=sha256(a.resultado),exclusao_sha256=sha256(a.exclusao),filtro_sha256=sha256(Path(__file__)))
    salvar_json(a.saida,s,exclusivo=True)
    print(json.dumps({'dominios':s['dominios_incluidos'],'metricas':s['metricas'],'por_tipo':s['por_tipo']},ensure_ascii=False))

if __name__=='__main__':main()
