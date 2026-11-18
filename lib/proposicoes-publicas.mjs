import {createHash} from 'node:crypto';
import {ErroProjeto} from '../src/modulos/repositorio.mjs';

const lista=(v,max,nome)=>{if(!Array.isArray(v)||v.length>max)falhar(nome);return v;};
const objeto=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const falhar=nome=>{throw new ErroProjeto('A resposta de relações não passou pela conferência de '+nome+'.',503);};
const ordenar=v=>Array.isArray(v)?v.map(ordenar):objeto(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordenar(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(ordenar(v))).digest('hex');
const semId=({id,...resto})=>resto;
const texto=(v,max,nome)=>{if(typeof v!=='string'||!v.trim()||Array.from(v).length>max||/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(v))falhar(nome);return v;};
const enumera=(v,opcoes,nome)=>{if(!opcoes.includes(v))falhar(nome);return v;};
const normal=v=>v.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
function literal(v,corpo,max,nome){
  texto(v,max,nome);const frase=normal(v).replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
  if(!new RegExp('(?<![\\p{L}\\p{N}_])'+frase+'(?![\\p{L}\\p{N}_])','u').test(normal(corpo)))falhar(nome);
  return v;
}
const NATUREZAS=['software','servico','produto','programa_social','indefinido'];
const PAPEIS=['disponibiliza','executa','vende','intermedeia','indefinido'];
const TIPOS=['fornecedor','usuario','terceiro','ferramenta','indefinido'];
const RELACOES=['disponibiliza','desenvolve','executa','utiliza','solicita','contrata','paga','recebe','destina_se_a','identidade','indefinida'];
const ESCOPOS=['fornecimento','implementacao','uso','prestacao_da_oferta','servico_do_cliente','transacao_do_cliente','contratacao_da_oferta','indefinido'];
const CATEGORIAS=['elegibilidade','limite','preco','prazo','exclusao','canal','outro'];
const ALCANCES=['oferta','atividade','formulario','proposta_comercial','suporte','transacao_do_cliente','indefinido'];
function pendente(v){if(v?.revisaoSemantica!=='pendente')falhar('revisão pendente');}
function referencias(ids,citacoes,fontes){
  lista(ids,3,'referências');if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!fontes.has(id)))falhar('referências');
  const reais=ids.map(id=>fontes.get(id));if(digest(reais)!==digest(citacoes))falhar('citações da captura');
  return structuredClone(reais);
}
function unidade(u,fontes){
  if(!objeto(u)||!/^u\d{3}$/u.test(u.id)||!fontes.has(u.fonte))falhar('unidade textual');
  const fonte=fontes.get(u.fonte),pontos=Array.from(fonte.texto);
  if(fonte.tipo==='interface'||fonte.contexto?.recortado===true||!Number.isSafeInteger(u.inicio)||!Number.isSafeInteger(u.fim)||u.inicio<0||u.fim<=u.inicio||u.fim>pontos.length||pontos.slice(u.inicio,u.fim).join('')!==u.texto)falhar('intervalo literal da fonte');
  return {id:u.id,fonte:u.fonte,inicio:u.inicio,fim:u.fim,texto:u.texto};
}

/** Projects only checked public claims. Raw logs, model paths and Python's role
 * projections stay in local artifacts. A checked span is still an interpretation
 * requiring semantic review, never a verified customer journey.
 */
export function publicarProposicoes(r,base,reserva=[],{validarBase=()=>{},modeloBaseEsperado=null}={}){
  if(!objeto(r)||r.versao!==3||r.dominio!==base.dominio||r.perfilConfirmado!==false||
    r.entradaSha256!==digest(base)||r.codigoMudouDuranteExecucao!==false)falhar('identidade da entrada');
  pendente(r);enumera(r.estado,['sem_fontes','insuficiente','revisao_necessaria'],'estado');
  const declarado=r.config?.modeloBase;
  if(declarado!==undefined&&!['qwen35-4b','qwen35-9b'].includes(declarado)||modeloBaseEsperado!==null&&!['qwen35-4b','qwen35-9b'].includes(modeloBaseEsperado)||declarado&&modeloBaseEsperado&&declarado!==modeloBaseEsperado)falhar('modelo local registrado');
  const modeloBase=modeloBaseEsperado||declarado||'qwen35-4b';
  const entrada=new Map(base.fontes.map(f=>[f.id,f])),permitidas=new Set([...base.fontes,...reserva].map(f=>digest(semId(f))));
  const ofertas=lista(r.ofertas,1,'ofertas').map(o=>{
    pendente(o);if(o.nome!==o.nomePublicado)falhar('nome publicado');
    const citacoes=referencias(o.evidencias,o.citacoes,entrada),nomeFonte=entrada.get(o.fonteNome);
    if(!nomeFonte||!o.evidencias.includes(o.fonteNome)||nomeFonte.tipo==='interface'||nomeFonte.contexto?.recortado===true)falhar('origem do nome');
    const origem=enumera(o.origemNome,['texto','titulo_secao','titulo_pagina'],'origem do nome');
    const publicado=origem==='texto'?nomeFonte.texto:origem==='titulo_secao'?(nomeFonte.contexto?.titulos||[]).map(h=>h.texto).join(' '):nomeFonte.contexto?.tituloPagina||'';
    const nome=literal(o.nomePublicado,publicado,120,'nome literal');
    const j=o.jornada;pendente(j);if(j.perfilConfirmado!==false)falhar('confirmação da jornada');
    const selecionadas=lista(j.fontesSelecionadas,16,'fontes selecionadas'),entradaJornada={versao:1,dominio:base.dominio,fontes:selecionadas};
    validarBase(entradaJornada,base.dominio);
    if(j.entradaSha256!==digest(entradaJornada)||selecionadas.some(f=>!permitidas.has(digest(semId(f)))))falhar('fontes recuperadas');
    const fs=new Map(selecionadas.map(f=>[f.id,f])),ids=new Set();
    const proposicoes=lista(j.proposicoes,6,'proposições').map(p=>{
      pendente(p);if(!/^p\d{2}$/u.test(p.id)||ids.has(p.id))falhar('identidade da proposição');ids.add(p.id);
      const u=unidade(p.unidadeLiteral,fs);
      if(p.unidade!==u.id||digest(p.evidencias)!==digest([u.fonte]))falhar('referência da proposição');
      return {id:p.id,sujeito:literal(p.sujeito,u.texto,120,'sujeito na unidade'),
        tipoSujeito:enumera(p.tipoSujeito,TIPOS,'tipo de sujeito'),relacao:enumera(p.relacao,RELACOES,'relação'),
        relacaoOrigem:p.relacaoOrigem===undefined?'nao_informada':enumera(p.relacaoOrigem,['regra_verbo_literal','modelo'],'origem da classificação verbal'),
        acao:literal(p.acao,u.texto,160,'ação na unidade'),objeto:literal(p.objeto,u.texto,180,'objeto na unidade'),
        escopo:enumera(p.escopo,ESCOPOS,'escopo'),unidadeLiteral:u,
        citacoes:referencias([u.fonte],p.citacoes,fs),revisaoSemantica:'pendente'};
    });
    const condicoes=lista(j.condicoes,3,'condições').map(c=>{
      pendente(c);const u=unidade(c.unidadeLiteral,fs);
      if(!/^c\d{2}$/u.test(c.id)||ids.has(c.id)||c.unidade!==u.id||c.evidencia!==u.fonte||c.oferta!==nome)falhar('identidade da condição');ids.add(c.id);
      return {id:c.id,categoria:enumera(c.categoria,CATEGORIAS,'categoria'),alcance:enumera(c.alcance,ALCANCES,'alcance da condição'),
        aplicaA:c.aplicaA===null?null:literal(c.aplicaA,u.texto,120,'objeto da condição'),unidadeLiteral:u,
        citacoes:referencias([u.fonte],c.citacoes,fs),revisaoSemantica:'pendente'};
    });
    return {nome,fonteNome:o.fonteNome,origemNome:origem,natureza:enumera(o.natureza,NATUREZAS,'natureza da oferta'),papel_site:enumera(o.papel_site,PAPEIS,'papel da organização'),
      citacoes,revisaoSemantica:'pendente',jornada:{proposicoes,condicoes,
        incertezas:lista(j.incertezas,4,'incertezas').map(v=>texto(v,180,'incerteza')),
        itensRecusados:lista(j.recusadas,32,'recusas').length,fontesRetidas:selecionadas.length,perfilConfirmado:false,revisaoSemantica:'pendente'}};
  });
  if(base.fontes.length===0&&(r.estado!=='sem_fontes'||ofertas.length)||base.fontes.length>0&&r.estado==='sem_fontes')falhar('cobertura');
  const incertezas=lista(r.incertezas,4,'incertezas gerais').map(v=>texto(v,180,'incerteza geral'));
  return {versao:3,projecaoVersao:2,motor:'proposicoes',estado:r.estado,dominio:base.dominio,entradaSha256:digest(base),ofertas,incertezas,
    ofertasRecusadas:lista(r.recusadas||[],32,'ofertas recusadas').length,
    ofertasIdentificadas:Number.isInteger(r.ofertasIdentificadas)&&r.ofertasIdentificadas>=ofertas.length&&r.ofertasIdentificadas<=3?r.ofertasIdentificadas:ofertas.length,
    ofertasAnalisadas:ofertas.length,inferenciasExecutadas:lista(r.inferencias,4,'inferências').filter(i=>i?.inferida===true).length,
    perfilConfirmado:false,revisaoSemantica:'pendente',modeloBase:r.estado==='sem_fontes'?null:modeloBase,
    limite:'Relações propostas por atividade, com sujeito, ação, objeto e trecho contínuo. A conferência literal não aprova os papéis, a interpretação ou o funcionamento real. O perfil não foi alterado.'};
}

/** Read compatibility for experimental v3 projections 0 and 1. Existing
 * bytes/hashes are never rewritten. Only known additive fields may be absent;
 * every field that was stored still has to match the freshly checked raw data.
 */
export function conferirProjecaoProposicoes(conferido,salvo){
  if(!objeto(salvo)||salvo.versao!==3)return false;
  if(salvo.projecaoVersao===2)return digest(conferido)===digest(salvo);
  if(Object.hasOwn(salvo,'projecaoVersao')&&salvo.projecaoVersao!==1)return false;
  const historico=structuredClone(conferido),inicial=!Object.hasOwn(salvo,'projecaoVersao');
  if(inicial)delete historico.projecaoVersao;else historico.projecaoVersao=1;
  if(inicial&&!Object.hasOwn(salvo,'ofertasRecusadas'))delete historico.ofertasRecusadas;
  if(!Array.isArray(salvo.ofertas)||salvo.ofertas.length!==historico.ofertas.length)return false;
  for(const [i,o] of salvo.ofertas.entries()){
    const fonte=Object.hasOwn(o,'fonteNome'),origem=Object.hasOwn(o,'origemNome');
    if(fonte!==origem)return false;
    if(inicial&&!fonte){delete historico.ofertas[i].fonteNome;delete historico.ofertas[i].origemNome;}
    const ps=o.jornada?.proposicoes,atuais=historico.ofertas[i].jornada?.proposicoes;
    if(!Array.isArray(ps)||!Array.isArray(atuais)||ps.length!==atuais.length)return false;
    for(const [j,p] of ps.entries()){
      if(Object.hasOwn(p,'relacaoOrigem'))return false;
      delete atuais[j].relacaoOrigem;
    }
  }
  return digest(historico)===digest(salvo);
}
