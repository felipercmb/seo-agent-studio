import unittest
from collections import Counter
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from negocio.proposicoes.c12.dados import novos,conferir

class C12(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.records=novos()

    def test_entidades_e_familias_novas_nao_cruzam_divisoes(self):
        r=conferir(self.records);self.assertEqual(r['splits']['train']['tarefas'],64);self.assertEqual(r['splits']['validation']['tarefas'],8)
        a=[r for r in self.records if r['split']=='train'];b=[r for r in self.records if r['split']=='validation']
        for key in ['entidade','familia']:self.assertFalse({r[key] for r in a}&{r[key] for r in b})

    def test_todas_categorias_de_condicoes_tem_supervisao_de_treino(self):
        seen=Counter(c['categoria'] for r in self.records if r['split']=='train' for c in r['alvo'].get('condicoes',[]))
        self.assertEqual(set(seen),{'elegibilidade','preco','canal','limite','prazo','exclusao','outro'});self.assertTrue(all(n>=4 for n in seen.values()))

    def test_pagamento_da_ferramenta_e_venda_do_usuario_tem_escopos_distintos(self):
        values=[]
        for r in self.records:
            for p in r['alvo'].get('proposicoesPorUnidade',{}).values():
                if p and p['acao']=='paga':values.append(p)
        self.assertTrue(any(p['sujeito']=='A empresa usuária' and p['escopo']=='contratacao_da_oferta' for p in values))
        self.assertTrue(any(p['sujeito']=='O cliente da empresa usuária' and p['escopo']=='transacao_do_cliente' for p in values))

    def test_preco_conserva_ambos_periodos_na_unidade_da_condicao(self):
        for r in self.records:
            for c in r['alvo'].get('condicoes',[]):
                if c['categoria']=='preco':
                    u=next(u for u in r['documento']['unidades'] if u['id']==c['unidade']);self.assertIn('4 reais',u['texto']);self.assertIn('7 reais',u['texto']);self.assertIn('20 dias',u['texto'])

    def test_atividade_negada_nao_e_rotina_afirmativa_do_fornecedor(self):
        count=0
        for r in self.records:
            for u in r['documento']['unidades']:
                if 'não transporta mercadorias' in u['texto'] and r['oferta']:
                    self.assertIsNone(r['alvo']['proposicoesPorUnidade'][u['id']]);self.assertTrue(any(c['unidade']==u['id'] and c['categoria']=='exclusao' for c in r['alvo']['condicoes']));count+=1
        self.assertEqual(count,4)

    def test_prazo_do_suporte_nao_e_prazo_da_prestacao_principal(self):
        for r in self.records:
            for c in r['alvo'].get('condicoes',[]):
                if c['categoria']=='prazo':self.assertEqual(c['alcance'],'suporte');self.assertEqual(c['aplicaA'],'suporte')

if __name__=='__main__':unittest.main()
