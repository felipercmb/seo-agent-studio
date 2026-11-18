"""Verifica a integridade dos resultados sintéticos publicados localmente."""

from collections import defaultdict
import json
from pathlib import Path
import unittest
from runtime import sha256

IA = Path(__file__).resolve().parent
RESULTADOS = IA / "resultados/treinos-2026-11-14"


def carregar(nome):
    return json.loads((RESULTADOS / (nome + ".json")).read_text(encoding="utf-8"))


class ResultadosTest(unittest.TestCase):
    def test_v2_modelos_usam_mesmo_teste_e_contagens_reproduzem_itens(self):
        base, ajustado = carregar("v2b-base-teste"), carregar("v2b-treinado-teste")
        esperado_hash = sha256(IA / "v2/dados-b/casos-test.jsonl")
        for d in (base, ajustado):
            self.assertEqual(d["casos_sha256"], esperado_hash)
            self.assertEqual(len(d["resultados"]), 32)
            for criterio, item in d["metricas"].items():
                self.assertEqual(item["aprovados"], sum(r["criterios"][criterio] for r in d["resultados"]))
                self.assertEqual(item["total"], len(d["resultados"]))
        self.assertEqual(base["codigo_sha256"], ajustado["codigo_sha256"])
        self.assertEqual(ajustado["adaptador_sha256"], carregar("v2-selecao")["adaptador_sha256"])

    def test_v3_respostas_e_metricas_correspondem_ao_teste_congelado(self):
        base, ajustado = carregar("v3-base-teste"), carregar("v3-treinado-teste")
        casos_hash = sha256(IA / "v3/dados/casos-test.jsonl")
        for d in (base, ajustado):
            self.assertEqual(d["casos_sha256"], casos_hash)
            for criterio, metrica in d["metricas"].items():
                self.assertEqual(metrica["quantidade"], sum(r["criterios"][criterio] for r in d["resultados"]))
                self.assertEqual(metrica["total"], len(d["resultados"]))
            for nome, hash_esperado in d["codigo_sha256"].items():
                self.assertEqual(sha256(IA / nome), hash_esperado)
        self.assertEqual(ajustado["adaptador_sha256"], carregar("v3-selecao")["adaptador_sha256"])

    def test_contraprovas_mostram_apenas_acoes_proibidas_definidas(self):
        for pasta, prefixo in (("v2", "v2b"), ("v3", "v3")):
            casos = {c["id"]: c for c in map(json.loads, (IA / pasta / "casos_estresse.jsonl").read_text(encoding="utf-8").splitlines())}
            for tipo in ("base", "treinado"):
                d = carregar(f"{prefixo}-{tipo}-estresse")
                self.assertEqual(d["casos_sha256"], sha256(IA / pasta / "casos_estresse.jsonl"))
                self.assertEqual(d["aprovados"], sum(r["passou"] for r in d["resultados"]))
                for r in d["resultados"]:
                    if r["passou"]:
                        self.assertNotIn(r["escolha"]["acao"], casos[r["id"]]["proibidas"])

    def test_comparador_reproduz_acertos_pares_e_falsas_priorizacoes(self):
        base, ajustado = carregar("comparacao-base-teste"), carregar("comparacao-treinado-teste")
        for d in (base, ajustado):
            self.assertEqual(d["casos_sha256"], sha256(IA / "comparacao/dados/casos-test.jsonl"))
            pares = defaultdict(list)
            for r in d["resultados"]:
                self.assertEqual(r["correto"], r["saida"] == r["esperado"])
                pares[r["par"]].append(r)
            m = d["metricas"]
            self.assertEqual(m["acertos"], sum(r["correto"] for r in d["resultados"]))
            self.assertEqual(m["pares_corretos"], sum(all(r["correto"] for r in p) for p in pares.values()))
            self.assertEqual(m["falsas_priorizacoes"], sum(r["priorizou_sem_base"] for r in d["resultados"]))
        self.assertEqual(ajustado["adaptador_sha256"], carregar("comparacao-selecao")["adaptador_sha256"])


if __name__ == "__main__":
    unittest.main()
