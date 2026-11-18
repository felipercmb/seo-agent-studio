import {createHash} from 'node:crypto';
const lista=v=>Array.isArray(v)?v:[];
const texto=v=>typeof v==='string'?v.replace(/\s+/gu,' ').trim():'';
const normal=v=>texto(v).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,20);
const corpo=f=>/^(?:p|li|dd|bloco\.titulo-conteudo|jsonld\.(?:Service|Product|Organization)\.description)$/u.test(f.campo||'');
const completa=o=>['comprador','executor','beneficiario','objetivo'].every(k=>texto(o.jornada?.[k]));
const chave=f=>[f.url,f.sha256,f.campo,f.secao,f.trecho];
function fontePropria(o,ofertas,fontes,ordenar){
 const fontesDaOferta=fontes.filter(f=>{
  if(f.url!==o.url||f.recortado!==false||!corpo(f)||texto(f.trecho).length<35||texto(f.trecho).length>1600)return false;
  const n=normal(f.trecho);
  if(n.split(/\s+/u).length<25&&/(?:\bpromoc\w*|\boferta promocional|\boff\b|\d+\s*%)/u.test(n))return false;
  const nome=normal(o.nome),compacto=x=>normal(x).replace(/[^a-z0-9]/gu,'');
  const corpoNomeado=compacto(f.trecho).includes(compacto(o.nome));
  const partes=nome.match(/[a-z0-9]{3,}/gu)||[],ultimo=partes.at(-1);
  const objetoNoCorpo=ultimo&&normal(f.secao).includes(nome)&&new RegExp('\\b'+ultimo+'\\b','u').test(n);
  if(!corpoNomeado&&!objetoNoCorpo)return false;
  if(ofertas.some(x=>x.id!==o.id&&compacto(f.trecho).includes(compacto(x.nome))))return false;
  const v=ordenar.validar(f,o,ofertas.filter(x=>x.url===f.url));
  // A named page/section is insufficient. Keep a reference in the actual body.
  return v.sustentado&&['nome_da_oferta_no_corpo','objeto_referido_no_corpo'].includes(v.motivo);
 });
 return ordenar.preferir(fontesDaOferta,o)[0]||null;
}
/** Compares declared purposes, not inferred suitability. All proposed needs are fictional. */
export function prepararComparacaoObjetivos({oferta,ofertas=[],fontes=[],validarVinculo,preferirFontes=fs=>fs}={}){
 if(!oferta||!completa(oferta)||typeof validarVinculo!=='function')return null;
 // Respect an explicit comparison task that earlier rules could not substantiate.
 // A general review is different from replacing the requested comparison.
 if(/\b(?:compar\w*|distingu\w*|separ\w*|diferenci\w*)\b/u.test(normal(oferta.jornada.objetivo)))return null;
 const ordenar={validar:validarVinculo,preferir:preferirFontes},primeira=fontePropria(oferta,ofertas,fontes,ordenar);
 if(!primeira)return null;
 const candidatas=lista(ofertas).filter(o=>o.id!==oferta.id&&completa(o)&&normal(o.jornada.objetivo)!==normal(oferta.jornada.objetivo))
  .map(o=>({o,f:fontePropria(o,ofertas,fontes,ordenar)})).filter(x=>x.f);
 const segunda=candidatas[0];if(!segunda)return null;
 const pares=[{o:oferta,f:primeira},segunda],opcoes=pares.map(({o,f})=>{
  const fonte={...f,fonteId:f.fonteId||'pub_'+hash([f.url,f.campo,f.sha256,f.trecho])};
  return{id:'dp_'+hash([o.id,chave(f)]),nome:o.nome,ofertaId:o.id,ofertaNome:o.nome,url:o.url,fonte,
   finalidade:texto(o.jornada.objetivo),origemFinalidade:'declaracao_usuario',escopo:'objeto_publicado_objetivo_declarado'};
 });
 const casos=pares.map(({o},i)=>({
  id:'objetivo_'+(i+1),natureza:'hipotese_controlada',
  dadosEntrada:{objetivoDeclarado:texto(o.jornada.objetivo),solicitanteDeclarado:texto(o.jornada.comprador),
   executorDeclarado:texto(o.jornada.executor),beneficiarioDeclarado:texto(o.jornada.beneficiario),origemDasPartes:'declaracao_usuario',
   contextoReal:null,condicoesReais:null},
  necessidade:'Caso fictício: uma solicitação apresenta este objetivo declarado no perfil: “'+texto(o.jornada.objetivo)+'”. '+
   'Solicita/avalia: '+texto(o.jornada.comprador)+'. Execução declarada: '+texto(o.jornada.executor)+'. Usa/recebe: '+texto(o.jornada.beneficiario)+
   '. São declarações do perfil usadas no ensaio; a publicação não as confirma.',
  esperado:{alternativas:[opcoes[i].id],natureza:'roteiro_de_conferencia',adequacaoConfirmada:false,
   justificativa:'O bloco de “'+o.nome+'” é a referência publicada a confrontar com este pedido. A resposta disponível é o trecho literal desta alternativa; '+
    'ela não confirma que o objetivo inteiro seja atendido, que uma condição esteja incluída ou que o fornecedor execute a rotina do usuário. '+
    'Use o roteiro e pergunte à parte declarada exatamente quais etapas do objetivo estão cobertas e quais dados do caso real faltam.'},
  fontes:[opcoes[i].fonte.fonteId]
 }));
 return{tipo:'comparar_objetivos_declarados',pergunta:'Qual publicação deve orientar cada pedido e o que ainda impede avançar com segurança?',
  opcoes,casos,
  entradaReal:'Objetivo e contexto reais, quem solicitará e executará cada etapa, oferta/plano aplicável e condições específicas. Os objetivos e partes acima são declarações do perfil, não fatos confirmados pelo site.',
  mecanismo:'Os dois pedidos já estão redigidos com objetivos distintos e responsabilidades declaradas. Cada um tem sua publicação e seu próximo passo, para preparar uma solicitação que pergunte o alcance de cada etapa, sem escolher pela promessa ou transferir condições entre ofertas.',
  limites:['Os pedidos são fictícios; a fonte apenas documenta o que foi publicado sobre aquele objeto.','A correspondência entre pedido e publicação é um roteiro de confronto, não aprovação de adequação, inclusão em plano ou contratação.','As condições permanecem no trecho da respectiva alternativa. O que não foi publicado continua desconhecido.']};
}
