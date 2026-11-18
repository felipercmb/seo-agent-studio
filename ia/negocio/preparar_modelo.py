"""Download público de pesos fixados; dados de clientes nunca são enviados."""

import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import shutil

REPO="mlx-community/Qwen3-4B-Instruct-2507-4bit"
REVISAO="50d427756c6b1b2fe0c0a10f67fbda1fc8e82c1b"
BASE="Qwen/Qwen3-4B-Instruct-2507"
BASE_REVISAO="cdbee75f17c01a7cc42f958dc650907174af0554"
PADROES=["*.json","*.safetensors","*.txt","*.jinja","README.md"]


def hash_arquivo(p):
    h=hashlib.sha256()
    with p.open("rb") as f:
        for bloco in iter(lambda:f.read(1024*1024),b""):h.update(bloco)
    return h.hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--saida",type=Path,required=True);a=p.parse_args()
    destino=a.saida.resolve()
    if (destino/"proveniencia-local.json").exists():
        raise ValueError("Modelo já registrado; não substituir o recibo ou pesos.")
    os.environ.update(HF_HUB_OFFLINE="0",HF_HUB_DISABLE_TELEMETRY="1",HF_HUB_DISABLE_IMPLICIT_TOKEN="1",HF_HUB_DISABLE_XET="1")
    from huggingface_hub import HfApi,snapshot_download,hf_hub_download
    api=HfApi(token=False);info=api.model_info(REPO,revision=REVISAO,files_metadata=True,token=False)
    base=api.model_info(BASE,revision=BASE_REVISAO,token=False)
    if info.sha!=REVISAO or base.sha!=BASE_REVISAO or getattr(info.card_data,"license",None)!="apache-2.0" or getattr(base.card_data,"license",None)!="apache-2.0":
        raise ValueError("Revisão ou licença fora do registro aprovado.")
    import fnmatch
    escolhidos=[f for f in info.siblings if any(fnmatch.fnmatch(f.rfilename,g) for g in PADROES)]
    tamanho=sum(f.size or 0 for f in escolhidos)
    destino.mkdir(parents=True,exist_ok=True)
    if tamanho>4*1024**3 or shutil.disk_usage(destino).free<tamanho*1.25+2*1024**3:
        raise ValueError("Orçamento de download/disco insuficiente.")
    print(json.dumps({"estado":"baixando_pesos_publicos","repo":REPO,"revisao":REVISAO,"bytesEsperados":tamanho,"tokenUsado":False,"dadosClientesEnviados":False}),flush=True)
    snapshot_download(REPO,revision=REVISAO,local_dir=destino,allow_patterns=PADROES,max_workers=2,token=False)
    hf_hub_download(BASE,"LICENSE",revision=BASE_REVISAO,local_dir=destino/"licenca-base",token=False)
    arquivos={}
    for f in escolhidos:
        arquivo=destino/f.rfilename
        digest=hash_arquivo(arquivo)
        if f.lfs and digest!=f.lfs.sha256:raise ValueError("Hash de peso/tokenizer divergente: "+f.rfilename)
        arquivos[f.rfilename]=digest
    arquivos["licenca-base/LICENSE"]=hash_arquivo(destino/"licenca-base/LICENSE")
    recibo={"versao":1,"modelo":REPO,"revisao":REVISAO,"modeloBase":BASE,"revisaoBase":BASE_REVISAO,
        "licenca":"apache-2.0","baixadoEm":datetime.now(timezone.utc).isoformat(),"arquivos":arquivos,
        "bytesEsperados":tamanho,"dadosClientesEnviados":False,"servicoInferenciaUsado":False,"tokenUsado":False,
        "urls":["https://huggingface.co/"+REPO,"https://huggingface.co/"+BASE]}
    with (destino/"proveniencia-local.json").open("x") as f:json.dump(recibo,f,indent=2)
    print(json.dumps({"estado":"pesos_verificados","arquivos":len(arquivos),"bytes":tamanho}),flush=True)


if __name__=="__main__":main()
