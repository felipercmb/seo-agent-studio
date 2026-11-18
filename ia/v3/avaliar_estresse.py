"""Contraprovas v3 reservadas: identifica escolhas proibidas predefinidas."""

import argparse
import json
from pathlib import Path
import sys
import time

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent))
from runtime import salvar_json, sha256
from contrato_v3 import validar_escolha
from avaliar_v3 import carregar, hashes
from decodificar_v3 import gerar_escolha

SHA = "62bd245f78842e10ddb55fa44e75c6622d259119f10a3ca96b6557a26147b48c"


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
        raise ValueError("A avaliação mudou após a seleção.")
    if args.adaptador and (sha256(args.adaptador / "adapters.safetensors") != selecao["adaptador_sha256"]
                          or sha256(args.adaptador / "adapter_config.json") != selecao["candidato"]["config_adaptador_sha256"]):
        raise ValueError("Somente o adaptador selecionado ou o modelo-base podem ser avaliados.")
    arquivo = PASTA / "casos_estresse.jsonl"
    if sha256(arquivo) != SHA:
        raise ValueError("As contraprovas foram alteradas.")
    casos = [json.loads(l) for l in arquivo.read_text(encoding="utf-8").splitlines()]
    modelo, tokenizer = carregar(args.adaptador)
    resultados = []
    inicio = time.monotonic()
    for i, c in enumerate(casos):
        try:
            bruto, escolha = gerar_escolha(modelo, tokenizer, c["entrada"])
            erros = validar_escolha(escolha, c["entrada"])
            passou = not erros and escolha["acao"] not in c["proibidas"]
        except (ValueError, RuntimeError) as erro:
            bruto, escolha, erros, passou = "", None, [str(erro)], False
        resultados.append({"id": c["id"], "escolha": escolha, "bruto": bruto,
                           "proibidas": c["proibidas"], "motivo": c["motivo"], "passou": passou, "erros": erros})
        print(f"v3/estresse: {i + 1}/{len(casos)}", flush=True)
    salvar_json(args.saida, {"versao": 3, "tipo": "adaptador" if args.adaptador else "base", "casos_sha256": SHA,
                             "codigo_sha256": hashes(), "avaliador_sha256": sha256(Path(__file__)),
                             "adaptador_sha256": sha256(args.adaptador / "adapters.safetensors") if args.adaptador else None,
                             "duracao_segundos": time.monotonic() - inicio,
                             "aprovados": sum(r["passou"] for r in resultados), "total": len(resultados), "resultados": resultados,
                             "limite": "Ausência das ações proibidas definidas neste conjunto sintético não comprova adequação ou segurança geral."}, exclusivo=True)
    print("Contraprovas salvas em " + str(args.saida))


if __name__ == "__main__":
    main()
