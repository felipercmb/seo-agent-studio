"""Regressões locais do callback posterior ao EOS, sem modelos ou GPU.

O consumidor pode chamar o logits_processor uma vez com o EOS já anexado,
antes de reconhecer a parada. Isso não é um novo símbolo da gramática JSON.
"""
import argparse
import ctypes
from datetime import datetime, timezone
import hashlib
import importlib.metadata as metadata
import json
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from negocio.contrato import validar_saida
from negocio.decodificacao.core_mlx import (
    ProcessadorSerial, _mapa_bytes, criar_processador_mlx, preparar_indice_json,
)
from negocio.esquema import esquema_para


class Decoder:
    def __getstate__(self):
        return b'{"type":"ByteLevel"}'


class Tokenizer:
    backend_tokenizer = type("Backend", (), {"decoder": Decoder()})()
    eos_token_id = 256
    all_special_ids = [256, 257]

    def get_vocab(self):
        return {**_mapa_bytes(), "<eos>": 256, "<think>": 257}


class Tokens:
    def __init__(self, valores):
        self.valores = valores
        self.shape = (len(valores),)

    def __len__(self):
        return len(self.valores)

    def __getitem__(self, i):
        return self.valores[i]


class Logits:
    def __init__(self, valores=None, tamanho=512):
        self.valores = valores if valores is not None else [[0.0] * tamanho]
        self.shape = (1, len(self.valores[0]))


def processador_nativo(preparado):
    from outlines_core import Guide

    def alocar(n):
        # Comece com todos os bits a 1 para detectar escrita incompleta.
        return (ctypes.c_uint32 * ((n + 31) // 32))(*([0xFFFFFFFF] * ((n + 31) // 32)))

    def preencher(guia, mascara):
        guia.write_mask_into(ctypes.addressof(mascara), len(mascara), ctypes.sizeof(ctypes.c_uint32))

    def aplicar(logits, mascara):
        return Logits([[v if (mascara[i // 32] >> (i % 32)) & 1 else -math.inf
                        for i, v in enumerate(logits.valores[0])]])

    return ProcessadorSerial(Guide(preparado.indice), preparado.eos,
                             preparado.max_token_id, alocar, preencher, aplicar)


def serial_nativo(entrada, saida):
    preparado = preparar_indice_json(esquema_para(entrada), Tokenizer())
    proc = processador_nativo(preparado)
    # O prompt contém um EOS autoral: ele deve ser ignorado na primeira chamada.
    ids = [256, 257]
    for byte in json.dumps(saida, ensure_ascii=False, separators=(",", ":")).encode():
        mascarado = proc(Tokens(ids), Logits()).valores[0]
        assert math.isfinite(mascarado[byte]), "Byte válido bloqueado: " + str(byte)
        ids.append(byte)
    terminal = proc(Tokens(ids), Logits()).valores[0]
    assert [i for i, v in enumerate(terminal) if math.isfinite(v)] == [256]
    return proc, ids


class EOSLookaheadCPUTests(unittest.TestCase):
    def test_core_final_anuncia_eos_mas_nao_o_avanca(self):
        from outlines_core import Guide
        entrada = {"tarefa": "entender", "campo": "papel", "fontes": []}
        preparado = preparar_indice_json(esquema_para(entrada), Tokenizer())
        guia = Guide(preparado.indice)
        bruto = b'{"estado":"insuficiente","valor":"indefinido","fontes":[],"faltam":["papel"]}'
        for byte in bruto:
            guia.advance(token_id=byte, return_tokens=False)
        self.assertTrue(guia.is_finished())
        self.assertEqual(guia.get_tokens(), [256])
        self.assertFalse(guia.accepts_tokens([256]))
        with self.assertRaises(ValueError):
            guia.advance(token_id=256, return_tokens=False)

    def test_callback_apos_eos_reaplica_mascara_sem_avancar_guide(self):
        entrada = {"tarefa": "entender", "campo": "papel", "fontes": []}
        saida = {"estado": "insuficiente", "valor": "indefinido", "fontes": [], "faltam": ["papel"]}
        self.assertEqual(validar_saida(saida, entrada), [])
        proc, ids = serial_nativo(entrada, saida)
        depois = proc(Tokens(ids + [256]), Logits()).valores[0]
        self.assertTrue(proc.guia.is_finished())
        self.assertEqual([i for i, v in enumerate(depois) if math.isfinite(v)], [256])

    def test_nao_eos_depois_do_json_completo_permanece_recusado(self):
        entrada = {"tarefa": "entender", "campo": "papel", "fontes": []}
        saida = {"estado": "insuficiente", "valor": "indefinido", "fontes": [], "faltam": ["papel"]}
        proc, ids = serial_nativo(entrada, saida)
        with self.assertRaisesRegex(ValueError, "não aceito"):
            proc(Tokens(ids + [ord("x")]), Logits())

    def test_eos_antes_do_json_terminar_permanece_recusado(self):
        entrada = {"tarefa": "entender", "campo": "papel", "fontes": []}
        proc = processador_nativo(preparar_indice_json(esquema_para(entrada), Tokenizer()))
        proc(Tokens([257]), Logits())
        with self.assertRaisesRegex(ValueError, "não aceito"):
            proc(Tokens([257, 256]), Logits())

    def test_contexto_repetido_apos_eos_nao_ativa_excecao_de_termino(self):
        entrada = {"tarefa": "entender", "campo": "papel", "fontes": []}
        saida = {"estado": "insuficiente", "valor": "indefinido", "fontes": [], "faltam": ["papel"]}
        proc, ids = serial_nativo(entrada, saida)
        eos = ids + [256]
        proc(Tokens(eos), Logits())
        with self.assertRaisesRegex(ValueError, "repetido"):
            proc(Tokens(eos), Logits())

    def test_v5_schema_anyof_literal_unicode_e_zwj_ate_lookahead(self):
        fonte = "A Oficina oferece ação\u200d local somente para associados."
        entrada = {"tarefa": "entender", "campo": "condicoes",
                   "fontes": [{"id": "f01", "texto": fonte, "tipo": "conteudo"}]}
        saida = {"estado": "hipotese", "valor": [{"texto": "somente para associados",
                 "escopo": "ação\u200d local", "fontes": ["f01"]}], "fontes": ["f01"], "faltam": []}
        self.assertEqual(validar_saida(saida, entrada), [])
        proc, ids = serial_nativo(entrada, saida)
        depois = proc(Tokens(ids + [256]), Logits()).valores[0]
        self.assertEqual([i for i, v in enumerate(depois) if math.isfinite(v)], [256])

    def test_mlx_device_cpu_mesmo_callback_unicode_sem_pesos(self):
        import mlx.core as mx
        mx.set_default_device(mx.cpu)
        entrada = {"tarefa": "entender", "campo": "ofertas", "fontes": [
            {"id": "f01", "texto": "A Oficina oferece ação\u200d local.", "tipo": "conteudo"}]}
        saida = {"estado": "hipotese", "valor": [{"texto": "ação\u200d local", "tipo": "servico", "fontes": ["f01"]}],
                 "fontes": ["f01"], "faltam": []}
        self.assertEqual(validar_saida(saida, entrada), [])
        preparado = preparar_indice_json(esquema_para(entrada), Tokenizer())
        proc = criar_processador_mlx(preparado)
        ids = [257]
        logits = mx.zeros((1, 512), dtype=mx.float32)
        for byte in json.dumps(saida, ensure_ascii=False, separators=(",", ":")).encode():
            masked = proc(mx.array(ids, dtype=mx.uint32), logits)
            self.assertTrue(bool(mx.isfinite(masked[0, byte]).item()))
            ids.append(byte)
        proc(mx.array(ids, dtype=mx.uint32), logits)
        masked = proc(mx.array(ids + [256], dtype=mx.uint32), logits)
        permitido = mx.isfinite(masked).tolist()[0]
        self.assertEqual([i for i, sim in enumerate(permitido) if sim], [256])
        self.assertEqual(str(mx.default_device()), "Device(cpu, 0)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--saida", type=Path)
    args = parser.parse_args()
    if args.saida and args.saida.exists():
        parser.error("A saída já existe; preserve o ensaio anterior.")
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(EOSLookaheadCPUTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if args.saida:
        helper = Path(__file__).with_name("core_mlx.py")
        report = {"versao": 1, "executadoEm": datetime.now(timezone.utc).isoformat(),
                  "testes": result.testsRun, "falhas": len(result.failures), "erros": len(result.errors),
                  "sucesso": result.wasSuccessful(), "core": metadata.version("outlines-core"),
                  "mlx": metadata.version("mlx"), "coreMlxSha256": hashlib.sha256(helper.read_bytes()).hexdigest(),
                  "testeSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  "modeloCarregado": False, "GPUUsada": False, "dados": "fontes autorais simuladas",
                  "limites": ["Teste de integração CPU; não mede modelo, utilidade U1–U4 ou fidelidade das recomendações.",
                              "Falhas de inferência anteriores ficam preservadas; este teste não as transforma em entregas aceitas."]}
        args.saida.parent.mkdir(parents=True, exist_ok=True)
        with args.saida.open("x") as out:
            json.dump(report, out, ensure_ascii=False, indent=2)
            out.write("\n")
    sys.exit(0 if result.wasSuccessful() else 1)
