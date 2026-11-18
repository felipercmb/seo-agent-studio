"""Resume revisões autodeclaradas sem confundir ausência de avaliações com aprovação."""
import argparse
from collections import Counter
from itertools import combinations
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(IA))
from runtime import RAIZ,sha256,salvar_json

def resumir(registros):
    por_revisor={};chaves=set();fontes=set()
    for r in registros:
        if r.get('versao')!=1 or r.get('parecer') not in ('aprovada','recusa_aprovada','corrigida','nao_avaliavel'):
            raise ValueError('Registro de revisão inválido.')
        ident=(r['revisor_autodeclarado'],r['caso_id']);fontes.add((r['manifesto_sha256'],r['avaliacao_sha256']))
        if ident in chaves:raise ValueError('Um revisor tem mais de um parecer para o mesmo caso.')
        chaves.add(ident);por_revisor.setdefault(ident[0],{})[ident[1]]=r
    if len(fontes)>1:raise ValueError('Revise uma avaliação por vez.')
    individuos={}
    for nome,casos in por_revisor.items():
        cont=Counter(r['parecer'] for r in casos.values());avaliaveis=[r for r in casos.values() if r['parecer']!='nao_avaliavel']
        individuos[nome]={'casos':len(casos),'avaliaveis':len(avaliaveis),'dominios_avaliaveis':len({r['dominio'] for r in avaliaveis}),
          'aprovadas':cont['aprovada'],'recusas_aprovadas':cont['recusa_aprovada'],
          'corrigidas':cont['corrigida'],'nao_avaliaveis':cont['nao_avaliavel']}
    pares=[]
    for a,b in combinations(sorted(por_revisor),2):
        aa,bb=por_revisor[a],por_revisor[b];comuns=set(aa)&set(bb)
        comparaveis=[i for i in comuns if aa[i]['parecer']!='nao_avaliavel' and bb[i]['parecer']!='nao_avaliavel']
        def parecer(r):
            # Se houve correção, compara ação e referências; para uma recusa
            # aprovada não se inventa uma ação de treinamento.
            alvo=r.get('alvo_humano')
            return ('recusa',) if r['parecer']=='recusa_aprovada' else (
                'acao',alvo.get('acao'),tuple(sorted(alvo.get('evidencias',[])))) if isinstance(alvo,dict) else ('sem_alvo',r['parecer'])
        pares.append({'revisores':[a,b],'casos_em_comum':len(comuns),'comparaveis':len(comparaveis),
          'mesma_acao_e_fontes_ou_recusa':sum(parecer(aa[i])==parecer(bb[i]) for i in comparaveis)})
    return {'revisores':len(individuos),'casos_distintos':len({r['caso_id'] for r in registros}),
      'por_revisor':individuos,'concordancia_pares':pares,
      'limites':['Não avaliável não é acerto nem erro.',
        'Identidade, experiência e independência dos revisores são autodeclaradas.',
        'Concordância entre pessoas não comprova resultados comerciais nem causalidade em SEO.',
        'Um teste revisto e usado no treino deixa de ser teste independente.']}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('arquivos',type=Path,nargs='+')
    p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Use saída nova dentro de data/.')
    registros=[]
    for arquivo in a.arquivos:
        registros.extend(json.loads(l) for l in arquivo.read_text().splitlines() if l.strip())
    resumo=resumir(registros)
    resumo.update(versao=1,arquivos_sha256=[sha256(a) for a in a.arquivos],codigo_sha256=sha256(Path(__file__)))
    salvar_json(a.saida,resumo,exclusivo=True)
    print(json.dumps({'revisores':resumo['revisores'],'casos_distintos':resumo['casos_distintos'],
        'concordancia_pares':resumo['concordancia_pares']},ensure_ascii=False))

if __name__=='__main__':main()
