"""Converte testes v2 já observados em desenvolvimento e reserva novo teste v3."""

from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import random
import sys

PASTA = Path(__file__).resolve().parent
IA = PASTA.parent
sys.path.insert(0, str(IA / "v2"))
sys.path.insert(0, str(IA))
from gerar_dados import formar
from contrato_v3 import mensagens, validar_escolha
from v3.cenarios import TREINO, VALIDACAO, TESTE

SEED = 20261116
ALVOS_ESTRESSE_V2 = {
    "ausencia-01": ("validar_demanda", []), "ausencia-02": ("validar_demanda", ["p1"]),
    "indexacao-01": ("preservar_exclusao", ["p1"]), "indexacao-02": ("confirmar_publicacao", ["p1"]),
    "indexacao-03": ("preservar_exclusao", ["p1"]),
    "captura-01": ("atualizar_coleta", ["s1"]), "captura-02": ("atualizar_coleta", ["s1"]),
    "captura-03": ("atualizar_coleta", ["s1"]), "captura-04": ("atualizar_coleta", ["s1"]),
    "injecao-01": ("validar_demanda", ["p1"]), "injecao-02": ("medir_conversao", ["p1"]),
    "injecao-03": ("validar_demanda", ["p1"]), "injecao-04": ("validar_demanda", ["p1"]),
    "comercial-01": ("medir_conversao", ["n1"]), "comercial-02": ("medir_conversao", ["n1"]),
    "comercial-03": ("medir_conversao", ["n1"]),
}


def compacto(dado):
    return json.dumps(dado, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def estresse_antigo(caso, variante, rng):
    entrada = deepcopy(caso["entrada"])
    entrada["site"] = f"v3-estresse-{caso['id']}-{variante}.exemplo.invalid"
    acao, refs_originais = ALVOS_ESTRESSE_V2[caso["id"]]
    evidencias = entrada["evidencias"]
    nomes = rng.sample(["p1", "s1", "d1", "e1", "e2", "e3"], len(evidencias))
    mapa = {e["id"]: nome for e, nome in zip(evidencias, nomes)}
    for e, nome in zip(evidencias, nomes):
        e["id"] = nome
        if e["tipo"] == "pagina":
            e.setdefault("atual", True)
            e.setdefault("observado_em", "2026-11-14T12:00:00Z")
        if e["tipo"] == "serp":
            e.setdefault("observado_em", "2026-11-14T12:00:00Z" if e.get("atual") else "2026-10-10T12:00:00Z")
    rng.shuffle(evidencias)
    alvo = {"acao": acao, "evidencias": sorted(mapa[x] for x in refs_originais)}
    return {"id": f"v3-estresse-{caso['id']}-{variante}", "split": "train", "grupo": f"v2_estresse/{caso['id']}",
            "origem": "v2_estresse_ja_observado", "entrada": entrada, "esperado": alvo}


def criar():
    rng = random.Random(SEED)
    casos = []
    anterior = IA / "v2/dados-b"
    manifesto_anterior = json.loads((anterior / "manifest.json").read_text(encoding="utf-8"))
    for split in ("train", "valid", "test"):
        nome = f"casos-{split}.jsonl"
        conteudo = (anterior / nome).read_bytes()
        if hashlib.sha256(conteudo).hexdigest() != manifesto_anterior["arquivos"][nome]["sha256"]:
            raise ValueError("Dataset anterior diverge do manifesto: " + nome)
        for linha in conteudo.decode("utf-8").splitlines():
            caso = json.loads(linha)
            caso.update(id="v3-v2-" + caso["id"], grupo="v2/" + caso["grupo"], split="train", origem="v2_ja_observado")
            casos.append(caso)
    arq_estresse = IA / "v2/casos_estresse.jsonl"
    if hashlib.sha256(arq_estresse.read_bytes()).hexdigest() != "5329557d0bce1e165c602713c44fdc12b8d3b44cb90285abc8d7cee821e9f78b":
        raise ValueError("Contraprovas v2 anteriores alteradas.")
    estresse = [json.loads(l) for l in arq_estresse.read_text(encoding="utf-8").splitlines()]
    if {c["id"] for c in estresse} != set(ALVOS_ESTRESSE_V2):
        raise ValueError("Conjunto de contraprovas antigo alterado.")
    casos.extend(estresse_antigo(c, n, rng) for c in estresse for n in range(4))
    for split, cenarios, repeticoes in (("train", TREINO, 4), ("valid", VALIDACAO, 1), ("test", TESTE, 1)):
        for indice, (acao, objetivo, evidencias) in enumerate(cenarios):
            for variante in range(repeticoes):
                entrada, alvo = formar(split, acao, 200 + indice, variante, (objetivo, evidencias), rng)
                casos.append({"id": f"v3-{split}-{indice}-{variante}", "split": split,
                              "grupo": f"v3/{split}/{indice}", "origem": "novo_v3",
                              "entrada": entrada, "esperado": alvo})
    rng.shuffle(casos)
    grupos, dominios, assinaturas = {}, set(), {}
    for caso in casos:
        if caso["entrada"]["site"] in dominios:
            raise ValueError("Domínio duplicado: " + caso["id"])
        dominios.add(caso["entrada"]["site"])
        if grupos.setdefault(caso["grupo"], caso["split"]) != caso["split"]:
            raise ValueError("Família presente em múltiplos splits")
        assinatura = compacto(sorted((e["tipo"], e["descricao"]) for e in caso["entrada"]["evidencias"]))
        anterior = assinaturas.setdefault(assinatura, caso["split"])
        if assinatura != "[]" and anterior != caso["split"]:
            raise ValueError("Mesma evidência literal em splits diferentes")
        erros = validar_escolha(caso["esperado"], caso["entrada"])
        if erros:
            raise ValueError(f"Alvo inválido {caso['id']}: {erros}")
    return casos


def arquivos(casos):
    saida = {}
    for split, nome in (("train", "desenvolvimento/train.jsonl"), ("valid", "desenvolvimento/valid.jsonl"), ("test", "holdout/test.jsonl")):
        escolhidos = [c for c in casos if c["split"] == split]
        saida[nome] = ("\n".join(compacto({"messages": mensagens(c["entrada"], c["esperado"])}) for c in escolhidos) + "\n").encode()
        saida[f"casos-{split}.jsonl"] = ("\n".join(compacto(c) for c in escolhidos) + "\n").encode()
    manifest = {"versao": 3, "seed": SEED,
                "origem": "Casos fictícios locais sem dados de clientes ou revisão especializada.",
                "separacao": "Todos os conjuntos e contraprovas v2 já observados foram promovidos ao treino v3. Validação e teste v3 são novas famílias.",
                "limites": "Mesma autoria, vocabulário e hipóteses editoriais; não mede eficácia ou receita real.",
                "contagens": dict(Counter(c["split"] for c in casos)),
                "familias": {s: len({c["grupo"] for c in casos if c["split"] == s}) for s in ("train", "valid", "test")},
                "arquivos": {n: {"sha256": hashlib.sha256(d).hexdigest(), "bytes": len(d)} for n, d in sorted(saida.items())}}
    saida["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    return saida


def escrever(destino):
    resultado = arquivos(criar())
    for nome, conteudo in resultado.items():
        caminho = destino / nome
        if caminho.exists() and caminho.read_bytes() != conteudo:
            raise ValueError("Não sobrescrevendo dataset congelado: " + nome)
    for nome, conteudo in resultado.items():
        caminho = destino / nome
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_bytes(conteudo)
    return json.loads(resultado["manifest.json"])


if __name__ == "__main__":
    m = escrever(PASTA / "dados")
    print(json.dumps({"contagens": m["contagens"], "familias": m["familias"],
                      "sha_teste": m["arquivos"]["casos-test.jsonl"]["sha256"]}, ensure_ascii=False))
