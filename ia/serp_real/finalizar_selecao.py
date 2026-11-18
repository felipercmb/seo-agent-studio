"""Congela o candidato apenas após verificar regressões gerais na validação."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'serp_real'),str(IA/'robustez')]
from runtime import RAIZ,salvar_json,sha256
from avaliar_frescor import codigo as codigo_frescor
from avaliar_ciclo3 import codigo as codigo_geral


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--preselecao',type=Path,required=True)
    for n in ('base-real','base-sintetico','candidato-real','candidato-sintetico'):
        p.add_argument('--'+n,type=Path,required=True)
    p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Use saída nova em data/.')
    pre=json.loads(a.preselecao.read_text())
    if pre['codigo_sha256']!=codigo_frescor():raise ValueError('Código de frescor mudou.')
    relatorios={};motivos=[]
    for modelo in ('base','candidato'):
      esperado=pre['base' if modelo=='base' else 'selecionado']
      for natureza in ('real','sintetico'):
        arq=getattr(a,modelo+'_'+natureza);r=json.loads(arq.read_text())
        if (r['split']!='valid' or r['natureza']!=natureza or r['manifesto_sha256']!=pre['manifesto_sha256']
            or r['codigo_sha256']!=codigo_geral() or r['adaptador_sha256']!=esperado['adaptador_sha256']
            or r['config_adaptador_sha256']!=esperado['config_sha256']):
            raise ValueError('Validação geral incompatível: '+str(arq))
        relatorios[(modelo,natureza)]=(r,arq)
    for natureza in ('real','sintetico'):
      b=relatorios[('base',natureza)][0]['metricas'];c=relatorios[('candidato',natureza)][0]['metricas']
      for tipo in b['por_tipo']:
        x,y=b['por_tipo'][tipo],c['por_tipo'].get(tipo,{})
        if (y.get('concordancias_aceitas',-1)<x['concordancias_aceitas'] or
            y.get('recusas',float('inf'))>x['recusas'] or
            y.get('criticas_antes',float('inf'))>x['criticas_antes'] or
            y.get('criticas_exibidas',float('inf'))>x['criticas_exibidas']):
            motivos.append(natureza+': regressão no tipo '+tipo)
    escolhido=pre['base'] if motivos else pre['selecionado']
    resultado={**pre,'congelado_em':datetime.now(timezone.utc).isoformat(),
      'preselecao_sha256':sha256(a.preselecao),'seletor_final_sha256':sha256(Path(__file__)),
      'selecionado':escolhido,'regressoes_encontradas':motivos,
      'validacoes_gerais_sha256':{m+'_'+n:sha256(caminho) for (m,n),(r,caminho) in relatorios.items()},
      'codigo_geral_sha256':codigo_geral(),
      'limites':['A seleção é experimental; preferências automáticas não equivalem a especialistas ou ganhos de SEO.',
        'O teste independente ainda não foi aberto na seleção.']}
    salvar_json(a.saida,resultado,exclusivo=True)
    print(json.dumps({'escolhido':escolhido['adaptador'],'regressoes':motivos},ensure_ascii=False))


if __name__=='__main__':main()
