"""Avaliação por domínio em pares de páginas reais, sem medir retorno financeiro."""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import sys
import time

IA=Path(__file__).resolve().parent.parent
PASTA=Path(__file__).resolve().parent
sys.path.insert(0,str(IA))
sys.path.insert(0,str(IA/'v2'))
from runtime import RAIZ,salvar_json,sha256
from comparacao.avaliar import carregar,gerar
from comparacao.inferir import reconciliar


def hashes():
    arquivos=[PASTA/'avaliar_comparacao.py',PASTA/'preparar_comparacao.py',IA/'comparacao/contrato.py',
              IA/'comparacao/avaliar.py',IA/'comparacao/inferir.py',IA/'v2/decodificar.py',IA/'v2/inferir_v2.py']
    return {str(p.relative_to(IA)):sha256(p) for p in arquivos}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dados',type=Path,required=True);p.add_argument('--adaptador',type=Path,required=True)
    p.add_argument('--split',choices=['train','valid','test'],required=True);p.add_argument('--selecao',type=Path)
    p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists():p.error('Não sobrescrevendo avaliação.')
    if not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Resultados reais precisam ficar em data/.')
    pasta=a.dados.resolve();manifesto=json.loads((pasta/'manifest.json').read_text(encoding='utf-8'))
    arq=pasta/f'casos-{a.split}.jsonl'
    if sha256(arq)!=manifesto['arquivos'][arq.name]['sha256']:raise ValueError('Casos alterados.')
    adaptador_sha=sha256(a.adaptador/'adapters.safetensors'); config_sha=sha256(a.adaptador/'adapter_config.json')
    if a.split=='test':
        if not a.selecao:p.error('Congele a seleção na validação antes do teste.')
        sel=json.loads(a.selecao.read_text(encoding='utf-8'))
        if sel['manifesto_sha256']!=sha256(pasta/'manifest.json') or sel['codigo_sha256']!=hashes():
            raise ValueError('Seleção não corresponde aos dados ou código.')
        permitidos={(sel['base']['adaptador_sha256'],sel['base']['config_adaptador_sha256']),
                    (sel['candidato']['adaptador_sha256'],sel['candidato']['config_adaptador_sha256'])}
        if (adaptador_sha,config_sha) not in permitidos:raise ValueError('Modelo não faz parte da seleção.')
    casos=[json.loads(l) for l in arq.read_text(encoding='utf-8').splitlines()]
    modelo,tokenizer=carregar(a.adaptador);resultados=[];pares=defaultdict(list);inicio=time.monotonic()
    for i,c in enumerate(casos):
        try:escolha,bruto=gerar(modelo,tokenizer,c['entrada']);falha=None
        except (ValueError,RuntimeError) as erro:escolha,bruto,falha=None,'',str(erro)
        correto=escolha==c['esperado']
        falsa=c['esperado']['escolha']=='insuficiente' and isinstance(escolha,dict) and escolha.get('escolha') in ('a','b')
        r={'id':c['id'],'par':c['par'],'dominio':c['grupo'],'tipo':c['tipo'],'esperado':c['esperado'],
           'escolha':escolha,'bruto':bruto,'falha':falha,'correto':correto,'priorizou_sem_base':falsa}
        resultados.append(r);pares[c['par']].append(r)
        print(f'comparacao/{a.split}: {i+1}/{len(casos)}',flush=True)
    if any(len(x)!=2 for x in pares.values()):raise ValueError('Par espelhado ausente.')
    sem_base=[r for r in resultados if r['esperado']['escolha']=='insuficiente']
    por_tipo={}
    for tipo in sorted({r['tipo'] for r in resultados}):
        grupo=[r for r in resultados if r['tipo']==tipo]
        por_tipo[tipo]={'total':len(grupo),'acertos':sum(r['correto'] for r in grupo),
                        'falsas_priorizacoes':sum(r['priorizou_sem_base'] for r in grupo)}
    metricas={'acertos':sum(r['correto'] for r in resultados),'total':len(resultados),
              'pares_corretos':sum(all(r['correto'] for r in x) for x in pares.values()),'total_pares':len(pares),
              'falsas_priorizacoes':sum(r['priorizou_sem_base'] for r in sem_base),'sem_base_total':len(sem_base)}
    salvar_json(a.saida,{'versao':1,'split':a.split,'adaptador_sha256':adaptador_sha,'config_adaptador_sha256':config_sha,
                          'manifesto_sha256':sha256(pasta/'manifest.json'),'casos_sha256':sha256(arq),'codigo_sha256':hashes(),
                          'duracao_segundos':time.monotonic()-inicio,'metricas':metricas,'por_tipo':por_tipo,'resultados':resultados,
                          'limites':['Rótulos editoriais técnicos fracos, sem revisão especializada.',
                                     'Páginas do mesmo domínio e pares espelhados não são observações independentes.',
                                     'Nenhum caso mede retorno financeiro ou efeito real no Google.']},exclusivo=True)
    print('Avaliação local salva em '+str(a.saida))


if __name__=='__main__':main()
