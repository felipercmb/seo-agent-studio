"""Registro de pesos permitidos para o experimento; sem inferência remota."""

import json
import os
from pathlib import Path
import sys

IA=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(IA))
from runtime import PASTA_MODELO,RAIZ,verificar_modelo,sha256

REGISTRO={
    "qwen25-15b":{"pasta":PASTA_MODELO},
    "qwen3-4b":{"pasta":RAIZ/"data/ia/negocio/modelos/qwen3-4b-instruct2507-4bit",
                "modelo":"mlx-community/Qwen3-4B-Instruct-2507-4bit",
                "revisao":"50d427756c6b1b2fe0c0a10f67fbda1fc8e82c1b"},
    "qwen35-4b":{"pasta":RAIZ/"data/ia/negocio/modelos/qwen35-4b-4bit-sem-pensamento",
                "modelo":"mlx-community/Qwen3.5-4B-MLX-4bit",
                "revisao":"32f3e8ecf65426fc3306969496342d504bfa13f3",
                "templateSha256":"e175bc0107b113da24d85536756d0fd6254ba95a1a685ebfeaba25b06fc97155",
                "pesoSha256":"5fb9acd0246866381cf8c5c354c6db1019f6498eec4ccb4f5edcc71ffeacb2db"},
    "qwen35-9b":{"pasta":RAIZ/"data/ia/negocio/modelos/qwen35-9b-4bit",
                "modelo":"mlx-community/Qwen3.5-9B-4bit",
                "revisao":"8b2b98c00a6b4d291155e4890773ca8f769aee53"},
}


def verificar_base(nome="qwen25-15b"):
    if nome not in REGISTRO:raise ValueError("Modelo fora do registro local.")
    registro=REGISTRO[nome];pasta=registro["pasta"]
    if nome=="qwen25-15b":return pasta,verificar_modelo()
    meta=json.loads((pasta/"proveniencia-local.json").read_text())
    if meta.get("modelo")!=registro["modelo"] or meta.get("revisao")!=registro["revisao"] or meta.get("licenca")!="apache-2.0":
        raise ValueError("Proveniência do modelo não corresponde ao registro.")
    for nome_arquivo,digest in meta["arquivos"].items():
        if Path(nome_arquivo).is_absolute() or ".." in Path(nome_arquivo).parts or sha256(pasta/nome_arquivo)!=digest:
            raise ValueError("Peso/tokenizer alterado: "+nome_arquivo)
    if not any(n.endswith(".safetensors") for n in meta["arquivos"]):raise ValueError("Registro sem pesos.")
    if nome=="qwen35-4b" and (meta.get("tipo")!="derivacao_local_template_sem_pensamento" or
            meta["arquivos"].get("chat_template.jinja")!=registro["templateSha256"] or
            meta["arquivos"].get("model.safetensors")!=registro["pesoSha256"]):
        raise ValueError("Derivação/peso Qwen3.5 fora do registro.")
    return pasta,meta


def carregar_base(nome="qwen25-15b",adaptador=None):
    pasta,meta=verificar_base(nome)
    os.environ.update(HF_HUB_OFFLINE="1",HF_HUB_DISABLE_TELEMETRY="1",TRANSFORMERS_OFFLINE="1")
    import mlx.core as mx
    from mlx_lm import load
    mx.set_memory_limit((7 if nome=="qwen35-9b" else 6)*1024**3)
    mx.set_cache_limit(128*1024**2)
    mx.random.seed(42)
    modelo,tok=load(str(pasta),adapter_path=str(adaptador) if adaptador else None,trust_remote_code=False)
    if nome=="qwen35-9b":
        hf=getattr(tok,"_tokenizer",tok)
        if not isinstance(hf.chat_template,str):raise ValueError("Template Qwen3.5 não reconhecido.")
        hf.chat_template="{%- set enable_thinking = false %}\n"+hf.chat_template
        meta={**meta,"derivacaoTemplateEmMemoria":"enable_thinking=false","pesosOriginaisAlterados":False}
    return modelo,tok,meta
