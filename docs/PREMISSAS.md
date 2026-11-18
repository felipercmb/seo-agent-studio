# Premissas econômicas por oferta

`src/modulos/premissas-economicas.mjs` é um módulo puro: não lê CRM, arquivos, API ou rede, não altera campanhas e não treina IA. Ele valida informações fornecidas e calcula um cenário condicional por **contato qualificado de uma oferta e coorte conhecidas**. O resultado nunca é lucro, valor de uma palavra-chave ou recomendação de verba.

## API

```js
import {
  normalizarPremissasEconomicas,
  calcularCenarioPorContato,
  ErroPremissaEconomica,
} from './src/modulos/premissas-economicas.mjs';

const entrada = {
  versao: 1,
  ofertaId: 'oferta_1',
  moeda: 'BRL',
  origem: {
    tipo: 'registro_local', // ou 'declarada'
    referencia: 'Resumo agregado de contatos, revisão 1',
  },
  periodo: {inicio: '2026-10-01', fim: '2026-10-31'},
  coorte: {
    descricao: 'Pedidos de orçamento qualificados desta oferta em outubro',
    criterioQualificacao: 'Necessidade e área atendida confirmadas; contatos distintos',
  },
  contribuicaoPorVenda: {tipo: 'intervalo', minimo: 800, maximo: 1200},
  fechamento: {tipo: 'contagem', contatosQualificados: 100, fechamentos: 20},
  custosAquisicao: {escopo: 'total_periodo_coorte', total: {tipo: 'valor', valor: 1000}},
  custosFixos: {escopo: 'total_periodo_empresa', total: {tipo: 'valor', valor: 5000}},
};

const premissas = normalizarPremissasEconomicas(entrada, {ofertaId: 'oferta_1'});
const resultado = calcularCenarioPorContato(premissas, {
  ofertaId: 'oferta_1',
  perfilConfirmado: true,
  agora: () => Date.parse('2026-11-16T12:00:00Z'), // opcional; padrão Date.now
});
// resultado.contribuicaoPorContatoQualificado: intervalo R$160..R$240,
// antes de aquisição e custos fixos, condicionado às premissas deste exemplo.
```

Os números acima são uma demonstração controlada, não dados de cliente. `normalizarPremissasEconomicas` devolve uma cópia canônica que pode ser persistida. `calcularCenarioPorContato` aceita o mesmo contrato ou a cópia canônica; a opção `ofertaId` impede reutilização acidental em outra oferta. As funções não alteram os objetos recebidos.

## Contrato e ausência

- `versao: 1`; `moeda: 'BRL'` ou ausente. Outra moeda é recusada, sem conversão implícita.
- `ofertaId` deve ser texto até 160 caracteres; pode ser fornecido pela opção. Sua ausência bloqueia o cálculo.
- `origem` usa `tipo: 'declarada' | 'registro_local'` e `referencia` textual até 240 caracteres. A referência é uma descrição; o módulo não abre esse registro. **Ambos permanecem não auditados.**
- `periodo` usa datas civis reais `YYYY-MM-DD`, com início menor ou igual ao fim. O normalizador verifica estrutura/calendário/ordem; o calculador verifica que o fim não está no futuro em relação à data UTC de `agora`. É período de referência, não previsão.
- `coorte` exige `descricao` e `criterioQualificacao`, cada um até 400 caracteres. Contatos devem pertencer à mesma oferta, período e critério. O módulo não deduplica nem verifica registros reais.
- `contribuicaoPorVenda` é `{tipo:'valor', valor:n}` ou `{tipo:'intervalo', minimo:a, maximo:b}`. Aceita até duas casas decimais e valores de -1 bilhão a +1 bilhão. Negativo é uma contribuição desfavorável explícita, não ausência.
- `fechamento` é valor ou intervalo em `[0,1]`, ou `{tipo:'contagem', contatosQualificados:n, fechamentos:k}`. Contagens são inteiras, não negativas e até 1 bilhão, com `k ≤ n`. `k` conta os contatos distintos que fecharam, não quantidade de contratos, itens ou pedidos.
- `custosAquisicao` é `{escopo:'total_periodo_coorte', total: valorOuIntervalo}`; `custosFixos` usa `escopo:'total_periodo_empresa'`. Totais não negativos, até 1 bilhão e duas casas decimais. Cada total permanece vinculado ao seu escopo.
- Cada bloco pode ser `null`/ausente para desconhecido. Um bloco presente precisa ter todos os seus campos obrigatórios. Campos extras, coerções de strings/booleanos para números, `NaN`, infinito, intervalos invertidos e controles invisíveis no texto são recusados.

Os erros usam `ErroPremissaEconomica`, com `codigo: 'premissa_economica_invalida'` e `campo`. A interface deve mostrar o erro ao editar, sem apagar premissas já salvas nem convertê-lo em valor zero.

## Saída e interpretação

`estado` pode ser:

- `cenario_condicional`: há perfil confirmado, oferta, procedência declarada, período, coorte, contribuição e taxa suficiente para a aritmética;
- `incompleto`: `faltam` identifica o que impede calcular e `contribuicaoPorContatoQualificado` permanece `null`;
- `legado_sem_origem`: a economia antiga foi reconhecida, preservada e não recebeu procedência ou validação inventada.

`taxaFechamento.base` distingue `contagem_informada`, `taxa_declarada`, `intervalo_declarado` e `desconhecida`. A amostra só aparece quando foi fornecida. Zero fechamentos em uma coorte positiva produz taxa zero; zero contatos e zero fechamentos produzem taxa **desconhecida**. Nem mesmo taxa zero faz uma contribuição ausente virar zero.

O cálculo é contribuição por venda × frequência/taxa de fechamento. Pontos são arredondados ao centavo; metades são arredondadas para longe de zero. Se houver intervalo declarado, calcula-se o envelope dos quatro extremos com arredondamento para fora. O envelope **não é intervalo de confiança**, não modela distribuição/correlação e não afirma uma probabilidade de retorno.

A contribuição deve excluir os custos variáveis de entrega, mas não descontar aquisição/fixos novamente: esses blocos permanecem separados. Para intermediação, a base é a comissão da própria empresa após custos variáveis de entrega, não o valor integral do negócio intermediado. O cenário considera uma venda por contato que fecha; recompras não estão modeladas. Contatos ainda em negociação e diferenças na janela de acompanhamento precisam de revisão antes de comparar coortes.

Com a contagem de contatos qualificados e fechamentos, além do custo de aquisição da mesma oferta, grupo e período, o painel calcula custo de aquisição por contato e a diferença antes de custos fixos. A diferença usa contribuição por venda × fechamentos menos aquisição total, divididos pelos contatos qualificados. Os intervalos conservam a faixa das premissas. A comparação fica no painel local.

Com aquisição positiva, o painel calcula quantos contatos precisariam fechar para cobrir esse gasto no grupo informado. Ele divide o gasto pela contribuição por venda e arredonda para cima, considerando uma venda por contato. Em intervalos, combina custo menor e contribuição maior para o mínimo. O máximo combina custo maior e contribuição menor. Se houver custo positivo e contribuição zero ou negativa no cenário, o limite correspondente fica indefinido.

Mesmo com `perfilConfirmado: true`, `procedencia.verificacao` continua `nao_auditada`: confirmação do negócio não comprova números. `registroLocalLido` é sempre falso. `custos.deduzidos` descreve o cenário de contribuição bruta por contato, anterior à aquisição. Não há cálculo de lucro líquido, volume futuro de contatos, ROI por consulta ou sugestão de orçamento. O cenário não deve ser multiplicado por buscas/cliques, somado entre variantes de palavras ou usado para ordenar automaticamente investimentos.

## Compatibilidade com dados existentes

`{contribuicaoPorVenda: 1000, taxaFechamento: 0.2}` ainda é reconhecido. Os valores ficam no resultado com `origem.tipo: 'legado_sem_origem'`, sem cenário novo. A precisão numérica antiga é preservada para não reescrever silenciosamente dados; premissas v1 novas exigem duas casas decimais monetárias.

Para completar o registro, a pessoa deve revisar valores, procedência, período e população e salvar explicitamente um contrato v1 novo. Não preencher origem/tempo/coorte automaticamente a partir da marca, do domínio ou da data atual.

## Verificação

```sh
node --test test/premissas-economicas.test.mjs
```

Os testes cobrem denominador zero, contagem incoerente, taxa declarada sem amostra inventada, contribuição negativa, envelopes, ruído de ponto flutuante, datas impossíveis/futuras, ausência de metadados, legado, escopos de custos, campos impróprios de tráfego/ROI e preservação da entrada. Não demonstram retorno comercial nem validação da fonte original.
