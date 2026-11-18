"""Entendimento e planejamento realmente encadeados, sem perfil oracle."""

import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import shutil
import sys
import subprocess

IA=Path(__file__).resolve().parents[1];sys.path.insert(0,str(IA))
from runtime import salvar_json,sha256,versoes
from negocio.contrato import CAMPOS,compactar_ids,validar_saida
from negocio.pipeline import montar_planejamento,remapear_referencias,desconhecido
from negocio.fusao import fundir_lista,LISTAS
from negocio.qualidade import verificar_qualidade


def abstencao_vazia(entrada):
    if entrada["tarefa"]=="entender":
        campo=entrada["campo"];saida={"estado":"insuficiente","valor":desconhecido(campo),"fontes":[],"faltam":[campo]}
    else:
        saida={"estado":"insuficiente","decisao":"","alternativas":[],"criterios":[],"acao":"","verificar":"","fontes":[],
            "incertezas":["Não há conteúdo público legível nesta captura para sustentar uma decisão."],"hipotese":True}
    return {"estado":"abstencao_sem_fontes","inferida":False,"textoBruto":None,"saida":saida,"errosContrato":validar_saida(saida,entrada),
        "origem":"regra_ausencia_de_fontes","latenciaSegundos":0,"tokensEntrada":0,"tokensGerados":0}


def executar_caso(c,modelo,tokenizer,gerar,*,max_tokens,max_sequencia,passadas=1,versao_prompt="v3",versao_prompt_plano=None,decodificacao="livre",alinhar_template=True,registrar=None):
    if passadas not in (1,2):raise ValueError("Use uma ou duas passadas.")
    leituras={};resultados=[]
    def inferir(entrada):
        compacta,_,mapa=compactar_ids(entrada)
        if not compacta["fontes"]:g=abstencao_vazia(compacta)
        else:
            try:
                g=gerar(modelo,tokenizer,compacta,max_tokens=max_tokens,max_sequencia=max_sequencia,
                    versao_prompt=(versao_prompt_plano or versao_prompt) if compacta["tarefa"]=="recomendar" else versao_prompt,
                    alinhar_template=alinhar_template,decodificacao=decodificacao)
            except (ValueError,RuntimeError) as falha:
                g={"estado":"erro_execucao","inferida":False,"textoBruto":None,"saida":None,
                   "erro":str(falha),"tipoErro":type(falha).__name__,"errosContrato":["geracao_nao_concluida"]}
        canonica=remapear_referencias(g.get("saida"),mapa)
        qualidade=verificar_qualidade(g.get("saida"),compacta,
            versao_prompt=(versao_prompt_plano or versao_prompt) if compacta["tarefa"]=="recomendar" else versao_prompt)
        contrato_valido=not validar_saida(g.get("saida"),compacta)
        r={"entrada":compacta,"mapaIdsOriginais":mapa,"geracao":g,
            "entradaSha256":hashlib.sha256(json.dumps(compacta,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()).hexdigest(),
            "saidaReferenciasOriginais":canonica,"contratoValido":contrato_valido,"qualidade":qualidade,
            "saidaCandidataParaRevisao":canonica if contrato_valido and not qualidade["erros"] else None}
        return r,{"entrada":entrada,"geracao":{"saida":canonica if not qualidade["erros"] else None}}
    for campo in CAMPOS:
        ctx=c["contextosPorCampo"][campo]
        entrada={"tarefa":"entender","campo":campo,"fontes":[{k:f[k] for k in ("id","texto","tipo")} for f in ctx["fontes"]]}
        r,ponte=inferir(entrada)
        if passadas==2 and campo in LISTAS:
            extras=c.get("contextosExtrasPorCampo",{}).get(campo)
            if not isinstance(extras,list) or len(extras)!=1:raise ValueError("A segunda passada deve ter um contexto por campo de lista.")
            componentes=[r];pontes=[ponte]
            for extra in extras:
                if not extra["fontes"]:continue
                ei={"tarefa":"entender","campo":campo,"fontes":[{k:f[k] for k in ("id","texto","tipo")} for f in extra["fontes"]]}
                ri,pi=inferir(ei);componentes.append(ri);pontes.append(pi)
            fusao=fundir_lista(campo,pontes,c["pool"]["fontes"])
            if fusao["saida"] is not None:
                compacta,saida,mapa=compactar_ids(fusao["entrada"],fusao["saida"])
                g={"estado":"fusao_mecanica","inferida":False,"textoBruto":None,"saida":saida,
                    "origem":"fusao_mecanica_sem_completar_fatos","errosContrato":validar_saida(saida,compacta),
                    "latenciaSegundos":sum(q["geracao"].get("latenciaSegundos",0) for q in componentes)}
                r={"entrada":compacta,"mapaIdsOriginais":mapa,"geracao":g,
                    "entradaSha256":hashlib.sha256(json.dumps(compacta,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()).hexdigest(),
                    "saidaReferenciasOriginais":fusao["saida"],"contratoValido":not g["errosContrato"]}
                ponte={"entrada":fusao["entrada"],"geracao":{"saida":fusao["saida"]}}
            # A wholly refused set is retained as a failure, not reclassified as
            # a successful abstention by the composition layer.
            r={**r,"passadas":componentes,"fusao":fusao,"resultadoDoModeloDireto":False}
        r.update(id=c["id"]+"-"+campo,campo=campo,split=c["split"],dominio=c["dominio"],grupoEmpresarial=c["grupoEmpresarial"])
        leituras[campo]=ponte;resultados.append(r)
        if registrar:registrar(r)
        print(json.dumps({"id":r["id"],"estado":r["geracao"]["estado"],"contratoValido":r["contratoValido"]}),flush=True)
    planejamento=montar_planejamento(leituras,c["contextosPorCampo"]["recomendar"]["fontes"],c["pool"]["fontes"])
    r,_=inferir(planejamento["entrada"]);r.update(id=c["id"]+"-recomendar",campo="recomendar",split=c["split"],dominio=c["dominio"],grupoEmpresarial=c["grupoEmpresarial"])
    resultados.append(r)
    if registrar:registrar(r)
    print(json.dumps({"id":r["id"],"estado":r["geracao"]["estado"],"contratoValido":r["contratoValido"]}),flush=True)
    return {"id":c["id"],"dominio":c["dominio"],"grupoEmpresarial":c["grupoEmpresarial"],"split":c["split"],
        "captura":c["captura"],"perfilConfirmado":False,"pontePlanejamento":planejamento,"resultados":resultados}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--contextos",type=Path,required=True);p.add_argument("--saida",type=Path,required=True)
    p.add_argument("--modelo-base",choices=("qwen25-15b","qwen3-4b","qwen35-4b","qwen35-9b"),default="qwen3-4b");p.add_argument("--adaptador",type=Path)
    p.add_argument("--prompt",choices=("v3","v4","v5"),default="v3")
    p.add_argument("--prompt-plano",choices=("v3","v4","v5"),help="Protocolo do planejador; por padrão usa o mesmo do leitor.")
    p.add_argument("--decodificacao",choices=("livre","esquema"),default="esquema")
    alinhamento=p.add_mutually_exclusive_group()
    alinhamento.add_argument("--alinhar-template",dest="alinhar_template",action="store_true")
    alinhamento.add_argument("--template-natural",dest="alinhar_template",action="store_false")
    p.set_defaults(alinhar_template=True)
    p.add_argument("--max-tokens",type=int,default=900);p.add_argument("--max-sequencia",type=int,default=6144)
    p.add_argument("--passadas",type=int,choices=(1,2),default=1)
    a=p.parse_args()
    if a.saida.exists():p.error("Preserve saídas anteriores; use arquivo novo.")
    capsula=a.saida.with_suffix(".codigo");capsula.mkdir(parents=True,exist_ok=False)
    codigo={}
    for nome in ("contrato.py","runtime_negocio.py","modelos.py","prompts.py","protocolo.py","esquema.py","decodificacao/core_mlx.py","pipeline.py","fusao.py","qualidade.py","executar_pipeline.py","conferir_contextos.mjs","capturas.mjs","fontes.mjs","fontes-v2.mjs"):
        f=Path(__file__).parent/nome;codigo[nome]=sha256(f);(capsula/nome).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,capsula/nome)
    bytes_contextos=a.contextos.read_bytes();contextos_sha256=hashlib.sha256(bytes_contextos).hexdigest()
    contextos=json.loads(bytes_contextos)
    if contextos.get("modo")!="end_to_end" or not contextos.get("casos"):raise ValueError("Contextos EE não vazios são necessários.")
    verificador=subprocess.run(["node",str(Path(__file__).with_name("conferir_contextos.mjs")),str(a.contextos.resolve())],
        check=True,capture_output=True,text=True,timeout=60,cwd=IA.parent)
    verificacao=json.loads(verificador.stdout)
    if verificacao.get("contextosSha256")!=contextos_sha256:raise ValueError("Contextos mudaram entre leitura e verificação.")
    from negocio.runtime_negocio import carregar_leitor,gerar_negocio
    modelo,tok,identidade=carregar_leitor(a.adaptador,a.modelo_base)
    journal=a.saida.with_suffix(".parcial.jsonl");journal_tarefas=a.saida.with_suffix(".tarefas.jsonl")
    resultados=[];inicio=datetime.now(timezone.utc).isoformat()
    with journal.open("x") as j,journal_tarefas.open("x") as jt:
        def registrar(r):jt.write(json.dumps(r,ensure_ascii=False)+"\n");jt.flush()
        for c in contextos["casos"]:
            r=executar_caso(c,modelo,tok,gerar_negocio,max_tokens=a.max_tokens,max_sequencia=a.max_sequencia,passadas=a.passadas,versao_prompt=a.prompt,versao_prompt_plano=a.prompt_plano,decodificacao=a.decodificacao,alinhar_template=a.alinhar_template,registrar=registrar)
            resultados.append(r);j.write(json.dumps(r,ensure_ascii=False)+"\n");j.flush()
    meta={"versao":1,"estado":"experimental","modo":"end_to_end","perfilOracleUsado":False,"inicio":inicio,"fim":datetime.now(timezone.utc).isoformat(),
        "contextosSha256":contextos_sha256,"verificacaoFontes":verificacao,"modelo":identidade,"dependencias":versoes(),"codigoExecutado":codigo,
        "journalTarefas":{"arquivo":str(journal_tarefas),"sha256":sha256(journal_tarefas)},
        "codigoMudouDuranteExecucao":any(sha256(Path(__file__).parent/n)!=h for n,h in codigo.items()),
        "config":{"maxTokens":a.max_tokens,"maxSequencia":a.max_sequencia,"passadas":a.passadas,"prompt":a.prompt,"promptPlano":a.prompt_plano or a.prompt,"alinharTemplate":a.alinhar_template,
                  "decodificacao":{"modo":a.decodificacao,"esquemaFonteSha256":codigo["esquema.py"]},"abstencaoSemFontes":"regra_declarada"},
        "casos":resultados,"resultados":[r for c in resultados for r in c["resultados"]],
        "limite":"Pipeline de hipóteses locais sem perfil oracle. Semântica e utilidade exigem revisão; não confirma perfil, posição no Google ou retorno financeiro."}
    salvar_json(a.saida,meta,exclusivo=True)
    print(json.dumps({"organizacoes":len(resultados),"tarefas":len(meta["resultados"]),"contratosValidos":sum(r["contratoValido"] for r in meta["resultados"])}),flush=True)


if __name__=="__main__":main()
