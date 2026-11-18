"""Mede projeções para revisão em predições DEV/VAL, sem reavaliar o modelo."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from negocio.projecao.itens import CAMPOS, projetar_itens_para_revisao


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--predicoes", type=Path, nargs="+", required=True)
    p.add_argument("--saida", type=Path, required=True)
    a = p.parse_args()
    if a.saida.exists():
        p.error("Diretório novo obrigatório.")
    arquivos = []
    for path in a.predicoes:
        if re.search(r"(?:^|[/_-])(test|teste|holdout)(?:[/_.-]|$)", str(path), re.I):
            p.error("Este utilitário é somente DEV/VAL; não abrir TEST.")
        raw = path.read_bytes()
        d = json.loads(raw)
        if any(x.get("split") not in {"train", "validation", "development", "dev"} for x in d["resultados"]):
            p.error("Split desconhecido ou reservado; não projetar.")
        arquivos.append((path, raw, d))
    a.saida.mkdir(parents=True)
    resumo = []
    for path, raw, d in arquivos:
        resultados, estados = [], Counter()
        for x in d["resultados"]:
            e = x["entrada"]
            if e.get("tarefa") != "entender" or e.get("campo") not in CAMPOS:
                continue
            result = projetar_itens_para_revisao(x["geracao"].get("textoBruto"), e)
            estados[result["estado"]] += 1
            resultados.append({"id": x["id"], "split": x["split"], "dominio": x.get("dominio"),
                               "campo": e["campo"], "entradaPredicaoSha256": x.get("entradaSha256"),
                               "projecaoParaRevisao": result})
        reports = [x["projecaoParaRevisao"] for x in resultados]
        metricas = {"campos": len(reports), "originaisAceitosContrato": sum(x["originalAceitoPeloContrato"] is True for x in reports),
                    "projecoesParciais": sum(x["projecaoParcial"] for x in reports),
                    "itensRecuperadosParaRevisao": sum(len(x["retidos"]) for x in reports if x["projecaoParcial"]),
                    "itensJaValidosNoOriginal": sum(len(x["retidos"]) for x in reports if x["estado"] == "original_valido_sem_recuperacao"),
                    "itensDescartados": sum(len(x["descartados"]) for x in reports),
                    "estados": dict(estados)}
        report = {"versao": 1, "executadoEm": datetime.now(timezone.utc).isoformat(),
                  "predicoes": str(path), "predicoesSha256": hashlib.sha256(raw).hexdigest(),
                  "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  "helperSha256": hashlib.sha256(Path(__file__).with_name("itens.py").read_bytes()).hexdigest(),
                  "MLXImportado": "mlx.core" in sys.modules, "GPUUsada": False,
                  "runtimeIntegrado": False, "scoresOriginaisNaoRecomputados": True,
                  "uso": "somente_revisao_humana", "revisaoSemanticaPendente": True,
                  "metricas": metricas, "resultados": resultados,
                  "limite": "Retenção mecânica de itens não é novo acerto do modelo, verdade factual, preservação de todos os qualificadores ou utilidade de negócio."}
        target = a.saida / (path.stem + ".projecao.json")
        with target.open("x") as out:
            json.dump(report, out, ensure_ascii=False, indent=2, allow_nan=False)
            out.write("\n")
        resumo.append({"arquivo": str(target), "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                       "predicoes": str(path), "metricas": metricas})
    manifest = {"versao": 1, "executadoEm": datetime.now(timezone.utc).isoformat(),
                "natureza": "projecao_derivada_DEV_VAL_so_para_revisao", "runtimeIntegrado": False,
                "novosAcertosDoModeloAtribuidos": 0, "arquivos": resumo}
    with (a.saida / "manifesto.json").open("x") as out:
        json.dump(manifest, out, ensure_ascii=False, indent=2)
        out.write("\n")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
