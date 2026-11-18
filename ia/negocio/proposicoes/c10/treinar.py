"""Experimento LoRA de jornadas, offline, sem promover o adaptador ao produto.

Por padrão somente verifica os dados e o tokenizer local. --executar inicia
um único subprocesso MLX com orçamento de 6 GiB, perda em blocos e prazo.
Treino e verificação sempre exigem uma pasta de saída nova.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

IA = Path(__file__).resolve().parents[3]
RAIZ = IA.parent
sys.path.insert(0, str(IA))
os.environ.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                  HF_HUB_DISABLE_IMPLICIT_TOKEN="1", TRANSFORMERS_OFFLINE="1",
                  TOKENIZERS_PARALLELISM="false", PYTHONUNBUFFERED="1")

MODELO = "qwen35-4b"
MEMORIA_GIB = 6
LIMITE_CACHE = 128 * 1024 ** 2
ARQUIVOS_DADOS = {"treino":"train.jsonl","validacao":"valid.jsonl"}
from negocio.proposicoes.c10.executar import codigo
CODIGOS = tuple(codigo()) + ("ia/runtime.py","ia/negocio/treino_memoria/perda_em_blocos.py",)


def sha256(valor):
    if isinstance(valor, Path):
        h = hashlib.sha256()
        with valor.open("rb") as arquivo:
            for bloco in iter(lambda: arquivo.read(1024 ** 2), b""):
                h.update(bloco)
        return h.hexdigest()
    return hashlib.sha256(valor.encode("utf-8") if isinstance(valor, str) else valor).hexdigest()


def agora():
    return datetime.now(timezone.utc).isoformat()


def salvar(caminho, conteudo, *, exclusivo=False):
    with Path(caminho).open("x" if exclusivo else "w", encoding="utf-8", newline="\n") as arquivo:
        json.dump(conteudo, arquivo, ensure_ascii=False, indent=2, allow_nan=False)
        arquivo.write("\n")


def _ler_json(texto):
    def objeto(pares):
        r = {}
        for k, v in pares:
            if k in r:
                raise ValueError("Chave JSON repetida: " + k)
            r[k] = v
        return r

    def constante(valor):
        raise ValueError("Número não finito em JSON: " + valor)

    return json.loads(texto, object_pairs_hook=objeto, parse_constant=constante)


def conferir_corpus(corpus):
    from negocio.proposicoes.c10.dados import conferir
    from negocio.proposicoes.c10.protocolo import mensagens
    from negocio.proposicoes.contrato import validar_ofertas,validar_proposicoes
    pasta=Path(corpus);m=_ler_json((pasta/"manifesto.json").read_text())
    if m.get("natureza")!="controlado_autoral_com_dev_publico" or m.get("fontesPrivadas") is not False:raise ValueError("Corpus não autorizado.")
    for rel,h in m["codigoGeracaoSha256"].items():
        if Path(rel).is_absolute() or ".." in Path(rel).parts or sha256(RAIZ/rel)!=h:raise ValueError("Gerador mudou; regenere corpus novo.")
    if m["protocoloSha256"]!=sha256(Path(__file__).with_name("protocolo.py")):raise ValueError("Protocolo divergente.")
    registros=[];dados={}
    for divisao,nome in (("treino","train"),("validacao","valid")):
        arquivos=[nome+".jsonl","tarefas-"+nome+".jsonl"]
        for rel in arquivos:
            if sha256(pasta/rel)!=m["arquivosSha256"][rel]:raise ValueError("Corpus adulterado.")
        tarefas=[_ler_json(t) for t in (pasta/arquivos[1]).read_text().splitlines()]
        ms=[_ler_json(t) for t in (pasta/arquivos[0]).read_text().splitlines()]
        if len(ms)!=len(tarefas):raise ValueError("Contagens divergentes.")
        dados[divisao]=[]
        for t,conversa in zip(tarefas,ms):
            if conversa!={"messages":t["messages"]} or t["messages"][:-1]!=mensagens(t["documento"],t["oferta"]):raise ValueError("Mensagem fora do protocolo.")
            v=validar_proposicoes(t["alvo"],t["documento"],t["oferta"]) if t["oferta"] else validar_ofertas(t["alvo"],t["documento"])
            if v.get("erro") or v.get("recusadas"):raise ValueError("Alvo recusado.")
            dados[divisao].append({"messages":t["messages"],"metadados":{"tarefaId":t["id"],"familia":t["familia"],"entidadeFicticia":t["entidade"],"origem":t["origem"]}})
        registros += tarefas
    resumo=conferir(registros)
    return dados,{"manifestoSha256":sha256(pasta/"manifesto.json"),"arquivosVerificadosSha256":{r:sha256(pasta/r) for r in m["arquivosSha256"]},"divisoes":resumo["splits"],"novasReservasLidas":False,"limite":"Validação controlada/DEV, sem ouro reservado novo; não certifica qualidade para clientes."}


def tokenizar(dados, tokenizer):
    from negocio.protocolo import prefixo_assistente
    tamanhos, prefixos = [], Counter()
    for divisao, registros in dados.items():
        for r in registros:
            ms = r["messages"]
            ids = tokenizer.apply_chat_template(ms, tokenize=True, return_dict=False)
            if not isinstance(ids, list) or not ids or not all(type(t) is int for t in ids):
                raise ValueError("Tokenizer não retornou uma sequência inteira de IDs.")
            fronteira = prefixo_assistente(tokenizer, ms[:-1])
            prefixos[fronteira["prefixo"]] += 1
            tamanhos.append({"tarefaId": r["metadados"]["tarefaId"], "divisao": divisao,
                             "tokens": len(ids), "tokensSha256": sha256(json.dumps(ids, separators=(",", ":")))})
    return {"exemplos": tamanhos,
            "resumo": {d: {"exemplos": sum(x["divisao"] == d for x in tamanhos),
                            "minTokens": min(x["tokens"] for x in tamanhos if x["divisao"] == d),
                            "maxTokens": max(x["tokens"] for x in tamanhos if x["divisao"] == d)} for d in dados},
            "prefixosDoTemplatePresentesNoAlvo": dict(prefixos), "truncamento": False}


def criar_config(saida, pasta_modelo, *, passos=80, max_sequencia=1536):
    if type(passos) is not int or not 1 <= passos <= 160:
        raise ValueError("Use de 1 a 160 passos por experimento.")
    if type(max_sequencia) is not int or not 512 <= max_sequencia <= 4096:
        raise ValueError("Limite de sequência deve estar entre 512 e 4096.")
    return {"seed": 42, "model": str(Path(pasta_modelo).resolve()), "data": str((Path(saida) / "dados").resolve()),
            "adapter_path": str(Path(saida).resolve()), "train": True, "test": False,
            "trust_remote_code": False, "report_to": None, "fine_tune_type": "lora", "optimizer": "adam",
            "num_layers": 1, "batch_size": 1, "iters": passos, "learning_rate": 2e-5,
            "max_seq_length": max_sequencia, "mask_prompt": True, "grad_checkpoint": True,
            "steps_per_report": min(5, passos), "steps_per_eval": min(20, passos),
            "val_batches": 8, "save_every": min(20, passos),
            "lora_parameters": {"keys": ["self_attn.q_proj", "self_attn.v_proj"], "rank": 8, "scale": 10.0, "dropout": 0.0}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--corpus", type=Path, required=True)
    p.add_argument("--saida", type=Path, required=True)
    p.add_argument("--passos", type=int, default=80)
    p.add_argument("--max-sequencia", type=int, default=1536)
    p.add_argument("--limite-segundos", type=int, default=2400)
    p.add_argument("--executar", action="store_true", help="Sem esta opção, não carrega pesos nem usa GPU.")
    a = p.parse_args()
    if a.saida.exists() or not 60 <= a.limite_segundos <= 2700:
        p.error("A saída deve ser nova e o prazo deve estar entre 60 e 2700 segundos.")
    # Verificar parâmetros antes de produzir arquivos, sem importar MLX.
    criar_config(a.saida, RAIZ, passos=a.passos, max_sequencia=a.max_sequencia)
    a.saida.mkdir(parents=True, mode=0o700)
    recibo = {"versao": 1, "estado": "iniciado", "inicio": agora(), "modeloBase": MODELO,
              "novoAjustePesos": False, "ajustePesosTentado": False, "selecaoPadraoAlterada": False, "modeloAnteriorAlterado": False,
              "protocoloSha256":sha256(Path(__file__).with_name("protocolo.py")), "execucaoSolicitada": a.executar, "limiteMemoriaMLXGiB": MEMORIA_GIB,
              "limiteCacheMLXBytes": LIMITE_CACHE, "perda": {"modo": "qwen35_head_ce_em_blocos_ponderada_fork_lcp8", "bloco": 128},
              "revisaoHumana": False, "prontoParaUsoComClientes": False}
    inicio = time.monotonic()
    processo = None
    retorno = 1
    codigos = {r: sha256(RAIZ / r) for r in CODIGOS}
    try:
        dados, auditoria = conferir_corpus(a.corpus)
        salvar(a.saida / "auditoria-dados.json", auditoria, exclusivo=True)
        from negocio.modelos import verificar_base
        pasta_modelo, proveniencia = verificar_base(MODELO)
        recibo["modeloBaseProveniencia"] = proveniencia
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(str(pasta_modelo), local_files_only=True, trust_remote_code=False)
        tamanhos = tokenizar(dados, tokenizer)
        from negocio.proposicoes.c10.ponderacao import preparar_pesos
        tabela=preparar_pesos(dados,tokenizer)
        salvar(a.saida/'pesos-tokens.json',tabela,exclusivo=True)
        recibo['ponderacao']={'pesoDecisao':8,'simetrico':True,'demaisTokens':1,'pesosSha256':sha256(a.saida/'pesos-tokens.json'),'experimentoIsolado':'C10: corpus C8 mais contrastes controlados de atores, condições, testemunhos e atividades. Mesmo peso8 no fork LCP C9. Experimento composto; não isola efeito de cada exemplo.'}
        salvar(a.saida / "tokenizacao.json", tamanhos, exclusivo=True)
        maior = max(x["tokens"] for x in tamanhos["exemplos"])
        recibo["maxTokensVerificados"] = maior
        if maior > a.max_sequencia:
            raise ValueError("Treino truncaria exemplos: máximo " + str(maior) + ", limite " + str(a.max_sequencia) + ". Aumente explicitamente o limite ou refaça os dados; nenhum alvo foi cortado.")
        (a.saida / "dados").mkdir()
        for divisao, nome in (("treino", "train.jsonl"), ("validacao", "valid.jsonl")):
            shutil.copy2(a.corpus / ARQUIVOS_DADOS[divisao], a.saida / "dados" / nome)
            if sha256(a.saida / "dados" / nome) != auditoria["arquivosVerificadosSha256"][ARQUIVOS_DADOS[divisao]]:
                raise ValueError("Dataset mudou entre a verificação e a cópia; treino não iniciado.")
        shutil.copy2(a.corpus / "manifesto.json", a.saida / "manifesto-dados-fonte.json")
        cfg = criar_config(a.saida, pasta_modelo, passos=a.passos, max_sequencia=a.max_sequencia)
        salvar(a.saida / "config-executada.json", cfg, exclusivo=True)
        recibo.update(dadosManifestoSha256=auditoria["manifestoSha256"], config=cfg,
                      dadosCopiadosSha256={n: sha256(a.saida / "dados" / n) for n in ("train.jsonl", "valid.jsonl")},
                      codigoExecutado=codigos, maxSequencia=a.max_sequencia,
                      dependencias={n: importlib.metadata.version(n) for n in ("mlx", "mlx-lm", "transformers")})
        for relativo in CODIGOS:
            destino = a.saida / "codigo" / relativo
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(RAIZ / relativo, destino)
        if {r: sha256(RAIZ / r) for r in CODIGOS} != codigos:
            raise ValueError("Código mudou durante o preflight; não iniciar treino com versões misturadas.")
        if not a.executar:
            recibo["estado"] = "verificado_sem_treino"
            retorno = 0
        else:
            recibo.update(estado="em_treino", ajustePesosTentado=True)
            salvar(a.saida / "treino.json", recibo)
            with (a.saida / "treino.log").open("x", encoding="utf-8") as log:
                processo = subprocess.Popen([sys.executable, str(Path(__file__).with_name("bootstrap.py")),
                    "--config", str((a.saida / "config-executada.json").resolve()),
                    "--metricas", str((a.saida/"metricas-gpu.json").resolve()),
                    "--pesos",str((a.saida/'pesos-tokens.json').resolve())],
                    cwd=RAIZ, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                retorno = processo.wait(timeout=a.limite_segundos)
            recibo.update(estado="concluido" if retorno == 0 else "falhou", codigoSaida=retorno)
            if retorno == 0 and not all((a.saida / n).is_file() for n in ("adapters.safetensors", "adapter_config.json")):
                raise ValueError("Treinador terminou sem produzir adaptador e configuração.")
    except subprocess.TimeoutExpired:
        recibo.update(estado="interrompido_prazo", erro="Prazo do subprocesso atingido.")
    except KeyboardInterrupt:
        recibo.update(estado="interrompido_usuario", erro="Treino interrompido.")
    except Exception as e:
        recibo.update(estado="falhou", erro=type(e).__name__ + ": " + str(e))
    finally:
        if processo is not None and processo.poll() is None:
            processo.terminate()
            try:
                processo.wait(timeout=10)
            except subprocess.TimeoutExpired:
                processo.kill()
                processo.wait(timeout=10)
        recibo.update(fim=agora(), duracaoSegundos=time.monotonic() - inicio,
                      codigoMudouDuranteExecucao=any(sha256(RAIZ / r) != h for r, h in codigos.items()))
        for nome, chave_recibo in (("adapters.safetensors", "adaptadorSha256"), ("adapter_config.json", "configAdaptadorSha256")):
            if (a.saida / nome).is_file():
                recibo[chave_recibo] = sha256(a.saida / nome)
        recibo["novoAjustePesos"] = bool(recibo.get("adaptadorSha256") and recibo.get("configAdaptadorSha256") and recibo["ajustePesosTentado"])
        salvar(a.saida / "treino.json", recibo)
        print(json.dumps({k: recibo.get(k) for k in ("estado", "novoAjustePesos", "duracaoSegundos", "maxTokensVerificados", "erro")}, ensure_ascii=False), flush=True)
    if retorno != 0 or recibo["estado"] == "falhou":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
