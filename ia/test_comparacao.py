"""Verifica separação e simetria dos pares de treinamento."""

from collections import defaultdict
import json
from pathlib import Path
import unittest
from comparacao.gerar_dados import criar, arquivos
from comparacao.inferir import reconciliar
from comparacao.gerar_estresse import criar as criar_estresse


class ComparacaoTest(unittest.TestCase):
    def test_dataset_reprodutivel_e_familias_sem_vazamento(self):
        casos = criar()
        gerados = arquivos(casos)
        pasta = Path(__file__).parent / "comparacao/dados"
        for nome, conteudo in gerados.items():
            self.assertEqual((pasta / nome).read_bytes(), conteudo, nome)
        grupos = {}
        for caso in casos:
            self.assertEqual(grupos.setdefault(caso["grupo"], caso["split"]), caso["split"])
        self.assertEqual(json.loads(gerados["manifest.json"])["contagens"], {"train": 216, "valid": 12, "test": 18})

    def test_pares_espelhados_trocam_posicao_e_preservam_rotulo(self):
        pares = defaultdict(list)
        for caso in criar():
            pares[caso["par"]].append(caso)
        for chave, par in pares.items():
            self.assertEqual(len(par), 2, chave)
            um, outro = par
            a1, b1 = um["entrada"]["opcoes"]
            a2, b2 = outro["entrada"]["opcoes"]
            self.assertEqual(a1["evidencias"], b2["evidencias"])
            self.assertEqual(b1["evidencias"], a2["evidencias"])
            saidas = {um["esperado"]["escolha"], outro["esperado"]["escolha"]}
            self.assertIn(saidas, ({"a", "b"}, {"insuficiente"}))

    def test_objetivo_financeiro_sem_dados_exige_abstencao(self):
        for caso in criar():
            if "retorno financeiro" in caso["entrada"]["objetivo"]:
                self.assertEqual(caso["esperado"]["escolha"], "insuficiente")
                self.assertTrue(all(v is None for v in caso["entrada"]["dados_negocio"].values()))

    def test_inversao_inconsistente_ou_sem_evidencia_recente_nao_prioriza(self):
        valido = {"evidencias": [{"tipo": "pagina", "atual": True}]}
        desconhecido = {"evidencias": [{"tipo": "serp", "atual": False}]}
        self.assertEqual(reconciliar("a", "a", valido, desconhecido)["estado"], "inconclusiva")
        self.assertEqual(reconciliar("b", "a", valido, desconhecido)["estado"], "inconclusiva")
        self.assertEqual(reconciliar("a", "b", valido, desconhecido)["estado"], "revisao_necessaria")
        self.assertEqual(reconciliar("insuficiente", "insuficiente", valido, desconhecido)["estado"], "inconclusiva")

    def test_estresse_preservado_e_tem_pares_espelhados(self):
        conteudo = criar_estresse()
        self.assertEqual(conteudo, (Path(__file__).parent / "comparacao/casos_estresse.jsonl").read_bytes())
        casos = [json.loads(l) for l in conteudo.splitlines()]
        self.assertEqual(len(casos), 16)
        pares = defaultdict(list)
        for caso in casos:
            pares[caso["par"]].append(caso["esperado"]["escolha"])
        self.assertTrue(all(set(par) in ({"a", "b"}, {"insuficiente"}) for par in pares.values()))


if __name__ == "__main__":
    unittest.main()
