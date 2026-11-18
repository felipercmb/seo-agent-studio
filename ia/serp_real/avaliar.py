"""Avalia escolhas brutas da IA e do fluxo híbrido em capturas SERP arquivadas."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys
import time

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'v3'),str(IA/'v2'),str(IA/'robustez')]
from runtime import RAIZ,sha256,salvar_json
from avaliar_interface import critica
from reais.inferir_web import (carregar,gerar_escolha,sanear_web,entrada_para_modelo,regra_publicacao,
    regra_serp_atual,regra_posicao_indisponivel,finalizar_web)
from serp_real.preparar_treino import normal,termos

def hashes():
    arquivos=[Path(__file__),IA/'serp_real/preparar.mjs',IA/'serp_real/preparar_treino.py',IA/'robustez/avaliar_interface.py',
      IA/'reais/inferir_web.py',IA/'v3/inferir_v3.py',IA/'v3/contrato_v3.py',IA/'v3/decodificar_v3.py',
      IA/'v2/inferir_v2.py',IA/'v2/contrato_v2.py',IA/'v2/decodificar.py']
    return {str(p.relative_to(RAIZ)):sha256(p) for p in arquivos}
def medir(escolha,entrada,esperado,origem,instante):
    if not isinstance(escolha,dict):return {'aceita':False,'concorda':False,'critica':True,'estado':'falha'}
    r=finalizar_web(escolha,entrada,origem,agora=instante)
    aceita=r['estado']!='recusada';exibida=r.get('escolha_ia')
    igual=isinstance(exibida,dict) and exibida.get('acao')==esperado['acao'] and set(exibida.get('evidencias',[]))==set(esperado['evidencias'])
    return {'aceita':aceita,'concorda':bool(aceita and igual),'critica':critica(escolha,sanear_web(entrada,agora=instante)),
      'estado':r['estado'],'escolha':escolha,'origem':r.get('origem'),'motivos':r.get('motivos_aplicabilidade',r.get('erros',[]))}
def avaliar(c,modelo,tokenizer,gerador=gerar_escolha):
    instante=datetime.fromisoformat(c['fonte']['reproducao_em'].replace('Z','+00:00'))
    entrada=sanear_web(c['entrada'],agora=instante)
    try:_,escolha=gerador(modelo,tokenizer,entrada_para_modelo(entrada));erro=None
    except (RuntimeError,ValueError) as exc:escolha=None;erro=str(exc)
    regra=regra_publicacao(entrada) or regra_serp_atual(entrada) or regra_posicao_indisponivel(entrada)
    bruto=medir(escolha,entrada,c['esperado'],'ia',instante)
    hibrido=medir(regra or escolha,entrada,c['esperado'],'regra' if regra else 'ia',instante)
    termo=next((e.get('termo') for e in entrada['evidencias'] if e.get('tipo')=='serp' and isinstance(e.get('termo'),str)),None)
    consulta_hash=hashlib.sha256(normal(termo).encode()).hexdigest() if termo else None
    return {'id':c['id'],'grupo':c['grupo'],'tipo':c['tipo'],'consulta_sha256':consulta_hash,'ia':bruto,'hibrido':hibrido,'erro_ia':erro}
def agregar(resultados):
    def resumo(xs):
        return {'casos':len(xs),'consultas_unicas':len({x['consulta_sha256'] for x in xs if x['consulta_sha256']}),
          'concorda_ia':sum(x['ia']['concorda'] for x in xs),
          'concorda_hibrido':sum(x['hibrido']['concorda'] for x in xs),
          'criticas_ia':sum(x['ia']['critica'] for x in xs),'criticas_hibrido':sum(x['hibrido']['critica'] for x in xs),
          'recusas_ia':sum(not x['ia']['aceita'] for x in xs),'recusas_hibrido':sum(not x['hibrido']['aceita'] for x in xs),
          'escolhas_regra':sum(x['hibrido'].get('origem')=='regra' for x in xs)}
    return {'total':resumo(resultados),'por_grupo':{g:resumo([x for x in resultados if x['grupo']==g]) for g in sorted({x['grupo'] for x in resultados})},
      'por_tipo':{g:resumo([x for x in resultados if x['tipo']==g]) for g in sorted({x['tipo'] for x in resultados})}}

def verificar_reserva(casos,dados):
    """Recusa teste com domínio ou consulta presentes no desenvolvimento anterior."""
    m=json.loads((dados/'manifest.json').read_text());dominios=set();consultas=set()
    for nome in ('casos-train.jsonl','casos-valid.jsonl','desenvolvimento/train.jsonl','desenvolvimento/valid.jsonl'):
        p=dados/nome
        if sha256(p)!=m['arquivos'][nome]['sha256']:raise ValueError('Desenvolvimento alterado.')
        for linha in p.read_text().splitlines():
            if not linha.strip():continue
            objeto=json.loads(linha)
            try:entrada=objeto['entrada'] if 'entrada' in objeto else json.loads(objeto['messages'][1]['content'])
            except (KeyError,IndexError,TypeError,ValueError):raise ValueError('Conversa de desenvolvimento inválida.')
            if isinstance(entrada.get('site'),str):dominios.add(normal(entrada['site']))
            consultas.update(termos(entrada))
    for c in casos:
        e=c['entrada'];site=e.get('site')
        if isinstance(site,str) and normal(site) in dominios or termos(e)&consultas:
            raise ValueError('Teste cruza domínio ou busca usados no desenvolvimento.')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dados',type=Path,required=True)
    p.add_argument('--adaptador',type=Path,required=True);p.add_argument('--split',choices=['valid','test'],required=True)
    p.add_argument('--selecao',type=Path);p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Use saída nova em data/.')
    manifesto=json.loads((a.dados/'manifest.json').read_text());arquivo=a.dados/f'casos-{a.split}.jsonl'
    if sha256(arquivo)!=manifesto['arquivos'][arquivo.name]['sha256']:raise ValueError('Casos alterados.')
    versao=hashes();chave=(sha256(a.adaptador/'adapters.safetensors'),sha256(a.adaptador/'adapter_config.json'))
    if a.split=='test':
        if not a.selecao:p.error('Selecione o modelo com a validação antes de abrir o teste.')
        s=json.loads(a.selecao.read_text())
        if s['manifesto_serp_sha256']!=sha256(a.dados/'manifest.json') or s['codigo_sha256']!=versao:raise ValueError('Seleção não corresponde aos dados ou código.')
        if chave not in {(s[n]['adaptador_sha256'],s[n]['config_adaptador_sha256']) for n in ('base','candidato')}:
            raise ValueError('O teste aceita somente modelos definidos na seleção.')
    casos=[json.loads(l) for l in arquivo.read_text().splitlines() if l.strip()]
    if not casos:raise ValueError('Não existem capturas de posição suficientes nesta divisão.')
    if a.split=='test':
        for pasta,campo in (('dados_desenvolvimento','manifesto_desenvolvimento_sha256'),
                            ('dados_validacao_regressao','manifesto_validacao_regressao_sha256')):
            desenvolvimento=Path(s[pasta])
            if sha256(desenvolvimento/'manifest.json')!=s[campo]:
                raise ValueError('Desenvolvimento difere da seleção congelada.')
            verificar_reserva(casos,desenvolvimento)
    modelo,tokenizer=carregar(a.adaptador);inicio=time.monotonic();resultados=[]
    for i,c in enumerate(casos):
        resultados.append(avaliar(c,modelo,tokenizer));print(f'{a.split}: {i+1}/{len(casos)}',flush=True)
    if hashes()!=versao:raise ValueError('O código mudou durante a avaliação.')
    resultado={'versao':1,'split':a.split,'manifesto_serp_sha256':sha256(a.dados/'manifest.json'),
      'casos_sha256':sha256(arquivo),'adaptador':str(a.adaptador.resolve()),'adaptador_sha256':chave[0],
      'config_adaptador_sha256':chave[1],'codigo_sha256':versao,'duracao_segundos':time.monotonic()-inicio,
      'metricas':agregar(resultados),'resultados':resultados,
      'limites':['Duas perguntas por busca não são observações independentes.',
        'Preferências geradas automaticamente não equivalem a revisão independente ou impacto medido.',
        'Capturas são reproduzidas no momento original, sem declarar posições atuais.']}
    salvar_json(a.saida,resultado,exclusivo=True);print(json.dumps(resultado['metricas']['total'],ensure_ascii=False))

if __name__=='__main__':main()
