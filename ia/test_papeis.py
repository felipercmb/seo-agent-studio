import json,unittest
from copy import deepcopy
from negocio.proposicoes.c7.dados import fonte
from negocio.proposicoes.unidades import segmentar
from negocio.papeis.contrato import conferir_entrada,validar_saida,projetar
from negocio.papeis.protocolo import mensagens

def entrada():
    text='A secretaria escolar envia as cobranças às famílias pelo sistema.';d=segmentar({'versao':1,'dominio':'example.com','fontes':[fonte(text,'Agenda','controle')]})
    return {'versao':1,'tarefa':'relacao','documento':d,'unidade':'u001','oferta':{'nome':'Agenda','natureza':'software','papel_site':'disponibiliza'},'quadroProposto':{'estrutura':'verbal','ator':'A secretaria escolar','acao':'envia','objeto':'as cobranças às famílias pelo sistema','marcadorNominal':None}}
ACTIVE={'estrutura':'relacao_publicada','tipoAtor':'usuario','escopo':'uso','negada':False}
EMPTY={'estrutura':'sem_relacao','tipoAtor':'indefinido','escopo':'indefinido','negada':False}

class Papeis(unittest.TestCase):
    def test_classification_preserves_given_spans_and_pending_review(self):
        e=entrada();before=deepcopy(e);r=projetar(ACTIVE,e);self.assertEqual(r['quadroClassificado']['ator'],e['quadroProposto']['ator']);self.assertEqual(r['quadroClassificado']['tipoAtor'],'usuario');self.assertEqual(r['revisaoSemantica'],'pendente');self.assertFalse(r['perfilConfirmado']);self.assertEqual(e,before)
    def test_structural_validation_does_not_certify_the_predicted_role(self):
        e=entrada();wrong={**ACTIVE,'tipoAtor':'fornecedor','escopo':'implementacao'};self.assertEqual(validar_saida(wrong,e),[]);self.assertEqual(projetar(wrong,e)['revisaoSemantica'],'pendente')
    def test_counterfactual_literal_frame_requires_semantic_classification(self):
        e=entrada();p=e['quadroProposto'];p['ator'],p['objeto']=p['objeto'],p['ator'];conferir_entrada(e);self.assertEqual(projetar(EMPTY,e)['quadroClassificado'],None)
    def test_unpublished_spans_and_other_task_are_rejected(self):
        e=entrada();e['quadroProposto']['ator']='Empresa não publicada'
        with self.assertRaisesRegex(ValueError,'ator literal'):conferir_entrada(e)
        e=entrada();e['tarefa']='condicao'
        with self.assertRaisesRegex(ValueError,'Entrada de papéis'):conferir_entrada(e)
    def test_no_role_labels_are_provided_in_the_proposed_frame(self):
        d=json.loads(mensagens(entrada())[-1]['content']);self.assertNotIn('tipoAtor',d['quadroProposto']);self.assertNotIn('escopo',d['quadroProposto']);self.assertNotIn('alvo',d);self.assertEqual(d['quadroProposto']['acao'],'envia')
    def test_abstention_cannot_keep_an_actor_role(self):
        self.assertEqual(validar_saida(EMPTY,entrada()),[]);self.assertIn('abstencao_com_papel_preenchido',validar_saida({**EMPTY,'tipoAtor':'usuario'},entrada()));self.assertIn('negacao_sem_apoio',validar_saida({**ACTIVE,'negada':True},entrada()))
    def test_crop_is_not_classified_as_complete_evidence(self):
        e=entrada();e['documento']['fontes'][0]['contexto']['recortado']=True
        with self.assertRaises(ValueError):conferir_entrada(e)

if __name__=='__main__':unittest.main()
