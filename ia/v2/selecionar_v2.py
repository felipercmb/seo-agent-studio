"""Congela candidato por validação, antes de abrir o novo teste."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

V2 = Path(__file__).resolve().parent
sys.path.insert(0, str(V2.parent))
from runtime import salvar_json, sha256
from avaliar_v2 import hashes_codigo


def selecionar(diretorios, saida, pasta_dados=V2 / "dados"):
    if Path(saida).exists():
        raise ValueError("Seleção já congelada.")
    manifesto = Path(pasta_dados) / "manifest.json"
    manifest_hash = sha256(manifesto)
    manifest_data = json.loads(manifesto.read_text(encoding="utf-8"))
    manifestos_treino = {manifest_hash, manifest_data.get("base_manifest_sha256")}
    opcoes = []
    for pasta in map(Path, diretorios):
        arq = pasta / "validacao.json"
        avaliacao = json.loads(arq.read_text(encoding="utf-8"))
        origem = json.loads((pasta / "proveniencia.json").read_text(encoding="utf-8"))
        if (avaliacao["split"] != "valid" or avaliacao["modo"] != "restrito"
                or avaliacao["manifesto_sha256"] != manifest_hash
                or origem["manifesto_sha256"] not in manifestos_treino
                or avaliacao["codigo_sha256"] != hashes_codigo()
                or avaliacao["adaptador_sha256"] != sha256(pasta / "adapters.safetensors")
                or avaliacao["config_adaptador_sha256"] != sha256(pasta / "adapter_config.json")):
            raise ValueError("Avaliação incompatível com candidato: " + str(pasta))
        metricas = avaliacao["metricas"]
        opcoes.append({"pasta": str(pasta.resolve()), "passo": origem["passo"], "manifesto_treino_sha256": origem["manifesto_sha256"],
                       "adaptador_sha256": avaliacao["adaptador_sha256"], "validacao_sha256": sha256(arq),
                       "config_adaptador_sha256": avaliacao["config_adaptador_sha256"],
                       "ambos": metricas["acao_e_referencias"]["aprovados"],
                       "acao": metricas["acao_esperada"]["aprovados"],
                       "referencias": metricas["referencias_exatas"]["aprovados"],
                       "total": metricas["acao_e_referencias"]["total"]})
    if not opcoes or len({o["total"] for o in opcoes}) != 1:
        raise ValueError("Candidatos ausentes ou avaliações com totais diferentes.")
    vencedor = max(opcoes, key=lambda o: (o["ambos"], o["acao"], o["referencias"], -o["passo"]))
    resultado = {"versao": 2, "congelado_em": datetime.now(timezone.utc).isoformat(),
                 "politica": "Maior acerto simultâneo em ação e referências; desempate por ação, referências, menor passo e ordem listada.",
                 "manifesto_sha256": manifest_hash, "codigo_sha256": hashes_codigo(),
                 "adaptador_sha256": vencedor["adaptador_sha256"], "candidato": vencedor, "candidatos": opcoes,
                 "revisao_humana": "pendente", "aprovado_para_clientes": False}
    salvar_json(saida, resultado, exclusivo=True)
    return resultado


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidatos", nargs="+", type=Path, required=True)
    parser.add_argument("--dados", type=Path, default=V2 / "dados")
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    selecionado = selecionar(args.candidatos, args.saida, args.dados)
    print(json.dumps(selecionado["candidato"], ensure_ascii=False, indent=2))
