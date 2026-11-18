"""Contraprovas reservadas para ações proibidas com evidência ausente."""

import argparse
import json
from pathlib import Path
import sys
import time

V2 = Path(__file__).resolve().parent
sys.path.insert(0, str(V2.parent))
from runtime import MODELO, REVISAO, salvar_json, sha256
from avaliar_v2 import carregar_modelo, hashes_codigo
from contrato_v2 import validar_escolha
from decodificar import gerar_escolha

SHA_ESTRESSE = "5329557d0bce1e165c602713c44fdc12b8d3b44cb90285abc8d7cee821e9f78b"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adaptador", type=Path)
    parser.add_argument("--selecao", type=Path, required=True)
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    if args.saida.exists():
        parser.error("Saída já existe.")
    selecao = json.loads(args.selecao.read_text(encoding="utf-8"))
    if selecao.get("codigo_sha256") != hashes_codigo():
        raise ValueError("A avaliação mudou desde a seleção.")
    if args.adaptador and sha256(args.adaptador / "adapters.safetensors") != selecao["adaptador_sha256"]:
        raise ValueError("Somente o adaptador selecionado ou o modelo-base pode ser avaliado.")
    arquivo = V2 / "casos_estresse.jsonl"
    if sha256(arquivo) != SHA_ESTRESSE:
        raise ValueError("Os casos de estresse foram alterados.")
    casos = [json.loads(l) for l in arquivo.read_text(encoding="utf-8").splitlines()]
    modelo, tokenizer = carregar_modelo(args.adaptador)
    resultados = []
    inicio = time.monotonic()
    for i, c in enumerate(casos):
        try:
            bruto, escolha = gerar_escolha(modelo, tokenizer, c["entrada"])
            erros = validar_escolha(escolha, c["entrada"])
            nao_proibida = not erros and escolha["acao"] not in c["proibidas"]
        except (ValueError, RuntimeError) as erro:
            bruto, escolha, erros, nao_proibida = "", None, [str(erro)], False
        resultados.append({"id": c["id"], "grupo": c["grupo"], "escolha": escolha, "bruto": bruto,
                           "acoes_proibidas": c["proibidas"], "motivo": c["motivo"],
                           "passou": nao_proibida, "erros": erros})
        print(f"estresse: {i + 1}/{len(casos)}", flush=True)
    salvar_json(args.saida, {
        "versao": 2, "tipo": "adaptador" if args.adaptador else "base", "modelo": MODELO, "revisao": REVISAO,
        "adaptador_sha256": sha256(args.adaptador / "adapters.safetensors") if args.adaptador else None,
        "casos_sha256": SHA_ESTRESSE, "codigo_sha256": hashes_codigo(), "avaliador_estresse_sha256": sha256(Path(__file__)),
        "temperatura": 0, "duracao_segundos": time.monotonic() - inicio,
        "aprovados": sum(r["passou"] for r in resultados), "total": len(resultados), "resultados": resultados,
        "limite": "A ausência das ações proibidas definidas nestes casos não prova segurança, adequação ou robustez geral.",
    }, exclusivo=True)
    print("Resultado de estresse salvo em " + str(args.saida))


if __name__ == "__main__":
    main()
