"""Testes locais da terceira rodada e de seu isolamento temporal."""

import json
from pathlib import Path
import sys
import unittest

PASTA = Path(__file__).parent / "v3"
sys.path.insert(0, str(PASTA))
from contrato_v3 import validar_escolha, apresentar
from v3.gerar_dados import criar, arquivos
from avaliar_v3 import pontuar
from inferir_v3 import bloqueios, preservar_estado_fonte, orientar_disponibilidade
from runtime import sha256


class RodadaTresTest(unittest.TestCase):
    def test_splits_congelados_e_casos_v2_promovidos_somente_a_treino(self):
        casos = criar()
        saidas = arquivos(casos)
        for nome, conteudo in saidas.items():
            self.assertEqual((PASTA / "dados" / nome).read_bytes(), conteudo, nome)
        for caso in casos:
            if caso["origem"] in ("v2_ja_observado", "v2_estresse_ja_observado"):
                self.assertEqual(caso["split"], "train")
            self.assertEqual(validar_escolha(caso["esperado"], caso["entrada"]), [])
        self.assertEqual(json.loads(saidas["manifest.json"])["contagens"], {"train": 590, "valid": 20, "test": 30})
        self.assertNotEqual(sha256(PASTA / "dados/casos-test.jsonl"), sha256(PASTA.parent / "v2/dados/casos-test.jsonl"))

    def test_classifica_como_grave_corrigir_exclusao_proposital_ou_nao_confirmada(self):
        for alvo in ("preservar_exclusao", "confirmar_publicacao"):
            caso = {"entrada": {"evidencias": [{"id": "p1"}]}, "esperado": {"acao": alvo, "evidencias": ["p1"]}}
            criterios, _ = pontuar({"acao": "corrigir_indexacao", "evidencias": ["p1"]}, caso)
            self.assertTrue(criterios["falha_grave"])
        caso = {"entrada": {"evidencias": [{"id": "p1"}]}, "esperado": {"acao": "confirmar_publicacao", "evidencias": ["p1"]}}
        criterios, _ = pontuar({"acao": "preservar_exclusao", "evidencias": ["p1"]}, caso)
        self.assertTrue(criterios["falha_grave"])

    def test_novas_acoes_precisam_de_referencia_e_informacao_atual(self):
        entrada = {"evidencias": [{"id": "p1", "tipo": "pagina", "atual": False}]}
        for acao in ("preservar_exclusao", "confirmar_publicacao"):
            self.assertIn("acao_sem_evidencia", validar_escolha({"acao": acao, "evidencias": []}, entrada))
            escolha = {"acao": acao, "evidencias": ["p1"]}
            self.assertTrue(bloqueios(escolha, entrada))
            entrada["evidencias"][0]["atual"] = True
            if acao == "preservar_exclusao":
                self.assertTrue(bloqueios(escolha, entrada))
            else:
                self.assertTrue(bloqueios(escolha, entrada))
                entrada["evidencias"][0].update(sha256_pagina="a"*64,
                    verificacao={"tipo":"meta_robots_noindex","escopo":"html_inicial","intencao":"desconhecida"})
                self.assertFalse(bloqueios(escolha, entrada))
            self.assertEqual(apresentar(escolha, entrada)["estado"], "revisao_necessaria")
            entrada["evidencias"][0]["atual"] = False

    def test_diretiva_confirmada_nao_vira_validacao_de_demanda(self):
        entrada = {"objetivo":"Verificar diretiva de indexação", "evidencias":[
            {"id":"p1", "tipo":"pagina", "atual":True, "sha256_pagina":"a"*64,
             "verificacao":{"tipo":"meta_robots_noindex", "escopo":"html_inicial", "intencao":"desconhecida"}}]}
        self.assertTrue(bloqueios({"acao":"validar_demanda", "evidencias":["p1"]}, entrada))

    def test_conversao_nao_cita_serp_como_fonte_comercial(self):
        entrada = {"objetivo":"Qual o retorno?", "evidencias":[
            {"id":"s1","tipo":"serp","atual":True}, {"id":"n1","tipo":"negocio"}]}
        self.assertTrue(bloqueios({"acao":"medir_conversao","evidencias":["s1"]}, entrada))
        self.assertFalse(bloqueios({"acao":"medir_conversao","evidencias":["n1"]}, entrada))

    def test_fonte_nao_configurada_nao_vira_repeticao_cega(self):
        original = {"evidencias":[{"id":"s1","tipo":"serp","atual":False,"estado_fonte":"nao_configurada","posicao":None}]}
        limpa = {"evidencias":[{"id":"s1","tipo":"serp","atual":False,"posicao":None}]}
        preservar_estado_fonte(original,limpa)
        self.assertEqual(limpa['evidencias'][0]['estado_fonte'],'nao_configurada')
        saida = {"estado":"revisao_necessaria","escolha_ia":{"acao":"atualizar_coleta"}}
        orientar_disponibilidade(saida,limpa)
        self.assertIn('Configure uma fonte',saida['orientacao_padrao'])
        self.assertIsNone(limpa['evidencias'][0]['posicao'])

    def test_intencao_sem_consulta_e_pagina_atual_fica_bloqueada(self):
        entrada = {"evidencias": [{"id": "p1", "tipo": "pagina", "atual": True},
                                   {"id": "s1", "tipo": "serp", "atual": True}]}
        self.assertTrue(bloqueios({"acao": "validar_intencao", "evidencias": ["p1"]}, entrada))
        self.assertFalse(bloqueios({"acao": "validar_intencao", "evidencias": ["p1", "s1"]}, entrada))

    def test_estresse_e_independente_do_teste_antigo(self):
        self.assertNotEqual(sha256(PASTA / "casos_estresse.jsonl"), sha256(PASTA.parent / "v2/casos_estresse.jsonl"))
        self.assertEqual(len((PASTA / "casos_estresse.jsonl").read_text(encoding="utf-8").splitlines()), 16)


if __name__ == "__main__":
    unittest.main()
