"""Métricas e roteamento com inferências falsas injetadas; nenhuma GPU."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

IA = Path(__file__).resolve().parent
sys.path.insert(0, str(IA))

from negocio.jornadas.avaliar import (
    CODIGOS_CONGELADOS, RAIZ, agregar, avaliar_tarefa, carregar_casos,
    conferir_adaptador, conferir_comparabilidade, conferir_congelamento, executar_caso, normalizar,
)
from negocio.jornadas.protocolo import mensagens
from negocio.jornadas.treinar import sha256


def fonte(id_, texto, titulo="Assessoria"):
    return {"id": id_, "texto": texto, "tipo": "declaracao", "contexto": {
        "paginaId": "pag_" + "a" * 20, "url": "https://negocio.exemplo.invalid/assessoria",
        "tituloPagina": "Negócio", "titulos": [{"nivel": 2, "texto": titulo}], "campo": "p",
        "coletadoEm": "2026-11-16T12:00:00Z", "sha256": "b" * 64, "recortado": False, "classePagina": "institucional"}}


def exemplo():
    b = {"versao": 1, "dominio": "negocio.exemplo.invalid", "fontes": [
        fonte("s01", "Assessoria conecta contratantes e profissionais. Os contratantes pagam a taxa."),
        fonte("s02", "Profissionais prestam Assessoria aos contratantes durante 12 dias.")]}
    o = {"nome": "Assessoria", "natureza": "servico", "papel_site": "intermedeia", "evidencias": ["s01"]}
    j = {"compradores": [{"grupo": "contratantes", "evidencias": ["s01"]}],
         "executores": [{"grupo": "profissionais", "evidencias": ["s02"]}],
         "beneficiarios": [{"grupo": "contratantes", "evidencias": ["s02"]}],
         "pagadores": [{"grupo": "contratantes", "evidencias": ["s01"]}],
         "condicoes": [{"categoria": "prazo", "evidencia": "s02", "aplicacao": "esta_oferta"}], "duvidas": []}
    tarefas = {"identificar_ofertas": {"id": "caso-pt:ofertas", "tipo": "identificar_ofertas", "base": b, "oferta": None, "alvo": {"ofertas": [o], "duvidas": []}},
               "descrever_jornada": {"id": "caso-pt:jornada", "tipo": "descrever_jornada", "base": b, "oferta": o, "alvo": j}}
    return {"id": "caso-pt", "familia": "exemplo", "entidadeFicticia": "entidade01", "divisao": "validacao", "tarefas": tarefas}


def gerada(saida):
    return {"estado": "gerada", "inferida": True, "saida": deepcopy(saida), "textoBruto": json.dumps(saida)}


class MetricasJornadas(unittest.TestCase):
    def test_normalizacao_nao_apaga_acentos_nem_cria_sinonimos(self):
        self.assertEqual(normalizar("  EMPRESAS\nLocais "), "empresas locais")
        self.assertEqual(normalizar("cafe\u0301"), normalizar("Café"))
        self.assertNotEqual(normalizar("Café"), normalizar("Cafe"))
        self.assertNotEqual(normalizar("empresas"), normalizar("businesses"))

    def test_duvidas_livres_nao_impedem_acordo_de_itens(self):
        t = exemplo()["tarefas"]["identificar_ofertas"]
        saida = deepcopy(t["alvo"])
        saida["duvidas"] = ["Confirmar se há outros serviços."]
        r = avaliar_tarefa(t, saida)
        self.assertTrue(r["estruturaValida"])
        self.assertTrue(r["exatidaoConteudoEReferencias"])
        self.assertFalse(r["validada"]["perfilConfirmado"])

    def test_ordem_de_itens_e_referencias_nao_muda_resultado(self):
        t = exemplo()["tarefas"]["descrever_jornada"]
        t["alvo"]["compradores"].append({"grupo": "profissionais", "evidencias": ["s01", "s02"]})
        saida = deepcopy(t["alvo"])
        saida["compradores"].reverse()
        saida["compradores"][0]["evidencias"].reverse()
        r = avaliar_tarefa(t, saida)
        self.assertTrue(r["exatidaoConteudoEReferencias"])

    def test_item_recusado_continua_como_falso_positivo_do_modelo(self):
        t = exemplo()["tarefas"]["identificar_ofertas"]
        saida = deepcopy(t["alvo"])
        saida["ofertas"].append({"nome": "Promessa inventada", "natureza": "produto", "papel_site": "vende", "evidencias": ["s01"]})
        r = avaliar_tarefa(t, saida)
        self.assertEqual(r["conteudo"], {"tp": 1, "fp": 1, "fn": 0, "precisao": .5, "recall": 1})
        self.assertEqual(r["itensRecusados"], 1)
        self.assertFalse(r["exatidaoConteudoEReferencias"])

    def test_texto_correto_com_fonte_inventada_e_separado_da_prova(self):
        t = exemplo()["tarefas"]["identificar_ofertas"]
        saida = deepcopy(t["alvo"])
        saida["ofertas"][0]["evidencias"] = ["s99"]
        r = avaliar_tarefa(t, saida)
        self.assertTrue(r["exatidaoConteudo"])
        self.assertFalse(r["exatidaoConteudoEReferencias"])
        self.assertEqual(r["conteudo"]["tp"], 1)
        self.assertEqual(r["conteudoEReferencias"]["tp"], 0)
        self.assertEqual(r["itensRecusados"], 1)

    def test_trocar_comprador_e_executor_nao_passa_pela_mesma_palavra(self):
        t = exemplo()["tarefas"]["descrever_jornada"]
        saida = deepcopy(t["alvo"])
        saida["compradores"], saida["executores"] = saida["executores"], saida["compradores"]
        r = avaliar_tarefa(t, saida)
        self.assertEqual(r["porCampo"]["compradores"]["tp"], 0)
        self.assertEqual(r["porCampo"]["executores"]["tp"], 0)
        self.assertFalse(r["exatidaoConteudo"])

    def test_papel_desconhecido_e_preservado_e_inventado_sao_separados(self):
        t = exemplo()["tarefas"]["descrever_jornada"]
        t["alvo"]["pagadores"] = []
        r = avaliar_tarefa(t, deepcopy(t["alvo"]))
        self.assertEqual(r["desconhecidos"], [{"campo": "pagadores", "preservado": True, "itensInventados": 0}])
        saida = deepcopy(t["alvo"])
        saida["pagadores"] = [{"grupo": "contratantes", "evidencias": ["s01"]}]
        r = avaliar_tarefa(t, saida)
        self.assertEqual(r["desconhecidos"][0]["itensInventados"], 1)
        self.assertFalse(r["desconhecidos"][0]["preservado"])
        self.assertEqual(r["conteudo"]["fp"], 1)

    def test_abstencao_nao_executada_nao_e_acerto_por_listas_vazias(self):
        t = exemplo()["tarefas"]["descrever_jornada"]
        r = avaliar_tarefa(t, None, inferida=False)
        self.assertFalse(r["estruturaValida"])
        self.assertFalse(r["exatidaoConteudo"])
        self.assertEqual(r["conteudo"]["fn"], 5)
        self.assertIsNone(r["conteudo"]["precisao"])

    def test_duplicar_item_e_penalizado_sem_confundir_ordem(self):
        t = exemplo()["tarefas"]["identificar_ofertas"]
        saida = deepcopy(t["alvo"])
        saida["ofertas"].append(deepcopy(saida["ofertas"][0]))
        r = avaliar_tarefa(t, saida)
        self.assertEqual(r["conteudo"]["tp"], 1)
        self.assertEqual(r["conteudo"]["fp"], 1)


class RoteamentoJornadas(unittest.TestCase):
    def test_cascata_usa_primeira_oferta_gerada_sem_escolher_gold(self):
        c = exemplo()
        chamada = []
        cabeca = deepcopy(c["tarefas"]["identificar_ofertas"]["alvo"])
        cabeca["ofertas"][0]["papel_site"] = "disponibiliza"
        def gerar(b, o=None):
            chamada.append(deepcopy(o))
            return gerada(cabeca if o is None else c["tarefas"]["descrever_jornada"]["alvo"])
        r = executar_caso(c, gerar)
        self.assertEqual(chamada[1]["papel_site"], "disponibiliza")
        self.assertFalse(r["roteamentoPrincipalCorreto"])
        self.assertFalse(r["compreensaoEmCascataExata"])

    def test_sem_oferta_nao_e_criada_jornada_oracle(self):
        c = exemplo()
        chamadas = []
        def gerar(b, o=None):
            chamadas.append(o)
            return gerada({"ofertas": [], "duvidas": []})
        r = executar_caso(c, gerar)
        self.assertEqual(chamadas, [None])
        self.assertEqual(r["etapas"][1]["geracao"]["estado"], "nao_executada_sem_oferta")
        self.assertFalse(r["etapas"][1]["avaliacao"]["exatidaoConteudoEReferencias"])

    def test_condicional_e_rotulado_sem_pontuacao_end_to_end(self):
        c = exemplo()
        chamadas = []
        def gerar(b, o=None):
            chamadas.append(deepcopy(o))
            return gerada({"ofertas": [], "duvidas": []} if o is None else c["tarefas"]["descrever_jornada"]["alvo"])
        r = executar_caso(c, gerar, modo="condicional")
        self.assertEqual(chamadas[1], c["tarefas"]["descrever_jornada"]["oferta"])
        self.assertIsNone(r["compreensaoEmCascataExata"])
        self.assertEqual(agregar([r])["casosCascataAvaliados"], 0)

    def test_ausencia_gold_nao_fabrica_tarefa_para_punir_ou_acertar(self):
        c = exemplo()
        c["tarefas"].pop("descrever_jornada")
        c["tarefas"]["identificar_ofertas"]["alvo"]["ofertas"] = []
        r = executar_caso(c, lambda b, o=None: gerada({"ofertas": [], "duvidas": []}))
        self.assertEqual(len(r["etapas"]), 1)
        self.assertTrue(r["compreensaoEmCascataExata"])

    def test_orcamento_sem_inferencia_nao_e_acerto_de_ausencia_de_oferta(self):
        c = exemplo()
        c["tarefas"].pop("descrever_jornada")
        c["tarefas"]["identificar_ofertas"]["alvo"]["ofertas"] = []
        resposta = {"estado": "nao_executada_orcamento", "inferida": False, "saida": None}
        r = executar_caso(c, lambda b, o=None: deepcopy(resposta))
        self.assertIsNone(r["roteamentoPrincipalCorreto"])
        self.assertFalse(r["compreensaoEmCascataExata"])
        self.assertEqual(agregar([r])["roteamentosPrincipaisCorretos"], 0)

    def test_oferta_inventada_e_recusada_nao_e_acerto_de_ausencia(self):
        c = exemplo()
        c["tarefas"].pop("descrever_jornada")
        c["tarefas"]["identificar_ofertas"]["alvo"]["ofertas"] = []
        inventada = {"nome": "Algo não publicado", "natureza": "servico", "papel_site": "vende", "evidencias": ["s99"]}
        r = executar_caso(c, lambda b, o=None: gerada({"ofertas": [inventada], "duvidas": []}))
        self.assertFalse(r["roteamentoPrincipalCorreto"])
        self.assertFalse(r["compreensaoEmCascataExata"])

    def test_saida_preenchida_em_geracao_nao_concluida_nao_ganha_acerto(self):
        c = exemplo()
        c["tarefas"].pop("descrever_jornada")
        resposta = gerada(c["tarefas"]["identificar_ofertas"]["alvo"])
        resposta["estado"] = "interrompida_tempo"
        r = executar_caso(c, lambda b, o=None: deepcopy(resposta))
        self.assertIsNone(r["roteamentoPrincipalCorreto"])
        self.assertFalse(r["etapas"][0]["avaliacao"]["exatidaoConteudoEReferencias"])

    def test_interrupcao_nao_reduz_denominador_ao_prefixo_concluido(self):
        a = exemplo()
        b = deepcopy(a)
        b["id"] = "outro-en"
        b["entidadeFicticia"] = "entidade02"
        b["familia"] = "outra-familia"
        head = a["tarefas"]["identificar_ofertas"]
        etapa = {"tarefaId": head["id"], "tipo": "identificar_ofertas", "geracao": gerada(head["alvo"]),
                 "avaliacao": avaliar_tarefa(head, head["alvo"])}
        r = agregar([], selecionados=[a, b], tentados=[a["id"]], parciais=[{"casoId": a["id"], "etapa": etapa}], estado="interrompida")
        self.assertEqual(r["casosDocumentais"], 2)
        self.assertEqual(r["entidadesFicticias"], 2)
        self.assertEqual(r["familias"], 2)
        self.assertEqual(r["cobertura"]["casos"], {"selecionados": 2, "tentados": 1, "concluidos": 0, "interrompidos": 1, "naoIniciados": 1, "comInferenciasNecessariasConcluidas": 0})
        self.assertEqual(r["cobertura"]["tarefas"]["selecionadas"], 4)
        self.assertEqual(r["cobertura"]["tarefas"]["processadas"], 1)
        self.assertEqual(r["cobertura"]["tarefas"]["naoProcessadas"], 3)
        self.assertEqual(r["casosCascataSelecionados"], 2)
        self.assertEqual(r["casosCascataExatos"], 0)

    def test_prefixo_completo_com_falha_seguinte_nao_vira_100_porcento_do_plano(self):
        a = exemplo()
        b = deepcopy(a)
        b["id"] = "caso-en"
        c = deepcopy(a)
        c.update(id="outro-pt", familia="outro-tipo", entidadeFicticia="entidade02")
        completo = executar_caso(a, lambda base, o=None: gerada(a["tarefas"]["descrever_jornada" if o else "identificar_ofertas"]["alvo"]))
        r = agregar([completo], selecionados=[a, b, c], tentados=[a["id"], b["id"]], estado="interrompida")
        self.assertEqual(r["casosCascataExatos"], 1)
        self.assertEqual(r["casosCascataSelecionados"], 3)
        self.assertEqual(r["entidadesFicticias"], 2)
        self.assertEqual(r["familias"], 2)
        self.assertEqual(r["cobertura"]["casos"]["interrompidos"], 1)
        self.assertEqual(r["cobertura"]["casos"]["naoIniciados"], 1)
        self.assertFalse(r["cobertura"]["fluxoCompleto"])

    def test_posprocessamento_nao_e_contado_como_estrutura_bruta_correta(self):
        c = exemplo()
        c["tarefas"].pop("descrever_jornada")
        saida = deepcopy(c["tarefas"]["identificar_ofertas"]["alvo"])
        saida["duvidas"] = ["x" * 241]
        resposta = gerada(saida)
        resposta["saida"]["duvidas"] = ["Pergunta recusada pelo programa."]
        resposta["posProcessamento"] = [{"tipo": "duvida_recusada_comprimento", "indice": 0, "caracteres": 241}]
        r = agregar([executar_caso(c, lambda base, o=None: deepcopy(resposta))])
        self.assertEqual(r["tarefas"]["estruturasValidas"], 1)
        self.assertEqual(r["tarefas"]["estruturasValidasAntesPosProcessamento"], 0)
        self.assertEqual(r["posProcessamento"]["geracoesTratadas"], 1)

    def test_condicao_mesma_fonte_com_aplicacao_diferente_nao_e_igual(self):
        t = exemplo()["tarefas"]["descrever_jornada"]
        saida = deepcopy(t["alvo"])
        saida["condicoes"][0]["aplicacao"] = "formulario"
        r = avaliar_tarefa(t, saida)
        self.assertEqual(r["porCampo"]["condicoes"]["tp"], 0)
        self.assertEqual(r["porCampo"]["condicoes"]["fp"], 1)
        self.assertEqual(r["porCampo"]["condicoes"]["fn"], 1)

    def test_etapa_anterior_e_preservada_quando_proxima_geracao_falha(self):
        c = exemplo()
        parciais = []
        def gerar(b, o=None):
            if o is not None:
                raise RuntimeError("falha controlada")
            return gerada(c["tarefas"]["identificar_ofertas"]["alvo"])
        with self.assertRaisesRegex(RuntimeError, "controlada"):
            executar_caso(c, gerar, ao_etapa=parciais.append)
        self.assertEqual(len(parciais), 1)
        self.assertEqual(parciais[0]["tipo"], "identificar_ofertas")

    def test_agregacao_nao_conta_documento_traduzido_como_empresa_independente(self):
        c = exemplo()
        def gerar(b, o=None):
            return gerada(c["tarefas"]["descrever_jornada" if o else "identificar_ofertas"]["alvo"])
        a = executar_caso(c, gerar)
        b = deepcopy(a)
        b["casoId"] = "caso-en"
        r = agregar([a, b])
        self.assertEqual(r["casosDocumentais"], 2)
        self.assertEqual(r["entidadesFicticias"], 1)
        self.assertEqual(r["tarefas"]["tarefas"], 4)
        self.assertEqual(r["casosCascataExatos"], 2)


class AcessoReservasEAdaptadores(unittest.TestCase):
    def test_reserva_exige_flag_antes_de_ler_qualquer_corpus(self):
        with patch("negocio.jornadas.avaliar.conferir_corpus") as conferir:
            with self.assertRaisesRegex(ValueError, "fechada"):
                carregar_casos(Path("nao-existe"), "reserve")
            conferir.assert_not_called()

    def test_reserva_exige_congelamento_antes_de_ler_alvos(self):
        with patch("negocio.jornadas.avaliar.conferir_corpus") as conferir:
            with self.assertRaisesRegex(ValueError, "congelamento"):
                carregar_casos(Path("nao-existe"), "reserve", abrir_reserva=True)
            conferir.assert_not_called()

    def test_congelamento_confere_todos_fontes_e_rejeita_alterado(self):
        with tempfile.TemporaryDirectory() as pasta:
            p = Path(pasta) / "congelamento.json"
            m = {"versao": 1, "codigoSha256": {r: sha256(RAIZ / r) for r in CODIGOS_CONGELADOS}}
            p.write_text(json.dumps(m), encoding="utf-8")
            self.assertEqual(conferir_congelamento(p)["sha256"], sha256(p))
            m["codigoSha256"][CODIGOS_CONGELADOS[0]] = "0" * 64
            p.write_text(json.dumps(m), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "alterado"):
                conferir_congelamento(p)

    def test_validation_monta_so_tarefas_da_divisao_pedida(self):
        c = exemplo()
        registros = []
        for tipo, t in c["tarefas"].items():
            ms = mensagens(t["base"], t["oferta"]) + [{"role": "assistant", "content": json.dumps(t["alvo"])}]
            registros.append({"messages": ms, "metadados": {"casoId": c["id"], "tarefaId": t["id"], "familia": c["familia"], "entidadeFicticia": c["entidadeFicticia"]}})
        with patch("negocio.jornadas.avaliar.conferir_corpus", return_value=({"treino": [], "validacao": registros}, {})):
            casos, auditoria = carregar_casos(Path("sem-io-real"))
        self.assertEqual(len(casos), 1)
        self.assertEqual(set(casos[0]["tarefas"]), set(c["tarefas"]))
        self.assertFalse(auditoria["alvosDaReservaLidos"])

    def test_adaptador_incompleto_ou_sem_recibo_correspondente_e_recusado(self):
        with tempfile.TemporaryDirectory() as pasta:
            p = Path(pasta)
            (p / "adapters.safetensors").write_bytes(b"arquivo de teste, nao pesos reais")
            (p / "adapter_config.json").write_text("{}")
            m = {"estado": "concluido", "modeloBase": "qwen35-4b", "codigoMudouDuranteExecucao": False,
                 "adaptadorSha256": sha256(p / "adapters.safetensors"), "configAdaptadorSha256": sha256(p / "adapter_config.json")}
            (p / "treino.json").write_text(json.dumps(m))
            self.assertEqual(conferir_adaptador(p)["adaptadorSha256"], m["adaptadorSha256"])
            (p / "adapters.safetensors").write_bytes(b"alterado")
            with self.assertRaisesRegex(ValueError, "diferente"):
                conferir_adaptador(p)


class ComparabilidadeExperimentos(unittest.TestCase):
    def recibo(self):
        return {"estado": "concluida", "codigoMudouDuranteExecucao": False, "versaoAvaliador": 2,
                "modeloBase": "qwen35-4b", "codigoSha256": {r: "a" * 64 for r in CODIGOS_CONGELADOS},
                "dependencias": {"mlx": "versao-teste"}, "config": {"temperatura": 0}, "modo": "cascata", "split": "validation",
                "selecionados": ["caso-pt", "caso-en"], "limiteCasos": 2,
                "auditoriaDados": {"manifestoSha256": "b" * 64},
                "modelo": {"modeloBaseVerificado": True, "modeloBase": "qwen35-4b", "repoModelo": "local/modelo", "revisaoModelo": "rev-teste"},
                "resumo": {"cobertura": {"fluxoCompleto": True}}}

    def test_adaptador_diferente_e_permitido_com_contexto_experimental_igual(self):
        a = self.recibo()
        b = deepcopy(a)
        a["adaptador"] = None
        b["adaptador"] = {"adaptadorSha256": "c" * 64}
        self.assertTrue(conferir_comparabilidade(a, b)["comparaveis"])

    def test_selecao_modo_codigo_ou_dependencia_diferente_impedem_conclusao_de_ganho(self):
        a = self.recibo()
        mudancas = {"selecionados": ["outro-pt", "outro-en"], "modo": "condicional",
                    "codigoSha256": {}, "dependencias": {"mlx": "outra-versao"}, "config": {"temperatura": 1}}
        for campo, valor in mudancas.items():
            b = deepcopy(a)
            b[campo] = valor
            with self.subTest(campo=campo), self.assertRaisesRegex(ValueError, "Comparação inválida"):
                conferir_comparabilidade(a, b)

    def test_experimento_parcial_nao_e_comparavel_com_completo(self):
        a = self.recibo()
        b = deepcopy(a)
        b["estado"] = "interrompida"
        with self.assertRaisesRegex(ValueError, "incompleta"):
            conferir_comparabilidade(a, b)


if __name__ == "__main__":
    unittest.main()
