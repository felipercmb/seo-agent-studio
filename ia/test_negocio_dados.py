import unittest
from negocio.preparar import particionar,expandir_corpus


class ParticaoNegocioTests(unittest.TestCase):
    def test_campos_e_plano_da_mesma_empresa_nao_vazam_entre_splits(self):
        casos=[]
        for i in range(10):
            for campo in ("papel","recomendar"):
                casos.append({"id":str(i)+campo,"grupoEmpresarial":"real-"+str(i),"split":"desenvolvimento",
                              "natureza":"captura_real_historica","entrada":{"fontes":[{"id":"f1","tipo":"declaracao","texto":"Negócio explicitado"}]}})
        for i in range(10):
            casos.append({"id":"c"+str(i),"grupoEmpresarial":"controle-"+str(i),"split":"desenvolvimento",
                          "natureza":"documento_simulado","entrada":{"fontes":[]}})
        p=particionar(casos)
        self.assertEqual(sum(v=="validation" and k.startswith("real-") for k,v in p.items()),2)
        for g in p:self.assertEqual(len({c["split"] for c in casos if c["grupoEmpresarial"]==g}),1)

    def test_test_selado_nunca_entra_no_preparador_de_treino(self):
        with self.assertRaises(ValueError):
            particionar([{"id":"segredo","grupoEmpresarial":"grupo","split":"holdout","entrada":{"fontes":[]}}])

    def test_controle_sem_dominio_nao_vira_empresa_real(self):
        corpus={"casos":[{"id":"controle","dominio":None,"grupoEmpresarial":"familia","split":"train",
            "tipoCaso":"controle_simulado","fontes":[],"perfilOracle":{},"planejamentoEsperado":{
                "estado":"insuficiente","decisao":"","alternativas":[],"criterios":[],"acao":"","verificar":"",
                "fontes":[],"incertezas":["Sem conteúdo."],"hipotese":True}}]}
        c=expandir_corpus(corpus,{"recomendar"})
        self.assertEqual(c[0]["natureza"],"documento_simulado")

    def test_ampliar_corpus_preserva_grupos_congelados(self):
        casos=[{"id":str(i),"grupoEmpresarial":"real-"+str(i),"split":"desenvolvimento",
                "natureza":"captura_real_historica","entrada":{"fontes":[{"tipo":"declaracao"}]}} for i in range(10)]
        fixos={"real-0":"train","real-1":"validation","real-2":"train"}
        mapa=particionar(casos,mapa_grupos=fixos)
        self.assertTrue(all(mapa[k]==v for k,v in fixos.items()))

    def test_mapa_congelado_nao_aceita_split_explicito_trocado(self):
        with self.assertRaises(ValueError):
            particionar([{"id":"a","grupoEmpresarial":"a","split":"validation","entrada":{"fontes":[]}}],mapa_grupos={"a":"train"})


if __name__=="__main__":unittest.main()
