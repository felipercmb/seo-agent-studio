"""Seleciona com validação SERP e contraprovas anteriores, sem abrir o teste reservado."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'robustez')]
from runtime import RAIZ,sha256,salvar_json
from serp_real.avaliar import hashes
from avaliar_ciclo3 import codigo as codigo_anterior

def resumo(par):
    s=par['serp']['metricas']['total'];r=par['real']['metricas']['total'];f=par['sintetico']['metricas']['total']
    return (s['concorda_ia'],-s['recusas_ia'],-s['criticas_ia'],r['concordancias_aceitas'],f['concordancias_aceitas'])
def elegivel(base,novo):
    b=base['serp']['metricas']['total'];c=novo['serp']['metricas']['total']
    if c['criticas_ia']>b['criticas_ia'] or c['recusas_ia']>b['recusas_ia'] or c['concorda_ia']<b['concorda_ia']:return False
    for nome in ('real','sintetico'):
        x=base[nome]['metricas']['total'];y=novo[nome]['metricas']['total']
        if (y['criticas_antes']>x['criticas_antes'] or y['criticas_exibidas']>x['criticas_exibidas'] or
            y['recusas']>x['recusas'] or y['concordancias_aceitas']<x['concordancias_aceitas']):return False
    return True
def carregar_par(paths,dados_serp,dados_antigos):
    par={n:json.loads(Path(p).read_text()) for n,p in paths.items()}
    for n,r in par.items():
        if r['split']!='valid':raise ValueError('A seleção aceita somente validações.')
        if n=='serp':
            if r['manifesto_serp_sha256']!=sha256(dados_serp/'manifest.json') or r['codigo_sha256']!=hashes():raise ValueError('Validação SERP incompatível.')
        elif (r['natureza']!=n or r['manifesto_sha256']!=sha256(dados_antigos/'manifest.json') or r['codigo_sha256']!=codigo_anterior()):
            raise ValueError('Contraprova anterior incompatível.')
        if (r['adaptador_sha256'],r['config_adaptador_sha256'])!=(par['serp']['adaptador_sha256'],par['serp']['config_adaptador_sha256']):
            raise ValueError('O grupo de validações contém adaptadores diferentes.')
        pasta=Path(r['adaptador'])
        if sha256(pasta/'adapters.safetensors')!=r['adaptador_sha256'] or sha256(pasta/'adapter_config.json')!=r['config_adaptador_sha256']:
            raise ValueError('Adaptador modificado.')
    return par

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for x in ('dados-serp','dados-antigos','dados-desenvolvimento','base-serp','base-real','base-sintetico','saida'):
        p.add_argument('--'+x,type=Path,required=True)
    for x in ('candidato-serp','candidato-real','candidato-sintetico'):p.add_argument('--'+x,type=Path,action='append',required=True)
    a=p.parse_args();listas=[a.candidato_serp,a.candidato_real,a.candidato_sintetico]
    if len({len(x) for x in listas})!=1:p.error('Cada candidato precisa das três validações.')
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Use saída nova em data/.')
    base=carregar_par({'serp':a.base_serp,'real':a.base_real,'sintetico':a.base_sintetico},a.dados_serp,a.dados_antigos)
    candidatos=[carregar_par(dict(zip(('serp','real','sintetico'),paths)),a.dados_serp,a.dados_antigos) for paths in zip(*listas)]
    s=base['serp']['metricas'];grupos=len(s['por_grupo']);consultas=s['total']['consultas_unicas']
    if grupos<2 or consultas<4:raise ValueError('Validação SERP insuficiente: reserve ao menos duas organizações e quatro consultas verificadas.')
    melhor=base
    for candidato in candidatos:
        if elegivel(base,candidato) and resumo(candidato)>resumo(melhor):melhor=candidato
    def reg(x):
        r=x['serp'];return {'pasta':r['adaptador'],'adaptador_sha256':r['adaptador_sha256'],
          'config_adaptador_sha256':r['config_adaptador_sha256'],
          'metricas':{n:x[n]['metricas']['total'] for n in ('serp','real','sintetico')}}
    resultado={'versao':1,'estado':'selecionado_para_teste_reservado','congelado_em':datetime.now(timezone.utc).isoformat(),
      'manifesto_serp_sha256':sha256(a.dados_serp/'manifest.json'),'codigo_sha256':hashes(),
      'dados_desenvolvimento':str(a.dados_desenvolvimento.resolve()),
      'manifesto_desenvolvimento_sha256':sha256(a.dados_desenvolvimento/'manifest.json'),
      'dados_validacao_regressao':str(a.dados_antigos.resolve()),
      'manifesto_validacao_regressao_sha256':sha256(a.dados_antigos/'manifest.json'),
      'base':reg(base),'candidato':reg(melhor),'selecionador_sha256':sha256(Path(__file__)),
      'candidatos':[{'pasta':x['serp']['adaptador'],'elegivel':elegivel(base,x),'pontuacao':resumo(x)} for x in candidatos],
      'limite':'Escolha experimental baseada em rótulos automáticos; não é aprovação de uso autônomo.'}
    salvar_json(a.saida,resultado,exclusivo=True)
    print(json.dumps({'escolhido':resultado['candidato']['pasta'],'validacao':resultado['candidato']['metricas']},ensure_ascii=False))

if __name__=='__main__':main()
