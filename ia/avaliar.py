"""Avaliação sintética: mesmos casos e decodificador para base e adaptador."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import time

from contrato import SYSTEM_PROMPT, validar_saida
from runtime import RAIZ, MODELO, REVISAO, MAX_RESPOSTA, MAX_SEQUENCIA, SEED, carregar, gerar, salvar_json, sha256, versoes, verificar_dataset


def pontuar(bruto, entrada, esperado):
    erros = validar_saida(bruto, entrada)
    try:
        saida = json.loads(bruto)
    except (ValueError, TypeError):
        saida = None
    objeto = saida if isinstance(saida, dict) else {}
    referencias = objeto.get("evidencias")
    refs = set(referencias) if isinstance(referencias, list) and all(isinstance(x, str) for x in referencias) else set()
    ids = {e["id"] for e in entrada.get("evidencias", [])}
    # Só sinaliza uma expressão de limitação; não julga veracidade/semântica.
    limite = objeto.get("limite", "")
    limite = limite.casefold() if isinstance(limite, str) else ""
    limita_receita = bool(re.search(r"retorno|receita|vendas|convers[aã]o|comercia|financeir", limite)
                         and re.search(r"n[aã]o|sem |falta|ausen|insuf|desconhec|imposs", limite))
    criterios = {
        "json_objeto": isinstance(saida, dict),
        "contrato_valido": not erros,
        "acao_esperada": objeto.get("acao") in esperado["acoes_aceitas"],
        "prioridade_esperada": objeto.get("prioridade") in esperado["prioridades_aceitas"],
        "referencias_esperadas": isinstance(referencias, list) and refs <= ids
            and set(esperado["evidencias_obrigatorias"]) <= refs,
        "limitacao_receita_lexical": limita_receita if esperado.get("deve_abster_receita") else True,
    }
    criterios["todos_criterios_mecanicos"] = all(criterios.values())
    return {"criterios": criterios, "erros_contrato": erros}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adaptador", type=Path)
    parser.add_argument("--split", choices=["valid", "test"], default="test")
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    if args.saida.exists():
        parser.error("A avaliação já existe; use outro caminho para preservar o resultado.")
    verificar_dataset()
    arquivo_casos = RAIZ / "ia/dados/casos.jsonl"
    casos = [json.loads(l) for l in arquivo_casos.read_text(encoding="utf-8").splitlines() if l]
    casos = [c for c in casos if c["split"] == args.split]
    if not casos:
        raise ValueError("Split sem casos.")
    modelo, tokenizer = carregar(args.adaptador)
    resultados = []
    inicio = time.monotonic()
    for i, caso in enumerate(casos):
        t = time.monotonic()
        try:
            bruto = gerar(modelo, tokenizer, caso["entrada"])
            falha = None
        except (ValueError, RuntimeError) as erro:
            bruto, falha = "", str(erro)
        resultados.append({"id": caso["id"], "grupo": caso["grupo"], "saida_bruta": bruto,
                           "falha": falha, "segundos": time.monotonic() - t,
                           **pontuar(bruto, caso["entrada"], caso["esperado"])})
        # Não mostrar respostas durante o experimento; não orientar ajustes pelo teste.
        print(f"{i + 1}/{len(casos)} casos avaliados", flush=True)
    import mlx.core as mx
    chaves = resultados[0]["criterios"]
    metricas = {chave: {"aprovados": sum(r["criterios"][chave] for r in resultados), "total": len(resultados)}
                for chave in chaves}
    salvar_json(args.saida, {
        "versao": 1, "tipo": "adaptador" if args.adaptador else "base", "split": args.split,
        "modelo": MODELO, "revisao": REVISAO, "versoes": versoes(),
        "casos_sha256": sha256(arquivo_casos),
        "prompt_sha256": hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest(),
        "avaliador_sha256": sha256(Path(__file__)),
        "codigo_sha256": {nome: sha256(RAIZ / "ia" / nome) for nome in ("contrato.py", "runtime.py")},
        "adaptador_sha256": sha256(args.adaptador / "adapters.safetensors") if args.adaptador else None,
        "config_adaptador_sha256": sha256(args.adaptador / "adapter_config.json") if args.adaptador else None,
        "decodificador": {"temperatura": 0, "seed": SEED, "max_tokens": MAX_RESPOSTA, "max_sequencia": MAX_SEQUENCIA},
        "duracao_segundos": time.monotonic() - inicio, "pico_memoria_gb": mx.get_peak_memory() / 1e9,
        "metricas": metricas, "resultados": resultados,
        "limites": ["Casos sintéticos, sem avaliação humana especializada.",
                    "Critérios mecânicos e detector lexical não comprovam fidelidade semântica.",
                    "Este teste não mede ganho de posições, tráfego, vendas ou retorno."],
    }, exclusivo=True)
    print("Avaliação salva: " + str(args.saida))


if __name__ == "__main__":
    main()
