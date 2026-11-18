"""Aplica o verificador de inversão a decisões de contraprova já registradas."""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import sys

PASTA = Path(__file__).resolve().parent
sys.path.append(str(PASTA.parent))
from runtime import salvar_json, sha256
from comparacao.inferir import reconciliar


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resultado", type=Path, required=True)
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    dados = json.loads(args.resultado.read_text(encoding="utf-8"))
    arquivo = PASTA / "casos_estresse.jsonl"
    if dados["casos_sha256"] != sha256(arquivo):
        raise ValueError("Resultado pertence a outro conjunto de contraprovas.")
    casos = {c["id"]: c for c in map(json.loads, arquivo.read_text(encoding="utf-8").splitlines())}
    pares = defaultdict(list)
    for r in dados["resultados"]:
        pares[r["par"]].append(r)
    analises = []
    for par, linhas in sorted(pares.items()):
        if len(linhas) != 2:
            raise ValueError("Par sem as duas ordens: " + par)
        direta = next(r for r in linhas if r["id"].endswith("-0"))
        espelhada = next(r for r in linhas if r["id"].endswith("-1"))
        contexto = casos[direta["id"]]["entrada"]["opcoes"]
        conclusao = reconciliar((direta["saida"] or {}).get("escolha"),
                                (espelhada["saida"] or {}).get("escolha"), contexto[0], contexto[1])
        analises.append({"par": par, "decisao": direta["saida"], "decisao_inversa": espelhada["saida"],
                         "ambos_corretos": all(r["correto"] for r in linhas), **conclusao})
    erros = [a for a in analises if not a["ambos_corretos"]]
    salvar_json(args.saida, {"fonte_sha256": sha256(args.resultado), "casos_sha256": sha256(arquivo),
                             "integracao_sha256": sha256(PASTA / "inferir.py"), "pares_com_erros": len(erros),
                             "erros_inconclusivos": sum(a["estado"] == "inconclusiva" for a in erros),
                             "resultados": analises,
                             "limite": "Verifica apenas decisões deste conjunto; consistência não prova correção geral."}, exclusivo=True)
    print(f"{sum(a['estado'] == 'inconclusiva' for a in erros)} de {len(erros)} pares com erros ficaram inconclusivos.")


if __name__ == "__main__":
    main()
