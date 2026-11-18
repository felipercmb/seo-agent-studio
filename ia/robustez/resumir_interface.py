"""Separa contextos executados da IA e casos que a interface não encaminharia ao modelo."""
import argparse
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(IA))
from runtime import RAIZ,sha256,salvar_json

def resumir(casos,resultados):
    por_id={c['id']:c for c in casos}
    if len(por_id)!=len(casos) or len(resultados)!=len(casos) or set(por_id)!={r['id'] for r in resultados}:
        raise ValueError('Casos e resultados divergem.')
    sem=[];com=[]
    for r in resultados:
        c=por_id[r['id']]
        if c['tipo']=='sem_dados':
            if c['entrada']['evidencias']!=[]:raise ValueError('Contexto sem dados tem evidências.')
            sem.append(r)
        else:com.append(r)
    def medidas(xs):return {'contextos':len(xs),'dominios':len({x['dominio'] for x in xs}),
      'concordancias_editoriais_aceitas':sum(x['corresponde_e_aceita'] for x in xs),
      'alternativas_aceitas':sum(x['aceita'] and not x['corresponde_e_aceita'] for x in xs),
      'recusas':sum(not x['aceita'] for x in xs),'criticas_exibidas':sum(x['critica_exibida'] for x in xs),
      'escolhas_do_modelo':sum(x['origem']=='ia' for x in xs),'escolhas_de_regra':sum(x['origem']=='regra' for x in xs)}
    return {'contextos_total':len(casos),'sem_dados_nao_encaminhados_pela_interface':len(sem),
      'com_dados':medidas(com),'por_tipo_com_dados':{t:medidas([x for x in com if x['tipo']==t]) for t in sorted({x['tipo'] for x in com})},
      'nota':'A exclusão de contextos vazios é inferida do fluxo atual do servidor e da interface, e verificada pelos testes de API. Alternativa aceita não equivale a acerto especializado.'}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dados',type=Path,required=True)
    p.add_argument('--avaliacao',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Saída deve ser nova e ficar em data/.')
    r=json.loads(a.avaliacao.read_text());m=json.loads((a.dados/'manifest.json').read_text())
    arq=a.dados/f"casos-{r['split']}.jsonl"
    if r['manifesto_sha256']!=sha256(a.dados/'manifest.json') or r['casos_sha256']!=sha256(arq) or sha256(arq)!=m['arquivos'][arq.name]['sha256']:
        raise ValueError('Avaliação ou dados incompatíveis.')
    casos=[json.loads(x) for x in arq.read_text().splitlines()];resumo=resumir(casos,r['resultados'])
    resumo.update(versao=1,avaliacao_sha256=sha256(a.avaliacao),casos_sha256=sha256(arq),
      codigo_sha256=sha256(Path(__file__)),worker_sha256=sha256(RAIZ/'src/worker.mjs'),portal_sha256=sha256(RAIZ/'src/portal.html'))
    salvar_json(a.saida,resumo,exclusivo=True);print(json.dumps(resumo['com_dados'],ensure_ascii=False))

if __name__=='__main__':main()
