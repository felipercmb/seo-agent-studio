"""Analisa relatórios locais com o candidato selecionado; não altera sites ou gastos."""

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

V2 = Path(__file__).resolve().parent
sys.path.insert(0, str(V2.parent))
from runtime import RAIZ, MODELO, REVISAO, salvar_json, sha256
from avaliar_v2 import carregar_modelo
from contrato_v2 import apresentar
from decodificar import gerar_escolha


def sanear(entrada, agora=None):
    if not isinstance(entrada, dict) or not isinstance(entrada.get("site"), str):
        raise ValueError("Entrada inválida.")
    copia = deepcopy(entrada)
    evidencias = copia.get("evidencias")
    if not isinstance(evidencias, list) or len(evidencias) > 3:
        raise ValueError("Máximo de três evidências por contexto.")
    ids, agora = set(), agora or datetime.now(timezone.utc)
    for e in evidencias:
        if not isinstance(e, dict) or not isinstance(e.get("id"), str) or not e["id"] or e["id"] in ids:
            raise ValueError("IDs de evidência devem ser textos únicos e não vazios.")
        ids.add(e["id"])
        if e.get("tipo") not in ("serp", "pagina", "negocio"):
            raise ValueError("Tipo de evidência desconhecido.")
        if e["tipo"] in ("serp", "pagina"):
            try:
                data = datetime.fromisoformat(e.get("observado_em", "").replace("Z", "+00:00"))
                idade = (agora - data).total_seconds()
                prazo = 3600 if e["tipo"] == "serp" else 86400
                recente = e.get("atual") is True and 0 <= idade < prazo
            except (ValueError, TypeError, AttributeError):
                recente = False
            if not recente:
                e["atual"] = False
                e["descricao"] = "Evidência ausente, desatualizada ou sem data válida; sua condição atual é desconhecida."
                if e["tipo"] == "serp":
                    e["posicao"] = None
                    e.pop("concorrentes", None)
    return copia


def validar_aplicabilidade(escolha, entrada):
    """Regras conservadoras da integração; não autenticam um JSON editado à mão."""
    acao, ids = escolha.get("acao"), escolha.get("evidencias", [])
    citadas = [e for e in entrada["evidencias"] if e.get("id") in ids]
    serp = [e for e in citadas if e.get("tipo") == "serp" and e.get("atual") is True
            and type(e.get("posicao")) is int and e["posicao"] > 0]
    paginas = [e for e in citadas if e.get("tipo") == "pagina" and e.get("atual") is True]
    if acao == "corrigir_indexacao":
        return ["O relatório atual não confirma a intenção de publicação. Verifique a diretiva e a intenção com o responsável antes de corrigir."]
    if acao == "melhorar_pagina" and not paginas:
        return ["A escolha não cita uma evidência recente da página que permita examinar a melhoria."]
    if acao == "acompanhar" and not serp:
        return ["A escolha não cita uma posição atual válida para acompanhar."]
    if acao == "comparar_concorrentes" and not any(
        isinstance(e.get("concorrentes"), list) and any(
            isinstance(c, dict) and type(c.get("posicao")) is int and 0 < c["posicao"] < e["posicao"]
            for c in e["concorrentes"]
        ) for e in serp
    ):
        return ["A escolha não cita concorrentes à frente em uma captura atual comparável."]
    return []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entrada", type=Path, default=RAIZ / "data/ia/entrada.json")
    parser.add_argument("--selecao", type=Path, default=RAIZ / "data/ia/v2-selecao.json")
    parser.add_argument("--saida", type=Path, default=RAIZ / "data/ia/v2-recomendacoes.json")
    args = parser.parse_args()
    if args.entrada.stat().st_size > 1024 * 1024:
        parser.error("Entrada excede o tamanho permitido.")
    envelope = json.loads(args.entrada.read_text(encoding="utf-8"))
    if (not isinstance(envelope, dict) or envelope.get("versao") != 1
            or not isinstance(envelope.get("entradas"), list) or not 1 <= len(envelope["entradas"]) <= 3):
        parser.error("Use o envelope gerado por scripts/preparar-ia.mjs.")
    selecao = json.loads(args.selecao.read_text(encoding="utf-8"))
    adaptador = Path(selecao["candidato"]["pasta"])
    if sha256(adaptador / "adapters.safetensors") != selecao["adaptador_sha256"]:
        raise ValueError("O adaptador selecionado foi alterado.")
    if sha256(adaptador / "adapter_config.json") != selecao["candidato"]["config_adaptador_sha256"]:
        raise ValueError("A configuração do adaptador selecionado foi alterada.")
    entradas = [sanear(e) for e in envelope["entradas"]]
    modelo, tokenizer = carregar_modelo(adaptador)
    resultados = []
    for entrada in entradas:
        bruto, escolha = gerar_escolha(modelo, tokenizer, entrada)
        resultado = apresentar(escolha, entrada)
        if resultado["estado"] != "recusada":
            bloqueios = validar_aplicabilidade(escolha, entrada)
            if bloqueios:
                resultado["estado"] = "recusada"
                resultado["motivos_aplicabilidade"] = bloqueios
        resultados.append({"entrada": entrada, "saida_bruta": bruto, **resultado})
    salvar_json(args.saida, {"versao": 2, "estado": "experimental", "modelo": MODELO, "revisao": REVISAO,
                              "adaptador_sha256": selecao["adaptador_sha256"], "resultados": resultados,
                              "aviso": "Requer revisão humana. O formato não garante que as escolhas sejam corretas."})
    print("Análise experimental salva em " + str(args.saida))


if __name__ == "__main__":
    main()
