import {createHash} from 'node:crypto';
import {normalizarSite} from '../consulta.mjs';
import {refinarPlanoAssistido} from './prioridades-assistidas.mjs';
const texto=(v,max=500)=>typeof v==='string'?v.replace(/[\p{Cc}\p{Cf}]/gu,' ').trim().slice(0,max):'';
const hash=v=>createHash('sha256').update(v).digest('hex').slice(0,24);
function urlPropria(v,dominio){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&normalizarSite(u.href)===dominio?u.href:null;}catch{return null;}}

function tarefaDaJornada(projeto,oferta){
  const j=oferta.jornada;
  if(j?.natureza!=='declaracao_usuario'||!j.comprador||!j.objetivo)return null;
  const url=urlPropria(oferta.url,projeto.dominio);
  if(!url)return null;
  const palavra=(projeto.palavras?.candidatos||[]).find(p=>p.ofertaId===oferta.id&&p.intencao==='comercial');
  const origem={oferta:oferta.nome,comprador:j.comprador,executor:j.executor,beneficiario:j.beneficiario,pagador:j.pagador,objetivo:j.objetivo};
  const evidencias=(oferta.evidencias||[]).filter(e=>e.url===url).slice(0,4);
  return {id:'jornada_'+hash(JSON.stringify([projeto.dominio,oferta.id,url,origem])),tipo:'qualificar_pedido',eixo:'negocio',
    titulo:'Qualificar o pedido de '+oferta.nome,base:'hipotese',prioridade:'investigar',
    acao:'Conferir se '+j.comprador+' consegue encaminhar um pedido de '+oferta.nome+' com as informações necessárias para '+j.objetivo+'.',
    paginaAlvo:{url,origem:evidencias.length?'observada':'declarada',fonte:evidencias.length?'site':'perfil'},
    ofertasAfetadas:[{id:oferta.id,nome:oferta.nome}],evidencias,
    passos:[
      'Na página '+url+', represente o papel de '+j.comprador+'. '+(palavra?'Use a intenção da expressão candidata “'+palavra.termo+'”, cuja posição e demanda precisam de medição própria.':'Parta do objetivo declarado: '+j.objetivo+'.'),
      'Prepare dois pedidos fictícios no registro local: um compatível com “'+oferta.nome+'” e outro que precise de esclarecimento. '+(j.executor?'Separe quem decide contratar de quem executa: '+j.executor+'.':'Registre quem executa como informação a confirmar.'),
      'Sem enviar formulário, confira quais informações permitem encaminhar o primeiro pedido e esclarecer o segundo. Registre o trecho/campo que causou dúvida antes de propor qualquer edição.',
    ],
    criterioSucesso:'Um registro distingue os dois pedidos e identifica o próximo passo e o responsável. Eventual alteração é conferida na mesma URL; o teste não mede vendas nem promete posição.',
    entregavel:'Dois pedidos fictícios classificados e um registro das dúvidas, campos e encaminhamento na página.',
    dependencias:['Confirmar com o responsável as partes e o objetivo da jornada.'],
    origemJornada:{natureza:'declaracao_usuario',...origem},
    centralidade:oferta.centralidade||{nivel:'indefinida'},
    limite:'Hipótese de teste baseada na jornada declarada. Não afirma defeito no site ou maior rentabilidade desta oferta.'};
}

/** Three executable priorities; retains the complete existing plan separately. */
function construirPrioridadesAnterior(projeto){
  const confirmado=projeto.perfil?.estado==='confirmado';
  const existentes=Array.isArray(projeto.oportunidades?.planoDeAcao)?projeto.oportunidades.planoDeAcao:[];
  const jornadas=confirmado?(projeto.perfil.ofertas||[]).map(o=>tarefaDaJornada(projeto,o)).filter(Boolean):[];
  const todas=[...existentes,...jornadas];
  const faixa=t=>t.eixo==='publicacao'&&t.base==='observacao'?0:t.base==='observacao'?1:t.decisaoCliente?2:t.tipo==='qualificar_pedido'?3:t.eixo==='negocio'?4:5;
  const ordenadas=[...todas].sort((a,b)=>faixa(a)-faixa(b)||a.titulo.localeCompare(b.titulo,'pt-BR'));
  const escolhidas=[],ids=new Set(),frentes=new Set();
  for(const t of ordenadas){
    if(ids.has(t.id))continue;
    const frente=JSON.stringify([t.eixo,t.ofertasAfetadas?.map(o=>o.id)||[],t.paginaAlvo?.url]);
    if(frentes.has(frente)&&t.base!=='observacao')continue;
    ids.add(t.id);frentes.add(frente);escolhidas.push(t);
    if(escolhidas.length===3)break;
  }
  return {versao:1,estado:confirmado?'revisao_assistida':'aguardando_confirmacao',prioridades:escolhidas,
    tarefasDisponiveis:todas,
    criterios:['Primeiro, problemas realmente observados e intenção de publicação.','Depois, decisões publicadas e testes específicos da jornada confirmada.','Volume isolado e cenário financeiro não determinam prioridade de anúncio.'],
    limites:['Tarefas de hipótese precisam de revisão antes da mudança. Concluir uma atividade não comprova melhoria comercial.']};
}

// Preserve the complete prior plan; refine the actionable view without overwriting it.
export function construirPrioridades(projeto,opcoes){
  return refinarPlanoAssistido(projeto,construirPrioridadesAnterior(projeto),opcoes);
}
