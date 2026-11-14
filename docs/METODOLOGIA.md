# Metodologia e limites

Visibilidade Aberta separa três tipos de informação: o que leu no site, os termos que selecionou para investigar e o que observou em páginas de resultados do Google. Essa separação impede que uma sugestão seja apresentada como uma posição confirmada.

## 1. Entrada e leitura do site

O usuário informa um domínio público. O endereço é normalizado; dados de acesso, endereços locais e destinos fora do escopo são rejeitados. A coleta usa HTTPS e admite o domínio e sua variante `www`, com validação dos redirecionamentos. Uma tentativa em `www` não serve para contornar uma proibição explícita de leitura.

No transporte local, o DNS é resolvido e os IPs são verificados. A conexão é fixada a um endereço público aprovado, mantendo a validação TLS pelo nome do site. Isso evita a lacuna entre verificar um endereço e resolver outro na hora de conectar. Cada novo destino segue a mesma validação.

A execução é local, mas a leitura usa a internet. A checagem prévia consulta DNS sobre HTTPS do Google/Cloudflare, além da resolução usada pelo transporte local. Os resolvedores podem receber o domínio consultado; o site recebe as requisições de leitura. A SerpApi recebe os termos e o contexto quando a verificação de posições está ativada.

A leitura respeita `robots.txt`. Ela pode usar links das páginas e sitemaps públicos para selecionar conteúdo, sem executar JavaScript, preencher formulários ou entrar em áreas autenticadas. Falhas, desafios antibot e respostas sem conteúdo adequado reduzem a cobertura; não são provas de defeito no site.

| Limite de descoberta | Padrão |
| --- | --- |
| Páginas públicas | Até 12 |
| Termos candidatos | Até 100 |
| Orçamento total de leitura | Até 4 MiB, aproximadamente 4 MB |
| Corpo de uma página HTML | Até 1 MiB |
| Tempo da coleta | Até 20 segundos |

Há também limites de requisições, redirecionamentos e sitemaps. Portanto, um site pode ter menos de 12 páginas lidas mesmo quando contém muitas outras. `Descoberta parcial` pode significar uma falha ou um limite: o relatório não presume qual ocorreu sem evidência.

## 2. Descoberta de termos

Regras extraem candidatos de elementos como título, cabeçalhos, conteúdo e dados estruturados. Eles podem representar marca, serviço, produto, localidade ou nomes declarados no conteúdo. Um nome publicado em um catálogo mantém seu contexto; sua descoberta não comprova procura pelo público.

Cada candidato preserva a evidência disponível: página, campo, trecho, data e identificador do conteúdo. Buscas relacionadas que a fonte retornar também podem entrar como candidatos, com o termo de origem e o identificador da consulta. Essa expansão é limitada a uma geração e filtrada pela relação com o termo original.

Nenhuma dessas regras identifica todas as palavras para as quais o domínio aparece no Google. Elas também não fornecem volume de busca, impressões ou importância comercial comprovada.

Uma releitura pode falhar. Nesse caso, candidatos anteriores podem continuar disponíveis, com suas datas originais e um aviso. A data de geração do relatório não substitui a data da evidência.

## 3. Verificação no Google

A SerpApi fornece as páginas de resultados. O operador configura sua própria chave; não é necessário conectar Search Console, Google Ads ou contas do proprietário do site.

O contexto padrão é Google Brasil, idioma português, computador e localidade Brasil. Uma palavra contendo o nome de uma cidade não transforma esse contexto em uma medição feita naquela cidade.

Cada termo pode percorrer até cinco páginas, seguindo a continuação validada da fonte. A quantidade real de resultados varia. O código verifica contexto, consulta, data, ordem dos resultados e paginação antes de atribuir posição.

A leitura avança em etapas de até quatro páginas do Google. A primeira requisição pode apenas descobrir ou recuperar termos. A interface pode executar até seis etapas por sequência, incluindo a inicial, com intervalo de pelo menos três segundos. Você pode pausar e continuar; não há monitoramento em segundo plano. Ocultar ou fechar a página interrompe novas etapas, embora uma requisição já enviada possa terminar.

O domínio e seus subdomínios são considerados ao localizar o site nos resultados. O relatório mantém a URL observada para permitir conferência.

## 4. O significado da posição

A posição registrada é calculada assim:

```text
posição registrada = deslocamento confirmado da página + posição dentro da página
```

Por exemplo, se a fonte confirmar deslocamento 10 e o domínio estiver no terceiro resultado daquela página, a posição registrada será 13. Esse é um exemplo de cálculo, não um resultado real de um site.

O relatório conserva separadamente página, deslocamento e posição dentro da página. Não supõe que toda página contenha dez resultados nem renumera posições depois de remover duplicações.

Páginas são capturas separadas e podem ter horários diferentes. Os sites registrados antes do resultado do domínio mantêm a data e a fonte da página correspondente. A posição não é universal, personalizada ou garantida para outra pessoa.

| Estado | Interpretação |
| --- | --- |
| Termo candidato | Selecionado para investigar; não comprova posição |
| Pendente | Ainda há trabalho de verificação por fazer |
| Encontrado | O domínio apareceu em uma captura válida |
| Não observado | O domínio não apareceu nas páginas efetivamente lidas |
| Indisponível | Não houve evidência válida suficiente para atribuir posição |
| Leitura interrompida | O recorte pode estar incompleto; veja o motivo e as páginas preservadas |

Ausência em um recorte não comprova ausência no Google. Uma paginação inconsistente, página repetida, falha da fonte ou cota encerrada não deve se transformar em uma posição estimada.

## 5. Evidências, validade e armazenamento

Capturas do Google preservam o identificador da fonte, horário, contexto, resultados e hash SHA-256 do conjunto estruturado validado. O hash permite identificar esse conjunto de dados; não é uma assinatura do Google nem uma comprovação independente de veracidade.

Uma captura só é tratada como atual durante uma hora. Quando uma página de uma sequência vence, a sequência deixa de confirmar uma posição atual: o sistema não junta uma página recente com outra vencida para apresentar uma nova posição.

O progresso é reutilizado por até sete dias no SQLite local. A descoberta pode ser relida após seu prazo próprio, separadamente da validade das posições. Expiração de uso não significa eliminação segura imediata do arquivo em disco.

Os dados estruturados e trechos necessários à evidência podem ficar no banco. O HTML integral é usado temporariamente na coleta e não compõe o relatório persistido. A chave da fonte permanece na configuração do operador.

## 6. Consumo gratuito

O padrão verifica se a conta da fonte é gratuita e compatível antes de uma busca. Planos pagos, créditos extras e configurações desconhecidas são recusados.

Esta instalação aplica limites adicionais:

- 200 novas consultas no mês UTC.
- 40 novas consultas em uma janela de uma hora.
- 20 novas páginas do Google por domínio em 24 horas.

Uma página consultada pode consumir uma chamada da fonte; cinco páginas de uma palavra não equivalem necessariamente a uma única chamada. O saldo da conta também precisa permitir a consulta.

A reserva de consumo é registrada antes da chamada. Falhas ou timeouts podem manter essa reserva, porque a fonte pode ter processado a requisição. Por isso, o contador local pode ser mais conservador que o painel da SerpApi.

Os limites são coordenados pelo SQLite desta instalação, não entre computadores independentes. Usar a mesma chave em outro programa pode consumir o saldo da conta fora desses contadores. O sistema para quando não consegue confirmar saldo ou controle; não muda automaticamente para uma fonte paga.

## 7. Diagnóstico de melhorias

A análise de páginas entrega até três ações, ordenadas por regras de utilidade e possibilidade de correção. Cada observação distingue evidência automática de conferência manual. A coleta específica do diagnóstico é limitada; o relatório informa as páginas efetivamente analisadas.

A leitura do HTML pode identificar, por exemplo, atributos de idioma, títulos ou controles sem identificação reconhecível. Ela não confirma sozinha contraste visual, funcionamento completo de formulários, compreensão de conteúdo ou acessibilidade de uma aplicação executada no navegador.

A comparação entre leituras só trata uma observação anterior como não encontrada novamente quando a mesma regra foi verificada em um conjunto equivalente de páginas, com leituras completas. Cobertura parcial, regra ausente ou mudança de páginas tornam a comparação inconclusiva. A referência mínima fica no navegador.

Essa triagem não é uma certificação de acessibilidade. O [W3C explica a necessidade de avaliação humana](https://www.w3.org/WAI/test-evaluate/).

## 8. O que não medimos

O aplicativo não calcula vendas, lucro, retorno de anúncios, desperdício de orçamento ou impacto social comprovado. Essas conclusões exigem outros dados e um método de avaliação próprio.

Os testes automatizados usam cenários controlados de extração, validação, limites e falhas. Eles não constituem um benchmark de cobertura do Google ou uma validação pública de posições reais desta versão.

Referências: [resultados orgânicos da SerpApi](https://serpapi.com/organic-results), [paginação da SerpApi](https://serpapi.com/pagination) e [avaliação de acessibilidade do W3C](https://www.w3.org/WAI/test-evaluate/).
