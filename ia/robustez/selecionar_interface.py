"""Seleciona pela validação congelada, preservando a base no empate."""
import argparse
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'robustez')]
from runtime import RAIZ,sha256,salvar_json
from avaliar_interface import codigo

def elegivel(base,candidato):
    b=base['metricas'];c=candidato['metricas'];bt=b['total'];ct=c['total']
    if ct['criticas_exibidas'] or ct['criticas_antes_barreiras']:return False
    if ct['concordancias_aceitas']<bt['concordancias_aceitas'] or ct['recusas']>bt['recusas']:return False
    for tipo in ('diagnostico','termo_sem_demanda'):
        if c['por_tipo'].get(tipo,{}).get('concordancias_aceitas',0)<b['por_tipo'].get(tipo,{}).get('concordancias_aceitas',0):return False
    return True

def chave(rel):
    t=rel['metricas']['total']
    return (t['concordancias_aceitas'],-t['recusas'])

def escolher(base,candidatos):
    melhor=base
    for candidato in candidatos:
        if elegivel(base,candidato) and chave(candidato)>chave(melhor):melhor=candidato
    return melhor

def registro(r,caminho):
    return {'pasta':r['adaptador'],'adaptador_sha256':r['adaptador_sha256'],
      'config_adaptador_sha256':r['config_adaptador_sha256'],'validacao_sha256':sha256(caminho),
      'metricas':r['metricas']['total']}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dados',type=Path,required=True)
    p.add_argument('--base',type=Path,required=True);p.add_argument('--candidato',type=Path,action='append',required=True)
    p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Saída deve ser nova e estar em data/.')
    caminhos=[a.base,*a.candidato];rels=[json.loads(x.read_text()) for x in caminhos]
    for r in rels:
        if r['split']!='valid' or r['codigo_sha256']!=codigo() or r['manifesto_sha256']!=sha256(a.dados/'manifest.json'):
            raise ValueError('Validações incompatíveis.')
        adaptador=Path(r['adaptador'])
        if sha256(adaptador/'adapters.safetensors')!=r['adaptador_sha256'] or sha256(adaptador/'adapter_config.json')!=r['config_adaptador_sha256']:
            raise ValueError('Adaptador foi alterado.')
    melhor=escolher(rels[0],rels[1:]);i=next(i for i,r in enumerate(rels) if r is melhor)
    saida={'versao':1,'estado':'selecionado_para_teste_reservado','manifesto_sha256':sha256(a.dados/'manifest.json'),
      'codigo_sha256':codigo(),'seletor_sha256':sha256(Path(__file__)),'base':registro(rels[0],caminhos[0]),
      'candidato':registro(melhor,caminhos[i]),'adaptador_sha256':melhor['adaptador_sha256'],
      'politica':'Protocolo prévio; empate mantém a versão anterior.',
      'candidatos':[{'validacao_sha256':sha256(caminhos[j]),'elegivel':elegivel(rels[0],r),
        'metricas':r['metricas']['total']} for j,r in enumerate(rels[1:],1)],
      'limite':'Seleção não é aprovação clínica ou comercial; falta teste reservado e revisão independente.'}
    salvar_json(a.saida,saida,exclusivo=True)
    print(json.dumps({'escolhido':saida['candidato']['pasta'],'metricas':saida['candidato']['metricas']},ensure_ascii=False))

if __name__=='__main__':main()
