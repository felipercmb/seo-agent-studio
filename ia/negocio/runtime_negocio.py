"""Inferência local das novas tarefas, sem seleções antigas ou rede."""

import os
from pathlib import Path
import sys
import time
import hashlib
import json
import gc
from collections import OrderedDict

IA = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(IA))
os.environ.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                  HF_HUB_DISABLE_IMPLICIT_TOKEN="1", TRANSFORMERS_OFFLINE="1")
from runtime import carregar, sha256, verificar_modelo
from negocio.contrato import mensagens, ler_json_estrito, validar_saida
from negocio.modelos import carregar_base
from negocio.prompts import mensagens_para
from negocio.protocolo import prefixo_assistente

_INDICES=OrderedDict()


def processador_esquema(tokenizer,entrada):
    from negocio.esquema import esquema_para
    from negocio.decodificacao.core_mlx import preparar_indice_json,criar_processador_mlx
    schema=esquema_para(entrada)
    serial=json.dumps(schema,sort_keys=True,ensure_ascii=False,separators=(",",":"))
    chave=(id(tokenizer),hashlib.sha256(serial.encode()).hexdigest())
    preparado=_INDICES.pop(chave,None)
    if preparado is None:
        # Libera o índice anterior antes de construir outro. A gramática usa
        # RAM do host, que não é limitada pelo orçamento de tensores MLX.
        _INDICES.clear();gc.collect()
        preparado=preparar_indice_json(schema,tokenizer,limitar_comprimento_texto=False)
    _INDICES[chave]=preparado
    while len(_INDICES)>1:_INDICES.popitem(last=False)
    auditoria=dict(preparado.auditoria)
    auditoria["execucaoIndice"]=auditoria.pop("modo",None)
    return criar_processador_mlx(preparado),{**auditoria,"modo":"json_schema_outlines_core"}


def carregar_leitor(adaptador=None,modelo_base="qwen25-15b"):
    """A task-specific adapter is optional; the action classifier is not used."""
    if adaptador is not None:
        adaptador = Path(adaptador).resolve()
        if not (adaptador / "adapters.safetensors").is_file() or not (adaptador / "adapter_config.json").is_file():
            raise ValueError("Adaptador de negócio incompleto.")
    inicio = time.monotonic()
    modelo, tokenizer,meta = carregar_base(modelo_base,adaptador)
    return modelo, tokenizer, {"cargaSegundos": time.monotonic() - inicio,
        "modeloBaseVerificado": True,"modeloBase":modelo_base,"repoModelo":meta["modelo"],"revisaoModelo":meta["revisao"],
        "adaptadorSha256": sha256(adaptador / "adapters.safetensors") if adaptador else None,
        "configAdaptadorSha256": sha256(adaptador / "adapter_config.json") if adaptador else None,
        "derivacaoTemplateEmMemoria":meta.get("derivacaoTemplateEmMemoria"),"limiteMemoriaMLXGiB":7 if modelo_base=="qwen35-9b" else 6}


def gerar_negocio(modelo, tokenizer, entrada, *, max_tokens=640, max_sequencia=3072, prefixo_json=False,
                  versao_prompt="v3",alinhar_template=False,decodificacao="livre"):
    if not 32 <= max_tokens <= 1200 or not 512 <= max_sequencia <= 8192:
        raise ValueError("Orçamento de inferência inválido.")
    if decodificacao not in ("livre","esquema") or decodificacao=="esquema" and prefixo_json:
        raise ValueError("Decodificação inválida; esquema exige JSON integral, sem prefixo parcial.")
    from mlx_lm import stream_generate
    from mlx_lm.sample_utils import make_sampler
    ms = mensagens_para(entrada,versao=versao_prompt)
    protocolo=prefixo_assistente(tokenizer,ms) if alinhar_template else None
    prompt = protocolo["prompt"] if protocolo else tokenizer.apply_chat_template(ms, tokenize=False, add_generation_prompt=True)
    if prefixo_json:
        prompt += "{"
    token_ids = tokenizer.encode(prompt, add_special_tokens=False)
    tokens = len(token_ids)
    identidade_prompt={
        "mensagensSha256":hashlib.sha256(json.dumps(ms,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()).hexdigest(),
        "promptUtf8Sha256":hashlib.sha256(prompt.encode()).hexdigest(),
        "tokensPromptSha256":hashlib.sha256(json.dumps(token_ids,separators=(",",":")).encode()).hexdigest(),
        "tokensPromptIncluemPrefixo":True,
    }
    if tokens + max_tokens > max_sequencia:
        return {"estado": "entrada_nao_executada", "erro": "orcamento_contexto",
                "tokensEntrada": tokens, "maxSequencia": max_sequencia, "maxResposta": max_tokens,
                "textoBruto": None, "saida": None, "errosContrato": [], "inferida": False,
                "identidadePrompt":identidade_prompt}
    inicio, partes, ultimo = time.monotonic(), [], None
    processor,meta_decoder=processador_esquema(tokenizer,entrada) if decodificacao=="esquema" else (None,{"modo":"livre"})
    for resposta in stream_generate(modelo, tokenizer, prompt=prompt, max_tokens=max_tokens,
                                    sampler=make_sampler(temp=0.0),logits_processors=[processor] if processor else None):
        partes.append(resposta.text)
        ultimo = resposta
    bruto = ("{" if prefixo_json else "") + "".join(partes)
    erros, saida = [], None
    try:
        saida = ler_json_estrito(bruto)
        erros = validar_saida(saida, entrada)
    except (ValueError, TypeError, KeyError) as falha:
        erros = ["json_incompativel:" + type(falha).__name__]
    return {"estado": "candidata" if not erros else "recusada", "inferida": True,
        "textoBruto": bruto, "saida": saida, "errosContrato": erros,
        "latenciaSegundos": time.monotonic() - inicio, "tokensEntrada": tokens,
        "tokensGerados": ultimo.generation_tokens if ultimo else 0,
        "fimGeracao": ultimo.finish_reason if ultimo else None,
        "prefixoJsonAplicado": prefixo_json,
        "versaoPrompt":versao_prompt,"alinhamentoTemplate":{k:v for k,v in protocolo.items() if k!="prompt"} if protocolo else None,
        "decodificacao":meta_decoder,"identidadePrompt":identidade_prompt,
        "limite": "Formato e spans válidos não aprovam interpretação ou recomendação para clientes."}
