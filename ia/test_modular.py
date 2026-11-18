import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'modular'))
from avaliar_local import pontuar, avaliar


class MetricasModulares(unittest.TestCase):
    def setUp(self):
        self.entrada = {'evidencias': [{'id': 'p1'}, {'id': 's1'}]}
        self.caso = {'alvos': [{'acao': 'validar_demanda', 'evidencias': ['p1']}],
                     'alvosUtilidade': [{'acao': 'validar_demanda', 'evidencias': ['p1']}]}

    def test_referencia_extra_valida_preserva_exatidao_e_suporte_separados(self):
        r = pontuar({'acao': 'validar_demanda', 'evidencias': ['p1', 's1']}, self.caso, self.entrada)
        self.assertFalse(r['acao_referencias_adequadas'])
        self.assertTrue(r['acao_suportada_entregue'])
        self.assertTrue(r['acao_util_entregue'])

    def test_referencia_principal_faltante_nao_recebe_credito(self):
        r = pontuar({'acao': 'validar_demanda', 'evidencias': ['s1']}, self.caso, self.entrada)
        self.assertTrue(r['acao_adequada'])
        self.assertFalse(r['acao_suportada_entregue'])

    def test_referencia_inexistente_nao_recebe_credito(self):
        r = pontuar({'acao': 'validar_demanda', 'evidencias': ['p1', 'x1']}, self.caso, self.entrada)
        self.assertFalse(r['contrato_valido'])
        self.assertFalse(r['acao_com_referencias_suficientes'])

    def test_recusa_preserva_acerto_cru_sem_contar_entrega(self):
        r = pontuar(self.caso['alvos'][0], self.caso, self.entrada, entregue=False)
        self.assertTrue(r['acao_com_referencias_suficientes'])
        self.assertFalse(r['acao_suportada_entregue'])

    def test_utilidade_pode_ser_mais_estrita_que_suporte(self):
        caso = {**self.caso, 'alvosUtilidade': []}
        r = pontuar(caso['alvos'][0], caso, self.entrada)
        self.assertTrue(r['acao_suportada_entregue'])
        self.assertFalse(r['acao_util_entregue'])

    def test_divisao_errada_interrompe_antes_de_carregar_modelo(self):
        with self.assertRaisesRegex(ValueError, 'não contém casos'):
            avaliar({'relogioReferencia':'2026-11-15T19:00:00Z',
                     'casos':[{'split':'holdout_auxiliar'}]}, ['selecionado'], ['holdout'])


if __name__ == '__main__':
    unittest.main()
