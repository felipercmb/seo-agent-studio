import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');

/** Operational action/reference labels only, never business utility. Fixed
 * before candidate inference; uses observation kinds, not rule recommendations. */
export function alvosTecnicosEntrada(entrada) {
 const es=entrada.evidencias||[],d=es.find(e=>e.id==='d1'&&e.tipo==='pagina'&&e.atual===true),p=es.find(e=>e.id==='p1'&&e.tipo==='pagina'&&e.atual===true),s=es.find(e=>e.id==='s1'&&e.tipo==='serp'&&e.atual===false);
 const alvos=[];
 if(d)alvos.push({acao:/\bnoindex\b/i.test(d.descricao||'')?'confirmar_publicacao':'melhorar_pagina',evidencias:[d.id]});
 else if(p)alvos.push({acao:'validar_demanda',evidencias:[p.id]});
 if(s)alvos.push({acao:'atualizar_coleta',evidencias:[s.id]});
 if(!alvos.length)throw Error('Entrada sem alvo técnico suportado; revisar explicitamente, sem inventar rótulo.');
 return alvos;
}

export function prepararCorpusIA({avaliacao,rotulos,avaliacaoSha256,rotulosSha256}) {
 if(!avaliacao.resultados?.length||avaliacao.erros?.length)throw Error('Avaliação vazia ou incompleta.');
 const casos=[],empresas=[];
 for(const r of avaliacao.resultados){
  const label=rotulos.casos.find(l=>l.id===r.id);
  if(!label||label.dominio!==r.dominio||label.capturaSha256!==r.capturaSha256)throw Error('Organização/captura divergente.');
  const ponte=r.rascunho.selecaoIA,entradas=ponte?.entrada?.entradas;
  if(!Array.isArray(entradas)||entradas.length>3)throw Error('Ponte deve declarar de zero a três contextos.');
  empresas.push({id:r.id,dominio:r.dominio,split:r.split,contextos:entradas.length,estadoEsperado:entradas.length?'experimental':'sem_contexto',naoInvocarPython:entradas.length===0,leitura:label.leitura.estado,selecao:ponte.selecao,hashEntrada:ponte.hashEntrada});
  for(const [i,entrada]of entradas.entries()){
   if(entrada.site!==r.dominio||!Array.isArray(entrada.evidencias)||!entrada.evidencias.length||entrada.evidencias.length>3)throw Error('Entrada inesperada.');
   if(Object.values(entrada.dados_negocio||{}).some(v=>v!==null))throw Error('Este protocolo exige dados de negócio financeiro desconhecidos.');
   casos.push({id:`${r.id}-contexto-${i+1}`,dominio:r.dominio,split:r.split,familia:label.familia,entrada,
    alvos:alvosTecnicosEntrada(entrada),alvosUtilidade:[],
    motivoRotulo:'Ação/referência tecnicamente suportada pela espécie de observação; não mede prioridade, entendimento do negócio, utilidade U1-U4 ou resultado. Alternativa de coleta não cria SERP.',
    origem:{arquivoCaptura:label.arquivoCaptura,capturaSha256:label.capturaSha256,fonteAvaliacaoSha256:avaliacaoSha256}});
  }
 }
 return {versao:1,congeladoEm:new Date().toISOString(),relogioReferencia:avaliacao.relogioReferencia,
   natureza:'Projeção local da ponte determinística no rascunho sem corrigir perfil. Alvos técnicos preparados antes de inferência. Modelo padrão e candidato recebem as mesmas entradas; sem treino neste script.',
   fonteAvaliacaoSha256:avaliacaoSha256,rotulosSha256,empresas,casos,
   politicaAlvos:'d1 atual observado: melhorar_pagina; noindex: confirmar_publicacao; somente página atual p1: validar_demanda; s1 sem fonte atual: atualizar_coleta como alternativa de obtenção de dados.',
   limiteUtilidade:'alvosUtilidade vazio é intencional: enum e referência não pontuam utilidade do negócio. O plano principal é adjudicado separadamente por U1-U4. Zero contextos preserva organização fora do executor Python.'};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const o={};for(let i=2;i<process.argv.length;i+=2){if(!['--avaliacao','--rotulos','--saida'].includes(process.argv[i])||!process.argv[i+1]||Object.hasOwn(o,process.argv[i]))throw Error('Argumentos inválidos.');o[process.argv[i]]=process.argv[i+1];}if(Object.keys(o).length!==3)throw Error('Informe avaliação, rótulos e saída nova.');const a=await readFile(resolve(o['--avaliacao'])),l=await readFile(resolve(o['--rotulos']));const r=prepararCorpusIA({avaliacao:JSON.parse(a),rotulos:JSON.parse(l),avaliacaoSha256:sha(a),rotulosSha256:sha(l)});r.preparadorSha256=sha(await readFile(new URL(import.meta.url)));await writeFile(resolve(o['--saida']),JSON.stringify(r,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({organizacoes:r.empresas.length,semContexto:r.empresas.filter(e=>!e.contextos).length,contextos:r.casos.length}));}
