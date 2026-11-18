import unittest
from negocio.fusao import fundir_lista


class FusaoNegocioTests(unittest.TestCase):
    def fonte(self,id,texto):return {"id":id,"texto":texto,"tipo":"declaracao"}
    def leitura(self,f,funcao="cliente"):
        s={"estado":"hipotese","valor":[{"texto":"profissionais","funcao":funcao,"escopo":None,"fontes":[f["id"]]}],"fontes":[f["id"]],"faltam":[]}
        return {"entrada":{"tarefa":"entender","campo":"publicos","fontes":[f]},"geracao":{"saida":s}}
    def test_conflito_de_papel_entre_passadas_nao_vira_fato_aceito(self):
        f=self.fonte("origem1","Atendemos profissionais.")
        r=fundir_lista("publicos",[self.leitura(f),self.leitura(f,"prestador")],[f])
        self.assertEqual(r["saida"]["estado"],"insuficiente")
        self.assertEqual(r["perdas"][0]["motivo"],"classificacoes_conflitantes_entre_passadas")
    def test_duplicata_nao_inflaciona_publicos_ou_amostras(self):
        f=self.fonte("origem1","Atendemos profissionais.");g=self.fonte("origem2","Serviços para profissionais.")
        r=fundir_lista("publicos",[self.leitura(f),self.leitura(g)],[f,g])
        self.assertEqual(len(r["saida"]["valor"]),1)
        self.assertEqual(r["saida"]["valor"][0]["fontes"],["origem1","origem2"])
    def test_saida_inventada_nao_e_recuperada_pela_fusao(self):
        f=self.fonte("origem1","Atendemos empresas.")
        r=fundir_lista("publicos",[self.leitura(f)],[f])
        self.assertIsNone(r["saida"])
        self.assertEqual(r["passadasValidas"],0)
    def test_mesmo_id_outra_captura_e_rejeitado(self):
        f=self.fonte("origem1","Atendemos profissionais.");g=self.fonte("origem1","Prestamos serviços jurídicos.")
        with self.assertRaisesRegex(ValueError,"captura"):
            fundir_lista("publicos",[self.leitura(f)],[g])


if __name__=="__main__":unittest.main()
