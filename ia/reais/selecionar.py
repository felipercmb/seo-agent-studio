"""Seleciona agente anterior ou ajuste usando somente validação por domínio."""

import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(IA))
from runtime import RAIZ,salvar_json,sha256
from reais.avaliar import hashes as hashes_acoes
from reais.avaliar_comparacao import hashes as hashes_comparacao


def ler_opcao(arquivo,pasta,manifesto,codigo,tipo,base=False):
    arquivo,pasta=Path(arquivo),Path(pasta)
    d=json.loads(arquivo.read_text(encoding='utf-8'))
    if (d['split']!='valid' or d['manifesto_sha256']!=manifesto or d['codigo_sha256']!=codigo
            or d['adaptador_sha256']!=sha256(pasta/'adapters.safetensors')
            or d['config_adaptador_sha256']!=sha256(pasta/'adapter_config.json')):
        raise ValueError('Avaliação incompatível: '+str(arquivo))
    passo=0 if base else json.loads((pasta/'proveniencia.json').read_text(encoding='utf-8'))['passo']
    op={'pasta':str(pasta.resolve()),'passo':passo,'base':base,'adaptador_sha256':d['adaptador_sha256'],
        'config_adaptador_sha256':d['config_adaptador_sha256'],'validacao_sha256':sha256(arquivo)}
    m=d['metricas']
    if tipo=='acoes':
        op.update(criticas=m['escolha_critica']['quantidade'],acertos=m['acao_e_referencias']['quantidade'],
                  acao=m['acao_esperada']['quantidade'],total=m['acao_esperada']['total'])
    else:
        op.update(criticas=m['falsas_priorizacoes'],pares=m['pares_corretos'],acertos=m['acertos'],
                  total=m['total'],total_pares=m['total_pares'])
    return op


def selecionar(tipo,dados,base_arquivo,base_adaptador,candidatos,saida):
    saida=Path(saida)
    if saida.exists():raise ValueError('Seleção já existe.')
    if not saida.resolve().is_relative_to((RAIZ/'data').resolve()):raise ValueError('Seleção real deve ficar em data/.')
    manifest_hash=sha256(Path(dados)/'manifest.json')
    codigo=hashes_acoes() if tipo=='acoes' else hashes_comparacao()
    base=ler_opcao(base_arquivo,base_adaptador,manifest_hash,codigo,tipo,True)
    opcoes=[base]
    for pasta in map(Path,candidatos):
        prov=json.loads((pasta/'proveniencia.json').read_text(encoding='utf-8'))
        if prov['manifesto_sha256']!=manifest_hash:raise ValueError('Checkpoint de outro conjunto.')
        opcoes.append(ler_opcao(pasta/'validacao.json',pasta,manifest_hash,codigo,tipo))
    if len({o['total'] for o in opcoes})!=1:raise ValueError('Validações com tamanhos distintos.')
    if tipo=='acoes':
        escolhido=max(opcoes,key=lambda o:(-o['criticas'],o['acertos'],o['acao'],o['base'],-o['passo']))
        politica='Menos escolhas críticas predefinidas, depois ação e referências, ação; empate preserva o modelo anterior.'
    else:
        escolhido=max(opcoes,key=lambda o:(-o['criticas'],o['pares'],o['acertos'],o['base'],-o['passo']))
        politica='Menos priorizações sem base, depois pares corretos e acertos; empate preserva o modelo anterior.'
    resultado={'versao':1,'tipo':tipo,'congeladoEm':datetime.now(timezone.utc).isoformat(),
               'manifesto_sha256':manifest_hash,'codigo_sha256':codigo,'politica':politica,'base':base,
               'protocolo_sha256':sha256(Path(__file__).resolve().parent/'protocolo.json'),
               'candidato':escolhido,'candidatos':opcoes,'adaptador_sha256':escolhido['adaptador_sha256'],
               'aprovado_para_uso_autonomo':False,
               'limite':'Validação pequena em rótulos fracos; não demonstra impacto de SEO ou retorno.'}
    salvar_json(saida,resultado,exclusivo=True)
    return resultado


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--tipo',choices=['acoes','comparacao'],required=True);p.add_argument('--dados',type=Path,required=True)
    p.add_argument('--base',type=Path,required=True);p.add_argument('--base-adaptador',type=Path,required=True)
    p.add_argument('--candidatos',nargs='+',type=Path,required=True);p.add_argument('--saida',type=Path,required=True)
    a=p.parse_args();res=selecionar(a.tipo,a.dados,a.base,a.base_adaptador,a.candidatos,a.saida)
    print(json.dumps(res['candidato'],ensure_ascii=False,indent=2))
