import json,unittest
from copy import deepcopy
from classificar_papeis_local import preparar,estado_conferencia,combinar_atribuicao
from test_papeis import entrada

def raw(xs):return json.dumps({'versao':1,'quadros':xs},ensure_ascii=False).encode()
class PrepararPapeis(unittest.TestCase):
    def test_legacy_classification_is_separate_from_model_input(self):
        e=entrada();r=preparar(raw([{'id':'caso01','entrada':e,'classificacaoAnterior':{'tipoAtor':'fornecedor','escopo':'implementacao'}}]));self.assertEqual(r[0]['estado'],'pronta_para_conferencia');self.assertEqual(r[0]['entrada'],e);self.assertNotIn('tipoAtor',r[0]['entrada']['quadroProposto']);self.assertEqual(r[0]['classificacaoAnterior']['tipoAtor'],'fornecedor')
    def test_bad_literal_does_not_remove_the_other_valid_case(self):
        a=entrada();b=deepcopy(a);b['quadroProposto']['ator']='Ator não publicado';r=preparar(raw([{'id':'bom','entrada':a},{'id':'ruim','entrada':b}]));self.assertEqual([x['estado'] for x in r],['pronta_para_conferencia','recusada_entrada'])
    def test_expected_labels_and_duplicate_ids_are_rejected(self):
        for xs in [[{'id':'a','entrada':entrada(),'alvo':{}}],[{'id':'a','entrada':entrada()},{'id':'a','entrada':entrada()}]]:
            with self.assertRaises(ValueError):preparar(raw(xs))
    def test_bound_is_explicit_without_silent_truncation(self):
        with self.assertRaises(ValueError):preparar(raw([{'id':'x'+str(i),'entrada':entrada()} for i in range(33)]))
    def test_failed_or_missing_generation_does_not_look_like_a_classification(self):
        for state in ['json_recusado','orcamento_excedido']:
            self.assertEqual(estado_conferencia({'estado':state,'saida':None}),state)
        self.assertEqual(estado_conferencia({'estado':'gerada','saida':{},'validacao':{'estado':'recusada'}}),'recusada_contrato')
    def test_positive_and_abstention_remain_model_proposals(self):
        self.assertEqual(estado_conferencia({'estado':'gerada','saida':{'estrutura':'sem_relacao'}}),'sem_relacao_proposta');self.assertEqual(estado_conferencia({'estado':'gerada','saida':{'estrutura':'relacao_publicada'}}),'classificacao_proposta')
    def test_documented_batch_can_exceed_single_model_response_json_limit(self):
        b=raw([{'id':'caso'+str(i),'entrada':entrada()} for i in range(32)]);self.assertGreater(len(b),16000);self.assertEqual(len(preparar(b)),32)
    def test_duplicate_keys_and_nonfinite_metadata_are_not_accepted(self):
        with self.assertRaisesRegex(ValueError,'duplicada'):preparar(b'{"versao":1,"versao":1,"quadros":[]}')
        with self.assertRaisesRegex(ValueError,'não finita'):preparar(raw([{'id':'a','entrada':entrada(),'classificacaoAnterior':{'dado':float('nan')}}]))
    def test_combination_keeps_original_and_only_changes_proposed_role_fields(self):
        e=entrada();p={**e.pop('quadroProposto'),'tipoAtor':'fornecedor','escopo':'implementacao','negada':False};before=deepcopy(p);c={'estrutura':'relacao_publicada','tipoAtor':'usuario','escopo':'uso','negada':False};r=combinar_atribuicao(e,p,c);self.assertEqual(r['quadroOriginal'],before);self.assertEqual(p,before);self.assertEqual(r['quadro']['ator'],p['ator']);self.assertEqual(r['quadro']['tipoAtor'],'usuario');self.assertEqual(r['revisaoSemantica'],'pendente')
    def test_missing_classification_or_invalid_extraction_never_becomes_an_abstention(self):
        e=entrada();p={**e.pop('quadroProposto'),'tipoAtor':'usuario','escopo':'uso','negada':False};self.assertEqual(combinar_atribuicao(e,p)['estado'],'classificacao_ausente');bad={**p,'ator':'Ator não publicado'};r=combinar_atribuicao(e,bad,{'estrutura':'sem_relacao','tipoAtor':'indefinido','escopo':'indefinido','negada':False});self.assertEqual(r['estado'],'extracao_recusada');self.assertIsNone(r['quadro'])
    def test_only_explicit_classifier_abstention_yields_an_empty_final_frame(self):
        e=entrada();p={**e.pop('quadroProposto'),'tipoAtor':'usuario','escopo':'uso','negada':False};c={'estrutura':'sem_relacao','tipoAtor':'indefinido','escopo':'indefinido','negada':False};r=combinar_atribuicao(e,p,c);self.assertEqual(r['quadro']['estrutura'],'sem_relacao');self.assertEqual(r['quadroOriginal'],p);self.assertFalse(r['perfilConfirmado'])

if __name__=='__main__':unittest.main()
