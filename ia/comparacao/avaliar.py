"""Avalia escolhas em pares espelhados de contextos sintéticos."""

import argparse
from collections import defaultdict
import json
import os
from pathlib import Path
import sys
import time

PASTA = Path(__file__).resolve().parent
sys.path.append(str(PASTA.parent))
sys.path.append(str(PASTA.parent / "v2"))
from comparacao.contrato import INSTRUCAO, OPCOES, mensagens, serializar
from decodificar import arvore_sequencias
from runtime import MODELO, REVISAO, PASTA_MODELO, salvar_json, sha256, verificar_modelo, versoes


def gerar(modelo, tokenizer, entrada):
    import mlx.core as mx
    from mlx_lm import generate
    from mlx_lm.sample_utils import make_sampler
    prompt = tokenizer.apply_chat_template(mensagens(entrada), tokenize=True, return_dict=False, add_generation_prompt=True)
    if len(prompt) > 1152:
        raise ValueError("Contexto excede o limite; reduza evidências sem truncagem silenciosa.")
    opcoes = [serializar({"escolha": o}) for o in OPCOES]
    sequencias = [tokenizer.encode(o, add_special_tokens=False) for o in opcoes]
    if any(tokenizer.decode(s) != o for s, o in zip(sequencias, opcoes)):
        raise ValueError("Tokenizador não reproduz as opções.")
    arvore = arvore_sequencias(sequencias, tokenizer.eos_token_id)
    def limitar(tokens, logits):
        permitidos = arvore.get(tuple(tokens.tolist()[len(prompt):]))
        if not permitidos:
            raise RuntimeError("Sequência fora da gramática de comparação.")
        indices = mx.array(sorted(permitidos), dtype=mx.int32)
        mascara = mx.full(logits.shape, float("-inf"), dtype=logits.dtype)
        mascara[:, indices] = logits[:, indices]
        return mascara
    bruto = generate(modelo, tokenizer, prompt=prompt, max_tokens=max(map(len, sequencias)) + 2,
                     sampler=make_sampler(temp=0), logits_processors=[limitar], verbose=False)
    if bruto not in opcoes:
        raise RuntimeError("Resposta não pertence às opções.")
    return json.loads(bruto), bruto


def hashes():
    return {str(p.relative_to(PASTA.parent)): sha256(p) for p in (
        PASTA / "contrato.py", PASTA / "avaliar.py", PASTA.parent / "v2/decodificar.py")}


def carregar(adaptador=None):
    verificar_modelo()
    os.environ.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
    import mlx.core as mx
    from mlx_lm import load
    mx.random.seed(42)
    return load(str(PASTA_MODELO), adapter_path=str(adaptador) if adaptador else None, trust_remote_code=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adaptador", type=Path)
    parser.add_argument("--split", choices=("valid", "test"), required=True)
    parser.add_argument("--selecao", type=Path)
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    if args.saida.exists():
        parser.error("Resultado já existe.")
    dados = PASTA / "dados"
    manifesto = json.loads((dados / "manifest.json").read_text(encoding="utf-8"))
    arq = dados / f"casos-{args.split}.jsonl"
    if sha256(arq) != manifesto["arquivos"][arq.name]["sha256"]:
        raise ValueError("Split alterado em relação ao manifest.")
    if args.split == "test":
        if not args.selecao:
            parser.error("Congele a seleção antes de abrir o teste.")
        selecao = json.loads(args.selecao.read_text(encoding="utf-8"))
        if selecao["manifesto_sha256"] != sha256(dados / "manifest.json") or selecao["codigo_sha256"] != hashes():
            raise ValueError("Seleção não corresponde ao dataset ou avaliador atual.")
        if args.adaptador and sha256(args.adaptador / "adapters.safetensors") != selecao["adaptador_sha256"]:
            raise ValueError("Apenas o adaptador selecionado ou o modelo-base podem ser testados.")
    casos = [json.loads(l) for l in arq.read_text(encoding="utf-8").splitlines()]
    modelo, tokenizer = carregar(args.adaptador)
    resultados, pares = [], defaultdict(list)
    inicio = time.monotonic()
    for i, caso in enumerate(casos):
        try:
            escolha, bruto = gerar(modelo, tokenizer, caso["entrada"])
            erro = None
        except (ValueError, RuntimeError) as exc:
            escolha, bruto, erro = None, "", str(exc)
        correto = escolha == caso["esperado"]
        falsa_priorizacao = (caso["esperado"]["escolha"] == "insuficiente"
                             and isinstance(escolha, dict) and escolha.get("escolha") in ("a", "b"))
        r = {"id": caso["id"], "par": caso["par"], "grupo": caso["grupo"], "classe": caso["classe"],
             "esperado": caso["esperado"], "saida": escolha, "bruto": bruto, "erro": erro,
             "correto": correto, "priorizou_sem_base": falsa_priorizacao}
        resultados.append(r)
        pares[caso["par"]].append(r)
        print(f"comparação/{args.split}: {i + 1}/{len(casos)}", flush=True)
    if any(len(p) != 2 for p in pares.values()):
        raise ValueError("Caso sem par espelhado.")
    sem_base = [r for r in resultados if r["esperado"]["escolha"] == "insuficiente"]
    salvar_json(args.saida, {
        "tipo": "adaptador" if args.adaptador else "base", "split": args.split,
        "modelo": MODELO, "revisao": REVISAO, "versoes": versoes(), "temperatura": 0,
        "adaptador_sha256": sha256(args.adaptador / "adapters.safetensors") if args.adaptador else None,
        "config_adaptador_sha256": sha256(args.adaptador / "adapter_config.json") if args.adaptador else None,
        "manifesto_sha256": sha256(dados / "manifest.json"), "casos_sha256": sha256(arq), "codigo_sha256": hashes(),
        "duracao_segundos": time.monotonic() - inicio,
        "metricas": {"acertos": sum(r["correto"] for r in resultados), "total": len(resultados),
                     "pares_corretos": sum(all(r["correto"] for r in p) for p in pares.values()), "total_pares": len(pares),
                     "falsas_priorizacoes": sum(r["priorizou_sem_base"] for r in sem_base), "sem_base_total": len(sem_base)},
        "resultados": resultados,
        "limites": ["Pares sintéticos com autoria comum e sem revisão especializada.",
                    "Uma escolha de investigação não indica maior receita ou melhora real de ranking.",
                    "A gramática limita o formato; ela não garante a escolha correta."],
    }, exclusivo=True)
    print("Resultado salvo em " + str(args.saida))


if __name__ == "__main__":
    main()
