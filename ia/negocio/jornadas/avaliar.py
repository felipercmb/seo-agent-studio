"""Avaliação local de jornadas: conteúdo, referências e roteamento separados.

Não lê empresas reais TEST. A reserva controlada exige abertura explícita e
um registro de congelamento dos fontes antes de ler os alvos reservados.
"""
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
import unicodedata

IA = Path(__file__).resolve().parents[2]
RAIZ = IA.parent
sys.path.insert(0, str(IA))
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
from negocio.jornadas.contrato import ATORES, validar_base, validar_ofertas, validar_jornada
from negocio.jornadas.protocolo import mensagens
from negocio.jornadas.treinar import conferir_corpus, sha256, salvar, _ler_json

CODIGOS_CONGELADOS = tuple("ia/negocio/jornadas/" + n + ".py" for n in ("avaliar", "contrato", "protocolo", "executar", "recuperacao"))
CODIGOS = (*CODIGOS_CONGELADOS, "ia/negocio/jornadas/treinar.py", "ia/negocio/relacoes/contrato.py",
           "ia/negocio/contrato.py", "ia/negocio/protocolo.py", "ia/negocio/runtime_negocio.py",
           "ia/negocio/modelos.py", "ia/negocio/decodificacao/core_mlx.py")
DIVISOES = {"train": "treino", "validation": "validacao", "reserve": "reserva"}


def normalizar(texto):
    """Não remove acentos, reordena palavras nem cria equivalências por domínio."""
    return " ".join(unicodedata.normalize("NFKC", texto).casefold().split()) if isinstance(texto, str) else ""


def _chave_item(item, campo, *, referencias=False):
    if not isinstance(item, dict):
        return None
    if campo == "ofertas":
        if set(item) != {"nome", "natureza", "papel_site", "evidencias"} or not isinstance(item["nome"], str):
            return None
        if not isinstance(item["natureza"], str) or not isinstance(item["papel_site"], str):
            return None
        chave = (normalizar(item["nome"]), item["natureza"], item["papel_site"])
    elif campo == "condicoes":
        if set(item) != {"categoria", "evidencia", "aplicacao"} or not all(isinstance(v, str) for v in item.values()):
            return None
        # O item condição é a própria fonte contínua, sem paráfrase livre.
        return (item["categoria"], item["evidencia"], item["aplicacao"])
    else:
        if set(item) != {"grupo", "evidencias"} or not isinstance(item["grupo"], str):
            return None
        chave = (normalizar(item["grupo"]),)
    refs = item.get("evidencias")
    if not isinstance(refs, list) or any(not isinstance(r, str) for r in refs):
        return None
    if referencias:
        # IDs repetidos são erro de contrato, não ordem diferente.
        return (*chave, tuple(sorted(refs)))
    return chave


def _itens(saida, campos, *, referencias=False):
    itens = Counter()
    if not isinstance(saida, dict):
        return itens
    for campo in campos:
        valores = saida.get(campo)
        if not isinstance(valores, list):
            if valores is not None:
                itens[(campo, "__item_invalido__", "lista")] += 1
            continue
        for indice, item in enumerate(valores):
            chave = _chave_item(item, campo, referencias=referencias)
            itens[(campo, *(chave if chave is not None else ("__item_invalido__", str(indice))))] += 1
    return itens


def _metricas(esperados, gerados):
    tp = sum((esperados & gerados).values())
    fp = sum((gerados - esperados).values())
    fn = sum((esperados - gerados).values())
    return {"tp": tp, "fp": fp, "fn": fn,
            "precisao": tp / (tp + fp) if tp + fp else None,
            "recall": tp / (tp + fn) if tp + fn else None}


def avaliar_tarefa(tarefa, saida, *, oferta_executada=None, inferida=True, concluida=None):
    """Avalia a saída bruta, antes de descartar os itens recusados pelo contrato.

    Em particular, itens inventados que um guardrail recusa continuam contando
    como falso positivo do modelo. Duvidas não exige texto igual ao do autor.
    """
    base, oferta_entrada, alvo = tarefa["base"], tarefa.get("oferta"), tarefa["alvo"]
    oferta_validacao = oferta_executada if oferta_executada is not None else oferta_entrada
    campos = ("ofertas",) if oferta_entrada is None else (*ATORES, "condicoes")
    try:
        validada = validar_ofertas(saida, base) if oferta_entrada is None else validar_jornada(saida, base, oferta_validacao)
    except (TypeError, ValueError, KeyError) as erro:
        validada = {"erro": "validacao_recusada", "tipoErro": type(erro).__name__}
    concluida = bool(inferida) if concluida is None else bool(inferida and concluida)
    estrutura = bool(concluida and isinstance(saida, dict) and not validada.get("erro"))
    recusas = validada.get("recusadas", []) if oferta_entrada is None else validada.get("recusados", [])
    erros = Counter(e for r in recusas for e in r.get("erros", []))
    if validada.get("erro"):
        erros[validada["erro"]] += 1
    esperados, gerados = _itens(alvo, campos), _itens(saida, campos)
    refs_esperados, refs_gerados = _itens(alvo, campos, referencias=True), _itens(saida, campos, referencias=True)
    desconhecidos, omissoes = [], []
    if oferta_entrada is not None:
        for campo in ATORES:
            previsto = saida.get(campo) if isinstance(saida, dict) else None
            if alvo[campo] == []:
                desconhecidos.append({"campo": campo, "preservado": estrutura and previsto == [],
                                      "itensInventados": len(previsto) if isinstance(previsto, list) else 0})
            elif not previsto:
                omissoes.append(campo)
    metricas_campos = {c: _metricas(_itens(alvo, (c,)), _itens(saida, (c,))) for c in campos}
    return {"estruturaValida": estrutura,
            "exatidaoConteudo": estrutura and esperados == gerados,
            "exatidaoConteudoEReferencias": estrutura and not recusas and refs_esperados == refs_gerados,
            "conteudo": _metricas(esperados, gerados), "conteudoEReferencias": _metricas(refs_esperados, refs_gerados),
            "porCampo": metricas_campos, "itensBrutos": sum(gerados.values()),
            "itensRecusados": len(recusas), "errosContrato": dict(erros),
            "desconhecidos": desconhecidos, "papeisConhecidosOmitidos": omissoes,
            "inferida": bool(inferida), "inferenciaConcluida": concluida, "validada": validada,
            "limite": "Acordo com rótulos autorais controlados; não aprovação profissional humana nem resultado comercial."}


def oferta_principal_correta(saida_validada, alvo):
    if saida_validada.get("erro") or saida_validada.get("recusadas"):
        return False
    esperadas = alvo["ofertas"]
    geradas = saida_validada.get("ofertas", [])
    if not esperadas:
        return geradas == []
    if not geradas:
        return False
    def chave(oferta):
        return (normalizar(oferta["nome"]), oferta["natureza"], oferta["papel_site"])
    return chave(geradas[0]) == chave(esperadas[0])


def conferir_congelamento(caminho):
    if caminho is None:
        raise ValueError("A reserva exige um registro de congelamento anterior à abertura.")
    congelado = _ler_json(Path(caminho).read_text(encoding="utf-8"))
    codigos = congelado.get("codigoSha256", {})
    if congelado.get("versao") != 1 or not isinstance(codigos, dict):
        raise ValueError("Registro de congelamento inválido.")
    for relativo in CODIGOS_CONGELADOS:
        if codigos.get(relativo) != sha256(RAIZ / relativo):
            raise ValueError("Fonte ausente ou alterado depois do congelamento: " + relativo)
    return {"arquivo": str(Path(caminho).resolve()), "sha256": sha256(Path(caminho)),
            "codigoConferido": {r: codigos[r] for r in CODIGOS_CONGELADOS},
            "limite": "O SHA prova a versão declarada, não prova que o autor nunca viu os rótulos controlados."}


def carregar_casos(corpus, split="validation", *, abrir_reserva=False, congelamento=None):
    if split not in DIVISOES:
        raise ValueError("Divisão inválida.")
    congelado = None
    if split == "reserve":
        if abrir_reserva is not True:
            raise ValueError("A reserva permanece fechada; falta --abrir-reserva.")
        # Esta conferência precede toda leitura dos alvos da reserva.
        congelado = conferir_congelamento(congelamento)
    dados, auditoria = conferir_corpus(Path(corpus))
    divisao = DIVISOES[split]
    registros = dados.get(divisao)
    if split == "reserve":
        pasta = Path(corpus)
        manifesto = _ler_json((pasta / "manifesto.json").read_text(encoding="utf-8"))
        relativo = "reserva/controlados-reservados.jsonl"
        caminho = pasta / relativo
        if sha256(caminho) != manifesto["arquivosSha256"].get(relativo):
            raise ValueError("Alvos reservados alterados após geração.")
        metas = {_ler_json(l)["linha"]: _ler_json(l) for l in (pasta / "mapa-tarefas.jsonl").read_text(encoding="utf-8").splitlines() if _ler_json(l)["arquivo"] == relativo}
        registros = []
        for linha, texto in enumerate(caminho.read_text(encoding="utf-8").splitlines(), 1):
            meta = metas.get(linha)
            if not meta or meta["divisao"] != "reserva" or sha256(texto) != meta["sha256LinhaSemQuebra"]:
                raise ValueError("Referência reservada sem metadados correspondentes.")
            r = _ler_json(texto)
            ms = r.get("messages")
            if set(r) != {"messages"} or not isinstance(ms, list) or len(ms) != 3:
                raise ValueError("Conversa reservada inválida.")
            entrada = _ler_json(ms[1]["content"])
            base = {k: entrada[k] for k in ("versao", "dominio", "fontes")}
            oferta = entrada.get("oferta")
            if validar_base(base) or ms[:-1] != mensagens(base, oferta):
                raise ValueError("Referência reservada diverge do protocolo congelado.")
            alvo = _ler_json(ms[2]["content"])
            validada = validar_jornada(alvo, base, oferta) if oferta else validar_ofertas(alvo, base)
            if validada.get("erro") or validada.get("recusados") or validada.get("recusadas"):
                raise ValueError("Referência reservada recusada; preservar e relatar, sem consertar.")
            registros.append({"messages": ms, "metadados": meta})
        if len(registros) != manifesto["resumo"]["divisoes"]["reserva"]["tarefas"]:
            raise ValueError("Contagem de tarefas reservadas diferente do manifesto.")
    casos = {}
    for registro in registros:
        ms, meta = registro["messages"], registro["metadados"]
        if not isinstance(meta["casoId"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", meta["casoId"]):
            raise ValueError("Identificador de caso inválido para artefatos locais.")
        entrada = _ler_json(ms[1]["content"])
        tarefa = {"id": meta["tarefaId"], "tipo": entrada["tarefa"],
                  "base": {k: entrada[k] for k in ("versao", "dominio", "fontes")},
                  "oferta": entrada.get("oferta"), "alvo": _ler_json(ms[2]["content"])}
        caso = casos.setdefault(meta["casoId"], {"id": meta["casoId"], "familia": meta["familia"],
                   "entidadeFicticia": meta["entidadeFicticia"], "divisao": divisao, "tarefas": {}})
        if tarefa["tipo"] in caso["tarefas"]:
            raise ValueError("Tarefa repetida no mesmo caso.")
        caso["tarefas"][tarefa["tipo"]] = tarefa
    if any("identificar_ofertas" not in c["tarefas"] for c in casos.values()):
        raise ValueError("Jornada sem tarefa de oferta correspondente.")
    return list(casos.values()), {**auditoria, "alvosDaReservaLidos": split == "reserve", "congelamento": congelado}


def _inferencia_concluida(geracao):
    return geracao.get("inferida") is True and geracao.get("estado") == "gerada" and isinstance(geracao.get("saida"), dict)


def _avaliar_geracao(tarefa, geracao, oferta_executada=None):
    a = avaliar_tarefa(tarefa, geracao.get("saida"), oferta_executada=oferta_executada,
                       inferida=geracao.get("inferida") is True, concluida=_inferencia_concluida(geracao))
    bruto = None
    try:
        bruto = _ler_json(geracao["textoBruto"])
    except (KeyError, TypeError, ValueError):
        pass
    anterior = avaliar_tarefa(tarefa, bruto, oferta_executada=oferta_executada,
                             inferida=geracao.get("inferida") is True,
                             concluida=_inferencia_concluida(geracao))
    a["antesPosProcessamento"] = {k: anterior[k] for k in ("estruturaValida", "exatidaoConteudo", "exatidaoConteudoEReferencias", "itensRecusados")}
    return a


def executar_caso(caso, gerar, *, modo="cascata", ao_etapa=None):
    """gerar(base, oferta=None) é injetável para testes CPU do roteamento."""
    if modo not in ("cascata", "condicional"):
        raise ValueError("Modo de avaliação inválido.")
    cabeca = caso["tarefas"]["identificar_ofertas"]
    inicio = time.monotonic()
    geracao = gerar(cabeca["base"])
    avaliacao = _avaliar_geracao(cabeca, geracao)
    principal = oferta_principal_correta(avaliacao["validada"], cabeca["alvo"]) if avaliacao["inferenciaConcluida"] else None
    etapas = [{"tarefaId": cabeca["id"], "tipo": "identificar_ofertas", "ofertaExecutada": None,
               "geracao": geracao, "avaliacao": avaliacao}]
    if ao_etapa:
        ao_etapa(deepcopy(etapas[-1]))
    tarefa = caso["tarefas"].get("descrever_jornada")
    if tarefa:
        ofertas = avaliacao["validada"].get("ofertas", []) if avaliacao["estruturaValida"] else []
        o = deepcopy(tarefa["oferta"]) if modo == "condicional" else ({k: deepcopy(ofertas[0][k]) for k in ("nome", "natureza", "papel_site", "evidencias")} if ofertas else None)
        if o is None:
            resposta = {"estado": "nao_executada_sem_oferta", "inferida": False, "saida": None}
        else:
            resposta = gerar(tarefa["base"], o)
        a = _avaliar_geracao(tarefa, resposta, o)
        etapas.append({"tarefaId": tarefa["id"], "tipo": "descrever_jornada", "ofertaExecutada": o,
                       "geracao": resposta, "avaliacao": a})
        if ao_etapa:
            ao_etapa(deepcopy(etapas[-1]))
    return {"casoId": caso["id"], "familia": caso["familia"], "entidadeFicticia": caso["entidadeFicticia"],
            "divisao": caso["divisao"], "modo": modo, "etapas": etapas,
            "roteamentoPrincipalCorreto": principal,
            "compreensaoEmCascataExata": principal is True and all(e["avaliacao"]["exatidaoConteudoEReferencias"] for e in etapas) if modo == "cascata" else None,
            "segundos": time.monotonic() - inicio, "prontoParaUsoComClientes": False}


def agregar(resultados, *, selecionados=None, tentados=None, parciais=None, estado="concluida", modo=None):
    """Conserva o plano no denominador e identifica observações incompletas.

    As métricas de itens usam as saídas observadas, inclusive etapas parciais;
    casos não executados não são inventados como saídas vazias corretas.
    """
    if selecionados is None:
        selecionados = [{"id": r["casoId"], "familia": r["familia"], "entidadeFicticia": r["entidadeFicticia"],
                         "tarefas": {e["tarefaId"]: {} for e in r["etapas"]}} for r in resultados]
    ids = {c["id"] for c in selecionados}
    if len(ids) != len(selecionados) or any(r["casoId"] not in ids for r in resultados):
        raise ValueError("Resultados/seleção repetidos ou fora do plano declarado.")
    concluidos = {r["casoId"] for r in resultados}
    if len(concluidos) != len(resultados):
        raise ValueError("Caso concluído repetido.")
    parciais = parciais or []
    tentados = set(tentados) if tentados is not None else concluidos | {p["casoId"] for p in parciais}
    if not tentados <= ids or not concluidos <= tentados or any(p["casoId"] not in tentados for p in parciais):
        raise ValueError("Tentativas ou etapas parciais fora da seleção.")
    etapas = [e for r in resultados for e in r["etapas"]]
    vistas = {(r["casoId"], e["tarefaId"]) for r in resultados for e in r["etapas"]}
    for parcial in parciais:
        chave_etapa = (parcial["casoId"], parcial["etapa"]["tarefaId"])
        if parcial["casoId"] not in concluidos and chave_etapa not in vistas:
            vistas.add(chave_etapa)
            etapas.append(parcial["etapa"])
    tarefas_planejadas = sum(len(c["tarefas"]) for c in selecionados)
    if len(etapas) > tarefas_planejadas:
        raise ValueError("Etapas observadas excedem o plano declarado.")
    inferencias_concluidas = sum(e["avaliacao"]["inferenciaConcluida"] for e in etapas)
    fluxo_com_inferencias = sum(all(e["avaliacao"]["inferenciaConcluida"] for e in r["etapas"]) for r in resultados)
    def soma_metricas(metrica, escolhidas=etapas):
        r = {k: sum(e["avaliacao"][metrica][k] for e in escolhidas) for k in ("tp", "fp", "fn")}
        return {**r, "precisao": r["tp"] / (r["tp"] + r["fp"]) if r["tp"] + r["fp"] else None,
                "recall": r["tp"] / (r["tp"] + r["fn"]) if r["tp"] + r["fn"] else None}
    def resumo(escolhidas):
        return {"tarefas": len(escolhidas), "inferidas": sum(e["avaliacao"]["inferida"] for e in escolhidas),
                "inferenciasConcluidas": sum(e["avaliacao"]["inferenciaConcluida"] for e in escolhidas),
                "estruturasValidas": sum(e["avaliacao"]["estruturaValida"] for e in escolhidas),
                "estruturasValidasAntesPosProcessamento": sum(e["avaliacao"].get("antesPosProcessamento", e["avaliacao"])["estruturaValida"] for e in escolhidas),
                "tarefasExatasConteudo": sum(e["avaliacao"]["exatidaoConteudo"] for e in escolhidas),
                "tarefasExatasConteudoEReferencias": sum(e["avaliacao"]["exatidaoConteudoEReferencias"] for e in escolhidas),
                "conteudo": soma_metricas("conteudo", escolhidas), "conteudoEReferencias": soma_metricas("conteudoEReferencias", escolhidas),
                "itensRecusados": sum(e["avaliacao"]["itensRecusados"] for e in escolhidas)}
    desconhecidos = [d for e in etapas for d in e["avaliacao"]["desconhecidos"]]
    campos = {}
    for campo in ("ofertas", *ATORES, "condicoes"):
        ms = [e["avaliacao"]["porCampo"][campo] for e in etapas if campo in e["avaliacao"]["porCampo"]]
        totais = {k: sum(m[k] for m in ms) for k in ("tp", "fp", "fn")}
        campos[campo] = {**totais, "precisao": totais["tp"] / (totais["tp"] + totais["fp"]) if totais["tp"] + totais["fp"] else None,
                          "recall": totais["tp"] / (totais["tp"] + totais["fn"]) if totais["tp"] + totais["fn"] else None}
    return {"casosDocumentais": len(selecionados), "casosDocumentaisComFluxoConcluido": len(resultados),
            "entidadesFicticias": len({r["entidadeFicticia"] for r in selecionados}),
            "familias": len({r["familia"] for r in selecionados}), "tarefas": resumo(etapas),
            "porTarefa": {t: resumo([e for e in etapas if e["tipo"] == t]) for t in ("identificar_ofertas", "descrever_jornada")},
            "porCampo": campos, "roteamentosPrincipaisCorretos": sum(r["roteamentoPrincipalCorreto"] is True for r in resultados),
            "roteamentosPrincipaisIncorretos": sum(r["roteamentoPrincipalCorreto"] is False for r in resultados),
            "roteamentosNaoAvaliados": len(selecionados) - sum(r["roteamentoPrincipalCorreto"] is not None for r in resultados),
            "casosCascataExatos": sum(r["compreensaoEmCascataExata"] is True for r in resultados),
            "casosCascataAvaliados": sum(r["compreensaoEmCascataExata"] is not None for r in resultados),
            "casosCascataSelecionados": len(selecionados) if modo == "cascata" or (modo is None and not any(r["modo"] == "condicional" for r in resultados)) else 0,
            "denominadorDeclarado": {"unidade": "casos documentais selecionados", "total": len(selecionados),
                                      "tarefasSelecionadas": tarefas_planejadas,
                                      "metricasDeItens": "Somente saídas observadas; etapas não concluídas não contam como acertos."},
            "cobertura": {"estadoExecucao": estado,
                          "casos": {"selecionados": len(selecionados), "tentados": len(tentados), "concluidos": len(resultados),
                                    "interrompidos": len(tentados - concluidos), "naoIniciados": len(ids - tentados),
                                    "comInferenciasNecessariasConcluidas": fluxo_com_inferencias},
                          "tarefas": {"selecionadas": tarefas_planejadas, "processadas": len(etapas),
                                      "inferidas": sum(e["avaliacao"]["inferida"] for e in etapas), "concluidasPelaIA": inferencias_concluidas,
                                      "naoProcessadas": tarefas_planejadas - len(etapas),
                                      "processadasSemInferenciaConcluida": len(etapas) - inferencias_concluidas},
                          "fluxoCompleto": estado == "concluida" and len(resultados) == len(selecionados),
                          "inferenciaCompleta": inferencias_concluidas == tarefas_planejadas,
                          "limite": "Concluído descreve o fluxo do caso; uma jornada pode permanecer não executada. Interrompidos inclui falhas após início."},
            "estadosGeracao": dict(Counter(e["geracao"].get("estado", "desconhecido") for e in etapas)),
            "posProcessamento": {"geracoesTratadas": sum(bool(e["geracao"].get("posProcessamento")) for e in etapas),
                                 "porTipo": dict(Counter(p.get("tipo", "desconhecido") for e in etapas for p in e["geracao"].get("posProcessamento", []))),
                                 "limite": "Tratamento programático registrado, aplicado igualmente à base e ao candidato; não é ganho de pesos."},
            "desconhecidos": {"camposEsperados": len(desconhecidos), "preservados": sum(d["preservado"] for d in desconhecidos),
                               "itensInventadosBrutos": sum(d["itensInventados"] for d in desconhecidos)},
            "papeisConhecidosOmitidos": sum(len(e["avaliacao"]["papeisConhecidosOmitidos"]) for e in etapas),
            "limites": ["Avaliação contra rótulos autorais controlados, sem revisão humana profissional.",
                         "Documentos PT/EN da mesma entidade são dependentes; casos documentais não equivalem a empresas novas.",
                         "O denominador declarado conserva toda a seleção, inclusive casos não iniciados/interrompidos. Precisão/recall de itens usam apenas saídas observadas.",
                         "Métricas incluem a saída bruta: recusar um item não apaga um falso positivo do modelo.",
                         "Não mede SEO, receita, resultado de recomendações ou prontidão autônoma com clientes."]}


def conferir_comparabilidade(base, candidato):
    """Recusa concluir ganho a partir de subconjuntos ou protocolos diferentes."""
    for nome, recibo in (("base", base), ("candidato", candidato)):
        if recibo.get("estado") != "concluida" or recibo.get("codigoMudouDuranteExecucao") is not False:
            raise ValueError("Avaliação " + nome + " incompleta ou com código alterado.")
        if not recibo.get("resumo", {}).get("cobertura", {}).get("fluxoCompleto"):
            raise ValueError("Avaliação " + nome + " não concluiu o fluxo de toda a seleção.")
        if recibo.get("modelo", {}).get("modeloBaseVerificado") is not True:
            raise ValueError("Modelo-base não verificado no recibo " + nome + ".")
    for campo in ("versaoAvaliador", "modeloBase", "codigoSha256", "dependencias", "config", "modo", "split", "selecionados", "limiteCasos"):
        if campo not in base or campo not in candidato or base[campo] != candidato[campo]:
            raise ValueError("Comparação inválida: campo diferente " + campo)
    if base["auditoriaDados"]["manifestoSha256"] != candidato["auditoriaDados"]["manifestoSha256"]:
        raise ValueError("Comparação inválida: manifesto de dados diferente.")
    for campo in ("repoModelo", "revisaoModelo", "modeloBase"):
        if base["modelo"].get(campo) != candidato["modelo"].get(campo):
            raise ValueError("Comparação inválida: proveniência do modelo-base diferente.")
    return {"comparaveis": True, "selecionados": len(base["selecionados"]), "modo": base["modo"], "split": base["split"],
            "manifestoSha256": base["auditoriaDados"]["manifestoSha256"],
            "limite": "Comparabilidade técnica de experimentos concluídos; não comprova significância, independência ou prontidão para clientes."}


def conferir_adaptador(caminho):
    if caminho is None:
        return None
    pasta = Path(caminho).resolve()
    recibo = _ler_json((pasta / "treino.json").read_text(encoding="utf-8"))
    if recibo.get("estado") != "concluido" or recibo.get("modeloBase") != "qwen35-4b" or recibo.get("codigoMudouDuranteExecucao") is not False:
        raise ValueError("Use um adaptador concluído, da mesma base e com código estável.")
    for nome, chave_recibo in (("adapters.safetensors", "adaptadorSha256"), ("adapter_config.json", "configAdaptadorSha256")):
        if sha256(pasta / nome) != recibo.get(chave_recibo):
            raise ValueError("Adaptador/configuração diferente do recibo de treino.")
    return {"arquivo": str(pasta), "treinoSha256": sha256(pasta / "treino.json"),
            "adaptadorSha256": recibo["adaptadorSha256"], "configAdaptadorSha256": recibo["configAdaptadorSha256"]}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--corpus", type=Path, required=True)
    p.add_argument("--saida", type=Path, required=True)
    p.add_argument("--split", choices=tuple(DIVISOES), default="validation")
    p.add_argument("--adaptador", type=Path)
    p.add_argument("--modo", choices=("cascata", "condicional"), default="cascata")
    p.add_argument("--limite-casos", type=int)
    p.add_argument("--abrir-reserva", action="store_true")
    p.add_argument("--congelamento", type=Path)
    a = p.parse_args()
    if a.saida.exists() or (a.limite_casos is not None and not 1 <= a.limite_casos <= 96):
        p.error("Exija pasta nova e, se necessário, limite entre 1 e 96 casos.")
    casos, auditoria = carregar_casos(a.corpus, a.split, abrir_reserva=a.abrir_reserva, congelamento=a.congelamento)
    if a.limite_casos is not None:
        casos = casos[:a.limite_casos]
    adaptador = conferir_adaptador(a.adaptador)
    codigos = {r: sha256(RAIZ / r) for r in CODIGOS}
    a.saida.mkdir(parents=True, mode=0o700)
    (a.saida / "casos").mkdir()
    for relativo in CODIGOS:
        destino = a.saida / "codigo" / relativo
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(RAIZ / relativo, destino)
    recibo = {"versao": 1, "versaoAvaliador": 2, "estado": "iniciada", "inicio": datetime.now(timezone.utc).isoformat(),
              "modeloBase": "qwen35-4b", "adaptador": adaptador, "modo": a.modo, "split": a.split,
              "selecionados": [c["id"] for c in casos], "selecao": "prefixo na ordem congelada do corpus",
              "limiteCasos": a.limite_casos, "codigoSha256": codigos, "auditoriaDados": auditoria,
              "dependencias": {n: importlib.metadata.version(n) for n in ("mlx", "mlx-lm", "transformers", "outlines_core")},
              "config": {"temperatura": 0, "maxTokensOfertas": 650, "maxTokensJornada": 1300,
                         "maxSequencia": 8192, "decodificacao": "json_schema_outlines_core", "limiteMLXGiB": 6},
              "reserva": {"estado": "aberta_explicitamente" if a.split == "reserve" else "fechada",
                          "limite": "Reserva fechada é uma decisão de avaliação; não representa ausência de evidência no negócio."},
              "revisaoHumana": False, "prontoParaUsoComClientes": False, "resultados": [], "parciais": [], "tentados": []}
    salvar(a.saida / "avaliacao.json", recibo, exclusivo=True)
    salvar(a.saida / "referencias-selecionadas.json", casos, exclusivo=True)
    recibo["referenciasSelecionadasSha256"] = sha256(a.saida / "referencias-selecionadas.json")
    inicio = time.monotonic()
    modelo = tok = None
    try:
        from negocio.runtime_negocio import carregar_leitor
        from negocio.jornadas.executar import gerar
        modelo, tok, meta = carregar_leitor(a.adaptador, modelo_base="qwen35-4b")
        recibo["modelo"] = meta
        for caso in casos:
            recibo["tentados"].append(caso["id"])
            salvar(a.saida / "avaliacao.json", recibo)
            def salvar_etapa(etapa):
                relativo = "casos/" + caso["id"] + "-" + etapa["tipo"] + ".json"
                salvar(a.saida / relativo, etapa, exclusivo=True)
                recibo["parciais"].append({"casoId": caso["id"], "tarefaId": etapa["tarefaId"], "arquivo": relativo, "sha256": sha256(a.saida / relativo)})
                salvar(a.saida / "avaliacao.json", recibo)
            r = executar_caso(caso, lambda b, o=None: gerar(modelo, tok, b, o), modo=a.modo, ao_etapa=salvar_etapa)
            relativo = "casos/" + caso["id"] + ".json"
            salvar(a.saida / relativo, r, exclusivo=True)
            recibo["resultados"].append({"casoId": caso["id"], "arquivo": relativo, "sha256": sha256(a.saida / relativo)})
            salvar(a.saida / "avaliacao.json", recibo)
            print(json.dumps({"caso": caso["id"], "cascataExata": r["compreensaoEmCascataExata"], "segundos": r["segundos"]}), flush=True)
        recibo["estado"] = "concluida"
    except KeyboardInterrupt:
        recibo.update(estado="interrompida", erro="Interrupção solicitada; resultados anteriores preservados.")
    except Exception as e:
        recibo.update(estado="falhou", erro=type(e).__name__ + ": " + str(e))
    finally:
        resultados = [_ler_json((a.saida / r["arquivo"]).read_text(encoding="utf-8")) for r in recibo["resultados"]]
        parciais = [{"casoId": p["casoId"], "etapa": _ler_json((a.saida / p["arquivo"]).read_text(encoding="utf-8"))} for p in recibo["parciais"]]
        recibo.update(fim=datetime.now(timezone.utc).isoformat(), duracaoSegundos=time.monotonic() - inicio,
                      codigoMudouDuranteExecucao=any(sha256(RAIZ / r) != h for r, h in codigos.items()),
                      resumo=agregar(resultados, selecionados=casos, tentados=recibo["tentados"], parciais=parciais, estado=recibo["estado"], modo=a.modo))
        salvar(a.saida / "avaliacao.json", recibo)
        print(json.dumps({"estado": recibo["estado"], "resumo": recibo["resumo"]}, ensure_ascii=False), flush=True)
    if recibo["estado"] != "concluida":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
