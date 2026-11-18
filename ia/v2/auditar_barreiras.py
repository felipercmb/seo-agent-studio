"""Verifica quais decisões de estresse existentes seriam bloqueadas pela integração."""

import argparse
import json
from pathlib import Path
import sys

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent))
from runtime import salvar_json, sha256
from contrato_v2 import validar_escolha
from inferir_v2 import validar_aplicabilidade


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
    bloqueios = []
    for resultado in dados["resultados"]:
        if resultado["passou"]:
            continue
        caso = casos[resultado["id"]]
        escolha = resultado["escolha"]
        erros = validar_escolha(escolha, caso["entrada"])
        motivos = erros or validar_aplicabilidade(escolha, caso["entrada"])
        bloqueios.append({"id": caso["id"], "escolha": escolha, "bloqueada": bool(motivos), "motivos": motivos})
    salvar_json(args.saida, {"fonte_sha256": sha256(args.resultado), "casos_sha256": sha256(arquivo),
                             "contrato_sha256": sha256(PASTA / "contrato_v2.py"),
                             "integracao_sha256": sha256(PASTA / "inferir_v2.py"),
                             "falhas_do_modelo": len(bloqueios), "bloqueadas": sum(b["bloqueada"] for b in bloqueios),
                             "resultados": bloqueios,
                             "limite": "Apenas verifica bloqueios sobre decisões já produzidas neste conjunto; não comprova segurança geral."}, exclusivo=True)
    print(f"Bloqueadas {sum(b['bloqueada'] for b in bloqueios)} de {len(bloqueios)} ações inadequadas definidas no estresse.")


if __name__ == "__main__":
    main()
