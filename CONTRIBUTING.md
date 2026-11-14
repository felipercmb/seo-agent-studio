# Como contribuir

Obrigado por ajudar a tornar análises de busca mais úteis e verificáveis. O objetivo é manter uma aplicação local simples, com evidências compreensíveis e limites explícitos.

## Preparar o ambiente

Use Node.js 22, a partir de 22.13, ou 24 LTS. Outras versões principais não fazem parte da compatibilidade declarada.

```sh
npm ci
npm start
```

Não é necessário configurar `SERPAPI_KEY` para desenvolver. Use respostas controladas nos testes; o diagnóstico de páginas e a descoberta funcionam sem essa chave.

Antes de enviar uma alteração:

```sh
npm test
npm run check
```

Os testes precisam funcionar sem uma conta real de serviços externos. A matriz de CI cobre as linhas 22 e 24 em Windows, macOS e Linux; ao alterar arquivos, rede ou SQLite, considere caminhos, encerramento de conexões e bloqueio de arquivos nesses sistemas.

## Propor uma mudança

Abra uma issue com o problema observado e o comportamento esperado, ou envie uma pull request com uma mudança delimitada. Explique o efeito para quem usa a ferramenta e como você o verificou.

Inclua, quando relevante:

- Passos de reprodução e versões de Node.js e sistema operacional.
- Um exemplo sintético que demonstre o problema sem dados de clientes.
- Testes para falhas de rede, resultados parciais, paginação e estados sem evidência.
- Atualização da metodologia quando mudar o significado de um número ou estado.

Não é preciso criar testes que apenas repitam a implementação. Proteja os comportamentos que podem produzir conclusões incorretas: ausência de cobertura, posições de páginas diferentes, dados vencidos, erros da fonte e limites de consumo.

## Cuidados com dados e chamadas externas

Nunca adicione chaves, `.env`, bancos locais, logs privados ou relatórios de clientes ao Git. Use domínios reservados e respostas sintéticas nas fixtures. Não copie uma resposta real que contenha credenciais ou identificadores privados.

Testes e CI não devem realizar buscas reais na SerpApi, consumir créditos ou depender de páginas da internet. Injete o transporte, relógio e armazenamento necessários. Uma mudança no conector não deve habilitar planos pagos, créditos extras ou chamadas ilimitadas silenciosamente.

Mantenha os limites por tempo, páginas e tamanho de resposta. Preserve a validação de destino e a conexão ao IP público previamente verificado no transporte local. Não substitua esses controles por um `fetch` genérico para endereços informados por visitantes.

## Texto e interface

O português é o idioma principal da interface. Use frases simples e diferencie termo candidato, busca pendente, observação confirmada e dado indisponível. O texto em inglês deve continuar suficiente para instalar e compreender o projeto.

Uma melhora no diagnóstico automático não é uma certificação de acessibilidade. Uma posição observada não é prova de receita ou de impacto social. Não adicione métricas, selos ou demonstrações que pareçam resultados reais sem evidência correspondente.

Para vulnerabilidades, use o procedimento de [SECURITY.md](SECURITY.md), evitando detalhes sensíveis em issues públicas.
