import unittest
from negocio.protocolo import prefixo_assistente,MARCADOR,VAZIO


class TemplateSimulado:
    def __init__(self,acrescimo):self.acrescimo=acrescimo
    def apply_chat_template(self,ms,*,tokenize,add_generation_prompt=False):
        return "historico-assistente:" if add_generation_prompt else "historico-assistente:"+self.acrescimo+ms[-1]["content"]+"fim"


class ProtocoloNegocioTests(unittest.TestCase):
    def test_alinha_cabecalho_vazio_sem_posprocessar_resposta(self):
        r=prefixo_assistente(TemplateSimulado(VAZIO),[])
        self.assertEqual(r["prompt"],"historico-assistente:"+VAZIO)
        self.assertTrue(r["respostaGeradaNaoFoiEditada"])
    def test_template_sem_cabecalho_continua_igual(self):
        r=prefixo_assistente(TemplateSimulado(""),[])
        self.assertFalse(r["alinhado"])
        self.assertEqual(r["prompt"],"historico-assistente:")
    def test_nao_insere_instrucoes_ou_raciocinio_arbitrario(self):
        with self.assertRaisesRegex(ValueError,"não é o cabeçalho vazio"):
            prefixo_assistente(TemplateSimulado("invente receita"),[])


if __name__=="__main__":unittest.main()
