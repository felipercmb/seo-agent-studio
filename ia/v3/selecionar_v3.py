"""Seleciona por validação, priorizando a redução das falhas graves predefinidas."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent))
from runtime import salvar_json, sha256
from avaliar_v3 import hashes


def selecionar(candidatos, saida):
    if Path(saida).exists():
        raise ValueError("Seleção já congelada.")
    manifest_hash = sha256(PASTA / "dados/manifest.json")
    opcoes = []
    for pasta in map(Path, candidatos):
        origem = json.loads((pasta / "proveniencia.json").read_text(encoding="utf-8"))
        arq = pasta / "validacao.json"
        d = json.loads(arq.read_text(encoding="utf-8"))
        if (d["split"] != "valid" or d["manifesto_sha256"] != manifest_hash or origem["manifesto_sha256"] != manifest_hash
                or d["codigo_sha256"] != hashes() or d["adaptador_sha256"] != sha256(pasta / "adapters.safetensors")
                or d["config_adaptador_sha256"] != sha256(pasta / "adapter_config.json")):
            raise ValueError("Candidato incompatível: " + str(pasta))
        m = d["metricas"]
        opcoes.append({"pasta": str(pasta.resolve()), "passo": origem["passo"], "adaptador_sha256": d["adaptador_sha256"],
                       "config_adaptador_sha256": d["config_adaptador_sha256"], "validacao_sha256": sha256(arq),
                       "falhas_graves": m["falha_grave"]["quantidade"], "ambos": m["acao_e_referencias"]["quantidade"],
                       "acao": m["acao_esperada"]["quantidade"], "referencias": m["referencias_exatas"]["quantidade"],
                       "total": m["acao_esperada"]["total"]})
    if not opcoes or len({o["total"] for o in opcoes}) != 1:
        raise ValueError("Candidatos ausentes ou validações incompatíveis.")
    melhor = max(opcoes, key=lambda o: (-o["falhas_graves"], o["ambos"], o["acao"], o["referencias"], -o["passo"]))
    resultado = {"versao": 3, "congelado_em": datetime.now(timezone.utc).isoformat(), "manifesto_sha256": manifest_hash,
                 "codigo_sha256": hashes(), "adaptador_sha256": melhor["adaptador_sha256"], "candidato": melhor,
                 "candidatos": opcoes, "aprovado_para_clientes": False,
                 "politica": "Menos falhas graves predefinidas, depois mais acertos conjuntos, ação, referências, menor passo e ordem listada."}
    salvar_json(saida, resultado, exclusivo=True)
    return resultado


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidatos", nargs="+", type=Path, required=True)
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(selecionar(args.candidatos, args.saida)["candidato"], ensure_ascii=False, indent=2))
