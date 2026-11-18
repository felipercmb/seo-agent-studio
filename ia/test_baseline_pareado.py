"""Guardas CPU da comparação; não testa nem carrega pesos."""
import json
from pathlib import Path
import sys
import unittest
from copy import deepcopy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from avaliar_jornadas_baseline_pareado import pedido_bytes,codigo_baseline
from negocio.proposicoes.controle import construir


class BaselinePareado(unittest.TestCase):
    def test_pedido_nao_pode_trocar_modelo_ou_maximo_de_ofertas(self):
        p,_,_=construir()
        self.assertEqual(pedido_bytes(json.dumps(p).encode(),'example.com'),p)
        for campo,valor in [('modeloBase','qwen35-9b'),('maxOfertas',True),('maxOfertas',2)]:
            x={**p,campo:valor}
            with self.assertRaises(ValueError):pedido_bytes(json.dumps(x).encode(),'example.com')

    def test_dominios_e_json_ambiguo_sao_recusados(self):
        p,_,_=construir()
        with self.assertRaises(ValueError):pedido_bytes(json.dumps(p).encode(),'outro.example')
        bruto=json.dumps(p).replace('"maxOfertas": 1','"maxOfertas":1,"maxOfertas":1').encode()
        with self.assertRaises(ValueError):pedido_bytes(bruto,'example.com')

    def test_freeze_inclui_instrumentacao_e_executor_real(self):
        c=codigo_baseline()
        self.assertIn('ia/avaliar_jornadas_baseline_pareado.py',c)
        self.assertIn('ia/negocio/jornadas/executar.py',c)
        self.assertIn('ia/negocio/runtime_negocio.py',c)
        self.assertNotIn('ia/negocio/proposicoes/executar.py',c)
        self.assertTrue(all(len(h)==64 for h in c.values()))

    def test_pool_valido_acima_do_limite_de_resposta_nao_e_truncado(self):
        p,_,_=construir();p['fontesReserva']=[]
        for i in range(100):
            f=deepcopy(p['base']['fontes'][0]);f['id']='r'+str(i);p['fontesReserva'].append(f)
        b=json.dumps(p,ensure_ascii=False).encode()
        self.assertGreater(len(b),65536)
        self.assertLess(len(b),1048576)
        self.assertEqual(len(pedido_bytes(b,'example.com')['fontesReserva']),100)

if __name__=='__main__':unittest.main()
