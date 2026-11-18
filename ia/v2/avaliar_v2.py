"""Avalia ação e citações em um split fixo; resultados não são eficácia em SEO."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

V2 = Path(__file__).resolve().parent
sys.path.insert(0, str(V2.parent))
from runtime import RAIZ, MODELO, REVISAO, PASTA_MODELO, salvar_json, sha256, versoes, verificar_modelo
from contrato_v2 import INSTRUCAO, validar_escolha
from decodificar import gerar_escolha


def pontuar(saida, entrada, alvo):
    erros = validar_escolha(saida, entrada)
    objeto = saida if isinstance(saida, dict) else {}
    acao = objeto.get("acao") == alvo["acao"]
    refs = objeto.get("evidencias") == alvo["evidencias"]
    return {"json_objeto": isinstance(saida, dict), "contrato_valido": not erros,
            "acao_esperada": acao, "referencias_exatas": refs,
            "acao_e_referencias": acao and refs and not erros}, erros


def carregar_modelo(pasta):
    verificar_modelo()
    os.environ.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
    import mlx.core as mx
    from mlx_lm import load
    mx.random.seed(42)
    return load(str(PASTA_MODELO), adapter_path=str(pasta) if pasta else None, trust_remote_code=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adaptador", type=Path)
    parser.add_argument("--dados", type=Path, default=V2 / "dados")
    parser.add_argument("--split", choices=["valid", "test"], required=True)
    parser.add_argument("--modo", choices=["restrito", "livre"], default="restrito")
    parser.add_argument("--selecao", type=Path, help="Registro da seleção obrigatória antes do teste")
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    if args.saida.exists():
        parser.error("Saída já existe; preserve o experimento anterior.")
    pasta = args.dados.resolve()
    manifest_path = pasta / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    arquivo = pasta / f"casos-{args.split}.jsonl"
    if sha256(arquivo) != manifest["arquivos"][arquivo.name]["sha256"]:
        raise ValueError("O split difere do manifest congelado.")
    if args.split == "test":
        if not args.selecao:
            parser.error("Congele a seleção por validação antes de abrir o teste.")
        selecao = json.loads(args.selecao.read_text(encoding="utf-8"))
        if selecao.get("manifesto_sha256") != sha256(manifest_path):
            raise ValueError("Seleção e teste não pertencem ao mesmo dataset.")
        if selecao.get("codigo_sha256") != hashes_codigo():
            raise ValueError("A avaliação mudou depois da seleção.")
        if args.adaptador and (not (args.adaptador / "adapters.safetensors").is_file() or
            sha256(args.adaptador / "adapters.safetensors") != selecao["adaptador_sha256"]):
            raise ValueError("O teste só aceita o adaptador selecionado ou o modelo-base.")
    casos = [json.loads(linha) for linha in arquivo.read_text(encoding="utf-8").splitlines()]
    modelo, tokenizer = carregar_modelo(args.adaptador)
    resultados = []
    inicio = time.monotonic()
    for i, caso in enumerate(casos):
        try:
            bruto, escolha = gerar_escolha(modelo, tokenizer, caso["entrada"], restrito=args.modo == "restrito")
            falha = None
        except (ValueError, RuntimeError) as erro:
            bruto, escolha, falha = "", None, str(erro)
        criterios, erros = pontuar(escolha, caso["entrada"], caso["esperado"])
        resultados.append({"id": caso["id"], "grupo": caso["grupo"], "esperado": caso["esperado"],
                           "saida_bruta": bruto, "escolha": escolha, "erro": falha, "erros_contrato": erros,
                           "criterios": criterios})
        print(f"{args.split}/{args.modo}: {i + 1}/{len(casos)}", flush=True)
    import mlx.core as mx
    metricas = {k: {"aprovados": sum(r["criterios"][k] for r in resultados), "total": len(resultados)}
                for k in resultados[0]["criterios"]}
    por_acao = {}
    for acao in sorted({r["esperado"]["acao"] for r in resultados}):
        grupo = [r for r in resultados if r["esperado"]["acao"] == acao]
        por_acao[acao] = {"acao": sum(x["criterios"]["acao_esperada"] for x in grupo),
                          "ambos": sum(x["criterios"]["acao_e_referencias"] for x in grupo), "total": len(grupo)}
    salvar_json(args.saida, {
        "versao": 2, "split": args.split, "modo": args.modo, "tipo": "adaptador" if args.adaptador else "base",
        "modelo": MODELO, "revisao": REVISAO, "versoes": versoes(), "seed": 42,
        "temperatura": 0, "adaptador_sha256": sha256(args.adaptador / "adapters.safetensors") if args.adaptador else None,
        "config_adaptador_sha256": sha256(args.adaptador / "adapter_config.json") if args.adaptador else None,
        "casos_sha256": sha256(arquivo), "manifesto_sha256": sha256(manifest_path), "codigo_sha256": hashes_codigo(),
        "prompt_sha256": hashlib.sha256(INSTRUCAO.encode()).hexdigest(),
        "duracao_segundos": time.monotonic() - inicio, "pico_memoria_gb": mx.get_peak_memory() / 1e9,
        "metricas": metricas, "por_acao": por_acao, "resultados": resultados,
        "limites": ["Casos sintéticos da mesma autoria; alvos editoriais não revisados por especialista.",
                    "Geração restrita garante apenas escolhas previstas no formato; não garante acerto.",
                    "Não mede impacto de SEO, vendas, retorno ou utilidade no mundo real."],
    }, exclusivo=True)
    print("Avaliação salva em " + str(args.saida))


def hashes_codigo():
    return {nome: sha256(V2 / nome) for nome in ("contrato_v2.py", "decodificar.py", "avaliar_v2.py")}


if __name__ == "__main__":
    main()
