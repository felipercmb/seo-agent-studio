import {createHash} from 'node:crypto';
import {normalizarSite} from '../consulta.mjs';
import {classificarDocumentoPublico} from './documentos-publicos.mjs';
import {classificarOrigemPublicada} from './atribuicao-publica.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const lista=v=>Array.isArray(v)?v:[];
const normal=v=>v.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const atividade=/\b(?:decisao|execucao|instalacao|implantacao|configuracao|manutencao|migracao|envio|analise|orientacao|contratacao|revisao|atendimento|operacao)\b/u;
const dados=/\b(?:dados|arquivos|conteudo|informacoes|documentos)\b/u;
const PADROES=[
  {tipo:'responsabilidade_publicada',regex:/\b(?<objeto>(?:A|O|As|Os)\s+[^.!?;]{2,140}?)\s+(?<marcador>(?:é|são)\s+(?:de\s+)?responsabilidade\s+d(?:o|a|os|as))\s+(?<ator>[^.!?;,:]{2,100})/dgiu},
  {tipo:'atribuicao_de_atividade',regex:/\b(?<objeto>(?:A|O|As|Os)\s+[^.!?;]{2,140}?)\s+(?<marcador>continua(?:m)?\s+(?:sempre\s+)?(?:a\s+cargo\s+)?d(?:o|a|os|as))\s+(?<ator>[^.!?;,:]{2,100})/dgiu},
  {tipo:'posse_publicada',regex:/\b(?<objeto>(?:A|O|As|Os)\s+[^.!?;]{2,140}?)\s+(?<marcador>(?:(?:é|são)\s+(?:de\s+)?propriedade\s+d(?:o|a|os|as)|pertence(?:m)?\s+(?:ao|aos|à|às)))\s+(?<ator>[^.!?;,:]{2,100})/dgiu},
];

/** Reads only supplied complete excerpts. Offsets are UTF-16 within trecho,
 * not offsets in HTML or Python code points. It never infers an active role.
 */
export function extrairAtribuicoesNominais({dominio,fontes=[]}={}){
  let d;try{d=normalizarSite(dominio);}catch{return{versao:1,itens:[],limites:['Domínio inválido; nenhuma atribuição foi inferida.']};}
  const itens=[],vistos=new Set();let fontesLidas=0;
  for(const f of lista(fontes).slice(0,88)){
    if(typeof f?.trecho!=='string'||!f.trecho.trim()||f.trecho.length>1600||f.recortado||!/^[a-f0-9]{64}$/u.test(f.sha256||'')||!Number.isFinite(Date.parse(f.coletadoEm)))continue;
    let url;try{url=new URL(f.url);if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||normalizarSite(url.href)!==d)continue;}catch{continue;}
    fontesLidas++;
    const documental=['politica','editorial'].includes(classificarDocumentoPublico(f).classe),relato=classificarOrigemPublicada(f).estado==='relato_ou_resultado_de_terceiro';
    for(const frase of f.trecho.matchAll(/[^.!?]+[.!?]?/gu)){
      for(const p of PADROES){
        for(const m of frase[0].matchAll(new RegExp(p.regex.source,p.regex.flags))){
          const objeto=m.groups.objeto,ator=m.groups.ator,marcador=m.groups.marcador;
          if(/\b(?:informa|declara|afirma|diz|segundo|que)\b/u.test(normal(objeto)))continue;
          if(p.tipo==='atribuicao_de_atividade'&&!atividade.test(normal(objeto))||p.tipo==='posse_publicada'&&!dados.test(normal(objeto)))continue;
          // Negated, hypothetical and historical assignments need broader reading.
          if(/\b(?:nao|nunca|talvez|poderia|seria|antigamente|anteriormente)\b/u.test(normal(frase[0]))||/^\s*se\b/iu.test(frase[0]))continue;
          const spans=Object.fromEntries(['objeto','ator','marcador'].map(k=>{
            let[a,b]=m.indices.groups[k];a+=frase.index;b+=frase.index;
            while(a<b&&/\s/u.test(f.trecho[a]))a++;
            while(b>a&&/\s/u.test(f.trecho[b-1]))b--;
            return[k,{texto:f.trecho.slice(a,b),inicio:a,fim:b}];
          }));
          const qualificador=/\s+(?:após|apos|depois|quando|se|desde|exceto|para|mediante|no caso)\b/iu.exec(spans.ator.texto);
          if(qualificador){spans.ator.fim=spans.ator.inicio+qualificador.index;spans.ator.texto=f.trecho.slice(spans.ator.inicio,spans.ator.fim);}
          if(!spans.ator.texto.trim()||m.indices.groups.ator[1]<frase[0].length&&!/[.!?;,:]/u.test(frase[0][m.indices.groups.ator[1]]))continue;
          const k=JSON.stringify([url.href,f.sha256,p.tipo,spans.objeto.texto,spans.ator.texto,spans.marcador.texto]);if(vistos.has(k))continue;vistos.add(k);
          const estado=documental||relato?'contexto_documental_pendente':'interpretacao_pendente';
          itens.push({id:'nominal_'+sha(k).slice(0,20),tipo:p.tipo,estado,ator:spans.ator,objeto:spans.objeto,marcador:spans.marcador,unidadeOffsets:'utf16_no_trecho',
            acaoVerbal:null,fraseLiteral:frase[0].trim(),fonte:{url:url.href,campo:f.campo||null,trecho:f.trecho,sha256:f.sha256,sha256Trecho:sha(f.trecho),coletadoEm:f.coletadoEm},
            pergunta:p.tipo==='posse_publicada'?'A propriedade destes dados também define quem configura, usa ou contrata a oferta? Registre essas funções separadamente.':'Na atividade “'+spans.objeto.texto+'”, qual parte cabe à organização do site e qual cabe a “'+spans.ator.texto+'”? Confirme a oferta e a modalidade antes de generalizar.',
            natureza:'interpretacao_da_publicacao',perfilConfirmado:false,revisaoSemantica:'pendente',execucaoRealConfirmada:false,responsabilidadeJuridicaConfirmada:false});
          if(itens.length>=12)break;
        }
        if(itens.length>=12)break;
      }
      if(itens.length>=12)break;
    }
    if(itens.length>=12)break;
  }
  return{versao:1,itens,fontesLidas,limites:['Padrões limitados de atribuição nominal em português. Ausência de item não prova ausência de responsabilidade, parte ou atividade.',
    'O marcador é mantido literalmente, sem fabricar uma frase com sujeito e verbo. Propriedade de dados não identifica executor, comprador ou pagador.',
    'Hash e data referem-se à fonte fornecida. A publicação e sua interpretação não comprovam operação atual, validade jurídica ou obrigação de todas as modalidades.']};
}
