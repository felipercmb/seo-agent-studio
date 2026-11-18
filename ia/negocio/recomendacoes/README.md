# Recomendações de negócio com evidências — experimento local

Este diretório inicia uma tarefa diferente do antigo classificador de dez ações. O modelo recebe um perfil compacto revisado (ou oracle explicitamente marcado no ensaio) e até dezesseis trechos públicos. Precisa propor uma decisão que ajude a escolher, contratar, participar ou esclarecer uma condição. A proposta continua hipótese.

O corpus real novo ficará na pasta da rodada de treinamento, sem modificar as cinco filas antigas que têm `prontoParaTreino=false`. A seleção de fontes oracle é uma ajuda técnica conhecida no desenvolvimento, não prova de recuperação autônoma. Os resultados históricos 0/8 e 0/4 pertencem a seus snapshots e permanecem intactos.

## O que torna o exemplo útil

- U1: a decisão corresponde ao objeto, papel e limites reais do negócio. Um módulo de RH não vira escola; prestadores e compradores não são o mesmo público.
- U2: a escolha depende de uma diferença, condição, relação entre programa/unidade ou etapa publicamente sustentada. Nome de marca, slogan e botão isolado não bastam.
- U3: a ação explica como comparar ou encaminhar aquela necessidade usando os fatos concretos. Trocar o nome em uma ficha vazia não passa. Quando a fonte é insuficiente, o alvo correto é abster.
- U4: a conferência produz um registro observável e preserva desconhecidos. Não promete posição, vendas, lucro, disponibilidade, elegibilidade, exclusividade ou alteração de campanhas.

Alternativas e critérios são trechos literais. A ação pode explicar o teste, mas não pode inventar uma condição para torná-lo interessante. A conferência identifica o que a pessoa conseguiu escolher e qual dúvida continua pendente; não é uma conversão fictícia.

## Contraexemplos

Um botão “Comprar” não prova que a empresa fabrica o produto ou que uma compra foi concluída. “Mais procurado” não prova mais resultado comercial. Tecnologia anunciada para uma marca não se aplica automaticamente a todo modelo. Cortesia de hóspedes não vira contratação avulsa. Programa social não equivale a inscrição aberta. História de voluntariado não prova uma vaga de voluntário atual. Texto de HTML pode estar desatualizado ou pertencer a um painel cuja renderização ainda não foi conferida.

Quando não houver uma condição ou diferença adequada, a saída é `insuficiente`, com strings e listas vazias e as informações faltantes em `incertezas`. Não inventar uma segunda alternativa apenas para preencher o formato.

## Validação e política

`validar.mjs` verifica limites, chaves, referências e spans literais, inclusive escopo. Interfaces podem sustentar um rótulo/percurso; não comprovam condições de negócio. JSON com chaves repetidas, Markdown ou conteúdo adicional é recusado. Essa validação não classifica utilidade semântica U1–U4.

`politica.mjs` classifica a saída como bloqueada, abstenção ou revisão pendente. Nunca executa ação nem transforma a revisão técnica do agente em confirmação humana. Não tem dependência do aplicativo antigo, de rede, serviços pagos ou modelos externos.

Rode os controles locais com `node --test ia/negocio/recomendacoes/test-*.mjs`. Revisões cruzadas e hashes do corpus ficam nos artefatos da rodada. Dados sintéticos são identificados; correções humanas e autorização de treino não são presumidas.

## Curadoria e reprodutibilidade

`alvos-manuais.mjs` registra anotações dos casos conhecidos para preparar o corpus. O `switch` por domínio é uma forma de escrever esses rótulos de desenvolvimento; ele não é um mecanismo de recomendação do produto e recusa casos sem anotação. Esse arquivo não é importado pelo aplicativo. O módulo de validação e a política não têm regras por empresa.

`montar-corpus.mjs` combina fontes, valores Oracle dos seis campos e anotações em um arquivo novo. Confere hashes das capturas/HTML, URL, data e presença dos trechos no HTML ou metadados; essa conferência não testa CSS/JS nem atualidade do anúncio. Registros antigos com HTML separado são hidratados localmente, preservando seus arquivos. Use `--controles nao` nos lotes adicionais para evitar duplicatas dos mesmos controles.

A aprovação técnica cruzada permite marcar uma cópia nova como elegível ao experimento local já autorizado. Ela mantém `prontoParaUsoComClientes=false`, revisão humana pendente e consentimento da empresa não presumido. Não mudar os rótulos ou as filas históricas para anunciar melhoria sobre testes já expostos.

`comparar-contratos.mjs` confere o mesmo corpus contra os validadores Node e Python e salva hashes e divergências. A paridade é verificável e independe do treinamento; ela não mede a qualidade semântica das respostas do modelo.
