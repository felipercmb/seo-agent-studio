"""Controles CPU da ponderação, da máscara e da semântica da permutação."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
from negocio.proposicoes.c7.dados import gerar_controlados
from negocio.proposicoes.c8.augmentacao import permutar
from negocio.proposicoes.c8.ponderacao import indexar,empacotar,perda_ponderada


class C8(unittest.TestCase):
    def test_permutacao_preserva_fatos_alvos_e_spans(self):
        r=next(x for x in gerar_controlados() if x['id']=='c7-f00-e00-pt-proposicoes');n=permutar(r);mp=n['derivacaoC8']['mapaIds']
        self.assertEqual(r['documento']['fontes'],n['documento']['fontes'])
        for uid,v in r['alvo']['proposicoesPorUnidade'].items():self.assertEqual(v,n['alvo']['proposicoesPorUnidade'][mp[uid]])
        self.assertTrue(all(int(x[1:])>=100 for x in n['documento']['unidadesAlvo']))
        self.assertEqual(permutar(r),n)

    def test_ponderacao_nao_trunca_ou_desloca_mascara(self):
        x={'ids':[10,11,12,13],'offset':2,'pesos':[1,1,8,1]};t=indexar({'linhas':[x]})
        self.assertEqual(empacotar([[10,11,12,13,0]],[[2,4]],t),[[2,4,1,8,1,1]])
        with self.assertRaises(ValueError):empacotar([[10,11,12]],[[2,3]],t)
        with self.assertRaises(ValueError):empacotar([[10,11,12,13]],[[1,4]],t)

    def test_ce_bloco_com_pesos1_equivale_valor_e_gradiente_originais(self):
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

        # In a mixed batch, the first padding index equals the true length.
        # Verify the real last target is retained on both rows and that padding
        # changes neither the weighted loss nor the gradient with checkpointing.
        lotes = [mx.array([[1, 2, 3, 4, 5, pad], [6, 7, 8, pad, pad, pad]])
                 for pad in (0, 9)]
        comprimentos = mx.array([[2, 5, 1, 8, 1, 1, 8], [1, 3, 1, 1, 8, 8, 8]])

        def referencia(m):
            head = m.language_model.model.embed_tokens
            perdas = []
            for ids, pesos in (([1, 2, 3, 4, 5], [8., 1., 1.]), ([6, 7, 8], [1., 1.])):
                tokens = mx.array(ids)
                pesos = mx.array(pesos)
                logits = head.as_linear(head(tokens[:-1]))[-len(pesos):]
                perdas.append((nn.losses.cross_entropy(logits, tokens[-len(pesos):]) * pesos).sum())
            return sum(perdas) / 12

        valor_ref, grad_ref = nn.value_and_grad(model, referencia)(model)
        for lote in lotes:
            def perda(m):
                return perda_ponderada(m, lote, comprimentos, bloco=2)[0]

            valor, grad = nn.value_and_grad(model, perda)(model)
            _, alvos = perda_ponderada(model, lote, comprimentos, bloco=2)
            self.assertEqual(alvos.item(), 5)
            self.assertAlmostEqual(valor.item(), valor_ref.item(), places=6)
            for (chave_real, real), (chave_ref, ref) in zip(tree_flatten(grad), tree_flatten(grad_ref)):
                self.assertEqual(chave_real, chave_ref)
                self.assertLess(mx.max(mx.abs(real - ref)).item(), 1e-6)

if __name__=='__main__':unittest.main()
