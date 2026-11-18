import json
import os
from pathlib import Path
import stat
import tempfile
import unittest

from negocio.derivar_modelo35 import PREFIXO, derivar_modelo35, sha256, verificar_origem


class TokenizerSimulado:
    """Unit-test stand-in only; real BPE is checked separately on local files."""
    def __init__(self, pasta):
        self.pasta = pasta
        arquivo = pasta / "chat_template.jinja"
        if arquivo.exists():
            texto = arquivo.read_text()
        else:
            texto = json.loads((pasta / "tokenizer_config.json").read_text())["chat_template"]
        self.forcado = texto.startswith(PREFIXO)

    def apply_chat_template(self, ms, tokenize=True, add_generation_prompt=False,
                            enable_thinking=True, return_dict=False):
        texto = "".join("<" + m["role"] + ">" + m["content"] + "</turno>"
                        for m in ms if m["role"] != "assistant")
        cabecalho = "<assistant><think>\n"
        if ms[-1]["role"] == "assistant":
            texto += cabecalho + "\n</think>\n\n" + ms[-1]["content"] + "</turno>"
        elif add_generation_prompt:
            texto += cabecalho + ("\n</think>\n\n" if self.forcado or not enable_thinking else "")
        return [ord(c) for c in texto] if tokenize else texto

    def decode(self, ids, skip_special_tokens=False):
        return "".join(chr(c) for c in ids)


class DerivarModelo35Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.origem = self.base / "origem"
        self.origem.mkdir()
        (self.origem / "licenca-base").mkdir()
        conteudos = {"model.safetensors": b"pesos-ficticios-do-teste",
                     "config.json": b'{"model_type":"qwen3_5"}',
                     "chat_template.jinja": b"template original simulado",
                     "tokenizer_config.json": b'{"tokenizer_class":"simulado"}',
                     "licenca-base/LICENSE": b"Apache License Version 2.0"}
        for nome, conteudo in conteudos.items():
            (self.origem / nome).write_bytes(conteudo)
        self._recibo()

    def tearDown(self):
        self.tmp.cleanup()

    def _recibo(self):
        arquivos = {str(p.relative_to(self.origem)): sha256(p)
                    for p in self.origem.rglob("*") if p.is_file() and p.name != "proveniencia-local.json"}
        self.meta = {"modelo": "mlx-community/Qwen3.5-4B-teste", "revisao": "a" * 40,
                     "modeloBase": "Qwen/Qwen3.5-4B", "licenca": "apache-2.0", "arquivos": arquivos}
        self._salvar_meta()

    def _salvar_meta(self):
        (self.origem / "proveniencia-local.json").write_text(json.dumps(self.meta))

    def _derivar(self, **kwargs):
        return derivar_modelo35(self.origem, self.base / "derivado",
                                tokenizer_factory=TokenizerSimulado, **kwargs)

    def test_deriva_copias_do_template_e_preserva_pesos_modo_hash_e_recibo(self):
        peso = self.origem / "model.safetensors"
        peso.chmod(0o640)
        antes = {str(p.relative_to(self.origem)): (sha256(p), stat.S_IMODE(p.stat().st_mode), p.stat().st_mtime_ns)
                 for p in self.origem.rglob("*") if p.is_file()}
        recibo = self._derivar()
        saida = self.base / "derivado"
        self.assertEqual((saida / "chat_template.jinja").read_text(), PREFIXO + "template original simulado")
        self.assertNotEqual((saida / "chat_template.jinja").stat().st_ino,
                            (self.origem / "chat_template.jinja").stat().st_ino)
        self.assertEqual((saida / "model.safetensors").stat().st_ino, peso.stat().st_ino)
        self.assertEqual((saida / "proveniencia-origem.json").read_bytes(),
                         (self.origem / "proveniencia-local.json").read_bytes())
        self.assertTrue(recibo["originaisPreservados"])
        self.assertFalse(recibo["pesosCarregados"])
        self.assertFalse(recibo["GPUUsada"])
        self.assertTrue(recibo["validacaoSimulada"])
        for nome, estado in antes.items():
            p = self.origem / nome
            self.assertEqual((sha256(p), stat.S_IMODE(p.stat().st_mode), p.stat().st_mtime_ns), estado)
        for nome, digest in recibo["arquivos"].items():
            self.assertEqual(sha256(saida / nome), digest)

    def test_copiar_pesos_cria_inode_distinto(self):
        self._derivar(copiar_pesos=True)
        self.assertNotEqual((self.base / "derivado/model.safetensors").stat().st_ino,
                            (self.origem / "model.safetensors").stat().st_ino)

    def test_saida_existente_e_preservada(self):
        p = self.base / "derivado"
        p.mkdir()
        (p / "trabalho.txt").write_text("preservar")
        with self.assertRaisesRegex(ValueError, "saída nova"):
            self._derivar()
        self.assertEqual((p / "trabalho.txt").read_text(), "preservar")

    def test_recusa_origem_sem_recibo_ou_hash_divergente(self):
        (self.origem / "model.safetensors").write_bytes(b"alterado")
        with self.assertRaisesRegex(ValueError, "diverge"):
            self._derivar()
        self.assertFalse((self.base / "derivado").exists())
        (self.origem / "proveniencia-local.json").unlink()
        with self.assertRaisesRegex(ValueError, "recibo"):
            self._derivar()

    def test_recusa_travessia_e_arquivo_nao_declarado(self):
        self.meta["arquivos"]["../fora.json"] = "a" * 64
        self._salvar_meta()
        with self.assertRaisesRegex(ValueError, "fora da origem"):
            self._derivar()
        del self.meta["arquivos"]["../fora.json"]
        self._salvar_meta()
        (self.origem / "extra.jinja").write_text("não declarado")
        with self.assertRaisesRegex(ValueError, "fora do recibo"):
            self._derivar()

    def test_recusa_licenca_ou_arquitetura_diferente(self):
        self.meta["licenca"] = "outra"
        self._salvar_meta()
        with self.assertRaisesRegex(ValueError, "Apache"):
            self._derivar()
        (self.origem / "config.json").write_text('{"model_type":"outro"}')
        self._recibo()
        with self.assertRaisesRegex(ValueError, "Arquitetura"):
            self._derivar()

    def test_prefixa_config_embutida_e_templates_nomeados_sem_mudar_outros_campos(self):
        config = {"outro": "preservar", "chat_template": [{"name": "default", "template": "template A"},
                                                           {"name": "tool_use", "template": "template B"}]}
        (self.origem / "tokenizer_config.json").write_text(json.dumps(config))
        (self.origem / "chat_templates").mkdir()
        (self.origem / "chat_templates/tool_use.jinja").write_text("template de ferramentas")
        self._recibo()
        recibo = self._derivar()
        resultado = json.loads((self.base / "derivado/tokenizer_config.json").read_text())
        self.assertEqual(resultado["outro"], "preservar")
        self.assertTrue(all(t["template"].startswith(PREFIXO) for t in resultado["chat_template"]))
        self.assertTrue((self.base / "derivado/chat_templates/tool_use.jinja").read_text().startswith(PREFIXO))
        self.assertEqual(len(recibo["transformacao"]["arquivos"]), 3)

    def test_template_embutido_sem_jinja_tambem_pode_ser_derivado(self):
        (self.origem / "chat_template.jinja").unlink()
        (self.origem / "tokenizer_config.json").write_text('{"chat_template":"template embutido"}')
        self._recibo()
        recibo = self._derivar()
        self.assertEqual(recibo["transformacao"]["arquivos"][0]["arquivo"], "tokenizer_config.json")

    def test_fronteira_de_token_incompativel_nao_publica_saida_parcial(self):
        class TokenizerFronteiraInvalida(TokenizerSimulado):
            def apply_chat_template(self, ms, **kwargs):
                resultado = super().apply_chat_template(ms, **kwargs)
                if self.forcado and kwargs.get("tokenize", True) and kwargs.get("add_generation_prompt"):
                    return resultado + [1000000]
                return resultado
        with self.assertRaisesRegex(ValueError, "prefixo em IDs"):
            derivar_modelo35(self.origem, self.base / "derivado", tokenizer_factory=TokenizerFronteiraInvalida)
        self.assertFalse((self.base / "derivado").exists())
        self.assertFalse(list(self.base.glob(".derivado-*")))

    def test_mudanca_externa_da_origem_durante_validacao_e_detectada(self):
        n = [0]
        def factory(pasta):
            n[0] += 1
            if n[0] == 2:
                (self.origem / "model.safetensors").write_bytes(b"mudanca externa simulada")
            return TokenizerSimulado(pasta)
        with self.assertRaisesRegex(ValueError, "Origem mudou"):
            derivar_modelo35(self.origem, self.base / "derivado", tokenizer_factory=factory)
        self.assertFalse((self.base / "derivado").exists())

    def test_ambiente_offline_e_restaurado(self):
        anterior = os.environ.get("HF_HUB_OFFLINE")
        os.environ["HF_HUB_OFFLINE"] = "valor-anterior-do-teste"
        try:
            self._derivar()
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "valor-anterior-do-teste")
        finally:
            if anterior is None:
                os.environ.pop("HF_HUB_OFFLINE", None)
            else:
                os.environ["HF_HUB_OFFLINE"] = anterior


if __name__ == "__main__":
    unittest.main()
