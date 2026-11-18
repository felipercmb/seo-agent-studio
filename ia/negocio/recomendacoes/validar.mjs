/** Contrato local v1 de recomendações. Não avalia utilidade ou verdade semântica. */
const CHAVES=['estado','decisao','alternativas','criterios','acao','verificar','fontes','incertezas','hipotese'];
const TIPOS_FONTE=new Set(['declaracao','descricao','conteudo','interface']);
const objeto=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const normal=v=>typeof v==='string'?v.normalize('NFKC').replace(/\s+/gu,' ').trim():'';
const temControle=v=>/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);
function chaves(v,esperadas,caminho,erros){if(!objeto(v)){erros.push(caminho+': deve ser um objeto.');return false;}const cs=Object.keys(v);for(const k of cs)if(!esperadas.includes(k))erros.push(caminho+'.'+k+': chave não permitida.');for(const k of esperadas)if(!Object.hasOwn(v,k))erros.push(caminho+'.'+k+': chave obrigatória.');return true;}
function string(v,max,caminho,erros,{vazia=false}={}){if(typeof v!=='string'||[...v].length>max||temControle(v)||!vazia&&!normal(v))erros.push(caminho+': texto inválido (máximo '+max+' caracteres).');}
function lista(v,max,caminho,erros,{min=0}={}){if(!Array.isArray(v)||v.length>max||v.length<min){erros.push(caminho+': lista inválida ('+min+'–'+max+' itens).');return false;}return true;}
function referencias(ids,fontes,caminho,erros,{min=1}={}){if(!lista(ids,16,caminho,erros,{min}))return[];const validas=[];for(const id of ids){if(typeof id!=='string'||!fontes.has(id))erros.push(caminho+': referência desconhecida.');else validas.push(fontes.get(id));}if(new Set(ids).size!==ids.length)erros.push(caminho+': referências repetidas.');return validas;}
function contemLiteral(texto,fontes){const t=normal(texto);return t.length>0&&fontes.some(f=>normal(f.texto).includes(t));}
function fontesDaEntrada(entrada,erros){const mapa=new Map();if(!objeto(entrada)||entrada.tarefa!=='recomendar'){erros.push('entrada: tarefa recomendar obrigatória.');return mapa;}chaves(entrada,['tarefa','perfil','fontes'],'entrada',erros);if(!objeto(entrada.perfil))erros.push('entrada.perfil: perfil compacto obrigatório.');if(!lista(entrada.fontes,16,'entrada.fontes',erros))return mapa;for(const[f,i]of entrada.fontes.map((f,i)=>[f,i])){if(!objeto(f)){erros.push('entrada.fontes['+i+']: fonte inválida.');continue;}chaves(f,['id','texto','tipo'],'entrada.fontes['+i+']',erros);if(typeof f.id!=='string'||!f.id||f.id.length>160||! /^[A-Za-z][A-Za-z0-9_-]*$/u.test(f.id)||temControle(f.id))erros.push('entrada.fontes['+i+'].id: inválido.');string(f.texto,600,'entrada.fontes['+i+'].texto',erros);if(!TIPOS_FONTE.has(f.tipo))erros.push('entrada.fontes['+i+'].tipo: inválido.');if(mapa.has(f.id))erros.push('entrada.fontes: ID repetido.');mapa.set(f.id,f);}return mapa;}

export function validarEntradaRecomendacao(entrada){const erros=[];fontesDaEntrada(entrada,erros);return{valido:erros.length===0,erros};}

export function validarSaidaRecomendacao(saida,entrada){
  const erros=[],fontes=fontesDaEntrada(entrada,erros),avisos=[];
  if(!chaves(saida,CHAVES,'saida',erros))return{valido:false,erros,avisos};
  if(!['proposta','insuficiente'].includes(saida.estado))erros.push('saida.estado: inválido.');
  if(saida.hipotese!==true)erros.push('saida.hipotese: deve ser true.');
  for(const[k,max]of [['decisao',260],['acao',420],['verificar',420]])string(saida[k],max,'saida.'+k,erros,{vazia:saida.estado==='insuficiente'});
  const refs=referencias(saida.fontes,fontes,'saida.fontes',erros,{min:saida.estado==='proposta'?1:0}),citados=new Set(Array.isArray(saida.fontes)?saida.fontes:[]);
  if(lista(saida.incertezas,4,'saida.incertezas',erros,{min:1}))saida.incertezas.forEach((v,i)=>string(v,240,'saida.incertezas['+i+']',erros));
  if(lista(saida.alternativas,4,'saida.alternativas',erros))for(const[i,a]of saida.alternativas.entries()){
    const k='saida.alternativas['+i+']';if(!chaves(a,['texto','fontes'],k,erros))continue;string(a.texto,160,k+'.texto',erros);
    const ff=referencias(a.fontes,fontes,k+'.fontes',erros);if(!contemLiteral(a.texto,ff))erros.push(k+'.texto: não é trecho literal das fontes citadas.');
    for(const id of Array.isArray(a.fontes)?a.fontes:[])if(!citados.has(id))erros.push(k+': referência ausente de saida.fontes.');
    if(ff.some(f=>f.tipo==='interface'))erros.push(k+': interface não sustenta alternativa de negócio.');
  }
  if(lista(saida.criterios,4,'saida.criterios',erros))for(const[i,c]of saida.criterios.entries()){
    const k='saida.criterios['+i+']';if(!chaves(c,['texto','escopo','fontes'],k,erros))continue;string(c.texto,240,k+'.texto',erros);
    const ff=referencias(c.fontes,fontes,k+'.fontes',erros);if(!contemLiteral(c.texto,ff))erros.push(k+'.texto: não é trecho literal das fontes citadas.');
    if(c.escopo!==null){string(c.escopo,120,k+'.escopo',erros);if(!contemLiteral(c.escopo,ff))erros.push(k+'.escopo: não é trecho literal das fontes citadas.');}
    if(ff.some(f=>f.tipo==='interface'))erros.push(k+': uma interface não comprova condição de negócio.');
    if(ff.some(f=>f.recortado===true))avisos.push(k+': fonte recortada exige conferência de que a condição citada está completa.');
    for(const id of Array.isArray(c.fontes)?c.fontes:[])if(!citados.has(id))erros.push(k+': referência ausente de saida.fontes.');
  }
  if(saida.estado==='proposta'){
    if(!Array.isArray(saida.criterios)||!saida.criterios.length)erros.push('saida.criterios: proposta requer uma condição literal.');
    if(refs.length&&refs.every(f=>f.tipo==='interface'))erros.push('saida.fontes: proposta não pode ser sustentada somente por interfaces.');
  }else if(saida.estado==='insuficiente'){
    for(const k of ['decisao','acao','verificar'])if(saida[k]!=='')erros.push('saida.'+k+': abstenção exige string vazia.');
    for(const k of ['alternativas','criterios','fontes'])if(!Array.isArray(saida[k])||saida[k].length)erros.push('saida.'+k+': abstenção exige lista vazia.');
  }
  const livre=[saida.decisao,saida.acao,saida.verificar].filter(v=>typeof v==='string').join(' ');
  for(const m of livre.matchAll(/\b(?:garant(?:e|ir|ido)\w*\s+(?:lucro|receita|retorno)|invista\s+R\$|aumente\s+(?:a\s+)?verba|reduza\s+(?:o\s+)?orçamento)\b/giu)){
    const prefixo=livre.slice(0,m.index).split(/[.!?;,:\n]/u).at(-1).slice(-100);
    if(!/\b(?:não|nao|nunca|sem)(?:\s+(?:podemos|pode|poder|consegue|conseguimos|se|é|e|possível|possivel|ser|de|que|vamos))*\s*$/iu.test(prefixo)){
      erros.push('saida: prescrição financeira não sustentada.');break;
    }
  }
  return{valido:erros.length===0,erros,avisos,limite:'Validação de estrutura, limites e referências literais. Não mede U1–U4, adequação semântica, resultado comercial ou aprovação humana.'};
}

/** Accept exactly JSON, refusing markdown/trailing text and duplicate keys. */
export function interpretarSaidaRecomendacao(bruta,entrada){
  if(typeof bruta!=='string'||[...bruta].length>16000)return{valido:false,erros:['Resposta textual ausente ou maior que 16000 caracteres.'],saida:null};
  try{rejeitarChavesDuplicadas(bruta);const saida=JSON.parse(bruta);return{...validarSaidaRecomendacao(saida,entrada),saida};}
  catch{return{valido:false,erros:['JSON inválido, chave repetida ou conteúdo adicional.'],saida:null};}
}
function rejeitarChavesDuplicadas(s){
  let i=0;const espaco=()=>{while(/\s/u.test(s[i]||'')&&i<s.length)i++;};
  function texto(){const inicio=i;if(s[i++]!=='"')throw Error();while(i<s.length){if(s[i]==='\\'){i+=2;continue;}if(s[i++]==='"')return JSON.parse(s.slice(inicio,i));}throw Error();}
  function valor(profundidade){if(profundidade>24)throw Error();espaco();if(s[i]==='"'){texto();return;}if(s[i]==='{'){i++;espaco();const ks=new Set();if(s[i]==='}'){i++;return;}while(i<s.length){espaco();const k=texto();if(ks.has(k))throw Error();ks.add(k);espaco();if(s[i++]!==':')throw Error();valor(profundidade+1);espaco();if(s[i]==='}'){i++;return;}if(s[i++]!==',')throw Error();}throw Error();}if(s[i]==='['){i++;espaco();if(s[i]===']'){i++;return;}while(i<s.length){valor(profundidade+1);espaco();if(s[i]===']'){i++;return;}if(s[i++]!==',')throw Error();}throw Error();}const m=s.slice(i).match(/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u);if(!m)throw Error();i+=m[0].length;}
  valor(0);espaco();if(i!==s.length)throw Error();
}
