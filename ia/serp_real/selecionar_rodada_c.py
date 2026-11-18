"""Escolhe pela validação sintética e por transcrições já usadas no desenvolvimento."""
import argparse
from datetime import datetime,timezone
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
    p.add_argument('--manual-base',type=Path,required=True)
    p.add_argument('--candidato',type=Path,action='append',required=True)
    p.add_argument('--manual-candidato',type=Path,action='append',required=True)
    p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if len(a.candidato)!=len(a.manual_candidato):p.error('Cada modelo exige as duas avaliações.')
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Use saída nova em data/.')
    pares=[]
    for sint,manual in [(a.base,a.manual_base),*zip(a.candidato,a.manual_candidato)]:
        s=json.loads(sint.read_text());r=json.loads(manual.read_text());ad=Path(s['adaptador'])
        if (s['split']!='valid' or s['natureza']!='sintetica' or s['manifesto_sha256']!=sha256(a.dados/'manifest.json')
          or s['codigo_sha256']!=codigo() or r['codigo_sha256']!=codigo()
          or r['script_sha256']!=sha256(IA/'serp_real/avaliar_manual_google.py')
          or sha256(ad/'adapters.safetensors')!=s['adaptador_sha256'] or sha256(ad/'adapter_config.json')!=s['config_sha256']
          or r['adaptador_sha256']!=s['adaptador_sha256'] or r['config_sha256']!=s['config_sha256']):
            raise ValueError('Avaliações incompatíveis.')
        pares.append({'s':s,'r':r,'sint':sint,'manual':manual})
    base=pares[0]
    referencias=[(x['caso'],x['registro_sha256'],x['esperado_editorial']) for x in base['r']['resultados']]
    if any([(x['caso'],x['registro_sha256'],x['esperado_editorial']) for x in par['r']['resultados']]!=referencias for par in pares[1:]):
        raise ValueError('As transcrições diferem entre os modelos.')
    def pontuacao(par):
        m=par['s']['metricas']['por_tipo'];man=par['r']['resultados']
        return (sum(x.get('concorda') is True for x in man),
          sum(m[t]['concorda_ia'] for t in ('sem_posicao','vencida')),
          sum(m[t]['concorda_ia'] for t in ('concorrente_atual','acompanhar_atual')),
          -sum(x['erros_ia'] for x in m.values()))
    def elegivel(par):
        b=base['s']['metricas']['por_tipo'];c=par['s']['metricas']['por_tipo']
        return all(c[t]['concorda_ia']>=b[t]['concorda_ia'] and c[t]['erros_ia']<=b[t]['erros_ia']
                   for t in ('concorrente_atual','acompanhar_atual')) and pontuacao(par)[0]>=pontuacao(base)[0]
    melhor=base
    for par in pares[1:]:
        if elegivel(par) and pontuacao(par)>pontuacao(melhor):melhor=par
    def registro(par):
        s=par['s'];return {'adaptador':s['adaptador'],'adaptador_sha256':s['adaptador_sha256'],'config_sha256':s['config_sha256'],
          'validacao_sha256':sha256(par['sint']),'manual_desenvolvimento_sha256':sha256(par['manual']),
          'metricas':s['metricas'],'pontuacao':pontuacao(par)}
    out={'versao':1,'congelado_em':datetime.now(timezone.utc).isoformat(),
      'manifesto_sha256':sha256(a.dados/'manifest.json'),'codigo_sha256':codigo(),
      'seletor_sha256':sha256(Path(__file__)),'base':registro(base),'selecionado':registro(melhor),
      'candidatos':[{'adaptador':x['s']['adaptador'],'elegivel':elegivel(x),'pontuacao':pontuacao(x)} for x in pares[1:]],
      'limites':['As três transcrições já foram examinadas e usadas no treino; não são avaliação independente.',
        'Antes de disponibilizar, comparar regressões gerais e abrir reservas congeladas.']}
    salvar_json(a.saida,out,exclusivo=True)
    print(json.dumps({'escolhido':out['selecionado']['adaptador'],'pontuacao':out['selecionado']['pontuacao']},ensure_ascii=False))


if __name__=='__main__':main()
