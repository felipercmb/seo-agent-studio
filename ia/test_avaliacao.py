"""Protege o comparador e o limite entre dado observado e prosa gerada."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import unittest
from avaliar import pontuar
from comparar import comparar
from inferir import preparar_entrada


class AvaliacaoTest(unittest.TestCase):
    def setUp(self):
        self.entrada = {"site": "exemplo.invalid", "evidencias": [{"id": "p1", "tipo": "pagina"}]}
        self.saida = {"acao": "validar_demanda", "prioridade": "investigar", "evidencias": ["p1"],
                      "justificativa": "Só há uma hipótese de procura.", "proximo_passo": "Investigar demanda.",
                      "limite": "Sem demanda e conversões não há estimativa de retorno."}
        self.esperado = {"acoes_aceitas": ["validar_demanda"], "prioridades_aceitas": ["investigar"],
                         "evidencias_obrigatorias": ["p1"], "deve_abster_receita": True}

    def score(self, saida):
        return pontuar(json.dumps(saida, ensure_ascii=False), self.entrada, self.esperado)

    def test_referencia_inventada_reprova_mesmo_com_acao_certa(self):
        self.assertTrue(self.score(self.saida)["criterios"]["todos_criterios_mecanicos"])
        self.saida["evidencias"] = ["p2"]
        score = self.score(self.saida)
        self.assertFalse(score["criterios"]["referencias_esperadas"])
        self.assertFalse(score["criterios"]["todos_criterios_mecanicos"])

    def test_promessa_numerica_e_json_quebrado_nao_passam(self):
        self.saida["limite"] = "Garantia de 100 vendas."
        self.assertFalse(self.score(self.saida)["criterios"]["contrato_valido"])
        self.assertFalse(pontuar("{", self.entrada, self.esperado)["criterios"]["todos_criterios_mecanicos"])

    def test_tipo_nao_previsto_nao_causa_excecao(self):
        self.saida["evidencias"] = [{}]
        self.assertFalse(self.score(self.saida)["criterios"]["referencias_esperadas"])
        self.assertFalse(pontuar("[]", self.entrada, self.esperado)["criterios"]["json_objeto"])

    def test_comparacao_recusa_teste_diferente_e_nunca_promove(self):
        base = {"tipo": "base", "split": "test", "modelo": "modelo", "revisao": "sha", "versoes": {},
                "casos_sha256": "casos", "prompt_sha256": "prompt", "avaliador_sha256": "avaliador",
                "decodificador": {"temperatura": 0}, "resultados": [{"id": "caso"}],
                "metricas": {"contrato_valido": {"aprovados": 1, "total": 1}}, "limites": []}
        treinado = {**deepcopy(base), "tipo": "adaptador", "adaptador_sha256": "adapter"}
        self.assertFalse(comparar(base, treinado)["promovido_para_recomendacoes_automaticas"])
        treinado["casos_sha256"] = "outros"
        with self.assertRaises(ValueError):
            comparar(base, treinado)

    def test_rank_exportado_envelhece_antes_de_inferir(self):
        agora = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
        entrada = {"site": "exemplo.invalid", "evidencias": [{"id": "s1", "tipo": "serp", "atual": True,
                   "posicao": 7, "observado_em": (agora - timedelta(hours=2)).isoformat(),
                   "concorrentes": [{"posicao": 1}]}]}
        limpa = preparar_entrada(entrada, agora)
        self.assertIsNone(limpa["evidencias"][0]["posicao"])
        self.assertFalse(limpa["evidencias"][0]["atual"])
        self.assertNotIn("concorrentes", limpa["evidencias"][0])
        self.assertEqual(entrada["evidencias"][0]["posicao"], 7)

    def test_evidencia_sem_data_nao_conserva_posicao(self):
        entrada = {"site": "exemplo.invalid", "evidencias": [{"id": "s1", "tipo": "serp", "atual": True, "posicao": 2}]}
        self.assertIsNone(preparar_entrada(entrada)["evidencias"][0]["posicao"])
        entrada["evidencias"].append({"id": "s1"})
        with self.assertRaises(ValueError):
            preparar_entrada(entrada)


if __name__ == "__main__":
    unittest.main()
