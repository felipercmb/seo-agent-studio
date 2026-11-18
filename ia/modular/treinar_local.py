"""Executa um experimento LoRA curto e local, sem alterar seleções existentes."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time

IA = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(IA))
from runtime import PASTA_MODELO, verificar_modelo, versoes, sha256, salvar_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dados', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--saida', type=Path, required=True)
    parser.add_argument('--limite-segundos', type=int, default=600)
    parser.add_argument('--origem-rotulos', default='Origem não informada; consulte o manifesto dos dados. Sem revisão profissional independente.')
    args = parser.parse_args()
    if args.saida.exists() or not 30 <= args.limite_segundos <= 900:
        parser.error('Use pasta nova e prazo entre trinta e novecentos segundos.')
    os.environ.update(HF_HUB_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', HF_HUB_DISABLE_IMPLICIT_TOKEN='1')
    verificar_modelo()
    if any(args.dados.glob('*test*')) or any(args.dados.glob('*holdout*')):
        raise ValueError('O treino não aceita teste no diretório de desenvolvimento.')
    config = json.loads(args.config.read_text())
    if config.get('train') is not True or config.get('test') is not False or not 1 <= config.get('iters', 0) <= 80:
        raise ValueError('Esta execução aceita somente treino curto, sem teste.')
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(str(PASTA_MODELO), local_files_only=True, trust_remote_code=False)
    tamanhos, hashes = {}, {}
    for nome in ('train.jsonl', 'valid.jsonl'):
        arquivo = args.dados / nome
        linhas = [json.loads(l) for l in arquivo.read_text().splitlines() if l.strip()]
        if not linhas:
            raise ValueError('Conjunto vazio.')
        tokens = [len(tokenizer.apply_chat_template(l['messages'],tokenize=True,return_dict=False)) for l in linhas]
        if max(tokens) > config['max_seq_length']:
            raise ValueError('Conversa excede a sequência; não será truncada silenciosamente.')
        tamanhos[nome] = {'casos':len(linhas),'maxTokens':max(tokens)}
        hashes[nome] = sha256(arquivo)
    args.saida.mkdir(parents=True)
    config.update(model=str(PASTA_MODELO),data=str(args.dados.resolve()),adapter_path=str(args.saida.resolve()),
                  trust_remote_code=False,report_to=None)
    salvar_json(args.saida/'config-executada.json',config)
    meta = {'versao':1,'estado':'iniciado','inicio':datetime.now(timezone.utc).isoformat(),
            'dependencias':versoes(),'config':config,'arquivosDados':hashes,'tamanhos':tamanhos,
            'origemRotulos':args.origem_rotulos,
            'modeloAnteriorAlterado':False,'selecaoPadraoAlterada':False}
    salvar_json(args.saida/'treino.json',meta)
    inicio=time.monotonic()
    comando=[sys.executable,'-m','mlx_lm','lora','--config',str((args.saida/'config-executada.json').resolve())]
    codigo=None
    try:
        with (args.saida/'treino.log').open('w') as log:
            processo=subprocess.run(comando,cwd=IA.parent,stdout=log,stderr=subprocess.STDOUT,
                                   timeout=args.limite_segundos,check=False)
            codigo=processo.returncode
        meta['estado']='concluido' if codigo==0 else 'falhou'
    except subprocess.TimeoutExpired:
        meta['estado']='interrompido_prazo'
    finally:
        meta.update(fim=datetime.now(timezone.utc).isoformat(),duracaoSegundos=time.monotonic()-inicio,codigoSaida=codigo)
        adaptador=args.saida/'adapters.safetensors'
        if adaptador.is_file():
            meta['adaptadorSha256']=sha256(adaptador)
        salvar_json(args.saida/'treino.json',meta)
        print(json.dumps({k:meta[k] for k in ('estado','duracaoSegundos','codigoSaida')},ensure_ascii=False),flush=True)
    if codigo!=0:
        raise SystemExit(1)


if __name__=='__main__':
    main()
