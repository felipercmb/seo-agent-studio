# Visibilidade Aberta

[![Testes](https://github.com/felipercmb/visibilidade-aberta/actions/workflows/ci.yml/badge.svg)](https://github.com/felipercmb/visibilidade-aberta/actions/workflows/ci.yml)

Descubra termos relacionados a um site, confira resultados do Google e encontre melhorias de acessibilidade e atendimento. O aplicativo roda no seu computador, com código aberto, relatórios e controle de uso guardados localmente.

**Comece informando apenas um domínio.** A descoberta de termos e o diagnóstico das páginas funcionam sem chave de API. A verificação de posições no Google é opcional e exige uma chave própria do plano gratuito da SerpApi.

[English](README.en.md) · [Metodologia](docs/METODOLOGIA.md) · [Agente de oportunidades](docs/AGENTE.md) · [Ativar posições](docs/ATIVAR-POSICOES.md)

## Executar

Instale o [Node.js](https://nodejs.org/) **22, a partir da versão 22.13, ou 24 LTS**. Essas são as linhas suportadas; outras versões principais não fazem parte da compatibilidade declarada. Você também precisa do Git para clonar o repositório.

```sh
git clone https://github.com/felipercmb/visibilidade-aberta.git
cd visibilidade-aberta
npm ci
npm start
```

Abra [http://localhost:8794](http://localhost:8794). Encerre com `Ctrl+C` no terminal.

Não há etapa de build, conta de hospedagem ou servidor de banco para configurar. O servidor escuta somente em `127.0.0.1`. Na primeira execução, cria o banco SQLite em `data/visibilidade.sqlite` e aplica as migrações automaticamente.

## O que você recebe

| Função | Sem chave | Com chave gratuita compatível |
| --- | --- | --- |
| Descoberta de até 100 termos em até 12 páginas públicas | Sim | Sim |
| Origem e evidência dos termos encontrados | Sim | Sim |
| Até três ações de melhoria, com orientações | Sim | Sim |
| Comparação de leituras do diagnóstico | Sim | Sim |
| Agente local que organiza oportunidades e próximos passos | Hipóteses a investigar | Usa também as posições válidas disponíveis |
| Verificação das posições e dos resultados anteriores ao site | Indisponível | Dentro dos limites de consulta |
| Impressão ou PDF dos dados carregados | Sim | Sim |

Os termos descobertos são **candidatos para verificação**. Não comprovam que alguém pesquise por eles ou que o site apareça no Google. Uma busca só recebe posição quando existe uma captura válida da fonte.

A verificação percorre até cinco páginas do Google por termo, em etapas de até quatro páginas. Você acompanha o andamento e pode pausar ou continuar. Ocultar ou fechar a página interrompe o avanço automático; uma etapa já enviada pode terminar. Não há monitoramento agendado.

## Do relatório ao próximo passo

O **agente de oportunidades** cruza os termos, as posições disponíveis e o diagnóstico para organizar o que investigar e melhorar. Ele explica a evidência, a regra usada e o que falta medir. Uma posição promissora indica uma hipótese de trabalho; não comprova que aquela palavra trará mais vendas.

O agente é um mecanismo de regras aberto e executado localmente. Não usa um modelo generativo, não envia relatórios a uma IA externa e não faz novas buscas no Google para gerar a análise. Sem uma captura válida, mantém a oportunidade como investigação. Consulte [os critérios e limites](docs/AGENTE.md).

## Ativar o Google, se quiser

Crie sua própria conta gratuita na SerpApi e obtenha uma chave. Quem usa a interface não precisa de cadastro; quem executa o aplicativo precisa configurar a conta da fonte para consultar posições.

Copie o arquivo de exemplo, caso ainda não tenha um `.env`:

```sh
cp .env.example .env
```

No PowerShell:

```powershell
Copy-Item .env.example .env
```

Edite `.env` e preencha `SERPAPI_KEY`. Deixe a chave vazia se quiser usar apenas descoberta e diagnóstico. Reinicie o servidor após mudar a configuração. O [guia de ativação](docs/ATIVAR-POSICOES.md) explica o plano aceito, os limites e as mensagens de indisponibilidade.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `SERPAPI_KEY` | Vazia | Ativa a fonte de posições quando a conta é compatível |
| `PORT` | `8794` | Porta local do aplicativo |
| `DATA_DIR` | Pasta `data` do projeto | Diretório do banco SQLite |

## Limites e interpretação

O código padrão aceita apenas o plano gratuito compatível da fonte e recusa planos pagos ou créditos extras. Além do saldo da conta, esta instalação limita novas consultas a **200 por mês, 40 por hora e 20 páginas do Google por domínio em 24 horas**. Os contadores ficam no SQLite desta instalação. Outras instalações não compartilham esse banco; usos da mesma chave continuam sujeitos à cota da conta na SerpApi.

O progresso pode ser reutilizado por até sete dias. Uma captura de resultados só confirma uma posição atual durante sua validade de uma hora. Cada página mantém fonte, horário, contexto e identificador da evidência. Veja a [metodologia](docs/METODOLOGIA.md) para entender a posição por deslocamento, as leituras parciais e os termos pendentes.

O aplicativo não descobre todas as palavras de um domínio, não garante posição e não mede receita, vendas ou desperdício de anúncios. A análise de acessibilidade é uma triagem do HTML inicial; verificações com pessoas continuam necessárias.

## Dados e desenvolvimento

Executar localmente não significa operar offline. A coleta consulta DNS externo (Google/Cloudflare) e o resolvedor do sistema, além de acessar o site informado. Com a fonte ativada, os termos e o contexto de busca são enviados à SerpApi, usando a chave para autenticação. Esses serviços podem registrar as requisições conforme suas políticas.

A chave fica na configuração local e não deve ser compartilhada. O SQLite contém progresso, capturas estruturadas, controle de uso e relatórios estruturados do diagnóstico usados pelo agente. Esses relatórios e seus trechos de evidência podem ser reutilizados por até sete dias, com nova conferência da idade ao analisar; o HTML integral não é persistido. O histórico mínimo de comparação do diagnóstico fica no navegador e pode ser apagado pela interface. Apagar esse histórico do navegador não apaga o banco local. Não publique `.env`, `data/` ou relatórios com informações que você não queira compartilhar.

Para conferir o projeto:

```sh
npm test
npm run check
```

Os testes usam respostas controladas, sem chaves reais ou consultas pagas. Eles não comprovam cobertura ou precisão de uma conta real da SerpApi. Esta versão não apresenta um benchmark validado de posições reais.

Contribuições são bem-vindas: leia [CONTRIBUTING.md](CONTRIBUTING.md). Para problemas de segurança, siga [SECURITY.md](SECURITY.md).

## Licença

[MIT](LICENSE). Você pode estudar, modificar e distribuir o código conforme a licença. A licença do aplicativo não substitui os termos de uso dos sites consultados ou do fornecedor de resultados.
