"""Executa a terceira rodada no relatório local, com barreiras conservadoras."""

import argparse
from datetime import datetime, timezone
import json
import re
from pathlib import Path
import sys

PASTA = Path(__file__).resolve().parent
IA = PASTA.parent
sys.path.insert(0, str(IA))
sys.path.insert(0, str(IA / "v2"))
sys.path.insert(0, str(PASTA))
from runtime import RAIZ, MODELO, REVISAO, salvar_json, sha256
from inferir_v2 import sanear, validar_aplicabilidade
from contrato_v3 import apresentar
from avaliar_v3 import carregar
from decodificar_v3 import gerar_escolha


def bloqueios(escolha, entrada):
    existentes = validar_aplicabilidade(escolha, entrada)
    if existentes:
        return existentes
    ids = escolha["evidencias"]
    citadas = [e for e in entrada["evidencias"] if e.get("id") in ids]
    paginas = [e for e in citadas if e.get("tipo") == "pagina" and e.get("atual") is True]
    def diretiva_observada(e):
        v = e.get("verificacao")
        return (e.get("tipo") == "pagina" and e.get("atual") is True and isinstance(v, dict)
                and v.get("tipo") == "meta_robots_noindex" and v.get("escopo") == "html_inicial"
                and v.get("intencao") == "desconhecida" and isinstance(e.get("sha256_pagina"), str)
                and re.fullmatch(r"[a-f0-9]{64}", e["sha256_pagina"]) is not None)
    indícios = [e for e in entrada["evidencias"] if diretiva_observada(e)]
    objetivo = entrada.get("objetivo", "")
    if (escolha["acao"] not in ("confirmar_publicacao", "corrigir_indexacao", "preservar_exclusao")
            and isinstance(objetivo, str) and re.search(r"indexa|noindex|diretiva|publica", objetivo, re.I)
            and indícios):
        return ["Há uma diretiva observada relevante à pergunta. Confirme a intenção de publicação antes de outra recomendação."]
    if escolha["acao"] == "validar_intencao":
        buscas = [e for e in citadas if e.get("tipo") == "serp" and e.get("atual") is True]
        if not paginas or not buscas:
            return ["A intenção precisa de evidência recente da consulta e da página; a escolha não cita ambas."]
    if escolha["acao"] == "preservar_exclusao":
        return ["A coleta pública não confirma a intenção do responsável. Confirme antes de classificar a exclusão como proposital."]
    if escolha["acao"] == "confirmar_publicacao":
        if not any(diretiva_observada(e) for e in paginas):
            return ["A indicação exige uma diretiva no HTML inicial, identificada e citada com a página e seu hash."]
    if escolha["acao"] == "medir_conversao" and citadas and not any(e.get("tipo") == "negocio" for e in citadas):
        return ["A escolha cita evidências de página ou posição como se fossem dados comerciais; revise as fontes citadas."]
    return []


def preservar_estado_fonte(original, limpa, agora=None):
    """Mantém motivo verificado da indisponibilidade; não restaura posição vencida."""
    por_id = {e.get("id"):e for e in original.get("evidencias", []) if isinstance(e, dict)}
    for e in limpa["evidencias"]:
        antiga = por_id.get(e.get("id"), {})
        if e.get("tipo") != "serp" or e.get("atual") is True:
            continue
        estado = antiga.get("estado_fonte")
        if estado == "nao_configurada":
            e["estado_fonte"] = estado
            e["descricao"] = "A fonte de posições não está configurada; posição e concorrentes atuais são desconhecidos."
        elif estado == "cota_esgotada":
            e["estado_fonte"] = estado
            e["descricao"] = "A cota da fonte de posições está esgotada; posição e concorrentes atuais são desconhecidos."
        elif estado == "nao_consultada":
            e["estado_fonte"] = estado
            e["descricao"] = "Nesta análise nenhuma fonte de resultados do Google foi consultada; posição e concorrentes são desconhecidos."
        elif estado == "nao_observado_recorte":
            # A posição continua desconhecida; as páginas válidas provam apenas
            # o que foi ou não observado naquele recorte enquanto ele é recente.
            paginas = antiga.get("recorte_serp")
            instante = agora or datetime.now(timezone.utc)
            ids = set()
            def pagina_recente(p):
                if (not isinstance(p, dict) or not isinstance(p.get("id"), str)
                    or re.fullmatch(r"[a-zA-Z0-9_-]{8,128}", p["id"]) is None
                    or p["id"] in ids or not isinstance(p.get("sha256"), str)
                    or re.fullmatch(r"[a-f0-9]{64}", p["sha256"]) is None):
                    return False
                try:
                    data = datetime.fromisoformat(p.get("observado_em", "").replace("Z", "+00:00"))
                    idade = (instante-data).total_seconds()
                except (TypeError, ValueError, AttributeError):
                    return False
                ids.add(p["id"])
                return 0 <= idade < 3600
            if (antiga.get("posicao") is None and isinstance(paginas, list) and 1 <= len(paginas) <= 5
                    and all(pagina_recente(p) for p in paginas)):
                e["estado_fonte"] = estado
                e["descricao"] = "Site não observado nas páginas verificadas; isso não comprova ausência no Google nem uma posição específica."
            else:
                e["estado_fonte"] = "desconhecida"
                e.pop("recorte_serp", None)
    return limpa


def orientar_disponibilidade(resultado, entrada):
    if resultado.get("estado") == "recusada" or resultado.get("escolha_ia", {}).get("acao") != "atualizar_coleta":
        return resultado
    estados = {e.get("estado_fonte") for e in entrada["evidencias"] if e.get("tipo") == "serp"}
    if "nao_configurada" in estados:
        resultado["orientacao_padrao"] = "Configure uma fonte de posições compatível antes de solicitar nova consulta. Sem ela, a posição e os concorrentes seguem desconhecidos."
    elif "cota_esgotada" in estados:
        resultado["orientacao_padrao"] = "Aguarde a renovação da cota ou consulte os limites da fonte antes de tentar novamente."
    elif "nao_consultada" in estados:
        resultado["orientacao_padrao"] = "Verifique a disponibilidade de uma fonte compatível e faça a consulta antes de informar posição ou concorrentes."
    elif "nao_observado_recorte" in estados:
        resultado["orientacao_padrao"] = "Confira as páginas já verificadas e o alcance do recorte antes de buscar mais resultados. A posição do site permanece desconhecida."
    elif "sem_captura_validavel" in estados:
        resultado["orientacao_padrao"] = "Obtenha uma captura recente e identificada antes de informar posição ou concorrentes."
    return resultado


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entrada", type=Path, default=RAIZ / "data/ia/entrada.json")
    parser.add_argument("--selecao", type=Path, default=RAIZ / "data/ia/v3-selecao.json")
    parser.add_argument("--saida", type=Path, default=RAIZ / "data/ia/v3-recomendacoes.json")
    args = parser.parse_args()
    if args.entrada.stat().st_size > 1024 * 1024:
        parser.error("Entrada grande demais.")
    envelope = json.loads(args.entrada.read_text(encoding="utf-8"))
    if (not isinstance(envelope, dict) or envelope.get("versao") != 1
            or not isinstance(envelope.get("entradas"), list) or not 1 <= len(envelope["entradas"]) <= 3):
        parser.error("Use um envelope exportado pelo aplicativo local.")
    selecao = json.loads(args.selecao.read_text(encoding="utf-8"))
    adaptador = Path(selecao["candidato"]["pasta"])
    if (sha256(adaptador / "adapters.safetensors") != selecao["adaptador_sha256"]
            or sha256(adaptador / "adapter_config.json") != selecao["candidato"]["config_adaptador_sha256"]):
        raise ValueError("Adaptador ou configuração alterados desde a seleção.")
    entradas = [preservar_estado_fonte(e, sanear(e)) for e in envelope["entradas"]]
    modelo, tokenizer = carregar(adaptador)
    resultados = []
    for entrada in entradas:
        bruto, escolha = gerar_escolha(modelo, tokenizer, entrada)
        resultado = apresentar(escolha, entrada)
        if resultado["estado"] != "recusada":
            motivos = bloqueios(escolha, entrada)
            if motivos:
                resultado.update(estado="recusada", motivos_aplicabilidade=motivos)
        orientar_disponibilidade(resultado, entrada)
        resultados.append({"entrada": entrada, "saida_bruta": bruto, **resultado})
    salvar_json(args.saida, {"versao": 3, "estado": "experimental", "modelo": MODELO, "revisao": REVISAO,
                             "adaptador_sha256": selecao["adaptador_sha256"], "resultados": resultados,
                             "aviso": "Revisão humana necessária; o formato e as barreiras não garantem correção."})
    print("Análise experimental salva em " + str(args.saida))


if __name__ == "__main__":
    main()
