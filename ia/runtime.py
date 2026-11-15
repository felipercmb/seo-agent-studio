"""I/O e carregamento local do piloto. Importar este módulo não baixa modelos."""

import hashlib
import importlib.metadata
import json
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
MODELO = "mlx-community/Qwen2.5-1.5B-Instruct-4bit"
REVISAO = "8b403126fc14f14cfc99bb4cfa72ecbc129ea677"
PASTA_MODELO = RAIZ / "data/ia/modelo"
MAX_SEQUENCIA = 1536
MAX_RESPOSTA = 384
SEED = 42


def sha256(caminho):
    h = hashlib.sha256()
    with Path(caminho).open("rb") as arquivo:
        for bloco in iter(lambda: arquivo.read(1024 * 1024), b""):
            h.update(bloco)
    return h.hexdigest()


def salvar_json(caminho, valor, exclusivo=False):
    caminho = Path(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with caminho.open("x" if exclusivo else "w", encoding="utf-8") as arquivo:
        os.chmod(caminho, 0o600)
        json.dump(valor, arquivo, ensure_ascii=False, indent=2, allow_nan=False)
        arquivo.write("\n")


def versoes():
    return {nome: importlib.metadata.version(nome) for nome in (
        "mlx", "mlx-lm", "transformers", "tokenizers", "huggingface-hub",
    )}


def verificar_dataset():
    pasta = RAIZ / "ia/dados"
    manifest = json.loads((pasta / "manifest.json").read_text(encoding="utf-8"))
    for nome, info in manifest["arquivos"].items():
        if Path(nome).is_absolute() or ".." in Path(nome).parts or sha256(pasta / nome) != info["sha256"]:
            raise ValueError("Dataset difere do manifest congelado: " + nome)
    return manifest


def verificar_modelo():
    arquivo = PASTA_MODELO / "proveniencia-local.json"
    if not arquivo.exists():
        raise ValueError("Modelo ausente. Execute primeiro: python ia/preparar_modelo.py")
    meta = json.loads(arquivo.read_text(encoding="utf-8"))
    if meta.get("modelo") != MODELO or meta.get("revisao") != REVISAO:
        raise ValueError("O modelo local não corresponde à revisão fixada.")
    for nome, esperado in meta.get("arquivos", {}).items():
        caminho = PASTA_MODELO / nome
        if Path(nome).is_absolute() or ".." in Path(nome).parts or sha256(caminho) != esperado:
            raise ValueError("Arquivo do modelo alterado: " + nome)
    if not any(nome.endswith(".safetensors") for nome in meta.get("arquivos", {})):
        raise ValueError("Proveniência sem pesos do modelo.")
    return meta


def carregar(adaptador=None):
    verificar_modelo()
    # A inferência não baixa arquivos nem envia a entrada ao Hugging Face.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    from mlx_lm import load
    import mlx.core as mx
    mx.random.seed(SEED)
    if adaptador is not None and not (Path(adaptador) / "adapters.safetensors").is_file():
        raise ValueError("Adaptador treinado ausente: " + str(adaptador))
    return load(str(PASTA_MODELO), adapter_path=str(adaptador) if adaptador else None,
                trust_remote_code=False)


def gerar(modelo, tokenizer, entrada):
    from contrato import mensagens
    from mlx_lm import generate
    from mlx_lm.sample_utils import make_sampler
    prompt = tokenizer.apply_chat_template(mensagens(entrada), tokenize=False,
                                           add_generation_prompt=True)
    tokens = len(tokenizer.encode(prompt, add_special_tokens=False))
    if tokens + MAX_RESPOSTA > MAX_SEQUENCIA:
        raise ValueError("Entrada excede o contexto do piloto; reduza as evidências sem truncá-las silenciosamente.")
    return generate(modelo, tokenizer, prompt=prompt, max_tokens=MAX_RESPOSTA,
                    sampler=make_sampler(temp=0.0), verbose=False)
