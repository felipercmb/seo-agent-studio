"""Audita novos pesos, sem carregar modelo ou executar GPU."""
import json
from copy import deepcopy
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
from negocio.proposicoes.c11.ponderacao import preparar_pesos,perda_ponderada
from negocio.proposicoes.c10.ponderacao import preparar_pesos as preparar_c10,perda_ponderada as perda_c10

class C11(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from transformers import AutoTokenizer
        except ImportError:
            raise unittest.SkipTest('Auditoria de tokens requer Transformers local, sem download automatico.')
        from negocio.modelos import REGISTRO
        if not (REGISTRO['qwen35-4b']['pasta']/'tokenizer.json').is_file():
            raise unittest.SkipTest('Tokenizer local nao instalado; preparar explicitamente antes da auditoria.')
        cls.tok=AutoTokenizer.from_pretrained(str(REGISTRO['qwen35-4b']['pasta']),local_files_only=True,trust_remote_code=False)

    def dados(self,condition=False,role='usuario',scope='uso'):
        prop={'sujeito':'A equipe','tipoSujeito':role,'acao':'utiliza','objeto':'a ferramenta','escopo':scope}
        target={'proposicoesPorUnidade':{'u003':prop,'u991':None},'condicoes':[{'unidade':'u003','categoria':'limite','aplicaA':'a ferramenta','alcance':'oferta'}] if condition else [],'incertezas':[]}
        return {'treino':[{'messages':[{'role':'user','content':'Teste local de papéis.'},{'role':'assistant','content':json.dumps(target,ensure_ascii=False,separators=(',',':'))}],'metadados':{'tarefaId':'case'}}]}

    def test_mensagens_tokens_e_mascara_identicos(self):
        data=self.dados(True);before=deepcopy(data);a=preparar_c10(data,self.tok)['linhas'][0];b=preparar_pesos(data,self.tok)['linhas'][0]
        self.assertEqual(data,before);self.assertEqual(a['ids'],b['ids']);self.assertEqual(a['offset'],b['offset']);self.assertEqual(a['decisoes'],b['decisoes'])
        self.assertTrue(all(w==1 for w in b['pesos'][:b['offset']]))

    def test_tipos_escopos_tem_fronteira_bpe_real(self):
        for role in ['fornecedor','usuario','terceiro','ferramenta','indefinido']:
            for scope in ['uso','prestacao_da_oferta','servico_do_cliente','indefinido']:
                r=preparar_pesos(self.dados(role=role,scope=scope),self.tok)['linhas'][0]
                ds=[d for d in r['decisoesSemanticas'] if d['campo']!='presencaCondicoes']
                self.assertEqual({d['campo'] for d in ds},{'tipoSujeito','escopo'})
                for d in ds:
                    self.assertEqual(r['pesos'][d['indiceToken']],4);self.assertNotEqual(d['token'],d['tokenAlternativo']);self.assertTrue(d['contrafactualNuncaUsadoComoAlvo'])

    def test_presenca_ausencia_condicao_simetrica(self):
        for condition in [False,True]:
            r=preparar_pesos(self.dados(condition),self.tok)['linhas'][0];d=next(d for d in r['decisoesSemanticas'] if d['campo']=='presencaCondicoes')
            self.assertEqual(r['pesos'][d['indiceToken']],8);self.assertNotEqual(d['token'],d['tokenAlternativo'])

    def test_categorias_cabeca_tambem_ponderadas(self):
        target={'ofertas':[{'nomeId':'n001','natureza':'software','papel_site':'disponibiliza','evidencias':['s01']}],'incertezas':[]}
        data={'treino':[{'messages':[{'role':'user','content':'Nome publicado.'},{'role':'assistant','content':json.dumps(target,separators=(',',':'))}],'metadados':{'tarefaId':'head'}}]}
        r=preparar_pesos(data,self.tok)['linhas'][0];self.assertEqual({d['campo'] for d in r['decisoesSemanticas']},{'natureza','papel_site'});self.assertEqual({d['peso'] for d in r['decisoesSemanticas']},{4})

    def test_loss_c10_reutilizada_sem_alteracao(self):
        self.assertIs(perda_ponderada,perda_c10)

if __name__=='__main__':unittest.main()
