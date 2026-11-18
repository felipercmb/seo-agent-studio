import {createHash} from 'node:crypto';
import {normalizarSite} from '../consulta.mjs';
import {classificarDocumentoPublico} from './documentos-publicos.mjs';
import {classificarOrigemPublicada} from './atribuicao-publica.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const normal=v=>v.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/gu,' ').trim();
const lista=v=>Array.isArray(v)?v:[];
const PADROES=[
  {efeito:'dispensa_publicada',regex:/^(?<parte>(?:Seu|Sua|O|A|Os|As)\s+[^.!?;,]{2,80}?)\s+(?<marcador>não\s+(?:precisa|necessita))\s+(?:de\s+)?(?<requisito>(?:(?:criar|ter)\s+)?(?:uma?\s+)?(?:conta|cadastro|certificado(?:\s+digital)?))\s+para\s+(?<atividade>[^.!?;,]{2,100})(?=[.!?;,]|$)/dgiu},
  {efeito:'dispensa_publicada',regex:/^(?<marcador>Não\s+é\s+necessário)\s+(?<requisito>(?:(?:criar|ter)\s+)?(?:uma?\s+)?(?:conta|cadastro|certificado(?:\s+digital)?))\s+para\s+(?<atividade>[^.!?;,]{2,100})(?=[.!?;,]|$)/dgiu},
  {efeito:'requisito_publicado',regex:/^(?<parte>(?:Seu|Sua|O|A|Os|As)\s+[^.!?;,]{2,80}?)\s+(?<marcador>(?:precisa|necessita))\s+(?:de\s+)?(?<requisito>(?:(?:criar|ter)\s+)?(?:uma?\s+)?(?:conta|cadastro|certificado(?:\s+digital)?))\s+para\s+(?<atividade>[^.!?;,]{2,100})(?=[.!?;,]|$)/dgiu},
  {efeito:'requisito_publicado',regex:/^(?<marcador>É\s+necessário)\s+(?<requisito>(?:(?:criar|ter)\s+)?(?:uma?\s+)?(?:conta|cadastro|certificado(?:\s+digital)?))\s+para\s+(?<atividade>[^.!?;,]{2,100})(?=[.!?;,]|$)/dgiu},
  {efeito:'destinacao_restrita_publicada',regex:/^(?<requisito>Conta|Cadastro|Certificado(?:\s+digital)?)\s+(?<marcador>é\s+(?:só|somente|apenas)\s+para)\s+(?<parte>quem\s+(?<atividade>[^.!?;,]{2,100}))(?=[.!?;,]|$)/dgiu},
];

/** Explicit statements about account/registration/certificate and activities.
 * "Only for" is a restricted destination, not a logical proof of obligation.
 */
export function extrairCondicoesPorAtividade({dominio,fontes=[]}={}){
  let d;try{d=normalizarSite(dominio);}catch{return{versao:1,itens:[],comparacoes:[],fontesLidas:0};}
  const itens=[],vistos=new Set();let fontesLidas=0;
  for(const f of lista(fontes).slice(0,112)){
    if(typeof f?.trecho!=='string'||!f.trecho.trim()||f.trecho.length>1600||f.recortado||!/^[a-f0-9]{64}$/u.test(f.sha256||'')||!Number.isFinite(Date.parse(f.coletadoEm)))continue;
    let u;try{u=new URL(f.url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||normalizarSite(u.href)!==d)continue;}catch{continue;}
    fontesLidas++;const documental=['politica','editorial'].includes(classificarDocumentoPublico(f).classe)||classificarOrigemPublicada(f).estado==='relato_ou_resultado_de_terceiro';
    for(const frase of f.trecho.matchAll(/[^.!?]+[.!?]?/gu)){
      const corpo=frase[0].trim(),inicio=frase.index+frase[0].indexOf(corpo);
      if(corpo.endsWith('?'))continue;
      const consumidos=[];
      for(const p of PADROES){
        for(const m of corpo.matchAll(new RegExp(p.regex.source,p.regex.flags))){
          if(consumidos.some(([a,b])=>m.index<b&&m.index+m[0].length>a)||p.efeito==='requisito_publicado'&&/\bnao\b/u.test(normal(m.groups.parte||'')))continue;
          const campos={};
          for(const k of ['parte','requisito','atividade','marcador']){
            const span=m.indices.groups[k];if(!span){campos[k]=null;continue;}
            let[a,b]=span;a+=inicio;b+=inicio;while(a<b&&/\s/u.test(f.trecho[a]))a++;while(b>a&&/\s/u.test(f.trecho[b-1]))b--;
            campos[k]={texto:f.trecho.slice(a,b),inicio:a,fim:b};
          }
          const q=/\s+(?:quando|se|após|apos|depois|exceto|somente|apenas|mediante|mas|porém|porem|contudo|e\s+(?:não\s+)?(?:precisa|necessita))\b/iu.exec(campos.atividade.texto);
          let qualificador=null;
          if(q){const a=campos.atividade.inicio+q.index;let b=a;while(/\s/u.test(f.trecho[b]||''))b++;qualificador={texto:f.trecho.slice(b,campos.atividade.fim),inicio:b,fim:campos.atividade.fim};campos.atividade.fim=a;campos.atividade.texto=f.trecho.slice(campos.atividade.inicio,a);}
          if(!qualificador){
            const resto=corpo.slice(m.index+m[0].length),r=/^[,:]\s*(?:exceto|quando|se|após|apos|depois|somente|apenas|mediante|mas|porém|porem|contudo|e\s+(?:não\s+)?(?:precisa|necessita))\b/iu.exec(resto);
            if(r){let a=inicio+m.index+m[0].length+1;while(/\s/u.test(f.trecho[a]||''))a++;const b=inicio+corpo.length-(/[.!?]$/u.test(corpo)?1:0);qualificador={texto:f.trecho.slice(a,b),inicio:a,fim:b};}
          }
          if(!campos.atividade.texto.trim())continue;
          consumidos.push([m.index,m.index+m[0].length]);
          const chave=JSON.stringify([u.href,f.sha256,corpo,p.efeito,campos.requisito.texto,campos.atividade.texto]);if(vistos.has(chave))continue;vistos.add(chave);
          itens.push({id:'regra_atividade_'+sha(chave).slice(0,20),efeito:p.efeito,...campos,qualificador,fraseLiteral:corpo,unidadeOffsets:'utf16_no_trecho',
            fonte:{url:u.href,campo:f.campo||null,trecho:f.trecho,sha256:f.sha256,sha256Trecho:sha(f.trecho),coletadoEm:f.coletadoEm,
              ...(f.origemEstruturada?{jsonLdSha256:f.origemEstruturada.jsonLdSha256,respostaPointer:f.origemEstruturada.respostaPointer,visibilidade:'nao_verificada'}:{})},
            estado:documental?'contexto_documental_pendente':'interpretacao_pendente',revisaoSemantica:'pendente',aplicacaoConfirmada:false,
            pergunta:'Na atividade “'+campos.atividade.texto+'”, a regra publicada sobre “'+campos.requisito.texto+'” vale para quais partes e modalidades?'});
          if(itens.length>=12)break;
        }
        if(itens.length>=12)break;
      }
      if(itens.length>=12)break;
    }
    if(itens.length>=12)break;
  }
  const comparacoes=[];
  const requisito=x=>normal(x.requisito.texto).replace(/^(?:criar|ter)\s+/u,'').replace(/^uma?\s+/u,'');
  for(const a of itens)for(const b of itens){
    if(a.efeito!=='dispensa_publicada'||b.efeito==='dispensa_publicada'||a.fonte.url!==b.fonte.url||a.fonte.sha256!==b.fonte.sha256||a.fonte.sha256Trecho!==b.fonte.sha256Trecho||requisito(a)!==requisito(b)||normal(a.atividade.texto)===normal(b.atividade.texto))continue;
    comparacoes.push({tipo:'atividades_com_regras_distintas',itens:[a.id,b.id],atividades:[a.atividade.texto,b.atividade.texto],frases:[a.fraseLiteral,b.fraseLiteral],
      proposta:'Conferir os dois percursos separadamente e explicar a regra de cada atividade antes do próximo passo. A dispensa de uma atividade não deve ser generalizada à outra.',
      casosFicticios:[{atividade:a.atividade.texto,verificar:'Conferir a dispensa e seus qualificadores no percurso desta atividade.'},{atividade:b.atividade.texto,verificar:b.efeito==='destinacao_restrita_publicada'?'Confirmar se a destinação publicada também implica exigência; a frase sozinha não prova essa obrigação.':'Conferir o requisito no percurso desta atividade.'}],
      fonte:a.fonte,confirmacaoComClientePendente:true,contradicaoConfirmada:false});
    if(comparacoes.length>=4)break;
  }
  return{versao:1,itens,comparacoes:comparacoes.slice(0,4),fontesLidas,limites:['Padrões limitados de conta, cadastro e certificado em português. Há regras, modalidades e exceções fora dos padrões e da coleta.',
    'A evidência conserva o parágrafo completo e os qualificadores. Campos são interpretações da publicação, sem confirmar elegibilidade, obrigação atual, visibilidade da FAQ ou funcionamento.',
    'Destinação exclusiva não é prova lógica de obrigação. Regras de atividades diferentes não são transferidas entre si nem usadas para concluir pagamento ou retorno.']};
}
