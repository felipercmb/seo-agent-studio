"""Verifica supervisão e separação dos novos contrastes, sem executar modelo."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from negocio.proposicoes.c10.dados import novos,conferir


class ContrastesC10(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.rs=novos()

    def test_familias_e_entidades_de_validacao_nao_sao_treino(self):
        r=conferir(self.rs)
        self.assertEqual(r['splits']['train']['tarefas'],48)
        self.assertEqual(r['splits']['validation']['tarefas'],8)
        train=[x for x in self.rs if x['split']=='train'];val=[x for x in self.rs if x['split']=='validation']
        for field in ['familia','entidade']:self.assertFalse({x[field] for x in train}&{x[field] for x in val})

    def test_usuario_do_software_nao_recebe_tipo_fornecedor(self):
        for r in self.rs:
            for p in r['alvo'].get('proposicoesPorUnidade',{}).values():
                if p and p['sujeito'] in ['A empresa usuária','A empresa','O cliente','Os operadores da empresa']:
                    self.assertEqual(p['tipoSujeito'],'usuario')

    def test_depoimento_biografia_e_suporte_sem_ator_nao_forcam_proposicao(self):
        contagem=0
        for r in self.rs:
            props=r['alvo'].get('proposicoesPorUnidade',{})
            for u in r['documento']['unidades']:
                if u['id'] in props and any(s in u['texto'] for s in ['Em depoimento','A fundadora trabalhou','Suporte em etapas']):
                    self.assertIsNone(props[u['id']]);contagem+=1
        self.assertGreaterEqual(contagem,12)

    def test_checkout_opcional_sempre_conserva_condicao_na_mesma_unidade(self):
        vistos=0
        for r in self.rs:
            for u in r['documento']['unidades']:
                if u['id'] in r['alvo'].get('proposicoesPorUnidade',{}) and 'somente com o módulo' in u['texto']:
                    self.assertTrue(any(c['unidade']==u['id'] and c['alcance']=='transacao_do_cliente' for c in r['alvo']['condicoes']));vistos+=1
        self.assertEqual(vistos,4)

    def test_ultima_posicao_nao_codifica_sempre_abstencao(self):
        classes=set()
        for r in self.rs:
            if r['split']=='train' and r['oferta']:
                ultimo=r['documento']['unidadesAlvo'][-1];classes.add(r['alvo']['proposicoesPorUnidade'][ultimo] is None)
        self.assertEqual(classes,{True,False})


if __name__=='__main__':unittest.main()
