"""Testa a contagem prospectiva da alternativa de regra sem carregar pesos."""
from pathlib import Path
import sys
import unittest

IA=Path(__file__).parent
sys.path[:0]=[str(IA),str(IA/'robustez')]
from avaliar_prospectivo import processar,agregar

def caso(ev,esperado,tipo='termo_sem_demanda'):
    return {'id':'caso','grupo':'exemplo.invalid','tipo':tipo,'fonte':{'reproducao_em':'2026-11-15T10:00:30Z'},
      'entrada':{'site':'exemplo.invalid','objetivo':'Escolher uma próxima melhoria com as evidências disponíveis.',
        'evidencias':ev},'esperado':esperado}

class ProspectivoTest(unittest.TestCase):
    def test_substituicao_e_registrada_com_origem_do_modelo_e_da_regra(self):
        u='https://exemplo.invalid/';data='2026-11-15T10:00:00Z'
        p={'id':'p1','tipo':'pagina','pagina':u,'atual':True,'observado_em':data,'sha256_pagina':'a'*64}
        s={'id':'s1','tipo':'serp','pagina':u,'termo':'oferta','atual':False,'posicao':None,'observado_em':None}
        c=caso([s,p],{'acao':'validar_demanda','evidencias':['p1']})
        r=processar(c,gerador=lambda *_:('',{'acao':'melhorar_pagina','evidencias':['p1']}))
        self.assertEqual(r['origem_original'],'ia');self.assertEqual(r['origem_exibida'],'regra')
        self.assertTrue(r['ajustada_por_regra']);self.assertTrue(r['concordancia'])
        self.assertEqual(agregar([r])['total']['ajustadas_por_regra'],1)

    def test_sem_fonte_da_pagina_nao_cria_alternativa(self):
        u='https://exemplo.invalid/';p={'id':'p1','tipo':'pagina','pagina':u,'atual':True,
          'observado_em':'2026-11-15T10:00:00Z','sha256_pagina':'a'*64}
        c=caso([p],{'acao':'validar_demanda','evidencias':['p1']})
        r=processar(c,gerador=lambda *_:('',{'acao':'melhorar_pagina','evidencias':['p1']}))
        self.assertFalse(r['aceita']);self.assertFalse(r['ajustada_por_regra'])

    def test_sem_dados_nao_e_contado_como_resposta(self):
        c=caso([],{'acao':'atualizar_coleta','evidencias':[]},tipo='sem_dados')
        r=processar(c);m=agregar([r])['total']
        self.assertEqual(m['nao_encaminhados'],1);self.assertEqual(m['com_dados'],0)

if __name__=='__main__':unittest.main()
