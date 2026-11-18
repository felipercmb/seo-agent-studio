"""Projeção oracle para inferência; não cria JSONL nem elegibilidade de treino."""

import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parents[1];sys.path.insert(0,str(IA))
from runtime import salvar_json,sha256
from negocio.preparar import expandir_corpus
from negocio.contrato import CAMPOS,compactar_ids,validar_saida


def projetar(corpus,split):
    cs=expandir_corpus(corpus,set(CAMPOS)|{"recomendar"})
    for c in cs:
        entrada,alvo,mapa=compactar_ids(c["entrada"],c["esperado"])
        erros=validar_saida(alvo,entrada)
        if erros:raise ValueError(c["id"]+": "+str(erros))
        c.update(split=split,entrada=entrada,esperado=alvo,mapaIdsOriginais=mapa,
                 modoContexto="oracle_rotulado",elegivelTreinoExperimental=False)
    return cs


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--corpus",type=Path,required=True)
    p.add_argument("--saida",type=Path,required=True);p.add_argument("--split",choices=("validation","holdout"),required=True)
    a=p.parse_args();d=json.loads(a.corpus.read_text());casos=projetar(d,a.split)
    r={"versao":1,"geradoEm":datetime.now(timezone.utc).isoformat(),"fonteCorpusSha256":sha256(a.corpus),
       "projetorSha256":sha256(Path(__file__)),"modoContexto":"oracle_rotulado","naoEhEndToEnd":True,
       "elegivelTreinoExperimental":False,"organizacoesSolicitadas":len(d["casos"]),"casos":casos,
       "limite":"Validação/teste sobre fontes rotuladas; não demonstra recuperação end-to-end nem resultado comercial. Não altera alvos ou substitui perdas."}
    salvar_json(a.saida,r,exclusivo=True);print(json.dumps({"organizacoes":r["organizacoesSolicitadas"],"tarefas":len(casos),"split":a.split}))


if __name__=="__main__":main()
