# Capturas Google locais — extensão 0.4.1

O módulo interpreta um trecho da página de resultados já aberta pelo operador. A extensão é acionada por clique e pode baixar JSON ou enviar o trecho diretamente ao aplicativo em loopback. Não envia consultas ao Google, avança páginas ou usa uma API de resultados. Esta versão é assistida; não entrega rastreamento automático de todas as buscas.

## Usar

1. Inicie o projeto com `npm start` e abra [a análise](http://127.0.0.1:8794/projeto).
2. Leia o site e abra **Capturas do seu navegador**, na etapa de posições.
3. Abra o guia local **Como instalar a extensão local**. Baixe o ZIP, extraia e carregue a pasta sem compactação no Chrome ou Edge. O ZIP contém somente os quatro assets da extensão.
4. Escolha uma busca candidata e abra o link oferecido pelo projeto. Ele usa a aba Web (`udm=14`) com idioma explícito. O parser inicial aceita português/pt-BR, inglês/en-US e espanhol; idiomas ausentes ou não suportados permanecem indisponíveis.
5. Com a página aberta, clique na extensão e baixe a captura. Volte ao projeto e importe o JSON. Ou use a conexão direta descrita abaixo. Não há CSV ou conta de fornecedor.
6. Para outra página, use a próxima indicada pela busca e capture novamente. Cada arquivo tem sua data, contexto e ordem própria.

O guia e o ZIP são servidos pela instalação em `/google-local` e `/google-local/extensao.zip`. São endereços locais, sem publicação. Instalar a extensão no navegador pessoal é uma ação do operador; a aplicação não faz isso por conta própria.

## Conexão direta com o projeto

Use Chrome/Edge 120 ou posterior. No painel de capturas, clique em **Conectar extensão a este projeto**, copie o código, cole na extensão e autorize a conexão opcional a `http://127.0.0.1/*`. Confira o domínio antes de clicar em **Capturar e enviar esta página**. Na análise, **Atualizar capturas recebidas** relê o estado local sem nova busca ou coleta do site.

O servidor gera 32 bytes aleatórios por código e guarda somente o digest como índice de autorização em memória. O código concede somente envio a um domínio existente, com revisão conferida; não permite ler o perfil, iniciar IA ou consultar Google. Expira em dez minutos, permite vinte novas gravações, não é renovado no envio e é revogado ao criar outro para o projeto. Reiniciar o servidor remove as autorizações. A extensão usa `chrome.storage.session`, sem sincronização em conta ou gravação do código no projeto; fechar o popup não exige colar novamente enquanto a sessão estiver válida. **Desconectar** remove a sessão e a permissão opcional e tenta revogar o código no aplicativo.

As rotas de recebimento aceitam somente origem exata de extensão, JSON e um código válido; preflight não concede credenciais. A emissão do código mantém as verificações de origem local do aplicativo. O envio passa pelo coordenador existente, com revisão e idempotência. Alterar o perfil em outra tela exige gerar um novo código. A permissão do navegador não substitui o código temporário.

### Quando o envio não é confirmado

Na versão 0.3, a extensão guarda a captura pendente nesta sessão do navegador. **Reenviar mesma captura** reapresenta os mesmos dados e a mesma data, sem ler a página novamente. O servidor reconhece uma gravação já recebida; uma resposta perdida não gera outra captura nem consome novamente a franquia da conexão.

Fechar e reabrir o painel recupera a pendência. É possível baixar o JSON ou descartá-lo explicitamente. O envio para outro domínio fica bloqueado enquanto houver essa pendência. Código expirado ou revisão alterada exige conectar de novo ao mesmo projeto. Desconectar mantém a captura pendente para download ou descarte, mas remove a autorização de envio.

A pendência usa armazenamento de sessão: **encerre o navegador somente depois de reenviar ou baixar o arquivo que deseja guardar**. Ela não é uma cópia permanente. A extensão não tenta enviar novamente em segundo plano.

As APIs utilizadas seguem a documentação do Chrome para [permissões opcionais](https://developer.chrome.com/docs/extensions/reference/api/permissions), [padrões de host em loopback](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns) e [armazenamento de sessão](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Sequências e cobertura

As capturas são agrupadas por domínio, consulta normalizada, host Google, idioma/país solicitados, dispositivo, localidade declarada e parâmetros de personalização, em janelas de até quinze minutos. Isso não comprova o contexto efetivo da busca. A continuidade depende dos links de próxima página preservados: não é inferida pela diferença de `start`.

O resumo mostra páginas avulsas, próximas páginas sem captura, capturas antigas da mesma página, conflitos no mesmo horário e URLs repetidas entre páginas. Uma captura recente bloqueada substitui a observação anterior no resumo da página; não vira ausência nem posição zero. Capturas em conflito não recebem ordem por desempate. A ausência de próximo link não prova o fim dos resultados. Nenhuma sequência recebe posição absoluta ou é usada para decidir verba/treinar automaticamente.

Páginas interpretadas apenas por domínios exibidos também podem compor a continuidade, quando o link de próxima página está preservado e corresponde exatamente a uma captura seguinte. O resumo mantém encontros por URL separados de encontros por domínio e bloco. Um domínio exibido não ganha URL de destino ou posição absoluta por entrar na sequência. Página sem identificação suficiente ou em conflito continua interrompendo o encadeamento.

## O significado da ordem

O parser reconhece o primeiro título h3 com link público de cada bloco web conhecido no trecho. Exclui marcadores de anúncios, redirecionadores publicitários conhecidos, perguntas relacionadas, repetições e conteúdo oculto disponível na captura. Regras de layout são limitadas e podem exigir atualização.

**“Segundo link reconhecido nesta página” não é “posição 2 em todo o Google”.** A aba Web é um recorte específico. O parâmetro `start=10` também não demonstra que um item seja a posição 11: a quantidade e a composição dos resultados podem variar.

Se o alvo foi reconhecido, o módulo lista links anteriores na mesma página. Se não foi reconhecido, mostra outros links, sem afirmar que estejam antes dele na busca inteira. Não infere posição zero ou ausência no Google.

Consulta corrigida, consentimento, desafio, idioma não suportado ou layout desconhecido não recebem ordem válida. O módulo não resolve CAPTCHA, troca IP ou contorna controles.

## Evidência e retenção

A captura é **declarada pelo operador**: origem e horário não são autenticados pelo Google. País e idioma são parâmetros solicitados; localização efetiva e personalização permanecem desconhecidas. O dispositivo é uma classificação do navegador, não uma localização validada.

A extensão retira scripts, formulários, conteúdo oculto identificado e o cabeçalho de conta; preserva um trecho derivado do bloco de busca e o link seguinte. Usa `activeTab`, `scripting` e `storage` para o código temporário em memória. O host de loopback é opcional e solicitado por clique; não há permissão de host Google, cookies, histórico ou acesso a todos os sites.

Antes de persistir, o servidor normaliza a URL da consulta e parâmetros de links Google. Guarda o SHA-256 do trecho recebido e o trecho derivado quando houve normalização; não copia o original bruto para esse fim. O arquivo escolhido pelo operador continua onde foi salvo.

Os arquivos imutáveis ficam em `DATA_DIR/google-local/capturas/gl1_<sha256>.json`. O serviço verifica tipo de arquivo, hash e domínio ao reabrir. Identidade e integridade do arquivo não comprovam que a página fosse autêntica. O projeto exibe até vinte capturas; arquivos antigos não são apagados automaticamente. Excluir o projeto também não remove esses arquivos.

A validade de recência é recalculada ao abrir a análise, com janela de uma hora. Uma captura histórica mantém sua data. Reimportar o mesmo arquivo não faz uma nova coleta; não renova o horário. Resultados de versão de parser não registrada precisam ser reinterpretados, preservando a origem anterior.

Há limites de 48 KiB para HTML, 60.000 bytes para a captura e até trinta links reconhecidos por página. Exceder limites gera erro; não há corte silencioso de fonte. O JSON exportado e o trecho podem conter expressão e URLs pesquisadas; revise-os antes de compartilhar.

## Redirecionamentos e domínios exibidos

O parser 2 lê URLs externas publicadas diretamente e destinos HTTP explícitos nos parâmetros de `/url` ou `/goto`, sem visitar o link. Um token opaco não é decodificado nem seguido. Quando um redirecionamento Google não publica o destino, o parser pode ler **uma única citação `cite` visível no mesmo link do título**, com domínio público não truncado.

Esse resultado tem estado `dominios_exibidos`. A lista mostra o domínio exibido, a citação literal, o título e o número do bloco web reconhecido; `urlDestino`, `ordemNaPagina` e `posicaoGoogle` continuam nulos para essa identificação. Não é criada uma URL a partir do domínio exibido. Anúncios e citações fora do link, ocultas ou ambíguas não identificam o site. Um bloco sem identificação conserva seu espaço na contagem, e não vira ausência do site.

A interface separa URLs identificadas de domínios apenas exibidos. Os domínios vistos antes do alvo são observações daquela página; a coleta não confirma concorrência comercial, destino, indexação, ordem universal ou completude do layout. Capturas da versão anterior pedem reinterpretação; o artefato e seu horário não são reescritos. A extensão 0.4.1 conserva a captura pendente introduzida na 0.3.

Uma captura real assistida de 17/11/2026, sanitizada pela extensão 0.3, está reservada como regressão de parser. No parser 1, ela retornava layout não reconhecido. No parser 2, identificou nove domínios exibidos em dez blocos web, mantendo um bloco sem identificação. Isso é uma regressão offline de um layout observado naquela data, não comprovação de todas as buscas atuais. O JSON e sua proveniência estão em `test/fixtures/google-web-goto-real-20261117.*`; ele não é dado de treino da IA.

## Integração

- `src/google-local.mjs`: URL, contexto, parser e fila de termos; sem transporte de rede.
- `src/google-sequencias.mjs`: agrupamento e continuidade documental, sem envio de consultas ou soma de posições.
- `lib/google-local.mjs`: minimização, persistência e reabertura.
- `lib/conexao-google-local.mjs`: autorizações temporárias e limitadas de envio para um projeto.
- `extensoes/google-local/`: captura por ação do usuário, download e envio opcional exclusivamente a loopback.
- `lib/extensao-google.mjs`: ZIP somente com assets fixos, sem banco, capturas ou chaves.
- A ação local `registrar_google_local` exige revisão do projeto e recebe a captura, nunca posições ou concorrentes prontos do navegador.
- `googleLocal` guarda a observação declarada. O app mantém a medição por fonte e a demanda nos campos próprios.
- A ação `registrar_google_local` pode sugerir uma conferência para a consulta exata ligada a uma oferta confirmada. Abra a tarefa para ver a página da oferta, a data e o contexto da captura, os domínios anteriores e a cobertura.
- Um recorte avulso pede reconstrução da sequência. Uma próxima página ausente pode gerar uma tarefa de continuação. A comparação inclui apenas domínios que apareceram antes no mesmo trecho. Um destino desconhecido fica sem link.
- A observação histórica continua acessível na tarefa, com a data original. Quando uma nova coleta traz o mesmo trecho e contexto, o responsável e o andamento permanecem registrados. Quando a evidência muda, o registro preserva o histórico da execução.
- A importação funciona dentro da instalação local com o clique ou arquivo fornecido pelo operador. Decisões de verba dependem de custos, resultados e atribuição próprios.

As [políticas oficiais do Google](https://developers.google.com/search/docs/essentials/spam-policies#machine-generated-traffic) restringem consultas automatizadas sem permissão. A navegação automática fica fora desta versão. O código não substitui condições de acesso do serviço.

## Validação

Os testes usam páginas autorais para reproduzir blocos com destino direto, redirecionamento opaco e localidade declarada. As capturas são testadas em sequência e reabertas com o histórico. Execute `npm test` para verificar o parser, a importação e a geração de tarefas.
