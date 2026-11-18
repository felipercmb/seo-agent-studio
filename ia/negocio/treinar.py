"""Ajuste LoRA real das tarefas de negócio, offline e em pastas novas."""

import argparse
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import shutil

IA=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(IA))
from runtime import PASTA_MODELO,verificar_modelo,versoes,salvar_json,sha256
from negocio.modelos import verificar_base


def conferir_manifesto(dados):
    m=json.loads((dados/"manifest.json").read_text())
    if m.get("elegivelTreinoExperimental") is not True or m.get("somenteAvaliacao") is True:
        raise ValueError("Corpus não aprovado para experimento de pesos.")
    if any(dados.glob("*test*")) or any(dados.glob("*holdout*")):
        raise ValueError("TEST deve permanecer fora do diretório de treino.")
    grupos=m["grupos"]
    if set(grupos.values())!={"train","validation"}:raise ValueError("Divisão por grupos incompleta.")
    for nome,h in m["arquivos"].items():
        p=dados/nome
        if Path(nome).is_absolute() or ".." in Path(nome).parts or sha256(p)!=h:raise ValueError("Dataset alterado: "+nome)
    if sha256(Path(__file__).with_name("contrato.py"))!=m["contratoSha256"]:
        raise ValueError("Prompt/contrato mudou após preparar os dados.")
    if m.get("promptFonteSha256") and sha256(Path(__file__).with_name("prompts.py"))!=m["promptFonteSha256"]:
        raise ValueError("Construtor de mensagens mudou após preparar os dados.")
    return m


def conferir_retomada(adaptador,manifesto,modelo_base,manifesto_anterior=None):
    """Never call a previously trained company an unseen validation company."""
    anterior=json.loads((adaptador.parent/"treino.json").read_text())
    if anterior.get("estado")!="concluido" or anterior.get("modeloBase", "qwen25-15b")!=modelo_base:
        raise ValueError("Retomada exige treino concluído da mesma base.")
    if anterior.get("adaptadorSha256")!=sha256(adaptador):raise ValueError("Adaptador de retomada não coincide com o recibo.")
    origem=Path(manifesto_anterior) if manifesto_anterior is not None else Path(anterior["config"]["data"])/"manifest.json"
    if sha256(origem)!=anterior["dadosManifestoSha256"]:raise ValueError("Manifesto da retomada foi alterado.")
    grupos_antes=json.loads(origem.read_text())["grupos"]
    vazados=sorted(g for g,s in grupos_antes.items() if s=="train" and manifesto["grupos"].get(g)=="validation")
    if vazados:raise ValueError("Grupos já treinados passaram à validação: "+str(vazados))
    return {"arquivo":str(adaptador.resolve()),"sha256":sha256(adaptador),
        "treinoAnteriorSha256":sha256(adaptador.parent/"treino.json"),"gruposJaTreinados":sorted(g for g,s in grupos_antes.items() if s=="train"),
        "manifestoAnterior":{"arquivo":str(origem.resolve()),"sha256":sha256(origem),"caminhoAlternativoExplicito":manifesto_anterior is not None}}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dados",type=Path,required=True);p.add_argument("--config",type=Path,required=True)
    p.add_argument("--saida",type=Path,required=True);p.add_argument("--limite-segundos",type=int,default=1800)
    p.add_argument("--retomar-adaptador",type=Path)
    p.add_argument("--manifesto-retomada",type=Path,help="Manifesto anterior transportado; deve manter exatamente o SHA do recibo de treino.")
    p.add_argument("--memoria-gib",type=float,default=6.0)
    p.add_argument("--perda-blocos",type=int,choices=(0,64,128),default=0)
    p.add_argument("--modelo-base",choices=("qwen25-15b","qwen3-4b","qwen35-4b"),default="qwen25-15b")
    a=p.parse_args()
    if a.saida.exists() or not 60<=a.limite_segundos<=3600 or not 2<=a.memoria_gib<=8:p.error("Pasta nova, limite de60a3600segundos e2a8GiB de MLX são necessários.")
    if a.perda_blocos and a.modelo_base!="qwen35-4b":p.error("Perda por blocos foi validada apenas no caminho textual Qwen3.5.")
    if a.manifesto_retomada and not a.retomar_adaptador:p.error("Manifesto de retomada exige adaptador anterior.")
    os.environ.update(HF_HUB_OFFLINE="1",HF_HUB_DISABLE_TELEMETRY="1",HF_HUB_DISABLE_IMPLICIT_TOKEN="1",TRANSFORMERS_OFFLINE="1",PYTHONUNBUFFERED="1")
    pasta_modelo,modelo=verificar_base(a.modelo_base);m=conferir_manifesto(a.dados);cfg=json.loads(a.config.read_text())
    if cfg.get("fine_tune_type")!="lora" or cfg.get("mask_prompt") is not True or cfg.get("grad_checkpoint") is not True:
        raise ValueError("Use LoRA com máscara do prompt e checkpoint de gradiente.")
    if not 1<=cfg.get("iters",0)<=400 or not 512<=cfg.get("max_seq_length",0)<=8192 or cfg.get("batch_size")!=1:
        raise ValueError("Configuração fora do orçamento local de experimento.")
    if cfg["max_seq_length"]<max(x["tokens"] for x in m["tamanhos"]):raise ValueError("O treino truncaria algum exemplo.")
    from transformers import AutoTokenizer
    tok=AutoTokenizer.from_pretrained(str(pasta_modelo),local_files_only=True,trust_remote_code=False)
    tamanhos_rechecados={}
    fronteiras={}
    from negocio.protocolo import prefixo_assistente
    for nome in ("train.jsonl","valid.jsonl"):
        tokens_treino=[]
        for linha in (a.dados/nome).read_text().splitlines():
            ms=json.loads(linha)["messages"]
            n_tokens=len(tok.apply_chat_template(ms,tokenize=True,return_dict=False));tokens_treino.append(n_tokens)
            fronteira=prefixo_assistente(tok,ms[:-1]);prefixo=fronteira["prefixo"]
            fronteiras[prefixo]=fronteiras.get(prefixo,0)+1
            if n_tokens>cfg["max_seq_length"]:
                raise ValueError("Conversa extensa: sem truncamento silencioso.")
        tamanhos_rechecados[nome]={"exemplos":len(tokens_treino),"maxTokens":max(tokens_treino)}
    cfg.update(model=str(pasta_modelo),data=str(a.dados.resolve()),adapter_path=str(a.saida.resolve()),
        train=True,test=False,trust_remote_code=False,report_to=None)
    retomada=None
    if a.retomar_adaptador:
        retomada=conferir_retomada(a.retomar_adaptador,m,a.modelo_base,a.manifesto_retomada)
        cfg["resume_adapter_file"]=retomada["arquivo"]
    a.saida.mkdir(parents=True)
    capsula=a.saida/"codigo";capsula.mkdir()
    hashes_codigo={}
    nomes_codigo=["treinar.py","bootstrap_mlx_limitado.py","contrato.py","modelos.py","preparar.py","prompts.py","protocolo.py"]
    if a.perda_blocos:nomes_codigo.append("treino_memoria/perda_em_blocos.py")
    for nome in nomes_codigo:
        origem=Path(__file__).parent/nome;hashes_codigo[nome]=sha256(origem);(capsula/nome).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(origem,capsula/nome)
    salvar_json(a.saida/"config-executada.json",cfg,exclusivo=True)
    meta={"versao":1,"estado":"iniciado","inicio":datetime.now(timezone.utc).isoformat(),"novoAjustePesos":True,
        "tarefa":"entendimento_e_decisao_de_negocio","dependencias":versoes(),"config":cfg,
        "dadosManifestoSha256":sha256(a.dados/"manifest.json"),"modeloBaseProveniencia":modelo,
        "modeloBase":a.modelo_base,"tokenizacaoRechecada":tamanhos_rechecados,
        "origemRotulos":"Supervisão técnica experimental, humana pendente; não certifica clientes.",
        "modeloAnteriorAlterado":False,"selecaoPadraoAlterada":False,"retomada":retomada}
    meta["codigoExecutado"]=hashes_codigo
    meta.update(prompt=m.get("prompt","v3"),prefixosDoTemplateNoAlvoMascarado=fronteiras)
    meta.update(limiteMemoriaMLXGiB=a.memoria_gib,limiteCacheMLXBytes=128*1024**2)
    meta["perda"]={"modo":"qwen35_head_ce_em_blocos" if a.perda_blocos else "mlx_lm_default_loss",
        "bloco":a.perda_blocos or None,"mascaraOriginalPreservada":True,"bibliotecaInstaladaAlterada":False}
    salvar_json(a.saida/"treino.json",meta,exclusivo=True)
    inicio=time.monotonic();codigo=None
    try:
        with (a.saida/"treino.log").open("w") as log:
            proc=subprocess.run([sys.executable,str(Path(__file__).with_name("bootstrap_mlx_limitado.py")),"--memoria-gib",str(a.memoria_gib),"--perda-blocos",str(a.perda_blocos),"--config",str((a.saida/"config-executada.json").resolve())],
                cwd=IA.parent,stdout=log,stderr=subprocess.STDOUT,timeout=a.limite_segundos,check=False)
        codigo=proc.returncode;meta["estado"]="concluido" if codigo==0 else "falhou"
    except subprocess.TimeoutExpired:
        meta["estado"]="interrompido_prazo"
    except KeyboardInterrupt:
        meta["estado"]="interrompido_usuario"
    finally:
        meta.update(fim=datetime.now(timezone.utc).isoformat(),duracaoSegundos=time.monotonic()-inicio,codigoSaida=codigo)
        meta["codigoMudouDuranteExecucao"]=any(sha256(Path(__file__).parent/n)!=h for n,h in hashes_codigo.items())
        for n,chave in (("adapters.safetensors","adaptadorSha256"),("adapter_config.json","configAdaptadorSha256")):
            if (a.saida/n).is_file():meta[chave]=sha256(a.saida/n)
        salvar_json(a.saida/"treino.json",meta)
        print(json.dumps({k:meta[k] for k in ("estado","duracaoSegundos","codigoSaida")}),flush=True)
    if codigo!=0:raise SystemExit(1)


if __name__=="__main__":main()
