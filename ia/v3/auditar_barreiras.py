"""Aplica barreiras da integração às falhas já observadas nas contraprovas."""

import argparse
import json
from pathlib import Path
import sys

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent))
from runtime import salvar_json, sha256
from contrato_v3 import validar_escolha
from inferir_v3 import bloqueios


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resultado", type=Path, required=True)
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    resultado = json.loads(args.resultado.read_text(encoding="utf-8"))
    arq = PASTA / "casos_estresse.jsonl"
    if resultado["casos_sha256"] != sha256(arq):
        raise ValueError("Resultado de outro conjunto de contraprovas.")
    casos = {c["id"]: c for c in map(json.loads, arq.read_text(encoding="utf-8").splitlines())}
    falhas = []
    for r in resultado["resultados"]:
        if r["passou"]:
            continue
        caso = casos[r["id"]]
        erros = validar_escolha(r["escolha"], caso["entrada"])
        motivos = erros or bloqueios(r["escolha"], caso["entrada"])
        falhas.append({"id": r["id"], "escolha": r["escolha"], "bloqueada": bool(motivos), "motivos": motivos})
    salvar_json(args.saida, {"fonte_sha256": sha256(args.resultado), "casos_sha256": sha256(arq),
                             "integracao_sha256": sha256(PASTA / "inferir_v3.py"),
                             "falhas_do_modelo": len(falhas), "bloqueadas": sum(f["bloqueada"] for f in falhas),
                             "falhas": falhas, "limite": "Barreiras verificadas somente nas falhas definidas nesta contraprova sintética."}, exclusivo=True)
    print(f"Bloqueadas {sum(f['bloqueada'] for f in falhas)} de {len(falhas)} falhas definidas no estresse.")


if __name__ == "__main__":
    main()
