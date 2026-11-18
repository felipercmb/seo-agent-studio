"""Avalia o fluxo corrigido; uma seleção congelada é obrigatória antes do teste."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sys
import time

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'v3'),str(IA/'v2'),str(IA/'robustez')]
from runtime import RAIZ,sha256,salvar_json
from contrato_v3 import apresentar
from avaliar_interface import critica
from reais.inferir_web import (sanear_web,entrada_para_modelo,carregar,gerar_escolha,regra_publicacao,
    regra_serp_atual,regra_posicao_indisponivel,finalizar_web)

PROTOCOLO=Path(__file__).with_name('protocolo-ciclo3.json')

def codigo():
    arquivos=[Path(__file__),PROTOCOLO,IA/'robustez/avaliar_interface.py',IA/'reais/inferir_web.py',
       IA/'v3/inferir_v3.py',IA/'v3/contrato_v3.py',IA/'v3/decodificar_v3.py',
       IA/'v2/inferir_v2.py',IA/'v2/contrato_v2.py',IA/'v2/decodificar.py',
       RAIZ/'src/worker.mjs',RAIZ/'src/entrada-ia.mjs',RAIZ/'src/portal.html',RAIZ/'lib/ia-local.mjs',
       RAIZ/'src/analise.mjs',RAIZ/'src/agente.mjs',RAIZ/'src/descoberta.mjs',RAIZ/'src/robots-diretivas.mjs']
    return {str(p.relative_to(RAIZ)):sha256(p) for p in arquivos}

def processar(caso,modelo=None,tokenizer=None,gerador=gerar_escolha):
    if caso['tipo']=='sem_dados':
        if caso['entrada'].get('evidencias')!=[]:raise ValueError('Caso sem dados possui evidências.')
        return {'id':caso['id'],'dominio':caso['grupo'],'tipo':caso['tipo'],'origem':'servidor',
          'estado':'nao_encaminhada','escolha':None,'esperado_editorial':caso['esperado'],
          'aceita':False,'corresponde_e_aceita':False,'critica_antes_barreiras':False,'critica_exibida':False,'motivos':[]}
    instante=datetime.fromisoformat(caso['fonte']['reproducao_em'].replace('Z','+00:00'))
    entrada=sanear_web(caso['entrada'],agora=instante)
    escolha=regra_publicacao(entrada) or regra_serp_atual(entrada) or regra_posicao_indisponivel(entrada)
    origem='regra' if escolha is not None else 'ia';erro=None
    if escolha is None:
        try:_,escolha=gerador(modelo,tokenizer,entrada_para_modelo(entrada))
        except (ValueError,RuntimeError) as exc:escolha=None;erro=str(exc)
    crit=critica(escolha,entrada);r=finalizar_web(escolha,caso['entrada'],origem,agora=instante)
    aceita=r['estado']!='recusada';esperado=caso['esperado']
    igual=isinstance(escolha,dict) and escolha.get('acao')==esperado['acao'] and set(escolha.get('evidencias',[]))==set(esperado['evidencias'])
    return {'id':caso['id'],'dominio':caso['grupo'],'tipo':caso['tipo'],'origem':origem,'estado':r['estado'],
      'escolha':escolha,'esperado_editorial':esperado,'aceita':aceita,'corresponde_e_aceita':igual and aceita,
      'critica_antes_barreiras':crit,'critica_exibida':crit and aceita,'erro':erro,
      'motivos':r.get('motivos_aplicabilidade',r.get('erros',[]))}

def agregar(resultados):
    def soma(xs):
        com=[x for x in xs if x['estado']!='nao_encaminhada']
        return {'contextos':len(xs),'nao_encaminhados':len(xs)-len(com),'com_dados':len(com),
          'concordancias_aceitas':sum(x['corresponde_e_aceita'] for x in com),
          'alternativas_aceitas':sum(x['aceita'] and not x['corresponde_e_aceita'] for x in com),
          'recusas':sum(not x['aceita'] for x in com),'criticas_antes':sum(x['critica_antes_barreiras'] for x in com),
          'criticas_exibidas':sum(x['critica_exibida'] for x in com),
          'escolhas_regra':sum(x['origem']=='regra' for x in com),'escolhas_ia':sum(x['origem']=='ia' for x in com)}
    tipos={t:soma([x for x in resultados if x['tipo']==t]) for t in sorted({x['tipo'] for x in resultados})}
    dominios={d:soma([x for x in resultados if x['dominio']==d]) for d in sorted({x['dominio'] for x in resultados})}
    return {'total':soma(resultados),'por_tipo':tipos,'dominios_total':len(dominios),
      'dominios_com_dados':sum(x['com_dados']>0 for x in dominios.values()),'por_dominio':dominios}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dados',type=Path,required=True)
    p.add_argument('--adaptador',type=Path,required=True);p.add_argument('--split',choices=['valid','test'],required=True)
    p.add_argument('--natureza',choices=['real','sintetico'],required=True);p.add_argument('--selecao',type=Path)
    p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Use uma saída nova dentro de data/.')
    codigo_inicio=codigo()
    manifesto=json.loads((a.dados/'manifest.json').read_text())
    nome=f"casos-{a.split}{'-sintetico' if a.natureza=='sintetico' else ''}.jsonl";arquivo=a.dados/nome
    if sha256(arquivo)!=manifesto['arquivos'][nome]['sha256']:raise ValueError('Casos alterados.')
    chave=(sha256(a.adaptador/'adapters.safetensors'),sha256(a.adaptador/'adapter_config.json'))
    if a.split=='test':
        if not a.selecao:p.error('Seleção anterior é obrigatória para abrir o teste.')
        s=json.loads(a.selecao.read_text())
        if s['manifesto_sha256']!=sha256(a.dados/'manifest.json') or s['codigo_sha256']!=codigo_inicio:raise ValueError('Seleção incompatível.')
        if chave not in {(s[n]['adaptador_sha256'],s[n]['config_adaptador_sha256']) for n in ('base','candidato')}:
            raise ValueError('Teste restrito ao modelo anterior e ao candidato selecionado.')
    casos=[json.loads(l) for l in arquivo.read_text().splitlines()];modelo,tokenizer=carregar(a.adaptador)
    inicio=time.monotonic();resultados=[]
    for i,c in enumerate(casos):
        resultados.append(processar(c,modelo,tokenizer));print(f'{a.split} {a.natureza}: {i+1}/{len(casos)}',flush=True)
    if codigo()!=codigo_inicio:raise ValueError('O código mudou durante a avaliação; resultado descartado.')
    saida={'versao':1,'split':a.split,'natureza':a.natureza,'adaptador':str(a.adaptador.resolve()),
       'adaptador_sha256':chave[0],'config_adaptador_sha256':chave[1],
       'manifesto_sha256':sha256(a.dados/'manifest.json'),'casos_sha256':sha256(arquivo),'codigo_sha256':codigo_inicio,
       'duracao_segundos':time.monotonic()-inicio,'metricas':agregar(resultados),'resultados':resultados,
       'limites':['Preferências editoriais automáticas não são revisão por especialista.',
         'Sinais sintéticos de posição não são dados reais do Google ou de negócios.',
         'Casos do mesmo domínio são correlacionados; ausência de dados é registrada separadamente.']}
    salvar_json(a.saida,saida,exclusivo=True);print(json.dumps(saida['metricas']['total'],ensure_ascii=False))

if __name__=='__main__':main()
