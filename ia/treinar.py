"""QLoRA supervisionado real; recusa sobrescrever um experimento anterior."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

from runtime import RAIZ, MODELO, REVISAO, PASTA_MODELO, verificar_modelo, verificar_dataset, salvar_json, sha256, versoes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--saida", type=Path, default=RAIZ / "data/ia/piloto-v1")
    parser.add_argument("--config", type=Path, default=RAIZ / "ia/piloto.json")
    args = parser.parse_args()
    destino = args.saida.resolve()
    if destino.exists():
        parser.error("Use uma pasta nova para preservar o treino anterior.")
    verificar_modelo()
    verificar_dataset()
    dados = RAIZ / "ia/dados/desenvolvimento"
    if (dados / "test.jsonl").exists():
        raise ValueError("O teste deve ficar isolado fora da pasta de desenvolvimento.")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    config.update(model=str(PASTA_MODELO), data=str(dados), adapter_path=str(destino),
                  train=True, test=False, trust_remote_code=False, report_to=None)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(PASTA_MODELO, local_files_only=True, trust_remote_code=False)
    tamanhos = {}
    for nome in ("train.jsonl", "valid.jsonl"):
        linhas = [json.loads(linha) for linha in (dados / nome).read_text(encoding="utf-8").splitlines() if linha]
        if not linhas:
            raise ValueError("Split vazio: " + nome)
        tokens = [len(tokenizer.apply_chat_template(linha["messages"], tokenize=True, return_dict=False)) for linha in linhas]
        tamanhos[nome] = {"casos": len(linhas), "max_tokens": max(tokens)}
        if max(tokens) > config["max_seq_length"]:
            raise ValueError("Conversa excede max_seq_length; corrija o dataset antes de treinar.")
    destino.mkdir(parents=True)
    salvar_json(destino / "config-executada.json", config)
    meta = {
        "estado": "iniciado", "inicio": datetime.now(timezone.utc).isoformat(),
        "modelo": MODELO, "revisao": REVISAO, "config": config,
        "python": platform.python_version(), "plataforma": platform.platform(), "versoes": versoes(),
        "dados": {nome: sha256(dados / nome) for nome in tamanhos}, "tamanhos": tamanhos,
        "dataset_manifest_sha256": sha256(RAIZ / "ia/dados/manifest.json"),
        "config_sha256": sha256(args.config), "avaliacao_humana": False,
    }
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
                fim=datetime.now(timezone.utc).isoformat(), codigo_saida=codigo)
    if codigo == 0:
        meta["adaptador_sha256"] = sha256(destino / "adapters.safetensors")
    salvar_json(destino / "treino.json", meta)
    if codigo:
        raise SystemExit(codigo)
    print("Treino concluído. Qualidade ainda depende da avaliação separada.")


if __name__ == "__main__":
    main()
