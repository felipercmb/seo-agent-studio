"""Seleciona o modelo na validação real e sintética; nunca lê os testes."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'robustez')]
from runtime import RAIZ,sha256,salvar_json
from avaliar_ciclo3 import codigo

def elegivel(base,candidato):
    for natureza in ('real','sintetico'):
        b=base[natureza]['metricas']['total'];c=candidato[natureza]['metricas']['total']
        if c['criticas_antes'] or c['criticas_exibidas'] or c['recusas']>b['recusas']:return False
    for natureza,tipo in (('real','diagnostico'),('sintetico','concorrentes'),('sintetico','acompanhar')):
        b=base[natureza]['metricas']['por_tipo'].get(tipo);c=candidato[natureza]['metricas']['por_tipo'].get(tipo)
        if not b or not c or b['com_dados']==0 or c['concordancias_aceitas']<b['concordancias_aceitas']:return False
    return True

def chave(par):
    r=par['real']['metricas']['total'];s=par['sintetico']['metricas']['total']
    return (r['concordancias_aceitas'],s['concordancias_aceitas'],-r['recusas']-s['recusas'])

def escolher(base,candidatos):
    melhor=base
    for c in candidatos:
        if elegivel(base,c) and chave(c)>chave(melhor):melhor=c
    return melhor

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dados',type=Path,required=True)
    p.add_argument('--base-real',type=Path,required=True);p.add_argument('--base-sintetico',type=Path,required=True)
    p.add_argument('--candidato-real',type=Path,action='append',required=True)
    p.add_argument('--candidato-sintetico',type=Path,action='append',required=True)
    p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if len(a.candidato_real)!=len(a.candidato_sintetico):p.error('Cada candidato precisa das duas validações.')
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Saída deve ser nova dentro de data/.')
    pares=[]
    for pr,ps in [(a.base_real,a.base_sintetico),*zip(a.candidato_real,a.candidato_sintetico)]:
        par={'real':json.loads(pr.read_text()),'sintetico':json.loads(ps.read_text()),'arquivos':{'real':pr,'sintetico':ps}}
        for natureza,r in ((n,par[n]) for n in ('real','sintetico')):
            if r['split']!='valid' or r['natureza']!=natureza or r['manifesto_sha256']!=sha256(a.dados/'manifest.json') or r['codigo_sha256']!=codigo():
                raise ValueError('Validações incompatíveis.')
            ad=Path(r['adaptador'])
            if sha256(ad/'adapters.safetensors')!=r['adaptador_sha256'] or sha256(ad/'adapter_config.json')!=r['config_adaptador_sha256']:
                raise ValueError('Adaptador alterado.')
        if any(par['real'][k]!=par['sintetico'][k] for k in ('adaptador_sha256','config_adaptador_sha256')):
            raise ValueError('As validações não pertencem ao mesmo adaptador.')
        pares.append(par)
    melhor=escolher(pares[0],pares[1:])
    def registro(par):
        r=par['real'];return {'pasta':r['adaptador'],'adaptador_sha256':r['adaptador_sha256'],
          'config_adaptador_sha256':r['config_adaptador_sha256'],
          'validacoes_sha256':{n:sha256(par['arquivos'][n]) for n in ('real','sintetico')},
          'metricas':{n:par[n]['metricas']['total'] for n in ('real','sintetico')}}
    saida={'versao':1,'estado':'selecionado_para_teste_reservado','congelado_em':datetime.now(timezone.utc).isoformat(),
      'manifesto_sha256':sha256(a.dados/'manifest.json'),'codigo_sha256':codigo(),'seletor_sha256':sha256(Path(__file__)),
      'protocolo_disponibilizacao_sha256':sha256(Path(__file__).with_name('protocolo-disponibilizacao.json')),
      'base':registro(pares[0]),'candidato':registro(melhor),'adaptador_sha256':melhor['real']['adaptador_sha256'],
      'candidatos':[{'pasta':x['real']['adaptador'],'elegivel':elegivel(pares[0],x),'pontuacao':chave(x)} for x in pares[1:]],
      'limite':'Seleção não aprova uso autônomo ou resultados; falta teste novo e revisão independente.'}
    salvar_json(a.saida,saida,exclusivo=True)
    print(json.dumps({'escolhido':saida['candidato']['pasta'],'validacao':saida['candidato']['metricas']},ensure_ascii=False))

if __name__=='__main__':main()
