# Execuções locais de entendimento do negócio

`lib/entendimento-local.mjs` conecta capturas públicas preservadas ao executor experimental `ia/negocio/jornadas/executar.py`. O wrapper não confirma nem corrige automaticamente o perfil. Também não treina modelos, consulta o Google, baixa pesos ou chama uma API de inferência.

## Contrato do serviço interno

```js
const entendimento = criarEntendimentoLocal({
  dataDir,
  preparar: prepararJornadas,
  // iniciar: spawn, limiteMs: 360000,
  podeIniciar: () => !executorLegadoOcupado(),
});

await entendimento.disponivel();
const captura = await entendimento.registrar(coleta);
const job = await entendimento.iniciar({dominio: captura.dominio, capturaId: captura.capturaId});
const atual = await entendimento.consultar({dominio: captura.dominio, id: job.id});
entendimento.ocupado();
await entendimento.fechar();
```

Os argumentos de construção são internos do servidor. O navegador não escolhe executável, modelo, comando, script, caminho, prompt, fontes ou variáveis de ambiente. `iniciar` recebe somente domínio e ID opaco de uma captura já salva pelo servidor. `consultar` exige domínio e ID do job correspondente.

`registrar` recebe a coleta, chama o preparador e salva imutavelmente a coleta e a preparação completa por SHA-256. Retorna somente `{capturaId,dominio,coletadoEm,base,recuperacao}`. A base tem até 16 fontes contextualizadas; a recuperação pública contém contagens, limites e indicação de cobertura parcial. HTML, pool completo, mapa de IDs e seleções internas ficam somente no arquivo local. Preparar não significa executar o modelo.

`iniciar` salva o pedido, a identidade do código e os bytes exatos de entrada antes de disparar o Python fixo. Retorna rapidamente `estado: em_execucao`; o chamador consulta o resultado posteriormente. O corpo de entrada é `{base,maxOfertas:1,fontesReserva?}`. A reserva privada contém no máximo 640 fontes projetadas em `id`, `texto`, `tipo` e `contexto`; acima de 1 MiB de entrada, a operação é recusada sem truncar frases. Uma execução analisa no máximo uma oferta.

Há exclusão global entre instâncias do wrapper **dentro do mesmo processo Node**. `podeIniciar` permite ao servidor respeitar uma inferência legada já ativa; o caminho legado deve verificar `ocupado()` antes de começar. O wrapper não detecta nem coordena scripts MLX iniciados em outros processos/terminais. Não execute vários servidores ou treinos concorrentes na mesma GPU como se essa trava fosse um agendador do sistema operacional.

## Disponibilidade e execução

`disponivel` verifica Apple Silicon/macOS, Python executável, arquivos do Qwen3.5-4B, script e diretórios das dependências locais. Não carrega modelo, importa MLX, testa GPU ou verifica os gigabytes de pesos. Presença não garante que o ambiente funcionará nem significa aprovação do modelo. O executor Python mantém sua própria verificação de proveniência e pesos antes da inferência.

As variáveis de execução forçam uso local dos arquivos e desativam download/telemetria implícita do Hugging Face. Não se herda o ambiente inteiro do servidor. A chamada usa `shell:false`, Python e script fixos. `iniciar` não baixa dependências; uma instalação ausente ou incompatível produz falha sanitizada e preserva os artefatos disponíveis.

O prazo padrão é seis minutos. Timeout, excesso de stdout ou encerramento do serviço enviam `SIGKILL` apenas ao objeto de processo filho criado por esta instância. Nenhum PID externo é encerrado. O estado de ocupação é mantido até o fechamento e a persistência do processo próprio. Fechar outro wrapper não encerra a execução alheia.

## Integridade dos resultados

- O hash do envelope salvo é conferido antes de inferir. O domínio da captura e da base deve coincidir com o projeto.
- A saída precisa ser JSON versão 2, do mesmo domínio, com `perfilConfirmado:false`. Campos de aprovação de revisor não são aceitos.
- `entradaSha256` é conferido com o digest da base inicial usando a serialização ordenada compatível com o Python.
- Cada jornada informa `fontesSelecionadas` e seu próprio `entradaSha256`. As fontes renumeradas precisam corresponder exatamente, em texto, tipo e contexto, à base ou à reserva privada preservada.
- Citações de oferta usam IDs da base inicial; citações da jornada usam IDs de sua seleção local. Texto e contexto precisam ser cópias exatas das fontes correspondentes.
- A resposta pública contém ofertas, atores, condições, citações, dúvidas, contagens e natureza experimental. JSON bruto do modelo, itens recusados brutos, stderr, caminhos do executor e dados internos ficam fora dessa resposta.
- Resultado final `concluido` indica que o processo terminou e seu contrato foi aceito. O conteúdo continua `revisao_necessaria`, `insuficiente` ou `sem_fontes`; não equivale a negócio compreendido corretamente ou recomendação aprovada.

Esses controles verificam identidade e estrutura, não a verdade semântica. Não substituem revisão humana, provas de utilidade ou avaliação em novas empresas reservadas.

## Arquivos preservados e reinício

Sob `dataDir/evidencias-negocio/`:

```text
capturas/cap_<sha256>.json
execucoes/<uuid>/entrada.json
execucoes/<uuid>/iniciado.json
execucoes/<uuid>/stdout.bin
execucoes/<uuid>/stderr.bin
execucoes/<uuid>/resultado.json  # somente quando aceito
execucoes/<uuid>/final.json
```

Diretórios novos usam modo 0700 e arquivos novos, 0600. Um arquivo é publicado completo com criação exclusiva do nome; não há substituição de artefato prévio. Há um link temporário apenas durante a publicação atômica, removido em seguida, sem aliases persistentes. Marcadores finais e resultados carregados após reinício são conferidos antes de retornar ao aplicativo.

Saída padrão é limitada a 1 MiB; stderr, a 256 KiB. Quando há excesso, o recibo registra truncamento e preserva os bytes disponíveis. Stderr jamais é devolvido como mensagem ao navegador. Captura e preparação juntas têm limite de 12 MiB. O wrapper não apaga automaticamente snapshots, stdout, logs ou jobs antigos; remover um projeto do banco não remove esses arquivos. A interface deve informar isso. O limite agregado de retenção em disco ainda precisa de uma política explícita de exportação/remoção.

Um marcador `em_execucao` sem processo proprietário em memória é finalizado como `interrompido` ao ser consultado depois do reinício. Nenhum processo é retomado automaticamente. Isso também exige operar uma única instância de servidor sobre esse diretório; não trate uma segunda instância simultânea como recuperação do servidor anterior. Resultados concluídos podem ser consultados novamente sem inferência.

Os testes `node --test test/entendimento-local.test.mjs` usam filhos falsos, dados controlados e diretórios temporários. Verificam contratos, captura imutável, concorrência, timeout, excesso de saída, encerramento, reinício e hashes. Não carregam GPU nem consultam serviços externos e não demonstram qualidade do modelo.
