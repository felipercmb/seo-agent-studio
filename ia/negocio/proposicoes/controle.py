"""Um exemplo autoral de contrato, não dado de teste independente nem treino."""
from copy import deepcopy
from negocio.proposicoes.unidades import segmentar


def construir():
    fonte={"id":"s01","tipo":"declaracao","texto":"🔧 A ferramenta Aurora organiza os pedidos dos usuários. Os analistas do cliente configuram a integração. A equipe Aurora implementa o fluxo junto ao cliente. Os usuários utilizam a ferramenta Aurora. O teste da ferramenta Aurora dura 10 dias e não exige cartão de crédito. A plataforma destina-se a equipes de operações.",
      "contexto":{"paginaId":"pag_"+"a"*20,"url":"https://example.com/aurora","tituloPagina":"Ferramenta Aurora",
        "titulos":[{"nivel":2,"texto":"Ferramenta Aurora"}],"campo":"p","coletadoEm":"2026-11-16T20:00:00Z",
        "sha256":"b"*64,"recortado":False,"classePagina":"institucional"}}
    base={"versao":1,"dominio":"example.com","fontes":[fonte]}
    cabeca={"ofertas":[{"nomePublicado":"ferramenta Aurora","fonteNome":"s01","origemNome":"texto","natureza":"software","papel_site":"disponibiliza","evidencias":["s01"]}],"incertezas":[]}
    relacoes={"proposicoes":[
      {"unidade":"u001","sujeito":"A ferramenta Aurora","tipoSujeito":"ferramenta","relacao":"executa","acao":"organiza","objeto":"os pedidos dos usuários","escopo":"uso"},
      {"unidade":"u002","sujeito":"Os analistas do cliente","tipoSujeito":"usuario","relacao":"executa","acao":"configuram","objeto":"a integração","escopo":"uso"},
      {"unidade":"u003","sujeito":"A equipe Aurora","tipoSujeito":"fornecedor","relacao":"executa","acao":"implementa","objeto":"o fluxo","escopo":"implementacao"},
      {"unidade":"u004","sujeito":"Os usuários","tipoSujeito":"usuario","relacao":"utiliza","acao":"utilizam","objeto":"a ferramenta Aurora","escopo":"uso"},
      {"unidade":"u006","sujeito":"A plataforma","tipoSujeito":"ferramenta","relacao":"destina_se_a","acao":"destina-se a","objeto":"equipes de operações","escopo":"fornecimento"}],
      "condicoes":[{"unidade":"u005","categoria":"prazo","aplicaA":"teste da ferramenta Aurora","alcance":"oferta"}],"incertezas":["Quem paga a assinatura da ferramenta não foi identificado nesta publicação."]}
    return {"base":base,"maxOfertas":1},cabeca,relacoes


def gerador_controlado(doc,oferta=None):
    _,cabeca,relacoes=construir()
    return {"estado":"gerada","inferida":False,"simulada":True,"saida":deepcopy(relacoes if oferta else cabeca),
            "textoBruto":__import__('json').dumps(relacoes if oferta else cabeca,ensure_ascii=False),
            "limite":"Resposta autoral injetada para exemplo/teste CPU; nenhuma inferência de modelo ocorreu."}
