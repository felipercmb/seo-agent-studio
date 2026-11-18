"""Projeção derivada experimental de listas, exclusivamente para revisão.

Não corrige JSON, textos, escopos ou referências. Não é chamada pelo runtime.
Uma parte estruturalmente válida pode continuar semanticamente errada.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

from negocio import contrato

CAMPOS = {"ofertas", "publicos", "atuacoes", "condicoes"}


def _hash(raw):
    return hashlib.sha256(raw).hexdigest()


def projetar_itens_para_revisao(bruto, entrada):
    """Retém somente itens validados individualmente pelo contrato atual.

    Envelope/global refs/cardinalidade permanecem os do original. O único
    campo alterável na derivada é valor, pela remoção de itens inteiros. Se
    nenhum passar, não há derivada nem abstenção fabricada. O resultado nunca
    é apresentado como novo acerto do modelo ou aprovação semântica.
    """
    result = {"versao": 1, "estado": "recusada", "brutoOriginal": bruto,
              "brutoSha256": _hash(bruto.encode()) if isinstance(bruto, str) else None,
              "entradaSha256": None, "contratoSha256": _hash(Path(contrato.__file__).read_bytes()),
              "original": None, "originalAceitoPeloContrato": None, "errosOriginais": [],
              "errosEnvelope": [], "retidos": [], "descartados": [], "saidaDerivada": None,
              "saidaDerivadaSha256": None, "projecaoParcial": False,
              "uso": "somente_revisao_humana_local", "revisaoSemanticaPendente": True,
              "aprovacaoHumana": False, "novoAcertoDoModelo": False,
              "limites": ["Validade individual não garante completude, negação, escopo, relação de atores ou utilidade.",
                          "Descartar outro item pode retirar um qualificador essencial; não encadear automaticamente.",
                          "Referências globais extras são preservadas; não equivalem a evidência semântica de cada item."]}
    erros_entrada = contrato.validar_entrada(entrada)
    if erros_entrada:
        result["errosEnvelope"] = ["entrada:" + erro for erro in erros_entrada]
        return result
    result["entradaSha256"] = _hash(json.dumps(entrada, sort_keys=True, ensure_ascii=False,
                                              separators=(",", ":"), allow_nan=False).encode())
    if entrada["tarefa"] != "entender" or entrada["campo"] not in CAMPOS:
        result["errosEnvelope"] = ["campo_fora_do_escopo_da_projecao"]
        return result
    try:
        original = contrato.ler_json_estrito(bruto)
    except (ValueError, TypeError, RecursionError):
        result["errosEnvelope"] = ["json_original_invalido_ou_ausente"]
        return result
    result["original"] = deepcopy(original)
    # Evita exceções sobre tipos sem introduzir normalização ou valores padrão.
    if not contrato.objeto_exato(original, contrato.CHAVES_LEITURA):
        result["errosEnvelope"] = ["chaves_saida_invalidas"]
        return result
    campo = entrada["campo"]
    erros = contrato.validar_saida(original, entrada)
    result["errosOriginais"] = list(erros)
    result["originalAceitoPeloContrato"] = not erros
    if original["estado"] == "insuficiente" and not erros:
        result["estado"] = "original_valido_sem_itens_sem_projecao"
        return result
    maximo = 6 if campo == "publicos" else 4
    if original["estado"] != "hipotese" or not isinstance(original["valor"], list):
        result["errosEnvelope"] = ["projecao_exige_hipotese_com_lista_original"]
        return result
    if not 1 <= len(original["valor"]) <= maximo:
        result["errosEnvelope"] = ["cardinalidade_original_invalida"]
        return result
    prefixo_item = re.compile(r"^" + re.escape(campo) + r":\d+:")
    # Qualquer erro que não pertence a um item é bloqueante. Isso inclui
    # globals desconhecidas/duplicadas/interface, faltam e topologia/estado.
    envelope = [erro for erro in erros if not prefixo_item.match(erro)]
    if envelope:
        result["errosEnvelope"] = envelope
        return result
    for indice, item in enumerate(original["valor"]):
        isolado = deepcopy(original)
        isolado["valor"] = [deepcopy(item)]
        falhas = contrato.validar_saida(isolado, entrada)
        if falhas:
            result["descartados"].append({"indiceOriginal": indice, "itemOriginal": deepcopy(item),
                                          "errosIsolados": list(falhas),
                                          "errosNoOriginal": [e for e in erros if e.startswith(f"{campo}:{indice}:")]})
        else:
            result["retidos"].append({"indiceOriginal": indice, "itemOriginal": deepcopy(item)})
    if not result["retidos"]:
        result["estado"] = "nenhum_item_retido_sem_derivada"
        return result
    derivada = deepcopy(original)
    derivada["valor"] = [deepcopy(v["itemOriginal"]) for v in result["retidos"]]
    erros_derivada = contrato.validar_saida(derivada, entrada)
    if erros_derivada:
        # Falha fechada caso o contrato deixe de ser composicional no futuro.
        result["estado"] = "projecao_recusada_pelo_contrato"
        result["errosEnvelope"] = erros_derivada
        return result
    result["estado"] = "projecao_parcial_para_revisao" if result["descartados"] else "original_valido_sem_recuperacao"
    result["projecaoParcial"] = bool(result["descartados"])
    result["saidaDerivada"] = derivada
    result["saidaDerivadaSha256"] = _hash(json.dumps(derivada, sort_keys=True, ensure_ascii=False,
                                                    separators=(",", ":"), allow_nan=False).encode())
    return result
