import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const tipos=new Set(['negocio','tecnica','conferencia_fonte','generica_sem_decisao']);
const passa=t=>['U1','U2','U3','U4'].every(k=>t[k]===true)&&typeof t.justificativa==='string'&&t.justificativa.trim().length>0;
const unica=a=>new Set(a).size===a.length;

/** Recompute denominators from observed organizations and explicitly reviewed
 * windows. No business usefulness is inferred from a task's category or IDs. */
export function consolidarCorrecao({avaliacao,revisao,rotulos}) {
 if(!Array.isArray(avaliacao?.resultados)||!avaliacao.resultados.length||avaliacao.erros?.length)throw Error('Avaliação incompleta: erros devem ser tratados explicitamente antes de consolidar.');
 const registros=revisao?.registros;
 if(!Array.isArray(registros)||registros.length!==avaliacao.resultados.length||!unica(registros.map(r=>r.id)))throw Error('Revisão deve preservar exatamente todas as organizações, sem duplicatas.');
 const m={organizacoes:avaliacao.denominadores.organizacoesSolicitadas,executadas:avaliacao.resultados.length,comHtml:0,
   gruposCentrais:{corretos:0,esperados:0},papel:{corretos:0,observaveis:0},finalidade:{corretas:0,observaveis:0},
   modeloNegocioMinimo:{completos:0,observaveis:0},publicos:{paresCorretos:0,paresEsperados:0},consultas:{qualificadas:0,avaliadas:0,organizacoesComQualificada:0},
   fontesInsuficientes:{esperadas:0,abstencoesCorretas:0},janelas:{}};
 if(m.organizacoes!==m.executadas)throw Error('Organizações com erro não podem desaparecer do denominador.');
 for(const nome of ['geral','negocio'])m.janelas[nome]={tarefasAvaliadas:0,uteis:0,uteisNegocio:0,uteisTecnicas:0,uteisConferenciaFonte:0,
   empresasComTarefaUtil:0,empresasComNegocioUtil:0,empresasSemTarefa:0,criterios:{U1:0,U2:0,U3:0,U4:0}};
 for(const a of avaliacao.resultados){
  const r=registros.find(r=>r.id===a.id),label=rotulos.casos.find(c=>c.id===a.id);
  if(!r||!label||r.dominio!==a.dominio||label.dominio!==a.dominio||a.capturaSha256!==label.capturaSha256)throw Error('Organização/captura não coincide.');
  if(a.paginasCapturadas>0)m.comHtml++;
  const pf=r.perfil||{},esperados=label.negocio.gruposCentrais.map(g=>g.id),rec=pf.gruposRecuperados||[];
  if(!unica(rec)||rec.some(id=>!esperados.includes(id)))throw Error('Grupo revisado não existe no rótulo congelado.');
  m.gruposCentrais.esperados+=esperados.length;m.gruposCentrais.corretos+=rec.length;
  if(label.leitura.fonteInsuficiente){m.fontesInsuficientes.esperadas++;if(pf.abstencaoPorFonteInsuficiente===true)m.fontesInsuficientes.abstencoesCorretas++;}
  else{
   for(const campo of ['papelSemanticoCorreto','finalidadeCorretaObservavel','modeloNegocioMinimoCompleto'])if(typeof pf[campo]!=='boolean')throw Error(`Falta parecer observável ${campo} de ${a.id}.`);
   m.papel.observaveis++;m.papel.corretos+=Number(pf.papelSemanticoCorreto);
   m.finalidade.observaveis++;m.finalidade.corretas+=Number(pf.finalidadeCorretaObservavel);
   m.modeloNegocioMinimo.observaveis++;m.modeloNegocioMinimo.completos+=Number(pf.modeloNegocioMinimoCompleto);
  }
  const pubs=label.negocio.publicosEsperados.map(p=>p.tipo),bons=pf.publicosCorretos||[];
  if(!unica(bons)||bons.some(x=>!pubs.includes(x)))throw Error('Público adjudicado não rotulado.');
  m.publicos.paresEsperados+=pubs.length;m.publicos.paresCorretos+=bons.length;
  const qs=a.condicional.paraRevisao.primeirasConsultas;
  if(!Array.isArray(r.consultas)||r.consultas.length!==qs.length)throw Error('Revisão deve cobrir a janela completa de consultas.');
  let qboa=false;
  for(let i=0;i<qs.length;i++){const q=r.consultas[i];if(q.termo!==qs[i].termo||q.indice!==i+1||typeof q.coerenteQualificada!=='boolean'||!q.justificativa)throw Error('Consulta/ordem/parecer incoerente.');m.consultas.avaliadas++;if(q.coerenteQualificada){m.consultas.qualificadas++;qboa=true;}}
  if(qboa)m.consultas.organizacoesComQualificada++;
  for(const nome of ['geral','negocio']){
   const orig=a.condicional.janelasUtilidade[nome],rows=r.janelas?.[nome],dest=m.janelas[nome];
   if(!Array.isArray(rows)||rows.length!==orig.length||!unica(rows.map(t=>t.id)))throw Error(`Janela ${nome} incompleta/repetida.`);
   if(!rows.length)dest.empresasSemTarefa++;
   let util=false,negocio=false;
   for(let i=0;i<rows.length;i++){
    const t=rows[i];if(t.id!==orig[i].tarefa.id||t.posicaoFilaGeral!==orig[i].posicaoFilaGeral||!tipos.has(t.tipoRevisado))throw Error('ID, ordem, posição ou tipo da tarefa diverge.');
    if(['U1','U2','U3','U4'].some(k=>typeof t[k]!=='boolean')||typeof t.justificativa!=='string'||!t.justificativa.trim())throw Error('Parecer U1-U4 incompleto.');
    const ok=passa(t),bn=ok&&t.tipoRevisado==='negocio';if(t.util!==ok||t.utilNegocio!==bn)throw Error('Flag útil diverge dos critérios semânticos.');
    dest.tarefasAvaliadas++;for(const k of ['U1','U2','U3','U4'])dest.criterios[k]+=Number(t[k]);
    if(ok){dest.uteis++;util=true;if(t.tipoRevisado==='tecnica')dest.uteisTecnicas++;if(t.tipoRevisado==='conferencia_fonte')dest.uteisConferenciaFonte++;}
    if(bn){dest.uteisNegocio++;negocio=true;}
   }
   if(util)dest.empresasComTarefaUtil++;if(negocio)dest.empresasComNegocioUtil++;
  }
 }
 return {versao:1,metricas:m,limites:['Semântica adjudicada tecnicamente por agente, sem profissional externo, validação da empresa ou ROI medido.',
  'Organização é a unidade de comparação; múltiplas tarefas/contextos da mesma empresa são dependentes.',
  'Janelas geral e negócio podem conter a mesma tarefa; não somar contagens de ambas.',
  'Fila/categoria/IDs/citações não são pontos de utilidade; flags são verificadas contra U1-U4 e tipo semântico.',
  'Bloqueios, corpos fracos e nenhuma tarefa permanecem no denominador por organização.']};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const o={};for(let i=2;i<process.argv.length;i+=2){if(!['--avaliacao','--revisao','--rotulos','--saida'].includes(process.argv[i])||!process.argv[i+1]||Object.hasOwn(o,process.argv[i]))throw Error('Argumentos inválidos.');o[process.argv[i]]=process.argv[i+1];}if(Object.keys(o).length!==4)throw Error('Informe avaliação, revisão, rótulos e saída nova.');const entradas={};for(const [k,flag]of [['avaliacao','--avaliacao'],['revisao','--revisao'],['rotulos','--rotulos']]){const b=await readFile(resolve(o[flag]));entradas[k]=JSON.parse(b);entradas[k+'Sha256']=sha(b);}if(entradas.revisao.avaliacaoSha256!==entradas.avaliacaoSha256)throw Error('Hash da revisão não pertence à avaliação.');const r=consolidarCorrecao(entradas);r.geradoEm=new Date().toISOString();r.origens=Object.fromEntries(['avaliacao','revisao','rotulos'].map(k=>[k,{arquivo:resolve(o['--'+k]),sha256:entradas[k+'Sha256']}]));r.consolidadorSha256=sha(await readFile(new URL(import.meta.url)));await writeFile(resolve(o['--saida']),JSON.stringify(r,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(r.metricas));}
