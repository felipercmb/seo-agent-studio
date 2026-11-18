import copy
import json
import unittest
from negocio.esquema import esquema_para
from negocio.contrato import CAMPOS


class EsquemaNegocioTests(unittest.TestCase):
    def entrada(self,campo="ofertas"):
        return {"tarefa":"entender","campo":campo,"fontes":[{"id":"f01","texto":"Vendemos móveis.","tipo":"declaracao"},
            {"id":"f02","texto":"Comprar","tipo":"interface"}]}
    def test_esquema_so_depende_da_entrada_e_exclui_interface_como_prova(self):
        e=self.entrada();antes=copy.deepcopy(e);s=esquema_para(e)
        h=s["anyOf"][0]
        self.assertEqual(h["properties"]["fontes"]["items"]["enum"],["f01"])
        self.assertEqual(h["properties"]["valor"]["items"]["properties"]["fontes"]["items"]["enum"],["f01"])
        self.assertEqual(e,antes)
    def test_sem_fontes_nao_forca_hipotese(self):
        for campo in CAMPOS:
            s=esquema_para({"tarefa":"entender","campo":campo,"fontes":[]})
            self.assertEqual(s["properties"]["estado"]["const"],"insuficiente")
    def test_chaves_enums_e_limites_sao_exportaveis_como_json(self):
        for campo in CAMPOS:
            s=esquema_para(self.entrada(campo));json.dumps(s,allow_nan=False)
            for ramo in s["anyOf"]:
                self.assertFalse(ramo["additionalProperties"])
                self.assertEqual(set(ramo["required"]),{"estado","valor","fontes","faltam"})
    def test_recomendacao_exige_criterio_e_nao_usa_interface_como_criterio(self):
        e={"tarefa":"recomendar","perfil":{},"fontes":self.entrada()["fontes"]}
        s=esquema_para(e)["anyOf"][0]
        self.assertEqual(s["properties"]["criterios"]["minItems"],1)
        self.assertEqual(s["properties"]["criterios"]["items"]["properties"]["fontes"]["items"]["enum"],["f01"])


if __name__=="__main__":unittest.main()
