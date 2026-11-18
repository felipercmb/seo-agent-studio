"""Verifica isolamento dos exemplos de SERP sem usar uma fonte ou modelo real."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from serp_real import preparar_treino as modulo
from serp_real.avaliar import avaliar,verificar_reserva
from serp_real.selecionar import elegivel

def j(obj):return json.dumps(obj,ensure_ascii=False)+'\n'
def caso(site,termo,split):
    return {'grupo':site,'split':split,'entrada':{'site':site,'objetivo':'Análise',
      'evidencias':[{'id':'s1','tipo':'serp','termo':termo,'atual':False,'posicao':None}],
      'dados_negocio':{}},'esperado':{'acao':'atualizar_coleta','evidencias':['s1']},
      'fonte':{'reproducao_em':'2026-11-15T12:00:00Z'}}
def escreve_manifesto(p,arquivos):
    manifesto={'arquivos':{}}
    for nome,conteudo in arquivos.items():
        arq=p/nome;arq.parent.mkdir(parents=True,exist_ok=True);arq.write_text(conteudo)
        manifesto['arquivos'][nome]={'sha256':hashlib.sha256(conteudo.encode()).hexdigest()}
    (p/'manifest.json').write_text(json.dumps(manifesto))

class TestePreparacao(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.raiz=Path(self.tmp.name);self.data=self.raiz/'data';self.data.mkdir()
        self.antigo=self.data/'antigo';self.antigo.mkdir();self.novo=self.data/'novo';self.novo.mkdir()
        self.raiz_anterior,self.antigo_anterior=modulo.RAIZ,modulo.ANTIGO
        modulo.RAIZ,modulo.ANTIGO=self.raiz,self.antigo
        treino=caso('antigo.com.br','termo antigo','train');valid=caso('validacao.com.br','outro','valid')
        conversa={'messages':[{'role':'system','content':'x'},{'role':'user','content':json.dumps(treino['entrada'])}]}
        escreve_manifesto(self.antigo,{'casos-train.jsonl':j(treino),'casos-valid.jsonl':j(valid),
          'desenvolvimento/train.jsonl':j(conversa),'desenvolvimento/valid.jsonl':j(conversa)})
    def tearDown(self):
        modulo.RAIZ,modulo.ANTIGO=self.raiz_anterior,self.antigo_anterior;self.tmp.cleanup()
    def test_separa_e_nao_precisa_do_teste(self):
        escreve_manifesto(self.novo,{'casos-train.jsonl':j(caso('treino.com.br','busca treino','train')),
          'casos-valid.jsonl':j(caso('novo.com.br','busca reservada','valid'))})
        m=modulo.preparar(self.novo,self.data/'resultado')
        self.assertEqual(m['casos_serp_treino'],1);self.assertEqual(m['casos_serp_validacao'],1)
        self.assertEqual(m['treino_mensagens'],9)
        self.assertFalse((self.data/'resultado'/'casos-test.jsonl').exists())
    def test_recusa_consulta_de_validacao_ja_vista(self):
        escreve_manifesto(self.novo,{'casos-train.jsonl':j(caso('treino.com.br','busca treino','train')),
          'casos-valid.jsonl':j(caso('novo.com.br','TERMO ANTIGO','valid'))})
        with self.assertRaisesRegex(ValueError,'Validação real insuficiente'):
            modulo.preparar(self.novo,self.data/'resultado')
    def test_teste_reservado_recusa_consulta_do_desenvolvimento(self):
        with self.assertRaisesRegex(ValueError,'cruza domínio ou busca'):
            verificar_reserva([caso('teste.com.br','TERMO ANTIGO','test')],self.antigo)
        verificar_reserva([caso('teste.com.br','consulta desconhecida','test')],self.antigo)

class TesteAvaliacao(unittest.TestCase):
    def test_distingue_escolha_da_ia_da_regra(self):
        entrada={'site':'cliente.com.br','objetivo':'Qual a próxima melhoria?',
          'dados_negocio':{},'evidencias':[{'id':'s1','tipo':'serp','termo':'produto fictício',
            'pagina':'https://cliente.com.br/','atual':True,'posicao':2,'observado_em':'2026-11-15T11:59:59Z',
            'fontes_serp':[{'id':'fonte_ficticia_1','sha256':'a'*64,'observado_em':'2026-11-15T11:59:59Z'}],
            'concorrentes':[{'pagina':'https://outro.com.br/','posicao':1}]}]}
        c={'id':'caso','grupo':'cliente','tipo':'concorrentes','entrada':entrada,
          'esperado':{'acao':'comparar_concorrentes','evidencias':['s1']},
          'fonte':{'reproducao_em':'2026-11-15T12:00:00Z'}}
        r=avaliar(c,None,None,gerador=lambda *_:('',{'acao':'acompanhar','evidencias':['s1']}))
        self.assertFalse(r['ia']['concorda']);self.assertTrue(r['hibrido']['concorda'])
        self.assertEqual(r['hibrido']['origem'],'regra')
    def test_selecao_nao_premia_melhora_de_regra_com_ia_pior(self):
        def par(ia,hibrido,criticas=0):
            total={'casos':8,'consultas_unicas':4,'concorda_ia':ia,'concorda_hibrido':hibrido,
              'criticas_ia':criticas,'criticas_hibrido':0,'recusas_ia':0,'recusas_hibrido':0}
            anterior={'criticas_antes':0,'criticas_exibidas':0,'recusas':0,'concordancias_aceitas':8}
            return {'serp':{'metricas':{'total':total}},'real':{'metricas':{'total':anterior}},
              'sintetico':{'metricas':{'total':anterior}}}
        base=par(5,8)
        self.assertFalse(elegivel(base,par(4,8)))
        self.assertFalse(elegivel(base,par(6,8,1)))
        self.assertTrue(elegivel(base,par(6,8)))

if __name__=='__main__':unittest.main()
