import {createHash} from 'node:crypto';
import {analisarOportunidades} from '../agente.mjs';
import {prepararEntradasIA} from '../entrada-ia.mjs';
import {selecionarContextosNegocio} from './selecao-contextos.mjs';

const HORA = 3600_000;
const ACOES = new Set(['confirmar_publicacao','corrigir_indexacao','melhorar_pagina','validar_demanda',
  'medir_conversao','validar_intencao','atualizar_coleta','acompanhar','comparar_concorrentes','preservar_exclusao']);
const hash = valor => createHash('sha256').update(JSON.stringify(valor)).digest('hex');

// O perfil orienta a revisão como declaração/hipótese. Continua separado das
// evidências públicas e nunca vira fato do Google ou premissa financeira.
export function prepararIAProjeto(projeto, {agora = Date.now} = {}) {
  const candidatos = projeto.palavras.candidatos.filter(c => c.origem === 'site');
  const posicoes = {...(projeto.posicoes || {}), versao:2, dominio:projeto.dominio,
    candidatos, consultas:projeto.posicoes?.consultas || [],
    descoberta: {...projeto.descoberta.cobertura, coletadoEm:projeto.coletadoEm}};
  const relatorio = analisarOportunidades({dominio:projeto.dominio, posicoes,
    diagnostico:projeto.diagnostico}, {agora});
  if (!projeto.posicoes) relatorio.fontePosicoes.estado = projeto.capacidades?.posicoes?.configurada === false
    ? 'nao_configurada' : 'sem_relatorio';
  // A seleção anterior era reordenada alfabeticamente pelo motor legado e
  // podia enviar slogans/temporizadores antes da oferta real. O vínculo com
  // a oferta só orienta a escolha dos contextos; não vira evidência do modelo.
  const prioridade = new Map(candidatos.map((c,i) => [c.termo.toLocaleLowerCase('pt-BR'),
    (c.ofertaId ? 0 : 1000)+(c.intencao === 'comercial' ? 0 : 200)+i]));
  relatorio.oportunidades.sort((a,b) => (prioridade.get(a.termo.toLocaleLowerCase('pt-BR')) ?? 2000)-
    (prioridade.get(b.termo.toLocaleLowerCase('pt-BR')) ?? 2000));
  const foco=selecionarContextosNegocio(projeto,relatorio,{agora});
  const entrada = prepararEntradasIA(foco.relatorio, {agora});
  if(entrada.entradas.every(e=>e.evidencias.length===0))entrada.entradas=[];
  for(const contexto of entrada.entradas){
    const termo=contexto.evidencias.find(e=>e.tipo==='serp')?.termo;
    const candidato=candidatos.find(c=>c.termo===termo);
    const oferta=candidato?.ofertaId ? projeto.perfil?.ofertas?.find(o=>o.id===candidato.ofertaId) : null;
    const atividade=projeto.perfil?.entendimento?.atuacoes?.find(a=>candidato?.atuacaoId && a.id===candidato.atuacaoId || termo && a.nome===termo);
    const papel=projeto.perfil?.entendimento?.papel,finalidade=projeto.perfil?.entendimento?.finalidade;
    contexto.contexto_negocio={natureza:'contexto_revisavel_nao_e_evidencia_google',
      papel:['intermediacao','servicos','produtos','misto','indefinido'].includes(papel)?papel:'indefinido',
      finalidade:['comercial','social','indefinida'].includes(finalidade?.tipo)?finalidade.tipo:'indefinida',
      atuacao:typeof (oferta?.nome || atividade?.nome)==='string'?(oferta?.nome || atividade.nome).slice(0,120):null,
      tipoAtuacao:atividade && !oferta?'atividade_nao_comercial':oferta?'oferta':'a_esclarecer',
      publicoDeclarado:projeto.perfil?.estado==='confirmado' && typeof projeto.perfil.publico==='string'?projeto.perfil.publico.slice(0,240):null};
  }
  return {entrada, hashEntrada:hash(entrada),selecao:{...foco.selecao,contextos:entrada.entradas.length}};
}

export function registrarContextoInsuficiente(projeto, entrada, {agora=Date.now}={}) {
  return {versao:1,estado:'sem_contexto',geradoEm:new Date(agora()).toISOString(),
    hashEntrada:entrada.hashEntrada,revisaoOrigem:projeto.revisao,selecao:entrada.selecao,
    resultados:[],contextos:[],
    limite:'Não há oferta ou atividade publicada relacionada nem diretiva verificável suficiente para este piloto. Revise o que o negócio oferece, a página correspondente e a cobertura da leitura. O plano local e as atividades declaradas continuam disponíveis; nenhuma inferência do modelo foi executada.'};
}

function semSuporte(resultado, contexto) {
  if (resultado.estado === 'recusada') return null;
  const escolha = resultado.escolha_ia;
  const referenciadas = contexto.evidencias.filter(e => escolha.evidencias.includes(e.id));
  const pagina = referenciadas.some(e => e.id === 'p1' && e.tipo === 'pagina' && e.atual && e.sha256_pagina);
  const serp = referenciadas.find(e => e.tipo === 'serp' && e.atual && Number.isInteger(e.posicao));
  const diagnostico = referenciadas.find(e => e.id === 'd1' && e.tipo === 'pagina' && e.atual && e.sha256_pagina);
  const acao = escolha.acao;
  if (acao === 'comparar_concorrentes' && (!serp || !serp.concorrentes?.length)) return 'Faltam posição e concorrentes atuais citados para comparar.';
  if (acao === 'acompanhar' && !serp) return 'Falta posição atual citada para acompanhar.';
  if (acao === 'melhorar_pagina' && !diagnostico) return 'Falta diagnóstico específico e atual citado para indicar uma correção na página.';
  if (acao === 'validar_demanda' && !pagina) return 'Falta trecho publicado e atual citado para investigar a procura desta expressão.';
  if (acao === 'validar_intencao' && (!pagina || !serp)) return 'A conferência da intenção precisa citar página e consulta atuais.';
  if (acao === 'medir_conversao' && referenciadas.length && !referenciadas.some(e => e.tipo === 'negocio')) return 'Evidências de página ou posição não são registros de conversões do negócio.';
  if (acao === 'atualizar_coleta' && contexto.evidencias.some(e => e.tipo === 'serp') &&
      !referenciadas.some(e => e.tipo === 'serp')) return 'A verificação da coleta deve citar o estado da fonte de posições.';
  if (acao === 'confirmar_publicacao' && !referenciadas.some(e => e.atual && e.sha256_pagina &&
      ['meta_robots_noindex','http_robots_noindex'].includes(e.verificacao?.tipo))) return 'Falta diretiva de indexação observada e citada para conferir a publicação.';
  if (acao === 'corrigir_indexacao' && !referenciadas.some(e => e.atual && e.verificacao?.intencao === 'indevida_confirmada')) return 'Uma correção de indexação exige confirmação de que a exclusão é indevida.';
  if (acao === 'preservar_exclusao' && !referenciadas.some(e => e.atual && e.verificacao?.intencao === 'deliberada')) return 'A preservação da exclusão depende da intenção confirmada pelo responsável.';
  return null;
}

export function registrarIAProjeto(projeto, resultado, entrada, {agora = Date.now, modoEsperado} = {}) {
  const modelo=resultado?.modelo;
  if(modelo!=null && (modelo.versao!==1 || !['padrao','candidata'].includes(modelo.modo) ||
    modoEsperado && modelo.modo!==modoEsperado ||
    ['selecaoSha256','adaptadorSha256','configSha256'].some(k=>typeof modelo[k]!=='string' || !/^[a-f0-9]{64}$/.test(modelo[k])) ||
    Object.keys(modelo).some(k=>!['versao','modo','selecaoSha256','adaptadorSha256','configSha256'].includes(k)))){
    throw new Error('Identificação do modelo local incompatível.');
  }
  if (!resultado || resultado.versao !== 1 || resultado.estado !== 'experimental' ||
      !Array.isArray(resultado.resultados) || resultado.resultados.length !== entrada.entrada.entradas.length ||
      resultado.resultados.some((r, i) => !r || !['revisao_necessaria','recusada'].includes(r.estado) ||
        !['regra','ia'].includes(r.origem) || r.estado === 'revisao_necessaria' &&
          (!ACOES.has(r.escolha_ia?.acao) || !Array.isArray(r.escolha_ia?.evidencias) ||
            r.escolha_ia.evidencias.some(id => !entrada.entrada.entradas[i].evidencias.some(e => e.id === id))))) {
    throw new Error('Resposta experimental incompatível.');
  }
  return {versao:1, estado:'experimental', geradoEm:new Date(agora()).toISOString(),
    ...(modelo ? {modelo:{...modelo}} : {}),
    hashEntrada:entrada.hashEntrada, revisaoOrigem:projeto.revisao, selecao:entrada.selecao,
    resultados:resultado.resultados.map((r,i) => {
      const motivo = semSuporte(r, entrada.entrada.entradas[i]);
      return motivo ? {...r,estado:'recusada',recusadaPelaIntegracao:true,
        motivos_aplicabilidade:[...(r.motivos_aplicabilidade || []),motivo]} : r;
    }), contextos:entrada.entrada.entradas,
    limite:'Piloto local sobre até três contextos de evidências públicas, com contexto revisável da atuação. Exige revisão humana e não decide investimento nem recebe os campos financeiros deste perfil.'};
}

export function estadoIAProjeto(projeto, {agora = Date.now} = {}) {
  if (!projeto.ia) return null;
  const gerada = Date.parse(projeto.ia.geradoEm);
  const atual = Number.isFinite(gerada) && gerada <= agora() && agora()-gerada < HORA &&
    prepararIAProjeto(projeto, {agora}).hashEntrada === projeto.ia.hashEntrada;
  return atual ? projeto.ia : {...projeto.ia, estado:'historica',
    aviso:'As evidências ou sua validade mudaram. Esta resposta é histórica; execute novamente para analisar o estado atual.'};
}
