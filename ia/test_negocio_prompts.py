import unittest
from negocio.contrato import CAMPOS,mensagens,validar_saida
from negocio.prompts import exemplo,mensagens_para


class PromptsNegocioTests(unittest.TestCase):
    def test_v3_continua_literalmente_igual_ao_historico(self):
        for campo in CAMPOS:
            e={"tarefa":"entender","campo":campo,"fontes":[]}
            self.assertEqual(mensagens_para(e,versao="v3"),mensagens(e))

    def test_exemplos_v4_tem_fontes_proprias_e_contrato_valido(self):
        for campo in (*CAMPOS,"recomendar"):
            atual={"tarefa":"entender","campo":campo,"fontes":[]} if campo!="recomendar" else {"tarefa":"recomendar","perfil":{},"fontes":[]}
            e,s=exemplo(atual)
            self.assertFalse(validar_saida(s,e))
            self.assertTrue(all(f["id"].startswith("ex") for f in e["fontes"]))
            ms=mensagens_para(atual,versao="v4")
            self.assertEqual(len(ms),4)
            self.assertEqual(ms[-1]["role"],"user")
            self.assertNotIn('"ex01"',ms[-1]["content"])

    def test_schema_e_dados_atuais_nao_sao_substituidos_pelo_exemplo(self):
        atual={"tarefa":"entender","campo":"ofertas","fontes":[{"id":"f01","texto":"Fabricamos Móveis.","tipo":"declaracao"}]}
        ms=mensagens_para(atual,versao="v4")
        self.assertIn("Móveis",ms[-1]["content"])
        self.assertNotIn("Manutenção elétrica",ms[-1]["content"])

    def test_v5_nao_fornece_empresa_demonstrativa_ao_modelo(self):
        atual={"tarefa":"entender","campo":"finalidade","fontes":[{"id":"f01","texto":"Vendemos cursos.","tipo":"declaracao"}]}
        ms=mensagens_para(atual,versao="v5")
        self.assertEqual([m["role"] for m in ms],["system","user"])
        self.assertNotIn('"ex01"',str(ms))


if __name__=="__main__":unittest.main()
