"""Congela comparação de validação, preservando o modelo anterior em empate."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'serp_real')]
from runtime import RAIZ,salvar_json,sha256
from avaliar_frescor import codigo


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dados',type=Path,required=True);p.add_argument('--base',type=Path,required=True)
    p.add_argument('--candidato',type=Path,action='append',required=True);p.add_argument('--saida',type=Path,required=True)
    a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Use saída nova em data/.')
    resultados=[]
    for caminho in [a.base,*a.candidato]:
        r=json.loads(caminho.read_text());ad=Path(r['adaptador'])
        if (r['split']!='valid' or r['natureza']!='sintetica' or r['manifesto_sha256']!=sha256(a.dados/'manifest.json')
            or r['codigo_sha256']!=codigo() or sha256(ad/'adapters.safetensors')!=r['adaptador_sha256']
            or sha256(ad/'adapter_config.json')!=r['config_sha256']):raise ValueError('Validação incompatível.')
        resultados.append((caminho,r))
    base=resultados[0][1]['metricas']['por_tipo']
    def elegivel(par):
        m=par[1]['metricas']['por_tipo']
        return all(m[t]['concorda_ia']>=base[t]['concorda_ia'] and m[t]['erros_ia']<=base[t]['erros_ia']
                   for t in ('concorrente_atual','acompanhar_atual'))
    def pontuacao(par):
        m=par[1]['metricas']['por_tipo']
        return (sum(m[t]['concorda_ia'] for t in ('sem_posicao','vencida')),
                sum(m[t]['concorda_ia'] for t in ('concorrente_atual','acompanhar_atual')),
                -sum(x['erros_ia'] for x in m.values()))
    melhor=resultados[0]
    for par in resultados[1:]:
        if elegivel(par) and pontuacao(par)>pontuacao(melhor):melhor=par
    def resumo(par):
        caminho,r=par
        return {'adaptador':r['adaptador'],'adaptador_sha256':r['adaptador_sha256'],'config_sha256':r['config_sha256'],
          'validacao_sha256':sha256(caminho),'metricas':r['metricas'],'pontuacao':pontuacao(par)}
    saida={'versao':1,'congelado_em':datetime.now(timezone.utc).isoformat(),
      'manifesto_sha256':sha256(a.dados/'manifest.json'),'codigo_sha256':codigo(),
      'seletor_sha256':sha256(Path(__file__)),'base':resumo(resultados[0]),'selecionado':resumo(melhor),
      'candidatos':[{'adaptador':r['adaptador'],'elegivel':elegivel((c,r)),'pontuacao':pontuacao((c,r))}
                    for c,r in resultados[1:]],
      'limites':['Seleção em casos sintéticos; não autoriza substituição ou uso com clientes.',
        'Ainda são necessárias regressões gerais e avaliação em reserva independente.']}
    salvar_json(a.saida,saida,exclusivo=True)
    print(json.dumps({'escolhido':saida['selecionado']['adaptador'],'pontuacao':saida['selecionado']['pontuacao']},ensure_ascii=False))


if __name__=='__main__':main()
