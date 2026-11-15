# Agente de oportunidades

Esta página descreve o motor de regras da interface. O [piloto de IA com treinamento local](TREINAR-IA.md) é um módulo experimental separado, com adaptação de pesos e avaliação próprias.

O agente ajuda a escolher o próximo trabalho com os dados que o relatório já possui. Ele aproxima três perguntas: quais buscas parecem relacionadas ao site, onde há uma posição observada e o que pode ser revisado na página correspondente.

**Sua saída é uma hipótese de prioridade, não uma promessa de resultado.** O site e uma captura do Google não revelam quantas pessoas procuram aquela palavra, quantas clicam, quantas viram clientes ou quanto vale cada cliente.

## Execução local

O agente aplica regras abertas, reproduzíveis e inspecionáveis no código. Não usa um modelo generativo, não solicita conta de IA, não envia o relatório para um serviço externo e não faz novas consultas ao Google para preparar as sugestões. A descoberta e a consulta de posições continuam sujeitas aos limites descritos na [metodologia](METODOLOGIA.md).

Não é necessário conectar Search Console, Google Ads ou CRM para usar o agente. Sem posições válidas, ele pode organizar hipóteses e indicar o que verificar; não inventa uma classificação atual.

A interface atualiza a análise a partir dos relatórios recebidos. O plano disponível também pode acompanhar a impressão. Gerar o plano não amplia a cobertura: para obter mais evidências, continue a verificação normal do site, sujeita à franquia da fonte.

## Saída e critérios da versão 1

O agente produz **oportunidades por termo**, **frentes agrupadas por URL conhecida** e **melhorias sustentadas pelo diagnóstico**. Uma frente reúne trabalho na mesma página; não é um agrupamento temático feito por um modelo de linguagem. Uma página com mais termos descobertos não tem, por isso, mais demanda ou valor comercial. A etiqueta da frente resume a primeira decisão da fila daquela página; os demais termos podem ter decisões diferentes, disponíveis nos detalhes por busca.

As decisões apoiadas em posição também exigem origem do termo válida e recente. Sem essa origem, o agente mantém a investigação mesmo quando existe posição atual.

| Situação sustentada pelos dados disponíveis | Direção sugerida | Interpretação |
| --- | --- | --- |
| Posição atual entre 4 e 20, com intenção de contratação, serviço ou produto inferida | Priorizar um teste | Há presença observada e uma hipótese de relação com a oferta; o resultado comercial continua desconhecido |
| Posição atual entre 1 e 3, ou busca identificada como de marca | Proteger | Conferir clareza, utilidade e funcionamento; não tratar procura pela marca como nova demanda genérica |
| Posição atual acima de 20, com intenção de contratação, serviço ou produto inferida | Desenvolver | Revisar a adequação da página e do termo; essa distância não mede dificuldade nem comprova ganho maior |
| Captura ausente, vencida ou inconsistente | Investigar | Obter evidência suficiente antes de usar posição para priorizar |

Buscas informativas ou de intenção indefinida acima da terceira posição permanecem em investigação, mesmo com posição confirmada. Elas não são descartadas como sem valor: falta confirmar sua relação com o público e o objetivo do site.

As faixas são **escolhas editoriais do projeto**. O Google não publica essas bandas como regra de oportunidade, e os documentos oficiais citados abaixo não validam essa ordenação. Não há nota de 0 a 100, previsão de CTR ou estimativa de receita.

Para sustentar uma posição atual, todas as páginas que compõem a sequência precisam estar dentro da validade de uma hora e usar contexto compatível. A URL do resultado deve corresponder ao domínio. Evidência de conteúdo com mais de 24 horas reduz a força da prioridade, em vez de ser apresentada como leitura recente.

O agente também confere se uma observação do diagnóstico pertence à URL em análise. Uma regra de acessibilidade ou atendimento observada em outra página não é transferida automaticamente para a página que aparece no Google.

## Como interpretar uma sugestão

Uma sugestão deve ser lida junto de sua base:

- **Observação:** termo, página, posição ou condição que a coleta efetivamente registrou, com origem e data disponíveis.
- **Hipótese:** interpretação do texto da busca ou da relação com o conteúdo. Precisa de confirmação humana.
- **Próxima ação:** revisão delimitada que pode ser feita e conferida.
- **Lacuna:** dado ausente que impede afirmar demanda, facilidade de ganhar posição ou retorno comercial.

Uma posição mais distante do topo não equivale automaticamente a uma oportunidade maior. Uma palavra com expressão de compra também pode não ser relevante para o serviço real. A pessoa responsável deve confirmar a oferta, a região atendida e a capacidade de atender antes de priorizar trabalho.

As regras do projeto organizam a revisão; não reproduzem o algoritmo do Google. Não se deve interpretar uma faixa de posição como probabilidade de sucesso, esforço medido ou volume de tráfego recuperável.

## API local e reutilização

`POST /api/agente`, com corpo JSON `{"site":"example.com"}`, analisa os relatórios já guardados desta instalação. Essa rota não inicia descoberta, diagnóstico, consulta de posições ou visita a concorrentes. Consulte o site pela interface primeiro para produzir a base disponível.

Os relatórios estruturados de posições e diagnóstico, incluindo os trechos necessários à evidência, podem ser mantidos no SQLite local por até sete dias, mas a idade de cada evidência é conferida de novo a cada análise. O HTML integral não é persistido. Presença no banco não significa que uma posição ainda esteja atual. A chave da SerpApi não é necessária para executar o agente sobre uma base já disponível. O histórico mínimo de comparação do navegador é separado; apagá-lo pela interface não remove os relatórios guardados no SQLite.

## O que melhorar

Quando houver evidência correspondente à página, use o diagnóstico para conferir o problema descrito e verificar sua correção. Uma observação feita em outra URL não comprova um defeito na página que aparece na busca.

Para o conteúdo, revise se a página responde à necessidade expressa pelo termo, explica a oferta real e permite que a pessoa encontre o próximo passo. Títulos devem descrever o conteúdo com clareza. Essas orientações são coerentes com o [guia de SEO do Google](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), que não promete primeira posição.

Não crie páginas em massa apenas para ocupar palavras. A recomendação é melhorar a resposta para o público que o site atende, de acordo com a orientação de [conteúdo útil e voltado às pessoas](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).

Os sites vistos antes do domínio podem ajudar uma comparação manual de utilidade, clareza e oferta. O agente não leu necessariamente suas páginas e não sabe por que o Google os ordenou dessa forma. Título, comprimento do texto, dados estruturados ou acessibilidade isolados não explicam a diferença de posição.

Dados estruturados corretos não garantem nem a exibição de um resultado enriquecido, conforme as [políticas oficiais do Google](https://developers.google.com/search/docs/appearance/structured-data/sd-policies). Melhorias de acessibilidade devem servir às pessoas; este produto não as transforma em promessa de ganho no ranking.

## Como verificar se houve resultado

Escolha uma hipótese e registre a página, o termo, a alteração e a data. Depois da mudança, compare novas observações no mesmo país, idioma e dispositivo, mantendo a distinção entre captura e média. Uma variação isolada de posição não comprova que a alteração foi sua causa.

Se o proprietário já tiver dados de desempenho, consulte-os no sistema que usa, sem obrigação de conectá-lo a este aplicativo:

| Pergunta | Medida útil | Limite |
| --- | --- | --- |
| A página passou a receber mais visitas da busca? | Cliques orgânicos da página em períodos comparáveis | Uma mudança pode coincidir com sazonalidade ou outras ações |
| As exibições passaram a gerar mais cliques? | CTR observado: cliques divididos por impressões, no mesmo recorte | Não aplicar uma curva genérica de CTR à posição de uma captura |
| As visitas ajudaram o negócio? | Pedidos ou contatos qualificados atribuíveis à página, quando houver registro confiável | Contato ou visita não equivale a venda; não atribuir uma venda a uma palavra sem evidência |

O [Search Console define impressões, cliques, CTR e posição média](https://support.google.com/webmasters/answer/7042828?hl=pt-BR). A posição média agrega observações de usuários; ela não é a posição de uma captura pontual deste aplicativo.

Defina o que é um contato qualificado antes de comparar períodos. Preserve a qualidade do atendimento e o uso acessível da página como critérios de avaliação. O agente não preenche medidas ausentes com zero, não estima receita e não informa orçamento de anúncios a partir desses dados.

## Limites da primeira versão

As sugestões dependem da cobertura parcial do site e das buscas efetivamente verificadas. Conteúdo carregado por JavaScript, páginas não lidas e consultas não selecionadas podem ficar fora. Dados antigos, falhas de coleta e falta de posição devem reduzir a força da conclusão.

Os testes do projeto verificam o comportamento das regras em cenários controlados. Eles não são um estudo de eficácia de SEO nem uma validação de aumento de vendas. O ganho de um trabalho específico precisa ser observado depois, com dados adequados e contexto comparável.
