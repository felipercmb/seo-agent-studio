import {createHash} from 'node:crypto';
import {rotuloContatoExplicito} from './interacoes-publicas.mjs';

const lista=v=>Array.isArray(v)?v:[];
const texto=v=>typeof v==='string'?v.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/gu,' ').trim():'';
const normal=v=>texto(v).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const comuns=new Set(['para','pelo','pela','como','mais','menos','seus','suas','voce','empresa','empresas','equipe','equipes','sistema','plataforma','software','servico','servicos','oferta','gestao','rotina','rotinas','objetivo','hipotese','tecnica','validar','precisa','precisam','antes','depois','informacao','informacoes']);
const termos=v=>[...new Set(normal(v).match(/[a-z]{4,}/g)||[])].filter(x=>!comuns.has(x));
const raiz=v=>v.length>=7?v.slice(0,6):v.replace(/s$/,'');
const intersecao=(a,b)=>a.filter(x=>b.some(y=>raiz(x)===raiz(y))).length;
const opera=/\b(?:configura\w*|organiza(?:m|mos|r|ndo)?|centraliza(?:m|mos|r|ndo)?|conecta\w*|integra\w*|encaminha\w*|mantem|armazena\w*|envia\w*|recebe\w*|realiza\w*|executa\w*|permite\w*|oferec\w*|transport\w*|entreg\w*|planeja\w*|seleciona\w*|define\w*|reune|disponibiliza\w*)\b/u;
const dor=/\b(?:historico inacessivel|precisa repetir|repetir tudo|nao sabe|nao consegue|sem controle|sem visibilidade|sem historico|frustrad\w*)\b/u;
const idFonte=f=>'pub_'+createHash('sha256').update(JSON.stringify([f.url,f.campo,f.sha256,f.trecho])).digest('hex').slice(0,20);
const chave=f=>JSON.stringify([f.url,f.sha256,f.campo,f.trecho]);
const contextoDeEscopo=/\b(?:opcional|opcionais|caso opte|se optar|pode(?:m)? ser contratado|contratad[oa] separadamente|nao incluid[oa]|nao inclui|alem d[oa])\b/u;
const sobreposicao=(a,b)=>intersecao(termos(a),termos(b));
const repeticao=(a,b)=>normal(a.trecho).includes(normal(b.trecho))||normal(b.trecho).includes(normal(a.trecho));
const escopoGenerico=new Set(['plano','planos','pacote','pacotes','programa','programas','produto','produtos']);
const palavrasEscopo=v=>termos(v).filter(t=>!escopoGenerico.has(t));
const equivale=(a,b)=>a===b||a+'s'===b||b+'s'===a||a+'r'===b||b+'r'===a||a+'ista'===b||a+'istas'===b||b+'ista'===a||b+'istas'===a;
const contemNome=(corpo,nome)=>nome.length>=5&&new RegExp('(?<![\\p{L}\\p{N}_])'+nome.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')+'(?![\\p{L}\\p{N}_])','u').test(corpo);
/** A link to a guide is a publication route, not the work of the offer. */
export function materialAuxiliarSemObjetivo(f,oferta){
 const trecho=normal(f.trecho),secao=normal(f.secao),objetivo=normal(oferta.jornada?.objetivo);
 const pedido=/\b(?:baixar|acessar|ler|consultar|encontrar)\b.{0,60}\b(?:whitepaper|e-?book|guia|guias|tutorial|tutoriais|base de conhecimento|material)\b/u.test(objetivo);
 const auxiliar=/\b(?:acesse|baixe|encontre|consulte|leia)\b.{0,90}\b(?:whitepaper|e-?book|guias?|tutoriais|base de conhecimento)\b/u.test(trecho)||
  /\b(?:base de conhecimento|central de ajuda|whitepaper|e-?book)\b/u.test(secao)&&/\b(?:guia|guias|tutorial|tutoriais|acesse|baixe|encontre)\b/u.test(trecho);
 return auxiliar&&!pedido;
}
/** Lexical scope is conservative support, never semantic approval. Page titles
 * and URLs cannot turn a neighbouring bundle into an answer about this plan. */
export function conferirVinculoResposta(f,oferta,ofertas=[]){
  const corpo=normal(f.trecho),nome=normal(oferta.nome),palavras=termos(f.trecho);
  const outras=lista(ofertas).filter(o=>o.id!==oferta.id&&normal(o.nome)!==nome),
    comunsAOutras=new Set(outras.flatMap(o=>palavrasEscopo(o.nome))),
    distintivos=palavrasEscopo(oferta.nome).filter(t=>!comunsAOutras.has(t)),
    encontrados=distintivos.filter(t=>palavras.some(p=>equivale(t,p)));
  if(outras.some(o=>contemNome(corpo,normal(o.nome))))return{sustentado:false,motivo:'outro_objeto_nomeado_no_corpo'};
  if(f.natureza==='resposta_estruturada_publicada'){
    const pergunta=normal(f.pergunta);
    if(outras.some(o=>contemNome(pergunta,normal(o.nome))))return{sustentado:false,motivo:'faq_refere_outro_objeto'};
    return contemNome(corpo,nome)||contemNome(pergunta,nome)?{sustentado:true,motivo:'faq_nome_explicito_da_oferta'}:{sustentado:false,motivo:'faq_sem_nome_explicito_da_oferta'};
  }
  if(contemNome(corpo,nome))return{sustentado:true,motivo:'nome_da_oferta_no_corpo'};
  const catalogo=/\b(?:em um so lugar|tem tudo|tudo para|e muito mais|entre outros|diversos servicos|diversas solucoes)\b/u.test(corpo);
  if(catalogo)return{sustentado:false,motivo:'catalogo_geral_sem_nome_da_oferta'};
  const secao=normal(texto(f.secao).split(' / ').at(-1));
  if(secao.includes(nome)&&nome.length>=5)return{sustentado:true,motivo:'secao_propria_sem_objeto_concorrente'};
  const ancestralNomeado=normal(texto(f.secao)).split(' / ').slice(0,-1).some(t=>contemNome(t,nome));
  const primeiroNome=palavrasEscopo(oferta.nome)[0],rotuloCompartilhaPrefixo=primeiroNome&&secao.startsWith(primeiroNome)&&contemNome(secao,primeiroNome);
  if(distintivos.length>=2&&encontrados.length>0&&encontrados.length<distintivos.length&&rotuloCompartilhaPrefixo&&!ancestralNomeado)return{sustentado:false,motivo:'nome_parcial_nao_sustenta_o_objeto'};
  if(outras.length&&!encontrados.length)return{sustentado:false,motivo:'objeto_nao_sustentado_no_corpo_compartilhado'};
  if(!texto(f.secao)&&!encontrados.length)return{sustentado:false,motivo:'sem_secao_nem_objeto_no_corpo'};
  return{sustentado:true,motivo:encontrados.length?'objeto_referido_no_corpo':'publicacao_contextual_a_revisar'};
}

export function ordenarFontesDoObjetivo(oferta,fontes){
  const objetivo=termos(oferta.jornada?.objetivo),nome=termos(oferta.nome);
  return lista(fontes).map((f,i)=>{
    const t=normal(f.trecho),secao=termos(f.secao),palavras=termos(f.trecho);
    const ponto=Math.min(5,intersecao(objetivo,palavras))*3+Math.min(3,intersecao(objetivo,secao))*2+
      Math.min(3,intersecao(nome,palavras))+(opera.test(t)?5:0)-(dor.test(t+' '+normal(f.secao))?20:0);
    return{f,i,ponto};
  }).sort((a,b)=>b.ponto-a.ponto||a.i-b.i).map(x=>x.f);
}
function tema(f,nome){
  const s=texto(f.secao).split(' / ').at(-1);
  return s&&s.length<=180?s:nome;
}
function pergunta(f,nome){
  // Turn an explicit published relationship into a reading question. These
  // templates never supply an answer: the complete source remains the answer.
  const para=/^Para\s+([^,;.!?]{10,160}),\s+(?:[eé]\s+necess[aá]ri[oa]|[^.!?]{0,50}\b(?:deve|requer|exige))/iu.exec(f.trecho);
  if(para)return'Quais condições são publicadas para '+para[1]+'?';
  const acompanhamento=/\b(?:o\s+)?acompanhamento\s+(d[oa]\s+[^,;.!?]{3,70}?)\s+(?:vai|começa|inicia|ocorre|[eé]\s+feito)/iu.exec(f.trecho);
  if(acompanhamento)return'Como é descrito o acompanhamento '+acompanhamento[1]+'?';
  if(/\bdistribui\w*\s+automaticamente\s+para\b.{5,180}\bcom base n/iu.test(f.trecho))return'Para onde a publicação descreve o encaminhamento e que regra o orienta?';
  const s=tema(f,nome);
  return s.endsWith('?')?s:'Como a etapa “'+s+'” é descrita na publicação?';
}
function campo(rotulo,valorSugerido,origem,evidencia=null){
  return{rotulo,valorSugerido,origem,...(evidencia?{evidencia}:{})};
}
function proximoPasso(interacoes,fonte){
  return lista(interacoes).find(i=>i.url===fonte.url&&i.sha256===fonte.sha256&&
    i.htmlInicial===true&&i.modo==='nao_preenchido'&&['botao','link'].includes(i.tipo)&&
    ['contatar','solicitar_orcamento','agendar','reservar','comprar'].includes(i.acao)&&
    (i.acao!=='contatar'||rotuloContatoExplicito(i.rotulo))&&
    texto(i.rotulo)&&texto(i.rotulo).length<=120)||null;
}
function fontesParaRascunho(tarefa,oferta,fontes){
  const primeira=tarefa.decisao?.condicaoInteira||tarefa.decisao?.rotinaInteira;
  // Never swap out the selected fact while retaining its parsed limit/cases.
  // A long complete block can keep the conservative original task instead.
  if(!primeira||primeira.recortado!==false||!primeira.trecho||primeira.trecho.length>1600||primeira.tipo==='interface_publica')return[];
  const candidatas=[primeira,...ordenarFontesDoObjetivo(oferta,fontes)],vistas=new Set();
  const out=[];
  for(const f of candidatas){
    if(f.url!==primeira.url||f.sha256!==primeira.sha256||f.recortado!==false||!f.trecho||f.trecho.length>1600||f.tipo==='interface_publica')continue;
    if(dor.test(normal(f.trecho+' '+f.secao))&&out.length)continue;
    if(out.length&&contextoDeEscopo.test(normal(f.trecho))&&sobreposicao(primeira.trecho,f.trecho)>=2)continue;
    const k=chave(f);if(vistas.has(k))continue;vistas.add(k);out.push({...f,fonteId:idFonte(f)});
    if(out.length===1)continue;
    // A second fact has to help the declared goal, not merely occur on the
    // same page. A block and its own paragraph are one fact, not two cases.
    if(repeticao(out[0],f)||sobreposicao(oferta.jornada?.objetivo,f.trecho+' '+f.secao)<2){out.pop();continue;}
    break;
  }
  return out;
}
function contextoDaPublicacao(primeira,fontes){
  return lista(fontes).find(f=>f.url===primeira.url&&f.sha256===primeira.sha256&&f.recortado===false&&
    f.tipo!=='interface_publica'&&f.trecho&&f.trecho.length<=1600&&contextoDeEscopo.test(normal(f.trecho))&&
    !repeticao(primeira,f)&&sobreposicao(primeira.trecho,f.trecho)>=2)||null;
}
function entradasPublicadas(j,fs,nome,partes){
  // Only alternatives already present in the declared goal AND in a complete
  // publication become proposed test situations. They are not customer data.
  const alternativa=/\b([\p{L}-]{4,})\s+ou\s+([\p{L}-]{4,})\b/u.exec(texto(j.objetivo));
  if(alternativa){
    const apoio=alternativa.slice(1).map(v=>fs.find(f=>intersecao(termos(v),termos(f.trecho))>0));
    if(apoio.every(Boolean))return alternativa.slice(1).map((v,i)=>({id:'pergunta_'+(i+1),
      entrada:'Situação fictícia para revisar: '+texto(j.objetivo).replace(alternativa[0],v),
      saidaEsperada:apoio[i].trecho,origemResposta:'trecho_publicado',fonteId:apoio[i].fonteId}));
  }
  const condicao=/^(?:Se|Quando)\s+([^,;.!?]{10,180})[,;]/iu.exec(fs[0].trecho);
  if(condicao)return[
    {id:'pergunta_1',entrada:'Situação fictícia: '+condicao[1]+'.',saidaEsperada:fs[0].trecho,origemResposta:'trecho_publicado',fonteId:fs[0].fonteId},
    {id:'pergunta_2',entrada:'Ainda não sabemos se '+condicao[1]+'.',saidaEsperada:'Confirmar se essa condição ocorre no uso pretendido antes de atribuir a ela o comportamento descrito.',origemResposta:'a_confirmar',fonteId:fs[0].fonteId},
  ];
  return[
    {id:'pergunta_1',entrada:pergunta(fs[0],nome),saidaEsperada:fs[0].trecho,origemResposta:'trecho_publicado',fonteId:fs[0].fonteId},
    fs[1]?{id:'pergunta_2',entrada:pergunta(fs[1],nome),saidaEsperada:fs[1].trecho,origemResposta:'trecho_publicado',fonteId:fs[1].fonteId}:
      {id:'pergunta_2',entrada:'Quem solicita, executa e recebe nesta oferta, segundo o perfil?',saidaEsperada:partes,origemResposta:'declaracao_usuario',fonteId:null},
  ];
}
/** A filled editorial draft, not a claim that the current page has a defect. */
export function prepararEntregavelOferta(tarefa,{oferta,fontes,interacoes=[],contextos=[],ofertas=[]}){
  if(tarefa.tipo==='confirmar_jornada'||!tarefa.decisao)return tarefa;
  const fs=fontesParaRascunho(tarefa,oferta,fontes);
  if(!fs.length)return tarefa;
  const contexto=contextoDaPublicacao(fs[0],contextos),qualificador=contexto&&!fs.some(f=>chave(f)===chave(contexto))?{...contexto,fonteId:idFonte(contexto)}:null;
  const vinculos=fs.map(f=>conferirVinculoResposta(f,oferta,ofertas));
  const j=oferta.jornada||{},numericos=vinculos[0].sustentado&&tarefa.decisao.modalidade==='limite_publicado'&&
    lista(tarefa.decisao.casos).length===2&&tarefa.decisao.casos.every(c=>Number.isSafeInteger(c.entrada));
  const controle=proximoPasso(interacoes,fs[0]),cta=vinculos[0].sustentado&&controle&&(!ofertas.length||ofertas.length===1||conferirVinculoResposta({...fs[0],trecho:controle.rotulo,secao:null},oferta,ofertas).sustentado)?controle:null,
    partes='Solicita/avalia: '+texto(j.comprador)+'. Execução declarada da oferta: '+texto(j.executor)+'. Usa/recebe: '+texto(j.beneficiario)+'.';
  let perguntas=numericos?tarefa.decisao.casos.map((c,i)=>({
    id:'caso_'+(i+1),entrada:c.entrada+' '+c.unidade,
    saidaEsperada:c.esperado,origemResposta:'limite_extraido_com_escopo_pendente',fonteId:fs[0].fonteId,
  })):entradasPublicadas(j,fs,oferta.nome,partes);
  perguntas=perguntas.map(q=>{
    const i=fs.findIndex(f=>f.fonteId===q.fonteId);
    if(i<0||vinculos[i].sustentado||q.origemResposta==='a_confirmar')return q;
    return{...q,entrada:'Confirmar se o trecho publicado se aplica a “'+oferta.nome+'” antes de responder sobre esse objeto.',
      saidaEsperada:null,origemResposta:'a_confirmar',vinculoResposta:vinculos[i]};
  });
  if(perguntas[1].entrada===perguntas[0].entrada)perguntas[1]={...perguntas[1],entrada:'Que informação complementar é publicada para “'+tema(fs[1]||fs[0],oferta.nome)+'”?'};
  const campos=[
    campo('Título do quadro para comparar com a página','Antes de avançar com '+oferta.nome,'a_confirmar'),
    campo('Objetivo registrado para a oferta',texto(j.objetivo)||null,'declaracao_usuario'),
    campo('Partes da oferta, declaradas no perfil (não atribuir a toda subetapa)',partes,'declaracao_usuario'),
  ];
  for(const q of perguntas){
    campos.push(campo('Entrada de teste: '+q.entrada,q.entrada,'a_confirmar'));
    const f=fs.find(f=>f.fonteId===q.fonteId);
    campos.push(campo(q.origemResposta==='a_confirmar'?'Resposta para esta entrada (a confirmar)':'Resposta/base já preenchida para essa entrada',q.saidaEsperada,
      ['declaracao_usuario','trecho_publicado'].includes(q.origemResposta)?q.origemResposta:'a_confirmar',f||null));
    if(q.vinculoResposta&&!q.vinculoResposta.sustentado)campos.push(campo('Trecho preservado; alcance da resposta a confirmar',f.trecho,'trecho_publicado',f));
  }
  if(numericos)campos.push(campo('Limite publicado a preservar integralmente',fs[0].trecho,'trecho_publicado',fs[0]));
  if(qualificador)campos.push(campo('Contexto de escopo publicado a manter junto da resposta',qualificador.trecho,'trecho_publicado',qualificador));
  campos.push(campo(cta?'Controle observado, candidato ao próximo passo na mesma página':'Próximo passo ainda não sustentado neste recorte',
    cta?'Rótulo “'+cta.rotulo+'” em '+cta.url+'. A ação não foi executada.':null,
    cta?'trecho_publicado':'a_confirmar',cta?{...cta,tipo:'interface_publica',natureza:'rotulo_literal'}:null));
  campos.push(campo('O que o responsável ainda precisa confirmar','Vínculo dos trechos com o uso pretendido, condições adicionais, vigência e função do próximo passo.','a_confirmar'));
  const tema1=tema(fs[0],oferta.nome),tema2=fs[1]?tema(fs[1],oferta.nome):'responsabilidades da oferta';
  const atual=cta?'e o papel do controle “'+cta.rotulo+'”':'e mantenha o próximo passo como pendência se ele não estiver sustentado';
  const mecanismo=(vinculos.some(v=>!v.sustentado)?'O rascunho preserva publicações e separa as respostas cujo alcance ainda precisa ser esclarecido sobre ':'O rascunho reúne respostas sobre ')+tema1+' e '+tema2+' para testar o objetivo registrado sem exigir que o visitante reconstrua a decisão a partir de trechos dispersos. Isso é hipótese editorial, não constatação de falta no site.';
  return{...tarefa,
    titulo:(vinculos.some(v=>!v.sustentado)?'Confirmar o alcance dos trechos para a decisão':numericos?'Preparar o quadro dos limites publicados':'Preparar o bloco de decisão com respostas publicadas')+' — '+oferta.nome,
    acao:'Compare a página '+fs[0].url+' com o rascunho já preenchido abaixo sobre '+tema1+' e '+tema2+'. '+mecanismo,
    evidencias:[...fs,...(qualificador?[qualificador]:[]),...(cta?[{...cta,tipo:'interface_publica',natureza:'rotulo_literal'}]:[])],evidenciasNegocio:[...fs,...(qualificador?[qualificador]:[])],
    entregavel:'Rascunho preenchido de um bloco de decisão para '+fs[0].url+', com duas entradas de teste, respostas/base associadas às fontes, partes declaradas e próximo passo publicado ou explicitamente desconhecido.',
    modeloEntregavel:{versao:1,natureza:'hipotese_editorial',tipo:'rascunho_com_fontes',campos,
      limite:'Compare com o conteúdo atual. Só adote uma alteração após revisar escopo e observar uma dúvida; informação já clara deve ser preservada. O rascunho não certifica oferta, funcionamento ou resultado.'},
    passos:['Responsável: quem edita o conteúdo com quem conhece a oferta. Confira as fontes que já preencheram o rascunho; preserve limites, exceções e o alcance de cada publicação.',
      'Entrada1 do teste: '+perguntas[0].entrada+'. Na página atual e no rascunho, procure a resposta/base já preenchida e a referência correspondente.',
      'Entrada2 do teste: '+perguntas[1].entrada+'. Distinga publicação e declaração do perfil '+atual+'. Não envie formulário, contratação ou dados reais.',
      'Registre qual pergunta gerou dúvida e o trecho/controle responsável. Se a dúvida for observada, valide uma edição localizada usando o rascunho; se a página atual já atender às duas entradas, preserve-a e registre sem alteração.'],
    criterioSucesso:'Para as duas entradas já definidas, o registro aponta resposta/base, fonte ou declaração, responsabilidade da oferta e próximo passo sustentado ou desconhecido. Compare página atual e rascunho; eventual edição só ocorre se a dúvida tiver sido observada. '+(numericos?'Nenhum ganho de ranking, vendas ou elegibilidade total é inferido.':'A descrição não é promovida a obrigação, requisito ou prova de adequação; não se infere resultado comercial.'),
    decisaoCliente:{objeto:oferta.nome,objetivo:texto(j.objetivo),escolha:'Comparar o bloco atual com o rascunho preenchido para responder às duas entradas e esclarecer o próximo passo.',
      fatos:[...fs,...(qualificador?[qualificador]:[])].map(f=>({descricao:f.trecho,evidencias:[f]})),percurso:perguntas.map(q=>q.entrada),
      restricoes:['O texto é uma proposta para comparar, não um defeito diagnosticado.','Partes do perfil não são atribuídas automaticamente a cada subetapa descrita.'],
      incertezas:cta?['Função real do controle e adequação do rascunho ainda precisam de observação.']:['O próximo passo não foi sustentado neste recorte; confirmar com o responsável antes de publicar.'],
      resultadoAConferir:'Se as duas entradas podem ser respondidas sem trocar atores, ampliar condições ou inventar informação.'},
    decisao:{...tarefa.decisao,casos:numericos?tarefa.decisao.casos:perguntas.map(q=>({entrada:q.entrada,esperado:q.saidaEsperada,fonteId:q.fonteId,origemResposta:q.origemResposta})),
      entrega:{versao:1,natureza:'hipotese_editorial',perguntas,vinculos:fs.map((f,i)=>({fonteId:f.fonteId,...vinculos[i]})),fontes:[...fs,...(qualificador?[qualificador]:[])].map(f=>f.fonteId),proximoPassoObservado:cta?{rotulo:cta.rotulo,url:cta.url,sha256:cta.sha256,modo:'nao_executado'}:null}},
  };
}
