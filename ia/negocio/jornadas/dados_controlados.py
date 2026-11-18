"""Corpus autoral de jornadas. Não lê casos reais, não treina nem infere modelos.

As traduções/variações compartilham família e entidade fictícia. As divisões
são predefinidas por família e a reserva é de uso, não um teste humano cego.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import random
import sys

IA = Path(__file__).resolve().parents[2]
if str(IA) not in sys.path:
    sys.path.insert(0, str(IA))

from negocio.jornadas.contrato import validar_base, validar_ofertas, validar_jornada
from negocio.jornadas.protocolo import mensagens

VERSAO = 1
INSTANTE_PADRAO = "2026-11-16T13:30:00.000Z"
SEMENTE_PADRAO = 412117
FAMILIAS = (
    ("servico_proprio", "treino", "Contratante, executor próprio, beneficiário e patrocinador distintos."),
    ("intermediacao_artistica", "treino", "Intermediário não vira executor nem representa exclusividade."),
    ("software_gestao", "treino", "Disponibilizar software não significa executar a gestão do cliente."),
    ("cortesia_restrita", "treino", "Cortesia de hóspedes não é serviço avulso nem gratuidade geral."),
    ("abertura_e_taxa_oficial", "treino", "Abertura gratuita e taxa oficial são objetos financeiros distintos."),
    ("cadastro_profissional", "treino", "Requisito do formulário do prestador não restringe o comprador."),
    ("programa_social", "treino", "Beneficiários sociais não viram compradores; apoiadores não viram executores."),
    ("venda_e_acao_historica", "treino", "Venda atual não vira programa gratuito por notícia de doação passada."),
    ("formacao_corporativa", "validacao", "Organização contratante/pagadora e colaboradores beneficiários."),
    ("concessao_de_recursos", "validacao", "Organização concede e paga recursos; destinatário não é pagador."),
    ("locacao_com_operador", "reserva", "Disponibilização de equipamento, operação terceira e financiador separados."),
    ("informacao_insuficiente", "reserva", "Abster no head sem oferta e nos atores sem relação publicada."),
)
NOMES = ("Brisa", "Cedro", "Nacre", "Lago")


def json_canonico(valor):
    return json.dumps(valor, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(valor):
    if isinstance(valor, str):
        valor = valor.encode("utf-8")
    return hashlib.sha256(valor).hexdigest()


def _instante(valor):
    if not isinstance(valor, str):
        raise ValueError("Instante deve ser UTC em texto.")
    try:
        d = datetime.fromisoformat(valor.replace("Z", "+00:00"))
        if d.tzinfo is None or d.utcoffset().total_seconds() != 0:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Instante UTC inválido.") from None
    return d.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _jornada(compradores=(), executores=(), beneficiarios=(), pagadores=(), condicoes=(), duvidas=()):
    def atores(itens):
        return [{"grupo": grupo, "evidencias": list(refs)} for grupo, refs in itens]
    return {"compradores": atores(compradores), "executores": atores(executores),
            "beneficiarios": atores(beneficiarios), "pagadores": atores(pagadores),
            "condicoes": [{"categoria": categoria, "evidencia": ref, "aplicacao": aplicacao}
                          for categoria, ref, aplicacao in condicoes], "duvidas": list(duvidas)}


def _conteudo(familia, variante, idioma):
    """Textos e alvos autorais, independentes de respostas de qualquer modelo."""
    en = idioma == "en"
    nome = NOMES[variante]
    limite = (10, 24, 80, 150)[variante]
    nomes = {
        "servico_proprio": (f"Organização de encontros {nome}", f"{nome} event coordination"),
        "intermediacao_artistica": (f"Intermediação musical {nome}", f"{nome} music booking brokerage"),
        "software_gestao": (f"Gestão de estoque {nome}", f"{nome} inventory software"),
        "cortesia_restrita": (f"Sala recreativa {nome}", f"{nome} recreation room"),
        "abertura_e_taxa_oficial": (f"Protocolo de registro {nome}", f"{nome} registration filing"),
        "cadastro_profissional": (f"Conexão de manutenção {nome}", f"{nome} maintenance matching"),
        "programa_social": (f"Oficinas comunitárias {nome}", f"{nome} community workshops"),
        "venda_e_acao_historica": (f"Cadernos artesanais {nome}", f"{nome} handmade notebooks"),
        "formacao_corporativa": (f"Formação interna {nome}", f"{nome} workplace training"),
        "concessao_de_recursos": (f"Programa de repasses {nome}", f"{nome} community grant program"),
        "locacao_com_operador": (f"Locação de equipamentos {nome}", f"{nome} equipment leasing"),
        "informacao_insuficiente": (f"Apoio documental {nome}", f"{nome} document support"),
    }
    oferta = nomes[familia][en]
    fontes = []

    def f(id_, texto, secao=None, tipo="conteudo", classe="institucional"):
        fontes.append({"chave": id_, "texto": texto,
                       "secao": secao or ("Published service" if en else "Serviço publicado"),
                       "tipo": tipo, "classe": classe})

    tipo, papel = "servico", "executa"
    if familia == "servico_proprio":
        cliente = f"{nome} associations" if en else f"associações {nome}"
        publico = f"{nome} guests" if en else f"convidados {nome}"
        pagador = f"{nome} sponsors" if en else f"patrocinadores {nome}"
        f("a", f"We carry out {oferta}. {cliente} contract this service for {publico}." if en else
          f"Executamos {oferta}. {cliente} contratam este serviço para {publico}.", tipo="declaracao")
        f("b", f"For {oferta}, {pagador} pay the service fee to our organization. The guests do not make the payment." if en else
          f"Em {oferta}, {pagador} pagam o serviço à nossa organização. Os convidados não fazem o pagamento.")
        f("c", f"{oferta} requires at least {limite} confirmed guests. Other terms are not described here." if en else
          f"{oferta} exige no mínimo {limite} convidados confirmados. Outras condições não estão descritas aqui.")
        jornada = _jornada([(cliente, ["a"])], [("$site", ["a"])], [(publico, ["a"])], [(pagador, ["b"])],
                            [("limite", "c", "esta_oferta")])
    elif familia == "intermediacao_artistica":
        papel = "intermedeia"
        cliente = f"{nome} event organizers" if en else f"organizadores {nome}"
        executor = f"{nome} musicians" if en else f"músicos {nome}"
        publico = f"{nome} audiences" if en else f"públicos {nome}"
        f("a", f"{oferta} connects {cliente} with {executor}. We mediate the booking and do not perform the show ourselves." if en else
          f"{oferta} conecta {cliente} a {executor}. Intermediamos a contratação e não executamos o show.", tipo="declaracao")
        f("b", f"{executor} perform the shows for {publico}. {cliente} contract and pay the musicians directly." if en else
          f"{executor} realizam os shows para {publico}. {cliente} contratam e pagam diretamente os músicos.")
        f("c", f"For {oferta}, availability must be confirmed before the booking. No exclusive representation is stated." if en else
          f"Em {oferta}, a disponibilidade deve ser confirmada antes da contratação. Não há declaração de representação exclusiva.")
        jornada = _jornada([(cliente, ["a", "b"])], [(executor, ["b"])], [(publico, ["b"])], [(cliente, ["b"])],
                            [("elegibilidade", "c", "esta_oferta")], ["Comissão da intermediação não publicada."])
    elif familia == "software_gestao":
        tipo, papel = "software", "disponibiliza"
        cliente = f"{nome} retailers" if en else f"varejistas {nome}"
        executor = f"{nome} stock teams" if en else f"equipes de estoque {nome}"
        f("a", f"We provide {oferta}, software that {cliente} subscribe to and use through their {executor}. We do not operate the customers' inventory." if en else
          f"Disponibilizamos {oferta}, software contratado por {cliente} e utilizado por suas {executor}. Não operamos o estoque dos clientes.", tipo="declaracao")
        f("b", f"{executor} perform inventory control using {oferta}. {cliente} pay the software subscription fee." if en else
          f"{executor} executam o controle de estoque usando {oferta}. {cliente} pagam a assinatura do software.")
        f("c", f"{oferta} includes a maximum of {limite} users in this plan." if en else
          f"{oferta} inclui no máximo {limite} usuários neste plano.")
        jornada = _jornada([(cliente, ["a"])], [(executor, ["b"])], [(executor, ["a", "b"])], [(cliente, ["b"])],
                            [("limite", "c", "esta_oferta")])
    elif familia == "cortesia_restrita":
        papel = "disponibiliza"
        publico = f"registered {nome} guests" if en else f"hóspedes cadastrados {nome}"
        f("a", f"We make {oferta} available as a guest amenity. {publico} use this space during their stay." if en else
          f"Disponibilizamos {oferta} como comodidade da hospedagem. {publico} utilizam este espaço durante a estadia.", tipo="declaracao")
        f("b", f"{oferta} is free only for {publico}; separate public admission is not offered." if en else
          f"{oferta} é gratuita somente para {publico}; não há venda de ingresso avulso ao público.")
        f("c", f"The page does not identify who contracts or pays for the stay. {oferta} is not described as a separately purchased service." if en else
          f"A página não identifica quem contrata ou paga a hospedagem. {oferta} não é descrita como serviço comprado separadamente.")
        jornada = _jornada(beneficiarios=[(publico, ["a", "b"])],
                            condicoes=[("preco", "b", "esta_oferta"), ("elegibilidade", "b", "esta_oferta")],
                            duvidas=["Contratante e pagador da hospedagem não publicados; não atribuir esses papéis à comodidade."])
    elif familia == "abertura_e_taxa_oficial":
        cliente = f"{nome} applicants" if en else f"solicitantes {nome}"
        f("a", f"We carry out {oferta} when {cliente} request registration support. The applicants receive the filing support." if en else
          f"Executamos {oferta} quando {cliente} solicitam apoio ao registro. Os solicitantes recebem o apoio ao protocolo.", tipo="declaracao")
        f("b", f"Opening {oferta} is free. {cliente} pay an official fee of R$ {limite} directly to the public authority; that fee is not payment to our organization." if en else
          f"A abertura de {oferta} é gratuita. {cliente} pagam a taxa oficial de R$ {limite} diretamente ao órgão público; essa taxa não é pagamento à nossa organização.")
        f("c", f"{oferta} does not include exemption from official fees. The price of any additional service is not published." if en else
          f"{oferta} não inclui isenção de taxas oficiais. O preço de eventual serviço adicional não está publicado.")
        jornada = _jornada([(cliente, ["a"])], [("$site", ["a"])], [(cliente, ["a"])], [(cliente, ["b"])],
                            [("preco", "b", "esta_oferta"), ("exclusao", "c", "esta_oferta")],
                            ["A taxa oficial tem destinatário público; remuneração adicional do site não publicada."])
    elif familia == "cadastro_profissional":
        papel = "intermedeia"
        cliente = f"{nome} property managers" if en else f"síndicos {nome}"
        executor = f"{nome} independent technicians" if en else f"técnicos autônomos {nome}"
        f("a", f"{oferta} matches {cliente}, who request maintenance, with {executor}, who perform the work. We mediate these requests." if en else
          f"{oferta} conecta {cliente}, que solicitam manutenção, a {executor}, que executam o trabalho. Intermediamos esses pedidos.", tipo="declaracao")
        f("b", f"Only {executor} aged 18 or over may submit the professional registration form. This form condition does not define eligibility for customers requesting maintenance." if en else
          f"Somente {executor} com 18 anos ou mais podem enviar o formulário de cadastro profissional. A condição deste formulário não define elegibilidade dos clientes que pedem manutenção.", secao="Professional registration form" if en else "Formulário de cadastro profissional")
        f("c", "The page does not identify who pays or who ultimately receives the maintenance benefit." if en else
          "A página não identifica quem paga nem quem recebe, ao final, o benefício da manutenção.")
        jornada = _jornada([(cliente, ["a"])], [(executor, ["a"])], condicoes=[("elegibilidade", "b", "formulario")],
                            duvidas=["Pagador e beneficiário final não publicados."])
    elif familia == "programa_social":
        tipo = "programa_social"
        publico = f"{nome} neighborhood residents" if en else f"moradores {nome}"
        pagador = f"{nome} supporting foundations" if en else f"fundações apoiadoras {nome}"
        f("a", f"We run {oferta}, a free social program for {publico}. Participants receive workshops and do not purchase them." if en else
          f"Executamos {oferta}, programa social gratuito para {publico}. Os participantes recebem oficinas e não as compram.", tipo="declaracao")
        f("b", f"{pagador} pay the operating costs of {oferta}. They do not deliver the workshops." if en else
          f"{pagador} pagam os custos de operação de {oferta}. Elas não executam as oficinas.")
        f("c", f"{oferta} has a maximum of {limite} participants in each group." if en else
          f"{oferta} tem limite de {limite} participantes por turma.")
        jornada = _jornada(executores=[("$site", ["a"])], beneficiarios=[(publico, ["a"])], pagadores=[(pagador, ["b"])],
                            condicoes=[("preco", "a", "esta_oferta"), ("limite", "c", "esta_oferta")])
    elif familia == "venda_e_acao_historica":
        tipo, papel = "produto", "vende"
        cliente = f"{nome} stationery shops" if en else f"papelarias {nome}"
        publico = f"{nome} student groups" if en else f"grupos de estudantes {nome}"
        f("a", f"We sell {oferta}. {cliente} buy and pay for these notebooks, which they provide for use by {publico}." if en else
          f"Vendemos {oferta}. {cliente} compram e pagam os cadernos, que destinam ao uso de {publico}.", tipo="declaracao")
        f("b", f"For {oferta}, the minimum order is {limite} units. The manufacturer is not identified on this page." if en else
          f"Para {oferta}, o pedido mínimo é de {limite} unidades. O fabricante não é identificado nesta página.")
        f("c", "Archive from 2020: our team donated books to a community project. This historical article does not announce a current free distribution program." if en else
          "Arquivo de 2020: nossa equipe doou livros a um projeto comunitário. Esta notícia histórica não anuncia programa atual de distribuição gratuita.",
          secao="Historical archive" if en else "Arquivo histórico", classe="editorial")
        jornada = _jornada([(cliente, ["a"])], beneficiarios=[(publico, ["a"])], pagadores=[(cliente, ["a"])],
                            condicoes=[("limite", "b", "esta_oferta")], duvidas=["O fabricante e a execução da produção não estão publicados."])
    elif familia == "formacao_corporativa":
        cliente = f"{nome} employers" if en else f"empregadores {nome}"
        publico = f"{nome} staff members" if en else f"colaboradores {nome}"
        f("a", f"We deliver {oferta}. {cliente} contract the training for {publico}, who attend the sessions." if en else
          f"Executamos {oferta}. {cliente} contratam a formação para {publico}, que participam das sessões.", tipo="declaracao")
        f("b", f"{cliente} pay for {oferta}; the staff members do not pay individual tuition." if en else
          f"{cliente} pagam por {oferta}; os colaboradores não pagam mensalidade individual.")
        f("c", f"{oferta} requires a group of at least {limite} staff members. Contact the training team before scheduling." if en else
          f"{oferta} exige grupo de no mínimo {limite} colaboradores. Entre em contato com a equipe antes do agendamento.")
        jornada = _jornada([(cliente, ["a"])], [("$site", ["a"])], [(publico, ["a"])], [(cliente, ["b"])],
                            [("limite", "c", "esta_oferta")])
    elif familia == "concessao_de_recursos":
        tipo = "programa_social"
        publico = f"{nome} community collectives" if en else f"coletivos comunitários {nome}"
        f("a", f"We run {oferta}, a social grant program that supports {publico}. The collectives receive support rather than buying a service." if en else
          f"Executamos {oferta}, programa social de repasses que apoia {publico}. Os coletivos recebem apoio em vez de comprar um serviço.", tipo="declaracao")
        f("b", f"In {oferta}, we pay grants of R$ {limite * 100} to {publico}. This is money granted by our organization, not money collected from the recipients." if en else
          f"Em {oferta}, pagamos repasses de R$ {limite * 100} aos {publico}. É recurso concedido por nossa organização, não recurso captado dos destinatários.")
        f("c", f"For {oferta}, only selected collectives receive a grant. Selection criteria beyond this condition are not published here." if en else
          f"Em {oferta}, somente coletivos selecionados recebem repasse. Critérios de seleção além desta condição não estão publicados aqui.")
        jornada = _jornada(executores=[("$site", ["a"])], beneficiarios=[(publico, ["a", "b"])], pagadores=[("$site", ["b"])],
                            condicoes=[("elegibilidade", "c", "esta_oferta")],
                            duvidas=["O valor é apoio concedido; inscrição aberta e critérios completos não foram publicados."])
    elif familia == "locacao_com_operador":
        papel = "disponibiliza"
        cliente = f"{nome} production teams" if en else f"produtoras {nome}"
        executor = f"{nome} external operators" if en else f"operadores externos {nome}"
        pagador = f"{nome} financing cooperatives" if en else f"cooperativas financiadoras {nome}"
        f("a", f"We provide {oferta} to {cliente}, who contract and use the rented equipment. We do not operate it." if en else
          f"Disponibilizamos {oferta} às {cliente}, que contratam e utilizam os equipamentos alugados. Não operamos os equipamentos.", tipo="declaracao")
        f("b", f"{executor} operate the rented equipment for {cliente}. {pagador} pay the leasing fee to our organization." if en else
          f"{executor} operam os equipamentos alugados para {cliente}. {pagador} pagam o valor da locação à nossa organização.")
        f("c", f"{oferta} has a minimum duration of {variante + 2} days. Operator availability is not guaranteed." if en else
          f"{oferta} tem prazo mínimo de {variante + 2} dias. A disponibilidade dos operadores não é garantida.")
        jornada = _jornada([(cliente, ["a"])], [(executor, ["b"])], [(cliente, ["a", "b"])], [(pagador, ["b"])],
                            [("prazo", "c", "esta_oferta")])
    elif familia == "informacao_insuficiente":
        if variante < 2:
            f("a", "Home | Contact | Register" if en else "Início | Contato | Cadastro", tipo="interface", secao="Menu")
            f("b", "Privacy policy: data entered in a form is retained for 30 days. This policy does not describe the organization's services." if en else
              "Política de privacidade: dados preenchidos em formulário ficam armazenados por 30 dias. Esta política não descreve os serviços da organização.",
              secao="Privacy policy" if en else "Política de privacidade", classe="politica")
            return {"fontes": fontes, "oferta": None, "jornada": None,
                    "duvidas_ofertas": ["Não há oferta atual sustentada nas fontes recebidas."],
                    "sem_jornada": "Sem oferta sustentada; não se fabrica entrada oracle para a jornada."}
        papel = "disponibiliza"
        f("a", f"We make {oferta} available. This description names the service without identifying who contracts, uses, executes, or pays for it." if en else
          f"Disponibilizamos {oferta}. Esta descrição nomeia o serviço sem identificar quem contrata, utiliza, executa ou paga por ele.", tipo="declaracao")
        f("b", "The page has a contact link. Service conditions, customer groups and payment responsibilities are not published." if en else
          "A página contém um link de contato. Condições do serviço, grupos de clientes e responsabilidades de pagamento não estão publicados.", tipo="interface", secao="Navigation" if en else "Navegação")
        jornada = _jornada(duvidas=["Comprador, executor, beneficiário, pagador e condições não publicados."])
    else:
        raise ValueError("Família não prevista.")
    return {"fontes": fontes, "oferta": {"nome": oferta, "natureza": tipo, "papel_site": papel, "evidencias": ["a"]},
            "jornada": jornada, "duvidas_ofertas": [], "sem_jornada": None}


def _remapear(valor, mapa):
    if isinstance(valor, list):
        return [_remapear(v, mapa) for v in valor]
    if isinstance(valor, dict):
        return {k: [mapa[r] for r in v] if k == "evidencias" else mapa[v] if k == "evidencia" else _remapear(v, mapa)
                for k, v in valor.items()}
    return valor


def construir_corpus(*, instante=INSTANTE_PADRAO, semente=SEMENTE_PADRAO):
    instante = _instante(instante)
    if type(semente) is not int or not 0 <= semente <= 2**32 - 1:
        raise ValueError("Semente inteira entre 0 e 2**32-1 necessária.")
    casos, documentos = [], {}
    for indice, (familia, divisao, risco) in enumerate(FAMILIAS):
        for variante in range(4):
            entidade = sha256(f"entidade-autoral:{familia}:{variante}")[:16]
            for idioma in ("pt", "en"):
                id_ = f"jornada-{indice+1:02}-{variante+1:02}-{idioma}"
                conteudo = _conteudo(familia, variante, idioma)
                dominio = entidade + ".exemplo.invalid"
                url = f"https://{dominio}/{idioma}/informacoes"
                titulo = "Published information" if idioma == "en" else "Informações publicadas"
                originais = conteudo["fontes"]
                documento = "<!doctype html>\n<html lang=\"" + idioma + "\"><head><meta charset=\"utf-8\"><title>" + titulo + "</title></head><body>\n<h1>" + titulo + "</h1>\n"
                for fonte in originais:
                    documento += "<section><h2>" + html.escape(fonte["secao"]) + "</h2><p>" + html.escape(fonte["texto"]) + "</p></section>\n"
                documento += "</body></html>\n"
                caminho = f"documentos/{id_}.html"
                documentos[caminho] = documento
                hash_documento = sha256(documento)
                ordenadas = deepcopy(originais)
                random.Random(semente + indice * 101 + variante * 7).shuffle(ordenadas)
                mapa = {f["chave"]: f"s{i+1:02}" for i, f in enumerate(ordenadas)}
                fontes = [{"id": mapa[f["chave"]], "texto": f["texto"], "tipo": f["tipo"], "contexto": {
                    "paginaId": "pag_" + sha256(url)[:20], "url": url, "tituloPagina": titulo,
                    "titulos": [{"nivel": 1, "texto": titulo}, {"nivel": 2, "texto": f["secao"]}],
                    "campo": "p", "coletadoEm": instante, "sha256": hash_documento, "recortado": False,
                    "classePagina": f["classe"]}} for f in ordenadas]
                oferta = _remapear(conteudo["oferta"], mapa)
                alvo_ofertas = {"ofertas": [oferta] if oferta else [], "duvidas": conteudo["duvidas_ofertas"]}
                alvo_jornada = _remapear(conteudo["jornada"], mapa)
                casos.append({"id": id_, "natureza": "controlado_autoral", "familia": familia,
                    "grupoFamilia": familia, "entidadeFicticia": entidade, "grupoAtores": entidade,
                    "variante": variante + 1, "idioma": idioma, "divisao": divisao,
                    "base": {"versao": 1, "dominio": dominio, "fontes": fontes},
                    "alvoOfertas": alvo_ofertas, "ofertaEntradaJornada": oferta,
                    "alvoJornada": alvo_jornada, "jornadaNaoGeradaMotivo": conteudo["sem_jornada"],
                    "riscoControlado": risco,
                    "documento": {"caminho": caminho, "sha256": hash_documento, "codificacao": "utf-8", "url": url},
                    "revisaoHumana": False, "prontoParaUsoComClientes": False,
                    "alvoSubstituidoPorRegra": False})
    corpus = {"versao": VERSAO, "instante": instante, "semente": semente, "casos": casos, "documentos": documentos}
    validar_corpus(corpus)
    return corpus


def tarefas_caso(caso):
    tarefas = [{"id": caso["id"] + ":ofertas", "tarefa": "identificar_ofertas", "oferta": None, "alvo": deepcopy(caso["alvoOfertas"])}]
    if caso["alvoJornada"] is not None:
        tarefas.append({"id": caso["id"] + ":jornada", "tarefa": "descrever_jornada",
                        "oferta": deepcopy(caso["ofertaEntradaJornada"]), "alvo": deepcopy(caso["alvoJornada"])})
    return tarefas


def mensagens_tarefa(caso, tarefa):
    ms = mensagens(caso["base"], tarefa["oferta"])
    return ms + [{"role": "assistant", "content": json.dumps(tarefa["alvo"], ensure_ascii=False, separators=(",", ":"))}]


def validar_corpus(corpus):
    """Falha no alvo recusado; não remove item, corrige saída ou cria abstenção."""
    vistos, grupos, entidades, atores = set(), {}, {}, {}
    contagem = {d: {"casos": 0, "tarefas": 0} for d in ("treino", "validacao", "reserva")}
    for caso in corpus["casos"]:
        if caso["id"] in vistos:
            raise ValueError("Caso duplicado: " + caso["id"])
        vistos.add(caso["id"])
        if caso["divisao"] not in contagem or caso["natureza"] != "controlado_autoral" or caso["alvoSubstituidoPorRegra"] is not False:
            raise ValueError("Metadados de curadoria inválidos.")
        for mapa, chave in ((grupos, "grupoFamilia"), (entidades, "entidadeFicticia"), (atores, "grupoAtores")):
            anterior = mapa.setdefault(caso[chave], caso["divisao"])
            if anterior != caso["divisao"]:
                raise ValueError("Vazamento entre divisões: " + chave)
        base = caso["base"]
        if validar_base(base):
            raise ValueError("Base recusada: " + caso["id"] + " " + str(validar_base(base)))
        doc = corpus["documentos"][caso["documento"]["caminho"]]
        if sha256(doc) != caso["documento"]["sha256"]:
            raise ValueError("Hash do documento divergente: " + caso["id"])
        for fonte in base["fontes"]:
            c = fonte["contexto"]
            if c["sha256"] != sha256(doc) or html.escape(fonte["texto"]) not in doc or c["url"] != caso["documento"]["url"]:
                raise ValueError("Fonte sem documento contínuo: " + caso["id"])
        v = validar_ofertas(caso["alvoOfertas"], base)
        if v.get("erro") or v["recusadas"] or len(v["ofertas"]) != len(caso["alvoOfertas"]["ofertas"]):
            raise ValueError("Alvo de ofertas recusado: " + caso["id"] + " " + json_canonico(v))
        if caso["alvoJornada"] is None:
            if caso["ofertaEntradaJornada"] is not None or caso["alvoOfertas"]["ofertas"] or not caso["jornadaNaoGeradaMotivo"]:
                raise ValueError("Ausência de jornada incoerente.")
        else:
            if caso["ofertaEntradaJornada"] not in caso["alvoOfertas"]["ofertas"]:
                raise ValueError("Oferta de jornada não veio do alvo de leitura.")
            j = validar_jornada(caso["alvoJornada"], base, caso["ofertaEntradaJornada"])
            if j.get("erro") or j["recusados"]:
                raise ValueError("Alvo de jornada recusado: " + caso["id"] + " " + json_canonico(j))
        contagem[caso["divisao"]]["casos"] += 1
        contagem[caso["divisao"]]["tarefas"] += len(tarefas_caso(caso))
    return {"casos": len(vistos), "familias": len(grupos), "entidadesFicticias": len(entidades),
            "alvosRecusados": 0, "alvosSubstituidosPorRegra": 0, "divisoes": contagem}


def _codigos():
    paths = [Path(__file__), IA / "negocio/jornadas/contrato.py", IA / "negocio/jornadas/protocolo.py", IA / "negocio/relacoes/contrato.py"]
    return {str(p.relative_to(IA.parent)): sha256(p.read_bytes()) for p in paths}


def gravar_corpus(saida, *, instante=INSTANTE_PADRAO, semente=SEMENTE_PADRAO):
    pasta = Path(saida)
    if pasta.exists():
        raise FileExistsError("A saída deve ser uma pasta nova: " + str(pasta))
    codigo = _codigos()
    corpus = construir_corpus(instante=instante, semente=semente)
    resumo = validar_corpus(corpus)
    arquivos = dict(corpus["documentos"])
    arquivos["casos.jsonl"] = "".join(json_canonico(c) + "\n" for c in corpus["casos"])
    rotas = {"treino": "dados-treino/train.jsonl", "validacao": "dados-treino/valid.jsonl", "reserva": "reserva/controlados-reservados.jsonl"}
    linhas = {d: [] for d in rotas}
    mapa_linhas = []
    for caso in corpus["casos"]:
        for tarefa in tarefas_caso(caso):
            ms = mensagens_tarefa(caso, tarefa)
            registro = {"messages": ms}
            linha = json.dumps(registro, ensure_ascii=False, separators=(",", ":"))
            linhas[caso["divisao"]].append(linha)
            mapa_linhas.append({"tarefaId": tarefa["id"], "casoId": caso["id"], "familia": caso["familia"],
                "entidadeFicticia": caso["entidadeFicticia"], "divisao": caso["divisao"], "arquivo": rotas[caso["divisao"]],
                "linha": len(linhas[caso["divisao"]]), "sha256LinhaSemQuebra": sha256(linha),
                "protocoloMessagesSha256": sha256(json_canonico(ms[:-1])), "alvoSha256": sha256(json_canonico(tarefa["alvo"]))})
    for divisao, caminho in rotas.items():
        arquivos[caminho] = "\n".join(linhas[divisao]) + "\n"
    arquivos["mapa-tarefas.jsonl"] = "".join(json_canonico(m) + "\n" for m in mapa_linhas)
    manifesto = {"versao": VERSAO, "natureza": "controlado_autoral", "instanteDocumentos": corpus["instante"],
        "semente": semente, "resumo": resumo,
        "familiasPredefinidas": [{"id": f, "divisao": d, "risco": r} for f, d, r in FAMILIAS],
        "codigoSha256": codigo, "arquivosSha256": {p: sha256(t) for p, t in sorted(arquivos.items())},
        "testeRealAnteriorLido": False, "fontesPrivadas": False, "treinoExecutado": False,
        "inferenciaExecutada": False, "revisaoHumana": False, "prontoParaUsoComClientes": False,
        "reserva": {"tipo": "reserva_de_uso_por_familia", "testeHumanoCego": False,
            "usadaParaTreinar": False, "usadaParaSelecionarModelo": False,
            "limite": "Autores e testes de contrato conhecem os alvos. Padrões gerais se repetem entre famílias; não é evidência independente em empresas reais."},
        "limites": ["96 documentos autorais não são 96 empresas reais: há 48 entidades fictícias e pares PT/EN dependentes.",
                    "Cada família usa quatro variações de nomes/quantidades e duas línguas; aumentar linhas não aumenta a diversidade proporcionalmente.",
                    "Pagadores só são rotulados quando a fonte declara pagamento. Software e intermediário não ganham execução própria por inferência.",
                    "Sem oferta sustentada, há somente tarefa de ofertas. Não foi criada entrada oracle para forçar jornada.",
                    "Passar contrato prova estrutura e referências, não revisão profissional humana, generalização ou retorno comercial.",
                    "O instante de documento é metadado autoral reproduzível, não data de coleta de um site real."]}
    if _codigos() != codigo:
        raise RuntimeError("Contrato/protocolo mudou durante a geração; regenere antes de congelar.")
    manifesto_texto = json.dumps(manifesto, ensure_ascii=False, indent=2) + "\n"
    pasta.mkdir(parents=True, exist_ok=False)
    for relativo, conteudo in sorted(arquivos.items()):
        caminho = pasta / relativo
        caminho.parent.mkdir(parents=True, exist_ok=True)
        with caminho.open("x", encoding="utf-8", newline="\n") as f:
            f.write(conteudo)
    # O manifesto fechado só aparece depois de todos os arquivos enumerados.
    with (pasta / "manifesto.json").open("x", encoding="utf-8", newline="\n") as f:
        f.write(manifesto_texto)
    return manifesto


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--saida", type=Path, required=True, help="Pasta NOVA, sem sobrescrita.")
    parser.add_argument("--instante", default=INSTANTE_PADRAO)
    parser.add_argument("--semente", type=int, default=SEMENTE_PADRAO)
    args = parser.parse_args()
    manifesto = gravar_corpus(args.saida, instante=args.instante, semente=args.semente)
    print(json.dumps({"saida": str(args.saida.resolve()), **manifesto["resumo"], "treinoExecutado": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
