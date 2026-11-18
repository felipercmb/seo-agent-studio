"""Testes do contrato e isolamento de dados sem carregar modelos."""

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parent / "v2"))
from contrato_v2 import escolhas_possiveis, validar_escolha, apresentar
from decodificar import arvore_sequencias
from gerar_dados import SETORES, arquivos, criar
from gerar_dados_b import criar_arquivos
from inferir_v2 import sanear, validar_aplicabilidade


class ExperimentoV2Test(unittest.TestCase):
    def test_manifest_e_splits_reproduziveis(self):
        casos = criar()
        resultado = arquivos(casos)
        pasta = Path(__file__).parent / "v2/dados"
        for nome, dados in resultado.items():
            self.assertEqual((pasta / nome).read_bytes(), dados, nome)
        grupos = {}
        dominios = set()
        for caso in casos:
            self.assertEqual(grupos.setdefault(caso["grupo"], caso["split"]), caso["split"])
            self.assertNotIn(caso["entrada"]["site"], dominios)
            dominios.add(caso["entrada"]["site"])
            self.assertEqual(validar_escolha(caso["esperado"], caso["entrada"]), [])
            if caso["origem"] == "v1_ja_observado":
                self.assertEqual(caso["split"], "train")
        self.assertTrue(set(SETORES["test"]).isdisjoint(SETORES["train"]))
        self.assertTrue(set(SETORES["test"]).isdisjoint(SETORES["valid"]))
        manifest = json.loads(resultado["manifest.json"])
        self.assertEqual(manifest["contagens"], {"train": 368, "valid": 16, "test": 32})

    def test_gramatica_gera_apenas_ids_existentes_e_saida_curta(self):
        opcoes = list(escolhas_possiveis(["p1", "s1"]))
        self.assertEqual(len(opcoes), 8 * 4)
        for escolha in opcoes:
            self.assertLessEqual(set(escolha["evidencias"]), {"p1", "s1"})
            self.assertEqual(escolha["evidencias"], sorted(escolha["evidencias"]))
        with self.assertRaises(ValueError):
            list(escolhas_possiveis(["x", "x"]))

    def test_complemento_preserva_teste_e_adiciona_contrafactuais(self):
        b = criar_arquivos()
        pasta = Path(__file__).parent / "v2"
        for nome, conteudo in b.items():
            self.assertEqual((pasta / "dados-b" / nome).read_bytes(), conteudo, nome)
        self.assertEqual(b["casos-test.jsonl"], (pasta / "dados/casos-test.jsonl").read_bytes())
        self.assertEqual(b["holdout/test.jsonl"], (pasta / "dados/holdout/test.jsonl").read_bytes())
        manifest = json.loads(b["manifest.json"])
        self.assertEqual(manifest["contagens"], {"train": 418, "valid": 24, "test": 32})

    def test_trie_permite_somente_continuacoes_e_encerramento(self):
        arvore = arvore_sequencias([[1, 2, 3], [1, 2, 4], [1, 5]], eos=99)
        self.assertEqual(arvore[()], {1})
        self.assertEqual(arvore[(1, 2)], {3, 4})
        self.assertEqual(arvore[(1, 2, 3)], {99})
        self.assertNotIn((1, 3), arvore)

    def test_validar_escolha_recusa_referencia_inventada_e_correcao_sem_evidencia(self):
        entrada = {"evidencias": [{"id": "s1"}]}
        self.assertIn("referencias_invalidas", validar_escolha({"acao": "acompanhar", "evidencias": ["z9"]}, entrada))
        self.assertIn("acao_sem_evidencia", validar_escolha({"acao": "corrigir_indexacao", "evidencias": []}, entrada))
        self.assertEqual(apresentar({"acao": "corrigir_indexacao", "evidencias": []}, entrada)["estado"], "recusada")

    def test_textos_modelos_ficam_identificados_e_nao_inventam_fatos(self):
        entrada = {"evidencias": [{"id": "p1", "descricao": "Página coletada."}]}
        resposta = apresentar({"acao": "melhorar_pagina", "evidencias": ["p1"]}, entrada)
        self.assertEqual(resposta["estado"], "revisao_necessaria")
        self.assertIn("modelos fixos", resposta["aviso"])
        self.assertEqual(resposta["evidencias_citadas"], entrada["evidencias"])

    def test_validade_reavaliada_inclusive_quando_atual_e_falso(self):
        agora = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
        entrada = {"site": "teste.invalid", "evidencias": [
            {"id": "s1", "tipo": "serp", "atual": False, "posicao": 2, "concorrentes": [{"posicao": 1}],
             "observado_em": (agora - timedelta(minutes=3)).isoformat()},
            {"id": "p1", "tipo": "pagina", "atual": True,
             "observado_em": (agora - timedelta(days=2)).isoformat(), "descricao": "Noindex supostamente atual"},
            {"id": "s2", "tipo": "serp", "atual": True, "posicao": 6,
             "observado_em": (agora - timedelta(minutes=10)).isoformat()},
        ]}
        saida = sanear(entrada, agora)
        self.assertIsNone(saida["evidencias"][0]["posicao"])
        self.assertNotIn("concorrentes", saida["evidencias"][0])
        self.assertNotIn("Noindex", saida["evidencias"][1]["descricao"])
        self.assertEqual(saida["evidencias"][2]["posicao"], 6)
        self.assertEqual(entrada["evidencias"][0]["posicao"], 2)

    def test_data_naive_futura_ou_invalida_nao_sao_atuais(self):
        agora = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
        for data in (None, "invalida", "2026-11-14T12:00:00", "2026-11-14T12:01:00Z"):
            entrada = {"site": "teste.invalid", "evidencias": [
                {"id": "s", "tipo": "serp", "atual": True, "posicao": 7, "observado_em": data}]}
            self.assertIsNone(sanear(entrada, agora)["evidencias"][0]["posicao"])

    def test_comparacao_requer_concorrente_anterior_na_mesma_captura(self):
        escolha = {"acao": "comparar_concorrentes", "evidencias": ["s1"]}
        entrada = {"evidencias": [{"id": "s1", "tipo": "serp", "atual": True, "posicao": 9,
                                   "concorrentes": [{"posicao": 11}]}]}
        self.assertTrue(validar_aplicabilidade(escolha, entrada))
        entrada["evidencias"][0]["concorrentes"] = [{"posicao": 3}]
        self.assertFalse(validar_aplicabilidade(escolha, entrada))
        entrada["evidencias"][0]["atual"] = False
        self.assertTrue(validar_aplicabilidade(escolha, entrada))

    def test_melhoria_requer_pagina_atual_e_indexacao_exige_revisao(self):
        entrada = {"evidencias": [{"id": "p1", "tipo": "pagina", "atual": False}]}
        escolha = {"acao": "melhorar_pagina", "evidencias": ["p1"]}
        self.assertTrue(validar_aplicabilidade(escolha, entrada))
        entrada["evidencias"][0]["atual"] = True
        self.assertFalse(validar_aplicabilidade(escolha, entrada))
        self.assertTrue(validar_aplicabilidade({"acao": "corrigir_indexacao", "evidencias": ["p1"]}, entrada))


if __name__ == "__main__":
    unittest.main()
