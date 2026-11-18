import copy
import unittest
from negocio.relacoes.contrato import validar_entrada,validar_e_renderizar
from negocio.relacoes.protocolo import mensagens,esquema


def entrada(texto='Empresas contratam Limpeza para colaboradores. Profissionais executam Limpeza.'):
    return {'versao':1,'tarefa':'mapear_relacoes','dominio':'exemplo.com.br','fontes':[
        {'id':'s01','texto':texto,'tipo':'conteudo','contexto':{'paginaId':'pag_'+'a'*20,
         'url':'https://exemplo.com.br/limpeza/','tituloPagina':'Limpeza','titulos':[{'nivel':1,'texto':'Limpeza'}],
         'campo':'p','coletadoEm':'2026-11-16T12:30:00Z','sha256':'a'*64,'recortado':False,'classePagina':'nao_determinada'}}]}


def rel(**kw):
    return {'sujeito':'Empresas','predicado':'contrata','objeto':'Limpeza','oferta':'Limpeza',
            'polaridade':'afirma','temporalidade':'nao_determinada','evidencias':['s01'],**kw}


def saida(rels=None,conds=None):
    return {'estado':'hipotese','relacoes':rels or [],'condicoes':conds or [],'duvidas':[]}


class RelacoesTests(unittest.TestCase):
    def test_citacao_e_contexto_renderizados_pelo_programa(self):
        e=entrada();r=validar_e_renderizar(saida([rel()]),e)
        self.assertEqual(r['relacoes'][0]['citacoes'][0],e['fontes'][0]);self.assertFalse(r['perfilConfirmado'])
        self.assertEqual(r['relacoes'][0]['revisaoSemantica'],'pendente')
        self.assertEqual(r['relacoes'][0]['citacoes'][0]['contexto']['titulos'],[{'nivel':1,'texto':'Limpeza'}])

    def test_um_item_errado_nao_apaga_outro_mas_nao_certifica_lista(self):
        r=validar_e_renderizar(saida([rel(),rel(objeto='Produto inventado')]),entrada())
        self.assertEqual(len(r['relacoes']),1);self.assertEqual(len(r['recusados']),1)
        self.assertFalse(r['contratoIntegralValido'])

    def test_interface_nao_prova_relacao(self):
        e=entrada();e['fontes'][0]['tipo']='interface'
        r=validar_e_renderizar(saida([rel()]),e);self.assertEqual(r['relacoes'],[])

    def test_destinacao_nao_vira_captacao(self):
        e=entrada('A Fundação destina recursos para projetos culturais.')
        r=validar_e_renderizar(saida([rel(sujeito='$site',predicado='capta_recursos',objeto='projetos culturais',oferta=None)]),e)
        self.assertIn('captacao_conflita_com_verbo_de_destinacao',r['recusados'][0]['erros'])

    def test_concessao_de_recurso_continua_pendente_revisao(self):
        e=entrada('A Fundação destina recursos para projetos culturais.')
        r=validar_e_renderizar(saida([rel(sujeito='$site',predicado='concede_recursos',objeto='projetos culturais',oferta=None)]),e)
        self.assertEqual(len(r['relacoes']),1);self.assertIn('direcao_financeira_exige_revisao',r['relacoes'][0]['alertas'])

    def test_noticiado_nao_comprova_vigencia_atual(self):
        e=entrada('Oferecemos Limpeza.');e['fontes'][0]['contexto']['classePagina']='editorial'
        r=validar_e_renderizar(saida([rel(sujeito='$site',predicado='oferece',temporalidade='declaracao_atual')]),e)
        self.assertIn('vigencia_atual_nao_comprovada_por_editorial',r['recusados'][0]['erros'])

    def test_condicao_usa_escopo_do_cabecalho_sem_reescrever_fonte(self):
        e=entrada('Exige agendamento até sexta-feira.')
        c={'aplicacao':'Limpeza','categoria':'prazo','temporalidade':'nao_determinada','evidencias':['s01']}
        r=validar_e_renderizar(saida(conds=[c]),e)
        self.assertEqual(len(r['condicoes']),1);self.assertEqual(r['condicoes'][0]['citacoes'][0]['texto'],e['fontes'][0]['texto'])

    def test_nao_transfere_condicao_para_oferta_sem_apoio(self):
        e=entrada('Exige agendamento até sexta-feira.')
        c={'aplicacao':'Transporte','categoria':'prazo','temporalidade':'nao_determinada','evidencias':['s01']}
        self.assertEqual(validar_e_renderizar(saida(conds=[c]),e)['condicoes'],[])

    def test_mesmo_nome_com_caixa_diferente_nao_reescreve_citacao(self):
        e=entrada();r=validar_e_renderizar(saida([rel(sujeito='empresas')]),e)
        self.assertEqual(len(r['relacoes']),1);self.assertTrue(r['relacoes'][0]['citacoes'][0]['texto'].startswith('Empresas'))

    def test_substring_nao_inventa_ator(self):
        e=entrada('Contratantes solicitam Limpeza.')
        r=validar_e_renderizar(saida([rel(sujeito='ator')]),e);self.assertEqual(r['relacoes'],[])

    def test_dados_sem_contexto_sao_condicao_explicita_de_ablation(self):
        e=entrada();e['fontes'][0].pop('contexto')
        self.assertEqual(validar_entrada(e),[]);self.assertEqual(len(validar_e_renderizar(saida([rel()]),e)['relacoes']),1)

    def test_url_fora_do_dominio_e_recusada(self):
        e=entrada();e['fontes'][0]['contexto']['url']='https://outro.com/';self.assertIn('url_contexto_invalida',validar_entrada(e))

    def test_hierarquia_trocada_e_recusada(self):
        e=entrada();e['fontes'][0]['contexto']['titulos']=[{'nivel':2,'texto':'X'},{'nivel':1,'texto':'Y'}]
        self.assertIn('hierarquia_invalida',validar_entrada(e))

    def test_envelope_contraditorio_nao_libera_parciais(self):
        s=saida([rel()]);s['estado']='insuficiente';r=validar_e_renderizar(s,entrada())
        self.assertEqual(r['relacoes'],[]);self.assertEqual(r['estado'],'recusada')

    def test_ausencia_de_campos_e_erro_nao_abstencao(self):
        r=validar_e_renderizar({'estado':'insuficiente'},entrada());self.assertTrue(r['erros'])

    def test_prompt_nao_contem_nomes_de_empresas_ficticias(self):
        s=mensagens(entrada())[0]['content'];self.assertNotIn('Curso de Pintura',s);self.assertNotIn('Kit Completo',s)
        self.assertIn('página',s.lower());self.assertEqual(esquema(entrada())['properties']['relacoes']['items']['properties']['evidencias']['items']['enum'],['s01'])

    def test_nome_de_menu_nao_vira_prazo(self):
        e=entrada('Solicitar orçamento')
        c={'aplicacao':None,'categoria':'prazo','temporalidade':'nao_determinada','evidencias':['s01']}
        r=validar_e_renderizar(saida(conds=[c]),e)
        self.assertIn('categoria_sem_indicio_no_segmento',r['recusados'][0]['erros'])

    def test_convite_a_contratar_nao_prova_empresa_contratante(self):
        e=entrada('Contrate profissionais na nossa plataforma.')
        r=validar_e_renderizar(saida([rel(sujeito='$site',objeto='profissionais',oferta=None)]),e)
        self.assertIn('convite_ao_cliente_nao_prova_contratacao_pelo_site',r['recusados'][0]['erros'])

    def test_convite_nao_prova_execucao(self):
        e=entrada('Encontre profissionais e solicite manutenção.')
        r=validar_e_renderizar(saida([rel(sujeito='$site',predicado='executa',objeto='manutenção',oferta=None)]),e)
        self.assertIn('execucao_sem_indicio_no_segmento',r['recusados'][0]['erros'])

    def test_direcao_financeira_nao_e_inferida_de_pagamento_generico(self):
        e=entrada('Profissionais recebem. Pague com segurança na plataforma.')
        r=validar_e_renderizar(saida([rel(sujeito='$site',predicado='paga',objeto='Profissionais',oferta=None)]),e)
        self.assertIn('pagador_sem_indicio_no_segmento',r['recusados'][0]['erros'])

    def test_relatorio_escapa_html_e_markdown_da_fonte(self):
        from negocio.relacoes.relatorio import limpar
        s=limpar('<script> [abra](https://exemplo.com)')
        self.assertNotIn('<script>',s);self.assertIn('\\[abra\\]',s)


if __name__=='__main__':unittest.main()
