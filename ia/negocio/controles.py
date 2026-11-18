"""Controles autorais: sem fingir que documentos simulados foram publicados."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

IA = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(IA))
from negocio.contrato import CAMPOS, validar_saida, compactar_ids
from runtime import salvar_json, sha256


def item(texto, tipo=None, funcao=None, escopo=None, fonte="f01"):
    r={"texto":texto,"fontes":[fonte]}
    if tipo is not None:r["tipo"]=tipo
    if funcao is not None:r.update(funcao=funcao,escopo=escopo)
    if tipo is None and funcao is None:r["escopo"]=escopo
    return r


def hipotese(valor, fontes=("f01",)):
    return {"estado":"hipotese","valor":valor,"fontes":list(fontes),"faltam":[]}


def insuficiente(campo):
    return {"estado":"insuficiente","valor":"indefinido" if campo=="papel" else "indefinida" if campo=="finalidade" else [],"fontes":[],"faltam":[campo]}


def construir_cenarios():
    cenarios=[]
    def caso(id,texto,papel=None,finalidade=None,ofertas=None,publicos=None,atuacoes=None,condicoes=None,split="train",tipo="declaracao"):
        valores={"papel":papel,"finalidade":finalidade,"ofertas":ofertas,"publicos":publicos,"atuacoes":atuacoes,"condicoes":condicoes}
        fontes=[{"id":"f01","texto":texto,"tipo":tipo}]
        alvos={k:hipotese(v) if v else insuficiente(k) for k,v in valores.items()}
        for campo,esperado in alvos.items():
            erros=validar_saida(esperado,{"tarefa":"entender","campo":campo,"fontes":fontes})
            if erros:raise ValueError(id+" "+campo+" "+str(erros))
        cenarios.append({"id":"controle-"+id,"grupoEmpresarial":"simulacao-familia-"+id,"dominio":"controle.invalid",
            "split":split,"natureza":"contrafactual_controlado_nao_publicado","fontes":fontes,"alvosPorCampo":alvos,
            "proveniencia":{"tipo":"documento_autoral_simulado","publicado":False,"sha256Texto":hashlib.sha256(texto.encode()).hexdigest()},
            "elegivelTreinoExperimental":True,"revisaoHumana":False,"origemRotulos":"Controle autoral de semântica explícita, separado de empresas reais; não prova generalização."})
    caso("agenciamento",
        "Somos uma agência comercial de agenciamento de artistas. Conectamos artistas a produtores. A contratação está sujeita à disponibilidade do artista.",
        "intermediacao","comercial",[item("agenciamento de artistas",tipo="servico")],
        [item("artistas",funcao="prestador"),item("produtores",funcao="cliente")],
        condicoes=[item("sujeita à disponibilidade do artista",escopo="contratação")])
    caso("software-sem-transporte",
        "Vendemos um sistema de gestão para operadoras de ônibus. Não vendemos passagens e não atendemos passageiros. A licença cobre somente a gestão interna.",
        "produtos","comercial",[item("sistema de gestão",tipo="produto")],
        [item("operadoras de ônibus",funcao="cliente"),item("passageiros",funcao="excluido")],
        condicoes=[item("A licença cobre somente a gestão interna",escopo="sistema de gestão")])
    caso("industria-logistica",
        "Fabricamos e vendemos peças metálicas para montadoras. A entrega é executada por transportadoras parceiras. Pedidos têm quantidade mínima de vinte peças.",
        "produtos","comercial",[item("peças metálicas",tipo="produto")],
        [item("montadoras",funcao="cliente"),item("transportadoras parceiras",funcao="prestador")],
        condicoes=[item("quantidade mínima de vinte peças",escopo="Pedidos")])
    caso("programa-social",
        "Somos uma organização social. O Programa Oficinas do Bairro oferece oficinas gratuitas para jovens. Empresas podem apoiar por doação.",
        finalidade="social",publicos=[item("jovens",funcao="beneficiario",escopo="Programa Oficinas do Bairro"),item("Empresas",funcao="apoiador")],
        atuacoes=[item("Programa Oficinas do Bairro",tipo="programa")],
        condicoes=[item("oficinas gratuitas",escopo="Programa Oficinas do Bairro")])
    caso("curso-requisito",
        "Vendemos o Curso de Redes para técnicos. O Curso de Redes é presencial, dura vinte horas e exige computador próprio. Inscrições são feitas na unidade.",
        "servicos","comercial",[item("Curso de Redes",tipo="servico")],
        [item("técnicos",funcao="cliente",escopo="Curso de Redes")],
        condicoes=[item("é presencial, dura vinte horas e exige computador próprio",escopo="Curso de Redes")])
    caso("corporativo-exclusao",
        "Oferecemos o Plano Corporativo para empresas com cinquenta ou mais funcionários. Este Plano Corporativo está indisponível para profissionais autônomos.",
        "servicos","comercial",[item("Plano Corporativo",tipo="servico")],
        [item("empresas com cinquenta ou mais funcionários",funcao="cliente",escopo="Plano Corporativo"),
         item("profissionais autônomos",funcao="excluido",escopo="Plano Corporativo")],
        condicoes=[item("cinquenta ou mais funcionários",escopo="Plano Corporativo")])
    caso("parceria-nao-doacao",
        "Somos um estúdio que vende Produção de Vídeos para empresas. Temos produtoras parceiras; esta parceria não é uma doação.",
        "servicos","comercial",[item("Produção de Vídeos",tipo="servico")],
        [item("empresas",funcao="cliente",escopo="Produção de Vídeos")])
    caso("editorial-nao-oferta",
        "Artigo: como contratar uma banda. Este texto é um guia informativo. Não oferecemos agenciamento.",
        atuacoes=[item("guia informativo",tipo="informacao")],tipo="conteudo")
    caso("marketplace-responsavel",
        "Intermediamos pedidos de Limpeza residencial de contratantes para profissionais independentes. O profissional define a proposta; nossa equipe não executa a limpeza.",
        "intermediacao","comercial",[item("Limpeza residencial",tipo="servico")],
        [item("contratantes",funcao="cliente",escopo="Limpeza residencial"),item("profissionais independentes",funcao="prestador",escopo="Limpeza residencial")],
        condicoes=[item("O profissional define a proposta",escopo="Limpeza residencial")])
    caso("hotel-adicional",
        "Clientes podem reservar Hospedagem com café da manhã incluído. O estacionamento é cobrado à parte.",
        "servicos","comercial",[item("Hospedagem",tipo="servico")],
        [item("Clientes",funcao="cliente",escopo="Hospedagem")],
        condicoes=[item("café da manhã incluído",escopo="Hospedagem"),item("estacionamento é cobrado à parte",escopo="Hospedagem")])
    caso("empresa-beneficiario",
        "Empresas contratam o Programa de Apoio ao Colaborador. Colaboradores usam o benefício. Profissionais de atendimento prestam as sessões.",
        "servicos","comercial",[item("Programa de Apoio ao Colaborador",tipo="servico")],
        [item("Empresas",funcao="cliente",escopo="Programa de Apoio ao Colaborador"),
         item("Colaboradores",funcao="beneficiario",escopo="Programa de Apoio ao Colaborador"),
         item("Profissionais de atendimento",funcao="prestador",escopo="Programa de Apoio ao Colaborador")])
    caso("interface-nao-identidade","Comprar — Clientes — Café incluído — Contrate agora",tipo="interface")
    # Unseen control families are validation, not synthetic siblings of train.
    caso("clinica-convenio",
        "A clínica presta Consulta ambulatorial para pacientes particulares. Não atende beneficiários de convênio. A consulta exige agendamento prévio.",
        "servicos","comercial",[item("Consulta ambulatorial",tipo="servico")],
        [item("pacientes particulares",funcao="cliente",escopo="Consulta ambulatorial"),item("beneficiários de convênio",funcao="excluido",escopo="Consulta ambulatorial")],
        condicoes=[item("exige agendamento prévio",escopo="consulta")],split="validation")
    caso("locacao-operador",
        "Alugamos Equipamentos de Som para organizadores de eventos. Nossa equipe instala os equipamentos. O transporte é contratado separadamente.",
        "servicos","comercial",[item("Equipamentos de Som",tipo="servico")],
        [item("organizadores de eventos",funcao="cliente",escopo="Equipamentos de Som")],
        condicoes=[item("O transporte é contratado separadamente",escopo="Equipamentos de Som")],split="validation")
    caso("oferta-mista",
        "Vendemos Máquinas de Costura e prestamos Manutenção para ateliês. A instalação está incluída apenas na venda de Máquinas de Costura.",
        "misto","comercial",[item("Máquinas de Costura",tipo="produto"),item("Manutenção",tipo="servico")],
        [item("ateliês",funcao="cliente")],
        condicoes=[item("instalação está incluída apenas na venda de Máquinas de Costura",escopo="Máquinas de Costura")],split="validation")
    caso("guia-sem-atividade","Notícia sobre fabricantes e compradores. O artigo não informa quem mantém o site nem seus serviços.",tipo="conteudo",split="validation")
    return cenarios


def expandir(cenarios):
    casos=[]
    for c in cenarios:
        for campo in CAMPOS:
            entrada={"tarefa":"entender","campo":campo,"fontes":c["fontes"]}
            entrada,esperado,mapa=compactar_ids(entrada,c["alvosPorCampo"][campo])
            casos.append({"id":c["id"]+"-"+campo,"dominio":c["dominio"],"grupoEmpresarial":c["grupoEmpresarial"],
                "split":c["split"],"natureza":c["natureza"],"entrada":entrada,"esperado":esperado,"mapaIdsOriginais":mapa})
    return casos


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--saida",type=Path,required=True);a=p.parse_args()
    cenarios=construir_cenarios();r={"versao":1,"geradoEm":datetime.now(timezone.utc).isoformat(),
        "natureza":"Controles autorais, não empresas reais nem capturas publicadas.",
        "revisaoHumana":False,"cenarios":cenarios,"casos":expandir(cenarios),"geradorSha256":sha256(Path(__file__))}
    salvar_json(a.saida,r,exclusivo=True);print(json.dumps({"cenarios":len(cenarios),"tarefas":len(r["casos"])}))


if __name__=="__main__":main()
