import unittest
from copy import deepcopy
from negocio.jornadas.executar import recusar_duvidas_extensas

class TestRecusaDeDuvidas(unittest.TestCase):
    def test_pergunta_extensa_nao_apaga_oferta_e_recusa_e_registrada(self):
        saida={'ofertas':[{'nome':'Oferta publicada','evidencias':['s01']}],'duvidas':['a'*241,'Quem atende?']}
        original=deepcopy(saida);nova,registro=recusar_duvidas_extensas(saida)
        self.assertEqual(saida,original);self.assertEqual(nova['ofertas'],original['ofertas'])
        self.assertEqual(nova['duvidas'][0],'Quem atende?');self.assertEqual(registro,[{'tipo':'duvida_recusada_comprimento','indice':0,'caracteres':241}])
        self.assertNotIn('a'*240,nova['duvidas']);self.assertLessEqual(len(nova['duvidas']),6)

    def test_outras_falhas_nao_sao_reparadas(self):
        for saida in [None,{'duvidas':'texto'},{'duvidas':['x']*7},{'duvidas':[None,'']},{'ofertas':'invalida','duvidas':['Pergunta válida']}]:
            nova,registro=recusar_duvidas_extensas(saida);self.assertEqual(nova,saida);self.assertEqual(registro,[])

    def test_todos_os_seis_textos_extensos_sao_recusados_inteiros(self):
        saida={'duvidas':['x'*250 for _ in range(6)],'compradores':[],'condicoes':[{'evidencia':'s02'}]}
        nova,registro=recusar_duvidas_extensas(saida)
        self.assertEqual(len(registro),6);self.assertEqual(len(nova['duvidas']),1)
        self.assertEqual(nova['condicoes'],saida['condicoes']);self.assertEqual(nova['compradores'],[])

    def test_limite_e_unicode_sao_contados_pelo_mesmo_contrato(self):
        s={'duvidas':['á'*240]};self.assertEqual(recusar_duvidas_extensas(s),(s,[]))
        nova,registro=recusar_duvidas_extensas({'duvidas':['á'*241]});self.assertEqual(registro[0]['caracteres'],241)
        self.assertNotIn('á'*240,nova['duvidas'])

if __name__=='__main__':unittest.main()
