"""Avalia contraprovas de comparação após a seleção, sem ajustar o modelo."""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import sys
import time

PASTA = Path(__file__).resolve().parent
sys.path.append(str(PASTA.parent))
from runtime import salvar_json, sha256
from comparacao.avaliar import carregar, gerar, hashes

SHA = "3e6f79fd061e8776b91bd25c58452d5a5d10077b078d85fd8de5b61ce7b9da93"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selecao", type=Path, required=True)
    parser.add_argument("--adaptador", type=Path)
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    if args.saida.exists():
        parser.error("Resultado já existe.")
    selecao = json.loads(args.selecao.read_text(encoding="utf-8"))
    if selecao["codigo_sha256"] != hashes():
        raise ValueError("A avaliação mudou após seleção.")
    if args.adaptador and sha256(args.adaptador / "adapters.safetensors") != selecao["adaptador_sha256"]:
        raise ValueError("O adaptador não foi selecionado.")
    casos = PASTA / "casos_estresse.jsonl"
    if sha256(casos) != SHA:
        raise ValueError("Contraprova não corresponde ao hash congelado.")
    linhas = [json.loads(l) for l in casos.read_text(encoding="utf-8").splitlines()]
    modelo, tokenizer = carregar(args.adaptador)
    resultados, pares = [], defaultdict(list)
    inicio = time.monotonic()
    for i, caso in enumerate(linhas):
        try:
            escolha, bruto = gerar(modelo, tokenizer, caso["entrada"])
            erro = None
        except (ValueError, RuntimeError) as e:
            escolha, bruto, erro = None, "", str(e)
        correto = escolha == caso["esperado"]
        falsa_priorizacao = caso["classe"] == "insuficiente" and isinstance(escolha, dict) and escolha.get("escolha") in ("a", "b")
        resultado = {"id": caso["id"], "par": caso["par"], "classe": caso["classe"], "esperado": caso["esperado"],
                     "saida": escolha, "bruto": bruto, "erro": erro, "correto": correto, "priorizou_sem_base": falsa_priorizacao}
        resultados.append(resultado)
        pares[caso["par"]].append(resultado)
        print(f"estresse/comparação: {i + 1}/{len(linhas)}", flush=True)
    sem_base = [r for r in resultados if r["classe"] == "insuficiente"]
    salvar_json(args.saida, {"tipo": "adaptador" if args.adaptador else "base", "casos_sha256": SHA,
                            "codigo_sha256": hashes(), "avaliador_sha256": sha256(Path(__file__)),
                            "adaptador_sha256": sha256(args.adaptador / "adapters.safetensors") if args.adaptador else None,
                            "duracao_segundos": time.monotonic() - inicio,
                            "metricas": {"acertos": sum(r["correto"] for r in resultados), "total": len(resultados),
                                         "pares_corretos": sum(all(r["correto"] for r in p) for p in pares.values()),
                                         "total_pares": len(pares), "falsas_priorizacoes": sum(r["priorizou_sem_base"] for r in sem_base),
                                         "sem_base_total": len(sem_base)},
                            "resultados": resultados,
                            "limites": ["Casos sintéticos, sem revisão especializada.",
                                        "Os alvos são julgamentos editoriais; a métrica não comprova retorno."]}, exclusivo=True)
    print("Contraprovas salvas em " + str(args.saida))


if __name__ == "__main__":
    main()
