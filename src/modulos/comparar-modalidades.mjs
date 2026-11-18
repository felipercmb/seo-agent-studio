import {extrairCondicoesEstruturadas} from './condicoes-estruturadas.mjs';

const segmentador = new Intl.Segmenter('pt-BR',{granularity:'sentence'});
const normal = valor => valor.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/gu,' ').trim();
const modalidadeExata = /^(?:[OoAa]\s+)?(?<nome>[Pp]lano\s+(?:(?:[Gg]ratuito|[Bb][áa]sico)(?![\p{L}\p{N}])|\p{Lu}[\p{L}\p{N}-]*(?:\s+\p{Lu}[\p{L}\p{N}-]*){0,2}))\s+(?:custa|atende|inclui|possui|tem|permite|aceita|suporta|[ée] limitado)\b/u;
const outraModalidade = /\bplanos?\s+(?:pagos?|gratuitos?|[\p{L}\p{N}-]+)\b/iu;

function limiteDeCartao(f){
  if(!f||typeof f!=='object')return null;
  const c=f.contexto||f, trecho=f.trecho??f.texto;
  if(c.campo!=='bloco.titulo-conteudo'||c.recortado!==false||typeof trecho!=='string'||trecho.length>600)return null;
  const titulo=c.titulos?.at(-1);
  if(!titulo||![2,3,4].includes(titulo.nivel)||!/^\p{Lu}[\p{L}\p{N}-]*(?:\s+[\p{Lu}\p{N}][\p{L}\p{N}-]*){0,2}$/u.test(titulo.texto))return null;
  const posicao=trecho.indexOf(titulo.texto);
  if(posicao<0||posicao>55||!/^\s+R\$\s*\d/u.test(trecho.slice(posicao+titulo.texto.length)))return null;
  if(!/\b(?:assine|assinar|contrate|contratar)\b/iu.test(trecho))return null;
  const limites=[...trecho.matchAll(/\bat[eé]\s+([1-9]\d{0,5})\s+usu[áa]rios?\s+de\s+campo\b/giu)];
  if(limites.length!==1)return null;
  const [m]=limites;
  const antes=trecho.slice(Math.max(0,m.index-55),m.index);
  const apos=trecho.slice(m.index+m[0].length);
  if(/\b(?:n[aã]o|exceto|somente|apenas|exclusivo para)\s*$/iu.test(antes)||/^\s*\//u.test(apos)||
    /^\s*(?:[,;]\s*)?(?:salvo|exceto|somente|apenas|se|desde que|para|por|a cada|ativos?|adicionais|extras|gratuitos?|simult[aâ]neos?)\b/iu.test(apos))return null;
  return {modalidade:titulo.texto,unidade:'usuarios_de_campo',minimo:null,maximo:Number(m[1]),
    trechoLimite:m[0],inicio:m.index,fim:m.index+m[0].length,frase:trecho,fonte:f};
}

/** Keep all recognized cards of a page within a bounded evidence budget. */
export function selecionarCartoesDeModalidades(fontes){
  const grupos=new Map();
  for(const f of fontes){
    if(!limiteDeCartao(f))continue;
    const url=f.contexto?.url, itens=grupos.get(url)||[];
    if(!url)continue;
    if(itens.length<=10)itens.push(f);
    grupos.set(url,itens);
  }
  return [...grupos.values()].filter(itens=>itens.length>=2&&itens.length<=10).flat();
}

function limiteDaModalidade(f,d,o){
  const condicoes=extrairCondicoesEstruturadas({dominio:d,ofertaId:o,
    fontes:[{id:'condicao',texto:f.trecho,url:f.url,sha256:f.sha256,coletadoEm:f.coletadoEm}]}).condicoes;
  const unidades=[...segmentador.segment(f.trecho)];
  const encontrados=[];
  for(const c of condicoes){
    const frase=unidades.find(s=>s.index<=c.inicio&&s.index+s.segment.length>=c.fim);
    if(!frase)continue;
    const match=modalidadeExata.exec(frase.segment);
    if(!match||outraModalidade.test(frase.segment.slice(match[0].length)))continue;
    encontrados.push({modalidade:match.groups.nome,unidade:c.unidade,minimo:c.minimo,maximo:c.maximo,
      trechoLimite:c.fraseLiteral,inicio:c.inicio,fim:c.fim,frase:frase.segment.trim(),fonte:f});
  }
  return encontrados;
}

function avaliacaoDoLimite(n,faixa){
  if(faixa.maximo!==null&&n>faixa.maximo)return 'acima_do_maximo';
  if(faixa.minimo!==null&&n<faixa.minimo)return 'abaixo_do_minimo';
  return 'dentro_dos_limites_publicados';
}

/** Compare named plans published on the same version of a page and the same
 * unit. Published boundaries only guide test cases for further manual review. */
export function compararLimitesDeModalidades({dominio,ofertaId,fontes=[]}={}){
  const grupos=new Map();
  for(const f of fontes.slice(0,40)){
    if(f?.recortado!==false||typeof f.trecho!=='string'||f.trecho.length>1600)continue;
    const cartao=limiteDeCartao(f);
    if(!cartao&&(!/\bplano\s+/iu.test(f.trecho)||!/\d/.test(f.trecho)))continue;
    let faixas;
    try{faixas=limiteDaModalidade(f,dominio,ofertaId);}catch{continue;}
    if(cartao)faixas=[cartao];
    for(const faixa of faixas){
      const grupo=JSON.stringify([f.url,f.sha256,f.coletadoEm,faixa.unidade]);
      if(!grupos.has(grupo))grupos.set(grupo,[]);
      grupos.get(grupo).push(faixa);
    }
  }

  for(const rs of grupos.values()){
    const nomes=new Map(),ambiguos=new Set();
    for(const r of rs){
      const k=normal(r.modalidade),anterior=nomes.get(k);
      if(!anterior)nomes.set(k,r);
      else if(anterior.minimo!==r.minimo||anterior.maximo!==r.maximo)ambiguos.add(k);
    }
    const ofertas=[...nomes].filter(([k])=>!ambiguos.has(k)).map(([,r])=>r);
    for(const [i,a] of ofertas.entries())for(const b of ofertas.slice(i+1)){
      if(a.minimo===b.minimo&&a.maximo===b.maximo)continue;
      const limites=new Set([a.minimo,b.minimo,a.maximo,b.maximo].filter(n=>n!==null));
      const quantidades=[...new Set([...limites].flatMap(n=>[n-1,n,n+1]).filter(n=>n>0&&Number.isSafeInteger(n)))].sort((x,y)=>x-y);
      const casos=quantidades.map(quantidade=>({quantidade,comparacao:[a,b].map(f=>({
        modalidade:f.modalidade,resultado:avaliacaoDoLimite(quantidade,f)}))}));
      const resultadosDiferentes=new Map();
      for(const c of casos){
        const chave=JSON.stringify(c.comparacao.map(x=>x.resultado));
        const anterior=resultadosDiferentes.get(chave);
        if(!anterior||limites.has(c.quantidade)&&!limites.has(anterior.quantidade))resultadosDiferentes.set(chave,c);
      }
      return{versao:1,unidade:a.unidade,modalidades:[a,b],casos:[...resultadosDiferentes.values()].slice(0,4),
        elegibilidadeConfirmada:false,limitesSujeitosAConfirmacao:true};
    }
  }
  return null;
}
