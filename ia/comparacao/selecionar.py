"""Escolhe pelo comportamento em pares espelhados na validação."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

PASTA = Path(__file__).resolve().parent
sys.path.append(str(PASTA.parent))
from runtime import salvar_json, sha256
from comparacao.avaliar import hashes


def selecionar(candidatos, saida):
    if Path(saida).exists():
        raise ValueError("Seleção já existe.")
    manifest_hash = sha256(PASTA / "dados/manifest.json")
    opcoes = []
    for pasta in map(Path, candidatos):
        prov = json.loads((pasta / "proveniencia.json").read_text(encoding="utf-8"))
        arq = pasta / "validacao.json"
        validacao = json.loads(arq.read_text(encoding="utf-8"))
        if (validacao["split"] != "valid" or validacao["manifesto_sha256"] != manifest_hash
                or prov["manifesto_sha256"] != manifest_hash or validacao["codigo_sha256"] != hashes()
                or validacao["adaptador_sha256"] != sha256(pasta / "adapters.safetensors")
                or validacao["config_adaptador_sha256"] != sha256(pasta / "adapter_config.json")):
            raise ValueError("Candidato incompatível: " + str(pasta))
        opcoes.append({"pasta": str(pasta.resolve()), "passo": prov["passo"],
                       "adaptador_sha256": validacao["adaptador_sha256"], "validacao_sha256": sha256(arq),
                       "config_adaptador_sha256": validacao["config_adaptador_sha256"],
                       **validacao["metricas"]})
    if not opcoes or len({(o["total"], o["total_pares"]) for o in opcoes}) != 1:
        raise ValueError("Candidatos ausentes ou validações diferentes.")
    # Falhas em que faltam dados de comparação/retorno precedem o ganho de acurácia.
    vencedor = max(opcoes, key=lambda o: (-o["falsas_priorizacoes"], o["pares_corretos"], o["acertos"], -o["passo"]))
    resultado = {"congelado_em": datetime.now(timezone.utc).isoformat(), "manifesto_sha256": manifest_hash,
                 "codigo_sha256": hashes(), "politica": "Menos falsas priorizações, depois mais pares corretos, acertos, menor passo e ordem listada.",
                 "adaptador_sha256": vencedor["adaptador_sha256"], "candidato": vencedor, "candidatos": opcoes,
                 "aprovado_para_clientes": False}
    salvar_json(saida, resultado, exclusivo=True)
    return resultado


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidatos", nargs="+", type=Path, required=True)
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(selecionar(args.candidatos, args.saida)["candidato"], ensure_ascii=False, indent=2))
