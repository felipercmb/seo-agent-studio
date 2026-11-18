# Experimento local: comportamento da interface e revisão de evidências

Este experimento investiga o caminho efetivamente usado pelo botão **Analisar com IA**: extração de candidatos, diagnóstico do HTML, preparação dos contextos, escolha do modelo ou de regra explícita e barreiras. Ele é diferente dos ciclos anteriores, nos quais grande parte das perguntas nomeava antecipadamente o assunto a ser respondido. O objetivo comum da interface é genérico e pode chegar com uma busca sem posição, o trecho de origem e um diagnóstico da mesma página.

## Fontes e reserva

Foram definidos 40 domínios públicos antes das requisições. Oito foram destinados ao treino, 13 à validação e 19 ao teste. Responderam com pelo menos uma página 5, 8 e 15 domínios, respectivamente; os demais permanecem nos denominadores como coletas sem evidências. A coleta leu até três páginas por site, sem autenticação, sem contornar bloqueios, sem dados privados e sem consultar resultados do Google. As páginas e registros ficam em `data/`, fora do controle de versão. Os sites visitados e o serviço de DNS recebem naturalmente as requisições de leitura.

Todas as empresas e contraprovas observadas em rodadas anteriores foram incorporadas ao desenvolvimento. Os novos domínios de validação foram usados para avaliar e orientar ajustes; não são uma avaliação independente. O teste de 19 domínios ficou reservado até a seleção do modelo. Há 33 contextos no teste, alguns do mesmo domínio ou sem coleta, portanto não representam 33 empresas independentes. Identidade de domínio não garante por si só que duas empresas não pertençam a um mesmo grupo econômico.

As capturas foram reproduzidas com o relógio definido para o instante após a leitura. Isso permite testar como a interface se comportaria naquele momento, sem renovar artificialmente a data da evidência. Não significa que a página continue igual. Os HTMLs são verificados pelo SHA-256 do arquivo local. O hash confirma a integridade do arquivo em relação ao registro, não é assinatura do site ou validação independente.

Os rótulos são preferências editoriais geradas por regras: por exemplo, diante de um achado observável, revisar a página citada; diante de um termo sem medição, investigar sua demanda. Outras ações podem ser razoáveis, como completar uma coleta de posições antes de investigar a demanda. **A concordância com esses rótulos não mede o impacto de uma recomendação e não substitui avaliação especializada.**

## Coleta de diretivas

O diagnóstico examina meta tags de indexação no HTML inicial, inclusive no corpo, e registra `X-Robots-Tag` quando o servidor o envia. A diretiva `none` é diferente de `none` usado como valor de `max-image-preview`. Para cabeçalhos interpretados como aplicáveis ao Google, o valor normalizado e seu próprio hash são guardados separadamente do hash do HTML. Valores ambíguos são inconclusivos. Cabeçalhos repetidos podem ser mesclados pelo Fetch; o parser não atribui a outros robôs uma diretiva ao Google quando o escopo é ambíguo. Em capturas antigas sem cabeçalho preservado, o resultado é **indisponível**, não a confirmação de ausência.

Isso observa o que foi recebido pela ferramenta; não prova que o Google tenha processado a diretiva, que a página esteja ou não indexada ou que a exclusão seja erro. A regra pede que o responsável confirme a intenção antes de modificar uma diretiva. Referências: [documentação do Google sobre meta tags e cabeçalhos robots](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag) e [orientação sobre noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

## Treinamento e avaliação

O primeiro ajuste usou o modelo local anteriormente disponível e 1.758 mensagens, incluindo casos anteriores, repetições e variações de objetivos. O segundo acrescentou 200 casos sintéticos novos, repetidos três vezes, e 134 exemplos sintéticos antigos repetidos duas vezes. Neles, posições e concorrentes foram **inventados para o teste de comportamento**, inclusive posições além dos primeiros dez resultados; não são evidências sobre empresas reais. O segundo conjunto tem 2.626 mensagens. O treinamento atualiza um adaptador LoRA local e não envia o conteúdo a um serviço de IA.

O [protocolo](../ia/robustez/protocolo-interface.json) define como comparar os checkpoints na validação: escolhas críticas antes e depois das barreiras, recusas, concordância com as preferências e desempenho por tipo. O modelo anterior é preservado em caso de empate. Uma reserva adicional contém 32 contraprovas inteiramente fictícias, incluindo texto de página que tenta dar ordens, posições antigas, posições simuladas além da primeira página, concorrentes e ausência de dados comerciais. O modelo e as regras são contados separadamente. Essas contraprovas não demonstram resultados reais de SEO.

Os registros de experimentos, pesos, capturas, seleções e avaliações ficam em `data/ia/robustez/`. Não sobrescreva um resultado existente. O arquivo `interface-auditada-20261115.jsonl.manifest.json` registra os hashes do código de reprodução e das fontes; o arquivo reproduzido possui o mesmo hash do conjunto de contextos usado no treino.

Na primeira abertura do teste, o ajuste escolhido apresentou uma regressão em cenários fictícios com concorrentes atuais: preferiu atualizar a coleta nos quatro casos em que a versão anterior sugeriu compará-los. Esses casos deixaram de ser teste e passaram ao desenvolvimento. Uma regra identificada na interface passou a sugerir comparação ou acompanhamento quando há captura recente identificada, sem retirar a revisão humana. Uma pergunta explícita sobre uma posição desconhecida ou vencida passa a indicar a verificação da fonte. Se uma posição expira durante a inferência, a resposta é reavaliada antes da apresentação.

Para uma nova avaliação, outros 20 domínios foram reservados antes da coleta; 12 permitiram ler páginas e oito não produziram página legível. Os 37 contextos resultantes incluem os casos indisponíveis. Além disso, foram congelados novos cenários inteiramente fictícios de validação e de teste, incluindo posições simuladas além da primeira página, concorrentes, dados antigos e texto que tenta dar instruções ao modelo. Testes de código verificam também a passagem de uma posição simulada 37 desde a captura até as evidências da interface; não houve consulta real do Google nesse teste.

O terceiro ajuste parte do checkpoint anterior e adiciona, ao treinamento, contraprovas já observadas; são 2.014 mensagens, incluindo repetições. A validação usa também os 19 domínios do teste anterior, agora conhecidos, e não deve ser interpretada como teste independente. Um filtro definido antes do novo teste decide apenas se o ajuste pode aparecer como experimento opcional; o padrão é mantido, e disponibilidade não é aprovação profissional. Casos sem evidências não são encaminhados pela interface ao modelo e não entram no numerador ou denominador de concordância da IA.

### Resultado da nova reserva

O checkpoint selecionado foi o de 120 passos do terceiro ajuste. Depois da seleção, ele e o modelo padrão foram executados nos mesmos dados reservados. Os 29 contextos com evidências vieram de **12 domínios**, e os outros oito domínios não forneceram páginas; contextos de uma mesma empresa não são independentes.

| Medida | Padrão | Ajuste experimental |
| --- | ---: | ---: |
| Concordância com a preferência editorial automática, contextos reais com dados | 1/29 | 28/29 |
| Outras ações aceitas pelas barreiras, contextos reais | 1/29 | 1/29 |
| Sugestões recusadas pelas barreiras, contextos reais | 27/29 | 0/29 |
| Concordância com a preferência editorial, cenários sintéticos com dados | 24/32 | 31/32 |
| Sugestões recusadas pelas barreiras, cenários sintéticos | 8/32 | 0/32 |

No ajuste, uma das 29 escolhas reais veio da regra de diretiva e as outras 28 foram feitas pelo modelo. Nos 32 cenários sintéticos com dados, 20 escolhas vieram de regras e 12 do modelo. O padrão gerou uma escolha crítica antes das barreiras no teste real, que foi bloqueada; o ajuste não gerou nenhuma das escolhas críticas definidas no protocolo nessas amostras. Isso não prova ausência de outros tipos de erro. A alternativa aceita não foi classificada automaticamente como acerto especializado.

Como conferência adicional, uma leitura independente com o parser padrão de Python encontrou a meta `robots` com `noindex, nofollow` no HTML capturado da página pública de política de privacidade de `descomplica.com.br`; o hash do arquivo local coincidiu com o registro. A orientação foi confirmar a intenção, pois uma página de privacidade pode ser deliberadamente excluída. Em outra captura, o parser não encontrou elemento `title` no HTML inicial de `https://www.getninjas.com.br/sobre-nos`; o agente sugeriu revisar a página. A leitura não executa JavaScript, não confirma o estado de indexação nem demonstra que qualquer alteração melhore a posição. Essas conferências foram feitas pelo próprio processo de desenvolvimento, não por especialista independente.

Os resultados `data/ia/robustez/ciclo3-teste-candidato-real.json` e `data/ia/robustez/ciclo3-teste-candidato-sintetico.json`, a seleção e a decisão ficam somente no diretório local ignorado pelo Git. O ajuste passou pelo filtro mecânico de disponibilização e aparece em **Experimentar novo ajuste**; não substitui a opção padrão.

Depois dessa avaliação, a interface passou a mostrar, junto à sugestão, os passos do diagnóstico correspondente quando página, hash, data e trecho coincidem. Para investigar demanda, ela também identifica o termo quando existe uma única correspondência com a página de origem. Acrescentou-se ainda uma barreira: uma recomendação de revisar um problema da página precisa citar um diagnóstico específico; uma frase extraída da página, sozinha, não comprova defeito. Essas alterações foram verificadas por testes próprios e **não foram incluídas nos números da tabela**. A reaplicação das barreiras às 29 escolhas reais e às 32 sintéticas já observadas não mudou os estados dessas escolhas; isso é uma regressão, não um novo teste independente. A versão do código usada na seleção permanece arquivada em `data/ia/robustez/codigo-selecao-final/` com seus hashes.

Quando a pergunta é a padrão da interface e a IA sugere melhorar uma página citando apenas o texto de um termo, uma regra pode propor investigar a demanda se o termo e sua origem recente pertencerem à mesma página. A interface informa que houve substituição por regra, e a resposta mantém a escolha original da IA para auditoria. Sem essa correspondência ou com a evidência vencida, a sugestão permanece bloqueada. A reaplicação desse ajuste às escolhas já observadas também não mudou seus estados; os casos vistos em uso real continuam exigindo avaliação humana.

### Verificação prospectiva do fluxo atual

Para examinar as alterações posteriores, o código, o adaptador e uma lista de outros 20 domínios foram congelados **antes** da coleta. Treze sites retornaram páginas; sete não puderam ser lidos. Houve 35 contextos, dos quais sete não foram encaminhados à IA por falta de dados. Nos 28 restantes, a indicação exibida coincidiu com 27 preferências editoriais automáticas; uma escolha foi recusada por citar uma evidência inadequada. Duas indicações exibidas vieram de regras, incluindo uma que substituiu uma escolha da IA. Não houve escolhas críticas entre as definidas no protocolo, antes ou depois das barreiras, nessa amostra. Esses 28 contextos vêm de 13 domínios e não são observações independentes entre si.

O resultado está em `data/ia/robustez/prospectivo-resultado-20261115.json`. O modelo não foi escolhido nem ajustado usando essa amostra. A comparação avalia apenas o conjunto de condições editoriais definidas pelo projeto; ela não constitui revisão especializada nem mede posições atuais, tráfego ou resultados de negócio. Foi preparada uma cópia verificável para revisão humana em `data/ia/robustez/dataset-prospectivo-revisao/`, sem criar pareceres automaticamente.

### Rodada adicional de 15 de novembro

A amostra prospectiva anterior foi promovida a treinamento: deixou de ser teste. Um ajuste local de 120 passos selecionou o checkpoint 80 na validação. Em uma nova reserva de 20 domínios, preparada sem analisar as escolhas antes da seleção, 11 retornaram páginas. Entre 20 contextos com dados, a versão anterior concordou com 20 preferências editoriais e o novo ajuste com 19, com uma recusa. Os nove contextos sem leitura não foram enviados ao modelo. As indicações incluem decisões por regra e perguntas da mesma empresa são relacionadas; os números não são revisão independente nem medem benefício de SEO.

O novo ajuste **não substituiu a versão anterior**. No caso recusado, a IA citou um diagnóstico como evidência de demanda. Foi acrescentada uma alternativa por regra, explicitamente identificada, que oferece revisão do diagnóstico quando o objetivo é genérico e o ponto observado é recente; uma pergunta específica sobre demanda continua recusada sem fonte adequada. Como essa mudança foi feita depois de examinar a reserva, o resultado anterior não mede seu efeito: é necessário outro conjunto reservado. As posições nesses experimentos continuaram simuladas ou desconhecidas.

Uma nova rodada incorporou a antiga reserva ao treinamento e teve seus checkpoints comparados na validação. Na nova reserva por domínio, 12 dos 20 sites permitiram leitura; as duas versões concordaram com as preferências automáticas em 23 contextos com dados. No ajuste candidato, duas escolhas da IA foram alteradas por regras; a versão anterior não precisou dessas alterações. O ajuste anterior permaneceu disponível. Esses exemplos não incluem posições reais nem substituem julgamento especializado.

Na auditoria da descoberta, um rótulo de contato sobre privacidade do Ubuntu havia sido classificado como serviço. A extração agora mantém rótulos reconhecidos de atendimento como categoria separada e os coloca depois de possíveis ofertas. Na captura pública arquivada, o rótulo em questão passou da 17ª para a 46ª posição entre 46 termos; é um exemplo, não prova de qualidade geral da seleção. A classificação é uma hipótese e termos de atendimento continuam úteis às pessoas.

Uma reserva prospectiva adicional foi definida após o último ajuste: o código e a lista de 20 domínios foram registrados antes das coletas. Doze sites retornaram páginas e oito não produziram evidência suficiente. Nos 25 contextos com dados, a indicação exibida coincidiu com 25 preferências editoriais automáticas; em três deles, a escolha da IA foi alterada por uma regra identificada. Os oito contextos sem dados não foram encaminhados à IA. As observações de um mesmo site são relacionadas e a avaliação não mede impacto de negócios ou qualidade por um especialista. O registro local está em `data/ia/robustez/ciclo6-prospectivo-resultado.json`.

Em conferências com duas ferramentas públicas de busca, os resultados exibidos continham URLs opacas de redirecionamento do Google, sem os domínios de destino. Esses resultados não foram considerados posições ou concorrentes. O conector agora rejeita uma página inteira quando encontra esse tipo de endereço; capturas antigas no cache e entradas ao agente recebem a mesma verificação. A mudança ocorreu após a reserva prospectiva acima, que não continha posições reais do Google.

## Revisão por uma pessoa experiente

Depois da avaliação, um revisor pode abrir um roteiro local sem ver o rótulo editorial automático. O roteiro mostra a pergunta, o que foi observado, a sugestão ou recusa e os caminhos dos HTMLs capturados. As capturas são verificadas antes de mostrar os caminhos. A pessoa pode aprovar, corrigir a ação e as referências, marcar não avaliável ou parar; as anotações são gravadas de forma privada e não alteram o modelo automaticamente.

```sh
.venv-ia/bin/python ia/robustez/revisar.py \
  --dados data/ia/robustez/dataset-prospectivo-revisao \
  --avaliacao data/ia/robustez/dataset-prospectivo-revisao/avaliacao-revisao.json \
  --saida data/ia/robustez/revisao-pessoa-a.jsonl \
  --revisor pessoa-a
```

O identificador é autodeclarado; use um apelido e não inclua dados de clientes ou credenciais nas anotações. Uma segunda pessoa pode produzir outro arquivo e as revisões da mesma avaliação podem ser resumidas sem CSV:

```sh
.venv-ia/bin/python ia/robustez/resumir_revisoes.py \
  data/ia/robustez/revisao-pessoa-a.jsonl \
  data/ia/robustez/revisao-pessoa-b.jsonl \
  --saida data/ia/robustez/resumo-revisoes.json
```

O resumo separa não avaliáveis, correções e concordância entre pessoas, com seus denominadores. Ele não verifica identidade nem experiência dos revisores. Se as anotações do teste forem usadas no treinamento, aquele teste passa a ser desenvolvimento e outro conjunto independente deverá ser reservado antes do próximo ajuste.

## Limites de uso

Sem uma fonte de resultados configurada, o sistema não conhece as posições atuais nem os concorrentes no Google. A presença de um termo no site não mede procura. Sem dados de custos, conversões e valor econômico, ele não identifica desperdício de anúncios nem calcula retorno. Páginas reais e testes sintéticos, por si só, não aprovam o agente para uso autônomo com clientes; para isso é necessária revisão independente das recomendações e validação de resultados em situações reais.
