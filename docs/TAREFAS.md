# Execução e verificação das tarefas

`src/modulos/tarefas.mjs` mantém um registro local separado das recomendações regeneradas. As funções são puras: não usam rede, relógio oculto, banco ou modelo. O chamador fornece o domínio e pode fixar `agora`; a persistência deve usar a revisão atômica já existente do projeto.

## API

```js
sincronizarTarefas(estadoAnteriorOuNull, oportunidades.planoDeAcao, {dominio, agora: Date.now})
atualizarTarefa(estadoAnterior, alteracao, {dominio, agora: Date.now})
compararObservacoes(antes, depois, {dominio, agora: Date.now})
```

O estado tem `{versao:1, dominio, revisao, itens, historico}`. Cada item tem `id`, `revisao`, `estado`, `arquivada`, `responsavel`, `nota`, `implementadoEm`, `verificacao`, `origem`, `criadaEm` e `atualizadaEm`.

`origem` preserva versão, hash, tipo, título, ação, critério, passos, página, natureza da recomendação, eixo e referências. Somente uma projeção definida do plano produzido pelo servidor é copiada; o navegador não fornece a origem. A origem não contém uma promessa de resultado. `base: observado` descreve a base do achado, não uma tarefa já executada.

### Sincronização

- IDs repetidos no plano são recusados. Repetir um plano idêntico não altera revisões ou histórico.
- Uma tarefa ausente do plano é arquivada, sem apagar estado ou resultado. O retorno da mesma origem a reativa preservando sua execução anterior.
- Mudança material de ação, critério, passos, página ou referências abre nova versão da origem e devolve o item a `pendente`. A conclusão anterior permanece no histórico. Responsável e nota são preservados.
- Alterar somente a data de coleta não reabre a tarefa. A data antiga da origem preservada continua explícita; ela não é atualizada artificialmente.
- Cada evento mantém revisão da coleção e da tarefa, alteração, instante e encadeamento SHA-256. Ao carregar, o módulo confere os hashes, reaplica o histórico e verifica igualdade com o estado corrente. Isso detecta corrupção acidental ou estado divergente; não autentica declarações contra um atacante que controle todos os arquivos.
- `registro_sistema` identifica sincronização e arquivamento. Edições e medidas do usuário são `declarado`; não se tornam observações automáticas.

### Edição e conclusão

```js
{
  id: 'acao_...',
  revisao: 2,                   // revisão da tarefa, não do projeto
  estado: 'concluida',
  responsavel: 'Equipe',        // opcional; null remove
  nota: 'Registro da revisão',  // opcional
  implementadoEm: '2026-11-16T12:00:00.000Z',
  verificacao: {
    metodo: 'Conferência da página e do caminho de contato.',
    evidencia: 'O formulário informa data, cidade e nome do evento.',
    verificadoEm: '2026-11-16T12:10:00.000Z',
    url: 'https://empresa.com.br/contratacao',
    resultado: 'confirmado',    // ou nao_confirmado, inconclusivo
    medida: {indicador:'campos_publicados', tipo:'numero', valor:3, unidade:'campos'}
  }
}
```

Estados: `pendente`, `em_andamento`, `concluida`, `descartada`. Concluída e descartada precisam voltar a pendente antes de outra execução; reabrir limpa os campos correntes de implementação/verificação, mantendo-os no histórico. Descartar exige nota. Tarefa arquivada não é editável. Revisão divergente retorna erro 409; tarefa inexistente, 404; contrato inválido, 400.

A conclusão exige data de implementação, método, evidência declarada, resultado da conferência e medida tipada. A verificação deve ocorrer depois da implementação e não pode ser futura. Quando há uma URL da tarefa, a verificação deve usar a mesma URL. Valores desconhecidos (`null`) não concluem; zero e falso explícitos são preservados. Medidas podem ser número finito, booleano ou texto específico. O critério é herdado da origem; não pode ser substituído pelo navegador.

Concluída significa que a tarefa foi encerrada com um registro. Resultado `nao_confirmado` ou `inconclusivo` é permitido e continua explícito. Não significa que o objetivo comercial foi atingido. O módulo não avalia sozinho a veracidade ou a adequação semântica da declaração.

URLs devem pertencer ao domínio do projeto ou a seus subdomínios públicos, sem porta, credenciais, parâmetros ou fragmentos. Textos têm limites e não aceitam caracteres de controle. Campos arbitrários e `natureza: observado` enviados na edição são recusados. O servidor deve continuar validando origem local e revisão do projeto antes de chamar o módulo.

## Comparação de observações

```js
{
  natureza: 'observado',  // declarado ou hipotese também são representáveis
  medida: {indicador:'posicao_google', tipo:'numero', valor:11, unidade:'posicao_organica'},
  coletadoEm: '2026-11-16T12:00:00.000Z',
  contexto: {
    url:'https://empresa.com.br/contratacao', metodo:'captura_serp',
    termo:'contratação de artista', pais:'Brasil', idioma:'Português',
    dispositivo:'Computador', localidade:'Brasil',
    periodoInicio:null, periodoFim:null
  },
  fonte: {id:'captura_001', sha256:'...64 caracteres hexadecimais...'}
}
```

O comparador exige tipo, indicador, unidade, natureza e contexto iguais, além de avanço temporal. Hipóteses, valores ausentes, mudança de contexto e mistura entre declarado/observado não geram diferença. Períodos devem ter a mesma duração, ser posteriores e não se sobrepor; isso não garante ausência de sazonalidade ou comparabilidade comercial. A diferença numérica é `depois − antes`, sem interpretar automaticamente como melhora. Para booleano/texto, retorna apenas se houve mudança.

Uma observação automática precisa conter identificação e hash de fonte, mas o comparador não autentica essa fonte. Somente adaptadores internos devem produzir observações; não exponha esse contrato como forma de o navegador inserir dados observados. A saída sempre mantém `causalidade: nao_estabelecida`.

## Limites e preservação

São aceitas 64 tarefas no plano ativo, 256 tarefas preservadas, 2.048 eventos e 2 MiB de registro. Atingir um limite recusa a operação inteira com erro 413, sem truncar histórico, apagar tarefas antigas ou modificar o objeto de entrada. O limite agregado de 4 MiB do repositório do projeto também continua aplicável. Exportação e revisão da política de retenção devem preceder qualquer remoção futura.

Teste local: `node --test test/tarefas.test.mjs`. Os testes usam casos controlados e um plano gerado pelos módulos reais sobre HTML controlado. Eles verificam integridade e comportamento do software; não demonstram melhora de ranking ou resultado comercial.
