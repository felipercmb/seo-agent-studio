"""Constrói pares espelhados e reserva famílias inteiras para teste."""

from collections import Counter
import hashlib
import json
from pathlib import Path
import random
import sys

sys.path.append(str(Path(__file__).resolve().parent.parent))
from comparacao.contrato import mensagens
from comparacao import cenarios

PASTA = Path(__file__).resolve().parent
SEED = 314159


def compacto(valor):
    return json.dumps(valor, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def criar():
    rng = random.Random(SEED)
    casos = []
    for split, positivos, insuficientes, n in (
        ("train", cenarios.TREINO_PRIORIZAR, cenarios.TREINO_INSUFICIENTE, 6),
        ("valid", cenarios.VALID_PRIORIZAR, cenarios.VALID_INSUFICIENTE, 1),
        ("test", cenarios.TEST_PRIORIZAR, cenarios.TEST_INSUFICIENTE, 1),
    ):
        for classe, linhas in (("priorizar", positivos), ("insuficiente", insuficientes)):
            for indice, linha in enumerate(linhas):
                primeiro, segundo = linha[:2]
                financeiro = classe == "insuficiente" and linha[2] == "retorno"
                objetivo = ("Qual alternativa terá maior retorno financeiro?" if financeiro else
                            "Qual alternativa possui evidência mais específica para investigar uma melhoria primeiro?")
                for variante in range(n):
                    familia = f"{split}/{classe}/{indice}"
                    par = f"{familia}/{variante}"
                    for espelhado in (False, True):
                        descricao_a, descricao_b = (segundo, primeiro) if espelhado else (primeiro, segundo)
                        alvo = "insuficiente" if classe == "insuficiente" else "b" if espelhado else "a"
                        def contexto(id_opcao, descricao):
                            return {"id": id_opcao, "evidencias": [{"id": "e1", "tipo": "pagina", "atual": True,
                                    "descricao": descricao}]}
                        entrada = {"site": f"{split}-{classe}-{indice}-{variante}.exemplo.invalid", "objetivo": objetivo,
                                   "opcoes": [contexto("a", descricao_a), contexto("b", descricao_b)],
                                   "dados_negocio": {"volume_busca": None, "taxa_conversao": None, "margem": None}}
                        casos.append({"id": f"{par}/{int(espelhado)}", "par": par, "grupo": familia,
                                      "classe": classe, "split": split, "entrada": entrada,
                                      "esperado": {"escolha": alvo}})
    rng.shuffle(casos)
    return casos


def arquivos(casos):
    result = {}
    for split, nome in (("train", "desenvolvimento/train.jsonl"), ("valid", "desenvolvimento/valid.jsonl"), ("test", "holdout/test.jsonl")):
        escolhidos = [c for c in casos if c["split"] == split]
        result[nome] = ("\n".join(compacto({"messages": mensagens(c["entrada"], c["esperado"])}) for c in escolhidos) + "\n").encode()
        result[f"casos-{split}.jsonl"] = ("\n".join(compacto(c) for c in escolhidos) + "\n").encode()
    manifest = {"versao": 1, "seed": SEED,
                "origem": "Pares sintéticos locais, sem dados de clientes ou revisão especializada.",
                "separacao": "Famílias de cenários separadas por split; cada par tem uma versão espelhada no mesmo split.",
                "limitacao": "Mesma autoria e vocabulário nos três splits; prioridade não é uma previsão de retorno.",
                "contagens": dict(Counter(c["split"] for c in casos)),
                "familias": {s: len({c["grupo"] for c in casos if c["split"] == s}) for s in ("train", "valid", "test")},
                "arquivos": {n: {"sha256": hashlib.sha256(d).hexdigest(), "bytes": len(d)} for n, d in sorted(result.items())}}
    result["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    return result


def escrever(destino):
    conjuntos = arquivos(criar())
    for nome, conteudo in conjuntos.items():
        caminho = destino / nome
        if caminho.exists() and caminho.read_bytes() != conteudo:
            raise ValueError("Não sobrescrevendo dataset congelado: " + nome)
    for nome, conteudo in conjuntos.items():
        caminho = destino / nome
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_bytes(conteudo)
    return json.loads(conjuntos["manifest.json"])


if __name__ == "__main__":
    m = escrever(PASTA / "dados")
    print(json.dumps({"contagens": m["contagens"], "familias": m["familias"],
                      "sha_teste": m["arquivos"]["casos-test.jsonl"]["sha256"]}, ensure_ascii=False))
