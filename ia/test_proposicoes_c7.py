"""Guardas CPU para o experimento4B/adaptador; nenhum modelo é carregado."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
IA=Path(__file__).resolve().parent;sys.path.insert(0,str(IA))
from negocio.proposicoes.c7.dados import gerar_controlados,conferir,exportar
from negocio.proposicoes.c7.avaliar_tarefas import pontuar
from negocio.proposicoes.c7.treinar import conferir_corpus
from negocio.proposicoes.c7.executar import conferir_adaptador


class C7(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.rs=gerar_controlados()

    def test_negativos_nao_apagam_relacoes_positivas_da_mesma_fonte(self):
        r=next(x for x in self.rs if x['id']=='c7-f00-e00-pt-proposicoes')
        vals=list(r['alvo']['proposicoesPorUnidade'].values())
        self.assertEqual(sum(v is not None for v in vals),2)
        self.assertIsNone(vals[-1])
        self.assertTrue(any('Somos' in u['texto'] for u in r['documento']['unidades']))
        self.assertEqual(vals[0]['tipoSujeito'],'ferramenta')
        self.assertEqual(vals[1]['tipoSujeito'],'usuario')

    def test_beneficio_biografia_sem_oferta_nao_forcam_nome_de_marca(self):
        neg=[r for r in self.rs if r['familia'] in ['controlada-06','controlada-07']]
        self.assertEqual(len(neg),8)
        self.assertTrue(all(r['oferta'] is None and r['alvo']['ofertas']==[] for r in neg))

    def test_id_da_oferta_nao_e_sempre_o_primeiro_do_catalogo(self):
        ids={o['nomeId'] for r in self.rs if r['oferta'] is None for o in r['alvo']['ofertas']}
        self.assertGreater(len(ids),1)

    def test_entidade_pt_en_nao_atravessa_divisao(self):
        base=conferir(self.rs)
        self.assertEqual(base['entidadesDistintas'],20)
        erro=deepcopy(self.rs);erro[-1]['entidade']=erro[0]['entidade']
        with self.assertRaisesRegex(ValueError,'Contaminação'):conferir(erro)

    def test_adulteracao_do_corpus_para_treino_e_recusada(self):
        with tempfile.TemporaryDirectory() as d:
            pasta=Path(d)/'dados';exportar(pasta,self.rs)
            conferir_corpus(pasta)
            with (pasta/'train.jsonl').open('a') as f:f.write('{}\n')
            with self.assertRaisesRegex(ValueError,'adulterado'):conferir_corpus(pasta)

    def test_interrupcao_nao_e_acerto_de_alvo_vazio(self):
        alvo={'ofertas':[],'incertezas':[]}
        r=pontuar(alvo,{'estado':'interrompida_tempo','inferida':True,'saida':alvo})
        self.assertFalse(r['exata']);self.assertFalse(r['concluida'])

    def test_ator_falso_em_null_e_erro_mesmo_com_json_valido(self):
        p={'sujeito':'Somos','tipoSujeito':'fornecedor','acao':'criamos','objeto':'soluções','escopo':'fornecimento'}
        alvo={'proposicoesPorUnidade':{'u001':None},'condicoes':[],'incertezas':[]}
        r=pontuar(alvo,{'estado':'gerada','inferida':True,'saida':{**alvo,'proposicoesPorUnidade':{'u001':p}}})
        self.assertFalse(r['exata']);self.assertEqual(r['falsosEmUnidadeNull'],1)

    def test_listas_reordenadas_sem_equivalencias_de_negocio(self):
        a={'ofertas':[{'nomeId':'n001','evidencias':['s01','s02'],'natureza':'software','papel_site':'disponibiliza'}],'incertezas':[]}
        b=deepcopy(a);b['ofertas'][0]['evidencias'].reverse()
        self.assertTrue(pontuar(a,{'estado':'gerada','inferida':True,'saida':b})['exata'])
        b['ofertas'][0]['natureza']='servico'
        self.assertFalse(pontuar(a,{'estado':'gerada','inferida':True,'saida':b})['exata'])

    def test_adaptador_com_modelo_errado_falha_antes_de_pesos(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'treino.json').write_text(json.dumps({'estado':'concluido','modeloBase':'qwen35-9b','novoAjustePesos':True,'codigoMudouDuranteExecucao':False}))
            with self.assertRaisesRegex(ValueError,'recibo'):conferir_adaptador(p)

if __name__=='__main__':unittest.main()
