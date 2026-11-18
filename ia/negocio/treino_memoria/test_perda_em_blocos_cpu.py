"""Equivalência CPU de perda/gradientes; não carrega pesos nem usa GPU."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import mlx.core as mx
mx.set_default_device(mx.cpu)
import mlx.nn as nn
from mlx.utils import tree_flatten
from mlx_lm.tuner.trainer import default_loss
from negocio.treino_memoria.perda_em_blocos import perda_qwen35_em_blocos


class Backbone(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed_tokens = nn.Embedding(37, 8)
        self.proj = nn.Linear(8, 8, bias=True)
        self.pipeline_size = 1

    def __call__(self, x):
        h = self.embed_tokens(x)
        # Contexto causal: gradientes dos alvos dependem também do prompt.
        h = mx.cumsum(h, axis=1) / mx.arange(1, x.shape[1] + 1)[None, :, None]
        return mx.tanh(self.proj(h))


class TextModel(nn.Module):
    def __init__(self, tied=False):
        super().__init__()
        self.model = Backbone()
        self.args = SimpleNamespace(tie_word_embeddings=tied)
        self.sharding_group = None
        if not tied:
            self.lm_head = nn.Linear(8, 37, bias=False)

    def __call__(self, inputs):
        h = self.model(inputs)
        return self.model.embed_tokens.as_linear(h) if self.args.tie_word_embeddings else self.lm_head(h)


class Model(nn.Module):
    def __init__(self, tied=False):
        super().__init__()
        self.language_model = TextModel(tied)

    def __call__(self, inputs):
        return self.language_model(inputs)


class PerdaEmBlocosCPUTests(unittest.TestCase):
    def setUp(self):
        mx.random.seed(1927)
        self.batch = mx.array([[1, 2, 3, 4, 5, 36, 0, 0, 0], [1, 7, 8, 9, 10, 11, 12, 36, 0]])
        self.lengths = mx.array([[3, 6], [5, 8]])

    def comparar(self, model, bloco, checkpoint=True, lengths=None, compiled=False):
        lens = self.lengths if lengths is None else lengths
        vg_referencia = nn.value_and_grad(model, default_loss)
        def alternativa(m, b, ls):
            return perda_qwen35_em_blocos(m, b, ls, bloco=bloco, checkpoint=checkpoint)
        vg_ensaio = nn.value_and_grad(model, alternativa)
        def referencia(b, ls):
            return vg_referencia(model, b, ls)
        def ensaio(b, ls):
            return vg_ensaio(model, b, ls)
        if compiled:
            referencia = mx.compile(referencia, inputs=model.state, outputs=model.state)
            ensaio = mx.compile(ensaio, inputs=model.state, outputs=model.state)
        (loss_a, n_a), grad_a = referencia(self.batch, lens)
        (loss_b, n_b), grad_b = ensaio(self.batch, lens)
        mx.eval(loss_a, loss_b, n_a, n_b, grad_a, grad_b)
        self.assertEqual(int(n_a.item()), int(n_b.item()))
        self.assertLess(abs(float(loss_a.item()) - float(loss_b.item())), 2e-6)
        flat_a, flat_b = dict(tree_flatten(grad_a)), dict(tree_flatten(grad_b))
        self.assertEqual(set(flat_a), set(flat_b))
        for chave in flat_a:
            delta = float(mx.max(mx.abs(flat_a[chave] - flat_b[chave])).item())
            self.assertLess(delta, 2e-6, chave)
        return referencia, ensaio

    def test_cabeca_separada_treinavel_multiplos_blocos(self):
        for bloco in (1, 2, 7, 128):
            with self.subTest(bloco=bloco):
                self.comparar(Model(), bloco)

    def test_embedding_compartilhado_gradiente_de_entrada_e_saida(self):
        for bloco in (2, 128):
            with self.subTest(bloco=bloco):
                self.comparar(Model(tied=True), bloco)

    def test_head_congelado_preserva_gradientes_backbone(self):
        model = Model()
        model.language_model.lm_head.freeze()
        self.comparar(model, 2)

    def test_head_quantizado_4bit_congelado_preserva_gradiente_da_camada_anterior(self):
        model = Model()
        model.language_model.model.embed_tokens = nn.Embedding(37, 32)
        model.language_model.model.embed_tokens.freeze()
        model.language_model.model.proj = nn.Linear(32, 32, bias=True)
        model.language_model.lm_head = nn.Linear(32, 37, bias=False).to_quantized(group_size=32, bits=4)
        model.language_model.lm_head.freeze()
        self.comparar(model, 2)

    def test_embedding_compartilhado_quantizado_4bit_como_config_qwen35_4b(self):
        model = Model(tied=True)
        model.language_model.model.embed_tokens = nn.Embedding(37, 32).to_quantized(group_size=32, bits=4)
        model.language_model.model.embed_tokens.freeze()
        model.language_model.model.proj = nn.Linear(32, 32, bias=True)
        self.comparar(model, 2, compiled=True)

    def test_sem_checkpoint_mesmo_objetivo(self):
        self.comparar(Model(), 2, checkpoint=False)

    def test_compile_recebe_lengths_variaveis_sem_item_ou_retracing_por_valor(self):
        model = Model(tied=True)
        referencia, ensaio = self.comparar(model, 2, compiled=True)
        novas = mx.array([[4, 5], [2, 7]])
        (a, n_a), grad_a = referencia(self.batch, novas)
        (b, n_b), grad_b = ensaio(self.batch, novas)
        mx.eval(a, b, grad_a, grad_b)
        self.assertEqual(int(n_a.item()), int(n_b.item()))
        self.assertLess(abs(float(a.item()) - float(b.item())), 2e-6)
        for (nome_a, ga), (nome_b, gb) in zip(tree_flatten(grad_a), tree_flatten(grad_b)):
            self.assertEqual(nome_a, nome_b)
            self.assertLess(float(mx.max(mx.abs(ga - gb)).item()), 2e-6)

    def test_mascara_legacy_inclui_eos_e_primeiro_padding_sem_mudanca_silenciosa(self):
        batch = mx.array([[1, 2, 3, 7, 36, 0, 0]])
        lengths = mx.array([[3, 5]])
        steps = mx.arange(1, batch.shape[1])
        mask = mx.logical_and(steps >= lengths[:, 0:1], steps <= lengths[:, 1:])
        alvos = batch[:, 1:].tolist()[0]
        ativos = mask.tolist()[0]
        self.assertEqual([t for t, ativo in zip(alvos, ativos) if ativo], [7, 36, 0])
        (_, n_a) = default_loss(Model(), batch, lengths)
        (_, n_b) = perda_qwen35_em_blocos(Model(), batch, lengths, bloco=2)
        self.assertEqual(int(n_a.item()), 3)
        self.assertEqual(int(n_b.item()), 3)

    def test_recusa_distribuicao_e_formas_incompativeis(self):
        model = Model()
        model.language_model.sharding_group = object()
        with self.assertRaisesRegex(ValueError, "sharding"):
            perda_qwen35_em_blocos(model, self.batch, self.lengths)
        model.language_model.sharding_group = None
        model.language_model.model.pipeline_size = 2
        with self.assertRaisesRegex(ValueError, "Pipeline"):
            perda_qwen35_em_blocos(model, self.batch, self.lengths)
        with self.assertRaisesRegex(ValueError, "Bloco"):
            perda_qwen35_em_blocos(Model(), self.batch, self.lengths, bloco=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--saida", type=Path)
    a = parser.parse_args()
    if a.saida and a.saida.exists():
        parser.error("Use uma saída nova para preservar o ensaio anterior.")
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PerdaEmBlocosCPUTests))
    if a.saida:
        helper = Path(__file__).with_name("perda_em_blocos.py")
        fonte_mlx = Path(sys.modules[default_loss.__module__].__file__)
        report = {"versao": 1, "executadoEm": datetime.now(timezone.utc).isoformat(), "device": str(mx.default_device()),
                  "testes": result.testsRun, "falhas": len(result.failures), "erros": len(result.errors), "sucesso": result.wasSuccessful(),
                  "helperSha256": hashlib.sha256(helper.read_bytes()).hexdigest(), "mlxTrainerSha256": hashlib.sha256(fonte_mlx.read_bytes()).hexdigest(),
                  "modeloCarregado": False, "GPUUsada": False, "toleranciaFloat32": 2e-6,
                  "limites": ["Toy causal CPU; não demonstra pico de memória ou velocidade em modelo/GPU reais.",
                              "Conserva a máscara legacy inclusive primeiro padding após EOS; mudança de objetivo não foi aplicada.",
                              "Mesmo objetivo matemático com ordem de soma diferente; igualdade bit a bit não é prometida.",
                              "Não instalado em mlx_lm nem ativado pelo runner de treino."]}
        a.saida.parent.mkdir(parents=True, exist_ok=True)
        with a.saida.open("x") as out:
            json.dump(report, out, ensure_ascii=False, indent=2)
            out.write("\n")
    sys.exit(0 if result.wasSuccessful() else 1)
