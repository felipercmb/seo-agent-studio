"""Avalia, sem seleção ou treino, o sistema congelado em novas páginas públicas."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sys
import time

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'v3'),str(IA/'v2'),str(IA/'robustez')]
from runtime import RAIZ,sha256,salvar_json
from avaliar_interface import critica
from avaliar_ciclo3 import codigo as codigo_ciclo3
from reais.inferir_web import (sanear_web,entrada_para_modelo,carregar,gerar_escolha,regra_publicacao,
    regra_serp_atual,regra_posicao_indisponivel,finalizar_web)

def codigo():
    r=codigo_ciclo3();r.update({'ia/robustez/avaliar_prospectivo.py':sha256(Path(__file__)),
       'ia/robustez/reproduzir_teste_final.mjs':sha256(IA/'robustez/reproduzir_teste_final.mjs')})
    return r

def processar(c,modelo=None,tokenizer=None,gerador=gerar_escolha):
    if c['tipo']=='sem_dados':
        if c['entrada'].get('evidencias')!=[]:raise ValueError('Caso sem dados possui evidências.')
        return {'id':c['id'],'dominio':c['grupo'],'tipo':c['tipo'],'estado':'nao_encaminhada',
          'origem_original':'servidor','origem_exibida':'servidor','ajustada_por_regra':False,
          'aceita':False,'concordancia':False,'critica_antes':False,'critica_exibida':False}
    instante=datetime.fromisoformat(c['fonte']['reproducao_em'].replace('Z','+00:00'))
    entrada=sanear_web(c['entrada'],agora=instante)
    escolha=regra_publicacao(entrada) or regra_serp_atual(entrada) or regra_posicao_indisponivel(entrada)
    origem='regra' if escolha is not None else 'ia';erro=None
    if escolha is None:
        try:_,escolha=gerador(modelo,tokenizer,entrada_para_modelo(entrada))
        except (ValueError,RuntimeError) as exc:escolha=None;erro=str(exc)
    crit_antes=critica(escolha,entrada)
    resultado=finalizar_web(escolha,c['entrada'],origem,agora=instante)
    aceita=resultado['estado']!='recusada';exibida=resultado.get('escolha_ia');esperado=c['esperado']
    igual=isinstance(exibida,dict) and exibida.get('acao')==esperado['acao'] and set(exibida.get('evidencias',[]))==set(esperado['evidencias'])
    return {'id':c['id'],'dominio':c['grupo'],'tipo':c['tipo'],'estado':resultado['estado'],
      'origem_original':origem,'origem_exibida':resultado.get('origem'),
      'ajustada_por_regra':resultado.get('ajustada_por_regra') is True,
      'escolha_original':escolha,'escolha_exibida':exibida,'esperado_editorial':esperado,
      'aceita':aceita,'concordancia':igual and aceita,'critica_antes':crit_antes,
      'critica_exibida':critica(exibida,entrada) and aceita,'erro':erro,
      'motivos':resultado.get('motivos_aplicabilidade',resultado.get('erros',[]))}

def agregar(xs):
    def medir(grupo):
        com=[x for x in grupo if x['estado']!='nao_encaminhada']
        return {'contextos':len(grupo),'nao_encaminhados':len(grupo)-len(com),'com_dados':len(com),
          'concordancias_editoriais':sum(x['concordancia'] for x in com),
          'alternativas_aceitas':sum(x['aceita'] and not x['concordancia'] for x in com),
          'recusas':sum(not x['aceita'] for x in com),'criticas_antes':sum(x['critica_antes'] for x in com),
          'criticas_exibidas':sum(x['critica_exibida'] for x in com),
          'escolhas_originais_ia':sum(x['origem_original']=='ia' for x in com),
          'escolhas_exibidas_regra':sum(x['origem_exibida']=='regra' for x in com),
          'ajustadas_por_regra':sum(x['ajustada_por_regra'] for x in com)}
    tipos={t:medir([x for x in xs if x['tipo']==t]) for t in sorted({x['tipo'] for x in xs})}
    dominios={d:medir([x for x in xs if x['dominio']==d]) for d in sorted({x['dominio'] for x in xs})}
    return {'total':medir(xs),'por_tipo':tipos,'dominios_total':len(dominios),
      'dominios_com_dados':sum(v['com_dados']>0 for v in dominios.values()),'por_dominio':dominios}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dados',type=Path,required=True)
    p.add_argument('--congelamento',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Use uma saída nova em data/.')
    snap=json.loads(a.congelamento.read_text());manifesto=json.loads(Path(str(a.dados)+'.manifest.json').read_text())
    if snap['codigo_sha256']!=codigo() or sha256(a.dados)!=manifesto['arquivo_sha256']:
        raise ValueError('Código ou dados não correspondem ao congelamento.')
    if sha256(Path(snap['escopo']))!=snap['escopo_sha256']:raise ValueError('Escopo prévio alterado.')
    captura=Path(snap['captura']);meta=json.loads((captura/'manifest.json').read_text());escopo=json.loads(Path(snap['escopo']).read_text())
    normalizado=json.loads((captura/'escopo.json').read_text())
    if sha256(captura/'escopo.json')!=meta['escopo_sha256'] or manifesto['manifesto_coleta_sha256']!=sha256(captura/'manifest.json'):
        raise ValueError('Manifesto da coleta não confere.')
    if [(x['site'],x['split']) for x in escopo['sites']]!=[(x['dominio'],x['split']) for x in normalizado['sites']]:
        raise ValueError('Coleta diverge dos domínios reservados.')
    adaptador=Path(snap['adaptador']['pasta'])
    if (sha256(adaptador/'adapters.safetensors')!=snap['adaptador']['sha256'] or
        sha256(adaptador/'adapter_config.json')!=snap['adaptador']['config_sha256']):raise ValueError('Adaptador alterado.')
    casos=[json.loads(l) for l in a.dados.read_text().splitlines()];modelo,tokenizer=carregar(adaptador)
    resultados=[];inicio=time.monotonic()
    for i,c in enumerate(casos):
        resultados.append(processar(c,modelo,tokenizer));print(f'prospectivo real: {i+1}/{len(casos)}',flush=True)
    if codigo()!=snap['codigo_sha256']:raise ValueError('Código mudou durante o teste; descarte o resultado.')
    saida={'versao':1,'natureza':'real','congelamento_sha256':sha256(a.congelamento),
      'casos_sha256':sha256(a.dados),'manifesto_captura_sha256':sha256(captura/'manifest.json'),
      'adaptador_sha256':snap['adaptador']['sha256'],'codigo_sha256':codigo(),'duracao_segundos':time.monotonic()-inicio,
      'metricas':agregar(resultados),'resultados':resultados,
      'limites':['Preferências editoriais geradas automaticamente, sem especialista independente.',
         'Não houve medição real de posição no Google, demanda, conversões ou retorno.',
         'Páginas de um mesmo domínio são relacionadas; casos sem leitura são preservados como não encaminhados.']}
    salvar_json(a.saida,saida,exclusivo=True);print(json.dumps(saida['metricas']['total'],ensure_ascii=False))

if __name__=='__main__':main()
