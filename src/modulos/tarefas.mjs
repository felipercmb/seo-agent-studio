import {createHash} from 'node:crypto';
import {normalizarSite} from '../consulta.mjs';
import {ErroProjeto} from './repositorio.mjs';

export const LIMITES_TAREFAS = Object.freeze({ativas:64, itens:256, eventos:2048, bytes:2 * 1024 * 1024});
export const FONTE_TAREFA_GOOGLE = 'google_local.pagina_aberta';
const ESTADOS = new Set(['pendente', 'em_andamento', 'concluida', 'descartada']);
const TRANSICOES = {pendente:['em_andamento','concluida','descartada'], em_andamento:['pendente','concluida','descartada'],
  concluida:['pendente'], descartada:['pendente']};
const CAMPOS_EDICAO = ['estado','responsavel','nota','implementadoEm','verificacao'];
const CAMPOS_ITEM = ['id','revisao','estado','arquivada','responsavel','nota','implementadoEm','verificacao','origem','criadaEm','atualizadaEm'];
const OBJETO = x => x !== null && typeof x === 'object' && !Array.isArray(x) && [Object.prototype,null].includes(Object.getPrototypeOf(x));
const falhar = (mensagem, status=400) => { throw new ErroProjeto(mensagem, status); };
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const igual = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const clonar = x => structuredClone(x);
const inteiro = x => Number.isSafeInteger(x) && x >= 0;
function campos(x, permitidos, nome) {
  if (!OBJETO(x) || Object.keys(x).some(k => !permitidos.includes(k))) falhar(`${nome}: campos inválidos.`);
}
function texto(x, maximo, nome, vazio=false) {
  if (typeof x !== 'string' || x.length > maximo || /[\p{Cc}\p{Cf}]/u.test(x) || !vazio && !x.trim()) falhar(`${nome}: texto inválido.`);
  return x.trim();
}
function identificador(x, nome='Identificador') {
  if (typeof x !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(x)) falhar(`${nome} inválido.`);
  return x;
}
function data(x, maximo, nome) {
  if (typeof x !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x) ||
      !Number.isFinite(Date.parse(x)) || new Date(x).toISOString().slice(0,19) !== x.slice(0,19) || Date.parse(x) > maximo) falhar(`${nome}: data UTC inválida ou futura.`);
  return new Date(x).toISOString();
}
function instante(agora) {
  const n = typeof agora === 'function' ? agora() : NaN;
  if (!Number.isSafeInteger(n) || !Number.isFinite(new Date(n).getTime())) falhar('Relógio inválido.');
  return n;
}
function dominioValido(valor) {
  try { return normalizarSite(valor); } catch { falhar('Domínio inválido.'); }
}
function urlDoDominio(x, dominio) {
  if (typeof x !== 'string' || x.length > 2048 || /[\p{Cc}\p{Cf}\\\s?#]/u.test(x)) falhar('URL de verificação inválida.');
  let u, host;
  try { u = new URL(x); host = normalizarSite(x); } catch { falhar('URL de verificação inválida.'); }
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.port || u.search || u.hash ||
      host !== dominio && !host.endsWith('.' + dominio)) falhar('A URL deve pertencer ao domínio do projeto, sem parâmetros ou credenciais.');
  return u.href;
}
function listaTextos(x, maxItens, maxTexto, nome) {
  if (x == null) return [];
  if (!Array.isArray(x) || x.length > maxItens) falhar(`${nome}: limite excedido.`);
  const r = x.map(t => texto(t,maxTexto,nome));
  if (new Set(r).size !== r.length) falhar(`${nome}: valores repetidos.`);
  return r;
}

// Recebe o plano produzido pelo servidor. Projeta somente os campos necessários;
// objetos extras do plano não são copiados para o registro editável.
function origemDoPlano(plano, dominio, agora) {
  if (!OBJETO(plano)) falhar('Tarefa do plano inválida.');
  const id = identificador(plano.id), referencias = [], vistos = new Set();
  const evidencias = plano.evidencias ?? [];
  if (!Array.isArray(evidencias) || evidencias.length > 32) falhar('Referências da tarefa excedem o limite.');
  for (const e of evidencias) {
    if (!OBJETO(e)) falhar('Referência de origem inválida.');
    const ref = {url:e.url == null ? null : urlDoDominio(e.url,dominio),
      fonteId:e.fonteId == null ? null : identificador(e.fonteId,'Fonte'),
      campo:e.campo == null ? null : texto(e.campo,120,'Campo da fonte'),
      sha256:e.sha256 == null ? null : texto(e.sha256,64,'Hash da fonte'),
      coletadoEm:e.coletadoEm == null ? null : data(e.coletadoEm,agora,'Data da fonte'),
      trecho:e.trecho == null ? null : texto(e.trecho,4000,'Trecho da fonte')};
    if (ref.sha256 !== null && !/^[a-f0-9]{64}$/.test(ref.sha256)) falhar('Hash da fonte inválido.');
    if (!ref.url && !ref.fonteId && !ref.trecho) continue;
    const k=JSON.stringify(ref); if (!vistos.has(k)) { vistos.add(k); referencias.push(ref); }
  }
  const pagina = plano.paginaAlvo?.url == null ? null : urlDoDominio(plano.paginaAlvo.url,dominio);
  const conteudo = {tipo:texto(plano.tipo,100,'Tipo da tarefa'),titulo:texto(plano.titulo,1200,'Título'),
    acao:texto(plano.acao,6000,'Ação'),criterioSucesso:texto(plano.criterioSucesso,6000,'Critério'),
    passos:listaTextos(plano.passos,16,6000,'Passos'),paginaAlvo:pagina,
    base:plano.base === 'observacao' ? 'observado' : 'hipotese',
    eixo:plano.eixo == null ? null : texto(plano.eixo,100,'Eixo'),
    referencias};
  // Captures have different IDs even when only the time changed. Keep the
  // original reference on the saved task when scope and content still match.
  const assinatura = {...conteudo, referencias:referencias.map(({coletadoEm,...r}) =>
    r.campo === FONTE_TAREFA_GOOGLE && r.sha256 && conteudo.tipo === 'conferir_busca_observada'
      ? {...r, fonteId:null}
      : r)};
  return {id,conteudo,hash:hash(assinatura)};
}

function medida(x) {
  campos(x,['indicador','tipo','valor','unidade'],'Medida');
  const indicador=texto(x.indicador,160,'Indicador'), unidade=texto(x.unidade,80,'Unidade');
  if (!['numero','booleano','texto'].includes(x.tipo)) falhar('Tipo de medida inválido.');
  if (x.valor !== null && (x.tipo==='numero' ? typeof x.valor!=='number'||!Number.isFinite(x.valor)||Math.abs(x.valor)>Number.MAX_SAFE_INTEGER :
      x.tipo==='booleano' ? typeof x.valor!=='boolean' : typeof x.valor!=='string'||!x.valor.trim()||x.valor.length>2000||/[\p{Cc}\p{Cf}]/u.test(x.valor))) falhar('Valor incompatível com o tipo da medida.');
  if (x.valor === undefined) falhar('Informe o valor da medida ou null quando desconhecido.');
  return {indicador,tipo:x.tipo,valor:typeof x.valor==='string'?x.valor.trim():x.valor,unidade};
}
function verificacao(x, origem, dominio, agora, implementadoEm) {
  campos(x,['metodo','evidencia','verificadoEm','url','resultado','medida'],'Verificação');
  const verificadoEm=data(x.verificadoEm,agora,'Data da verificação');
  if (!implementadoEm || Date.parse(verificadoEm)<Date.parse(implementadoEm)) falhar('A verificação deve ocorrer depois da implementação.');
  if (!['confirmado','nao_confirmado','inconclusivo'].includes(x.resultado)) falhar('Resultado da verificação inválido.');
  const m=medida(x.medida);
  if (m.valor === null) falhar('A conclusão exige uma medida registrada; valor desconhecido não conclui a tarefa.');
  const url=x.url == null ? null : urlDoDominio(x.url,dominio);
  if (origem.paginaAlvo && url!==origem.paginaAlvo) falhar('Verifique a mesma URL da tarefa.');
  return {natureza:'declarado',criterio:origem.criterioSucesso,
    metodo:texto(x.metodo,2000,'Método'),evidencia:texto(x.evidencia,4000,'Evidência declarada'),
    verificadoEm,url,resultado:x.resultado,medida:m};
}

function conferirItem(item, dominio, agora) {
  campos(item,CAMPOS_ITEM,'Tarefa salva');
  identificador(item.id);
  if (!inteiro(item.revisao)||item.revisao<1||!ESTADOS.has(item.estado)||typeof item.arquivada!=='boolean') falhar('Estado da tarefa inválido.');
  if (item.responsavel!==null) texto(item.responsavel,120,'Responsável');
  texto(item.nota,4000,'Nota',true);
  data(item.criadaEm,agora,'Criação'); data(item.atualizadaEm,agora,'Atualização');
  if (Date.parse(item.atualizadaEm)<Date.parse(item.criadaEm)) falhar('Datas da tarefa incompatíveis.');
  const o=item.origem;
  campos(o,['versao','hash','tipo','titulo','acao','criterioSucesso','passos','paginaAlvo','base','eixo','referencias'],'Origem salva');
  if (!inteiro(o.versao)||o.versao<1||!['hipotese','observado'].includes(o.base)) falhar('Versão ou natureza da origem inválida.');
  const reconstruida=origemDoPlano({...o,id:item.id,base:o.base==='observado'?'observacao':'hipotese',paginaAlvo:o.paginaAlvo?{url:o.paginaAlvo}:null,evidencias:o.referencias},dominio,agora);
  if (reconstruida.hash!==o.hash||!igual(reconstruida.conteudo,(({versao,hash,...r})=>r)(o))) falhar('A origem salva não confere com seu conteúdo.');
  const implementadoEm=item.implementadoEm===null?null:data(item.implementadoEm,agora,'Implementação');
  if (item.verificacao!==null) {
    const {natureza,criterio,...v}=item.verificacao;
    if (natureza!=='declarado'||criterio!==o.criterioSucesso||!igual(verificacao(v,o,dominio,agora,implementadoEm),item.verificacao)) falhar('Verificação salva incompatível.');
  }
  if (item.estado==='concluida'&&(!implementadoEm||!item.verificacao)) falhar('Conclusão sem implementação e verificação.');
  if (item.estado!=='concluida'&&item.verificacao!==null) falhar('Somente uma tarefa concluída contém verificação final.');
}

function preparar(estado, dominio, agora) {
  if (estado == null) return {versao:1,dominio,revisao:0,itens:[],historico:[]};
  campos(estado,['versao','dominio','revisao','itens','historico'],'Registro de tarefas');
  if (estado.versao!==1||estado.dominio!==dominio||!inteiro(estado.revisao)||!Array.isArray(estado.itens)||
      !Array.isArray(estado.historico)||estado.itens.length>LIMITES_TAREFAS.itens||estado.historico.length>LIMITES_TAREFAS.eventos) falhar('Registro de tarefas incompatível.');
  conferirTamanho(estado);
  const ids=new Set(); for (const t of estado.itens) {conferirItem(t,dominio,agora);if(ids.has(t.id))falhar('Tarefas duplicadas.');ids.add(t.id);}
  const reconstruidos=new Map();let anterior=null,tempo=-Infinity,revisao=0;
  for (const [i,e] of estado.historico.entries()) {
    campos(e,['seq','tarefaId','tipo','em','revisaoColecao','revisaoTarefa','natureza','alteracoes','hashAnterior','hash'],'Evento salvo');
    const {hash:hashEvento,...corpo}=e;
    if (e.seq!==i+1||e.hashAnterior!==anterior||hash(corpo)!==hashEvento||!inteiro(e.revisaoColecao)||
        e.revisaoColecao<revisao||e.revisaoColecao>revisao+1||e.revisaoColecao<1) falhar('Histórico de tarefas inconsistente.');
    const em=data(e.em,agora,'Evento');if(Date.parse(em)<tempo)falhar('Eventos fora de ordem temporal.');
    if(!['criada','origem_atualizada','arquivada','reativada','atualizada'].includes(e.tipo)||
        e.natureza!==(e.tipo==='atualizada'?'declarado':'registro_sistema'))falhar('Evento de tarefas inválido.');
    identificador(e.tarefaId);campos(e.alteracoes,CAMPOS_ITEM.filter(k=>!['id','revisao','criadaEm','atualizadaEm'].includes(k)),'Alterações salvas');
    const antes=reconstruidos.get(e.tarefaId);
    if ((e.tipo==='criada')!==!antes||e.revisaoTarefa!==(antes?.revisao||0)+1) falhar('Revisão de tarefa inconsistente.');
    const depois={...(antes||{id:e.tarefaId,criadaEm:em}),...e.alteracoes,revisao:e.revisaoTarefa,atualizadaEm:em};
    conferirItem(depois,dominio,agora);reconstruidos.set(e.tarefaId,depois);
    anterior=e.hash;tempo=Date.parse(em);revisao=e.revisaoColecao;
  }
  if(revisao!==estado.revisao||reconstruidos.size!==estado.itens.length||estado.itens.some(t=>!igual(t,reconstruidos.get(t.id))))falhar('O estado atual diverge do histórico preservado.');
  return clonar(estado);
}
function conferirTamanho(estado) {
  if (Buffer.byteLength(JSON.stringify(estado))>LIMITES_TAREFAS.bytes) falhar('O histórico de tarefas atingiu o limite local. Exporte e preserve o registro antes de revisar a retenção; nenhum evento foi descartado.',413);
}
function evento(estado, tarefaId, tipo, alteracoes, agora, revisaoColecao) {
  if (estado.historico.length>=LIMITES_TAREFAS.eventos) falhar('O histórico de tarefas atingiu o limite de eventos; nenhum registro foi descartado.',413);
  const anterior=estado.itens.find(t=>t.id===tarefaId),em=new Date(agora).toISOString();
  if (estado.historico.length&&Date.parse(estado.historico.at(-1).em)>agora) falhar('O relógio é anterior ao último evento.');
  const corpo={seq:estado.historico.length+1,tarefaId,tipo,em,revisaoColecao,
    revisaoTarefa:(anterior?.revisao||0)+1,natureza:tipo==='atualizada'?'declarado':'registro_sistema',alteracoes:clonar(alteracoes),hashAnterior:estado.historico.at(-1)?.hash||null};
  const atual={...(anterior||{id:tarefaId,criadaEm:em}),...clonar(alteracoes),revisao:corpo.revisaoTarefa,atualizadaEm:em};
  if(anterior)estado.itens[estado.itens.findIndex(t=>t.id===tarefaId)]=atual;else estado.itens.push(atual);
  estado.historico.push({...corpo,hash:hash(corpo)});estado.revisao=revisaoColecao;
}

/** Pura: sincronização idempotente. Não grava, não consulta e não apaga histórico. */
export function sincronizarTarefas(estadoAnterior, planoDeAcao, {dominio,agora=Date.now}={}) {
  dominio=dominioValido(dominio);const n=instante(agora),estado=preparar(estadoAnterior,dominio,n),revisao=estado.revisao+1;
  if (!Array.isArray(planoDeAcao)||planoDeAcao.length>LIMITES_TAREFAS.ativas) falhar('O plano aceita até 64 tarefas ativas.');
  const origens=planoDeAcao.map(p=>origemDoPlano(p,dominio,n)),ids=new Set(origens.map(o=>o.id));
  if(ids.size!==origens.length)falhar('O plano contém identificadores de tarefa repetidos.');
  if(new Set([...estado.itens.map(t=>t.id),...ids]).size>LIMITES_TAREFAS.itens)falhar('O limite de tarefas preservadas foi atingido; nenhuma tarefa foi apagada.',413);
  for(const o of origens){
    const t=estado.itens.find(t=>t.id===o.id);
    if(!t)evento(estado,o.id,'criada',{estado:'pendente',arquivada:false,responsavel:null,nota:'',implementadoEm:null,verificacao:null,
      origem:{versao:1,hash:o.hash,...o.conteudo}},n,revisao);
    else if(t.origem.hash!==o.hash)evento(estado,o.id,'origem_atualizada',{origem:{versao:t.origem.versao+1,hash:o.hash,...o.conteudo},
      estado:'pendente',arquivada:false,implementadoEm:null,verificacao:null},n,revisao);
    else if(t.arquivada)evento(estado,o.id,'reativada',{arquivada:false},n,revisao);
  }
  for(const t of [...estado.itens])if(!ids.has(t.id)&&!t.arquivada)evento(estado,t.id,'arquivada',{arquivada:true},n,revisao);
  conferirTamanho(estado);return estado;
}

/** A conclusão registra uma declaração verificável, jamais uma observação automática. */
export function atualizarTarefa(estadoAnterior, alteracao, {dominio,agora=Date.now}={}) {
  dominio=dominioValido(dominio);const n=instante(agora),estado=preparar(estadoAnterior,dominio,n);
  campos(alteracao,['id','revisao',...CAMPOS_EDICAO],'Edição da tarefa');identificador(alteracao.id);
  if(!inteiro(alteracao.revisao)||alteracao.revisao<1)falhar('Abra a revisão atual da tarefa antes de editar.');
  const t=estado.itens.find(t=>t.id===alteracao.id);if(!t)falhar('Tarefa não encontrada.',404);
  if(t.revisao!==alteracao.revisao)falhar('A tarefa mudou. Abra a revisão atual antes de editar.',409);
  if(t.arquivada)falhar('A tarefa está arquivada porque saiu do plano atual.',409);
  const novo={...t};
  if(Object.hasOwn(alteracao,'estado')){
    if(!ESTADOS.has(alteracao.estado))falhar('Estado de tarefa inválido.');
    if(alteracao.estado!==t.estado&&!TRANSICOES[t.estado].includes(alteracao.estado))falhar('Reabra a tarefa como pendente antes dessa transição.',409);
    novo.estado=alteracao.estado;
  }
  if(Object.hasOwn(alteracao,'responsavel'))novo.responsavel=alteracao.responsavel===null?null:texto(alteracao.responsavel,120,'Responsável');
  if(Object.hasOwn(alteracao,'nota'))novo.nota=texto(alteracao.nota,4000,'Nota',true);
  if(Object.hasOwn(alteracao,'implementadoEm'))novo.implementadoEm=alteracao.implementadoEm===null?null:data(alteracao.implementadoEm,n,'Implementação');
  if(novo.estado!==t.estado&&['concluida','descartada'].includes(t.estado)){
    novo.implementadoEm=null;novo.verificacao=null;
    if(Object.hasOwn(alteracao,'implementadoEm')||Object.hasOwn(alteracao,'verificacao'))falhar('Reabrir a tarefa inicia uma nova execução; registre implementação e medida depois.');
  }
  if(Object.hasOwn(alteracao,'verificacao')){
    if(novo.estado!=='concluida')falhar('A verificação final acompanha a conclusão.');
    novo.verificacao=verificacao(alteracao.verificacao,t.origem,dominio,n,novo.implementadoEm);
  }
  if(novo.estado==='concluida'&&(!novo.implementadoEm||!novo.verificacao))falhar('Concluir exige a data da implementação e uma verificação com medida.');
  if(novo.estado==='descartada'&&!novo.nota.trim())falhar('Registre por que a tarefa foi descartada.');
  conferirItem(novo,dominio,n);
  const patch=Object.fromEntries(CAMPOS_EDICAO.filter(k=>!igual(t[k],novo[k])).map(k=>[k,novo[k]]));
  if(!Object.keys(patch).length)return estado;
  evento(estado,t.id,'atualizada',patch,n,estado.revisao+1);conferirTamanho(estado);return estado;
}

function observacao(x, dominio, agora) {
  campos(x,['natureza','medida','coletadoEm','contexto','fonte'],'Observação');
  if(!['hipotese','declarado','observado'].includes(x.natureza))falhar('Natureza de observação inválida.');
  const m=medida(x.medida),coletadoEm=data(x.coletadoEm,agora,'Coleta da observação');
  campos(x.contexto,['url','metodo','termo','pais','idioma','dispositivo','localidade','periodoInicio','periodoFim'],'Contexto');
  const c={url:x.contexto.url==null?null:urlDoDominio(x.contexto.url,dominio),metodo:texto(x.contexto.metodo,200,'Método de observação')};
  for(const k of ['termo','pais','idioma','dispositivo','localidade'])c[k]=x.contexto[k]==null?null:texto(x.contexto[k],200,k);
  for(const k of ['periodoInicio','periodoFim'])c[k]=x.contexto[k]==null?null:data(x.contexto[k],agora,k);
  if((c.periodoInicio===null)!==(c.periodoFim===null)||c.periodoInicio!==null&&Date.parse(c.periodoInicio)>=Date.parse(c.periodoFim))falhar('Período da observação inválido.');
  if(c.periodoFim&&Date.parse(c.periodoFim)>Date.parse(coletadoEm))falhar('A coleta não pode anteceder o fim do período medido.');
  let fonte=null;
  if(x.fonte!=null){campos(x.fonte,['id','sha256'],'Fonte');fonte={id:identificador(x.fonte.id,'Fonte'),sha256:texto(x.fonte.sha256,64,'Hash da fonte')};if(!/^[a-f0-9]{64}$/.test(fonte.sha256))falhar('Hash da fonte inválido.');}
  if(x.natureza==='observado'&&!fonte)falhar('Uma observação precisa de fonte e hash produzidos pelo coletor.');
  return{natureza:x.natureza,medida:m,coletadoEm,contexto:c,fonte};
}

/** Compara valores tipados; não autentica uma fonte nem infere efeito de intervenção. */
export function compararObservacoes(antes, depois, {dominio,agora=Date.now}={}) {
  dominio=dominioValido(dominio);const n=instante(agora),a=observacao(antes,dominio,n),b=observacao(depois,dominio,n),motivos=[];
  if(a.natureza==='hipotese'||b.natureza==='hipotese')motivos.push('hipotese_nao_e_medicao');
  if(a.natureza!==b.natureza)motivos.push('naturezas_diferentes');
  for(const k of ['indicador','tipo','unidade'])if(a.medida[k]!==b.medida[k])motivos.push(k+'_diferente');
  for(const k of ['url','metodo','termo','pais','idioma','dispositivo','localidade'])if(a.contexto[k]!==b.contexto[k])motivos.push('contexto_'+k+'_diferente');
  if(Date.parse(b.coletadoEm)<=Date.parse(a.coletadoEm))motivos.push('coleta_sem_avanco_temporal');
  if(a.medida.valor===null||b.medida.valor===null)motivos.push('valor_desconhecido');
  if(a.medida.tipo==='numero'&&b.medida.tipo==='numero'&&a.medida.valor!==null&&b.medida.valor!==null&&
      Math.abs(b.medida.valor-a.medida.valor)>Number.MAX_SAFE_INTEGER)motivos.push('diferenca_fora_do_intervalo_suportado');
  const pa=a.contexto.periodoInicio,pb=b.contexto.periodoInicio;
  if((pa===null)!==(pb===null))motivos.push('periodos_incompativeis');
  if(pa!==null&&pb!==null){
    if(Date.parse(a.contexto.periodoFim)-Date.parse(pa)!==Date.parse(b.contexto.periodoFim)-Date.parse(pb))motivos.push('duracoes_diferentes');
    if(Date.parse(pb)<Date.parse(a.contexto.periodoFim))motivos.push('periodos_sobrepostos_ou_invertidos');
  }
  const compativel=motivos.length===0;
  return {versao:1,comparavel:compativel,motivos,natureza:a.natureza===b.natureza?a.natureza:null,
    antes:a,depois:b,mudou:compativel?!igual(a.medida.valor,b.medida.valor):null,
    diferenca:compativel&&a.medida.tipo==='numero'?b.medida.valor-a.medida.valor:null,
    causalidade:'nao_estabelecida',
    limite:'Comparação descritiva no recorte informado. Uma declaração não vira observação; fonte e hash não autenticam conteúdo. Diferença não comprova efeito da tarefa, ganho comercial ou sucesso do negócio.'};
}
