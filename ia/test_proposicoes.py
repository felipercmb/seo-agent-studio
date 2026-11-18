from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest
IA=Path(__file__).resolve().parent
sys.path.insert(0,str(IA))
from negocio.proposicoes.controle import construir,gerador_controlado
from negocio.proposicoes.unidades import segmentar
from negocio.proposicoes.contrato import conferir_documento,validar_ofertas,validar_proposicoes,projetar_jornada
from negocio.proposicoes.executar import executar,ler_pedido
from negocio.proposicoes.nomes import catalogo_nomes
from negocio.proposicoes.lotes import lotes_proposicoes
from negocio.proposicoes.verbos import classificar
from negocio.proposicoes.recuperacao import recuperar_atividades


class Proposicoes(unittest.TestCase):
    def setUp(self):
        self.pedido,self.cabeca,self.rel=construir()
        self.doc=segmentar(self.pedido["base"])
        self.oferta=validar_ofertas(self.cabeca,self.doc)["ofertas"][0]

    def test_unidades_sao_intervalos_por_codepoint_e_preservam_fonte(self):
        f=self.doc["fontes"][0]
        for u in self.doc["unidades"]:
            self.assertEqual(u["texto"],f["texto"][u["inicio"]:u["fim"]])
        self.assertEqual(self.doc["unidades"][0]["texto"][0],"🔧")
        self.assertEqual(len(self.doc["unidades"]),6)
        self.assertEqual(f,self.pedido["base"]["fontes"][0])

    def test_unidade_alterada_nao_pode_substituir_citacao(self):
        d=deepcopy(self.doc);d["unidades"][1]["texto"]="A Aurora executa tudo."
        with self.assertRaisesRegex(ValueError,"alterada"):
            conferir_documento(d)

    def test_papais_por_atividade_nao_confundem_ferramenta_fornecedor_usuario(self):
        v=validar_proposicoes(self.rel,self.doc,self.oferta)
        self.assertEqual(v["recusadas"],[])
        j=projetar_jornada(v,self.oferta)
        self.assertEqual([p["grupo"] for p in j["executores"]],["Os analistas do cliente","A equipe Aurora"])
        self.assertEqual([p["escopo"] for p in j["executores"]],["uso","implementacao"])
        self.assertEqual(len(j["operacoesAutomatizadas"]),1)
        self.assertNotIn("A ferramenta Aurora",[p["grupo"] for p in j["executores"]])
        self.assertEqual(j["pagadores"],[])
        self.assertFalse(j["perfilConfirmado"])

    def test_ator_de_outra_frase_nao_recebe_acao_do_cliente(self):
        r=deepcopy(self.rel)
        r["proposicoes"][1]["sujeito"]="A equipe Aurora"
        r["proposicoes"][1]["tipoSujeito"]="fornecedor"
        v=validar_proposicoes(r,self.doc,self.oferta)
        self.assertIn("sujeito_fora_da_mesma_unidade",v["recusadas"][0]["erros"])
        self.assertEqual(len(v["proposicoes"]),4)
        self.assertEqual(len(projetar_jornada(v,self.oferta)["executores"]),1)

    def test_alias_site_nao_pula_vinculo_com_sujeito(self):
        r=deepcopy(self.rel);r["proposicoes"][1]["sujeito"]="$site"
        v=validar_proposicoes(r,self.doc,self.oferta)
        self.assertIn("sujeito_fora_da_mesma_unidade",v["recusadas"][0]["erros"])

    def test_nome_preserva_expressao_publicada_sem_apelido_silencioso(self):
        r=deepcopy(self.cabeca);r["ofertas"][0]["nomePublicado"]="Aurora (plataforma de automação)"
        v=validar_ofertas(r,self.doc)
        self.assertEqual(v["ofertas"],[])
        self.assertIn("nome_publicado_sem_apoio",v["recusadas"][0]["erros"])
        self.assertEqual(r["ofertas"][0]["nomePublicado"],"Aurora (plataforma de automação)")

    def test_nome_pode_ser_copiado_do_titulo_sem_inventar_fonte(self):
        r=deepcopy(self.cabeca);r["ofertas"][0].update(nomePublicado="Ferramenta Aurora",origemNome="titulo_pagina")
        v=validar_ofertas(r,self.doc)
        self.assertEqual(len(v["ofertas"]),1)
        r["ofertas"][0]["fonteNome"]="s99"
        self.assertEqual(validar_ofertas(r,self.doc)["ofertas"],[])

    def test_precisa_citar_fonte_que_sustenta_nome(self):
        r=deepcopy(self.cabeca);r["ofertas"][0]["evidencias"]=["s99"]
        self.assertIn("referencias_invalidas",validar_ofertas(r,self.doc)["recusadas"][0]["erros"])

    def test_publico_potencial_nao_e_pagador_observado(self):
        j=projetar_jornada(validar_proposicoes(self.rel,self.doc,self.oferta),self.oferta)
        self.assertEqual(j["compradores"][0]["natureza"],"publico_potencial")
        self.assertEqual(j["compradores"][0]["grupo"],"equipes de operações")
        self.assertEqual(j["pagadores"],[])
        self.assertIn("pagadores",[x["campo"] for x in j["faltam"]])

    def test_pagamento_da_compra_nao_vira_assinatura_da_ferramenta(self):
        d=deepcopy(self.pedido["base"])
        d["fontes"][0]["texto"]="O consumidor paga a compra no checkout."
        doc=segmentar(d)
        r={"proposicoes":[{"unidade":"u001","sujeito":"O consumidor","tipoSujeito":"terceiro","relacao":"paga","acao":"paga","objeto":"a compra","escopo":"transacao_do_cliente"}],"condicoes":[],"incertezas":[]}
        j=projetar_jornada(validar_proposicoes(r,doc,self.oferta),self.oferta)
        self.assertEqual(j["pagadores"],[])
        self.assertEqual(len(j["transacoesDoCliente"]),1)

    def test_desenvolver_ferramenta_nao_preenche_operador_do_usuario(self):
        d=deepcopy(self.pedido["base"]);d["fontes"][0]["texto"]="Nosso time desenvolve a ferramenta Aurora."
        doc=segmentar(d)
        r={"proposicoes":[{"unidade":"u001","sujeito":"Nosso time","tipoSujeito":"fornecedor","relacao":"desenvolve","acao":"desenvolve","objeto":"a ferramenta Aurora","escopo":"fornecimento"}],"condicoes":[],"incertezas":[]}
        v=validar_proposicoes(r,doc,self.oferta)
        j=projetar_jornada(v,self.oferta)
        self.assertEqual(j["executores"],[])
        self.assertEqual(len(j["fornecimento"]),1)
        self.assertFalse(j["perfilConfirmado"])

    def test_condicao_preserva_aplicacao_e_frase_com_excecao(self):
        v=validar_proposicoes(self.rel,self.doc,self.oferta)
        c=v["condicoes"][0]
        self.assertIn("não exige cartão",c["unidadeLiteral"]["texto"])
        self.assertEqual(c["aplicaA"],"teste da ferramenta Aurora")
        r=deepcopy(self.rel);r["condicoes"][0]["aplicaA"]="todos os planos"
        self.assertEqual(validar_proposicoes(r,self.doc,self.oferta)["condicoes"],[])

    def test_desconhecido_nao_e_vazio_correto_nem_confirmacao(self):
        r={"proposicoes":[],"condicoes":[],"incertezas":["Não há ator publicado nesta seleção."]}
        j=projetar_jornada(validar_proposicoes(r,self.doc,self.oferta),self.oferta)
        self.assertEqual(len(j["faltam"]),4)
        self.assertTrue(all(x["estado"]=="nao_identificado_no_recorte" for x in j["faltam"]))
        self.assertFalse(j["perfilConfirmado"])

    def test_execucao_controlada_nao_usa_pesos_e_preserva_todas_relacoes(self):
        r=executar(**{"base":self.pedido["base"],"max_ofertas":1},gerador=gerador_controlado)
        self.assertEqual(r["versao"],3)
        self.assertEqual(len(r["ofertas"][0]["jornada"]["proposicoes"]),5)
        self.assertFalse(r["conclusaoMecanica"]["completa"])
        self.assertEqual(r["conclusaoMecanica"]["qualidadeSemantica"],"nao_avaliada")
        self.assertFalse(r["novoAjustePesos"])

    def test_sem_fontes_nao_carrega_modelo(self):
        p={"versao":1,"dominio":"example.com","fontes":[]}
        r=executar(p)
        self.assertEqual(r["estado"],"sem_fontes")
        self.assertEqual(r["inferencias"],[])
        self.assertFalse(r["conclusaoMecanica"]["completa"])

    def test_pedido_nao_aceita_config_de_modelo_ou_json_duplicado(self):
        self.assertEqual(ler_pedido(json.dumps(self.pedido).encode()),self.pedido)
        for b in (b'{"base":{},"maxOfertas":1,"modelo":"remoto"}', b'{"base":{},"maxOfertas":1,"maxOfertas":2}',b'{"base":{},"maxOfertas":true}'):
            with self.assertRaises(ValueError):ler_pedido(b)

    def test_orcamento_nao_deixa_primeira_frase_sem_negacao_vizinha(self):
        doc=segmentar(self.pedido["base"],max_unidades=2)
        self.assertEqual(doc["unidades"],[])
        self.assertEqual(doc["descartes"][0]["motivo"],"fonte_inteira_fora_do_orcamento_de_unidades")
        self.assertEqual(doc["fontes"],self.pedido["base"]["fontes"])

    def test_intermediador_pode_executar_a_propria_intermediacao(self):
        d=deepcopy(self.pedido["base"])
        d["fontes"][0]["texto"]="A Interlia intermedeia negócios. A Interlia processa as transações para o comerciante."
        d["fontes"][0]["contexto"].update(tituloPagina="Intermediação Interlia",titulos=[{"nivel":2,"texto":"Intermediação Interlia"}])
        doc=segmentar(d)
        o={"nome":"Interlia","natureza":"servico","papel_site":"intermedeia","evidencias":["s01"]}
        r={"proposicoes":[{"unidade":"u002","sujeito":"A Interlia","tipoSujeito":"fornecedor","relacao":"executa","acao":"processa","objeto":"as transações","escopo":"prestacao_da_oferta"}],"condicoes":[],"incertezas":[]}
        v=validar_proposicoes(r,doc,o);self.assertEqual(v["recusadas"],[])
        j=projetar_jornada(v,o)
        self.assertEqual(j["executores"][0]["grupo"],"A Interlia")
        self.assertEqual(j["executores"][0]["escopo"],"prestacao_da_oferta")

    def test_prazo_comercial_conserva_atividade_proposta(self):
        d=deepcopy(self.pedido["base"]);d["fontes"][0]["texto"]="Nossa equipe responde a proposta em até 2 dias."
        doc=segmentar(d)
        r={"proposicoes":[],"condicoes":[{"unidade":"u001","categoria":"prazo","aplicaA":"proposta","alcance":"proposta_comercial"}],"incertezas":[]}
        v=validar_proposicoes(r,doc,self.oferta)
        self.assertEqual(v["condicoes"][0]["alcance"],"proposta_comercial")
        self.assertEqual(v["condicoes"][0]["aplicaA"],"proposta")
        self.assertNotEqual(v["condicoes"][0]["aplicacao"],"esta_oferta")

    def test_pergunta_extensa_nao_apaga_relacoes_independentes(self):
        r=deepcopy(self.rel);r["incertezas"]=["x"*181]
        v=validar_proposicoes(r,self.doc,self.oferta)
        self.assertEqual(len(v["proposicoes"]),5)
        self.assertEqual(len(v["incertezasRecusadas"]),1)
        self.assertEqual(v["incertezas"],[])

    def test_apoio_literal_mecanico_nao_e_aprovacao_de_direcao_semantica(self):
        d=deepcopy(self.pedido["base"]);d["fontes"][0]["texto"]="Os usuários usam a ferramenta da Aurora."
        doc=segmentar(d)
        # Todos os fragmentos coexistem, mas isso NÃO comprova Aurora usando
        # a própria ferramenta. A curadoria semântica continua necessária.
        r={"proposicoes":[{"unidade":"u001","sujeito":"Aurora","tipoSujeito":"fornecedor","relacao":"utiliza","acao":"usam","objeto":"a ferramenta","escopo":"uso"}],"condicoes":[],"incertezas":[]}
        v=validar_proposicoes(r,doc,self.oferta)
        self.assertEqual(v["revisaoSemantica"],"pendente")
        self.assertFalse(v["perfilConfirmado"])

    def test_catalogo_resolve_nome_e_fonte_sem_reparar_nome_do_modelo(self):
        n=catalogo_nomes(self.doc)[0]
        r={"ofertas":[{"nomeId":n["id"],"natureza":"software","papel_site":"disponibiliza","evidencias":[]}],"incertezas":[]}
        v=validar_ofertas(r,self.doc)
        self.assertEqual(v["ofertas"][0]["nomePublicado"],n["nomePublicado"])
        self.assertEqual(v["ofertas"][0]["fonteNome"],n["fonteNome"])
        self.assertEqual(v["ofertas"][0]["evidencias"],[n["fonteNome"]])
        r["ofertas"][0]["nomeId"]="n999"
        self.assertEqual(validar_ofertas(r,self.doc)["ofertas"],[])

    def test_verbo_literal_separa_emissao_de_desenvolvimento(self):
        self.assertEqual(classificar("emite"),"executa")
        self.assertEqual(classificar("desenvolve"),"desenvolve")
        self.assertEqual(classificar("utilizam"),"utiliza")
        self.assertEqual(classificar("expressão não reconhecida"),"indefinida")
        r=deepcopy(self.rel)
        for p in r["proposicoes"]:del p["relacao"]
        v=validar_proposicoes(r,self.doc,self.oferta)
        self.assertEqual(v["proposicoes"][0]["relacao"],"executa")
        self.assertEqual(v["proposicoes"][3]["relacao"],"utiliza")
        self.assertTrue(all(p["relacaoOrigem"]=="regra_verbo_literal" for p in v["proposicoes"]))

    def test_volume_de_trabalho_nao_vira_preco_publicado(self):
        d=deepcopy(self.pedido['base']);d['fontes'][0]['texto']='A operação exige um alto volume de atividades.'
        doc=segmentar(d)
        r={'proposicoes':[],'condicoes':[{'unidade':'u001','categoria':'preco','aplicaA':None,'alcance':'oferta'}],'incertezas':[]}
        v=validar_proposicoes(r,doc,self.oferta)
        self.assertEqual(v['condicoes'],[])
        self.assertIn('categoria_sem_indicio_literal',v['recusadas'][0]['erros'])
        self.assertEqual(v['recusadas'][0]['item'],r['condicoes'][0])

    def test_selecao_prioriza_operacao_atual_sem_apagar_comparacao(self):
        d=deepcopy(self.pedido['base']);d['fontes'][0]['texto']='Quem usa planilhas sabe a dificuldade nesse formato. Os operadores registram tudo manualmente. A ferramenta Aurora organiza os chamados.'
        doc=segmentar(d)
        lotes,meta=lotes_proposicoes(doc,max_lotes=1,alvos_por_lote=1,oferta={'nome':'Aurora'})
        self.assertEqual(meta['unidadesAlvo'],['u003'])
        self.assertEqual(lotes[0]['unidades'],doc['unidades'])
        self.assertEqual(lotes[0]['fontes'],doc['fontes'])

    def test_alvos_duplicados_nao_gastam_duas_vagas(self):
        d=deepcopy(self.pedido['base']);f=d['fontes'][0]
        f['texto']='Os operadores registram pedidos. A ferramenta Aurora organiza chamados.'
        duplicada=deepcopy(f);duplicada['id']='s02';d['fontes'].append(duplicada)
        doc=segmentar(d)
        lotes,meta=lotes_proposicoes(doc,max_lotes=2,alvos_por_lote=4,oferta={'nome':'Aurora'})
        self.assertEqual(len(meta['unidadesAlvo']),2)
        self.assertEqual(len(doc['unidades']),4)

    def test_grupo_fixo_nao_permite_modelo_trocar_id_da_frase(self):
        grupos={u['id']:None for u in self.doc['unidades']}
        for p in self.rel['proposicoes']:
            grupos[p['unidade']]={k:v for k,v in p.items() if k not in ('unidade','relacao')}
        bruto={'proposicoesPorUnidade':grupos,'condicoes':self.rel['condicoes'],'incertezas':[]}
        v=validar_proposicoes(bruto,self.doc,self.oferta)
        self.assertEqual(len(v['proposicoes']),5)
        self.assertEqual(v['recusadas'],[])
        self.assertEqual(bruto['proposicoesPorUnidade']['u005'],None)
        grupos['u002']['sujeito']='A ferramenta Aurora'
        v=validar_proposicoes(bruto,self.doc,self.oferta)
        self.assertTrue(any('sujeito_fora_da_mesma_unidade' in x['erros'] for x in v['recusadas']))
        grupos['u999']=None
        self.assertEqual(validar_proposicoes(bruto,self.doc,self.oferta)['erro'],'unidades_agrupadas_invalidas')

    def test_recuperacao_nao_substitui_atividade_inicial_por_pool_repetido(self):
        d=deepcopy(self.pedido['base'])
        f=deepcopy(d['fontes'][0]);f['id']='s02';f['texto']='Os operadores do cliente recebem os pedidos e utilizam a ferramenta.'
        d['fontes'].append(f)
        pool=[]
        for i in range(12):
            x=deepcopy(d['fontes'][0]);x['id']='r'+str(i);pool.append(x)
        nova,o,meta=recuperar_atividades(d,self.oferta,pool,max_fontes=2)
        self.assertIn(f['texto'],[s['texto'] for s in nova['fontes']])
        self.assertEqual(nova['fontes'][0]['contexto'],d['fontes'][0]['contexto'])
        self.assertEqual(meta['modo'],'base_diversa_pool_complementar')
        self.assertEqual(o['evidencias'],['s01'])

    def test_recuperacao_conserva_fonte_maior_com_excecao(self):
        d=deepcopy(self.pedido['base'])
        curta=deepcopy(d['fontes'][0]);curta['id']='s02';curta['texto']='Os clientes usam o aplicativo para registrar pedidos, acompanhar equipes e enviar solicitações.'
        longa=deepcopy(curta);longa['id']='s03';longa['texto']+=' Exceto quando a solicitação exige revisão presencial.'
        d['fontes'] += [curta,longa]
        nova,_,meta=recuperar_atividades(d,self.oferta,[],max_fontes=2)
        self.assertEqual(nova['fontes'][1]['texto'],longa['texto'])
        self.assertTrue(any(x['motivo']=='recorte_contido_em_fonte_base' for x in meta['descartes']))

    def test_texto_igual_com_outro_contexto_preserva_aplicacao(self):
        alteracoes=[('titulos',[{'nivel':2,'texto':'Plano completo'}]),('tituloPagina','Outra aplicação Aurora'),('url','https://example.com/outro-plano'),('sha256','c'*64),('campo','li')]
        for campo,valor in alteracoes:
            with self.subTest(contexto=campo):
                d=deepcopy(self.pedido['base']);f=deepcopy(d['fontes'][0]);f.update(id='s02',texto='Os clientes têm suporte dedicado.');f['contexto']['titulos']=[{'nivel':2,'texto':'Plano inicial'}]
                g=deepcopy(f);g['id']='s03';g['contexto'][campo]=valor;d['fontes'] += [f,g]
                nova,_,_=recuperar_atividades(d,self.oferta,[])
                retidos=[x for x in nova['fontes'] if x['texto']==f['texto']]
                self.assertEqual(len(retidos),2)
                self.assertEqual([x['contexto'] for x in retidos],[f['contexto'],g['contexto']])

    def test_duplicata_integral_do_mesmo_contexto_nao_gasta_vaga(self):
        d=deepcopy(self.pedido['base']);f=deepcopy(d['fontes'][0]);f['id']='s02';d['fontes'].append(f)
        nova,_,_=recuperar_atividades(d,self.oferta,[{**deepcopy(f),'id':'r001'}])
        self.assertEqual(len(nova['fontes']),1)
        self.assertEqual(nova['fontes'][0]['texto'],d['fontes'][0]['texto'])

    def test_recorte_contido_em_outra_secao_nao_substitui_contexto(self):
        d=deepcopy(self.pedido['base']);f=deepcopy(d['fontes'][0]);f.update(id='s02',texto='Os clientes usam o aplicativo para registrar pedidos, acompanhar equipes e enviar solicitações.');f['contexto']['titulos']=[{'nivel':2,'texto':'Aplicação inicial'}]
        g=deepcopy(f);g['id']='s03';g['texto']+=' Exceto quando a solicitação exige revisão presencial.';g['contexto']['titulos']=[{'nivel':2,'texto':'Aplicação completa'}];d['fontes'] += [f,g]
        nova,_,_=recuperar_atividades(d,self.oferta,[])
        self.assertEqual([x['texto'] for x in nova['fontes']],[x['texto'] for x in d['fontes']])

    def test_lote_preserva_vizinhas_e_rejeita_fato_fora_do_foco(self):
        lotes,meta=lotes_proposicoes(self.doc,max_lotes=2,alvos_por_lote=2)
        self.assertLessEqual(len(lotes),2)
        for l in lotes:
            presentes={u["id"] for u in l["unidades"]}
            self.assertTrue(set(l["unidadesAlvo"])<=presentes)
            for f in l["fontes"]:
                self.assertEqual([u for u in l["unidades"] if u["fonte"]==f["id"]],[u for u in self.doc["unidades"] if u["fonte"]==f["id"]])
        l=deepcopy(self.doc);l["unidadesAlvo"]=["u001"]
        v=validar_proposicoes(self.rel,l,self.oferta)
        self.assertTrue(any("unidade_fora_dos_alvos" in x["erros"] for x in v["recusadas"]))


if __name__=="__main__":unittest.main()
