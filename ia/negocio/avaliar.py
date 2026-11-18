"""Avaliação offline dos campos, com saídas brutas e empresas preservadas."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
import shutil
import hashlib

IA = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(IA))
from runtime import salvar_json, sha256, versoes
from negocio.contrato import validar_entrada, validar_saida, normalizar


def chave_item(item, campo):
    atributo = "funcao" if campo == "publicos" else "tipo" if campo in ("ofertas", "atuacoes") else "escopo"
    chave = (normalizar(item.get("texto", "")).casefold(), normalizar(item.get(atributo, "")).casefold())
    return chave + (normalizar(item.get("escopo", "")).casefold(),) if campo == "publicos" else chave


def pontuar_campo(saida, esperado, entrada):
    """Exact labels are a conservative diagnostic, never U1-U4 utility."""
    erros = validar_saida(saida, entrada) if isinstance(saida, dict) else ["sem_json"]
    contrato = not erros
    campo = entrada.get("campo")
    metrica = {"contratoValido": contrato, "estadoExato": contrato and saida["estado"] == esperado["estado"],
               "valorExato": False, "referenciasDentroDoAlvo": False,
               "itensCorretos": 0, "itensEsperados": 0, "itensPropostos": 0}
    if campo is None:
        metrica["planejamentoRequerRevisaoSemantica"] = True
        metrica["abstencaoEsperadaCorreta"] = contrato and esperado["estado"] == "insuficiente" and saida["estado"] == "insuficiente"
        return metrica
    if campo in ("papel", "finalidade"):
        metrica["valorExato"] = contrato and saida["valor"] == esperado["valor"] and saida["estado"] == esperado["estado"]
    else:
        gold = {chave_item(i,campo) for i in esperado["valor"]}
        pred = {chave_item(i,campo) for i in saida["valor"]} if contrato else set()
        metrica.update(itensCorretos=len(gold & pred), itensEsperados=len(gold), itensPropostos=len(pred),
                       valorExato=contrato and gold == pred and saida["estado"] == esperado["estado"])
    if contrato:
        refs, goldrefs = set(saida["fontes"]), set(esperado["fontes"])
        metrica["referenciasDentroDoAlvo"] = refs.issubset(goldrefs) and (bool(refs) or esperado["estado"] == "insuficiente")
    metrica["valorERefsExatos"] = metrica["valorExato"] and metrica["referenciasDentroDoAlvo"]
    return metrica


def resumo(resultados):
    grupos = {}
    for r in resultados:
        campo = r["entrada"].get("campo", "recomendar")
        m = grupos.setdefault(campo, {"casos":0, "contratoValido":0, "valorExato":0,
            "valorERefsExatos":0, "naoExecutados":0, "falhasExecucao":0,
            "itensCorretos":0, "itensEsperados":0, "itensPropostos":0})
        m["casos"] += 1
        for k in ("contratoValido", "valorExato", "valorERefsExatos", "itensCorretos", "itensEsperados", "itensPropostos"):
            m[k] += r["metricas"].get(k, 0)
        m["naoExecutados"] += not r["geracao"].get("inferida",False)
        m["falhasExecucao"] += r["geracao"].get("estado") == "erro_execucao"
    return grupos


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--saida", type=Path, required=True)
    parser.add_argument("--adaptador", type=Path)
    parser.add_argument("--modelo-base",choices=("qwen25-15b","qwen3-4b","qwen35-4b","qwen35-9b"),default="qwen25-15b")
    parser.add_argument("--prompt",choices=("v3","v4","v5"),default="v3")
    parser.add_argument("--prompt-plano",choices=("v3","v4","v5"),help="Protocolo separado só para tarefas recomendar.")
    parser.add_argument("--alinhar-template",action="store_true")
    parser.add_argument("--decodificacao",choices=("livre","esquema"),default="livre")
    parser.add_argument("--splits", default="validation")
    parser.add_argument("--campos", default="papel,finalidade,ofertas,publicos,atuacoes,condicoes,recomendar")
    parser.add_argument("--max-tokens", type=int, default=640)
    parser.add_argument("--max-sequencia", type=int, default=3072)
    parser.add_argument("--prefixo-json", action="store_true")
    args = parser.parse_args()
    if args.saida.exists():
        parser.error("Saída existente; preserve os experimentos anteriores.")
    capsula=args.saida.with_suffix(".codigo")
    capsula.mkdir(parents=True,exist_ok=False)
    hashes_codigo={}
    for nome in ("contrato.py","runtime_negocio.py","modelos.py","avaliar.py","prompts.py","protocolo.py","esquema.py","decodificacao/core_mlx.py"):
        origem=Path(__file__).parent/nome;hashes_codigo[nome]=sha256(origem);(capsula/nome).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(origem,capsula/nome)
    dados = json.loads(args.corpus.read_text())
    splits, campos = set(args.splits.split(",")), set(args.campos.split(","))
    casos = [c for c in dados["casos"] if c["split"] in splits and c["entrada"].get("campo", "recomendar") in campos]
    if not casos:
        raise ValueError("Avaliação vazia não é sucesso.")
    for c in casos:
        if validar_entrada(c["entrada"]) or validar_saida(c["esperado"], c["entrada"]):
            raise ValueError("Caso/alvo incompatível antes da inferência: " + c["id"])
    from negocio.runtime_negocio import carregar_leitor, gerar_negocio
    modelo, tokenizer, identidade = carregar_leitor(args.adaptador,args.modelo_base)
    resultados = []
    inicio = datetime.now(timezone.utc).isoformat()
    journal=args.saida.with_suffix(".parcial.jsonl")
    journal.touch(exist_ok=False)
    for n,c in enumerate(casos):
        try:
            g = gerar_negocio(modelo, tokenizer, c["entrada"], max_tokens=args.max_tokens,
                max_sequencia=args.max_sequencia, prefixo_json=args.prefixo_json,
                versao_prompt=(args.prompt_plano or args.prompt) if c["entrada"]["tarefa"]=="recomendar" else args.prompt,
                alinhar_template=args.alinhar_template,decodificacao=args.decodificacao)
        except (ValueError, RuntimeError) as falha:
            g = {"estado":"erro_execucao", "erro":str(falha), "inferida":False, "saida":None}
        m = pontuar_campo(g.get("saida"), c["esperado"], c["entrada"])
        r = {k:c[k] for k in ("id", "split", "entrada", "esperado")}
        r.update(dominio=c.get("dominio"), grupoEmpresarial=c.get("grupoEmpresarial"),
                 natureza=c.get("natureza"),geracao=g,metricas=m,
                 entradaSha256=hashlib.sha256(json.dumps(c["entrada"],sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()).hexdigest())
        resultados.append(r)
        with journal.open("a") as j:j.write(json.dumps(r,ensure_ascii=False)+"\n")
        print(json.dumps({"n":n+1,"total":len(casos),"id":c["id"],"estado":g["estado"],
            "contratoValido":m["contratoValido"],"valorExato":m["valorExato"]}),flush=True)
    res={"versao":1,"estado":"experimental","inicio":inicio,"fim":datetime.now(timezone.utc).isoformat(),
        "modelo":identidade,"corpusSha256":sha256(args.corpus),"avaliadorSha256":sha256(Path(__file__)),
        "contratoSha256":hashes_codigo["contrato.py"],"dependencias":versoes(),"codigoExecutado":hashes_codigo,
        "capsulaCodigo":str(capsula),"codigoMudouDuranteExecucao":any(sha256(Path(__file__).parent/n)!=h for n,h in hashes_codigo.items()),
        "config":{"maxTokens":args.max_tokens,"maxSequencia":args.max_sequencia,"prefixoJson":args.prefixo_json,
                  "prompt":args.prompt,"promptPlano":args.prompt_plano or args.prompt,"alinharTemplate":args.alinhar_template,
                  "decodificacao":{"modo":args.decodificacao,"esquemaFonteSha256":hashes_codigo["esquema.py"]},
                  "splits":sorted(splits),"campos":sorted(campos)},"metricas":resumo(resultados),
        "resultados":resultados,"limite":"Campos e referências exatos não medem decisão útil, receita ou confiança comercial. Revisão semântica independente obrigatória para conclusões de utilidade."}
    salvar_json(args.saida,res,exclusivo=True)
    print(json.dumps(res["metricas"]),flush=True)


if __name__ == "__main__":
    main()
