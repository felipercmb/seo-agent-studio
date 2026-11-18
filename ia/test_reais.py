"""Testa os verificadores de rótulos sem depender das capturas reais locais."""

import hashlib
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest

IA=Path(__file__).resolve().parent
sys.path.insert(0,str(IA))
sys.path.insert(0,str(IA/'reais'))
from reais.preparar import LeituraHTML,caso
from inferir_v3 import bloqueios,preservar_estado_fonte,orientar_disponibilidade
from reais.verificar_prontidao import avaliar
from reais.inferir_web import barreiras_web,regra_publicacao,regra_sem_evidencias,regra_serp_atual,regra_posicao_indisponivel,sanear_web,entrada_para_modelo,orientar_web,bloqueios_web,cabecalho_noindex,selecao_candidata,finalizar_web,descrever_modelo
from reais.verificar_interface import avaliar as avaliar_troca
from reais.filtrar_teste import filtrar
from reais.verificar_interface3 import avaliar as avaliar_troca3


class FontesReaisTest(unittest.TestCase):
    def test_identificacao_do_modelo_liga_bytes_e_pesos_sem_expor_caminhos(self):
        selecao={'adaptador_sha256':'a'*64,'candidato':{'pasta':'/local/privado/modelo','config_adaptador_sha256':'b'*64}}
        bruto=json.dumps(selecao).encode()
        atual=descrever_modelo(bruto,selecao,True)
        self.assertEqual(atual['selecaoSha256'],hashlib.sha256(bruto).hexdigest())
        self.assertEqual(atual['adaptadorSha256'],'a'*64)
        self.assertEqual(atual['modo'],'candidata')
        self.assertNotIn('/local',json.dumps(atual))
        self.assertEqual(descrever_modelo(bruto,selecao)['modo'],'padrao')

    def ler(self,html):
        p=LeituraHTML();p.feed(html);return p

    def test_noindex_exige_meta_no_head_e_nao_texto_ou_script(self):
        real=self.ler('<html><head><meta name="robots" content="NOINDEX, nofollow"><title>Oferta</title></head><body><h1>Oferta</h1></body></html>')
        self.assertEqual(real.meta_noindex,[{'nome':'robots','diretiva':'noindex'}])
        self.assertEqual(real.h1_tags,1)
        negativo=self.ler('<html><head><title>Oferta</title><script>"<meta name=robots content=noindex>"</script></head><body>noindex</body></html>')
        self.assertEqual(negativo.meta_noindex,[])
        self.assertEqual(negativo.h1_tags,0)

    def test_numero_ausente_nao_vira_zero_nem_posicao(self):
        meta={'url':'https://negocio.example/','coletadoEm':'2026-11-14T20:00:00Z',
              'sha256_utf8_local':'a'*64,'sha256_rede':'a'*64}
        site={'id':'site-01','dominio':'negocio.example','split':'test'}
        serp={'id':'s1','tipo':'serp','atual':False,'estado_fonte':'nao_consultada','posicao':None,'observado_em':None,
              'descricao':'Nenhuma fonte foi consultada.'}
        x=caso(site,meta,'serp',0,[serp],'atualizar_coleta',['s1'],'b'*64)
        self.assertIsNone(x['entrada']['evidencias'][0]['posicao'])
        self.assertEqual(x['entrada']['evidencias'][0]['estado_fonte'],'nao_consultada')
        self.assertEqual(x['origem']['sha256_html_utf8'],'a'*64)

    def test_noindex_desconhecido_precisa_de_evidencia_estruturada(self):
        e={'id':'p1','tipo':'pagina','atual':True,'sha256_pagina':'a'*64,
           'verificacao':{'tipo':'meta_robots_noindex','escopo':'html_inicial','intencao':'desconhecida'}}
        escolha={'acao':'confirmar_publicacao','evidencias':['p1']}
        self.assertFalse(bloqueios(escolha,{'objetivo':'Verificar indexação','evidencias':[e]}))
        e.pop('verificacao')
        self.assertTrue(bloqueios(escolha,{'objetivo':'Verificar indexação','evidencias':[e]}))

    def test_orientacao_sem_fonte_nao_promete_posicao(self):
        entrada={'evidencias':[{'id':'s1','tipo':'serp','estado_fonte':'nao_consultada'}]}
        saida={'estado':'revisao_necessaria','escolha_ia':{'acao':'atualizar_coleta'}}
        orientar_disponibilidade(saida,entrada)
        self.assertIn('fonte compatível',saida['orientacao_padrao'])
        self.assertIn('antes de informar posição',saida['orientacao_padrao'])

    def test_sem_tipo_obrigatorio_nao_aprova_prontidao(self):
        protocolo={'acoes':{'dominios_teste_minimos':3,'fracao_minima_acao_e_referencias':0.8,
                           'escolhas_criticas_maximas':0,'tipos_que_exigem_um_acerto_conjunto':['noindex']}}
        rel={'metricas':{'acao_e_referencias':{'quantidade':4,'total':4},'escolha_critica':{'quantidade':0},
                         'esperada_mas_bloqueada':{'quantidade':0}},'por_tipo':{}}
        teste=avaliar('acoes',rel,{'dominios_com_casos':{'test':4}},protocolo)
        self.assertEqual(teste['estado'],'nao_atingiu_limites_do_experimento')
        self.assertFalse(teste['aprovado_para_uso_autonomo'])
        self.assertTrue(any('noindex' in motivo for motivo in teste['motivos']))

    def test_comparador_que_sempre_abstem_nao_passa_sem_acertar_achados(self):
        protocolo={'comparacao':{'dominios_teste_minimos':3,'fracao_minima_pares_corretos':0.75,
                                 'falsas_priorizacoes_maximas':0,'fracao_minima_acertos_com_achado':0.5}}
        rel={'metricas':{'total_pares':10,'pares_corretos':9,'falsas_priorizacoes':0},
             'por_tipo':{'um_achado_verificado':{'total':2,'acertos':0}}}
        teste=avaliar('comparacao',rel,{'dominios':{'test':3}},protocolo)
        self.assertEqual(teste['estado'],'nao_atingiu_limites_do_experimento')
        self.assertTrue(any('achado observável' in motivo for motivo in teste['motivos']))

    def test_demanda_na_interface_exige_citar_origem_recente(self):
        pagina={'id':'p1','tipo':'pagina','atual':True,'sha256_pagina':'a'*64}
        serp={'id':'s1','tipo':'serp','atual':False,'posicao':None}
        entrada={'evidencias':[pagina,serp]}
        self.assertTrue(barreiras_web({'acao':'validar_demanda','evidencias':['s1']},entrada))
        self.assertFalse(barreiras_web({'acao':'validar_demanda','evidencias':['p1']},entrada))
        pagina['atual']=False
        self.assertTrue(barreiras_web({'acao':'validar_demanda','evidencias':['p1']},entrada))

    def test_sem_evidencias_regra_pede_conferir_coleta_sem_inventar_resultados(self):
        entrada={'evidencias':[]};escolha=regra_sem_evidencias(entrada)
        self.assertEqual(escolha,{'acao':'atualizar_coleta','evidencias':[]})
        saida={'estado':'revisao_necessaria','escolha_ia':escolha}
        orientar_web(saida,entrada)
        self.assertIn('Não foi possível reunir evidências',saida['orientacao_padrao'])
        self.assertIn('não é possível indicar posições',saida['limite_padrao'])
        self.assertIsNone(regra_sem_evidencias({'evidencias':[{'id':'p1'}]}))

    def test_atualizacao_de_posicoes_deve_citar_a_fonte_de_busca(self):
        entrada={'evidencias':[{'id':'s1','tipo':'serp','atual':False},
                               {'id':'d1','tipo':'pagina','atual':True}]}
        self.assertTrue(barreiras_web({'acao':'atualizar_coleta','evidencias':['d1']},entrada))
        self.assertFalse(barreiras_web({'acao':'atualizar_coleta','evidencias':['s1']},entrada))
        self.assertFalse(barreiras_web({'acao':'atualizar_coleta','evidencias':[]},{'evidencias':[]}))

    def test_melhoria_precisa_citar_achado_e_nao_apenas_texto_da_pagina(self):
        p={'id':'p1','tipo':'pagina','atual':True,'sha256_pagina':'a'*64}
        d={'id':'d1','tipo':'pagina','atual':True,'sha256_pagina':'a'*64}
        entrada={'evidencias':[p,d]}
        self.assertTrue(barreiras_web({'acao':'melhorar_pagina','evidencias':['p1']},entrada))
        self.assertFalse(barreiras_web({'acao':'melhorar_pagina','evidencias':['d1']},entrada))
        d['atual']=False;self.assertTrue(barreiras_web({'acao':'melhorar_pagina','evidencias':['d1']},entrada))

    def test_regra_expoe_alternativa_quando_ia_cita_termo_sem_diagnostico(self):
        url='https://example.invalid/servico';data='2026-11-15T09:59:00Z'
        p={'id':'p1','tipo':'pagina','pagina':url,'atual':True,'observado_em':data,'sha256_pagina':'a'*64}
        s={'id':'s1','tipo':'serp','pagina':url,'termo':'serviço','atual':False,'posicao':None,'observado_em':None}
        x={'site':'example.invalid','objetivo':'Escolher uma próxima melhoria com as evidências disponíveis. O retorno comercial não foi medido.',
           'evidencias':[s,p]}
        escolha={'acao':'melhorar_pagina','evidencias':['p1']}
        r=finalizar_web(escolha,x,'ia',agora=datetime(2026,11,15,10,0,0,tzinfo=timezone.utc))
        self.assertEqual(r['origem'],'regra');self.assertEqual(r['escolha_ia']['acao'],'validar_demanda')
        self.assertEqual(r['escolha_original_ia'],escolha);self.assertTrue(r['ajustada_por_regra'])
        invalida={'acao':'melhorar_pagina','evidencias':['p1','inexistente']}
        self.assertEqual(finalizar_web(invalida,x,'ia',agora=datetime(2026,11,15,10,0,0,tzinfo=timezone.utc))['estado'],'recusada')
        x['objetivo']='Corrija um problema nesta página.'
        self.assertEqual(finalizar_web(escolha,x,'ia',agora=datetime(2026,11,15,10,0,0,tzinfo=timezone.utc))['estado'],'recusada')
        x['objetivo']='Escolher uma próxima melhoria com as evidências disponíveis.';p['observado_em']='2026-11-13T10:00:00Z'
        self.assertEqual(finalizar_web(escolha,x,'ia',agora=datetime(2026,11,15,10,0,0,tzinfo=timezone.utc))['estado'],'recusada')

    def test_regra_corrige_demanda_sem_fonte_quando_ha_diagnostico_especifico(self):
        d={'id':'d1','tipo':'pagina','pagina':'https://exemplo.com.br/','descricao':'Um ponto do HTML para revisão.',
          'atual':True,'observado_em':'2026-11-15T09:59:00Z','sha256_pagina':'a'*64}
        entrada={'site':'exemplo.com.br','objetivo':'Escolher uma próxima melhoria com as evidências disponíveis. O retorno comercial não foi medido.','evidencias':[d]}
        escolha={'acao':'validar_demanda','evidencias':['d1']};agora=datetime(2026,11,15,10,0,0,tzinfo=timezone.utc)
        r=finalizar_web(escolha,entrada,'ia',agora=agora)
        self.assertEqual(r['origem'],'regra');self.assertEqual(r['escolha_ia'],{'acao':'melhorar_pagina','evidencias':['d1']})
        self.assertEqual(r['escolha_original_ia'],escolha);self.assertTrue(r['ajustada_por_regra'])
        self.assertIn('diagnóstico como se medisse demanda',r['aviso'])
        entrada['objetivo']='Meça a demanda desta página.'
        self.assertEqual(finalizar_web(escolha,entrada,'ia',agora=agora)['estado'],'recusada')
        entrada['objetivo']='Escolher uma próxima melhoria com as evidências disponíveis.';d['observado_em']='2026-11-13T10:00:00Z'
        self.assertEqual(finalizar_web(escolha,entrada,'ia',agora=agora)['estado'],'recusada')

    def test_termo_publicado_na_mesma_pagina_nao_apaga_diagnostico_aplicavel(self):
        url='https://exemplo.com.br/oferta';data='2026-11-15T09:59:00Z'
        d={'id':'d1','tipo':'pagina','pagina':url,'descricao':'Dois controles sem nome identificável no HTML inicial.',
           'atual':True,'observado_em':data,'sha256_pagina':'a'*64}
        p={'id':'p1','tipo':'pagina','pagina':url,'descricao':'Serviço publicado','atual':True,
           'observado_em':data,'sha256_pagina':'a'*64}
        s={'id':'s1','tipo':'serp','pagina':url,'termo':'Serviço publicado','atual':False,'posicao':None}
        x={'site':'exemplo.com.br','objetivo':'Escolher uma próxima melhoria com as evidências disponíveis. O retorno comercial não foi medido.',
           'evidencias':[s,p,d]}
        escolha={'acao':'validar_demanda','evidencias':['d1']};agora=datetime(2026,11,15,10,0,0,tzinfo=timezone.utc)
        r=finalizar_web(escolha,x,'ia',agora=agora)
        self.assertEqual(r['estado'],'revisao_necessaria');self.assertEqual(r['origem'],'regra')
        self.assertEqual(r['escolha_ia'],{'acao':'melhorar_pagina','evidencias':['d1']})
        self.assertEqual(r['escolha_original_ia'],escolha)
        p['pagina']='https://exemplo.com.br/outra'
        self.assertEqual(finalizar_web(escolha,x,'ia',agora=agora)['estado'],'recusada')
        p['pagina']=url;p['observado_em']='2026-11-13T09:59:00Z'
        self.assertEqual(finalizar_web(escolha,x,'ia',agora=agora)['estado'],'recusada')

    def test_serp_atual_prioriza_concorrente_observado_sem_fabricar_ordem(self):
        s={'id':'s1','tipo':'serp','atual':True,'posicao':27,'fontes_serp':[{'id':'captura_123','sha256':'a'*64}],
           'concorrentes':[{'pagina':'https://rival.example/','posicao':3}]}
        x={'objetivo':'Escolher uma próxima melhoria com as evidências disponíveis.','evidencias':[s]}
        escolha=regra_serp_atual(x)
        self.assertEqual(escolha,{'acao':'comparar_concorrentes','evidencias':['s1']})
        self.assertFalse(bloqueios_web(escolha,x))
        s['atual']=False;self.assertIsNone(regra_serp_atual(x));s['atual']=True
        s['concorrentes'][0]['posicao']=30
        self.assertEqual(regra_serp_atual(x),{'acao':'acompanhar','evidencias':['s1']})
        x['objetivo']='Quem está à frente?';self.assertIsNone(regra_serp_atual(x))
        s['posicao']=True;self.assertIsNone(regra_serp_atual(x))

    def test_serp_generica_nao_apaga_diagnostico_observado(self):
        s={'id':'s1','tipo':'serp','atual':True,'posicao':12,'fontes_serp':[{'id':'captura_123','sha256':'a'*64}],
           'concorrentes':[{'pagina':'https://rival.example/','posicao':2}]}
        d={'id':'d1','tipo':'pagina','atual':True}
        x={'objetivo':'Escolher uma próxima melhoria.','evidencias':[s,d]}
        self.assertIsNone(regra_serp_atual(x))
        x['objetivo']='Comparar concorrentes da busca'
        self.assertEqual(regra_serp_atual(x)['acao'],'comparar_concorrentes')
        x['objetivo']='Quanto de retorno a posição gera?'
        self.assertIsNone(regra_serp_atual(x))
        x['objetivo']='Comparar concorrentes da busca';s['fontes_serp']=[]
        self.assertIsNone(regra_serp_atual(x))

    def test_capturas_e_concorrentes_vencidos_nao_sao_exibidos_como_atuais(self):
        s={'id':'s1','tipo':'serp','atual':True,'posicao':27,'observado_em':'2026-11-14T12:00:00Z',
           'fontes_serp':[{'id':'captura_123','sha256':'a'*64}],
           'concorrentes':[{'pagina':'https://rival.example/','posicao':3}]}
        x={'site':'example.invalid','evidencias':[s]}
        limpo=sanear_web(x,agora=datetime(2026,11,15,tzinfo=timezone.utc))['evidencias'][0]
        self.assertFalse(limpo['atual']);self.assertIsNone(limpo['posicao'])
        self.assertNotIn('fontes_serp',limpo);self.assertNotIn('concorrentes',limpo)

    def test_transcricao_sem_pagina_identificada_nao_vira_posicao_para_o_modelo(self):
        agora=datetime(2026,11,15,12,0,tzinfo=timezone.utc)
        s={'id':'s1','tipo':'serp','atual':True,'posicao':3,'observado_em':'2026-11-15T11:59:00Z',
           'concorrentes':[{'pagina':'https://rival.example/','posicao':1}]}
        x={'site':'example.invalid','objetivo':'Qual a posição e os concorrentes?','evidencias':[s]}
        e=sanear_web(x,agora=agora)['evidencias'][0]
        self.assertFalse(e['atual']);self.assertIsNone(e['posicao']);self.assertNotIn('concorrentes',e)
        self.assertEqual(e['estado_fonte'],'sem_captura_validavel')
        r=finalizar_web({'acao':'comparar_concorrentes','evidencias':['s1']},x,'ia',agora=agora)
        self.assertEqual(r['estado'],'recusada')
        self.assertEqual(regra_posicao_indisponivel({'objetivo':x['objetivo'],'evidencias':[e]})['acao'],'atualizar_coleta')
        s['fontes_serp']=[{'id':'captura_123','sha256':'a'*64,'observado_em':s['observado_em']}]
        self.assertTrue(sanear_web(x,agora=agora)['evidencias'][0]['atual'])
        for mudanca in ('sem_data','vencida','futura','inconsistente','duplicada'):
            c=json.loads(json.dumps(x));f=c['evidencias'][0]['fontes_serp']
            if mudanca=='sem_data':f[0].pop('observado_em')
            if mudanca=='vencida':f[0]['observado_em']='2026-11-15T11:00:00Z'
            if mudanca=='futura':f[0]['observado_em']='2026-11-15T12:00:01Z'
            if mudanca=='inconsistente':f[0]['observado_em']='2026-11-15T11:58:00Z'
            if mudanca=='duplicada':f.append(dict(f[0]))
            e=sanear_web(c,agora=agora)['evidencias'][0]
            self.assertFalse(e['atual']);self.assertIsNone(e['posicao']);self.assertNotIn('concorrentes',e)

    def test_recorte_sem_site_tem_orientacao_propria_ate_expirar(self):
        agora=datetime(2026,11,15,12,0,tzinfo=timezone.utc)
        fonte={'id':'captura_123','sha256':'a'*64,'observado_em':'2026-11-15T11:30:00Z'}
        s={'id':'s1','tipo':'serp','atual':False,'posicao':None,'observado_em':fonte['observado_em'],
           'estado_fonte':'nao_observado_recorte','recorte_serp':[fonte]}
        x={'site':'example.invalid','objetivo':'Qual é a posição atual?','evidencias':[s]}
        limpa=sanear_web(x,agora=agora)
        e=limpa['evidencias'][0]
        self.assertEqual(e['estado_fonte'],'nao_observado_recorte')
        self.assertIsNone(e['posicao']);self.assertFalse(e['atual']);self.assertIn('não comprova ausência',e['descricao'])
        self.assertNotIn('recorte_serp',entrada_para_modelo(limpa)['evidencias'][0])
        saida=finalizar_web({'acao':'atualizar_coleta','evidencias':['s1']},x,'regra',agora=agora)
        self.assertIn('páginas já verificadas',saida['orientacao_padrao'])
        for alteracao in ('vencida','hash','duplicada','futura'):
            copia=json.loads(json.dumps(x));paginas=copia['evidencias'][0]['recorte_serp']
            if alteracao=='vencida':paginas[0]['observado_em']='2026-11-15T11:00:00Z'
            if alteracao=='futura':paginas[0]['observado_em']='2026-11-15T12:00:01Z'
            if alteracao=='hash':paginas[0]['sha256']='invalido'
            if alteracao=='duplicada':paginas.append(dict(paginas[0]))
            e=sanear_web(copia,agora=agora)['evidencias'][0]
            self.assertNotEqual(e['estado_fonte'],'nao_observado_recorte')
            self.assertNotIn('recorte_serp',e);self.assertIsNone(e['posicao'])

    def test_pergunta_de_posicao_sem_dado_cita_fonte_sem_afirmar_retorno(self):
        s={'id':'s1','tipo':'serp','atual':False,'posicao':None}
        x={'objetivo':'Qual posição atual e quais concorrentes?','evidencias':[s]}
        self.assertEqual(regra_posicao_indisponivel(x),{'acao':'atualizar_coleta','evidencias':['s1']})
        x['objetivo']='Quanto retorno a posição traz?';self.assertIsNone(regra_posicao_indisponivel(x))
        x['objetivo']='Como saber se as pessoas procuram este serviço?';self.assertIsNone(regra_posicao_indisponivel(x))
        x['objetivo']='Qual posição atual?';s.update(atual=True,posicao=12)
        self.assertIsNone(regra_posicao_indisponivel(x))

    def test_objetivo_generico_com_so_busca_indisponivel_orienta_verificacao(self):
        s={'id':'s1','tipo':'serp','atual':False,'posicao':None,'estado_fonte':'nao_configurada'}
        x={'objetivo':'Escolher uma próxima melhoria com as evidências disponíveis. O retorno comercial não foi medido.',
           'evidencias':[s]}
        self.assertEqual(regra_posicao_indisponivel(x),{'acao':'atualizar_coleta','evidencias':['s1']})
        x['objetivo']='Escolher uma próxima melhoria com as evidências disponíveis. Quanto gasto?'
        self.assertIsNone(regra_posicao_indisponivel(x))
        x['objetivo']='Escolher uma próxima melhoria com as evidências disponíveis. O retorno comercial não foi medido.'
        x['evidencias'].append({'id':'p1','tipo':'pagina','atual':True})
        self.assertIsNone(regra_posicao_indisponivel(x))
        x['evidencias']=[s];s.update(atual=True,posicao=3)
        self.assertIsNone(regra_posicao_indisponivel(x))

    def test_acompanhar_colocacao_respeita_frescor_e_nao_responde_custos_com_posicao(self):
        s={'id':'s1','tipo':'serp','atual':True,'posicao':1,
           'fontes_serp':[{'id':'captura_123','sha256':'a'*64}],'concorrentes':[]}
        x={'objetivo':'Como acompanhar esta colocação no Google?','evidencias':[s]}
        self.assertEqual(regra_serp_atual(x),{'acao':'acompanhar','evidencias':['s1']})
        s.update(atual=False,posicao=None)
        self.assertEqual(regra_posicao_indisponivel(x),{'acao':'atualizar_coleta','evidencias':['s1']})
        for objetivo in ('Qual o custo da posição no Google?','Qual o preço para acompanhar a colocação?',
                         'Qual é o ROI da posição observada?'):
            x['objetivo']=objetivo
            self.assertIsNone(regra_posicao_indisponivel(x))
            s.update(atual=True,posicao=1)
            self.assertIsNone(regra_serp_atual(x))
            s.update(atual=False,posicao=None)

    def test_hashes_de_captura_ficam_para_auditoria_sem_ocupar_contexto_do_modelo(self):
        original={'site':'example.invalid','evidencias':[{'id':'s1','tipo':'serp','atual':True,
           'fontes_serp':[{'id':'captura_123','sha256':'a'*64}]}]}
        entrada=entrada_para_modelo(original)
        self.assertNotIn('fontes_serp',entrada['evidencias'][0])
        self.assertEqual(entrada['evidencias'][0]['id'],'s1')
        self.assertIn('fontes_serp',original['evidencias'][0])

    def test_evidencia_que_expira_durante_inferencia_bloqueia_saida_desatualizada(self):
        s={'id':'s1','tipo':'serp','atual':True,'posicao':27,'observado_em':'2026-11-15T09:00:00Z',
          'fontes_serp':[{'id':'captura_123','sha256':'a'*64,'observado_em':'2026-11-15T09:00:00Z'}],
          'concorrentes':[{'pagina':'https://rival.example/','posicao':2}]}
        original={'site':'example.invalid','objetivo':'Ver concorrentes','evidencias':[s]}
        escolha={'acao':'comparar_concorrentes','evidencias':['s1']}
        antes=finalizar_web(escolha,original,'regra',agora=datetime(2026,11,15,9,59,59,tzinfo=timezone.utc))
        depois=finalizar_web(escolha,original,'regra',agora=datetime(2026,11,15,10,0,1,tzinfo=timezone.utc))
        self.assertEqual(antes['estado'],'revisao_necessaria');self.assertEqual(depois['estado'],'recusada')
        self.assertIsNone(depois['evidencias_citadas'][0]['posicao'])
        self.assertNotIn('concorrentes',depois['evidencias_citadas'][0])

    def test_selecao_experimental_prefere_arquivo_integro_e_preserva_fallback(self):
        with tempfile.TemporaryDirectory() as pasta:
            p=Path(pasta);nova=p/'nova.json';anterior=p/'anterior.json';dn=p/'dn.json';da=p/'da.json'
            nova.write_text('{"nova":true}');anterior.write_text('{"anterior":true}')
            da.write_text(json.dumps({'estado':'manter_selecao_anterior','selecao_sha256':hashlib.sha256(anterior.read_bytes()).hexdigest()}))
            dn.write_text(json.dumps({'estado':'experimental_disponivel','selecao_sha256':'incorreto'}))
            self.assertEqual(selecao_candidata([(nova,dn),(anterior,da)]),anterior)
            dn.write_text(json.dumps({'estado':'experimental_disponivel','selecao_sha256':hashlib.sha256(nova.read_bytes()).hexdigest()}))
            self.assertEqual(selecao_candidata([(nova,dn),(anterior,da)]),nova)

    def test_regra_de_publicacao_exige_diretiva_recente_e_intencao_desconhecida(self):
        e={'id':'d1','tipo':'pagina','atual':True,'sha256_pagina':'a'*64,
           'verificacao':{'tipo':'meta_robots_noindex','escopo':'html_inicial','intencao':'desconhecida'}}
        x={'objetivo':'Verificar diretiva antes de mudar a publicação','evidencias':[e]}
        self.assertEqual(regra_publicacao(x),{'acao':'confirmar_publicacao','evidencias':['d1']})
        self.assertFalse(bloqueios(regra_publicacao(x),x))
        e['verificacao']['intencao']='confirmada';self.assertIsNone(regra_publicacao(x))
        e['verificacao']['intencao']='desconhecida';e['sha256_pagina']='inválido';self.assertIsNone(regra_publicacao(x))
        e['sha256_pagina']='a'*64;e['atual']=False;self.assertIsNone(regra_publicacao(x))
        e['atual']=True;x['objetivo']='Escolher investimento';self.assertIsNone(regra_publicacao(x))

    def test_diretiva_http_precisa_de_valor_hash_escopo_e_referencia_validos(self):
        valor='googlebot: noindex';digest=hashlib.sha256(valor.encode()).hexdigest()
        e={'id':'d1','tipo':'pagina','atual':True,'sha256_pagina':'a'*64,
           'valor_cabecalho':valor,'sha256_cabecalho':digest,
           'verificacao':{'tipo':'http_robots_noindex','escopo':'cabecalho_http','intencao':'desconhecida'}}
        x={'objetivo':'Conferir diretiva HTTP','evidencias':[e]}
        escolha=regra_publicacao(x)
        self.assertEqual(escolha,{'acao':'confirmar_publicacao','evidencias':['d1']})
        self.assertFalse(bloqueios_web(escolha,x))
        self.assertFalse(cabecalho_noindex('max-image-preview: none'))
        self.assertFalse(cabecalho_noindex('otherbot: noindex'))
        self.assertTrue(cabecalho_noindex('googlebot: noindex'))
        e['valor_cabecalho']='otherbot: noindex';e['sha256_cabecalho']=hashlib.sha256(e['valor_cabecalho'].encode()).hexdigest()
        self.assertIsNone(regra_publicacao(x))
        e['valor_cabecalho']=valor;e['sha256_cabecalho']='b'*64
        self.assertIsNone(regra_publicacao(x));self.assertTrue(bloqueios_web(escolha,x))

    def test_troca_da_interface_exige_nao_regredir_e_contraprova_noindex(self):
        def real(total,criticos,tipos):
            return {'metricas':{'acao_e_referencias':{'quantidade':total},'escolha_critica':{'quantidade':criticos}},
                    'por_tipo':{k:{'total':10,'ambos':v} for k,v in tipos.items()}}
        def sint(acertos):return {'por_tipo':{'noindex':{'total':10,'corretos_e_aceitos':acertos}}}
        anterior=real(15,0,{'demanda':5,'comercial':10})
        melhor=real(17,0,{'demanda':8,'comercial':9})
        self.assertEqual(avaliar_troca(anterior,melhor,sint(3),sint(4))['estado'],'candidato_experimental_preferido')
        for ruim in (real(17,1,{'demanda':8,'comercial':9}),real(16,0,{'demanda':10,'comercial':6})):
            self.assertEqual(avaliar_troca(anterior,ruim,sint(3),sint(4))['estado'],'manter_selecao_anterior')
        self.assertEqual(avaliar_troca(anterior,melhor,sint(3),sint(0))['estado'],'manter_selecao_anterior')

    def test_exclusao_previa_recalcula_denominador_e_dominios(self):
        certo={'acao_esperada':True,'acao_e_referencias':True,'escolha_critica':False}
        errado={'acao_esperada':False,'acao_e_referencias':False,'escolha_critica':False}
        teste={'split':'test','resultados':[{'dominio':'a.example','tipo':'demanda','criterios':certo},
                                            {'dominio':'b.example','tipo':'demanda','criterios':errado}]}
        x=filtrar(teste,{'antesDeObservarResultadosDeTeste':True,'dominios':['b.example']})
        self.assertEqual(x['metricas']['acao_e_referencias'],{'quantidade':1,'total':1})
        self.assertEqual(x['dominios_incluidos'],1);self.assertEqual(x['casos_excluidos'],1)
        with self.assertRaises(ValueError):filtrar(teste,{'antesDeObservarResultadosDeTeste':False,'dominios':['b.example']})

    def test_terceira_troca_exige_cobertura_equilibrada_e_sem_criticos(self):
        tipos={k:{'total':10,'ambos':9} for k in ('serp','comercial','demanda','h1')}
        base={'metricas':{},'por_tipo':tipos}
        novo={'metricas':{'acao_e_referencias':{'quantidade':36,'total':40},'escolha_critica':{'quantidade':0}},'por_tipo':tipos}
        sint={'por_tipo':{k:{'total':12,'corretos_e_aceitos':10,'criticos':0} for k in ('demanda','noindex')}}
        self.assertEqual(avaliar_troca3(base,novo,sint)['estado'],'candidato_experimental_preferido')
        sint['por_tipo']['noindex']['criticos']=1
        self.assertEqual(avaliar_troca3(base,novo,sint)['estado'],'manter_selecao_anterior')


if __name__=='__main__':
    unittest.main()
