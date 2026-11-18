"""Avalia contraprovas sintéticas novas após a seleção pela validação."""
import argparse
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'v3')]
from runtime import RAIZ,sha256,salvar_json
from avaliar_v3 import carregar
from decodificar_v3 import gerar_escolha
from reais.avaliar import pontuar,hashes

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--selecao',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Saída deve ser nova e dentro de data/.')
    pasta=RAIZ/'data/ia/reais/contraprovas-rodada3';m=json.loads((pasta/'manifest.json').read_text());arq=pasta/'casos.jsonl'
    if sha256(arq)!=m['sha256']:raise ValueError('Contraprovas alteradas.')
    sel=json.loads(a.selecao.read_text());adaptador=Path(sel['candidato']['pasta'])
    if sha256(adaptador/'adapters.safetensors')!=sel['adaptador_sha256'] or sha256(adaptador/'adapter_config.json')!=sel['candidato']['config_adaptador_sha256']:
        raise ValueError('Adaptador alterado.')
    casos=[json.loads(l) for l in arq.read_text().splitlines()];modelo,tokenizer=carregar(adaptador);resultados=[]
    for i,c in enumerate(casos):
        _,escolha=gerar_escolha(modelo,tokenizer,c['entrada']);pontos,motivos=pontuar(c,escolha)
        resultados.append({'id':c['id'],'tipo':c['tipo'],'escolha':escolha,'esperado':c['esperado'],
                           'pontos':pontos,'bloqueios':motivos})
        print(f'contraprovas: {i+1}/{len(casos)}',flush=True)
    por_tipo={}
    for tipo in sorted({r['tipo'] for r in resultados}):
        grupo=[r for r in resultados if r['tipo']==tipo]
        por_tipo[tipo]={'total':len(grupo),'corretos_e_aceitos':sum(r['pontos']['acao_e_referencias'] and r['pontos']['aceita_formato_e_barreiras'] for r in grupo),
                        'criticos':sum(r['pontos']['escolha_critica'] for r in grupo),
                        'bloqueados':sum(bool(r['bloqueios']) for r in grupo)}
    salvar_json(a.saida,{'versao':1,'natureza':'sintetica','selecao_sha256':sha256(a.selecao),
                         'manifesto_sha256':sha256(pasta/'manifest.json'),'avaliador_sha256':sha256(Path(__file__)),
                         'codigo_sha256':hashes(),'por_tipo':por_tipo,'resultados':resultados},exclusivo=True)
    print(json.dumps(por_tipo,ensure_ascii=False))

if __name__=='__main__':main()
