import unittest

from negocio.qualidade import verificar_qualidade


class QualidadeNegocioTests(unittest.TestCase):
    def entrada(self,texto="A câmera exige instalação profissional."):
        return {"tarefa":"recomendar","fontes":[{"id":"f01","texto":texto,"tipo":"conteudo"}]}

    def test_placeholder_observado_e_recusado_sem_editar_resposta(self):
        s={"decisao":"  decisão a conferir  ","acao":"ação específica"}
        self.assertIn("decisao_placeholder_do_protocolo",verificar_qualidade(s,self.entrada(),versao_prompt="v3")["erros"])
        self.assertEqual(s["decisao"],"  decisão a conferir  ")

    def test_decisao_concreta_ainda_nao_e_aprovacao_semantica(self):
        q=verificar_qualidade({"decisao":"Comparar inclusão de instalação."},self.entrada(),versao_prompt="v3")
        self.assertEqual(q["erros"],[])
        self.assertTrue(q["revisaoSemanticaPendente"])

    def test_kit_ficticio_no_teste_livre_tambem_e_identificado(self):
        q=verificar_qualidade({"decisao":"Comparar instalação.","verificar":"Encaminhar residência ao Kit Base."},self.entrada(),versao_prompt="v4")
        self.assertEqual(q["erros"],["exemplo_ficticio_ausente_das_fontes:Kit Base"])

    def test_kit_publicado_nas_fontes_nao_e_confundido_com_contaminacao(self):
        q=verificar_qualidade({"decisao":"Comparar Kit Base e Kit Completo."},self.entrada("O Kit Base dispensa instalação. O Kit Completo inclui instalação."),versao_prompt="v4")
        self.assertEqual(q["erros"],[])

    def test_leitura_e_sem_json_nao_viram_aprovacao(self):
        self.assertEqual(verificar_qualidade({}, {"tarefa":"entender"},versao_prompt="v3")["erros"],[])
        self.assertTrue(verificar_qualidade(None,self.entrada(),versao_prompt="v3")["erros"])


if __name__=="__main__":unittest.main()
