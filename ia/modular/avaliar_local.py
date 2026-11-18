"""Avaliação offline de ações cruas, regras e híbrido em casos congelados.

Não altera pesos, seleção de produção ou dados. Casos e hashes são argumentos.
Os rótulos técnicos/sintéticos não representam eficácia comercial ou revisão SEO.
"""

import argparse
from datetime import datetime
import gc
import json
import os
from pathlib import Path
import sys
import time

IA = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(IA))
sys.path.insert(0, str(IA / "reais"))
sys.path.insert(0, str(IA / "v3"))
os.environ.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
from runtime import RAIZ, salvar_json, sha256, versoes
from reais.inferir_web import (sanear_web, entrada_para_modelo, finalizar_web,
                              regra_publicacao, regra_sem_evidencias,
                              regra_serp_atual, regra_posicao_indisponivel)
from avaliar_v3 import carregar
from decodificar_v3 import gerar_escolha
from contrato_v3 import validar_escolha


def pontuar(escolha, caso, entrada, entregue=True):
    contrato = isinstance(escolha, dict) and not validar_escolha(escolha, entrada)
    alvo = any(escolha == e for e in caso["alvos"])
    acao = escolha.get("acao") if isinstance(escolha, dict) else None
    acao_correta = any(acao == e["acao"] for e in caso["alvos"])
    refs = escolha.get('evidencias',[]) if isinstance(escolha,dict) else []
    refs = set(refs) if isinstance(refs,list) and all(isinstance(r,str) for r in refs) else set()
    suficientes = contrato and any(acao == e['acao'] and set(e['evidencias']).issubset(refs) for e in caso['alvos'])
    utilidade = contrato and any(acao == e['acao'] and set(e['evidencias']).issubset(refs)
                               for e in caso.get('alvosUtilidade',caso['alvos']))
    return {"contrato_valido": contrato, "acao_adequada": acao_correta,
            "acao_referencias_adequadas": alvo, "entregue": entregue,
            "acao_adequada_entregue": alvo and entregue,
            "acao_com_referencias_suficientes": suficientes,
            "acao_suportada_entregue": suficientes and entregue,
            "acao_util_pelo_rotulo": utilidade,
            "acao_util_entregue": utilidade and entregue}


def avaliar(corpus, modos, splits, selecao_path=None):
    resultados = []
    agora = datetime.fromisoformat(corpus["relogioReferencia"].replace("Z", "+00:00"))
    casos = [c for c in corpus["casos"] if c["split"] in splits]
    if not casos:
        raise ValueError('A divisão solicitada não contém casos; a avaliação não será salva como teste vazio.')
    selecao_path = selecao_path or RAIZ / "data/ia/selecao-interface.json"
    selecao = json.loads(selecao_path.read_text())
    adaptador = Path(selecao["candidato"]["pasta"])
    if (sha256(adaptador / "adapters.safetensors") != selecao["adaptador_sha256"]
            or sha256(adaptador / "adapter_config.json") != selecao["candidato"]["config_adaptador_sha256"]):
        raise ValueError("Seleção ou adaptador local divergente; não substitua dados anteriores.")
    for modo in modos:
        inicio_carga = time.monotonic()
        modelo, tokenizer = carregar(adaptador if modo == "selecionado" else None)
        carga = time.monotonic() - inicio_carga
        for caso in casos:
            inicio = time.monotonic()
            entrada = sanear_web(caso["entrada"], agora=agora)
            regra = (regra_publicacao(entrada) or regra_sem_evidencias(entrada)
                     or regra_serp_atual(entrada) or regra_posicao_indisponivel(entrada))
            erro = None
            bruto, escolha = "", None
            try:
                bruto, escolha = gerar_escolha(modelo, tokenizer, entrada_para_modelo(entrada))
            except (ValueError, RuntimeError) as falha:
                erro = str(falha)
            resultado_cru = finalizar_web(escolha, caso["entrada"], "ia", agora=agora) if escolha else None
            resultado_regra = finalizar_web(regra, caso["entrada"], "regra", agora=agora) if regra else None
            resultado_hibrido = resultado_regra or resultado_cru
            escolha_final = resultado_hibrido.get("escolha_ia") if resultado_hibrido else None
            resultados.append({"id": caso["id"], "split": caso["split"], "familia": caso["familia"],
                "modo": modo, "cargaModeloSegundos": carga,
                "latenciaSegundos": time.monotonic() - inicio, "entradaSaneada": entrada,
                "alvos": caso["alvos"], "saidaBruta": bruto, "escolhaCrua": escolha, "erro": erro,
                "saidaCruaComBarreiras": resultado_cru, "saidaRegra": resultado_regra,
                "saidaHibrida": resultado_hibrido,
                "criteriosCru": pontuar(escolha, caso, entrada, escolha is not None),
                "criteriosRegra": pontuar(regra, caso, entrada, resultado_regra is not None and resultado_regra.get("estado") != "recusada"),
                "criteriosHibrido": pontuar(escolha_final, caso, entrada, resultado_hibrido is not None and resultado_hibrido.get("estado") != "recusada")})
            print(f"{modo} {caso['split']} {caso['id']} {len(resultados)}/{len(casos)*len(modos)} {time.monotonic()-inicio:.2f}s", flush=True)
        del modelo, tokenizer
        gc.collect()
        try:
            import mlx.core as mx
            mx.clear_cache()
        except (AttributeError, RuntimeError):
            pass
    metricas = {}
    for modo in modos:
        grupo = [r for r in resultados if r["modo"] == modo]
        metricas[modo] = {campo: {nome: {"quantidade": sum(r[campo][nome] for r in grupo), "total": len(grupo)}
                                          for nome in grupo[0][campo]}
                         for campo in ("criteriosCru", "criteriosRegra", "criteriosHibrido")} if grupo else {}
        metricas[modo]["falhasExecucao"] = {"quantidade": sum(r["erro"] is not None for r in grupo), "total": len(grupo)}
        metricas[modo]["ajustadasPorRegra"] = {"quantidade": sum(bool((r["saidaHibrida"] or {}).get("ajustada_por_regra")) for r in grupo), "total": len(grupo)}
    return {"versao": 1, "estado": "experimental", "treinoExecutado": False,
            "relogioReferencia": corpus["relogioReferencia"], "dependencias": versoes(),
            "selecaoSha256": sha256(selecao_path), "adaptadorSha256": sha256(adaptador / "adapters.safetensors"),
            "metricas": metricas, "resultados": resultados,
            "limites": ["A origem dos casos consta no corpus. Os rótulos técnicos não têm revisão profissional independente.",
                        "Ação e IDs corretos não demonstram utilidade ou efeito comercial real.",
                        "Escolha crua, barreiras e substituição por regras são mostradas separadamente.",
                        "Nenhum peso, seleção ou checkpoint foi alterado por este avaliador."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--casos", type=Path, required=True)
    parser.add_argument("--saida", type=Path, required=True)
    parser.add_argument("--splits", default="development")
    parser.add_argument("--modos", default="base,selecionado")
    parser.add_argument("--selecao", type=Path)
    args = parser.parse_args()
    if args.saida.exists():
        parser.error("A avaliação recusa sobrescrever resultados.")
    corpus = json.loads(args.casos.read_text())
    modos, splits = args.modos.split(","), args.splits.split(",")
    if any(m not in ("base", "selecionado") for m in modos):
        parser.error("Modos permitidos: base,selecionado.")
    resultado = avaliar(corpus, modos, splits, args.selecao)
    resultado["corpusSha256"] = sha256(args.casos)
    resultado["avaliadorSha256"] = sha256(Path(__file__))
    salvar_json(args.saida, resultado, exclusivo=True)
    print(json.dumps(resultado["metricas"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
