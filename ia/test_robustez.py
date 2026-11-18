"""Testes do avaliador da interface sem carregamento do modelo."""
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

IA=Path(__file__).parent
sys.path[:0]=[str(IA),str(IA/'robustez')]
from avaliar_interface import processar,agregar
from selecionar_interface import escolher
from revisar import correcao_valida
from resumir_revisoes import resumir
from resumir_interface import resumir as resumir_interface

def caso(tipo,evidencias,esperado):
    return {'id':'teste','grupo':'exemplo.invalid','tipo':tipo,
      'fonte':{'reproducao_em':'2026-11-15T09:00:01Z'},'entrada':{'site':'exemplo.invalid',
      'objetivo':'Escolher uma revisão com a evidência.', 'evidencias':evidencias},'esperado':esperado}

class RobustezTest(unittest.TestCase):
    def test_contexto_vazio_usa_regra_sem_inventar_e_sem_invocar_modelo(self):
        c=caso('sem_dados',[],{'acao':'atualizar_coleta','evidencias':[]})
        def erro(*a):raise AssertionError('Modelo não deveria ser chamado')
        r=processar(c,gerador=erro)
        self.assertTrue(r['corresponde_e_aceita']);self.assertEqual(r['origem'],'regra')

    def test_metrica_da_interface_exclui_contextos_sem_dados_que_nao_chamam_ia(self):
        c=caso('sem_dados',[],{'acao':'atualizar_coleta','evidencias':[]})
        r=processar(c);resumo=resumir_interface([c],[r])
        self.assertEqual(resumo['sem_dados_nao_encaminhados_pela_interface'],1)
        self.assertEqual(resumo['com_dados']['contextos'],0)
        self.assertEqual(resumo['com_dados']['concordancias_editoriais_aceitas'],0)

    def test_ranking_sem_posicao_e_bloqueado_e_nao_contado_como_exibido(self):
        s={'id':'s1','tipo':'serp','atual':False,'posicao':None,'observado_em':None}
        c=caso('termo_sem_demanda',[s],{'acao':'atualizar_coleta','evidencias':['s1']})
        r=processar(c,gerador=lambda *a:('',{'acao':'comparar_concorrentes','evidencias':['s1']}))
        self.assertFalse(r['aceita']);self.assertTrue(r['critica_antes_barreiras']);self.assertFalse(r['critica_exibida'])
        self.assertEqual(agregar([r])['total']['recusas'],1)

    def test_comparacao_sem_concorrente_a_frente_e_critica_antes_da_barreira(self):
        s={'id':'s1','tipo':'serp','atual':True,'posicao':20,'observado_em':'2026-11-15T09:00:00Z'}
        c=caso('sem_concorrente',[s],{'acao':'acompanhar','evidencias':['s1']})
        r=processar(c,gerador=lambda *a:('',{'acao':'comparar_concorrentes','evidencias':['s1']}))
        self.assertFalse(r['aceita']);self.assertTrue(r['critica_antes_barreiras']);self.assertFalse(r['critica_exibida'])

    def test_selecao_nao_aceita_regressao_em_grupo_ou_empate(self):
        def rel(total,diag,termo,recusas=0,criticas=0):
            return {'metricas':{'total':{'concordancias_aceitas':total,'recusas':recusas,
                'criticas_exibidas':criticas,'criticas_antes_barreiras':criticas},
                'por_tipo':{'diagnostico':{'concordancias_aceitas':diag},
                            'termo_sem_demanda':{'concordancias_aceitas':termo}}}}
        base=rel(8,4,4,1);empate=rel(8,4,4,1);regressao=rel(9,3,6,0)
        melhor=rel(10,5,5,0);critico=rel(11,5,6,0,1)
        self.assertIs(escolher(base,[empate,regressao,critico]),base)
        self.assertIs(escolher(base,[melhor,critico]),melhor)

    def test_revisao_humana_nao_transforma_correcao_sem_fonte_em_dado_confirmado(self):
        s={'id':'s1','tipo':'serp','atual':False,'posicao':None,'observado_em':None}
        c=caso('fonte_ausente',[s],{'acao':'atualizar_coleta','evidencias':['s1']})
        self.assertFalse(correcao_valida(c,{'acao':'comparar_concorrentes','evidencias':['s1']}))
        self.assertTrue(correcao_valida(c,{'acao':'atualizar_coleta','evidencias':['s1']}))

    def test_resumo_de_revisoes_preserva_nao_avaliaveis_e_denominador_de_concordancia(self):
        def registro(nome,caso,parecer,alvo):
            return {'versao':1,'revisor_autodeclarado':nome,'caso_id':caso,'dominio':'site.invalid',
              'manifesto_sha256':'a','avaliacao_sha256':'b','parecer':parecer,'alvo_humano':alvo}
        alvo={'acao':'atualizar_coleta','evidencias':['s1']}
        a=registro('A','um','aprovada',alvo);b=registro('B','um','corrigida',alvo)
        c=registro('A','dois','nao_avaliavel',None);d=registro('B','dois','aprovada',alvo)
        resumo=resumir([a,b,c,d]);par=resumo['concordancia_pares'][0]
        self.assertEqual(par['casos_em_comum'],2);self.assertEqual(par['comparaveis'],1)
        self.assertEqual(par['mesma_acao_e_fontes_ou_recusa'],1)
        self.assertEqual(resumo['por_revisor']['A']['nao_avaliaveis'],1)
        with self.assertRaises(ValueError):resumir([a,a])

if __name__=='__main__':unittest.main()
