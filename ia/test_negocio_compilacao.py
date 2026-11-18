"""A projeção econômica do decoder nunca reduz a validação posterior."""

from copy import deepcopy
import unittest

from negocio.contrato import validar_saida
from negocio.decodificacao.core_mlx import esquema_para_compilacao
from negocio.esquema import esquema_para


class ProjecaoCompilacaoTest(unittest.TestCase):
    def setUp(self):
        self.entrada={"tarefa":"entender","campo":"ofertas","fontes":[
            {"id":"f01","texto":"A"*121,"tipo":"declaracao"}]}

    def test_remove_apenas_maxlength_das_strings_sem_mutar_esquema(self):
        esquema=esquema_para(self.entrada)
        original=deepcopy(esquema)
        projetado=esquema_para_compilacao(esquema,limitar_comprimento_texto=False)
        item=projetado["anyOf"][0]["properties"]["valor"]["items"]
        self.assertEqual(item["properties"]["texto"],{"type":"string","minLength":1})
        self.assertEqual(projetado["anyOf"][0]["properties"]["valor"]["maxItems"],4)
        self.assertEqual(item["properties"]["fontes"]["items"]["enum"],["f01"])
        self.assertFalse(item["additionalProperties"])
        self.assertEqual(esquema,original)
        self.assertEqual(esquema_para_compilacao(esquema),original)

    def test_trecho_longo_continua_recusado_pelo_contrato(self):
        saida={"estado":"hipotese","valor":[{"texto":"A"*121,"tipo":"produto","fontes":["f01"]}],
               "fontes":["f01"],"faltam":[]}
        erros=validar_saida(saida,self.entrada)
        self.assertTrue(erros,erros)
        self.assertEqual(saida["valor"][0]["texto"],"A"*121)


if __name__=="__main__":unittest.main()
