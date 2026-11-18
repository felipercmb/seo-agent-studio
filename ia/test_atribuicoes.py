import json
import unittest
from copy import deepcopy
from negocio.quadros.dados import rel,cond
from negocio.proposicoes.c7.dados import fonte
from negocio.proposicoes.unidades import segmentar
from negocio.atribuicoes.dados import nova_cena
from negocio.atribuicoes.contrato import validar_saida,projetar
from negocio.atribuicoes.protocolo import mensagens
from negocio.ensaios_pesos import valores_json

def entrada(texto,tarefa='relacao',idx=0):
    d=segmentar({'versao':1,'dominio':'example.com','fontes':[fonte(texto,'Controle','controle')]})
    return {'versao':1,'tarefa':tarefa,'documento':d,'unidade':d['unidades'][idx]['id'],'oferta':{'nome':'Controle','natureza':'software','papel_site':'disponibiliza'}}

class Atribuicoes(unittest.TestCase):
    def test_quarenta_alvos_novos(self):
        for i in range(20):
            t,h,o,idx,r,c=nova_cena(i,'Controle');e=entrada(t,idx=idx);e['oferta']=o
            self.assertEqual(validar_saida(r,e),[],i);e['tarefa']='condicao';self.assertEqual(validar_saida(c,e),[],i)

    def test_atribuicao_nao_fabrica_acao_ou_dever_juridico(self):
        e=entrada('A decisão e a execução continuam sempre do cliente.');r={'estrutura':'atribuicao_nominal','ator':'cliente','acao':None,'objeto':'A decisão e a execução','tipoAtor':'usuario','escopo':'uso','negada':False,'marcadorNominal':'continuam sempre do'}
        self.assertEqual(validar_saida(r,e),[]);p=projetar(r,e);self.assertEqual(p['quadro']['acao'],None);self.assertIn('não estabelece responsabilidade jurídica',p['limite']);self.assertFalse(p['perfilConfirmado'])
        r['estrutura']='responsabilidade_nominal';self.assertIn('responsabilidade_sem_marcador',validar_saida(r,e))

    def test_acao_para_nominal_e_marcador_inventado_recusados(self):
        t,h,o,idx,r,c=nova_cena(0,'Controle');e=entrada(t);r['acao']='executa';self.assertIn('acao_verbal_inventada_para_atribuicao_nominal',validar_saida(r,e));r['acao']=None;r['marcadorNominal']='é responsabilidade';self.assertIn('marcador_nominal_nao_literal',validar_saida(r,e))

    def test_instrucao_com_recurso_no_prefixo_nao_publica_ator(self):
        e=entrada('API para automações Conecte a Plataforma aos fluxos.');r={**rel('API','Conecte','a Plataforma','ferramenta','uso'),'marcadorNominal':None};self.assertIn('instrucao_nao_publica_ator_operacional',validar_saida(r,e))

    def test_duracao_nao_e_gatilho_e_frase_nao_e_objeto(self):
        e=entrada('A implantação ocorre em até 45 dias úteis.','condicao');c={**cond('prazo','implantação','unidade',gatilho='até 45 dias úteis',alcance='atividade'),'negacaoLiteral':None};self.assertIn('duracao_nao_e_gatilho',validar_saida(c,e));c['gatilho']=None;c['aplicaA']=e['documento']['unidades'][0]['texto'];self.assertIn('frase_inteira_nao_e_objeto_da_condicao',validar_saida(c,e))

    def test_contexto_integral_preservado_sem_alargar_campos_da_unidade(self):
        e=entrada('A conta é necessária para envio. O destinatário não precisa de conta para assinar.','condicao',1);antes=deepcopy(e);ms=mensagens(e);d=json.loads(ms[-1]['content']);self.assertIn('necessária para envio',d['fonteContinua']);self.assertNotIn('necessária para envio',d['unidadeAlvo'])
        c={**cond('elegibilidade','assinar','unidade',alcance='atividade'),'negacaoLiteral':'não precisa de conta'};self.assertEqual(validar_saida(c,e),[]);self.assertEqual(e,antes);c['negacaoLiteral']='necessária para envio';self.assertIn('negacao_condicao_nao_literal',validar_saida(c,e))

    def test_origem_fonte_exige_expressao_presente_sem_inventar_oferta(self):
        e=entrada('O envio de documentos é uma atividade. Somente o remetente precisa de conta.','condicao',1);c={**cond('elegibilidade','envio de documentos','fonte',alcance='atividade'),'negacaoLiteral':None};self.assertEqual(validar_saida(c,e),[]);c['aplicaA']='assinatura do documento';self.assertIn('aplicacao_fora_da_fonte',validar_saida(c,e))

    def test_json_dentro_de_string_nao_vira_campo_de_ponderacao(self):
        s=json.dumps({'ator':'texto com "categoria":"prazo" dentro','estrutura':'verbal','negada':False,'acao':None},ensure_ascii=False,separators=(',',':'));r=valores_json(s);self.assertEqual([x[0] for x in r],['ator','estrutura','negada','acao']);self.assertEqual([json.loads(s[a:b]) for _,_,a,b in r],['texto com "categoria":"prazo" dentro','verbal',False,None])
        with self.assertRaises(ValueError):valores_json('{"ator":"a","ator":"b"}')

if __name__=='__main__':unittest.main()
