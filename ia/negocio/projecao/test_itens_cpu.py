"""Contrastes de preservação e falha fechada da projeção, sem MLX/GPU."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from negocio.projecao.itens import projetar_itens_para_revisao


class ProjecaoItensTests(unittest.TestCase):
    def setUp(self):
        self.entrada = {"tarefa": "entender", "campo": "ofertas", "fontes": [
            {"id": "f01", "texto": "Prestamos Manutenção elétrica e Limpeza técnica.", "tipo": "declaracao"},
            {"id": "f02", "texto": "O Plano Luz não é gratuito para empresas.", "tipo": "conteudo"}]}
        self.bom = {"texto": "Manutenção elétrica", "tipo": "servico", "fontes": ["f01"]}
        self.ruim = {"texto": "Oferta inventada", "tipo": "servico", "fontes": ["f01"]}
        self.saida = {"estado": "hipotese", "valor": [self.bom, self.ruim], "fontes": ["f01", "f02"], "faltam": []}

    def rodar(self, saida=None, entrada=None):
        original = self.saida if saida is None else saida
        bruto = json.dumps(original, ensure_ascii=False, separators=(",", ":"))
        return projetar_itens_para_revisao(bruto, self.entrada if entrada is None else entrada)

    def test_remove_item_inteiro_preservando_todos_outros_campos_e_raw(self):
        before = deepcopy(self.saida)
        report = self.rodar()
        self.assertEqual(self.saida, before)
        self.assertTrue(report["projecaoParcial"])
        self.assertFalse(report["originalAceitoPeloContrato"])
        self.assertEqual(report["retidos"][0]["indiceOriginal"], 0)
        self.assertEqual(report["descartados"][0]["indiceOriginal"], 1)
        self.assertIn("ofertas:1:trecho_nao_literal", report["descartados"][0]["errosNoOriginal"])
        esperado = deepcopy(before); esperado["valor"] = [before["valor"][0]]
        self.assertEqual(report["saidaDerivada"], esperado)
        self.assertEqual(report["brutoSha256"], hashlib.sha256(report["brutoOriginal"].encode()).hexdigest())
        self.assertTrue(report["revisaoSemanticaPendente"])
        self.assertFalse(report["novoAcertoDoModelo"])

    def test_todos_falham_nao_fabrica_abstencao(self):
        saida = deepcopy(self.saida); saida["valor"] = [self.ruim]
        report = self.rodar(saida)
        self.assertIsNone(report["saidaDerivada"])
        self.assertEqual(report["original"]["estado"], "hipotese")
        self.assertEqual(report["estado"], "nenhum_item_retido_sem_derivada")

    def test_global_desconhecida_duplicada_ou_interface_bloqueia_tudo(self):
        for fontes in (["f01", "desconhecida"], ["f01", "f01"], ["f01", "f03"]):
            entrada = deepcopy(self.entrada)
            entrada["fontes"].append({"id": "f03", "texto": "Comprar", "tipo": "interface"})
            saida = deepcopy(self.saida); saida["fontes"] = fontes
            report = self.rodar(saida, entrada)
            self.assertIsNone(report["saidaDerivada"])
            self.assertTrue(report["errosEnvelope"])

    def test_excesso_original_nao_e_reduzido_a_limite(self):
        saida = deepcopy(self.saida); saida["valor"] = [self.bom] * 5
        report = self.rodar(saida)
        self.assertEqual(report["errosEnvelope"], ["cardinalidade_original_invalida"])
        self.assertIsNone(report["saidaDerivada"])

    def test_envelope_extra_ou_faltam_duplicado_bloqueia(self):
        for extra in ({"comentario": "fora do contrato"}, {"faltam": ["canal", "canal"]}):
            saida = deepcopy(self.saida); saida.update(extra)
            self.assertIsNone(self.rodar(saida)["saidaDerivada"])

    def test_json_truncado_markdown_duplicatas_e_nao_texto_nao_sao_reparados(self):
        raws = [None, '{"estado":', '```json\n{}\n```', '{"estado":"hipotese","estado":"insuficiente"}', 'NaN']
        for raw in raws:
            report = projetar_itens_para_revisao(raw, self.entrada)
            self.assertIsNone(report["saidaDerivada"])
            self.assertEqual(report["brutoOriginal"], raw)

    def test_item_com_referencia_ausente_global_e_descartado_sem_editar_refs(self):
        saida = deepcopy(self.saida)
        saida["fontes"] = ["f01"]
        saida["valor"][1] = {"texto": "Plano Luz", "tipo": "servico", "fontes": ["f02"]}
        report = self.rodar(saida)
        self.assertEqual(report["saidaDerivada"]["fontes"], ["f01"])
        self.assertEqual(len(report["descartados"]), 1)

    def test_lista_valida_nao_vira_novo_acerto(self):
        saida = deepcopy(self.saida); saida["valor"] = [self.bom]
        report = self.rodar(saida)
        self.assertEqual(report["estado"], "original_valido_sem_recuperacao")
        self.assertFalse(report["projecaoParcial"])
        self.assertFalse(report["novoAcertoDoModelo"])

    def test_sem_mudanca_de_escopo_tipo_texto_ou_ordem_das_refs(self):
        entrada = deepcopy(self.entrada); entrada["campo"] = "condicoes"
        saida = {"estado": "hipotese", "valor": [
            {"texto": "não é gratuito", "escopo": "Plano Luz", "fontes": ["f02", "f01"]},
            {"texto": "totalmente gratuito", "escopo": "Plano Luz", "fontes": ["f02"]}],
                 "fontes": ["f02", "f01"], "faltam": ["canal"]}
        report = self.rodar(saida, entrada)
        self.assertEqual(report["saidaDerivada"]["valor"], [saida["valor"][0]])
        self.assertEqual(report["saidaDerivada"]["fontes"], ["f02", "f01"])
        self.assertEqual(report["saidaDerivada"]["faltam"], ["canal"])

    def test_semantica_ainda_pode_errar_negacao_mesmo_com_span_valido(self):
        entrada = deepcopy(self.entrada); entrada["campo"] = "condicoes"
        saida = {"estado": "hipotese", "valor": [{"texto": "é gratuito", "escopo": "Plano Luz", "fontes": ["f02"]}], "fontes": ["f02"], "faltam": []}
        report = self.rodar(saida, entrada)
        self.assertIsNotNone(report["saidaDerivada"])
        self.assertTrue(report["revisaoSemanticaPendente"])
        self.assertFalse(report["novoAcertoDoModelo"])

    def test_categorias_planos_estado_insuficiente_e_lista_vazia_nao_sao_projetados(self):
        entradas = [dict(self.entrada, campo="papel"), {"tarefa": "recomendar", "perfil": {}, "fontes": self.entrada["fontes"]}]
        for e in entradas:
            self.assertIsNone(self.rodar(entrada=e)["saidaDerivada"])
        for saida in ({"estado": "insuficiente", "valor": [], "fontes": [], "faltam": ["ofertas"]},
                      {"estado": "hipotese", "valor": [], "fontes": ["f01"], "faltam": []}):
            self.assertIsNone(self.rodar(saida)["saidaDerivada"])

    def test_abstencao_original_valida_e_preservada_sem_projecao_nova(self):
        saida = {"estado": "insuficiente", "valor": [], "fontes": [], "faltam": ["ofertas"]}
        report = self.rodar(saida)
        self.assertTrue(report["originalAceitoPeloContrato"])
        self.assertEqual(report["original"], saida)
        self.assertEqual(report["estado"], "original_valido_sem_itens_sem_projecao")
        self.assertIsNone(report["saidaDerivada"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
