"""C9: provas CPU das fronteiras contrafactuais e da loss preservada."""
import importlib.util
import itertools
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
IA=Path(__file__).resolve().parent;sys.path.insert(0,str(IA))
from negocio.proposicoes.c9.ponderacao import preparar_pesos,perda_ponderada


class C9(unittest.TestCase):
    def test_todas_classes_em_todos_slots_usam_fork_lcp_e_preservam_tokens(self):
        if importlib.util.find_spec('transformers') is None:
            self.skipTest('Transformers ausente; prova de tokenização exige ambiente local.')
        from transformers import AutoTokenizer
        from negocio.modelos import REGISTRO
        pasta = REGISTRO['qwen35-4b']['pasta']
        if not all((pasta / nome).is_file() for nome in ('tokenizer.json', 'tokenizer_config.json')):
            self.skipTest('Tokenizer ausente; auditoria opcional de tokenização local.')
        tok=AutoTokenizer.from_pretrained(str(pasta),local_files_only=True,trust_remote_code=False)
        objeto={'sujeito':'A equipe','tipoSujeito':'fornecedor','acao':'presta','objeto':'consultoria','escopo':'prestacao_da_oferta'}
        records=[]
        for i,bits in enumerate(itertools.product((False,True),repeat=3)):
            alvo={'proposicoesPorUnidade':{u:(objeto if b else None) for u,b in zip(('u128','u003','u997'),bits)},'condicoes':[],'incertezas':[]}
            ms=[{'role':'user','content':'Prova estrutural CPU.'},{'role':'assistant','content':json.dumps(alvo,ensure_ascii=False,separators=(',',':'))}]
            records.append({'messages':ms,'metadados':{'tarefaId':str(i)}})
        tabela=preparar_pesos({'treino':records},tok);classes=[];ultimos=[]
        for row,record in zip(tabela['linhas'],records):
            self.assertEqual(row['ids'],tok.apply_chat_template(record['messages'],tokenize=True,return_dict=False))
            self.assertTrue(all(w==1 for w in row['pesos'][:row['offset']]))
            self.assertEqual(len(row['decisoes']),3)
            for d in row['decisoes']:
                i=d['indiceToken'];old=d['indiceTokenIntersecaoValorC8'];classes.append(d['classe'])
                self.assertGreaterEqual(i,row['offset']);self.assertEqual(row['pesos'][i],8)
                self.assertNotEqual(d['token'],d['tokenAlternativo'])
                self.assertTrue(d['contrafactualNuncaUsadoComoAlvo'])
                if d['classe']=='null':
                    self.assertEqual(tok.decode([row['ids'][i]]),'\":');self.assertEqual(tok.decode([row['ids'][old]]),'null');self.assertEqual(row['pesos'][old],1)
                else:self.assertEqual(i,old)
            ultimos.append(row['decisoes'][-1]['classe'])
        self.assertEqual(classes.count('null'),12);self.assertEqual(classes.count('proposicao'),12)
        self.assertEqual(ultimos.count('null'),4);self.assertEqual(ultimos.count('proposicao'),4)

    def test_loss_c9_preserva_gradiente_mascara_e_peso8(self):
        if importlib.util.find_spec('mlx') is None:
            self.skipTest('MLX não instalado neste Python; paridade numérica exige o ambiente MLX local.')
        import mlx.core as mx
        import mlx.nn as nn
        from mlx.utils import tree_flatten
        from negocio.treino_memoria.perda_em_blocos import perda_qwen35_em_blocos
        mx.set_default_device(mx.cpu);mx.random.seed(7)
        class Corpo(nn.Module):
            def __init__(self):super().__init__();self.embed_tokens=nn.Embedding(16,4);self.pipeline_size=1
            def __call__(self,x):return self.embed_tokens(x)
        class LM(nn.Module):
            def __init__(self):super().__init__();self.model=Corpo();self.args=SimpleNamespace(tie_word_embeddings=True);self.sharding_group=None
        class Modelo(nn.Module):
            def __init__(self):super().__init__();self.language_model=LM()
        model=Modelo();batch=mx.array([[1,2,3,4,5]],dtype=mx.int32);ls=mx.array([[2,5]],dtype=mx.int32);ext=mx.array([[2,5,1,1,1,1]],dtype=mx.int32)
        a,ga=nn.value_and_grad(model,lambda m:perda_qwen35_em_blocos(m,batch,ls,bloco=2)[0])(model)
        b,gb=nn.value_and_grad(model,lambda m:perda_ponderada(m,batch,ext,bloco=2)[0])(model)
        self.assertAlmostEqual(a.item(),b.item(),places=6)
        for (ka,va),(kb,vb) in zip(tree_flatten(ga),tree_flatten(gb)):
            self.assertEqual(ka,kb);self.assertLess(mx.max(mx.abs(va-vb)).item(),1e-6)
        # Um peso8 no prompt não pode alterar a perda: a máscara original vence.
        prompt=mx.array([[2,5,8,1,1,1]],dtype=mx.int32)
        self.assertAlmostEqual(perda_ponderada(model,batch,prompt,bloco=2)[0].item(),b.item(),places=6)
        ponderado=mx.array([[2,5,1,8,1,1]],dtype=mx.int32)
        hidden=model.language_model.model(batch[:,:-1]);logits=model.language_model.model.embed_tokens.as_linear(hidden);ce=nn.losses.cross_entropy(logits,batch[:,1:]);mask=mx.array([[0.,1.,1.,1.]]);w=mx.array([[1.,8.,1.,1.]])
        esperado=(ce*mask*w).sum()/(mask*w).sum()
        self.assertAlmostEqual(perda_ponderada(model,batch,ponderado,bloco=2)[0].item(),esperado.item(),places=6)

if __name__=='__main__':unittest.main()
