"""Compara o modelo puro e o fluxo com regras em casos fictícios de atualidade."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sys
import time

IA = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(IA), str(IA/'robustez')]
from runtime import RAIZ, salvar_json, sha256
from reais.inferir_web import (carregar, entrada_para_modelo, finalizar_web, gerar_escolha,
    regra_posicao_indisponivel, regra_serp_atual, sanear_web)


def codigo():
    arquivos = [Path(__file__), IA/'reais/inferir_web.py', IA/'v3/inferir_v3.py',
      IA/'v3/contrato_v3.py', IA/'v3/decodificar_v3.py', IA/'v2/inferir_v2.py',
      IA/'v2/contrato_v2.py', IA/'v2/decodificar.py']
    return {str(p.relative_to(RAIZ)):sha256(p) for p in arquivos}


def medir(escolha, entrada, esperado, instante, origem):
    if not isinstance(escolha, dict):
        return {'escolha':None, 'aceita':False, 'concorda':False, 'estado':'falha'}
    r = finalizar_web(escolha, entrada, origem, agora=instante)
    atual = r.get('escolha_ia')
    return {'escolha':escolha, 'aceita':r['estado']!='recusada', 'estado':r['estado'],
      'concorda':r['estado']!='recusada' and isinstance(atual,dict)
        and atual.get('acao')==esperado['acao'] and set(atual.get('evidencias',[]))==set(esperado['evidencias']),
      'origem':r.get('origem'), 'motivos':r.get('motivos_aplicabilidade',r.get('erros',[]))}


def agregar(xs):
    def resumo(casos):
        return {'casos':len(casos), 'concorda_ia':sum(x['ia']['concorda'] for x in casos),
          'concorda_hibrido':sum(x['hibrido']['concorda'] for x in casos),
          'recusas_ia':sum(not x['ia']['aceita'] for x in casos),
          'recusas_hibrido':sum(not x['hibrido']['aceita'] for x in casos),
          'erros_ia':sum(bool(x['erro']) for x in casos),
          'regra_hibrida':sum(x['hibrido'].get('origem')=='regra' for x in casos)}
    return {'total':resumo(xs), 'por_tipo':{t:resumo([x for x in xs if x['tipo']==t])
      for t in sorted({x['tipo'] for x in xs})}}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dados',type=Path,required=True);p.add_argument('--adaptador',type=Path,required=True)
    p.add_argument('--split',choices=['valid','test'],required=True);p.add_argument('--selecao',type=Path)
    p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):
        p.error('Use uma saída nova em data/.')
    manifesto=json.loads((a.dados/'manifest.json').read_text())
    nome=f'frescor-{a.split}.jsonl';arquivo=a.dados/nome
    if sha256(arquivo)!=manifesto['arquivos'][nome]['sha256']:raise ValueError('Casos alterados.')
    versao=codigo();peso=sha256(a.adaptador/'adapters.safetensors');config=sha256(a.adaptador/'adapter_config.json')
    if a.split=='test':
        if not a.selecao:p.error('O teste exige seleção congelada na validação.')
        selecao=json.loads(a.selecao.read_text())
        if selecao['manifesto_sha256']!=sha256(a.dados/'manifest.json') or selecao['codigo_sha256']!=versao:
            raise ValueError('Seleção não corresponde aos dados ou código.')
        if (peso,config) not in {(selecao[k]['adaptador_sha256'],selecao[k]['config_sha256']) for k in ('base','selecionado')}:
            raise ValueError('O teste aceita somente adaptadores congelados na seleção.')
    casos=[json.loads(l) for l in arquivo.read_text().splitlines() if l.strip()]
    modelo,tokenizer=carregar(a.adaptador);inicio=time.monotonic();resultados=[]
    for i,c in enumerate(casos):
        instante=datetime.fromisoformat(c['fonte']['reproducao_em'].replace('Z','+00:00'))
        limpa=sanear_web(c['entrada'],agora=instante)
        try:
            _,escolha=gerar_escolha(modelo,tokenizer,entrada_para_modelo(limpa));erro=None
        except (ValueError,RuntimeError) as e:
            escolha=None;erro=str(e)
        regra=regra_serp_atual(limpa) or regra_posicao_indisponivel(limpa)
        resultados.append({'id':c['id'],'tipo':c['tipo'],
          'ia':medir(escolha,c['entrada'],c['esperado'],instante,'ia'),
          'hibrido':medir(regra or escolha,c['entrada'],c['esperado'],instante,'regra' if regra else 'ia'),
          'erro':erro})
        print(f'{a.split}: {i+1}/{len(casos)}',flush=True)
    if codigo()!=versao:raise ValueError('Código mudou durante a avaliação.')
    saida={'versao':1,'split':a.split,'natureza':'sintetica','manifesto_sha256':sha256(a.dados/'manifest.json'),
      'casos_sha256':sha256(arquivo),'adaptador':str(a.adaptador.resolve()),'adaptador_sha256':peso,
      'config_sha256':config,'codigo_sha256':versao,'duracao_segundos':time.monotonic()-inicio,
      'metricas':agregar(resultados),'resultados':resultados,
      'limite':'Cenários e posições inteiramente fictícios; não medem SEO real ou resultados de negócio.'}
    salvar_json(a.saida,saida,exclusivo=True)
    print(json.dumps(saida['metricas'],ensure_ascii=False))


if __name__=='__main__':main()
