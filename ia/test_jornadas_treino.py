"""Integridade do preflight de jornadas, sem pesos ou GPU."""
from copy import deepcopy
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

IA = Path(__file__).resolve().parent
sys.path.insert(0, str(IA))

from negocio.jornadas.dados_controlados import gravar_corpus
from negocio.jornadas.treinar import conferir_corpus, criar_config, sha256, tokenizar


class TokenizerControlado:
    """Um template simples exercita o contrato do tokenizer, sem simular Qwen."""
    def apply_chat_template(self, mensagens, *, tokenize=False, add_generation_prompt=False, return_dict=False):
        texto = "".join("<" + m["role"] + ">" + m["content"] + "</" + m["role"] + ">" for m in mensagens)
        if add_generation_prompt:
            texto += "<assistant>"
        return list(range(len(texto))) if tokenize else texto


class PreflightTreinoJornadas(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.origem = Path(cls.temp.name) / "corpus"
        gravar_corpus(cls.origem)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.pasta = Path(self.temp.name) / self._testMethodName
        shutil.copytree(self.origem, self.pasta)

    def atualizar(self, relativo, conteudo, *, manifesto=True):
        caminho = self.pasta / relativo
        caminho.write_text(conteudo, encoding="utf-8")
        if manifesto:
            p = self.pasta / "manifesto.json"
            m = json.loads(p.read_text())
            m["arquivosSha256"][relativo] = sha256(caminho)
            p.write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")

    def reescrever_primeira_mensagem(self, alterar):
        relativo = "dados-treino/train.jsonl"
        linhas = (self.pasta / relativo).read_text().splitlines()
        registro = json.loads(linhas[0])
        alterar(registro)
        linhas[0] = json.dumps(registro, ensure_ascii=False, separators=(",", ":"))
        self.atualizar(relativo, "\n".join(linhas) + "\n")
        mapa = [json.loads(x) for x in (self.pasta / "mapa-tarefas.jsonl").read_text().splitlines()]
        next(x for x in mapa if x["arquivo"] == relativo and x["linha"] == 1)["sha256LinhaSemQuebra"] = sha256(linhas[0])
        self.atualizar("mapa-tarefas.jsonl", "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in mapa))

    def test_reserva_e_casos_completos_nao_sao_abertos_pelo_preflight(self):
        real_open = io.open
        def abrir(caminho, *args, **kwargs):
            if not isinstance(caminho, int) and ("reserva" in Path(caminho).parts or Path(caminho).name == "casos.jsonl"):
                raise AssertionError("O preflight tentou abrir alvos da reserva.")
            return real_open(caminho, *args, **kwargs)
        with patch("io.open", abrir):
            dados, r = conferir_corpus(self.pasta)
        self.assertEqual({d: len(rs) for d, rs in dados.items()}, {"treino": 128, "validacao": 32})
        self.assertFalse(r["alvosDaReservaLidos"])
        self.assertFalse(r["reservaUsadaParaTreinarOuSelecionar"])
        treino = {x["metadados"]["familia"] for x in dados["treino"]}
        val = {x["metadados"]["familia"] for x in dados["validacao"]}
        self.assertFalse(treino & val)

    def test_dataset_trocado_apos_manifesto_falha(self):
        self.atualizar("dados-treino/train.jsonl", "{}\n", manifesto=False)
        with self.assertRaisesRegex(ValueError, "Mensagens alteradas"):
            conferir_corpus(self.pasta)

    def test_mapa_adulterado_falha_mesmo_sem_ler_alvos(self):
        self.atualizar("mapa-tarefas.jsonl", "{}\n", manifesto=False)
        with self.assertRaisesRegex(ValueError, "Mapa"):
            conferir_corpus(self.pasta)

    def test_familia_deslocada_nao_vira_validacao_nova(self):
        mapa = [json.loads(x) for x in (self.pasta / "mapa-tarefas.jsonl").read_text().splitlines()]
        mapa[0]["divisao"] = "validacao"
        self.atualizar("mapa-tarefas.jsonl", "".join(json.dumps(x) + "\n" for x in mapa))
        with self.assertRaisesRegex(ValueError, "Família deslocada"):
            conferir_corpus(self.pasta)

    def test_entidade_de_treino_nao_pode_ser_contada_como_validacao(self):
        mapa = [json.loads(x) for x in (self.pasta / "mapa-tarefas.jsonl").read_text().splitlines()]
        entidade = next(x["entidadeFicticia"] for x in mapa if x["divisao"] == "treino")
        next(x for x in mapa if x["divisao"] == "validacao")["entidadeFicticia"] = entidade
        self.atualizar("mapa-tarefas.jsonl", "".join(json.dumps(x) + "\n" for x in mapa))
        with self.assertRaisesRegex(ValueError, "Entidade repetida"):
            conferir_corpus(self.pasta)

    def test_protocolo_mudado_exige_regenerar_sem_sobrepor_corpus(self):
        p = self.pasta / "manifesto.json"
        m = json.loads(p.read_text())
        m["codigoSha256"]["ia/negocio/jornadas/protocolo.py"] = "0" * 64
        p.write_text(json.dumps(m), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "regenere"):
            conferir_corpus(self.pasta)

    def test_prompt_divergente_nao_treina_sob_rotulo_de_protocolo_atual(self):
        self.reescrever_primeira_mensagem(lambda r: r["messages"][0].update(content="Instrução trocada"))
        with self.assertRaisesRegex(ValueError, "protocolo atual"):
            conferir_corpus(self.pasta)

    def test_referencia_inventada_no_alvo_nao_e_removida_para_aceitar_treino(self):
        def alterar(r):
            alvo = json.loads(r["messages"][2]["content"])
            alvo["ofertas"][0]["evidencias"] = ["s99"]
            r["messages"][2]["content"] = json.dumps(alvo)
        self.reescrever_primeira_mensagem(alterar)
        with self.assertRaisesRegex(ValueError, "Alvo de supervisão recusado"):
            conferir_corpus(self.pasta)

    def test_numero_de_tarefas_nao_pode_diminuir_com_mesmo_resumo(self):
        caminho = "dados-treino/train.jsonl"
        linhas = (self.pasta / caminho).read_text().splitlines()
        self.atualizar(caminho, "\n".join(linhas[:-1]) + "\n")
        with self.assertRaisesRegex(ValueError, "Número de mensagens"):
            conferir_corpus(self.pasta)

    def test_tokenizacao_nao_corta_conversas_e_registra_identidade(self):
        dados, _ = conferir_corpus(self.pasta)
        dados = {d: rs[:2] for d, rs in dados.items()}
        anterior = deepcopy(dados)
        r = tokenizar(dados, TokenizerControlado())
        self.assertEqual(len(r["exemplos"]), 4)
        self.assertFalse(r["truncamento"])
        self.assertTrue(all(x["tokens"] > 0 and len(x["tokensSha256"]) == 64 for x in r["exemplos"]))
        self.assertEqual(dados, anterior)

    def test_configuracao_conserva_mascara_memoria_e_alvos_limitados(self):
        cfg = criar_config(self.pasta / "novo", self.pasta / "modelo", passos=64, max_sequencia=2048)
        self.assertTrue(cfg["mask_prompt"])
        self.assertTrue(cfg["grad_checkpoint"])
        self.assertFalse(cfg["test"])
        self.assertFalse(cfg["trust_remote_code"])
        self.assertEqual(cfg["num_layers"], 1)
        self.assertEqual(cfg["batch_size"], 1)
        self.assertEqual(cfg["lora_parameters"]["rank"], 8)
        self.assertEqual(cfg["lora_parameters"]["keys"], ["self_attn.q_proj", "self_attn.v_proj"])
        for opcoes in ({"passos": 0}, {"passos": 161}, {"passos": True}, {"max_sequencia": 128}, {"max_sequencia": 8192}):
            with self.subTest(opcoes=opcoes), self.assertRaises(ValueError):
                criar_config(self.pasta, self.pasta, **opcoes)


if __name__ == "__main__":
    unittest.main()
