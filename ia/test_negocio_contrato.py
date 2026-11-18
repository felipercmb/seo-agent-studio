import json
from copy import deepcopy
import unittest

from negocio.contrato import (validar_entrada, validar_saida, mensagens,
                              compactar_ids, ler_json_estrito)


class ContratoNegocioTests(unittest.TestCase):
    def setUp(self):
        self.entrada = {"tarefa": "entender", "campo": "publicos", "fontes": [
            {"id": "real-caso-longo-F01", "texto": "Conectamos artistas a contratantes. Indisponível para menores.", "tipo": "declaracao"},
            {"id": "real-caso-longo-F02", "texto": "Peça um orçamento", "tipo": "interface"}]}
        self.saida = {"estado": "hipotese", "valor": [
            {"texto": "artistas", "funcao": "prestador", "escopo": None, "fontes": ["real-caso-longo-F01"]},
            {"texto": "contratantes", "funcao": "cliente", "escopo": None, "fontes": ["real-caso-longo-F01"]},
            {"texto": "menores", "funcao": "excluido", "escopo": None, "fontes": ["real-caso-longo-F01"]}],
            "fontes": ["real-caso-longo-F01"], "faltam": []}

    def test_atores_e_exclusao_podem_ter_fontes_literais_sem_aprovacao_semantica(self):
        self.assertEqual(validar_saida(self.saida, self.entrada), [])
        s = deepcopy(self.saida)
        s["valor"][2]["funcao"] = "cliente"
        # This validator does not mistake literal existence for semantic truth.
        self.assertEqual(validar_saida(s, self.entrada), [])

    def test_fonte_inexistente_ou_interface_nao_pode_sustentar_ator(self):
        for refs in (["inexistente"], ["real-caso-longo-F02"]):
            s = deepcopy(self.saida); s["valor"][0]["fontes"] = refs
            self.assertTrue(validar_saida(s, self.entrada))

    def test_span_inventado_ou_ref_global_omitida_recusados(self):
        for texto in ("compradores", "prestadores de renome", ""):
            s = deepcopy(self.saida);s["valor"][0]["texto"] = texto
            self.assertTrue(validar_saida(s, self.entrada))
        s = deepcopy(self.saida);s["fontes"] = []
        self.assertTrue(validar_saida(s, self.entrada))

    def test_json_invalido_duplicado_e_constantes_nao_sao_aceitos(self):
        for texto in ('{"estado":"hipotese","estado":"insuficiente"}', '{"x":NaN}', '```json\n{}\n```', '{} lixo'):
            with self.assertRaises(ValueError):
                ler_json_estrito(texto)

    def test_ids_compactados_preservam_mapa_sem_mutacao(self):
        original = deepcopy(self.entrada)
        e,s,m = compactar_ids(self.entrada,self.saida)
        self.assertEqual(e["fontes"][0]["id"], "f01")
        self.assertEqual(s["valor"][0]["fontes"], ["f01"])
        self.assertEqual(m["f01"], "real-caso-longo-F01")
        self.assertEqual(self.entrada,original)
        self.assertEqual(validar_saida(s,e), [])

    def test_mensagens_tem_somente_entrada_e_alvo_validado(self):
        m=mensagens(self.entrada,self.saida)
        self.assertEqual([x["role"] for x in m], ["system","user","assistant"])
        self.assertEqual(json.loads(m[-1]["content"]),self.saida)

    def test_abstencao_nao_pode_esconder_afirmacoes(self):
        e={"tarefa":"entender","campo":"papel","fontes":[]}
        s={"estado":"insuficiente","valor":"indefinido","fontes":[],"faltam":["papel"]}
        self.assertEqual(validar_saida(s,e), [])
        s["valor"]="intermediacao"
        self.assertIn("abstencao_com_afirmacao",validar_saida(s,e))

    def test_tipos_arbitrarios_nao_derrubam_o_validador(self):
        for campo in ("fontes","faltam","valor"):
            for valor in (None,{},[{}],[0],42):
                s=deepcopy(self.saida);s[campo]=valor
                self.assertTrue(validar_saida(s,self.entrada),(campo,valor))
        e=deepcopy(self.entrada);e["fontes"][0]["id"]={}
        self.assertTrue(validar_entrada(e))

    def test_dados_financeiros_e_chaves_estranhas_nao_entram_na_tarefa(self):
        e=deepcopy(self.entrada);e["margem"]=100
        self.assertTrue(validar_entrada(e))

    def test_plano_exige_condicao_literal_e_abstencao_vazia(self):
        e={"tarefa":"recomendar","perfil":{},"fontes":[{"id":"f1","texto":"Curso presencial de 20 horas. Inscrição na unidade.","tipo":"declaracao"}]}
        s={"estado":"proposta","decisao":"Conferir o formato antes da inscrição.","alternativas":[],
           "criterios":[{"texto":"presencial de 20 horas","escopo":"Curso","fontes":["f1"]}],
           "acao":"Conferir se o público consegue localizar o formato antes de se inscrever.",
           "verificar":"Registrar o formato escolhido e o passo encontrado.","fontes":["f1"],"incertezas":["Uso não observado."],"hipotese":True}
        self.assertEqual(validar_saida(s,e), [])
        s["criterios"][0]["texto"]="Online e gratuito"
        self.assertTrue(validar_saida(s,e))
        s.update(estado="insuficiente",decisao="",acao="",verificar="",criterios=[],fontes=[])
        self.assertEqual(validar_saida(s,e), [])

    def test_negacao_de_promessa_nao_e_promessa(self):
        e={"tarefa":"recomendar","perfil":{},"fontes":[]}
        s={"estado":"insuficiente","decisao":"","alternativas":[],"criterios":[],"acao":"","verificar":"","fontes":[],"incertezas":["Sem dados comerciais."],"hipotese":True}
        self.assertEqual(validar_saida(s,e), [])
        # Free fields of a proposal remain different from quoted public prices.
        e["fontes"]=[{"id":"f1","texto":"Curso presencial de 20 horas.","tipo":"declaracao"}]
        s.update(estado="proposta",decisao="Conferir a escolha.",criterios=[{"texto":"presencial de 20 horas","escopo":None,"fontes":["f1"]}],fontes=["f1"],verificar="Registrar a escolha.")
        for acao in ("Esta análise não garante lucro.","Não podemos garantir retorno.","Confira o formato sem garantir lucro."):
            s["acao"]=acao
            self.assertNotIn("prescricao_financeira_nao_sustentada",validar_saida(s,e),acao)
        for acao in ("Isso garante lucro.","Não temos dados; aumente a verba.","Esta escolha não só garante lucro, ela resolve o problema."):
            s["acao"]=acao
            self.assertIn("prescricao_financeira_nao_sustentada",validar_saida(s,e),acao)

    def test_abstencao_com_refs_nao_e_aceita_como_dados_confirmados(self):
        e=deepcopy(self.entrada);e["campo"]="papel"
        s={"estado":"insuficiente","valor":"indefinido","fontes":["real-caso-longo-F01"],"faltam":["papel"]}
        self.assertIn("abstencao_com_referencias",validar_saida(s,e))


if __name__ == "__main__":
    unittest.main()
