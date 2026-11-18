# Usar o fluxo integrado no computador

O núcleo local permite informar um domínio, revisar o entendimento do negócio, descobrir buscas candidatas, escolher até três ações em foco e acompanhar sua execução. Ele não exige cadastro nem conexão à conta do cliente. A coleta das páginas públicas usa internet; a análise e o armazenamento descritos aqui ficam na instalação local. Nenhum plano pago é necessário para esse núcleo.

A IA de entendimento é opcional e experimental. O módulo de [captura assistida](GOOGLE-LOCAL.md) permite importar resultados de uma página Google já aberta, sem chave de fornecedor. Ele mostra a ordem de links reconhecidos naquela página. A posição absoluta pelo conector e as estimativas de demanda dependem de fontes externas adequadas, configuradas separadamente. Sem elas, esses dados continuam indisponíveis. Uma hipótese de palavra-chave não se transforma em volume de busca ou ranking.

## Iniciar

Abra um terminal na pasta do projeto. Use Node.js 22.13 ou posterior da série 22, ou Node.js 24. A integração neural atual usa MLX em macOS com Apple Silicon; o núcleo Node não depende desse ambiente.

Se estiver preparando uma instalação nova com internet, instale as dependências de JavaScript a partir do arquivo de lock:

```sh
npm ci
```

O comando baixa dependências gratuitas; não baixa pesos de IA nem cria conta em fornecedor. Se as dependências já estiverem instaladas, comece pelo diagnóstico:

```sh
node scripts/diagnosticar-local.mjs
node scripts/diagnosticar-local.mjs --json
```

O diagnóstico testa a versão do Node, um parse HTML, SQLite em memória e escrita descartável no diretório de dados. Não abre o banco existente, não chama a internet, não carrega a IA e não imprime credenciais ou caminhos privados. A sonda de escrita é removida. Se `DATA_DIR` ainda não existir, testa a criação em seu ancestral existente, sem criar o diretório definitivo. Espaço disponível é informativo e não reserva armazenamento.

`pronto_para_iniciar` significa que essas sondagens do núcleo passaram. Não comprova qualidade do modelo, funcionamento de GPU, cobertura de coleta ou autorização de fontes. A opção `--json` facilita guardar o diagnóstico local; saída 0 indica núcleo pronto, 1 indica algo a corrigir e 2 indica argumento de CLI inválido.

Depois:

```sh
npm start
```

Abra [http://127.0.0.1:8794/projeto](http://127.0.0.1:8794/projeto). O servidor usa loopback; o endereço atende este computador, sem publicar o aplicativo na internet. Para encerrar, use `Ctrl+C` no terminal que o iniciou. Preserve o diretório de dados entre sessões.

## Configuração mínima

O aplicativo funciona sem arquivo `.env`. Os padrões são porta 8794, armazenamento na pasta `data` do projeto e fontes externas desativadas. Para escolher outra porta ou diretório, crie um `.env` em um editor, se ainda não existir, ou edite o existente preservando seus valores:

```dotenv
PORT=8794
DATA_DIR=./data
SERPAPI_KEY=
```

Isso é um exemplo sem credenciais. `DATA_DIR` relativo é resolvido a partir da pasta do projeto; um caminho absoluto também é aceito. Reinicie o servidor após alterar a configuração. Variáveis definidas explicitamente no processo prevalecem sobre `.env`. Não substitua o arquivo apenas para seguir um exemplo.

## O percurso de uma análise

1. **Entender o negócio.** Informe somente o domínio. A coleta lê uma seleção de páginas públicas, com fonte, URL, horário e hash quando disponíveis. O limite atual é de até 12 páginas e 4 MiB no modo de descoberta, dentro dos demais limites de tempo/requisições. Ela não executa JavaScript do site nem acessa páginas privadas. Um bloqueio ou conteúdo insuficiente permanece uma limitação da coleta, sem diagnóstico comercial inventado.
2. **Revisar o perfil.** Confirme ou corrija nome, resumo, público, região, ofertas e outras atividades. Em cada oferta, separe quem solicita/contrata, quem executa, quem recebe/usa, quem paga e qual necessidade quer resolver. Campos desconhecidos podem ficar vazios. Numa intermediadora, o solicitante, o prestador e quem recebe o serviço podem ser partes diferentes. Corrigir o perfil orienta esta análise; não modifica automaticamente os pesos da IA.
3. **Descobrir buscas.** Examine os termos candidatos e sua relação com ofertas e páginas. Uma busca ampla pode ter pouca utilidade para o negócio; não há uma regra de que o maior volume será a melhor oportunidade. Sem fonte de demanda, o sistema não atribui um número de buscas a esses termos.
4. **Verificar posições e escolher prioridades.** Com fonte disponível, uma medição mostra somente o que foi observado, no contexto e na profundidade efetivamente coletados. Sem fonte, as ações podem partir de evidências das páginas e do perfil confirmado. O plano em foco contém até três ações com contexto, próximos passos e critério de verificação. Não é uma previsão de vendas nem uma ordem automática de investimento.
5. **Acompanhar.** Registre responsável, andamento e nota da tarefa. Para concluir, informe implementação, método, evidência, data, resultado da conferência e medida. O registro é declarado por quem o preenche: a conclusão não comprova causalidade, melhora de ranking ou retorno financeiro. Um resultado inconclusivo ou não confirmado continua explícito.

Salve o perfil e confirme suas ofertas antes de usar as buscas e ações como plano de trabalho. Editar o perfil pede uma nova confirmação. A versão/revisão evita que uma aba antiga sobrescreva uma atualização mais recente; se houver conflito, recarregue o projeto e reaplique somente a alteração que continua válida.

Uma nova origem material de tarefa a devolve a pendente e preserva a conclusão antiga no histórico. Uma ação removida do plano é arquivada, sem apagar sua execução anterior. Consultar o projeto não equivale a fazer uma nova medição ou reexecutar a IA.

Em **Publicações com escopo a revisar**, os trechos cujo vínculo com a oferta foi recusado ficam separados das tarefas. Confira a qual atividade cada publicação se refere antes de usá-la como resposta. A seção preserva fontes e também aparece no plano exportado; uma recusa de vínculo não demonstra ausência do serviço. Rascunhos em que todos os vínculos foram recusados deixam de ser prioridades de edição.

As **Perguntas publicadas no site** conservam pergunta, resposta, URL, data e referências ao JSON-LD. São declarações da página: a coleta de HTML não comprova visibilidade no navegador, autoria ou validade atual da condição. Quando uma resposta específica já existe, o plano pode pedir que se confira seu caminho de acesso e suas condições. Não se deve inferir que o texto precisa ser reescrito apenas porque foi encontrado na estrutura. Trechos reconhecidos como relatos de clientes ficam em uma seção de origem a conferir, fora das recomendações sobre operação própria.

Em **Conferir prazos e seus marcos**, abra a fonte integral e confirme a ação, a parte responsável e a modalidade a que cada prazo se aplica. Um prazo de «até 48 horas após a confirmação» pede uma conferência diferente de um aviso de «pelo menos 30 dias de antecedência». A ficha conserva as frases originais e pede a verificação com casos fictícios.

Um plano também pode pedir para comparar cobranças por etapa ou limites por modalidade. Use o limite ou a cobrança previstos no trecho e registre as condições que precisam de confirmação antes de escolher um plano.

### Tipo, responsabilidade e buscas por oferta

Cada oferta pode ter um tipo declarado e um papel específico da organização.
Uma empresa pode disponibilizar um software, executar um serviço e intermediar
outra oferta; a declaração global do negócio não substitui essas diferenças.
Quem fornece a ferramenta pode ser diferente de quem executa a rotina do cliente.
Programas sociais e participação continuam em outras atividades.

O mapa “Como as buscas se ligam ao negócio” mostra objetivo, solicitante,
página e até três expressões da seleção existente por oferta. É uma forma de
organizar a investigação. O mapa não gera novas consultas, soma volumes ou
atribui receita às expressões. Um campo desconhecido continua desconhecido.
Editar tipo ou papel exige nova confirmação; a exportação do plano inclui essas
declarações e mantém fora os campos econômicos estruturados.

## Entendimento pela IA local

Quando os arquivos locais necessários estiverem presentes e a plataforma for compatível, a etapa de perfil oferece o entendimento experimental. A execução usa a captura pública salva, sem enviar premissas financeiras do perfil a um serviço de IA. O modelo local faz uma proposta, mantém citações e sinaliza papéis ou condições ainda desconhecidos.

Uma execução atual analisa no máximo uma oferta. A base inicial seleciona até 16 fontes contextualizadas; a recuperação pode procurar outros trechos da captura preservada para essa oferta, respeitando o limite de entrada. Isso não equivale a entender o site inteiro ou todas as ofertas. As listas de atores e condições são hipóteses que precisam de revisão semântica, mesmo quando suas citações são cópias exatas.

O resultado não substitui o perfil confirmado. A pessoa escolhe quais sugestões copiar para o rascunho, confere o que foi preenchido e salva novamente. Um processo terminado e um JSON válido não significam que a proposta está correta.

Na leitura experimental por atividade, a visualização confere URL e hash da página usada para identificar a oferta. Relações de outra página e suas projeções ficam em **Interpretações com escopo a confirmar**, mantendo o job original intacto. Isso pode separar uma informação de Pix de uma oferta de boleto; não resolve serviços diferentes dentro da mesma página nem prova que um vínculo entre páginas seja falso. Os atores não são preenchidos automaticamente pela leitura por proposições. Os adaptadores de pesquisa exigem avaliação e seleção local explícita.

O diagnóstico verifica a presença de Python, script, arquivos de modelo e diretórios de dependências; ele não importa MLX nem confere todos os pesos. Não há instalação ou download implícitos. Se a IA não estiver instalada, o restante do fluxo continua disponível. Não inicie treinos ou outro servidor de inferência concorrente na mesma GPU: a trava do aplicativo coordena apenas execuções do seu processo Node. Consulte [o contrato e a retenção das execuções](ENTENDIMENTO-LOCAL.md).

### Comparação experimental por atividade

Para pesquisa, encerre o servidor normal e execute `npm run pesquisa`. O comando
abre o mesmo aplicativo local, habilitando uma seção separada e recolhida do
leitor por proposições. Abrir a página não inicia inferência. Sem o Python/MLX
compatível e o modelo Qwen3.5-9B já instalado em
`data/ia/negocio/modelos/qwen35-9b-4bit`, a opção de execução permanece indisponível.
Não existe download ou instalação automática. O fluxo normal não depende disso.

O resultado apresenta atividade, atores propostos, trecho literal, fonte e
limites. Relações programáticas são identificadas; citação correta não comprova
interpretação correta. Copiar uma proposta preenche apenas nome, tipo e papel
no rascunho, ou cria uma atividade separada quando se trata de programa.
Os participantes precisam ser conferidos e o perfil confirmado novamente.

O candidato ainda falhou nas avaliações semânticas e **não está aprovado para
decidir autonomamente por clientes**. Consulte o [guia de treino e avaliação](TREINAR-IA.md). Para usar dois servidores em
testes, escolha portas e `DATA_DIR` distintos; a trava não coordena processos
Node separados. Retome `npm start` para o modo normal.

## Premissas comerciais opcionais

Os campos são por oferta. Informe contribuição por venda, taxa de fechamento ou contagens de contatos qualificados/fechados, origem dos valores, período e definição da população. Contribuição usa o que fica com a própria empresa depois dos custos variáveis de entrega; numa intermediação, não use o valor integral do contrato do prestador como receita da intermediadora.

Só há cenário quando existem os metadados necessários e o perfil foi confirmado. Campos ausentes permanecem desconhecidos; zero é um valor explícito. Zero contatos com zero fechamentos não produz uma taxa zero. Uma faixa declarada não é intervalo de confiança.

O cenário calcula contribuição condicional por contato qualificado da população informada. Custos de aquisição e custos fixos permanecem separados, sem dedução automática. Não multiplique esse valor por volume de buscas para atribuir lucro a uma palavra-chave: buscas, cliques, contatos qualificados e vendas são etapas diferentes. Os valores fornecidos continuam não auditados; selecionar “resumo de registros locais” não faz o aplicativo ler um CRM ou comprovar esses registros. Veja [o contrato e os exemplos controlados](PREMISSAS.md).

## Posições, concorrentes e demanda

Em **Capturas do seu navegador**, escolha um termo candidato, abra o link de busca e use a extensão local por clique. O guia em [http://127.0.0.1:8794/google-local](http://127.0.0.1:8794/google-local) fornece o ZIP e a instalação sem compactação em Chrome/Edge. Importe o JSON no projeto. A captura mantém data, contexto solicitado, hash e origem declarada pelo operador. Não envia consultas automaticamente e não instala a extensão por conta própria.

A ordem reconhecida vale apenas para o trecho daquela página. Links anteriores ao alvo são concorrentes observados na mesma página; se o alvo não foi reconhecido, o sistema não afirma que os demais estejam à frente dele na busca inteira. Nenhum deslocamento de paginação vira posição absoluta. Desafios, consentimento, consulta corrigida e layout não reconhecido não recebem ordem. Reimportar um arquivo não renova a coleta. As capturas ficam separadas da fonte de posições, da demanda e das decisões de orçamento; não entram automaticamente em treino.

O diagnóstico distingue `nao_configurada`, `configurada_nao_testada` e configuração inválida. A mera presença de uma chave não comprova saldo, autorização ou resultado atual. A interface só pode chamar algo de posição observada quando uma resposta válida foi coletada com fonte, data e contexto.

O conector de posições existente aceita somente a configuração de conta gratuita compatível e recusa plano pago/créditos extras. A franquia local é uma proteção adicional e não substitui o saldo total da conta. O aplicativo não cria conta nem adiciona forma de pagamento. Se o operador decidir ativar a fonte, use [o guia de ativação](ATIVAR-POSICOES.md); o configurador opcional faz uma chamada externa de validação da conta, ao contrário do diagnóstico.

A integração opcional de demanda com Google Ads precisa de credenciais e acesso apropriados. Deixá-la desligada preserva todo o restante do fluxo. Ela fornece estimativas históricas quando disponíveis, sem posição orgânica e sem acesso automático aos gastos ou vendas do cliente. Nenhum orçamento de campanha é alterado por estes módulos.

Nem o coletor nem a IA descobrem todas as pesquisas possíveis. Não ser observado no recorte consultado não determina uma posição além dele nem ausência no Google. Para interpretar paginação, validade de capturas e concorrentes à frente, consulte a [metodologia](METODOLOGIA.md).

## Dados preservados e exportação

O SQLite em `DATA_DIR/visibilidade.sqlite` mantém projetos, revisões, tarefas, evidências estruturadas e controle local de uso. O fluxo novo de entendimento também preserva **capturas públicas completas e preparação da IA**, além de entradas e saídas dos jobs, em `DATA_DIR/evidencias-negocio/`. Portanto, nesse fluxo o HTML coletado pode permanecer no disco. Arquivos já gravados não são enviados ao GitHub automaticamente.

As capturas assistidas ficam em `DATA_DIR/google-local/capturas/`. O serviço retira parâmetros de conta e rastreamento das URLs Google reconhecidas antes de persistir, preserva o hash do trecho recebido e, quando necessário, o trecho derivado. A fonte continua declarada: integridade do arquivo não autentica sua origem no Google. O projeto exibe até vinte capturas; arquivos antigos e o JSON baixado pelo operador não são apagados automaticamente. Consulte [o formato e os limites](GOOGLE-LOCAL.md).

Para enviar diretamente da extensão 0.2, salve o perfil e gere a conexão no projeto. O código vale dez minutos e até vinte novas capturas para aquele domínio e revisão; uma alteração do projeto pede nova conexão. A permissão do navegador para `127.0.0.1` é opcional. O aplicativo mantém a autorização em memória; a extensão a conserva somente na sessão do navegador, sem sincronização de conta. Revogue pela extensão, gere outro código ou encerre o aplicativo para invalidá-la. O código não entra no perfil, no histórico ou no relatório. As páginas capturadas são agrupadas por consulta, parâmetros solicitados e links de continuação; resultados repetidos não são somados e o deslocamento da página não se transforma em posição absoluta.

Excluir um projeto pelo aplicativo não apaga automaticamente os snapshots/jobs de entendimento preservados. Há separação entre remover o registro do banco e remover esses experimentos locais; exporte o que precisar e revise uma política de retenção antes de apagar arquivos. Preserve um backup do banco e dos artefatos antes de uma migração ou limpeza.

A exportação do plano de trabalho contém recomendações e registros de execução, sem os campos estruturados de contribuição/taxa do perfil. Notas ou evidências digitadas podem conter informações que a própria pessoa inseriu. A exportação JSON é um retrato mais completo do projeto e pode conter as premissas informadas; revise-a antes de compartilhar. Não publique `.env`, banco, capturas ou relatórios privados como se fossem código-fonte.

## Verificação do software

```sh
npm test
npm run check
node --test test/diagnostico-local.test.mjs
```

Esses testes usam dados e respostas controlados, sem chaves reais ou consulta paga. Não demonstram retorno comercial, acesso ativo a uma fonte externa ou qualidade do modelo com clientes. Os relatórios de experimentos devem distinguir contratos do software, correção semântica, casos reservados e avaliação humana.
