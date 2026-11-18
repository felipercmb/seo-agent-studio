"""Verifica as regras e os denominadores do fluxo híbrido sem carregar o modelo."""
from pathlib import Path
import sys
import unittest

IA=Path(__file__).parent
sys.path[:0]=[str(IA),str(IA/'robustez')]
from avaliar_ciclo3 import processar,agregar
from selecionar_ciclo3 import escolher
from disponibilizar_experimento import verificar

def caso(tipo,evidencias,esperado,objetivo='Escolher uma próxima melhoria com as evidências disponíveis.'):
    return {'id':'exemplo','grupo':'exemplo.invalid','tipo':tipo,'fonte':{'reproducao_em':'2026-11-15T10:00:30Z'},
      'entrada':{'site':'exemplo.invalid','objetivo':objetivo,'evidencias':evidencias},'esperado':esperado}

class Ciclo3Test(unittest.TestCase):
    def test_vazio_nao_e_contado_como_acerto_da_ia(self):
        c=caso('sem_dados',[],{'acao':'atualizar_coleta','evidencias':[]})
        def proibido(*_):raise AssertionError('Modelo não deveria ser chamado')
        r=processar(c,gerador=proibido);m=agregar([r])['total']
        self.assertEqual(r['estado'],'nao_encaminhada');self.assertEqual(m['nao_encaminhados'],1)
        self.assertEqual(m['concordancias_aceitas'],0);self.assertEqual(m['escolhas_ia'],0)

    def test_posicao_atual_e_concorrente_identificados_acionam_regra(self):
        s={'id':'s1','tipo':'serp','atual':True,'observado_em':'2026-11-15T10:00:00Z','posicao':37,
           'fontes_serp':[{'id':'fonte_123','sha256':'a'*64,'observado_em':'2026-11-15T10:00:00Z'}],
           'concorrentes':[{'pagina':'https://rival.invalid/','posicao':2}]}
        c=caso('concorrentes',[s],{'acao':'comparar_concorrentes','evidencias':['s1']})
        r=processar(c,gerador=lambda *_:self.fail('A regra já tem evidências.'))
        self.assertEqual(r['origem'],'regra');self.assertTrue(r['corresponde_e_aceita']);self.assertFalse(r['critica_exibida'])
        s['fontes_serp']=[]
        r=processar(c,gerador=lambda *_:self.fail('A falta de fonte tem regra específica.'))
        self.assertEqual(r['origem'],'regra');self.assertEqual(r['escolha']['acao'],'atualizar_coleta')

    def test_fonte_vencida_nao_acorda_regra_de_concorrencia(self):
        s={'id':'s1','tipo':'serp','atual':True,'observado_em':'2026-11-14T10:00:00Z','posicao':27,
          'fontes_serp':[{'id':'fonte_123','sha256':'a'*64}],
          'concorrentes':[{'pagina':'https://rival.invalid/','posicao':2}]}
        c=caso('vencida',[s],{'acao':'atualizar_coleta','evidencias':['s1']},'Qual posição atual e concorrentes?')
        r=processar(c,gerador=lambda *_:self.fail('A posição vencida tem regra específica.'))
        self.assertEqual(r['origem'],'regra');self.assertTrue(r['corresponde_e_aceita'])

    def test_selecao_exige_nao_regredir_em_concorrentes_ou_diagnostico(self):
        def rel(real,diag,conc,acom,rec=0):
            def total(x):return {'concordancias_aceitas':x,'recusas':rec,'criticas_antes':0,'criticas_exibidas':0}
            def tipo(x):return {'com_dados':4,'concordancias_aceitas':x}
            return {'real':{'metricas':{'total':total(real),'por_tipo':{'diagnostico':tipo(diag)}}},
              'sintetico':{'metricas':{'total':total(conc+acom),'por_tipo':{'concorrentes':tipo(conc),'acompanhar':tipo(acom)}}}}
        base=rel(4,3,4,4);regressao=rel(5,3,3,4);melhor=rel(5,4,4,4)
        self.assertIs(escolher(base,[regressao]),base);self.assertIs(escolher(base,[melhor]),melhor)

    def test_botao_experimental_exige_cobertura_e_nao_regressao(self):
        def par(real=5,diag=3,conc=4,acom=4,crit=0,dominios=5):
            def total(x):return {'concordancias_aceitas':x,'recusas':0,'criticas_antes':crit,'criticas_exibidas':0}
            def tipo(x):return {'com_dados':4,'concordancias_aceitas':x}
            return {'real':{'metricas':{'total':total(real),'dominios_com_dados':dominios,'por_tipo':{'diagnostico':tipo(diag)}}},
              'sintetico':{'metricas':{'total':total(conc+acom+4),'por_tipo':{'concorrentes':tipo(conc),'acompanhar':tipo(acom),
                'diretiva_html':tipo(2),'diretiva_http':tipo(2)}}}}
        base=par();self.assertFalse(verificar(base,par(real=6,diag=4)))
        self.assertTrue(verificar(base,par(real=6,diag=2)))
        self.assertTrue(verificar(base,par(real=6,diag=4,crit=1)))
        self.assertTrue(verificar(base,par(real=6,diag=4,dominios=2)))

if __name__=='__main__':unittest.main()
