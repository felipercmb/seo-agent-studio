# Visibilidade Aberta

[![Testes](https://github.com/felipercmb/visibilidade-aberta/actions/workflows/ci.yml/badge.svg)](https://github.com/felipercmb/visibilidade-aberta/actions/workflows/ci.yml)

Descubra termos relacionados a um site, confira resultados do Google e encontre melhorias de acessibilidade e atendimento. O aplicativo roda no seu computador, com código aberto, relatórios e controle de uso guardados localmente.

**Comece informando apenas um domínio.** A descoberta de termos e o diagnóstico das páginas funcionam sem chave de API. Para conferir resultados, há uma [captura assistida no navegador](docs/GOOGLE-LOCAL.md), sem conta de fornecedor, e um conector opcional de posições com chave própria da SerpApi. A captura assistida mostra a ordem reconhecida na página aberta; não representa uma posição absoluta no Google.

[English](README.en.md) · [Metodologia](docs/METODOLOGIA.md) · [Agente de oportunidades](docs/AGENTE.md) · [Treinar IA local](docs/TREINAR-IA.md) · [Captura no navegador](docs/GOOGLE-LOCAL.md) · [Ativar posições](docs/ATIVAR-POSICOES.md)

## Executar

Baixe o [ZIP da revisão r4.3.3](https://github.com/felipercmb/visibilidade-aberta/releases/tag/r4.3.3), extraia o arquivo e siga [Comece aqui](COMECE-AQUI.md).
O pacote contém as dependências fixadas no arquivo de lock e funciona sem instalação pelo npm.
Para montá-lo a partir desta pasta de trabalho, use `python3 scripts/empacotar-local.py --saida dist/visibilidade-aberta-local.zip` com as dependências presentes no cache do npm.

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

A nova [análise por módulos](docs/MODULOS.md) está em
[http://localhost:8794/projeto](http://localhost:8794/projeto): revise o perfil
do negócio, descubra palavras, peça medições, avalie oportunidades e acompanhe
o histórico. Premissas de contribuição por venda e fechamento são opcionais.
O fluxo funciona localmente sem cadastro e distingue hipóteses de dados medidos.

O [novo módulo de capturas Google](docs/GOOGLE-LOCAL.md) oferece uma extensão
local para Chrome/Edge, importação de JSON, evidência com data e contexto e links
anteriores ao alvo na mesma página. Ele opera por ação da pessoa, sem consultar
automaticamente o Google. O guia está em [http://localhost:8794/google-local](http://localhost:8794/google-local).
Na versão 0.2 da extensão, um código temporário permite enviar a captura
diretamente ao aplicativo local. As páginas são agrupadas pela consulta e pelos
links de continuação preservados, com lacunas e repetições explícitas.
Quando a página exibe o domínio e conserva um redirecionamento opaco, a
captura registra o bloco observado e mantém o destino como desconhecido.

O [fluxo integrado local](docs/USO-LOCAL-INTEGRADO.md) acrescenta papéis editáveis
por oferta (quem contrata, executa, usa e paga), três prioridades de trabalho e
registro de execução e verificação. As premissas comerciais têm origem, período,
população de contatos, contagens e faixas; o cenário fica separado das palavras.
O novo leitor Qwen3.5-4B é opcional e experimental no Mac com Apple Silicon:
propõe uma oferta com fontes, sem sobrescrever ou confirmar o perfil.
Use `npm run diagnosticar` para conferir a instalação sem consultar serviços nem
carregar o modelo. Esse diagnóstico não aprova a qualidade da IA.

A [arquitetura integrada](docs/ARQUITETURA-LOCAL-INTEGRADA.md) descreve os
contratos entre coleta, perfil, medição, prioridades e tarefas. Nesta revisão,
as fichas ligam papéis, prazos e condições aos trechos publicados e pedem
conferência quando o alcance fica em aberto. O histórico conserva as fontes
usadas em cada ação. Os leitores de IA seguem experimentais e requerem
revisão humana.

| Função | Sem chave | Com chave gratuita compatível |
| --- | --- | --- |
| Descoberta de até 100 termos em até 12 páginas públicas | Sim | Sim |
| Origem e evidência dos termos encontrados | Sim | Sim |
| Até três ações de melhoria, com orientações | Sim | Sim |
| Comparação de leituras do diagnóstico | Sim | Sim |
| Agente local que organiza oportunidades e próximos passos | Hipóteses a investigar | Usa também as posições válidas disponíveis |
| Captura assistida de links de uma página Google aberta | Sim, por clique e importação | Sim |
| Verificação de posições pelo conector de resultados | Indisponível | Dentro dos limites de consulta |
| Impressão ou PDF dos dados carregados | Sim | Sim |

Os termos descobertos são **candidatos para verificação**. Não comprovam que alguém pesquise por eles ou que o site apareça no Google. Uma busca só recebe posição do conector quando existe uma captura válida da fonte. A captura assistida fica separada e nunca converte deslocamento de página em posição absoluta.

O conector opcional percorre até cinco páginas do Google por termo, em etapas de até quatro páginas. Você acompanha o andamento e pode pausar ou continuar. Ocultar ou fechar a página interrompe o avanço automático; uma etapa já enviada pode terminar. A captura assistida depende de abrir e capturar cada página. Não há monitoramento agendado.

## Do relatório ao próximo passo

O **agente de oportunidades** cruza os termos, as posições disponíveis e o diagnóstico para organizar o que investigar e melhorar. Ele explica a evidência, a regra usada e o que falta medir. Uma posição promissora indica uma hipótese de trabalho; não comprova que aquela palavra trará mais vendas.

O agente é um mecanismo de regras aberto e executado localmente. Não usa um modelo generativo, não envia relatórios a uma IA externa e não faz novas buscas no Google para gerar a análise. Sem uma captura válida, mantém a oportunidade como investigação. Consulte [os critérios e limites](docs/AGENTE.md).

Há também um **piloto de IA treinável localmente**: ajusta Qwen2.5-1.5B com QLoRA e pode analisar até três contextos do relatório. Quando o modelo, o ambiente e uma seleção local estiverem instalados, a opção experimental aparece na interface. Foram usados casos sintéticos e capturas públicas para um experimento local, com rótulos técnicos sem revisão especializada; as sugestões precisam de revisão humana. O primeiro backend de treino usa Mac com Apple Silicon. Consulte [instalação, treinamento e avaliação](docs/TREINAR-IA.md) e os [experimentos com páginas reais](docs/EXPERIMENTOS-REAIS.md).

A [segunda rodada local](docs/EXPERIMENTOS-IA-V2.md) acrescenta cenários de prudência, respostas estruturadas e um experimento para comparar oportunidades sem apresentar posições como previsão de receita.

A [terceira rodada](docs/EXPERIMENTOS-IA-V3.md) trabalha explicitamente a diferença entre uma exclusão de indexação deliberada, desconhecida ou indevida, com novos casos reservados.

O [relatório dos treinamentos locais](ia/resultados/treinos-2026-11-14/README.md) reúne resultados, contraprovas e limitações das rodadas adicionais.

O [experimento de robustez](docs/EXPERIMENTOS-ROBUSTEZ.md) reproduz o fluxo real da interface e inclui um processo local para revisão humana das evidências e recomendações.

O primeiro treino completou apenas **3 de 16 casos em todos os critérios mecânicos**. Ainda não está pronto para recomendações autônomas a clientes; [os resultados e falhas estão publicados](ia/resultados/piloto-v1/README.md).

## Ativar o Google, se quiser

Para conferir uma página já aberta sem chave de API, use o [guia de captura assistida](docs/GOOGLE-LOCAL.md). Esse caminho não ativa buscas automáticas nem a fonte de posições do conector.

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

A chave fica na configuração local e não deve ser compartilhada. O SQLite contém progresso, perfis, premissas declaradas, tarefas e relatórios estruturados. No fluxo modular, a captura pública completa, incluindo HTML, e os artefatos do entendimento são preservados em `DATA_DIR/evidencias-negocio/capturas` e `DATA_DIR/evidencias-negocio/execucoes` para permitir reprodução. Os trechos importados do navegador ficam em `DATA_DIR/google-local/capturas`, com URL minimizada e hashes. Esses arquivos não têm limpeza automática; excluir o projeto pela interface remove seu registro no banco, mas não os arquivos de evidência. A validade das observações continua limitada mesmo quando o arquivo é conservado. O histórico mínimo de comparação do diagnóstico fica no navegador e pode ser apagado pela interface; isso não apaga o banco nem as capturas locais. Não publique `.env`, `data/` ou relatórios com informações que você não queira compartilhar. Veja [o fluxo e a retenção](docs/USO-LOCAL-INTEGRADO.md).

Para conferir o projeto:

```sh
npm test
npm run check
```

Os testes usam respostas controladas, sem chaves reais ou consultas pagas. Eles não comprovam cobertura ou precisão de uma conta real da SerpApi. Esta versão não apresenta um benchmark validado de posições reais.

Contribuições são bem-vindas: leia [CONTRIBUTING.md](CONTRIBUTING.md). Para problemas de segurança, siga [SECURITY.md](SECURITY.md).

## Licença

[MIT](LICENSE). Você pode estudar, modificar e distribuir o código conforme a licença. A licença do aplicativo não substitui os termos de uso dos sites consultados ou do fornecedor de resultados.
