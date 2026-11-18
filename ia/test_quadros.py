import unittest
from copy import deepcopy
from negocio.quadros.dados import cena,rel,cond
from negocio.quadros.contrato import validar_saida,projetar
from negocio.quadros.protocolo import mensagens,esquema
from negocio.proposicoes.c7.dados import fonte
from negocio.proposicoes.unidades import segmentar

def entrada(texto,tarefa='relacao',titulo='Programa'):
    d=segmentar({'versao':1,'dominio':'example.com','fontes':[fonte(texto,titulo,'controle')]})
    return {'versao':1,'tarefa':tarefa,'documento':d,'unidade':d['unidades'][0]['id'],'oferta':{'nome':titulo,'natureza':'software','papel_site':'disponibiliza'}}

class Quadros(unittest.TestCase):
    def test_todos_alvos_controlados_sao_validos(self):
        for i in range(36):
            t,h,o,r,c=cena(i,'Controle')
            for tarefa,alvo in [('relacao',r),('condicao',c)]:
                e=entrada(t,tarefa,h);e['oferta']=o
                self.assertEqual(validar_saida(alvo,e),[],(i,tarefa))

    def test_nominal_preserva_responsabilidade_sem_verbo_fabricado(self):
        e=entrada('A instalação é responsabilidade do cliente.');r=rel('cliente',None,'A instalação','usuario','implementacao',nominal=True)
        self.assertEqual(validar_saida(r,e),[])
        r['acao']='instala';self.assertIn('verbo_inventado_para_responsabilidade_nominal',validar_saida(r,e))

    def test_objeto_em_imperativo_nao_vira_ator(self):
        e=entrada('Conecte as famílias com Agenda.');r=rel('Agenda','Conecte','as famílias','ferramenta','uso')
        self.assertIn('ator_nao_publicado_em_imperativo_ou_primeira_pessoa',validar_saida(r,e))

    def test_condicao_preserva_gatilho_modalidade_e_fonte_inteira(self):
        e=entrada('O plano Equipe começa em até 10 dias depois da aprovação, exceto em feriados.','condicao')
        c=cond('prazo','plano Equipe','unidade',gatilho='depois da aprovação',modalidade='plano Equipe',alcance='oferta')
        r=projetar(c,e);self.assertEqual(r['erros'],[]);self.assertEqual(r['unidadeLiteral']['texto'],e['documento']['unidades'][0]['texto']);self.assertFalse(r['perfilConfirmado'])

    def test_aplicacao_nao_empresta_outro_titulo_ou_gatilho(self):
        e=entrada('Até dois dias úteis após assinatura do contrato.','condicao','Cursos prontos')
        c=cond('prazo','LMS','titulo',gatilho='após assinatura do contrato',alcance='atividade')
        self.assertIn('aplicacao_fora_do_titulo',validar_saida(c,e));c['aplicaA']='Cursos prontos';c['gatilho']='após confirmação do pagamento';self.assertIn('gatilho_nao_literal',validar_saida(c,e))

    def test_sem_relacao_nao_carrega_papeis_e_negacao_nao_e_inventada(self):
        e=entrada('A equipe registra os pedidos.');r=rel();r['tipoAtor']='fornecedor';self.assertTrue(validar_saida(r,e))
        r=rel('A equipe','registra','os pedidos','usuario','uso',negada=True);self.assertIn('negacao_sem_apoio',validar_saida(r,e))

    def test_fonte_offsets_e_entrada_nao_sao_alterados(self):
        e=entrada('A instalação é responsabilidade do cliente.');antes=deepcopy(e);projetar(rel('cliente',None,'A instalação','usuario','implementacao',nominal=True),e);mensagens(e);esquema(e);self.assertEqual(e,antes)
        e['documento']['unidades'][0]['texto']='Frase alterada.'
        with self.assertRaises(ValueError):mensagens(e)

    def test_tarefas_nao_pedem_relacoes_e_condicoes_no_mesmo_alvo(self):
        e=entrada('A instalação é responsabilidade do cliente.');a=mensagens(e);e['tarefa']='condicao';b=mensagens(e);self.assertNotEqual(a,b);self.assertNotIn('estrutura',esquema(e)['properties'])

if __name__=='__main__':unittest.main()
