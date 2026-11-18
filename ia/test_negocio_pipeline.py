import unittest
from negocio.pipeline import montar_planejamento,remapear_referencias


class PipelineNegocioTests(unittest.TestCase):
    def fonte(self,id="origem_a",texto="Prestamos Limpeza para empresas."):
        return {"id":id,"texto":texto,"tipo":"declaracao"}

    def leitura(self,fonte,saida,campo="ofertas"):
        return {campo:{"entrada":{"tarefa":"entender","campo":campo,"fontes":[fonte]},"geracao":{"saida":saida}}}

    def test_saida_sem_citacao_valida_nao_alimenta_planejamento(self):
        f=self.fonte()
        leituras=self.leitura(f,{"estado":"hipotese","valor":[{"texto":"Consultoria","tipo":"servico","fontes":[f["id"]]}],"fontes":[f["id"]],"faltam":[]})
        r=montar_planejamento(leituras,[f],[f])
        self.assertEqual(r["entrada"]["perfil"]["ofertas"],[])
        self.assertTrue(any(p["motivo"]=="saida_recusada" for p in r["perdas"]))

    def test_id_igual_de_outra_captura_e_rejeitado(self):
        f=self.fonte();outro=self.fonte(texto="Vendemos automóveis.")
        s={"estado":"insuficiente","valor":[],"fontes":[],"faltam":["ofertas"]}
        with self.assertRaisesRegex(ValueError,"captura"):
            montar_planejamento(self.leitura(f,s),[],[outro])

    def test_hipotese_citada_permanece_rascunho(self):
        f=self.fonte();s={"estado":"hipotese","valor":[{"texto":"Limpeza","tipo":"servico","fontes":[f["id"]]}],"fontes":[f["id"]],"faltam":[]}
        r=montar_planejamento(self.leitura(f,s),[f],[f])
        self.assertEqual(r["entrada"]["perfil"]["ofertas"],s["valor"])
        self.assertFalse(r["perfilConfirmado"])
        self.assertTrue(r["revisaoSemanticaPendente"])

    def test_fonte_fora_do_orcamento_nao_vira_perfil_sem_evidencia(self):
        f=self.fonte(texto="Prestamos Limpeza para empresas. "+"x"*300)
        s={"estado":"hipotese","valor":[{"texto":"Limpeza","tipo":"servico","fontes":[f["id"]]}],"fontes":[f["id"]],"faltam":[]}
        r=montar_planejamento(self.leitura(f,s),[],[f],max_caracteres=128)
        self.assertEqual(r["entrada"]["perfil"]["ofertas"],[])
        self.assertTrue(any(p["motivo"]=="referencias_fora_do_orcamento" for p in r["perdas"]))

    def test_remapeamento_nao_confunde_texto_com_referencia(self):
        s={"texto":"f01","fontes":["f01"],"valor":[{"fontes":["f02"]}]}
        self.assertEqual(remapear_referencias(s,{"f01":"origem1","f02":"origem2"}),
            {"texto":"f01","fontes":["origem1"],"valor":[{"fontes":["origem2"]}]})

    def test_contexto_que_nao_cabe_fica_registrado(self):
        f=self.fonte();outro=self.fonte(id="origem_b",texto="A contratação exige endereço comercial.")
        s={"estado":"hipotese","valor":"servicos","fontes":[f["id"]],"faltam":[]}
        r=montar_planejamento(self.leitura(f,s,campo="papel"),[outro],[f,outro],max_fontes=1)
        self.assertTrue(any(p.get("fonteId")=="origem_b" and p["motivo"]=="contexto_fora_do_orcamento" for p in r["perdas"]))

    def test_metadado_divergente_no_contexto_e_recusado(self):
        f={**self.fonte(),"url":"https://origem.example/"}
        with self.assertRaisesRegex(ValueError,"captura"):
            montar_planejamento({},[{**f,"url":"https://outro.example/"}],[f])


if __name__=="__main__":unittest.main()
