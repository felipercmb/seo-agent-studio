import contextlib
import io
import json
import unittest
from negocio.contrato import CAMPOS
from negocio.executar_pipeline import executar_caso


class ExecucaoNegocioTests(unittest.TestCase):
    def caso(self,vazio=False):
        fs=[] if vazio else [{"id":"fonte_a","texto":"Prestamos serviços de limpeza.","tipo":"declaracao"},
            {"id":"fonte_b","texto":"A limpeza exige agendamento.","tipo":"declaracao"}]
        return {"id":"fixture","dominio":"fixture.example","grupoEmpresarial":"fixture.example","split":"validation","captura":{},
            "pool":{"fontes":fs},"contextosPorCampo":{k:{"campo":k,"fontes":fs[:1]} for k in (*CAMPOS,"recomendar")},
            "contextosExtrasPorCampo":{k:[{"campo":k,"fontes":fs[1:]}] for k in ("ofertas","publicos","atuacoes","condicoes")}}

    def test_todas_passadas_recusadas_nao_criam_ciclo_ou_acerto(self):
        def gerar(*args,**kwargs):return {"estado":"recusada","inferida":True,"textoBruto":"inválido","saida":None,"errosContrato":["json_invalido"]}
        with contextlib.redirect_stdout(io.StringIO()):
            r=executar_caso(self.caso(),None,None,gerar,max_tokens=900,max_sequencia=6144,passadas=2)
        json.dumps(r)
        for q in r["resultados"]:
            self.assertFalse(q["contratoValido"])
            if q["campo"] in ("ofertas","publicos","atuacoes","condicoes"):
                self.assertEqual(len(q["passadas"]),2)
                self.assertEqual(q["fusao"]["passadasValidas"],0)

    def test_captura_vazia_abstem_sem_invocar_modelo(self):
        def proibido(*args,**kwargs):raise AssertionError("Não há fonte para inferência.")
        with contextlib.redirect_stdout(io.StringIO()):
            r=executar_caso(self.caso(vazio=True),None,None,proibido,max_tokens=900,max_sequencia=6144)
        self.assertEqual(len(r["resultados"]),7)
        self.assertTrue(all(q["contratoValido"] for q in r["resultados"]))
        self.assertTrue(all(not q["geracao"]["inferida"] for q in r["resultados"]))
        self.assertFalse(r["perfilConfirmado"])

    def test_erro_do_modelo_fica_registrado_sem_virar_abstencao_ou_sumir(self):
        registros=[]
        def falhar(*args,**kwargs):raise RuntimeError("falha controlada da geração")
        with contextlib.redirect_stdout(io.StringIO()):
            r=executar_caso(self.caso(),None,None,falhar,max_tokens=900,max_sequencia=6144,registrar=registros.append)
        self.assertEqual(len(registros),7)
        self.assertEqual(registros,r["resultados"])
        for resultado in registros:
            self.assertFalse(resultado["contratoValido"])
            self.assertEqual(resultado["geracao"]["estado"],"erro_execucao")
            self.assertIsNone(resultado["geracao"]["saida"])
            self.assertFalse(resultado["geracao"]["inferida"])
        self.assertTrue(r["pontePlanejamento"]["revisaoSemanticaPendente"])

    def test_template_natural_e_explicito_e_nao_muda_o_padrao(self):
        for alinhar in (False,True):
            chamadas=[]
            def gerar(*args,**kwargs):
                chamadas.append(kwargs["alinhar_template"])
                return {"estado":"recusada","inferida":True,"textoBruto":"fixture","saida":None,"errosContrato":["fixture"]}
            with contextlib.redirect_stdout(io.StringIO()):
                executar_caso(self.caso(),None,None,gerar,max_tokens=640,max_sequencia=3072,alinhar_template=alinhar)
            self.assertEqual(chamadas,[alinhar]*7)

    def test_planejador_tem_protocolo_proprio_sem_trocar_o_leitor(self):
        chamadas=[]
        def gerar(*args,**kwargs):
            chamadas.append(kwargs["versao_prompt"])
            return {"estado":"recusada","inferida":True,"textoBruto":"fixture","saida":None,"errosContrato":["fixture"]}
        with contextlib.redirect_stdout(io.StringIO()):
            executar_caso(self.caso(),None,None,gerar,max_tokens=640,max_sequencia=3072,versao_prompt="v3",versao_prompt_plano="v4")
        self.assertEqual(chamadas,["v3"]*6+["v4"])


if __name__=="__main__":unittest.main()
