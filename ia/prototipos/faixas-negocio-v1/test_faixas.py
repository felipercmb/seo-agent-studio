import unittest
from validacao_faixas import Faixa,conferir_faixa
class FaixasTests(unittest.TestCase):
 def test_mesma_faixa(self):
  self.assertTrue(conferir_faixa(Faixa("itens",81,200),Faixa("itens",81,200))["compativel"])
 def test_teto_removido_mostra_201(self):
  r=conferir_faixa(Faixa("itens",81,200),Faixa("itens",81,None))
  self.assertEqual(r["contraexemplos"],[201]);self.assertFalse(r["compativel"])
 def test_piso_ampliado(self):
  self.assertEqual(conferir_faixa(Faixa("idade",14,None),Faixa("idade",13,None))["contraexemplos"],[13])
 def test_subfaixa_valida(self):
  self.assertTrue(conferir_faixa(Faixa("itens",81,200),Faixa("itens",100,180))["compativel"])
 def test_unidades_nao_sao_intercambiaveis(self):
  self.assertEqual(conferir_faixa(Faixa("itens_cadastrados",81,200),Faixa("vendas",81,200))["erros"],["unidade_diferente"])
 def test_rejeita_booleanos_e_faixa_invertida(self):
  for a,b in [(True,200),(201,200)]:
   with self.assertRaises(ValueError):Faixa("itens",a,b)
 def test_fronteiras_publicadas(self):
  f=Faixa("itens",81,200)
  self.assertEqual([f.contem(x) for x in [80,81,200,201]],[False,True,True,False])
