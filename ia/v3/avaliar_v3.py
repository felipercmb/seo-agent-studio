"""Avalia decisões, referências e falhas graves predefinidas em casos sintéticos."""

import argparse
import json
import os
from pathlib import Path
import sys
import time

PASTA = Path(__file__).resolve().parent
IA = PASTA.parent
sys.path.insert(0, str(IA))
sys.path.insert(0, str(PASTA))
from runtime import MODELO, REVISAO, PASTA_MODELO, salvar_json, sha256, verificar_modelo, versoes
from contrato_v3 import validar_escolha
from decodificar_v3 import gerar_escolha


def hashes():
    return {str(p.relative_to(IA)): sha256(p) for p in (
        PASTA / "contrato_v3.py", PASTA / "decodificar_v3.py", PASTA / "avaliar_v3.py",
        IA / "v2/contrato_v2.py", IA / "v2/decodificar.py")}


def carregar(adaptador=None):
    verificar_modelo()
    os.environ.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
    import mlx.core as mx
    from mlx_lm import load
    mx.random.seed(42)
    return load(str(PASTA_MODELO), adapter_path=str(adaptador) if adaptador else None, trust_remote_code=False)


def pontuar(escolha, caso):
    entrada, alvo = caso["entrada"], caso["esperado"]
    erros = validar_escolha(escolha, entrada)
    objeto = escolha if isinstance(escolha, dict) else {}
    acao, refs = objeto.get("acao"), objeto.get("evidencias")
    alvo_acao = alvo["acao"]
    # Indicadores limitados a falhas de alto impacto claramente definidas nos alvos.
    grave = ((alvo_acao in ("preservar_exclusao", "confirmar_publicacao") and acao == "corrigir_indexacao")
             or (alvo_acao == "confirmar_publicacao" and acao == "preservar_exclusao")
             or (alvo_acao == "atualizar_coleta" and acao in ("acompanhar", "comparar_concorrentes"))
             or (not entrada.get("evidencias") and acao in ("corrigir_indexacao", "melhorar_pagina", "acompanhar", "comparar_concorrentes")))
    return {"contrato_valido": not erros, "acao_esperada": acao == alvo_acao,
            "referencias_exatas": refs == alvo["evidencias"],
            "acao_e_referencias": not erros and acao == alvo_acao and refs == alvo["evidencias"],
            "falha_grave": bool(grave)}, erros


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adaptador", type=Path)
    parser.add_argument("--split", choices=("valid", "test"), required=True)
    parser.add_argument("--selecao", type=Path)
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    if args.saida.exists():
        parser.error("Resultado já existe.")
    dados = PASTA / "dados"
    manifest_path = dados / "manifest.json"
    manifesto = json.loads(manifest_path.read_text(encoding="utf-8"))
    arq = dados / f"casos-{args.split}.jsonl"
    if sha256(arq) != manifesto["arquivos"][arq.name]["sha256"]:
        raise ValueError("Split difere do manifest.")
    if args.split == "test":
        if not args.selecao:
            parser.error("Congele a seleção pela validação antes de abrir o teste.")
        selecao = json.loads(args.selecao.read_text(encoding="utf-8"))
        if selecao["manifesto_sha256"] != sha256(manifest_path) or selecao["codigo_sha256"] != hashes():
            raise ValueError("Seleção não corresponde ao dataset ou avaliador.")
        if args.adaptador and (sha256(args.adaptador / "adapters.safetensors") != selecao["adaptador_sha256"]
                              or sha256(args.adaptador / "adapter_config.json") != selecao["candidato"]["config_adaptador_sha256"]):
            raise ValueError("Somente o adaptador selecionado ou o modelo-base são aceitos.")
    casos = [json.loads(l) for l in arq.read_text(encoding="utf-8").splitlines()]
    modelo, tokenizer = carregar(args.adaptador)
    resultados = []
    inicio = time.monotonic()
    for i, caso in enumerate(casos):
        try:
            bruto, escolha = gerar_escolha(modelo, tokenizer, caso["entrada"])
            falha = None
        except (ValueError, RuntimeError) as erro:
            bruto, escolha, falha = "", None, str(erro)
        criterios, erros = pontuar(escolha, caso)
        resultados.append({"id": caso["id"], "grupo": caso["grupo"], "esperado": caso["esperado"],
                           "escolha": escolha, "bruto": bruto, "falha": falha, "erros_contrato": erros, "criterios": criterios})
        print(f"v3/{args.split}: {i + 1}/{len(casos)}", flush=True)
    metricas = {k: {"quantidade": sum(r["criterios"][k] for r in resultados), "total": len(resultados)}
                for k in resultados[0]["criterios"]}
    por_acao = {}
    for acao in sorted({r["esperado"]["acao"] for r in resultados}):
        grupo = [r for r in resultados if r["esperado"]["acao"] == acao]
        por_acao[acao] = {"acao": sum(r["criterios"]["acao_esperada"] for r in grupo),
                          "ambos": sum(r["criterios"]["acao_e_referencias"] for r in grupo),
                          "falhas_graves": sum(r["criterios"]["falha_grave"] for r in grupo), "total": len(grupo)}
    salvar_json(args.saida, {"versao": 3, "tipo": "adaptador" if args.adaptador else "base", "split": args.split,
                            "modelo": MODELO, "revisao": REVISAO, "versoes": versoes(), "temperatura": 0,
                            "adaptador_sha256": sha256(args.adaptador / "adapters.safetensors") if args.adaptador else None,
                            "config_adaptador_sha256": sha256(args.adaptador / "adapter_config.json") if args.adaptador else None,
                            "manifesto_sha256": sha256(manifest_path), "casos_sha256": sha256(arq), "codigo_sha256": hashes(),
                            "duracao_segundos": time.monotonic() - inicio, "metricas": metricas, "por_acao": por_acao,
                            "resultados": resultados,
                            "limites": ["Dados sintéticos da mesma autoria, sem validação por especialista.",
                                        "As falhas graves cobrem apenas riscos predefinidos; ausência não comprova segurança.",
                                        "A gramática garante formato, não a verdade da decisão."]}, exclusivo=True)
    print("Avaliação salva em " + str(args.saida))


if __name__ == "__main__":
    main()
