import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {carregarCapturaLocal} from '../capturas.mjs';
import {extrairFontesNegocio} from '../fontes-v5.mjs';
import {textoPadraoDeConsentimento} from '../../../src/modulos/documentos-publicos.mjs';
import {classificarOrigemPublicada} from '../../../src/modulos/atribuicao-publica.mjs';

const normal=v=>String(v||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/gu,' ').trim();
const literal=v=>String(v||'').normalize('NFKC').replace(/\s+/gu,' ').trim();
const serial=v=>JSON.stringify(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const categorias=['identidade','ofertas','atores','condicoes','atores','condicoes','ofertas','condicoes','atores','condicoes','atores','condicoes','ofertas','atores','condicoes','atores'];

// Generic relations and documentary signals. No domain, organization name,
// annotated ID, expected quote, training target or external lookup is accepted.
const sinais={
  identidade:/\b(?:somos|oferecemos|prestamos|disponibilizamos|conectamos|intermediamos|fabricamos|vendemos|e uma? (?:empresa|plataforma|organizacao)|we (?:connect|offer|provide|help)|our (?:platform|software|services))\b/u,
  oferta:/\b(?:plataforma|software|sistema|servico|servicos|contabilidade|consultoria|produto|produtos|solucao|solucoes|plano|planos|curso|cursos|contratacao|licenca|assinatura|oferece|oferecemos|prestamos|disponibiliza|hire|hiring|service|services|platform|software|plan|plans)\b/u,
  ator:/\b(?:cliente|clientes|empresa|empresas|colaborador|colaboradores|funcionario|funcionarios|usuario|usuarios|signatario|signatarios|profissional|profissionais|prestador|prestadores|fornecedor|fornecedores|contratante|contratantes|beneficiario|beneficiarios|participante|participantes|equipe|time|pessoa|pessoas|businesses|professionals|freelancers?|developers?|talent|customer|customers|users?|employees?)\b/u,
  relacao:/\b(?:para|por|quem|entre|recebe|recebem|cria|criam|assina|assinam|contrata|contratam|solicita|solicitam|executa|executam|presta|prestado|prestados|oferece|oferecem|permite|permitem|paga|pagam|connect|connects|hire|hiring|work|agreeing|receiving|create|creates|receive|receives)\b/u,
  definicao:/\b(?:e (?:a|o|quem)|sao (?:as|os)|quem (?:voce|pode|contrata|executa)|diferenca entre|diferente de|nao (?:e|sao)|is (?:the|a)|means|difference between)\b/u,
  atribuicao:/\b(?:responsav(?:el|eis) (?:por|pel[oa]s?)|responsabilidade (?:de|d[ao]s?)|em nome d(?:e|[oa]s?)|(?:vendid|prestad|executad|operad|realizad)[oa]s? por)\b/u,
  gatilho:/\b(?:desde que|caso|exceto se|salvo quando|devido a|depois (?:de|que)|sempre que|sujeit[oa] a)\b/u,
  condicao:/\b(?:reembolso|cobranca|cobrancas|inclui|incluido|incluida|incluso|inclusa|exige|obrigatorio|obrigatoria|necessario|necessaria|precisa|precisar|devem|devera|somente|apenas|exceto|exclusivo|exclusiva|limite|limites|maximo|minimo|ate|acima|a partir|sem custo|cobrad[oa]|cobrad[oa]s|mensalidade|mensalidades|parcelas|gratuito|gratuita|custo|custos|taxa|horario|dias uteis|condicoes|depends|requires|included|limited|fee|fees|specified period|goals or hours|agreeing on a price)\b/u,
  negacao:/\b(?:nao|nunca|exceto|somente|apenas|sem|not|never|except|only|without)\b/u,
  quantidade:/\b\d+(?:[.,]\d+)?\s*(?:usuarios?|pessoas?|documentos?|horas?|dias?|meses?|anos?|reais|users?|documents?|hours?|days?|months?)\b/u,
  separacao:/\b(?:a parte|adicional|adicionais|ao contrario|enquanto|diferenca|diferente|mais de|independentemente|conforme|se precisar|no caso|depend[eê]|alem|instead|separately|whereas)\b/u,
  legal:/\b(?:dados pessoais|politica de privacidade|cookies|cookie|controlador de dados|personal data|privacy policy)\b/u,
  testemunho:/\b(?:casos de sucesso|case de sucesso|depoimentos?|testimonials?|customer stories|success stories|nossos resultados|na midia|na imprensa|in the news|press coverage)\b/u,
};

function tokens(texto){
  const stop=new Set(['para','como','mais','uma','com','por','dos','das','sua','seu','que','the','and','our','for','your','you','with','from','nos','nas','não','nao']);
  return new Set(normal(texto).split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>2&&!stop.has(x)));
}

function pontuar(fonte,ordem){
  const texto=normal(fonte.texto),hs=fonte.contexto.titulos.map(h=>normal(h.texto)).join(' ');
  const acertos=Object.fromEntries(Object.entries(sinais).map(([k,p])=>[k,p.test(texto)]));
  const n=texto.split(' ').length;
  const doc={
    paragrafo:['p','li','dd','dt'].includes(fonte.campo),
    bloco:fonte.campo==='bloco.titulo-conteudo',
    metadata:fonte.tipo==='descricao',
    titulo:/^h[1-6]$/u.test(fonte.campo),
    editorial:fonte.contexto.classePagina==='editorial',
    politica:fonte.contexto.classePagina==='politica'||sinais.legal.test(texto),
    terceiro:sinais.testemunho.test(hs)||classificarOrigemPublicada(fonte).estado!=='nao_determinada',
  };
  let comum=(n>=6?2:-5)+(doc.paragrafo?2:0)+(doc.bloco?1:0)-(doc.titulo?5:0)-(doc.editorial?8:0)-(doc.politica?8:0);
  if(n>80)comum-=2;
  if(/\b(?:melhor|imperdivel|incrivel|mais rapido|minutes|minutos|[0-9]+x)\b/u.test(texto)&&!acertos.definicao&&!acertos.separacao)comum-=3;
  const scores={
    identidade:comum+9*acertos.identidade+3*acertos.oferta+2*acertos.ator+(doc.metadata?4:0),
    atores:comum+5*acertos.ator+4*acertos.relacao+7*acertos.definicao+2*acertos.separacao+(acertos.ator&&acertos.atribuicao?8:0),
    condicoes:comum+7*acertos.condicao+3*acertos.negacao+3*acertos.quantidade+3*acertos.separacao+(acertos.condicao&&acertos.gatilho?5:0),
    ofertas:comum+7*acertos.oferta+3*acertos.identidade+2*acertos.ator+(doc.bloco?2:0),
  };
  return {fonte,ordem,scores,acertos,doc,tokens:tokens(fonte.texto)};
}

function similaridade(a,b){
  if(!a.size||!b.size)return 0;
  let comuns=0;for(const t of a)if(b.has(t))comuns++;
  return comuns/(a.size+b.size-comuns);
}

/** Offline selection for the journey reader. Full context counts toward the
 * budget, selected segments stay intact, and every ID maps to the source pool.
 * This is relevance selection, never a semantic or commercial approval. */
export function prepararJornadas(coleta,{maxFontes=16,maxCaracteres=15000}={}){
  if(!Number.isInteger(maxFontes)||maxFontes<1||maxFontes>16||
      !Number.isInteger(maxCaracteres)||maxCaracteres<256||maxCaracteres>24000)
    throw new TypeError('Orçamento de jornadas inválido.');
  const pool=extrairFontesNegocio(coleta);
  const fontesAntesReserva=pool.fontes.length;
  const descartesReserva=[];
  if(pool.fontes.length>640){
    // The safety cap applies after generic relevance scoring, not to the first
    // 640 paragraphs in document order. Subsequent per-offer retrieval can use
    // the retained pool, but it cannot restore discarded documents or text.
    const ordenadas=pool.fontes.map(pontuar).sort((a,b)=>{
      const nota=l=>Math.max(...Object.values(l.scores))-(l.fonte.tipo==='interface'?100:0)-(l.fonte.recortado?50:0)-(l.doc.terceiro?100:0);
      return nota(b)-nota(a)||a.ordem-b.ordem;
    });
    descartesReserva.push(...ordenadas.slice(640).map(l=>({id:l.fonte.id,motivo:'limite_reserva_apos_pontuacao'})));
    pool.fontes=ordenadas.slice(0,640).sort((a,b)=>a.ordem-b.ordem).map(l=>l.fonte);
  }
  pool.cobertura={...pool.cobertura,fontesAntesReserva,maxFontesReserva:640,fontesRetidas:pool.fontes.length,
    reservaLimitada:descartesReserva.length>0,limitada:pool.cobertura.limitada||descartesReserva.length>0};
  const base={versao:1,dominio:pool.dominio,fontes:[]};
  const candidatos=[],descartes=[...descartesReserva],duplicatas=new Map();
  for(const [ordem,fonte] of pool.fontes.entries()){
    let motivo=null;
    if(fonte.tipo==='interface')motivo='interface_nao_prova_negocio';
    else if(fonte.recortado)motivo='segmento_recortado_nao_selecionado';
    else if(!fonte.coletadoEm||!Number.isFinite(Date.parse(fonte.coletadoEm)))motivo='data_contextual_indisponivel';
    else if(/\?\s*$/u.test(fonte.texto))motivo='pergunta_sem_resposta_no_segmento';
    const linha=pontuar(fonte,ordem);
    if(linha.doc.terceiro)motivo='contexto_de_depoimento_ou_resultado_de_terceiro';
    if(textoPadraoDeConsentimento(fonte.texto))motivo='texto_padrao_de_consentimento_nao_descreve_operacao';
    if(motivo){descartes.push({id:fonte.id,motivo});continue;}
    const chave=serial([literal(fonte.texto),fonte.contexto.tituloPagina,fonte.contexto.titulos,fonte.contexto.classePagina]);
    const anterior=duplicatas.get(chave);
    if(anterior){
      if(Math.max(...Object.values(linha.scores))>Math.max(...Object.values(anterior.scores))){
        descartes.push({id:anterior.fonte.id,motivo:'texto_contexto_repetido'});duplicatas.set(chave,linha);
      }else descartes.push({id:fonte.id,motivo:'texto_contexto_repetido'});
    }else duplicatas.set(chave,linha);
  }
  for(const l of duplicatas.values()){
    if(Math.max(...Object.values(l.scores))<7)descartes.push({id:l.fonte.id,motivo:'sem_sinal_minimo_de_negocio'});
    else candidatos.push(l);
  }
  const escolhidos=[],vistos=new Set(),paginas=new Map(),secoes=new Map(),mapaIds={},selecoes=[];
  const chaveSecao=l=>l.fonte.contexto.titulos.length?serial([l.fonte.url,l.fonte.contexto.titulos]):null;
  const apto=(l,c)=>c==='identidade'?(l.acertos.identidade||l.doc.metadata&&l.acertos.oferta)
    :c==='atores'?l.acertos.ator&&(l.acertos.relacao||l.acertos.atribuicao)
    :c==='condicoes'?l.acertos.condicao&&(l.acertos.relacao||l.acertos.quantidade||l.acertos.negacao||l.acertos.gatilho)
    :l.acertos.oferta&&(l.acertos.relacao||l.acertos.identidade||l.doc.metadata);
  const sobreposto=l=>escolhidos.some(s=>s.fonte.url===l.fonte.url&&
    (literal(s.fonte.texto)===literal(l.fonte.texto)||literal(s.fonte.texto).includes(literal(l.fonte.texto))));
  const valor=(l,categoria)=>{
    const similar=escolhidos.length?Math.max(...escolhidos.map(s=>similaridade(l.tokens,s.tokens))):0;
    return l.scores[categoria]+0.15*Math.max(...Object.values(l.scores))
      -12*similar-0.5*(paginas.get(l.fonte.url)||0)-0.35*(secoes.get(chaveSecao(l))||0);
  };
  for(let rodada=0;rodada<maxFontes;rodada++){
    const categoria=categorias[rodada%categorias.length];
    const restantes=candidatos.filter(l=>!vistos.has(l.fonte.id)&&!sobreposto(l));
    const especificos=restantes.filter(l=>apto(l,categoria));
    const disponiveis=especificos.length?especificos:restantes;
    disponiveis.sort((a,b)=>valor(b,categoria)-valor(a,categoria)||a.ordem-b.ordem);
    let escolhido=null;
    for(const l of disponiveis){
      const f=l.fonte,modelo={id:'s'+String(base.fontes.length+1).padStart(2,'0'),texto:f.texto,tipo:f.tipo,contexto:structuredClone(f.contexto)};
      if(serial({...base,fontes:[...base.fontes,modelo]}).length>maxCaracteres){
        vistos.add(f.id);descartes.push({id:f.id,motivo:'orcamento_contexto_integral'});continue;
      }
      escolhido=l;base.fontes.push(modelo);mapaIds[modelo.id]=f.id;
      selecoes.push({id:f.id,idModelo:modelo.id,categoria,scoreCategoria:l.scores[categoria],scoreSelecao:valor(l,categoria),sinais:l.acertos});
      vistos.add(f.id);escolhidos.push(l);paginas.set(f.url,(paginas.get(f.url)||0)+1);
      const secao=chaveSecao(l);secoes.set(secao,(secoes.get(secao)||0)+1);break;
    }
    if(!escolhido)break;
  }
  for(const l of candidatos)if(!vistos.has(l.fonte.id))descartes.push({id:l.fonte.id,motivo:sobreposto(l)?'contido_em_segmento_selecionado':'fora_da_selecao_limitada'});
  return {base,mapaIds,pool,recuperacao:{versao:1,maxFontes,maxCaracteres,
    caracteresComContexto:serial(base).length,orcamentoContado:'JSON completo da base com domínio, IDs, texto, tipo e contexto.',
    fontesNoPool:pool.fontes.length,candidatosElegiveis:candidatos.length,fontesRetidas:base.fontes.length,
    paginasRetidas:paginas.size,selecoes,descartes,
    limitada:pool.cobertura.limitada||descartes.length>0,
    limites:['Pontuação editorial genérica; não é probabilidade de acerto nem aprovação de negócio.',
      'Escolha limitada a16fontes e orçamento contextual; pode perder oferta, ator ou condição relevante.',
      'A base é a primeira seleção; o pool de até640fontes permite recuperação posterior por oferta. Reserva limitada é declarada.',
      'Segmentos recortados são descartados integralmente; não completar condições omitidas.',
      'Hierarquia DOM e nomes publicados auxiliam o leitor, mas não confirmam vínculo comercial ou vigência.',
      'HTML inicial capturado offline; nenhum script, rede, formulário ou API foi executado.']}};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [captura,saida]=process.argv.slice(2);
  if(!captura||!saida)throw Error('Uso: node ia/negocio/jornadas/preparar.mjs CAPTURA SAIDA_NOVA');
  const carregada=carregarCapturaLocal(resolve(captura));
  const resultado=prepararJornadas(carregada.coleta);
  resultado.captura={...carregada.captura,arquivo:resolve(captura)};
  resultado.codigoSha256={preparador:hash(await readFile(new URL(import.meta.url))),exportador:hash(await readFile(new URL('../fontes-v5.mjs',import.meta.url))),baseV4:hash(await readFile(new URL('../fontes-v4.mjs',import.meta.url))),contextoPublico:hash(await readFile(new URL('../../../src/modulos/contexto-publico.mjs',import.meta.url))),perguntasPublicadas:hash(await readFile(new URL('../../../src/modulos/perguntas-publicadas.mjs',import.meta.url)))};
  await writeFile(resolve(saida),serial(resultado)+'\n',{flag:'wx',mode:0o600});
}
