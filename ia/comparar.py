"""Comparação auditável; resultado algum promove o piloto automaticamente."""

import argparse
import json
from pathlib import Path
from runtime import salvar_json


def comparar(base, treinado):
    if base.get("tipo") != "base" or treinado.get("tipo") != "adaptador":
        raise ValueError("Forneça primeiro o modelo-base e depois um adaptador.")
    for campo in ("split", "modelo", "revisao", "versoes", "casos_sha256", "prompt_sha256", "avaliador_sha256", "codigo_sha256", "decodificador"):
        if base.get(campo) != treinado.get(campo):
            raise ValueError("Avaliações não comparáveis: " + campo)
    if [r["id"] for r in base["resultados"]] != [r["id"] for r in treinado["resultados"]]:
        raise ValueError("Avaliações têm casos diferentes.")
    return {"versao": 1, "modelo": base["modelo"], "revisao": base["revisao"], "split": base["split"],
            "casos_sha256": base["casos_sha256"], "adaptador_sha256": treinado["adaptador_sha256"],
            "metricas": {nome: {"base": valor, "treinado": treinado["metricas"][nome]}
                         for nome, valor in base["metricas"].items()},
            "promovido_para_recomendacoes_automaticas": False, "revisao_humana": "pendente",
            "limites": base["limites"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--treinado", type=Path, required=True)
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    resultado = comparar(json.loads(args.base.read_text(encoding="utf-8")),
                         json.loads(args.treinado.read_text(encoding="utf-8")))
    salvar_json(args.saida, resultado, exclusivo=True)
    print(json.dumps(resultado["metricas"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
