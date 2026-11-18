import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizarPremissasEconomicas, calcularCenarioPorContato, ErroPremissaEconomica} from '../src/modulos/premissas-economicas.mjs';

const agora = () => Date.parse('2026-11-16T12:00:00Z');
const opcoes = {ofertaId: 'oferta_1', perfilConfirmado: true, agora};
const valor = n => ({tipo: 'valor', valor: n});
const intervalo = (minimo, maximo) => ({tipo: 'intervalo', minimo, maximo});
function base(extra = {}) {
  return {versao: 1, ofertaId: 'oferta_1', moeda: 'BRL',
    origem: {tipo: 'registro_local', referencia: 'Resumo mensal local, revisão 1'},
    periodo: {inicio: '2026-10-01', fim: '2026-10-31'},
    coorte: {descricao: 'Pedidos de orçamento qualificados da oferta no mês de outubro',
      criterioQualificacao: 'Contato distinto com necessidade e área atendida confirmadas'},
    contribuicaoPorVenda: valor(1000), fechamento: {tipo: 'contagem', contatosQualificados: 100, fechamentos: 20},
    custosAquisicao: null, custosFixos: null, ...extra};
}
function invalida(input, campo = null) {
  assert.throws(() => calcularCenarioPorContato(input, opcoes), e => e instanceof ErroPremissaEconomica &&
    (campo === null || e.campo === campo));
}

test('calcula por contato qualificado a partir de contagem, sem afirmar auditoria ou ROI', () => {
  const r = calcularCenarioPorContato(base(), opcoes);
  assert.equal(r.estado, 'cenario_condicional');
  assert.equal(r.contribuicaoPorContatoQualificado.valor, 200);
  assert.equal(r.contribuicaoPorContatoQualificado.escopo, 'oferta_e_coorte');
  assert.equal(r.taxaFechamento.base, 'contagem_informada');
  assert.deepEqual(r.taxaFechamento.amostra, {contatosQualificados: 100, fechamentos: 20});
  assert.equal(r.procedencia.registroLocalLido, false);
  assert.equal(r.procedencia.verificacao, 'nao_auditada');
  assert.equal(r.custos.deduzidos, false);
  assert.equal(Object.hasOwn(r, 'roi'), false);
  assert.equal(Object.hasOwn(r, 'verbaRecomendada'), false);
});

test('taxa declarada não recebe amostra inventada', () => {
  const r = calcularCenarioPorContato(base({origem: {tipo: 'declarada', referencia: 'Premissa informada pela responsável'}, fechamento: valor(0.25)}), opcoes);
  assert.equal(r.taxaFechamento.base, 'taxa_declarada');
  assert.equal(r.taxaFechamento.amostra, null);
  assert.equal(r.contribuicaoPorContatoQualificado.valor, 250);
});

test('intervalo usa os quatro extremos e não vira intervalo de confiança', () => {
  const r = calcularCenarioPorContato(base({contribuicaoPorVenda: intervalo(-100, 50), fechamento: intervalo(0.1, 0.3)}), opcoes);
  assert.equal(r.taxaFechamento.base, 'intervalo_declarado');
  assert.deepEqual([r.contribuicaoPorContatoQualificado.minimo, r.contribuicaoPorContatoQualificado.maximo], [-30, 15]);
  assert.equal(r.contribuicaoPorContatoQualificado.intervaloDeConfianca, false);
});

test('intervalo inteiramente negativo mantém ordem dos limites', () => {
  const r = calcularCenarioPorContato(base({contribuicaoPorVenda: intervalo(-200, -100), fechamento: intervalo(0.1, 0.3)}), opcoes);
  assert.deepEqual([r.contribuicaoPorContatoQualificado.minimo, r.contribuicaoPorContatoQualificado.maximo], [-60, -10]);
});

test('envelope monetário arredonda para fora e evita ampliar por ruído binário', () => {
  const r = calcularCenarioPorContato(base({contribuicaoPorVenda: intervalo(0.01, 0.01), fechamento: intervalo(0.1, 0.9)}), opcoes);
  assert.deepEqual([r.contribuicaoPorContatoQualificado.minimo, r.contribuicaoPorContatoQualificado.maximo], [0, 0.01]);
  const exato = calcularCenarioPorContato(base({contribuicaoPorVenda: intervalo(0.1, 0.1), fechamento: intervalo(0.2, 0.2)}), opcoes);
  assert.deepEqual([exato.contribuicaoPorContatoQualificado.minimo, exato.contribuicaoPorContatoQualificado.maximo], [0.02, 0.02]);
});

test('contribuição negativa é perda possível, não dado inválido ou ausente', () => {
  const r = calcularCenarioPorContato(base({contribuicaoPorVenda: valor(-0.01), fechamento: valor(0.5)}), opcoes);
  assert.equal(r.contribuicaoPorContatoQualificado.valor, -0.01);
});

test('zero observado difere de ausência de contatos', () => {
  const zeroFechamentos = calcularCenarioPorContato(base({fechamento: {tipo: 'contagem', contatosQualificados: 12, fechamentos: 0}}), opcoes);
  assert.equal(zeroFechamentos.contribuicaoPorContatoQualificado.valor, 0);
  const semContatos = calcularCenarioPorContato(base({fechamento: {tipo: 'contagem', contatosQualificados: 0, fechamentos: 0}}), opcoes);
  assert.equal(semContatos.contribuicaoPorContatoQualificado, null);
  assert.equal(semContatos.taxaFechamento.valor, null);
  assert.ok(semContatos.faltam.includes('amostraComContatosQualificados'));
});

test('premissa ausente não vira zero mesmo quando a outra taxa é zero', () => {
  const r = calcularCenarioPorContato(base({contribuicaoPorVenda: null, fechamento: valor(0)}), opcoes);
  assert.equal(r.contribuicaoPorContatoQualificado, null);
  assert.deepEqual(r.faltam, ['contribuicaoPorVenda']);
});

test('ausência inteira produz estado incompleto explícito', () => {
  const r = calcularCenarioPorContato(null, {agora});
  assert.equal(r.estado, 'incompleto');
  assert.equal(r.contribuicaoPorContatoQualificado, null);
  assert.equal(r.premissas.custosAquisicao, null);
  assert.deepEqual(r.faltam, ['ofertaId', 'perfilConfirmado', 'origem', 'periodo', 'coorte', 'contribuicaoPorVenda', 'fechamento']);
});

test('perfil ainda não confirmado impede cenário, preservando as premissas', () => {
  const r = calcularCenarioPorContato(base(), {...opcoes, perfilConfirmado: false});
  assert.equal(r.contribuicaoPorContatoQualificado, null);
  assert.deepEqual(r.faltam, ['perfilConfirmado']);
  assert.equal(r.premissas.contribuicaoPorVenda.valor, 1000);
});

test('cada metadado obrigatório ausente impede o cenário', () => {
  for (const campo of ['origem', 'periodo', 'coorte']) {
    const r = calcularCenarioPorContato(base({[campo]: null}), opcoes);
    assert.equal(r.contribuicaoPorContatoQualificado, null, campo);
    assert.deepEqual(r.faltam, [campo]);
  }
});

test('legado é preservado sem origem, população ou verificação inventadas', () => {
  const legado = {contribuicaoPorVenda: 12.12345, taxaFechamento: 0.25};
  const r = calcularCenarioPorContato(legado, opcoes);
  assert.equal(r.estado, 'legado_sem_origem');
  assert.equal(r.contribuicaoPorContatoQualificado, null);
  assert.equal(r.premissas.contribuicaoPorVenda.valor, 12.12345);
  assert.equal(r.premissas.origem.referencia, null);
  assert.deepEqual(normalizarPremissasEconomicas(r.premissas), r.premissas);
});

test('custos de aquisição e fixos não são confundidos nem deduzidos', () => {
  const r = calcularCenarioPorContato(base({
    custosAquisicao: {escopo: 'total_periodo_coorte', total: valor(800)},
    custosFixos: {escopo: 'total_periodo_empresa', total: intervalo(10000, 12000)},
  }), opcoes);
  assert.equal(r.contribuicaoPorContatoQualificado.valor, 200);
  assert.equal(r.custos.aquisicao.total.valor, 800);
  assert.equal(r.custos.fixos.total.minimo, 10000);
  assert.equal(r.custos.deduzidos, false);
});

test('custos zero explícitos permanecem distintos de desconhecidos', () => {
  const r = calcularCenarioPorContato(base({custosAquisicao: {escopo: 'total_periodo_coorte', total: valor(0)}}), opcoes);
  assert.equal(r.custos.aquisicao.total.valor, 0);
  assert.equal(r.custos.fixos, null);
});

test('não aceita custos negativos, escopo trocado ou total ausente', () => {
  invalida(base({custosAquisicao: {escopo: 'total_periodo_coorte', total: valor(-1)}}));
  invalida(base({custosFixos: {escopo: 'total_periodo_empresa', total: intervalo(-1, 0)}}));
  invalida(base({custosAquisicao: {escopo: 'total_periodo_empresa', total: valor(100)}}), 'custosAquisicao.escopo');
  invalida(base({custosFixos: {escopo: 'total_periodo_empresa', total: null}}), 'custosFixos.total');
});

test('recusa contagens incoerentes e não numéricas', () => {
  for (const [contatosQualificados, fechamentos] of [[10, 11], [0, 1], [-1, 0], [10.5, 1], [10, -1], [10, 1.5], ['10', 1], [true, 1], [Infinity, 1], [1e10, 1]]) {
    invalida(base({fechamento: {tipo: 'contagem', contatosQualificados, fechamentos}}));
  }
});

test('recusa taxa fora de [0,1], intervalo invertido, boolean e não finitos', () => {
  for (const taxa of [valor(-0.01), valor(1.01), valor(NaN), valor(Infinity), valor('0.2'), valor(true), intervalo(0.5, 0.1)]) {
    invalida(base({fechamento: taxa}));
  }
  invalida(base({contribuicaoPorVenda: intervalo(50, -50)}));
  invalida(base({contribuicaoPorVenda: valor(1e10)}));
  invalida(base({contribuicaoPorVenda: valor(10.001)}));
});

test('datas civis e período são validados sem normalizar datas inexistentes', () => {
  for (const [inicio, fim] of [['2026-02-29', '2026-03-01'], ['2026-01-01', '2026-02-30'], ['2026-11-01', '2026-10-01'], ['2026-1-01', '2026-10-01'], ['2026-01-01T00:00:00Z', '2026-10-01']]) {
    invalida(base({periodo: {inicio, fim}}));
  }
  assert.equal(calcularCenarioPorContato(base({periodo: {inicio: '2024-02-29', fim: '2024-02-29'}}), opcoes).estado, 'cenario_condicional');
});

test('período de referência futuro é recusado, dia atual é permitido', () => {
  invalida(base({periodo: {inicio: '2026-11-01', fim: '2026-11-17'}}), 'periodo.fim');
  assert.equal(calcularCenarioPorContato(base({periodo: {inicio: '2026-11-01', fim: '2026-11-16'}}), opcoes).estado, 'cenario_condicional');
});

test('oferta deve corresponder à solicitada, sem troca silenciosa', () => {
  invalida(base({ofertaId: 'outra_oferta'}), 'ofertaId');
  assert.equal(normalizarPremissasEconomicas({versao: 1}, {ofertaId: 'oferta_1'}).ofertaId, 'oferta_1');
});

test('não aceita campos para atribuir valor a palavra, tráfego ou campanha', () => {
  for (const extra of [{volumeBuscas: 100}, {palavraChave: 'curso'}, {cpc: 1}, {roi: 2}, {moeda: 'USD'}]) invalida(base(extra));
  invalida(base({fechamento: {...valor(0.2), amostra: 100}}));
});

test('origem de registro local continua não auditada e rejeita alegação de auditoria', () => {
  invalida(base({origem: {tipo: 'registro_local', referencia: 'crm.local', auditado: true}}));
  invalida(base({origem: {tipo: 'auditada', referencia: 'crm.local'}}));
  invalida(base({origem: {tipo: 'declarada', referencia: ''}}));
});

test('coorte e referência exigem texto limitado, sem controles invisíveis', () => {
  invalida(base({coorte: {descricao: '', criterioQualificacao: 'Conhecido'}}));
  invalida(base({coorte: {descricao: 'a'.repeat(401), criterioQualificacao: 'Conhecido'}}));
  invalida(base({coorte: {descricao: 'Contatos\u202e', criterioQualificacao: 'Conhecido'}}));
  invalida(base({origem: {tipo: 'registro_local', referencia: 'a'.repeat(241)}}));
});

test('entrada e configuração inválidas geram erro próprio, sem coerção', () => {
  for (const v of [false, '100', [], {versao: 2}, {}]) invalida(v);
  assert.throws(() => calcularCenarioPorContato(base(), {...opcoes, perfilConfirmado: 'true'}), ErroPremissaEconomica);
  assert.throws(() => calcularCenarioPorContato(base(), {...opcoes, agora: NaN}), ErroPremissaEconomica);
});

test('normalização e cálculo não alteram entrada e produzem resultados independentes', () => {
  const entrada = base(), copia = structuredClone(entrada);
  const normal = normalizarPremissasEconomicas(entrada);
  const resultado = calcularCenarioPorContato(entrada, opcoes);
  assert.deepEqual(entrada, copia);
  assert.deepEqual(normalizarPremissasEconomicas(normal), normal);
  resultado.premissas.coorte.descricao = 'alterada';
  assert.deepEqual(entrada, copia);
});

test('não inventa intervalo de confiança a partir de amostra pequena', () => {
  const r = calcularCenarioPorContato(base({fechamento: {tipo: 'contagem', contatosQualificados: 1, fechamentos: 1}}), opcoes);
  assert.equal(r.taxaFechamento.valor.tipo, 'valor');
  assert.equal(r.taxaFechamento.valor.valor, 1);
  assert.equal(Object.hasOwn(r.taxaFechamento, 'confianca'), false);
  assert.ok(r.limites.some(l => l.includes('probabilidade futura')));
});

test('compara aquisição e contribuição no mesmo grupo com contagens e indica a diferença antes dos fixos',()=>{
  const r=calcularCenarioPorContato(base({custosAquisicao:{escopo:'total_periodo_coorte',total:valor(25000)},
    custosFixos:{escopo:'total_periodo_empresa',total:valor(20000)}}),opcoes);
  const c=r.comparacaoAquisicao;
  assert.equal(r.contribuicaoPorContatoQualificado.valor,200);
  assert.deepEqual(c.custoPorContatoQualificado,valor(250));
  assert.deepEqual(c.diferencaAntesDosFixos,valor(-50));
  assert.equal(c.estado,'aquisicao_acima_da_contribuicao');
  assert.equal(c.atribuiAConsulta,false);
  assert.deepEqual(c.fechamentosParaCobrirAquisicao,{minimo:25,maximo:25,contatosQualificados:100,
    natureza:'limiar_condicional',antesDosFixos:true});
});

test('diferença preserva os extremos antes de arredondar inclusive quando atravessa zero',()=>{
  const r=calcularCenarioPorContato(base({contribuicaoPorVenda:intervalo(10.01,10.02),
    fechamento:{tipo:'contagem',contatosQualificados:3,fechamentos:1},
    custosAquisicao:{escopo:'total_periodo_coorte',total:intervalo(10,10.03)}}),opcoes);
  assert.deepEqual(r.comparacaoAquisicao.custoPorContatoQualificado,intervalo(3.33,3.35));
  assert.deepEqual(r.comparacaoAquisicao.diferencaAntesDosFixos,intervalo(-0.01,0.01));
  assert.equal(r.comparacaoAquisicao.estado,'faixa_inclui_equilibrio');
  assert.deepEqual([r.comparacaoAquisicao.fechamentosParaCobrirAquisicao.minimo,
    r.comparacaoAquisicao.fechamentosParaCobrirAquisicao.maximo],[1,2]);
});

test('total de aquisição exige contagem qualificada e preserva zero declarado',()=>{
  const custosAquisicao={escopo:'total_periodo_coorte',total:valor(0)};
  const positivo=calcularCenarioPorContato(base({custosAquisicao}),opcoes);
  assert.deepEqual(positivo.comparacaoAquisicao.custoPorContatoQualificado,valor(0));
  assert.equal(positivo.comparacaoAquisicao.fechamentosParaCobrirAquisicao,null);
  assert.equal(positivo.comparacaoAquisicao.estado,'contribuicao_acima_da_aquisicao');
  for(const fechamento of [valor(0.20),{tipo:'contagem',contatosQualificados:0,fechamentos:0}]){
    const r=calcularCenarioPorContato(base({custosAquisicao,fechamento}),opcoes);
    assert.equal(r.comparacaoAquisicao.diferencaAntesDosFixos,null);
    assert.ok(r.comparacaoAquisicao.faltam.includes('contagemDeContatosQualificados'));
  }
  const r=calcularCenarioPorContato(base(),opcoes);
  assert.equal(r.comparacaoAquisicao.custoPorContatoQualificado,null);
  assert.ok(r.comparacaoAquisicao.faltam.includes('custosAquisicao'));
});

test('limiar usa centavos inteiros e preserva extremos sem contribuição positiva',()=>{
  for(const [custo,contribuicao,esperado] of [
    [200.01,valor(10),[21,21]],
    [20,intervalo(0,10),[2,null]],
    [20,valor(-10),[null,null]],
    [1_000_000_000,valor(0.01),[100_000_000_000,100_000_000_000]],
  ]){
    const r=calcularCenarioPorContato(base({contribuicaoPorVenda:contribuicao,
      custosAquisicao:{escopo:'total_periodo_coorte',total:valor(custo)}}),opcoes);
    const c=r.comparacaoAquisicao.fechamentosParaCobrirAquisicao;
    assert.deepEqual([c.minimo,c.maximo],esperado);
  }
});
