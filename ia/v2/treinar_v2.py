"""Treina localmente, preserva checkpoints e nunca lê o arquivo de teste."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import resource
import subprocess
import sys
import time

V2 = Path(__file__).resolve().parent
sys.path.insert(0, str(V2.parent))
from runtime import RAIZ, MODELO, REVISAO, PASTA_MODELO, verificar_modelo, salvar_json, sha256, versoes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=V2 / "config-a.json")
    parser.add_argument("--dados", type=Path, default=V2 / "dados")
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    destino = args.saida.resolve()
    if destino.exists():
        parser.error("Use uma pasta nova para preservar o experimento anterior.")
    verificar_modelo()
    pasta = args.dados.resolve()
    manifesto = json.loads((pasta / "manifest.json").read_text(encoding="utf-8"))
    for nome in ("desenvolvimento/train.jsonl", "desenvolvimento/valid.jsonl", "casos-train.jsonl", "casos-valid.jsonl"):
        if sha256(pasta / nome) != manifesto["arquivos"][nome]["sha256"]:
            raise ValueError("Dataset de desenvolvimento alterado: " + nome)
    os.environ.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(PASTA_MODELO, local_files_only=True, trust_remote_code=False)
    config = json.loads(args.config.read_text(encoding="utf-8"))
    reinicio = config.get("resume_adapter_file")
    reinicio_sha256 = None
    if reinicio:
        caminho_reinicio = (RAIZ / reinicio).resolve()
        if not caminho_reinicio.is_file() or caminho_reinicio.suffix != '.safetensors':
            raise ValueError("O adaptador inicial deve ser um arquivo local safetensors existente.")
        reinicio_sha256 = sha256(caminho_reinicio)
        config["resume_adapter_file"] = str(caminho_reinicio)
    config.update(model=str(PASTA_MODELO), data=str(pasta / "desenvolvimento"), adapter_path=str(destino),
                  train=True, test=False, trust_remote_code=False, report_to=None)
    tamanhos = {}
    for nome in ("train", "valid"):
        linhas = [json.loads(l) for l in (pasta / f"desenvolvimento/{nome}.jsonl").read_text(encoding="utf-8").splitlines()]
        comprimentos = [len(tokenizer.apply_chat_template(l["messages"], tokenize=True, return_dict=False)) for l in linhas]
        if not comprimentos or max(comprimentos) > config["max_seq_length"]:
            raise ValueError("Conversa vazia ou longa demais no split " + nome)
        tamanhos[nome] = {"casos": len(linhas), "max_tokens": max(comprimentos)}
    destino.mkdir(parents=True)
    salvar_json(destino / "config-executada.json", config)
    meta = {"estado": "iniciado", "inicio": datetime.now(timezone.utc).isoformat(), "modelo": MODELO,
            "revisao": REVISAO, "plataforma": platform.platform(), "python": platform.python_version(),
            "versoes": versoes(), "dados_manifest_sha256": sha256(pasta / "manifest.json"),
            "config_fonte_sha256": sha256(args.config), "treinador_sha256": sha256(Path(__file__)),
            "adaptador_inicial_sha256": reinicio_sha256,
            "dados": {nome: sha256(pasta / f"desenvolvimento/{nome}.jsonl") for nome in ("train", "valid")},
            "tamanhos": tamanhos, "config": config}
    salvar_json(destino / "treino.json", meta)
    inicio = time.monotonic()
    comando = [sys.executable, "-m", "mlx_lm", "lora", "--config", str(destino / "config-executada.json")]
    with (destino / "treino.log").open("w", encoding="utf-8") as log:
        processo = subprocess.Popen(comando, cwd=RAIZ, env={**os.environ, "PYTHONUNBUFFERED": "1"},
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            for linha in processo.stdout:
                log.write(linha)
                log.flush()
                print(linha, end="", flush=True)
            codigo = processo.wait()
        except BaseException:
            processo.terminate()
            processo.wait()
            meta.update(estado="interrompido", duracao_segundos=time.monotonic() - inicio)
            salvar_json(destino / "treino.json", meta)
            raise
    meta.update(estado="concluido" if codigo == 0 else "falhou", duracao_segundos=time.monotonic() - inicio,
                fim=datetime.now(timezone.utc).isoformat(), codigo_saida=codigo,
                max_rss_bytes=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
    meta["checkpoints"] = {p.name: sha256(p) for p in sorted(destino.glob("*adapters.safetensors"))}
    salvar_json(destino / "treino.json", meta)
    if codigo:
        raise SystemExit(codigo)
    print("Treinamento concluído. A escolha do checkpoint usa apenas validação.")


if __name__ == "__main__":
    main()
