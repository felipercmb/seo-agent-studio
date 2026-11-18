import json
from pathlib import Path
import sys
import tempfile
import unittest
from copy import deepcopy

IA = Path(__file__).resolve().parent
if str(IA) not in sys.path:
    sys.path.insert(0, str(IA))

from negocio.jornadas.dados_controlados import (
    construir_corpus, validar_corpus, tarefas_caso, mensagens_tarefa,
    gravar_corpus, sha256, json_canonico, FAMILIAS,
)
from negocio.jornadas.contrato import validar_ofertas, validar_jornada
from negocio.jornadas.protocolo import mensagens


class TestCorpusControladoJornadas(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.corpus = construir_corpus()

    def caso(self, familia, idioma="pt", variante=1):
        return next(c for c in self.corpus["casos"] if c["familia"] == familia and c["idioma"] == idioma and c["variante"] == variante)

    def test_contagem_documentos_nao_confunde_traducoes_com_empresas(self):
        r = validar_corpus(self.corpus)
        self.assertEqual(r["casos"], 96)
        self.assertEqual(r["familias"], 12)
        self.assertEqual(r["entidadesFicticias"], 48)
        self.assertEqual(r["divisoes"], {
            "treino": {"casos": 64, "tarefas": 128},
            "validacao": {"casos": 16, "tarefas": 32},
            "reserva": {"casos": 16, "tarefas": 28},
        })
        self.assertEqual(r["alvosRecusados"], 0)
        self.assertEqual(r["alvosSubstituidosPorRegra"], 0)

    def test_divisoes_predefinidas_por_familia_entidade_e_atores(self):
        definidas = {f: d for f, d, _ in FAMILIAS}
        for chave in ("grupoFamilia", "entidadeFicticia", "grupoAtores"):
            vistos = {}
            for c in self.corpus["casos"]:
                self.assertEqual(c["divisao"], definidas[c["familia"]])
                vistos.setdefault(c[chave], set()).add(c["divisao"])
            self.assertTrue(all(len(v) == 1 for v in vistos.values()))

    def test_pt_en_da_mesma_entidade_permanecem_juntos(self):
        grupos = {}
        for c in self.corpus["casos"]:
            grupos.setdefault(c["entidadeFicticia"], []).append(c)
        for casos in grupos.values():
            self.assertEqual({c["idioma"] for c in casos}, {"pt", "en"})
            self.assertEqual(len(casos), 2)
            self.assertEqual(len({c["divisao"] for c in casos}), 1)

    def test_vazamento_de_familia_e_detectado_nao_corrigido(self):
        c = deepcopy(self.corpus)
        c["casos"][0]["divisao"] = "reserva"
        with self.assertRaisesRegex(ValueError, "Vazamento"):
            validar_corpus(c)

    def test_todos_alvos_passam_sem_recusar_ou_substituir_itens(self):
        for c in self.corpus["casos"]:
            with self.subTest(caso=c["id"]):
                o = validar_ofertas(c["alvoOfertas"], c["base"])
                self.assertFalse(o.get("erro"))
                self.assertEqual(o["recusadas"], [])
                self.assertEqual(len(o["ofertas"]), len(c["alvoOfertas"]["ofertas"]))
                self.assertIs(c["alvoSubstituidoPorRegra"], False)
                if c["alvoJornada"] is not None:
                    j = validar_jornada(c["alvoJornada"], c["base"], c["ofertaEntradaJornada"])
                    self.assertFalse(j.get("erro"))
                    self.assertEqual(j["recusados"], [])

    def test_nome_inventado_faz_falhar_sem_abstencao_substituta(self):
        c = deepcopy(self.corpus)
        c["casos"][0]["alvoOfertas"]["ofertas"][0]["nome"] = "Oferta não publicada em nenhuma fonte"
        with self.assertRaisesRegex(ValueError, "Alvo de ofertas recusado"):
            validar_corpus(c)
        self.assertEqual(c["casos"][0]["alvoOfertas"]["ofertas"][0]["nome"], "Oferta não publicada em nenhuma fonte")

    def test_referencia_inventada_faz_falhar(self):
        c = deepcopy(self.corpus)
        c["casos"][0]["alvoOfertas"]["ofertas"][0]["evidencias"] = ["s99"]
        with self.assertRaisesRegex(ValueError, "Alvo de ofertas recusado"):
            validar_corpus(c)

    def test_hash_corresponde_ao_html_utf8_salvo(self):
        for c in self.corpus["casos"]:
            doc = self.corpus["documentos"][c["documento"]["caminho"]]
            self.assertEqual(sha256(doc.encode("utf-8")), c["documento"]["sha256"])
            for f in c["base"]["fontes"]:
                self.assertEqual(f["contexto"]["sha256"], c["documento"]["sha256"])
                self.assertFalse(f["contexto"]["recortado"])

    def test_documento_alterado_e_trecho_fora_do_documento_sao_recusados(self):
        c = deepcopy(self.corpus)
        p = c["casos"][0]["documento"]["caminho"]
        c["documentos"][p] += "alteração"
        with self.assertRaisesRegex(ValueError, "Hash do documento"):
            validar_corpus(c)
        c = deepcopy(self.corpus)
        c["casos"][0]["base"]["fontes"][0]["texto"] = "Este trecho nunca foi gravado no HTML."
        with self.assertRaisesRegex(ValueError, "Fonte sem documento contínuo"):
            validar_corpus(c)

    def test_somente_dominios_invalid_e_metadados_autorais_fora_da_base(self):
        for c in self.corpus["casos"]:
            self.assertTrue(c["base"]["dominio"].endswith(".exemplo.invalid"))
            self.assertEqual(set(c["base"]), {"versao", "dominio", "fontes"})
            self.assertEqual(c["natureza"], "controlado_autoral")
            self.assertFalse(c["revisaoHumana"])
            self.assertFalse(c["prontoParaUsoComClientes"])
            self.assertGreaterEqual(len(c["base"]["fontes"]), 2)
            self.assertLessEqual(len(c["base"]["fontes"]), 4)

    def test_mensagens_nao_recebem_familia_split_rotulo_ou_natureza(self):
        for c in self.corpus["casos"]:
            for tarefa in tarefas_caso(c):
                ms = mensagens_tarefa(c, tarefa)
                dados = json.loads(ms[1]["content"])
                esperadas = {"versao", "dominio", "fontes", "tarefa"} | ({"oferta"} if tarefa["oferta"] else set())
                self.assertEqual(set(dados), esperadas)
                self.assertNotIn("controlado_autoral", ms[1]["content"])
                self.assertEqual(ms[:-1], mensagens(c["base"], tarefa["oferta"]))
                self.assertEqual(json.loads(ms[-1]["content"]), tarefa["alvo"])

    def test_fontes_reordenadas_nao_mudam_referencias_ou_inventam_nome(self):
        a = construir_corpus(semente=1)
        b = construir_corpus(semente=2)
        self.assertEqual(a["documentos"], b["documentos"])
        # Sementes distintas podem coincidir no primeiro caso de três fontes.
        # A propriedade relevante é haver reordenação no corpus e cada alvo
        # continuar apontando ao mesmo conteúdo, com os IDs locais remapeados.
        self.assertTrue(any(x["base"]["fontes"] != y["base"]["fontes"] for x, y in zip(a["casos"], b["casos"])))
        def resolver(alvo, fontes):
            mapa = {f["id"]: {k: v for k, v in f.items() if k != "id"} for f in fontes}
            def visitar(v):
                if isinstance(v, dict):
                    return {k: [mapa[i] for i in item] if k == "evidencias" else mapa[item] if k == "evidencia" else visitar(item) for k, item in v.items()}
                if isinstance(v, list):
                    return [visitar(item) for item in v]
                return v
            return visitar(alvo)
        for x, y in zip(a["casos"], b["casos"]):
            with self.subTest(caso=x["id"]):
                self.assertEqual(x["id"], y["id"])
                fx, fy = x["base"]["fontes"], y["base"]["fontes"]
                self.assertEqual({f["id"] for f in fx}, {f["id"] for f in fy})
                sem_ids = lambda fs: sorted(json_canonico({k: v for k, v in f.items() if k != "id"}) for f in fs)
                self.assertEqual(sem_ids(fx), sem_ids(fy))
                for campo in ("alvoOfertas", "alvoJornada", "ofertaEntradaJornada"):
                    self.assertEqual(resolver(x[campo], fx), resolver(y[campo], fy))
        self.assertEqual(validar_corpus(a)["alvosRecusados"], 0)
        self.assertEqual(validar_corpus(b)["alvosRecusados"], 0)

    def test_intermediario_e_software_nao_ganham_execucao_propria(self):
        for familia in ("intermediacao_artistica", "software_gestao", "cadastro_profissional"):
            for idioma in ("pt", "en"):
                c = self.caso(familia, idioma)
                self.assertNotIn("$site", [a["grupo"] for a in c["alvoJornada"]["executores"]])
        self.assertEqual(self.caso("software_gestao")["alvoOfertas"]["ofertas"][0]["papel_site"], "disponibiliza")

    def test_pagador_nao_e_inventado_quando_so_existe_uso(self):
        for familia in ("cortesia_restrita", "cadastro_profissional"):
            self.assertEqual(self.caso(familia)["alvoJornada"]["pagadores"], [])
        for idioma in ("pt", "en"):
            c = self.caso("concessao_de_recursos", idioma)
            self.assertEqual(c["alvoJornada"]["pagadores"][0]["grupo"], "$site")
            self.assertNotEqual(c["alvoJornada"]["beneficiarios"][0]["grupo"], "$site")

    def test_condicao_do_formulario_nao_restringe_oferta(self):
        for idioma in ("pt", "en"):
            c = self.caso("cadastro_profissional", idioma)
            self.assertEqual(c["alvoJornada"]["condicoes"][0]["aplicacao"], "formulario")
            self.assertTrue(c["alvoJornada"]["compradores"])

    def test_abstencao_de_ofertas_nao_fabrica_jornada_oracle(self):
        vazios = [c for c in self.corpus["casos"] if not c["alvoOfertas"]["ofertas"]]
        self.assertEqual(len(vazios), 4)
        for c in vazios:
            self.assertIsNone(c["ofertaEntradaJornada"])
            self.assertIsNone(c["alvoJornada"])
            self.assertEqual(len(tarefas_caso(c)), 1)
            self.assertTrue(c["jornadaNaoGeradaMotivo"])

    def test_oferta_pode_existir_sem_inventar_atores(self):
        for idioma in ("pt", "en"):
            c = self.caso("informacao_insuficiente", idioma, 3)
            self.assertEqual(len(c["alvoOfertas"]["ofertas"]), 1)
            for campo in ("compradores", "executores", "beneficiarios", "pagadores", "condicoes"):
                self.assertEqual(c["alvoJornada"][campo], [])

    def test_regeneracao_deterministica_e_parametros_invalidos(self):
        self.assertEqual(json_canonico(construir_corpus()), json_canonico(self.corpus))
        for opcoes in ({"instante": "ontem"}, {"instante": "2026-11-16"}, {"semente": True}, {"semente": -1}):
            with self.assertRaises(ValueError):
                construir_corpus(**opcoes)

    def test_gravacao_exclusiva_manifesto_hashes_e_reserva_fora_do_treino(self):
        with tempfile.TemporaryDirectory() as temporario:
            pasta = Path(temporario) / "corpus"
            manifesto = gravar_corpus(pasta)
            self.assertFalse(manifesto["treinoExecutado"])
            self.assertFalse(manifesto["inferenciaExecutada"])
            self.assertFalse(manifesto["reserva"]["testeHumanoCego"])
            for nome, esperado in manifesto["arquivosSha256"].items():
                self.assertEqual(sha256((pasta / nome).read_bytes()), esperado)
            self.assertEqual({p.name for p in (pasta / "dados-treino").iterdir()}, {"train.jsonl", "valid.jsonl"})
            self.assertTrue((pasta / "reserva/controlados-reservados.jsonl").is_file())
            mapa = [json.loads(l) for l in (pasta / "mapa-tarefas.jsonl").read_text().splitlines()]
            self.assertEqual(len(mapa), 188)
            for item in mapa:
                linha = (pasta / item["arquivo"]).read_text().splitlines()[item["linha"] - 1]
                self.assertEqual(sha256(linha), item["sha256LinhaSemQuebra"])
                self.assertEqual(set(json.loads(linha)), {"messages"})
            antes = (pasta / "manifesto.json").read_bytes()
            with self.assertRaises(FileExistsError):
                gravar_corpus(pasta)
            self.assertEqual((pasta / "manifesto.json").read_bytes(), antes)


if __name__ == "__main__":
    unittest.main()
