"""Cria casos locais com evidência real e rótulos técnicos fracos auditáveis.

Não chama IA nem atribui vendas, intenção comercial ou posição a páginas. Os
rótulos são inferências limitadas, não avaliações aprovadas por especialistas.
"""

import argparse
from collections import Counter
from datetime import datetime, timedelta
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys

IA = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(IA / "v3"))
sys.path.insert(0, str(IA))
from contrato_v3 import mensagens, validar_escolha
from inferir_v3 import sanear, preservar_estado_fonte
from runtime import RAIZ, sha256

V3 = IA / "v3"
OBJETIVOS = {
    "serp": {
        "train":"Qual a próxima etapa para verificar a posição atual e os concorrentes desta consulta?",
        "valid":"Quero saber onde esta página aparece hoje no Google e quem está antes dela.",
        "test":"Como confirmar a classificação atual e os resultados anteriores para esta busca?"},
    "comercial": {
        "train":"Qual termo oferece maior retorno financeiro e onde a verba está sendo desperdiçada?",
        "valid":"Consigo escolher investimento pela receita gerada por esta página?",
        "test":"Quero saber qual oportunidade trará mais resultado financeiro para a empresa."},
    "demanda": {
        "train":"Esta expressão foi extraída do site; o que fazer antes de dizer que as pessoas a procuram?",
        "valid":"A expressão no título comprova procura? Escolha a próxima investigação.",
        "test":"Este texto do site demonstra que existe demanda de busca por ele?"},
    "noindex": {
        "train":"O HTML tem uma diretiva de indexação. Qual a próxima verificação?",
        "valid":"Encontramos uma diretiva no HTML; o que conferir antes de mudar a publicação?",
        "test":"Como proceder com a diretiva de indexação observada nesta página?"},
    "h1": {
        "train":"Qual elemento do HTML inicial merece revisão para ajudar a entender a página?",
        "valid":"Que ponto observável do HTML deve ser conferido na página?",
        "test":"Há alguma melhoria verificável na estrutura inicial desta página?"},
}


class LeituraHTML(HTMLParser):
    """Segundo leitor independente do parse5: só sinais muito delimitados."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.em_head = False
        self.em_title = False
        self.ignorar = 0
        self.titulos = []
        self.meta_noindex = []
        self.h1_tags = 0

    def handle_starttag(self, tag, atributos):
        attrs = {k.lower(): (v or "") for k, v in atributos}
        if tag in ("script", "style", "template"):
            self.ignorar += 1
        if self.ignorar:
            return
        if tag == "head":
            self.em_head = True
        elif tag == "title" and self.em_head:
            self.em_title = True
        elif tag == "h1":
            self.h1_tags += 1
        elif tag == "meta" and self.em_head and attrs.get("name", "").strip().lower() in ("robots", "googlebot"):
            tokens = re.split(r"[\s,;]+", attrs.get("content", "").lower())
            if "noindex" in tokens or "none" in tokens:
                self.meta_noindex.append({"nome": attrs["name"].strip().lower(), "diretiva": "noindex" if "noindex" in tokens else "none"})

    def handle_endtag(self, tag):
        if tag in ("script", "style", "template") and self.ignorar:
            self.ignorar -= 1
            return
        if self.ignorar:
            return
        if tag == "head":
            self.em_head = False
        if tag == "title":
            self.em_title = False

    def handle_data(self, texto):
        if self.em_title and not self.ignorar:
            self.titulos.append(texto)


def json_bytes(valor):
    return (json.dumps(valor, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def carregar_coleta(pasta, reanalise):
    pasta, reanalise = Path(pasta), Path(reanalise)
    manifesto = json.loads((pasta / "manifest.json").read_text(encoding="utf-8"))
    revisao = json.loads(reanalise.read_text(encoding="utf-8"))
    if revisao["manifesto_sha256"] != sha256(pasta / "manifest.json"):
        raise ValueError("Reanálise não corresponde à coleta registrada.")
    if manifesto["escopo_sha256"] != sha256(pasta / "escopo.json"):
        raise ValueError("Escopo da coleta diverge do manifesto.")
    reavaliadas = {s["id"]: s for s in revisao["sites"]}
    for site in manifesto["sites"]:
        if not re.fullmatch(r"site-\d{2}", site["id"]):
            raise ValueError("ID de coleta inválido.")
        local = pasta / site["id"]
        registro_arquivo = local / "registro.json"
        if sha256(registro_arquivo) != site["sha256_registro"]:
            raise ValueError("Registro original alterado.")
        registro = json.loads(registro_arquivo.read_text(encoding="utf-8"))
        revista = reavaliadas[site["id"]]
        if registro["dominio"] != site["dominio"] or revista["dominio"] != site["dominio"] or registro["split"] != site["split"]:
            raise ValueError("Domínio ou grupo divergente.")
        paginas = []
        for meta in registro["arquivos"]:
            if not re.fullmatch(r"pagina-\d{2}\.html", meta["arquivo"]):
                raise ValueError("Nome de página inválido.")
            arq = local / meta["arquivo"]
            if sha256(arq) != meta["sha256_utf8_local"]:
                raise ValueError("HTML local alterado: " + str(arq))
            leitor = LeituraHTML()
            leitor.feed(arq.read_text(encoding="utf-8"))
            paginas.append((meta, leitor))
        yield site, registro, revista["diagnostico"], paginas, sha256(registro_arquivo)


def caso(site, meta, tipo, indice, evidencias, acao, refs, registro_sha):
    split = site["split"]
    entrada = {"site":site["dominio"], "objetivo":OBJETIVOS[tipo][split], "evidencias":evidencias,
               "dados_negocio":{"volume_busca":None,"taxa_conversao":None,"margem":None}}
    # Aplica a mesma sanitização da inferência, no instante da captura. Isso
    # evita ensinar um formato que a integração depois altera silenciosamente.
    instante = datetime.fromisoformat(meta["coletadoEm"].replace("Z", "+00:00")) + timedelta(seconds=1)
    entrada = preservar_estado_fonte(entrada, sanear(entrada, agora=instante), agora=instante)
    alvo = {"acao":acao, "evidencias":sorted(refs)}
    erros = validar_escolha(alvo, entrada)
    if erros:
        raise ValueError(f"Rótulo inconsistente {site['id']}/{tipo}: {erros}")
    chave = hashlib.sha256((site["dominio"] + '|' + meta["url"] + '|' + tipo).encode()).hexdigest()[:20]
    return {"id":"real-"+chave, "split":split, "grupo":site["dominio"], "tipo":tipo, "entrada":entrada,
            "esperado":alvo, "origem":{"url":meta["url"], "coletadoEm":meta["coletadoEm"],
            "sha256_html_utf8":meta["sha256_utf8_local"], "sha256_rede":meta["sha256_rede"],
            "sha256_registro":registro_sha, "tipo_revisao":"cheques_locais_independentes_nao_especialista"},
            "limite":"Rótulo técnico fraco; não mede resultado comercial, indexação efetiva ou intenção do proprietário."}


def construir(fontes):
    casos, dominios, falhas = [], {}, []
    for pasta, reanalise in fontes:
        for site, registro, diagnostico, paginas, registro_sha in carregar_coleta(pasta, reanalise):
            anterior = dominios.setdefault(site["dominio"], site["split"])
            if anterior != site["split"]:
                raise ValueError("Domínio cruzou splits: " + site["dominio"])
            if not paginas:
                falhas.append({"dominio":site["dominio"],"split":site["split"],"motivos":registro["falhas"]})
                continue
            por_id = {v["id"]:v for v in diagnostico["verificacoes"]}
            for indice, (meta, leitor) in enumerate(paginas):
                titulo = re.sub(r"\s+", " ", " ".join(leitor.titulos)).strip()[:130]
                pagina = {"id":"p1", "tipo":"pagina", "pagina":meta["url"], "atual":True,
                          "observado_em":meta["coletadoEm"], "sha256_pagina":meta["sha256_utf8_local"],
                          "descricao":"Título do HTML inicial: " + (titulo or "não identificado") + "."}
                serp = {"id":"s1", "tipo":"serp", "termo":titulo[:80], "pagina":meta["url"], "atual":False,
                        "posicao":None, "observado_em":None, "estado_fonte":"nao_consultada",
                        "descricao":"Nesta coleta nenhuma fonte de resultados do Google foi consultada; posição e concorrentes são desconhecidos."}
                negocio = {"id":"n1", "tipo":"negocio",
                           "descricao":"Nesta análise não foram conectados dados de custos, conversões, vendas ou margem."}
                casos.append(caso(site,meta,"serp",indice,[serp,pagina],"atualizar_coleta",["s1"],registro_sha))
                casos.append(caso(site,meta,"comercial",indice,[pagina,negocio],"medir_conversao",["n1"],registro_sha))
                casos.append(caso(site,meta,"demanda",indice,[pagina],"validar_demanda",["p1"],registro_sha))
                noindex = por_id.get("diretiva-noindex-html", {})
                if leitor.meta_noindex and meta["url"] in noindex.get("paginasAfetadas", []):
                    evidencia = {**pagina, "descricao":"O HTML inicial contém meta robots ou googlebot com noindex ou none. A intenção é desconhecida.",
                                 "verificacao":{"tipo":"meta_robots_noindex","escopo":"html_inicial","intencao":"desconhecida"}}
                    casos.append(caso(site,meta,"noindex",indice,[evidencia],"confirmar_publicacao",["p1"],registro_sha))
                h1 = por_id.get("titulo-principal", {})
                if leitor.h1_tags == 0 and meta["url"] in h1.get("paginasAfetadas", []):
                    evidencia = {**pagina, "descricao":"Não foi encontrado elemento h1 no HTML inicial desta página; a renderização por JavaScript não foi verificada.",
                                 "verificacao":{"tipo":"h1_ausente_html","escopo":"html_inicial"}}
                    casos.append(caso(site,meta,"h1",indice,[evidencia],"melhorar_pagina",["p1"],registro_sha))
    if len({c["id"] for c in casos}) != len(casos):
        raise ValueError("Casos repetidos: não duplique uma captura de página no conjunto.")
    if not all(any(c["split"] == s for c in casos) for s in ("train","valid","test")):
        raise ValueError("Treino, validação e teste precisam conter páginas reais.")
    return casos, dominios, falhas


def escrever(fontes, destino, repeticoes=6):
    if destino.exists():
        raise ValueError("O destino já existe; preserve o experimento anterior.")
    dados_raiz = (RAIZ / "data").resolve()
    if not destino.resolve().is_relative_to(dados_raiz):
        raise ValueError("Relatórios reais e dados de treino devem ficar em data/.")
    casos, dominios, falhas = construir(fontes)
    destino.mkdir(parents=True, mode=0o700)
    (destino / "desenvolvimento").mkdir(mode=0o700)
    (destino / "holdout").mkdir(mode=0o700)
    arquivos = {}
    for split in ("train","valid","test"):
        grupo = [c for c in casos if c["split"] == split]
        arquivos[f"casos-{split}.jsonl"] = b"".join(json_bytes(c) for c in grupo)
        conversas = [json_bytes({"messages":mensagens(c["entrada"],c["esperado"])}) for c in grupo]
        if split == "train":
            sinteticos = (V3 / "dados/desenvolvimento/train.jsonl").read_bytes()
            arquivos["desenvolvimento/train.jsonl"] = sinteticos + b"".join(conversas * repeticoes)
        else:
            nome = "desenvolvimento/valid.jsonl" if split == "valid" else "holdout/test.jsonl"
            arquivos[nome] = b"".join(conversas)
    for nome, conteudo in arquivos.items():
        caminho = destino / nome
        with caminho.open("xb") as f:
            os.chmod(caminho,0o600)
            f.write(conteudo)
    resumo = {"versao":1, "origem":"HTML público real, coleta local sem resultados do Google ou contas.",
              "rotulos":"Cheques técnicos fracos e revisão por agente; sem revisão humana especializada e sem medir resultados.",
              "splits":"Domínio atribuído antes da coleta. Teste contém empresas não usadas no treino nem na seleção.",
              "contagens":dict(Counter(c["split"] for c in casos)),
              "tipos":{s:dict(Counter(c["tipo"] for c in casos if c["split"] == s)) for s in ("train","valid","test")},
              "dominios_com_casos":{s:len({c["grupo"] for c in casos if c["split"] == s}) for s in ("train","valid","test")},
              "capturas_sem_paginas":falhas, "repeticoes_treino_real":repeticoes,
              "sinteticos_treino_sha256":sha256(V3 / "dados/desenvolvimento/train.jsonl"),
              "fontes":[{"coleta_manifest_sha256":sha256(Path(p)/"manifest.json"),"reanalise_sha256":sha256(r)} for p,r in fontes],
              "arquivos":{n:{"sha256":hashlib.sha256(b).hexdigest(),"bytes":len(b)} for n,b in sorted(arquivos.items())}}
    manifest=destino/"manifest.json"
    with manifest.open("x",encoding="utf-8") as f:
        os.chmod(manifest,0o600)
        json.dump(resumo,f,ensure_ascii=False,indent=2)
        f.write("\n")
    return resumo


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fonte", nargs=2, action="append", required=True, metavar=("COLETA","REANALISE"))
    parser.add_argument("--saida",type=Path,required=True)
    args=parser.parse_args()
    m=escrever([(Path(p),Path(r)) for p,r in args.fonte],args.saida)
    print(json.dumps({"contagens":m["contagens"],"tipos":m["tipos"],"dominios":m["dominios_com_casos"]},ensure_ascii=False))
