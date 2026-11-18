"""Compara até três contextos locais, dois a dois, sem estimar retorno."""

import argparse
from itertools import combinations
import json
from pathlib import Path
import sys

PASTA = Path(__file__).resolve().parent
sys.path.append(str(PASTA.parent))
sys.path.append(str(PASTA.parent / "v2"))
from runtime import RAIZ, salvar_json, sha256
from comparacao.avaliar import carregar, gerar
from inferir_v2 import sanear


def preparar_par(primeiro, segundo):
    return {"site": primeiro["site"],
            "objetivo": "Qual alternativa possui evidência mais específica para investigar uma melhoria primeiro?",
            "opcoes": [{"id": "a", "evidencias": primeiro["evidencias"]},
                       {"id": "b", "evidencias": segundo["evidencias"]}],
            "dados_negocio": {"volume_busca": None, "taxa_conversao": None, "margem": None}}


def reconciliar(direta, espelhada, primeiro, segundo):
    inverso = {"a": "b", "b": "a", "insuficiente": "insuficiente"}
    if direta not in inverso or espelhada not in inverso:
        return {"estado": "recusada", "motivo": "Escolha fora do contrato."}
    if direta != inverso[espelhada]:
        return {"estado": "inconclusiva", "motivo": "A escolha mudou ao inverter a ordem dos contextos."}
    if direta == "insuficiente":
        return {"estado": "inconclusiva", "motivo": "O modelo considerou as evidências insuficientes para escolher."}
    selecionada = primeiro if direta == "a" else segundo
    if not any(e.get("tipo") in ("serp", "pagina") and e.get("atual") is True for e in selecionada["evidencias"]):
        return {"estado": "inconclusiva", "motivo": "O contexto escolhido não possui evidência recente de página ou busca."}
    return {"estado": "revisao_necessaria", "escolha": direta,
            "motivo": "A IA sugeriu investigar este contexto primeiro; confira as evidências e a alternativa."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entrada", type=Path, default=RAIZ / "data/ia/entrada.json")
    parser.add_argument("--selecao", type=Path, default=RAIZ / "data/ia/comparacao-selecao.json")
    parser.add_argument("--saida", type=Path, default=RAIZ / "data/ia/comparacoes.json")
    args = parser.parse_args()
    if args.entrada.stat().st_size > 1024 * 1024:
        parser.error("Entrada excede o tamanho permitido.")
    envelope = json.loads(args.entrada.read_text(encoding="utf-8"))
    if (not isinstance(envelope, dict) or envelope.get("versao") != 1
            or not isinstance(envelope.get("entradas"), list) or not 2 <= len(envelope["entradas"]) <= 3):
        parser.error("A comparação precisa de duas ou três entradas exportadas pelo aplicativo.")
    entradas = [sanear(e) for e in envelope["entradas"]]
    if len({e["site"] for e in entradas}) != 1:
        parser.error("Os contextos precisam pertencer ao mesmo site.")
    selecao = json.loads(args.selecao.read_text(encoding="utf-8"))
    adaptador = Path(selecao["candidato"]["pasta"])
    if sha256(adaptador / "adapters.safetensors") != selecao["adaptador_sha256"]:
        raise ValueError("O adaptador selecionado foi alterado.")
    if sha256(adaptador / "adapter_config.json") != selecao["candidato"]["config_adaptador_sha256"]:
        raise ValueError("A configuração do adaptador selecionado foi alterada.")
    modelo, tokenizer = carregar(adaptador)
    resultados = []
    for i, j in combinations(range(len(entradas)), 2):
        primeira, segunda = entradas[i], entradas[j]
        direta, bruto = gerar(modelo, tokenizer, preparar_par(primeira, segunda))
        espelhada, bruto_inverso = gerar(modelo, tokenizer, preparar_par(segunda, primeira))
        conclusao = reconciliar(direta["escolha"], espelhada["escolha"], primeira, segunda)
        if "escolha" in conclusao:
            conclusao["indice_entrada"] = i if conclusao["escolha"] == "a" else j
        resultados.append({"indices": [i, j], "contextos": [primeira, segunda],
                           "direta": bruto, "ordem_invertida": bruto_inverso, **conclusao})
    salvar_json(args.saida, {"versao": 1, "estado": "experimental", "adaptador_sha256": selecao["adaptador_sha256"],
                              "resultados": resultados,
                              "aviso": "Comparações servem para selecionar hipóteses de investigação. Não medem demanda, vendas ou retorno financeiro. Revise com uma pessoa."})
    print("Comparações experimentais salvas em " + str(args.saida))


if __name__ == "__main__":
    main()
