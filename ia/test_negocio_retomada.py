import json
from pathlib import Path
import tempfile
import unittest

from negocio.treinar import conferir_retomada
from runtime import sha256


class RetomadaNegocioTests(unittest.TestCase):
    def preparar(self,pasta,grupos):
        dados=pasta/"dados";dados.mkdir()
        m=dados/"manifest.json";m.write_text(json.dumps({"grupos":grupos}))
        treino=pasta/"modelo";treino.mkdir()
        a=treino/"adapters.safetensors";a.write_bytes(b"fixture-not-model-weights")
        (treino/"treino.json").write_text(json.dumps({"estado":"concluido","modeloBase":"qwen3-4b",
            "adaptadorSha256":sha256(a),"config":{"data":str(dados)},"dadosManifestoSha256":sha256(m)}))
        return a

    def test_nao_reclassifica_empresa_treinada_como_validacao(self):
        with tempfile.TemporaryDirectory() as d:
            a=self.preparar(Path(d),{"empresa-a":"train","empresa-b":"validation"})
            with self.assertRaisesRegex(ValueError,"já treinados"):
                conferir_retomada(a,{"grupos":{"empresa-a":"validation","empresa-b":"train"}},"qwen3-4b")

    def test_ampliacao_sem_vazamento_registra_historico(self):
        with tempfile.TemporaryDirectory() as d:
            a=self.preparar(Path(d),{"empresa-a":"train","empresa-b":"validation"})
            r=conferir_retomada(a,{"grupos":{"empresa-a":"train","empresa-b":"validation","empresa-c":"train"}},"qwen3-4b")
            self.assertEqual(r["gruposJaTreinados"],["empresa-a"])

    def test_pesos_e_base_tem_que_corresponder_ao_recibo(self):
        with tempfile.TemporaryDirectory() as d:
            a=self.preparar(Path(d),{"a":"train"})
            with self.assertRaisesRegex(ValueError,"mesma base"):
                conferir_retomada(a,{"grupos":{"a":"train"}},"qwen25-15b")
            a.write_bytes(b"different-weights")
            with self.assertRaisesRegex(ValueError,"recibo"):
                conferir_retomada(a,{"grupos":{"a":"train"}},"qwen3-4b")

    def test_manifesto_transportado_preserva_hash_e_protecao_por_empresa(self):
        with tempfile.TemporaryDirectory() as d:
            pasta=Path(d)
            a=self.preparar(pasta,{"empresa-a":"train","empresa-b":"validation"})
            antigo=pasta/"dados"/"manifest.json"
            movido=pasta/"manifesto-transportado.json"
            antigo.rename(movido)
            r=conferir_retomada(a,{"grupos":{"empresa-a":"train","empresa-b":"validation"}},"qwen3-4b",movido)
            self.assertTrue(r["manifestoAnterior"]["caminhoAlternativoExplicito"])
            with self.assertRaisesRegex(ValueError,"já treinados"):
                conferir_retomada(a,{"grupos":{"empresa-a":"validation","empresa-b":"train"}},"qwen3-4b",movido)
            movido.write_text(json.dumps({"grupos":{"empresa-a":"validation","empresa-b":"train"}}))
            with self.assertRaisesRegex(ValueError,"alterado"):
                conferir_retomada(a,{"grupos":{"empresa-a":"validation","empresa-b":"train"}},"qwen3-4b",movido)


if __name__=="__main__":unittest.main()
