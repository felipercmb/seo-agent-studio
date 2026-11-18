/**
 * Premissas por oferta, informadas pelo responsável ou transcritas de registros.
 * Funções puras: não leem registros, não fazem requisições e não prescrevem verba.
 * A declaração de procedência não é auditoria da fonte nem validação estatística.
 */
const MAX_DINHEIRO = 1_000_000_000;
const MAX_CONTATOS = 1_000_000_000;
const CAMPOS = ['versao', 'ofertaId', 'moeda', 'origem', 'periodo', 'coorte',
  'contribuicaoPorVenda', 'fechamento', 'custosAquisicao', 'custosFixos'];

export class ErroPremissaEconomica extends Error {
  constructor(campo, motivo) {
    super(`${campo}: ${motivo}`);
    this.name = 'ErroPremissaEconomica';
    this.campo = campo;
    this.codigo = 'premissa_economica_invalida';
  }
}

const falhar = (campo, motivo) => { throw new ErroPremissaEconomica(campo, motivo); };
const objeto = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const zero = n => Object.is(n, -0) ? 0 : n;

function chaves(v, permitidas, obrigatorias, campo) {
  if (!objeto(v) || Object.keys(v).some(k => !permitidas.includes(k)) ||
      obrigatorias.some(k => !Object.hasOwn(v, k))) falhar(campo, 'campos ausentes, desconhecidos ou objeto inválido.');
}

function texto(v, campo, maximo) {
  if (typeof v !== 'string' || v.length > maximo || !v.trim() || /[\p{Cc}\p{Cf}]/u.test(v)) {
    falhar(campo, `informe texto sem caracteres de controle, com até ${maximo} caracteres.`);
  }
  return v.trim().replace(/\s+/gu, ' ');
}

function numero(v, campo, minimo, maximo, {inteiro = false, dinheiro = false} = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < minimo || v > maximo ||
      (inteiro && !Number.isSafeInteger(v)) ||
      (dinheiro && Math.abs(v * 100 - Math.round(v * 100)) > 0.00001)) {
    falhar(campo, `informe um número ${inteiro ? 'inteiro ' : ''}entre ${minimo} e ${maximo}${dinheiro ? ', com até duas casas decimais' : ''}.`);
  }
  return zero(v);
}

function valorOuIntervalo(v, campo, minimo, maximo, dinheiro = false) {
  if (v === null || v === undefined) return null;
  if (!objeto(v)) falhar(campo, 'informe valor, intervalo ou null para desconhecido.');
  if (v.tipo === 'valor') {
    chaves(v, ['tipo', 'valor'], ['tipo', 'valor'], campo);
    return {tipo: 'valor', valor: numero(v.valor, `${campo}.valor`, minimo, maximo, {dinheiro})};
  }
  if (v.tipo === 'intervalo') {
    chaves(v, ['tipo', 'minimo', 'maximo'], ['tipo', 'minimo', 'maximo'], campo);
    const a = numero(v.minimo, `${campo}.minimo`, minimo, maximo, {dinheiro});
    const b = numero(v.maximo, `${campo}.maximo`, minimo, maximo, {dinheiro});
    if (a > b) falhar(campo, 'o mínimo não pode superar o máximo.');
    return {tipo: 'intervalo', minimo: a, maximo: b};
  }
  falhar(campo, 'tipo deve ser valor ou intervalo.');
}

function origem(v) {
  if (v === null || v === undefined) return null;
  chaves(v, ['tipo', 'referencia'], ['tipo', 'referencia'], 'origem');
  if (v.tipo === 'legado_sem_origem' && v.referencia === null) {
    return {tipo: 'legado_sem_origem', referencia: null};
  }
  if (!['declarada', 'registro_local'].includes(v.tipo)) falhar('origem.tipo', 'tipo desconhecido.');
  return {tipo: v.tipo, referencia: texto(v.referencia, 'origem.referencia', 240)};
}

function dataCivil(v, campo) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) falhar(campo, 'use uma data civil YYYY-MM-DD.');
  const t = Date.parse(`${v}T00:00:00.000Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== v) falhar(campo, 'data inexistente.');
  return v;
}

function periodo(v) {
  if (v === null || v === undefined) return null;
  chaves(v, ['inicio', 'fim'], ['inicio', 'fim'], 'periodo');
  const inicio = dataCivil(v.inicio, 'periodo.inicio'), fim = dataCivil(v.fim, 'periodo.fim');
  if (inicio > fim) falhar('periodo', 'início posterior ao fim.');
  return {inicio, fim};
}

function coorte(v) {
  if (v === null || v === undefined) return null;
  chaves(v, ['descricao', 'criterioQualificacao'], ['descricao', 'criterioQualificacao'], 'coorte');
  return {descricao: texto(v.descricao, 'coorte.descricao', 400),
    criterioQualificacao: texto(v.criterioQualificacao, 'coorte.criterioQualificacao', 400)};
}

function fechamento(v) {
  if (v === null || v === undefined) return null;
  if (objeto(v) && v.tipo === 'contagem') {
    chaves(v, ['tipo', 'contatosQualificados', 'fechamentos'], ['tipo', 'contatosQualificados', 'fechamentos'], 'fechamento');
    const contatosQualificados = numero(v.contatosQualificados, 'fechamento.contatosQualificados', 0, MAX_CONTATOS, {inteiro: true});
    const fechamentos = numero(v.fechamentos, 'fechamento.fechamentos', 0, MAX_CONTATOS, {inteiro: true});
    if (fechamentos > contatosQualificados) falhar('fechamento', 'fechamentos não podem superar contatos qualificados da mesma coorte.');
    return {tipo: 'contagem', contatosQualificados, fechamentos};
  }
  return valorOuIntervalo(v, 'fechamento', 0, 1);
}

function custo(v, campo, escopo) {
  if (v === null || v === undefined) return null;
  chaves(v, ['escopo', 'total'], ['escopo', 'total'], campo);
  if (v.escopo !== escopo) falhar(`${campo}.escopo`, `use ${escopo}.`);
  if (v.total == null) falhar(`${campo}.total`, 'informe o total ou mantenha todo o custo como null.');
  return {escopo, total: valorOuIntervalo(v.total, `${campo}.total`, 0, MAX_DINHEIRO, true)};
}

/**
 * Entrada v1 pode estar incompleta: null significa desconhecido, nunca zero.
 * Dados econômicos legados são transportados sem lhes atribuir procedência.
 * Retorno canônico pode ser persistido e normalizado novamente sem perda.
 */
export function normalizarPremissasEconomicas(entrada, {ofertaId = null} = {}) {
  if (ofertaId !== null) ofertaId = texto(ofertaId, 'ofertaId', 160);
  let v = entrada;
  if (v === null || v === undefined) v = {versao: 1};
  if (!objeto(v)) falhar('premissas', 'informe um objeto ou null.');
  const legado = !Object.hasOwn(v, 'versao') && Object.keys(v).length > 0 &&
    Object.keys(v).every(k => ['contribuicaoPorVenda', 'taxaFechamento'].includes(k));
  if (legado) {
    const contribuicao = v.contribuicaoPorVenda == null ? null : numero(v.contribuicaoPorVenda, 'contribuicaoPorVenda', -MAX_DINHEIRO, MAX_DINHEIRO);
    const taxa = v.taxaFechamento == null ? null : numero(v.taxaFechamento, 'taxaFechamento', 0, 1);
    v = {versao: 1, origem: {tipo: 'legado_sem_origem', referencia: null},
      contribuicaoPorVenda: contribuicao === null ? null : {tipo: 'valor', valor: contribuicao},
      fechamento: taxa === null ? null : {tipo: 'valor', valor: taxa}};
  }
  chaves(v, CAMPOS, ['versao'], 'premissas');
  if (v.versao !== 1) falhar('versao', 'versão não suportada.');
  const id = v.ofertaId == null ? ofertaId : texto(v.ofertaId, 'ofertaId', 160);
  if (ofertaId !== null && id !== ofertaId) falhar('ofertaId', 'as premissas pertencem a outra oferta.');
  if (v.moeda != null && v.moeda !== 'BRL') falhar('moeda', 'somente BRL é suportado, sem conversão cambial implícita.');
  return {versao: 1, ofertaId: id, moeda: 'BRL', origem: origem(v.origem), periodo: periodo(v.periodo), coorte: coorte(v.coorte),
    contribuicaoPorVenda: valorOuIntervalo(v.contribuicaoPorVenda, 'contribuicaoPorVenda', -MAX_DINHEIRO, MAX_DINHEIRO,
      !legado && v.origem?.tipo !== 'legado_sem_origem'),
    fechamento: fechamento(v.fechamento),
    custosAquisicao: custo(v.custosAquisicao, 'custosAquisicao', 'total_periodo_coorte'),
    custosFixos: custo(v.custosFixos, 'custosFixos', 'total_periodo_empresa')};
}

function taxaDoFechamento(v) {
  if (v === null) return {base: 'desconhecida', valor: null, amostra: null};
  if (v.tipo === 'contagem') return {base: 'contagem_informada',
    valor: v.contatosQualificados > 0 ? {tipo: 'valor', valor: v.fechamentos / v.contatosQualificados} : null,
    amostra: {contatosQualificados: v.contatosQualificados, fechamentos: v.fechamentos}};
  return {base: v.tipo === 'intervalo' ? 'intervalo_declarado' : 'taxa_declarada', valor: {...v}, amostra: null};
}

const extremos = v => v.tipo === 'valor' ? [v.valor, v.valor] : [v.minimo, v.maximo];
function centavosSemRuido(n) {
  const arredondado = Math.round(n);
  return Math.abs(n - arredondado) <= Number.EPSILON * Math.max(1, Math.abs(n)) * 4 ? arredondado : n;
}
function produto(contribuicao, taxa) {
  const c = extremos(contribuicao).map(v => Math.round(v * 100)), t = extremos(taxa);
  const produtos = [c[0] * t[0], c[0] * t[1], c[1] * t[0], c[1] * t[1]].map(centavosSemRuido);
  if (contribuicao.tipo === 'valor' && taxa.tipo === 'valor') {
    return {tipo: 'valor', valor: zero(Math.sign(produtos[0]) * Math.round(Math.abs(produtos[0])) / 100)};
  }
  // Arredondamento para fora preserva o envelope, inclusive contribuição negativa.
  return {tipo: 'intervalo', minimo: zero(Math.floor(Math.min(...produtos)) / 100),
    maximo: zero(Math.ceil(Math.max(...produtos)) / 100)};
}

function porContatoEmCentavos(minimo,maximo,contatos,intervalar){
  if(!intervalar){
    const absoluto=minimo<0n?-minimo:minimo;
    const centavos=(2n*absoluto+contatos)/(2n*contatos);
    return {tipo:'valor',valor:zero(Number(minimo<0n?-centavos:centavos)/100)};
  }
  const piso=minimo/contatos-(minimo%contatos<0n?1n:0n);
  const teto=maximo/contatos+(maximo%contatos>0n?1n:0n);
  return {tipo:'intervalo',minimo:Number(piso)/100,maximo:Number(teto)/100};
}

function fechamentosNecessarios(custo,contribuicao){
  if(custo===0n)return 0;
  if(contribuicao<=0n)return null;
  return Number((custo+contribuicao-1n)/contribuicao);
}

function compararAquisicao(p,amostra,cenarioCompleto){
  const faltam=[];
  if(!p.custosAquisicao)faltam.push('custosAquisicao');
  if(!amostra?.contatosQualificados)faltam.push('contagemDeContatosQualificados');
  if(!cenarioCompleto)faltam.push('premissasDoCenario');
  if(faltam.length)return{estado:'incompleto',faltam,custoPorContatoQualificado:null,diferencaAntesDosFixos:null,
    fechamentosParaCobrirAquisicao:null};
  const contatos=BigInt(amostra.contatosQualificados),fechamentos=BigInt(amostra.fechamentos);
  const centavos=v=>BigInt(Math.round(v*100));
  const custo=p.custosAquisicao.total,contribuicao=p.contribuicaoPorVenda;
  const [a,b]=extremos(custo).map(centavos);
  const [c,d]=extremos(contribuicao).map(centavos);
  const [menor,maior]=[c*fechamentos-b,d*fechamentos-a];
  const estado=maior<0n?'aquisicao_acima_da_contribuicao':
    menor>0n?'contribuicao_acima_da_aquisicao':
    menor===0n&&maior===0n?'equilibrio_nas_premissas':'faixa_inclui_equilibrio';
  return {estado,faltam:[],natureza:'comparacao_condicional',moeda:'BRL',unidade:'contato_qualificado',
    custoPorContatoQualificado:porContatoEmCentavos(a,b,contatos,custo.tipo==='intervalo'),
    diferencaAntesDosFixos:porContatoEmCentavos(menor,maior,contatos,
      contribuicao.tipo==='intervalo'||custo.tipo==='intervalo'),
    fechamentosParaCobrirAquisicao:b===0n?null:{
      minimo:fechamentosNecessarios(a,d),maximo:fechamentosNecessarios(b,c),
      contatosQualificados:amostra.contatosQualificados,
      natureza:'limiar_condicional',antesDosFixos:true,
    },
    formula:'(contribuicaoPorVenda × fechamentos − custoAquisicaoTotal) ÷ contatosQualificados',
    escopo:'mesma_oferta_coorte_e_periodo_informados',atribuiAConsulta:false,verificacao:'nao_auditada'};
}

/**
 * Cenário condicional por contato QUALIFICADO da coorte e da oferta informadas.
 * A frequência observada não é previsão; intervalos são limites declarados, não IC.
 * Aquisição só é comparada quando há contagem da coorte e custo para o
 * mesmo grupo. Fixos da empresa e atribuição à consulta ficam fora da conta.
 */
export function calcularCenarioPorContato(entrada, {ofertaId = null, perfilConfirmado = false, agora = Date.now} = {}) {
  if (typeof perfilConfirmado !== 'boolean') falhar('perfilConfirmado', 'informe true ou false.');
  const instante = typeof agora === 'function' ? agora() : agora;
  if (typeof instante !== 'number' || !Number.isFinite(instante) || !Number.isFinite(new Date(instante).getTime())) {
    falhar('agora', 'instante inválido para conferir o período.');
  }
  const p = normalizarPremissasEconomicas(entrada, {ofertaId}), taxa = taxaDoFechamento(p.fechamento), faltam = [];
  const legado = p.origem?.tipo === 'legado_sem_origem';
  if (!p.ofertaId) faltam.push('ofertaId');
  if (!perfilConfirmado) faltam.push('perfilConfirmado');
  if (!p.origem || legado) faltam.push('origem');
  if (!p.periodo) faltam.push('periodo');
  if (p.periodo && p.periodo.fim > new Date(instante).toISOString().slice(0, 10)) {
    falhar('periodo.fim', 'o período de referência não pode terminar no futuro.');
  }
  if (!p.coorte) faltam.push('coorte');
  if (!p.contribuicaoPorVenda) faltam.push('contribuicaoPorVenda');
  if (!taxa.valor) faltam.push(p.fechamento?.tipo === 'contagem' ? 'amostraComContatosQualificados' : 'fechamento');
  const calculo = faltam.length === 0 ? produto(p.contribuicaoPorVenda, taxa.valor) : null;
  return {versao: 1, ofertaId: p.ofertaId, estado: legado ? 'legado_sem_origem' : faltam.length ? 'incompleto' : 'cenario_condicional',
    premissas: p, taxaFechamento: taxa,
    procedencia: {tipo: p.origem?.tipo || 'desconhecida', referencia: p.origem?.referencia || null,
      verificacao: 'nao_auditada', registroLocalLido: false, perfilConfirmado},
    contribuicaoPorContatoQualificado: calculo === null ? null : {...calculo, moeda: 'BRL', unidade: 'contato_qualificado',
      natureza: 'cenario_condicional', formula: 'contribuicaoPorVenda × taxaFechamento',
      escopo: 'oferta_e_coorte', antesDeAquisicaoEFixos: true, intervaloDeConfianca: false},
    custos: {aquisicao: p.custosAquisicao, fixos: p.custosFixos, deduzidos: false},
    comparacaoAquisicao:compararAquisicao(p,taxa.amostra,calculo!==null), faltam,
    limites: [
      'Premissas e origem são informações fornecidas; este módulo não leu nem auditou registros locais. Confirmação do perfil não comprova os números.',
      'A contagem, quando fornecida, é uma frequência da mesma coorte: contatos qualificados distintos e quantos deles fecharam. Não demonstra causalidade nem probabilidade futura.',
      'O cenário depende de contatos com o mesmo perfil e de contribuição representativa das vendas dessa oferta. Considera uma venda por contato que fecha; recompras e múltiplas vendas não foram modeladas. Não estima quantidade de contatos ou receita.',
      'Contatos ainda em negociação podem reduzir a frequência de fechamento no período. A janela de acompanhamento e a maturação dos contatos precisam de revisão antes de comparar coortes.',
      'Intervalos são envelopes das premissas declaradas, sem distribuição de probabilidade, nível de confiança ou correlação modelados.',
      'A contribuição por venda deve ser o valor que fica na própria empresa após custos variáveis de entrega, excluindo os custos de aquisição e fixos mostrados separadamente. Em intermediação, use sua comissão líquida desses custos de entrega, não o contrato integral.',
      'Com contagens e custo total da mesma coorte, a comparação divide custo e diferença pelo número de contatos qualificados. Custos fixos pertencem à empresa e ficam fora dessa conta.',
      'O limiar de fechamentos divide aquisição total pela contribuição por venda e arredonda para cima. Quando há gasto e a contribuição daquele cenário é zero ou negativa, o limiar fica indefinido. O custo de aquisição é mantido fixo no grupo declarado.',
      'Não multiplique este cenário por volume de busca, cliques ou posição; não é valor de palavra-chave, ROI atribuído nem recomendação de verba.',
      'Custos ou premissas desconhecidos permanecem null. Valores zero ou negativos explícitos não são convertidos em ausência.',
    ]};
}
