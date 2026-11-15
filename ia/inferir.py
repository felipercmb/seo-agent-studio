"""Assistente experimental local: saída inválida é recusada, nunca reparada em segredo."""

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
from contrato import validar_saida
from runtime import RAIZ, MODELO, REVISAO, carregar, gerar, salvar_json, sha256


def preparar_entrada(entrada, agora=None):
    if not isinstance(entrada, dict) or not isinstance(entrada.get("site"), str):
        raise ValueError("Entrada precisa de site e evidencias.")
    evidencias = entrada.get("evidencias")
    if not isinstance(evidencias, list) or len(evidencias) > 3:
        raise ValueError("Use no máximo três evidências por análise neste piloto.")
    copia = deepcopy(entrada)
    ids = set()
    agora = agora or datetime.now(timezone.utc)
    for e in copia["evidencias"]:
        if not isinstance(e, dict) or not isinstance(e.get("id"), str) or e["id"] in ids:
            raise ValueError("Evidências precisam de IDs únicos.")
        ids.add(e["id"])
        if e.get("atual"):
            try:
                observado = datetime.fromisoformat(e.get("observado_em", "").replace("Z", "+00:00"))
                idade = (agora - observado).total_seconds()
                valido = 0 <= idade <= (3600 if e.get("tipo") == "serp" else 86400)
            except (ValueError, TypeError):
                valido = False
            if not valido:
                e["atual"] = False
                if e.get("tipo") == "serp":
                    e["posicao"] = None
                    e.pop("concorrentes", None)
                e["descricao"] = "Evidência sem data válida ou fora da validade na hora da inferência. Atualize a coleta."
    return copia


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entrada", type=Path, default=RAIZ / "data/ia/entrada.json")
    parser.add_argument("--adaptador", type=Path, default=RAIZ / "data/ia/piloto-v1")
    parser.add_argument("--saida", type=Path, default=RAIZ / "data/ia/recomendacoes.json")
    args = parser.parse_args()
    if args.entrada.stat().st_size > 1024 * 1024:
        parser.error("Arquivo de entrada grande demais.")
    envelope = json.loads(args.entrada.read_text(encoding="utf-8"))
    if not isinstance(envelope, dict) or envelope.get("versao") != 1 or not isinstance(envelope.get("entradas"), list):
        parser.error("Use o envelope gerado por scripts/preparar-ia.mjs.")
    if not 1 <= len(envelope["entradas"]) <= 3:
        parser.error("O piloto aceita de uma a três entradas.")
    entradas = [preparar_entrada(e) for e in envelope["entradas"]]
    modelo, tokenizer = carregar(args.adaptador)
    resultados = []
    for entrada in entradas:
        bruto = gerar(modelo, tokenizer, entrada)
        erros = validar_saida(bruto, entrada)
        resultados.append({"estado": "recusada" if erros else "revisao_necessaria", "entrada": entrada,
                           "recomendacao": None if erros else json.loads(bruto), "erros": erros,
                           "saida_bruta": bruto})
    salvar_json(args.saida, {
        "estado": "experimental", "modelo": MODELO, "revisao": REVISAO,
        "adaptador_sha256": sha256(args.adaptador / "adapters.safetensors"),
        "resultados": resultados,
        "aviso": "Modelo ajustado com casos sintéticos. Validação automática confere formato e referências, não veracidade. Revise as recomendações antes de agir.",
    })
    print("Análise experimental salva em " + str(args.saida))


if __name__ == "__main__":
    main()
