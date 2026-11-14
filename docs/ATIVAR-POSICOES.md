# Ativar a verificação de posições

A descoberta de termos e o diagnóstico das páginas já funcionam sem chave. Para consultar páginas de resultados do Google, quem executa Visibilidade Aberta precisa configurar uma conta própria da SerpApi.

A pessoa que informa um domínio na interface não precisa se cadastrar nem conectar contas do proprietário daquele site. A conta da fonte é uma configuração do operador do aplicativo.

## 1. Obter uma chave do plano gratuito

Acesse a [SerpApi](https://serpapi.com/) e crie uma conta no plano Free. No momento da escrita, a [página oficial de preços](https://serpapi.com/pricing) informa 250 buscas por mês e 50 por hora para esse plano. Confira as condições atuais na fonte antes de ativar.

Obtenha sua chave no painel da conta. Não cole a chave em issues, relatórios, screenshots ou no campo de endereço do site.

O código padrão aceita somente uma conta gratuita compatível, ativa, sem créditos extras e com saldo disponível. Ele recusa planos pagos e respostas de conta que não consegue validar. Se o fornecedor mudar o formato ou as condições do plano, pode ser necessário atualizar o conector; o aplicativo não passa a consumir uma fonte paga silenciosamente.

## 2. Configurar o aplicativo

Na pasta do projeto, copie o exemplo se ainda não existir um `.env`.

macOS ou Linux:

```sh
cp .env.example .env
```

PowerShell no Windows:

```powershell
Copy-Item .env.example .env
```

Abra `.env` em um editor e preencha somente a chave com o valor da sua conta:

```dotenv
SERPAPI_KEY=cole_sua_chave_aqui
PORT=8794
DATA_DIR=./data
```

`cole_sua_chave_aqui` é um marcador de exemplo, não uma chave funcional. Você pode manter os demais valores do arquivo de exemplo. `DATA_DIR` indica onde ficarão o SQLite e o controle local de uso. Caminhos relativos são resolvidos a partir da pasta do projeto; mantenha esse diretório entre reinicializações.

Se o servidor estiver aberto, encerre com `Ctrl+C` e inicie novamente:

```sh
npm start
```

Abra [http://localhost:8794](http://localhost:8794), informe um domínio e acompanhe a descoberta. Com a fonte disponível, a verificação avança em etapas. O botão de continuar solicita a próxima etapa; ele não remove os limites de uso.

Deixar `SERPAPI_KEY` vazia desativa as consultas ao Google e preserva as funções que dependem apenas das páginas do site.

## 3. Entender os limites

Além do saldo do fornecedor, esta instalação permite até 200 novas consultas por mês, 40 por hora e 20 páginas do Google por domínio em 24 horas. Os limites menores deixam margem em relação ao plano Free conhecido; não reservam essa margem contra usos da chave por outros programas.

Cada página do Google pode consumir uma chamada. Uma busca lida em cinco páginas pode gastar cinco chamadas. Resultados ainda válidos podem ser reutilizados, mas a aplicação não garante uma nova captura a cada clique.

A franquia local e o progresso ficam em `data/visibilidade.sqlite`, ou no diretório escolhido em `DATA_DIR`. Reiniciar o processo não é uma forma de renovar a franquia. O painel do fornecedor continua sendo a referência para o consumo total daquela conta.

## 4. Mensagens frequentes

| Situação | O que conferir |
| --- | --- |
| Fonte temporariamente indisponível | Chave configurada, servidor reiniciado, conexão e estado da conta |
| Plano incompatível | Conta realmente Free, sem créditos extras, e versão atual do conector |
| Limite gratuito atingido | Saldo do fornecedor e limites locais; aguarde a janela correspondente |
| Termos descobertos, sem posição | Os termos são candidatos; a verificação pode estar pendente ou indisponível |
| Site não observado | Examine quais páginas foram lidas; isso não prova ausência no Google |
| Descoberta parcial | O site pode restringir a coleta ou ter alcançado um limite de tempo ou tamanho |
| Releitura indisponível | Candidatos preservados mantêm suas datas anteriores |

Não altere contadores ou desative validações para fazer uma mensagem desaparecer. Se houver um erro reproduzível, descreva-o sem a chave e use os procedimentos de contribuição ou segurança do projeto.

## Verificar sem prometer resultados

Antes de concluir que a integração funcionou, confira uma busca com fonte, data, contexto e resultados efetivamente retornados. Ter uma chave configurada não comprova uma captura válida.

Os testes do repositório usam respostas controladas e não fazem buscas reais. Esta distribuição não declara posições reais ou cobertura de mercado previamente validadas. Para interpretar uma observação obtida com sua conta, consulte a [metodologia](METODOLOGIA.md).
