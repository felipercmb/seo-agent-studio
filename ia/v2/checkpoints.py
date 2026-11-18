"""Cria uma pasta imutável por checkpoint para avaliação e comparação."""

import argparse
import json
from pathlib import Path
import shutil
import sys

V2 = Path(__file__).resolve().parent
sys.path.insert(0, str(V2.parent))
from runtime import salvar_json, sha256


def preparar(origem, passo, destino):
    origem, destino = Path(origem), Path(destino)
    if destino.exists():
        raise ValueError("Destino já existe; use outro caminho.")
    meta = json.loads((origem / "treino.json").read_text(encoding="utf-8"))
    if meta["estado"] != "concluido":
        raise ValueError("O treino deve ser concluído antes da seleção.")
    nome = f"{passo:07d}_adapters.safetensors"
    if nome not in meta["checkpoints"] or sha256(origem / nome) != meta["checkpoints"][nome]:
        raise ValueError("Checkpoint não consta no registro íntegro do treino.")
    destino.mkdir(parents=True)
    shutil.copyfile(origem / nome, destino / "adapters.safetensors")
    shutil.copyfile(origem / "adapter_config.json", destino / "adapter_config.json")
    salvar_json(destino / "proveniencia.json", {"passo": passo, "sha256": meta["checkpoints"][nome],
                "treino_sha256": sha256(origem / "treino.json"), "manifesto_sha256": meta["dados_manifest_sha256"],
                "config_treino_sha256": meta["config_fonte_sha256"]})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origem", type=Path, required=True)
    parser.add_argument("--passo", type=int, required=True)
    parser.add_argument("--destino", type=Path, required=True)
    args = parser.parse_args()
    preparar(args.origem, args.passo, args.destino)
