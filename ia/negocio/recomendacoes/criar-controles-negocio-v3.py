"""Doze cenários autorais DEV. Não lê capturas, VAL real, TEST ou modelos."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import sys
IA=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(IA))
from negocio.contrato import CAMPOS, validar_entrada, validar_saida


def fonte(id,texto,tipo='declaracao'):
    assert len(texto)<=600
    return {'id':id,'texto':texto,'tipo':tipo}


def insuf(campo):
    return {'estado':'insuficiente','valor':'indefinido' if campo=='papel' else 'indefinida' if campo=='finalidade' else [],'fontes':[],'faltam':[campo]}


def leitura(valor,refs):
    return {'estado':'hipotese','valor':valor,'fontes':list(dict.fromkeys(refs)),'faltam':[]}


def item(texto,ref,**campos):
    return {'texto':texto,'fontes':[ref],**campos}


def lista(itens):
    return leitura(itens,[f for i in itens for f in i['fontes']])


def criterio(texto,ref,escopo):
    return item(texto,ref,escopo=escopo)


def plano(decisao,alternativas,criterios,acao,verificar,incertezas,extras=()):
    return {'estado':'proposta','decisao':decisao,'alternativas':[item(t,f) for t,f in alternativas],
            'criterios':criterios,'acao':acao,'verificar':verificar,
            'fontes':list(dict.fromkeys([r for i in criterios for r in i['fontes']]+[f for _,f in alternativas]+list(extras))),
            'incertezas':incertezas,'hipotese':True}


def abstencao(motivo):
    return {'estado':'insuficiente','decisao':'','alternativas':[],'criterios':[],'acao':'','verificar':'','fontes':[],
            'incertezas':[motivo],'hipotese':True}


def cenario(nome,split,tema,fontes,papel,finalidade,ofertas,publicos,atuacoes,condicoes,plano,nota,negacoes):
    alvos={campo:insuf(campo) for campo in CAMPOS}
    if papel:alvos['papel']=leitura(*papel)
    if finalidade:alvos['finalidade']=leitura(*finalidade)
    for campo,valor in [('ofertas',ofertas),('publicos',publicos),('atuacoes',atuacoes),('condicoes',condicoes)]:
        if valor:alvos[campo]=lista(valor)
    return {'id':'novo-dev-'+nome,'grupoEmpresarial':'simulacao-nova-familia-'+nome,'dominio':'cenario-autoral.invalid',
            'split':split,'familiaTematica':tema,'natureza':'contrafactual_controlado_nao_publicado','fontes':fontes,
            'alvosPorCampo':alvos,'planejamentoEsperado':plano,'justificativa':nota,'negacoesCriticas':negacoes}


def construir():
    casos=[]
    # TRAIN 1: software próprio por assinatura não é atendimento médico nem marketplace.
    fs=[fonte('f01','Operamos o Agenda Nuvem, nosso serviço por assinatura para organizar agendas. O serviço é contratado por clínicas. Não vendemos consultas a pacientes.'),
        fonte('f02','O Plano Base do Agenda Nuvem inclui até quatro contas e não inclui integração com prontuário. O Plano Conecta inclui integração com prontuário; a quantidade de contas deve ser confirmada com o atendimento.'),
        fonte('f03','Comparar planos | Falar com atendimento','interface')]
    casos.append(cenario('assinatura-agenda-propria','train','software_e_servicos',fs,('servicos',['f01']),('comercial',['f01']),
        [item('Agenda Nuvem','f01',tipo='servico')],
        [item('clínicas','f01',funcao='cliente',escopo='Agenda Nuvem')],[],
        [criterio('inclui até quatro contas','f02','Plano Base'),criterio('não inclui integração com prontuário','f02','Plano Base'),criterio('inclui integração com prontuário','f02','Plano Conecta'),criterio('Não vendemos consultas a pacientes.','f01','consultas')],
        plano('Distinguir a necessidade de contas da necessidade de integração ao comparar os planos do Agenda Nuvem.',
            [('Plano Base','f02'),('Plano Conecta','f02')],
            [criterio('inclui até quatro contas','f02','Plano Base'),criterio('não inclui integração com prontuário','f02','Plano Base'),criterio('inclui integração com prontuário','f02','Plano Conecta')],
            'Montar localmente dois pedidos fictícios: quatro contas sem integração e integração com prontuário. Confrontar o primeiro com Base e o segundo com Conecta; preparar ao atendimento a pergunta sobre contas do Conecta, sem cadastrar clínicas.',
            'O comparativo deve mostrar Base compatível com quatro contas sem integração e Conecta como opção publicada com integração; a capacidade de contas do Conecta deve permanecer a confirmar.',
            ['A quantidade de contas do Conecta não foi publicada como número.','Não foram fornecidos preços nem requisitos técnicos do prontuário.'],['f03']),
        'Assinatura de software próprio sustenta serviços. A negação de venda de consultas é condição de escopo, não prova inelegibilidade de pacientes para uma oferta existente.',
        ['Não transformar software em venda de consultas.','Não presumir integração no Base ou contas ilimitadas no Conecta.']))
    # TRAIN 2: licença perpétua explicitamente vendida é produto, não assinatura inferida.
    fs=[fonte('f01','Vendemos a licença perpétua do Editor Local para estúdios de fotografia. O programa roda no computador do comprador; não operamos um serviço por assinatura.'),
        fonte('f02','Cada licença do Editor Local permite instalação em um computador. A licença inclui atualizações por doze meses; esse prazo não limita a duração da licença perpétua. Um segundo computador exige uma segunda licença.')]
    casos.append(cenario('licenca-perpetua-local','train','software_e_servicos',fs,('produtos',['f01']),('comercial',['f01']),
        [item('licença perpétua do Editor Local','f01',tipo='produto')],[item('estúdios de fotografia','f01',funcao='cliente',escopo='Editor Local')],[],
        [criterio('instalação em um computador','f02','Editor Local'),criterio('atualizações por doze meses','f02','licença'),criterio('Um segundo computador exige uma segunda licença','f02','Editor Local')],
        plano('Separar duração da licença, prazo de atualizações e quantidade de computadores no Editor Local.',[],
            [criterio('instalação em um computador','f02','Editor Local'),criterio('atualizações por doze meses','f02','licença'),criterio('esse prazo não limita a duração da licença perpétua','f02','licença')],
            'Preparar uma conferência para dois cenários fictícios, um ou dois computadores. Registrar quantas licenças a regra exige e separar a pergunta sobre atualizações após doze meses; não efetuar compra ou ativação.',
            'O cenário de um computador deve apontar uma licença e o de dois deve apontar duas; a licença não deve ser tratada como expirada após o prazo de atualizações.',
            ['Não está informado se atualizações após doze meses podem ser compradas separadamente.']),
        'A fonte explicita venda de licença perpétua e execução local; não aplicar automaticamente a convenção SaaS.',
        ['Não trocar licença perpétua por assinatura.','Não confundir prazo de atualização com expiração da licença.']))
    # TRAIN 3: o profissional externo, não a plataforma, executa o reparo.
    fs=[fonte('f01','O Reparo Livre é uma plataforma comercial que conecta moradores a eletricistas independentes. Intermediamos a contratação, mas não executamos os reparos.'),
        fonte('f02','No Reparo Livre, a visita diagnóstica não inclui o reparo. O eletricista apresenta um orçamento após a avaliação. A execução só começa depois da aceitação do orçamento pelo morador.'),
        fonte('f03','Solicitar visita diagnóstica | Consultar etapas','interface')]
    casos.append(cenario('reparo-visita-orcamento','train','intermediacao_e_atores',fs,('intermediacao',['f01']),('comercial',['f01']),
        [item('Intermediamos a contratação','f01',tipo='servico')],[item('moradores','f01',funcao='cliente',escopo=None),item('eletricistas independentes','f01',funcao='prestador',escopo=None)],[],
        [criterio('a visita diagnóstica não inclui o reparo','f02','Reparo Livre'),criterio('depois da aceitação do orçamento pelo morador','f02','execução')],
        plano('Separar visita diagnóstica de autorização para executar o reparo no Reparo Livre.',[],
            [criterio('a visita diagnóstica não inclui o reparo','f02','Reparo Livre'),criterio('depois da aceitação do orçamento pelo morador','f02','execução')],
            'Desenhar um atendimento fictício com três etapas: solicitar diagnóstico, receber orçamento do eletricista e pedir aceitação do morador. Conferir no roteiro quem executa e onde a autorização é necessária, sem solicitar visita real.',
            'O roteiro não pode registrar visita como reparo incluído nem autorizar execução antes de aceite; o eletricista deve continuar identificado como executor independente.',
            ['Valores, disponibilidade e identidade do profissional não foram informados.'],['f01','f03']),
        'Negação operacional e condição de autorização precisam sobreviver à intermediação.',
        ['Não atribuir execução à plataforma.','Não presumir reparo incluso na visita nem aceite do orçamento.']))
    # TRAIN 4: produção própria e contratação de transportador são duas relações diferentes.
    fs=[fonte('f01','Fabricamos e vendemos Kits de Embalagem para pequenas lojas. Também intermediamos fretes entre essas lojas e transportadoras independentes; o cliente escolhe o transportador, que executa a entrega.'),
        fonte('f02','A compra do Kit de Embalagem não inclui frete. No serviço de intermediação de fretes, o seguro de transporte é opcional e deve ser solicitado antes da confirmação da contratação.'),
        fonte('f03','Ver kits | Comparar transportadores','interface')]
    casos.append(cenario('kit-proprio-frete-intermediado','train','intermediacao_e_atores',fs,('misto',['f01']),('comercial',['f01']),
        [item('Kits de Embalagem','f01',tipo='produto'),item('intermediamos fretes','f01',tipo='servico')],
        [item('pequenas lojas','f01',funcao='cliente',escopo=None),item('transportadoras independentes','f01',funcao='prestador',escopo='fretes')],[],
        [criterio('não inclui frete','f02','Kit de Embalagem'),criterio('o seguro de transporte é opcional','f02','intermediação de fretes'),criterio('antes da confirmação da contratação','f02','seguro de transporte')],
        plano('Distinguir o pedido de embalagem do pedido de frete e registrar a opção de seguro antes de contratar.',[],
            [criterio('não inclui frete','f02','Kit de Embalagem'),criterio('o seguro de transporte é opcional','f02','intermediação de fretes'),criterio('antes da confirmação da contratação','f02','seguro de transporte')],
            'Preparar dois registros de pedido fictício: um de kit e outro de transporte. No transporte, incluir uma pergunta explícita sobre seguro antes da confirmação e identificar que a entrega seria feita pela transportadora escolhida; não enviar pedidos.',
            'O registro do kit deve deixar frete separado. O de transporte deve ter executor independente e opção de seguro ainda não confirmada, sem indicar cobertura contratada.',
            ['Não foram informados cobertura, preço ou condições de aceitação do seguro.'],['f01','f03']),
        'Papel misto decorre de fabricar produtos e intermediar fretes explicitamente, não de haver apenas uma transportadora operacional.',
        ['Não incluir frete ou seguro automaticamente no kit.','Não tratar a fábrica como executora da entrega.']))
    # TRAIN 5: programa social e participação não viram venda ou captação presumida.
    fs=[fonte('f01','Somos uma organização social. O Programa Laboratório do Bairro oferece oficinas gratuitas para jovens de dezesseis a vinte anos. As oficinas são realizadas por nossa equipe.'),
        fonte('f02','A inscrição no Programa Laboratório do Bairro é restrita a moradores do Bairro Laranjeira. O Voluntariado Técnico tem seleção própria e não exige que o voluntário seja morador desse bairro. Esta página não recebe doações.'),
        fonte('f03','Conhecer critérios de inscrição | Consultar seleção do Voluntariado Técnico','interface')]
    casos.append(cenario('oficina-bairro-voluntariado','train','social_e_participacao',fs,('servicos',['f01']),('social',['f01']),[],
        [item('jovens de dezesseis a vinte anos','f01',funcao='beneficiario',escopo='Programa Laboratório do Bairro'),item('moradores do Bairro Laranjeira','f02',funcao='beneficiario',escopo='Programa Laboratório do Bairro'),item('voluntário','f02',funcao='participante',escopo='Voluntariado Técnico')],
        [item('Programa Laboratório do Bairro','f01',tipo='programa'),item('Voluntariado Técnico','f02',tipo='participacao')],
        [criterio('oficinas gratuitas','f01','Programa Laboratório do Bairro'),criterio('restrita a moradores do Bairro Laranjeira','f02','Programa Laboratório do Bairro'),criterio('não exige que o voluntário seja morador desse bairro','f02','Voluntariado Técnico')],
        plano('Separar elegibilidade para as oficinas da seleção de voluntariado, sem exigir o mesmo vínculo territorial.',
            [('Programa Laboratório do Bairro','f01'),('Voluntariado Técnico','f02')],
            [criterio('jovens de dezesseis a vinte anos','f01','Programa Laboratório do Bairro'),criterio('restrita a moradores do Bairro Laranjeira','f02','Programa Laboratório do Bairro'),criterio('não exige que o voluntário seja morador desse bairro','f02','Voluntariado Técnico')],
            'Construir duas conferências sem dados pessoais: candidato fictício às oficinas, com faixa etária e bairro, e pessoa fictícia interessada em voluntariado. Conferir os critérios publicados antes de preparar uma pergunta à equipe; não enviar inscrições.',
            'A conferência das oficinas deve conter faixa etária e território. A de voluntariado deve remeter à seleção própria sem rejeitar alguém só por morar fora do bairro.',
            ['Não foram publicados calendário, vagas abertas ou etapas da seleção de voluntariado.'],['f03']),
        'Execução própria explícita sustenta serviços apesar da finalidade social; a atuação gratuita continua programa, não oferta vendida. A restrição territorial não se espalha ao voluntariado e a negação de doação vale apenas nesta página.',
        ['Não vender oficinas nem criar campanha de doação.','Não aplicar restrição de bairro ao voluntariado.']))
    # TRAIN 6: comprar produto não é condição de acesso a programa gratuito.
    fs=[fonte('f01','Nossa associação mantém uma frente social e uma frente comercial. O Programa Leitura Aberta é gratuito para adultos em alfabetização. Fabricamos e vendemos Cadernos da Associação em nossa loja para financiar a manutenção do programa.'),
        fonte('f02','A participação no Programa Leitura Aberta não depende de compra na loja. Cada Caderno da Associação é vendido como produto; a compra não equivale a uma doação nem a uma inscrição no programa.'),
        fonte('f03','Conhecer o Programa Leitura Aberta | Ver Cadernos da Associação','interface')]
    casos.append(cenario('loja-social-acesso-independente','train','social_e_participacao',fs,('produtos',['f01']),('mista',['f01']),
        [item('Cadernos da Associação','f01',tipo='produto')],[item('adultos em alfabetização','f01',funcao='beneficiario',escopo='Programa Leitura Aberta')],
        [item('Programa Leitura Aberta','f01',tipo='programa')],
        [criterio('gratuito para adultos em alfabetização','f01','Programa Leitura Aberta'),criterio('não depende de compra na loja','f02','Programa Leitura Aberta'),criterio('não equivale a uma doação nem a uma inscrição no programa','f02','Caderno da Associação')],
        plano('Distinguir acesso ao programa gratuito, compra do caderno e uma eventual intenção de doar.',[],
            [criterio('não depende de compra na loja','f02','Programa Leitura Aberta'),criterio('não equivale a uma doação nem a uma inscrição no programa','f02','Caderno da Associação')],
            'Redigir dois caminhos locais: participar do programa e comprar caderno. No primeiro, remover qualquer etapa de compra; no segundo, manter a compra como produto e registrar que não inscreve no programa. Se a intenção for doar, deixar o canal a confirmar.',
            'O caminho de alfabetização deve funcionar sem compra; o caminho de caderno não deve prometer inscrição, doação ou benefício individual automático.',
            ['Não foi publicado canal de doação.','O financiamento institucional declarado não mede o impacto de uma compra específica.'],['f03']),
        'Finalidade mista não converte a venda em doação; o papel de produto é comprovado pela fabricação/venda, e o programa gratuito não vira oferta comercial.',
        ['Não exigir compra para programa gratuito.','Não chamar compra de doação ou inscrição.']))
    # VALIDATION 1: nomes de botões não definem modelo de negócio ou condições.
    fs=[fonte('f01','Plataforma | Assinar | Buscar especialista | Parceiros | Teste grátis','interface'),fonte('f02','Comparar planos | Entrar | Cadastre-se','interface')]
    casos.append(cenario('navegacao-sem-modelo-de-negocio','validation','software_e_servicos',fs,None,None,[],[],[],[],
        abstencao('Há somente rótulos de navegação; faltam declaração de atividade, atores e condições que sustentem uma decisão.'),
        'Menu não permite concluir SaaS, intermediação, assinatura gratuita ou teste realmente disponível.',
        ['Não inferir oferta por botão Assinar ou Teste grátis.','Não inferir executor externo por Buscar especialista.']))
    # VALIDATION 2: fornecedor de infraestrutura não muda a autoria do serviço.
    fs=[fonte('f01','Operamos o Cofre de Arquivos como serviço comercial por assinatura para escritórios. O atendimento e a gestão do serviço são feitos por nossa equipe. A nuvem é fornecida pela Infraestrutura Azul; ela não é o prestador contratado pelos escritórios.'),
        fonte('f02','O Ambiente de Demonstração do Cofre de Arquivos aceita apenas arquivos fictícios e apaga o conteúdo ao fim da sessão. O Ambiente Contratado permite retenção configurada pelo escritório. A demonstração não ativa automaticamente uma assinatura.'),
        fonte('f03','Ler condições da demonstração | Contatar atendimento','interface')]
    casos.append(cenario('infraestrutura-nao-executor-final','validation','software_e_servicos',fs,('servicos',['f01']),('comercial',['f01']),
        [item('Cofre de Arquivos','f01',tipo='servico')],[item('escritórios','f01',funcao='cliente',escopo='Cofre de Arquivos')],[],
        [criterio('aceita apenas arquivos fictícios','f02','Ambiente de Demonstração'),criterio('apaga o conteúdo ao fim da sessão','f02','Ambiente de Demonstração'),criterio('não ativa automaticamente uma assinatura','f02','demonstração')],
        plano('Separar demonstração descartável de retenção contratada ao avaliar o Cofre de Arquivos.',
            [('Ambiente de Demonstração','f02'),('Ambiente Contratado','f02')],
            [criterio('aceita apenas arquivos fictícios','f02','Ambiente de Demonstração'),criterio('apaga o conteúdo ao fim da sessão','f02','Ambiente de Demonstração'),criterio('permite retenção configurada pelo escritório','f02','Ambiente Contratado')],
            'Preparar um teste com arquivo fictício e conferir as condições antes de qualquer uso. No roteiro, marcar descarte da demonstração e separar a pergunta sobre configuração de retenção contratada; não enviar arquivos reais nem contratar assinatura.',
            'O roteiro deve rejeitar documentos reais na demonstração e não tratá-la como armazenamento permanente ou assinatura ativada. A retenção contratada continua dependente de configuração confirmada.',
            ['Não foram informados prazo de retenção contratada, preço ou requisitos de segurança.'],['f03']),
        'Uma infraestrutura terceirizada não é um mercado que conecta o cliente a executores independentes. Não criar prestador final com base em fornecedor técnico.',
        ['Não transformar nuvem fornecedora em intermediação comercial.','Não enviar documento real à demonstração nem presumir retenção permanente.']))
    # VALIDATION 3: canal de compra não é operador; cancelamento tem requisito temporal.
    fs=[fonte('f01','A Rota de Bilhetes intermedeia a venda de passagens entre passageiros e empresas de ônibus independentes. As viagens são operadas pelas empresas de ônibus; nossa plataforma não opera os veículos.'),
        fonte('f02','Na Rota de Bilhetes, o pedido de cancelamento deve ser solicitado pelo mesmo canal de compra até vinte e quatro horas antes do embarque. Um pedido fora desse prazo precisa de análise da empresa de ônibus e não tem aprovação garantida.'),
        fonte('f03','Ler regras de cancelamento | Identificar canal de compra','interface')]
    casos.append(cenario('passagem-canal-prazo-operador','validation','intermediacao_e_atores',fs,('intermediacao',['f01']),('comercial',['f01']),
        [item('intermedeia a venda de passagens','f01',tipo='servico')],[item('passageiros','f01',funcao='cliente',escopo='passagens'),item('empresas de ônibus independentes','f01',funcao='prestador',escopo='passagens')],[],
        [criterio('pelo mesmo canal de compra até vinte e quatro horas antes do embarque','f02','pedido de cancelamento'),criterio('não tem aprovação garantida','f02','pedido fora desse prazo')],
        plano('Distinguir o encaminhamento de cancelamento dentro e fora do prazo sem confundir plataforma e operadora.',[],
            [criterio('pelo mesmo canal de compra até vinte e quatro horas antes do embarque','f02','pedido de cancelamento'),criterio('não tem aprovação garantida','f02','pedido fora desse prazo')],
            'Montar dois exemplos fictícios de pedido, trinta e doze horas antes do embarque. Registrar no primeiro o mesmo canal de compra e no segundo a análise da empresa de ônibus; preparar perguntas sem enviar cancelamento ou acessar bilhete real.',
            'O exemplo de trinta horas deve apontar o canal de compra; o de doze horas deve permanecer sujeito à análise, sem prometer aprovação, devolução ou operação de viagem pela plataforma.',
            ['Taxas, valor de devolução e prazo de análise não foram informados.'],['f03']),
        'Intermediação é explícita; o teste é uma conferência com dados fictícios, não efetivação de cancelamento.',
        ['Não atribuir veículos à plataforma.','Não garantir cancelamento fora do prazo nem devolução financeira.']))
    # VALIDATION 4: diretório vende informação, sem contratar os listados.
    fs=[fonte('f01','Vendemos o Guia Impresso de Fornecedores e operamos o Diretório Atualizado por assinatura para compradores empresariais. As empresas listadas são apenas referências de contato: não recebem pedidos nem fecham contratos por nosso diretório.'),
        fonte('f02','O Guia Impresso de Fornecedores corresponde à edição de março. O Diretório Atualizado recebe revisões mensais de contatos enquanto a assinatura estiver ativa. A assinatura não inclui negociação ou contratação de fornecedores.'),
        fonte('f03','Comparar guia e diretório | Conferir edição','interface')]
    casos.append(cenario('diretorio-informacao-nao-contratacao','validation','intermediacao_e_atores',fs,('misto',['f01']),('comercial',['f01']),
        [item('Guia Impresso de Fornecedores','f01',tipo='produto'),item('Diretório Atualizado','f01',tipo='servico')],
        [item('compradores empresariais','f01',funcao='cliente',escopo=None)],[],
        [criterio('corresponde à edição de março','f02','Guia Impresso de Fornecedores'),criterio('revisões mensais de contatos enquanto a assinatura estiver ativa','f02','Diretório Atualizado'),criterio('não inclui negociação ou contratação de fornecedores','f02','assinatura')],
        plano('Escolher entre uma edição impressa e revisão mensal de contatos, sem esperar contratação intermediada.',
            [('Guia Impresso de Fornecedores','f02'),('Diretório Atualizado','f02')],
            [criterio('corresponde à edição de março','f02','Guia Impresso de Fornecedores'),criterio('revisões mensais de contatos enquanto a assinatura estiver ativa','f02','Diretório Atualizado'),criterio('não inclui negociação ou contratação de fornecedores','f02','assinatura')],
            'Preparar uma comparação para quem precisa de referência da edição de março e para quem precisa de contatos revisados mensalmente. Registrar a modalidade correspondente e uma etapa separada de contato independente com fornecedores, sem enviar pedidos.',
            'A comparação deve atribuir revisão mensal apenas à assinatura ativa e não registrar negociação, pedido ou contratação como serviço do diretório.',
            ['Não foi publicada garantia de resposta ou atualização de cada empresa listada.'],['f03']),
        'Nome de fornecedor e referência de contato não provam mercado transacional; o papel misto vem do produto impresso e serviço de atualização próprios.',
        ['Não tratar empresa listada como executor contratado pela plataforma.','Não prometer atualização do guia impresso ou negociação inclusa.']))
    # VALIDATION 5: beneficiário de empréstimo e voluntário de mutirão seguem percursos diferentes.
    fs=[fonte('f01','Somos uma organização social. O Programa Biblioteca em Casa empresta livros gratuitamente a moradores do município. O Mutirão de Catalogação reúne voluntários para organizar o acervo, sem venda de livros.'),
        fonte('f02','No Programa Biblioteca em Casa, o empréstimo tem prazo de trinta dias e exige cadastro do morador. O Mutirão de Catalogação aceita participação somente nas datas do edital próprio; cadastro de empréstimo não inscreve no mutirão.'),
        fonte('f03','Consultar regras de empréstimo | Ler edital do Mutirão de Catalogação','interface')]
    casos.append(cenario('emprestimo-social-mutirao-separado','validation','social_e_participacao',fs,None,('social',['f01']),[],
        [item('moradores do município','f01',funcao='beneficiario',escopo='Programa Biblioteca em Casa'),item('voluntários','f01',funcao='participante',escopo='Mutirão de Catalogação')],
        [item('Programa Biblioteca em Casa','f01',tipo='programa'),item('Mutirão de Catalogação','f01',tipo='participacao')],
        [criterio('prazo de trinta dias','f02','empréstimo'),criterio('exige cadastro do morador','f02','empréstimo'),criterio('somente nas datas do edital próprio','f02','Mutirão de Catalogação'),criterio('cadastro de empréstimo não inscreve no mutirão','f02','Mutirão de Catalogação')],
        plano('Separar o percurso para tomar livros emprestados do percurso de voluntariado no mutirão.',
            [('Programa Biblioteca em Casa','f01'),('Mutirão de Catalogação','f01')],
            [criterio('prazo de trinta dias','f02','empréstimo'),criterio('exige cadastro do morador','f02','empréstimo'),criterio('somente nas datas do edital próprio','f02','Mutirão de Catalogação')],
            'Montar dois percursos fictícios sem dados pessoais: morador que quer empréstimo e voluntário que quer organizar o acervo. No primeiro, anotar cadastro e prazo de devolução; no segundo, localizar o edital, mantendo a data como desconhecida se não estiver no recorte.',
            'O percurso de empréstimo deve terminar com devolução prevista em trinta dias; o de voluntariado deve depender do edital, sem usar o cadastro de empréstimo como inscrição ou presumir vaga aberta.',
            ['As datas do edital e os documentos do cadastro não foram informados.'],['f03']),
        'A organização social mantém programas/participação, sem transformar empréstimo em venda ou cadastro em vaga de voluntário.',
        ['Não vender livros ou chamar empréstimo de doação.','Não inscrever voluntário pelo cadastro de empréstimo.']))
    # VALIDATION 6: doação recorrente não é assinatura de serviço; destino não é impacto medido.
    fs=[fonte('f01','Somos uma organização social e mantemos duas campanhas de doação: Fundo do Acervo e Apoio Institucional. Pessoas e empresas podem apoiar. Não há compra de produto ou contratação de serviço em nenhuma das campanhas.'),
        fonte('f02','No Fundo do Acervo, a doação é única e destinada à aquisição de livros. No Apoio Institucional, a doação é mensal e apoia despesas gerais da organização. A recorrência pode ser solicitada para encerramento pelo canal de atendimento.'),
        fonte('f03','Ler destinos das campanhas | Falar sobre recorrência','interface')]
    casos.append(cenario('doacao-destino-recorrencia','validation','social_e_participacao',fs,None,('social',['f01']),[],
        [item('Pessoas e empresas','f01',funcao='apoiador',escopo='campanhas de doação')],
        [item('Fundo do Acervo','f01',tipo='captacao'),item('Apoio Institucional','f01',tipo='captacao')],
        [criterio('a doação é única e destinada à aquisição de livros','f02','Fundo do Acervo'),criterio('a doação é mensal e apoia despesas gerais da organização','f02','Apoio Institucional')],
        plano('Distinguir destino e recorrência das campanhas antes de uma intenção de apoio, sem efetuar doação.',
            [('Fundo do Acervo','f02'),('Apoio Institucional','f02')],
            [criterio('a doação é única e destinada à aquisição de livros','f02','Fundo do Acervo'),criterio('a doação é mensal e apoia despesas gerais da organização','f02','Apoio Institucional')],
            'Construir localmente um comparativo de intenção: aquisição de livros com apoio único ou despesas gerais com apoio mensal. Identificar o canal para dúvidas de recorrência e registrar perguntas sobre encerramento; não preencher pagamento, transferir valor ou alterar recorrência.',
            'O comparativo deve associar cada campanha ao destino e periodicidade publicados, sem chamar doação de assinatura de serviço, compra ou garantia de resultado social.',
            ['Não foi informado prazo de processamento do encerramento.','Destinação declarada não comprova resultado social de uma contribuição individual.'],['f03']),
        'Captação e recorrência são explícitas; não inventar assinatura comercial, benefício ao doador ou impacto individual.',
        ['Não converter doação mensal em serviço por assinatura.','Não executar doação ou encerramento real como verificação.']))
    return casos


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if a.saida.exists():raise ValueError('Use um novo arquivo; originais são preservados.')
    cenarios=construir();tarefas=[]
    assert len(cenarios)==12 and {s:sum(c['split']==s for c in cenarios) for s in ('train','validation')}=={'train':6,'validation':6}
    assert len({c['grupoEmpresarial'] for c in cenarios})==12
    for c in cenarios:
        proveniencia={'tipo':'documento_autoral_simulado','publicado':False,'fonteSimulada':True,
            'sha256Texto':hashlib.sha256(json.dumps(c['fontes'],sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()}
        origem={'autorCenarios':'rodada_valor_fontes','tipo':'supervisao_tecnica_experimental','revisaoCruzadaPendente':True,
                'revisaoHumana':False,'revisaoHumanaPendente':True,'autorizacaoUsuarioExperimentoLocal':True,'consentimentoClienteTreino':None}
        comum={'elegivelTreinoExperimental':False,'treinoEfetivoPermitido':False,'revisaoHumana':False,'revisaoHumanaPendente':True,'prontoParaUsoComClientes':False,
               'origemRotulos':origem,'proveniencia':proveniencia}
        c.update(comum)
        for campo in CAMPOS:
            entrada={'tarefa':'entender','campo':campo,'fontes':c['fontes']};saida=c['alvosPorCampo'][campo]
            assert not validar_entrada(entrada),(c['id'],campo,validar_entrada(entrada))
            assert not validar_saida(saida,entrada),(c['id'],campo,validar_saida(saida,entrada))
            tarefas.append({'id':c['id']+'-'+campo,'dominio':c['dominio'],'grupoEmpresarial':c['grupoEmpresarial'],'split':c['split'],
                'familiaTematica':c['familiaTematica'],'natureza':c['natureza'],'entrada':entrada,'esperado':saida,
                'mapaIdsOriginais':{f['id']:f['id'] for f in c['fontes']},**comum})
        entrada={'tarefa':'recomendar','perfil':{campo:c['alvosPorCampo'][campo]['valor'] for campo in CAMPOS},'fontes':c['fontes']}
        assert not validar_saida(c['planejamentoEsperado'],entrada),(c['id'],'recomendar',validar_saida(c['planejamentoEsperado'],entrada))
        tarefas.append({'id':c['id']+'-recomendar','dominio':c['dominio'],'grupoEmpresarial':c['grupoEmpresarial'],'split':c['split'],
            'familiaTematica':c['familiaTematica'],'natureza':c['natureza'],'entrada':entrada,'esperado':c['planejamentoEsperado'],
            'mapaIdsOriginais':{f['id']:f['id'] for f in c['fontes']},**comum})
    result={'versao':'3.2-autoral-sincronizada','geradoEm':datetime.now(timezone.utc).isoformat(),'natureza':'Doze cenários novos autorais DEV, simulados e não publicados; não são capturas reais nem novos TEST.',
        'cenarios':cenarios,'casos':tarefas,'geradorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'autorizacaoUsuarioExperimentoLocal':True,'elegivelTreinoExperimental':False,'revisaoCruzadaPendente':True,'revisaoHumana':False,'revisaoHumanaPendente':True,'prontoParaUsoComClientes':False,
        'particao':{'cenariosTrain':6,'cenariosValidation':6,'tarefasTrain':42,'tarefasValidation':42,'gruposExclusivos':12,
            'semSobreposicaoGrupoEntreSplits':True,'porFamiliaTematica':{tema:{s:sum(c['split']==s and c['familiaTematica']==tema for c in cenarios) for s in ('train','validation')} for tema in ('software_e_servicos','intermediacao_e_atores','social_e_participacao')},
            'limite':'Os três temas abrangentes aparecem nos dois splits; cada mecanismo/cenário possui grupo próprio e todas suas tarefas ficam no mesmo split. Não se trata de TEST ou prova independente de generalização.'},
        'cobertura':{'seisCampos':72,'planejamentos':12,'planejamentosProposta':11,'abstencoesPlanejamento':1},
        'limites':['Somente supervisão técnica experimental autoral; revisão cruzada ainda pendente.','Nenhuma pessoa ou empresa real é representada. Não houve captura, rede, modelo, GPU ou transação.','Todos os alvos devem passar revisão cruzada antes de habilitar treino. Validação continua fora do treino efetivo.','Não altera os96controles autorais anteriores nem os resultados reais0/8,0/4 eVAL12.','TEST12 e seus controles selados não foram lidos.','Exemplos de valores/quantidades pertencem apenas às fontes simuladas, sem promessa de receita, eficácia ou retorno.']}
    a.saida.parent.mkdir(parents=True,exist_ok=True)
    with a.saida.open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
    print(json.dumps({'arquivo':str(a.saida.resolve()),'sha256':hashlib.sha256(a.saida.read_bytes()).hexdigest(),'cenarios':len(cenarios),'tarefas':len(tarefas),'contratosValidos':len(tarefas)},ensure_ascii=False))


if __name__=='__main__':main()
