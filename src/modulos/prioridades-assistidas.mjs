import {createHash} from 'node:crypto';
import {classificarDocumentoPublico,textoPadraoDeConsentimento} from './documentos-publicos.mjs';
import {normalizarSite} from '../consulta.mjs';
import {extrairCondicoesEstruturadas} from './condicoes-estruturadas.mjs';
import {ordenarFontesDoObjetivo,prepararEntregavelOferta,conferirVinculoResposta,materialAuxiliarSemObjetivo} from './entregaveis-prioridades.mjs';
import {prepararDecisaoPublicada} from './decisoes-publicadas.mjs';
import {extrairCondicoesPorAtividade} from './condicoes-atividade.mjs';
import {classificarOrigemPublicada} from './atribuicao-publica.mjs';
import {compararCobrancasNoTrecho} from './condicoes-comerciais.mjs';
import {compararLimitesDeModalidades} from './comparar-modalidades.mjs';
import {lerPrazosPublicados} from './prazos-publicados.mjs';
import {limiteDeOrcamentos} from './mediacao-publicada.mjs';

const lista=v=>Array.isArray(v)?v:[];
const texto=v=>typeof v==='string'?v.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/gu,' ').trim():'';
const normal=v=>texto(v).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24);
function corpo(f){
  if(f.campo==='jsonld.FAQPage.mainEntity.acceptedAnswer.text')return f.natureza==='resposta_estruturada_publicada'&&Boolean(texto(f.pergunta));
  if(!/^(?:p|li|dd|bloco\.titulo-conteudo|jsonld\.(?:Service|Product|Organization)\.description)$/u.test(f.campo))return false;
  if(f.campo!=='bloco.titulo-conteudo')return true;
  // A complete title+content DOM block is body evidence; a title alone is not.
  let resto=normal(f.trecho);
  for(const h of texto(f.secao).split(' / ')){const n=normal(h);if(n&&resto.startsWith(n))resto=resto.slice(n.length).trim();}
  return Boolean(f.secao)&&resto.length>=25;
}
const META=/^(?:title|meta\.|h[1-6]$|jsonld\.[^.]+\.name$)/u;
const GENERICAS=new Set(['qualificar_pedido','conferir_oferta']);
const SUPORTE=/\b(?:suporte|atendimento|consultores|support|help\s*desk)\b/u;
const CONDICAO=/\b(?:exige|exigem|requer|requerem|necess[aá]ri[oa]|precisa|precisam|somente|apenas|at[eé]|no\s+m[aá]ximo|limite|depende|desde\s+que|se\s+.+\s+ent[aã]o|de\s+\d+\s+a\s+\d+|obrigat[oó]ri[oa])\b/iu;
const OPERACAO=/\b(?:acesse|busque|escolha|preencha|finalize|clique|selecione|configura\w*|organiza(?:m|mos|r|ndo)?|centraliza(?:m|mos|r|ndo)?|mant[eé]m|permite(?:m)?|re[uú]ne|seleciona(?:m|mos|r|ndo)?|disponibiliza(?:m|mos|r|ndo)?|compartilha(?:m|mos|r|ndo)?|sincroniza(?:m|mos|r|ndo)?|executa\w*|conecta\w*|envia\w*|recebe\w*|registra\w*|guarda\w*|distribui\w*|direciona\w*|encaminha\w*|armazena\w*|define\w*|emite\w*|emiss[aã]o|gera\w*|integra\w*|realiza\w*|desenha\w*|processa\w*|liquida\w*|cadastra\w*|agenda\w*|participa\w*|oferec\w*|atua\w*|transport\w*|entreg\w*|exped\w*|migra\w*|hosped\w*|requires?|configure\w*)\b/iu;
function etapaComercial(f,o){
  const fluxo=/\b(?:fale\s+com|falar\s+com|formulario(?:\s+de)?\s+contato|solicite\s+(?:contato|demonstracao))\b/u.test(normal(f.secao))||
    /\b(?:entrarao|entraremos|entrar|retornaremos|retornara|responderemos)\b.{0,70}\b(?:contato|dia|hora)\b|\b(?:proposta aceita|novos clientes|oferta promocional)\b/u.test(normal(f.trecho));
  const retorno=/\b(?:contato|retorno|resposta)\b.{0,70}\b(?:prazo|dias?|horas?|uteis)\b/u.test(normal(f.trecho));
  return fluxo||retorno&&!(o&&suporteVinculadoAEscolha(f,o));
}

function urlPropria(v,d){
  try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&!/[?#\\\s]/u.test(v)&&normalizarSite(u.href)===d?u.href:null;}catch{return null;}
}
function publico(f,dominio){
  const c=f?.contexto||{},url=urlPropria(f?.url||c.url,dominio),trecho=texto(f?.trecho||f?.texto),
    campo=texto(f?.campo||c.campo),hash=f?.sha256||c.sha256,data=f?.coletadoEm||c.coletadoEm;
  if(!url||!trecho||trecho.length>6000||!/^[a-f0-9]{64}$/.test(hash||'')||typeof data!=='string'||!Number.isFinite(Date.parse(data)))return null;
  const documento=classificarDocumentoPublico({url,tituloPagina:c.tituloPagina||f?.tituloPagina,classePagina:c.classePagina||f?.classePagina});
  return{url,trecho,campo,sha256:hash,coletadoEm:data,recortado:typeof f?.recortado==='boolean'?f.recortado:c.recortado,
    secao:texto(f?.secao||lista(c.titulos).map(h=>h.texto).join(' / '))||null,
    titulos:structuredClone(lista(c.titulos??f?.titulos)),
    tituloPagina:texto(c.tituloPagina||f?.tituloPagina)||null,classePagina:documento.classe,classificacaoDocumento:documento,
    tipo:f?.tipo==='interface'||f?.tipo==='interface_publica'?'interface_publica':'negocio_publicado',
    natureza:f?.tipo==='interface'||f?.tipo==='interface_publica'?'rotulo_literal':f?.natureza==='resposta_estruturada_publicada'?'resposta_estruturada_publicada':'trecho_literal',
    ...(f?.natureza==='resposta_estruturada_publicada'?{pergunta:texto(f.pergunta),visibilidade:'nao_verificada',origemEstruturada:structuredClone(f.origemEstruturada)}:{})};
}
function chaveTrecho(f){return JSON.stringify([f.url,f.campo,f.trecho,f.sha256]);}
function chaveFonte(f){return f.natureza==='resposta_estruturada_publicada'?JSON.stringify([chaveTrecho(f),f.pergunta,f.origemEstruturada?.respostaPointer||null]):chaveTrecho(f);}
function fontesPublicas(p){
  const todos=[...lista(p.evidenciasNegocio?.base?.fontes),...lista(p.contextoPublico?.evidencias),...lista(p.contextoPublico?.detalhesPublicados),
    ...lista(p.contextoPublico?.perguntasPublicadas),
    ...lista(p.perfil?.ofertas).flatMap(o=>lista(o.evidencias)),...lista(p.oportunidades?.planoDeAcao).flatMap(t=>[...lista(t.evidenciasNegocio),...lista(t.evidencias)])];
  const mapa=new Map(),recortes=new Set(),respostas=new Set();
  for(const item of todos){
    const f=publico(item,p.dominio);if(!f)continue;
    const base=chaveTrecho(f),faq=f.natureza==='resposta_estruturada_publicada',k=chaveFonte(f),ant=mapa.get(k);
    if(f.recortado===true)recortes.add(base);
    if(faq)respostas.add(base);
    // A definite crop marker is never erased by a duplicate with missing metadata.
    if(!ant||ant.recortado===undefined&&f.recortado!==undefined)mapa.set(k,f);
    if(f.recortado===true||ant?.recortado===true)mapa.set(k,{...(ant||f),recortado:true});
  }
  // The neural source pool may contain the same answer without FAQ metadata.
  // Prefer the contextual response, retain distinct questions/pointers and
  // propagate any crop flag before removing that less informative duplicate.
  return [...mapa.values()].filter(f=>f.natureza==='resposta_estruturada_publicada'||!respostas.has(chaveTrecho(f)))
    .map(f=>recortes.has(chaveTrecho(f))?{...f,recortado:true}:f);
}
const inteira=f=>f.recortado===false&&f.tipo!=='interface_publica'&&!['editorial','politica'].includes(f.classePagina)&&!textoPadraoDeConsentimento(f.trecho);
function fontesInteirasDaPagina(colecao,p,url,agora){
  if(!url)return [];
  return lista(colecao).map(f=>publico(f,p.dominio)).filter(f=>f&&f.url===url&&Date.parse(f.coletadoEm)<=agora()&&
    inteira(f)&&corpo(f)&&classificarOrigemPublicada(f).estado==='nao_determinada');
}
const COMUNS=new Set(['para','pela','pelo','sobre','como','todo','toda','todos','todas','mais','seus','suas','voce','nosso','nossa','nossos','nossas','sistema','sistemas','plataforma','software','servico','servicos','produto','produtos','solucao','solucoes','empresa','empresas','equipe','equipes','gestao','plano','planos','online','integrado','integrada','precisa','precisam','usar','utilizar','rotina','rotinas','atendimento','suporte']);
const termos=v=>[...new Set(normal(v).match(/[a-z0-9]{3,}/g)||[])].filter(x=>!COMUNS.has(x)&&!/^\d+$/.test(x));
function apoioVinculo(f,o){
  const nome=normal(o.nome),contexto=normal(f.secao);
  if(nome.length>=5&&normal(f.trecho+' '+contexto).includes(nome))return {tipo:'nome_publicado',escopoConfirmado:false};
  const encontrados=termos(o.nome).filter(x=>new RegExp('\\b'+x+'\\b','u').test(contexto));
  if(encontrados.length)return {tipo:'termo_da_oferta_no_contexto',termos:encontrados,escopoConfirmado:false};
  const rotina=termos(o.jornada?.objetivo).filter(x=>new RegExp('\\b'+x+'\\b','u').test(normal(f.secao)));
  if(rotina.length>=2)return {tipo:'rotina_declarada_no_contexto',termos:rotina,escopoConfirmado:false};
  const naPublicacao=termos(o.nome).filter(x=>termos(f.trecho).some(t=>t===x||t===x+'s'||t+'s'===x||t===x+'ista'||t===x+'istas'));
  if(naPublicacao.length>=2)return {tipo:'termos_da_oferta_na_publicacao',termos:naPublicacao,escopoConfirmado:false};
  const rotinaPublicada=termos(o.jornada?.objetivo).filter(x=>termos(f.trecho).includes(x));
  return naPublicacao.length>=1&&rotinaPublicada.length>=2?{tipo:'rotina_declarada_na_publicacao',termos:rotinaPublicada,escopoConfirmado:false}:null;
}
function daOferta(fs,o,url,p){
  const compartilhada=lista(p.perfil?.ofertas).filter(x=>urlPropria(x.url,p.dominio)===url).length>1;
  return fs.filter(f=>f.url===url&&(!compartilhada||META.test(f.campo)||apoioVinculo(f,o)));
}
function semTextoVisivel(p,url){
  return lista(p.contextoPublico?.cobertura?.paginas).some(x=>x.url===url&&x.htmlInicial===true&&x.caracteresTextoVisivel===0);
}
function ehSuporte(f){return SUPORTE.test(normal(f.secao))||SUPORTE.test(normal(f.trecho));}
function suporteVinculadoAEscolha(f,o){
  const objetivo=normal(o.jornada?.objetivo);
  // Support is a possible legitimate requirement, but "all plans include support"
  // does not establish plan selection. Require both an explicit need and a named plan.
  return SUPORTE.test(objetivo)&&/\bplano\s+(?!todos\b|qualquer\b|atual\b|da\b|de\b|e\b)[a-z0-9][\w-]+/u.test(normal(f.secao+' '+f.trecho))
    &&!/\b(?:todos|qualquer)\s+(?:os\s+)?planos?\b/u.test(normal(f.trecho));
}
function condicoesElegiveis(fs,o,diagnostico){
  return fs.filter(f=>{
    if(!corpo(f)||!CONDICAO.test(normal(f.trecho)))return false;
    let motivo=null;
    if(!inteira(f))motivo=f.recortado===true?'condicao_recortada':f.recortado===undefined?'integridade_nao_informada':'tipo_de_fonte_nao_operacional';
    else if(etapaComercial(f,o))motivo='etapa_comercial_nao_e_requisito_de_uso';
    else if(ehSuporte(f)&&!suporteVinculadoAEscolha(f,o))motivo='suporte_sem_vinculo_com_escolha';
    else if(!apoioVinculo(f,o))motivo='condicao_sem_apoio_de_vinculo';
    if(motivo){diagnostico.push({ofertaId:o.id,motivo,url:f.url,campo:f.campo,sha256:f.sha256});return false;}
    return true;
  });
}
function faltantes(j){return [['comprador','quem solicita ou avalia'],['executor','quem executa cada rotina'],['beneficiario','quem usa ou recebe'],['objetivo','o objetivo a avaliar nesta oferta']].filter(([k])=>!texto(j?.[k])).map(([,r])=>r);}
function baseTarefa(p,o,url,familia,extra={}){
  return{id:'decisao_'+sha([p.dominio,o.id,url,familia]),tipo:'conferir_oferta',eixo:'negocio',base:'hipotese',prioridade:'investigar',
    ofertasAfetadas:[{id:o.id,nome:o.nome}],paginaAlvo:url?{url,origem:'declarada',fonte:'perfil'}:null,
    evidencias:[],responsavelSugerido:'Responsável pelo negócio para validar escopo; revisor da página para executar a conferência.',
    dependencias:[{tipo:'escopo_a_confirmar',estado:'pendente',descricao:'Confirmar o vínculo entre a declaração publicada, a oferta e o uso pretendido.'}],
    centralidade:o.centralidade||{nivel:'indefinida'},
    limite:'Conferência proposta com base na leitura e em declarações. Não seleciona investimento, garante elegibilidade ou afirma defeito/resultado financeiro.',
    ...extra};
}
function mediacaoDaOferta(p,o,fs){
  const entendimento=p.perfil?.entendimento;
  if(entendimento?.natureza==='declaracao_usuario'&&!['intermediacao','misto'].includes(entendimento.papel))return null;
  const nome=normal(o.nome);
  for(const r of lista(entendimento?.relacoes)){
    if(r.tipo!=='representacao_na_transacao'||r.recortado!==false||!texto(r.texto)||
      !lista(r.objetos).some(objeto=>normal(objeto)===nome))continue;
    const chaves=new Set(lista(r.evidencias).map(chaveTrecho));
    const f=fs.find(fonte=>fonte.recortado===false&&fonte.tipo!=='interface_publica'&&
      fonte.classePagina!=='editorial'&&chaves.has(chaveTrecho(fonte))&&fonte.trecho.includes(r.texto));
    if(f)return {r,f};
  }
  return null;
}
function tarefaOrcamentos(p,o,url,fs){
  const r=lista(p.perfil?.entendimento?.relacoes).find(x=>x.tipo==='conexao_entre_partes'&&
    x.forma==='comparacao_de_orcamentos'&&x.recortado===false&&lista(x.evidencias).length===2);
  if(!r||!url||!/\borcamentos\b/u.test(normal(o.nome)))return null;
  if(p.perfil.entendimento.natureza==='declaracao_usuario'&&!['intermediacao','misto'].includes(p.perfil.entendimento.papel))return null;
  const evidencias=r.evidencias.map(e=>fs.find(f=>f.url===url&&inteira(f)&&chaveTrecho(f)===chaveTrecho(e)));
  if(evidencias.some(f=>!f)||evidencias[0].sha256!==evidencias[1].sha256)return null;
  const limite=fs.find(f=>f.url===url&&f.sha256===evidencias[0].sha256&&inteira(f)&&corpo(f)&&
    limiteDeOrcamentos.test(f.trecho));
  return baseTarefa(p,o,url,'conferir_jornada_de_orcamentos',{
    tipo:'confirmar_jornada',eixo:'qualificacao',titulo:'Conferir o percurso dos orçamentos — '+o.nome,
    acao:'A página descreve o recebimento de solicitações e a comparação de orçamentos. Confira quem encaminha o pedido, quem prepara cada proposta e em que ponto começa a contratação do profissional.',
    evidencias:[...evidencias,...(limite?[limite]:[])],
    passos:[
      'Na página indicada, encontre a etapa em que o cliente solicita orçamentos. Registre o que o site pede antes de encaminhar o pedido.',
      'Compare a etapa de receber propostas com a contratação. Anote quem responde ao pedido e quando aparecem valores ou dispensas, recorrendo à publicação para cada resposta.',
      'Em uma simulação sem envio, confira se o cliente distingue a busca por profissionais da contratação. Registre dúvidas sobre quem realiza o serviço e recebe eventual pagamento.',
    ],
    criterioSucesso:'A ficha registra as partes e a evidência em cada etapa. Campos sem evidência ficam pendentes para esclarecimento com o responsável.',
    entregavel:'Percurso do pedido de orçamento com fontes e pendências sobre contratação e pagamento.',
    modeloEntregavel:{versao:1,tipo:'ficha_de_esclarecimento',natureza:'roteiro_de_revisao',campos:[
      {rotulo:'Recebimento do pedido',valorSugerido:r.texto,origem:'trecho_publicado',evidencia:evidencias[0]},
      {rotulo:'Comparação de orçamentos',valorSugerido:evidencias[1].trecho,origem:'trecho_publicado',evidencia:evidencias[1]},
      ...(limite?[{rotulo:'Limite na etapa de orçamento',valorSugerido:limite.trecho,origem:'trecho_publicado',evidencia:limite}]:[]),
      {rotulo:'Execução e pagamento',valorSugerido:'Confirme quem presta o serviço, quem paga e quem recebe após a escolha da proposta.',origem:'a_confirmar'},
    ]},
    decisao:{familia:'conferir_jornada_de_orcamentos',escopoConfirmado:false},
  });
}
function tarefaCobrancaIntermediada(p,o,url,fontes,ofertasNaPagina){
  if(!url||!/\b(?:pagamentos?|cobrancas?)\b/u.test(normal(o.nome)))return null;
  const e=p.perfil?.entendimento;
  if(e?.natureza==='declaracao_usuario'&&!['intermediacao','misto'].includes(e.papel))return null;
  const r=lista(e?.relacoes).find(x=>x.forma==='intermediacao_entre_partes'&&x.recortado===false&&
    lista(x.objetos).some(t=>normal(t)==='pagamentos'));
  if(!r?.texto)return null;
  const fonte=fontes.find(f=>f.url===url&&inteira(f)&&corpo(f)&&f.trecho.includes(r.texto)&&
    /\b(?:boleto|cobranca)\b[^.!?]{0,55}\b(?:pode aparecer|aparece)\s+o nome\b/u.test(normal(f.trecho))&&
    (ofertasNaPagina.length===1||conferirVinculoResposta(f,o,ofertasNaPagina).sustentado));
  if(!fonte)return null;
  return baseTarefa(p,o,url,'conferir_destinatario_da_cobranca',{
    tipo:'confirmar_jornada',eixo:'qualificacao',titulo:'Conferir quem recebe na cobrança — '+o.nome,
    acao:'A página explica que o nome exibido na cobrança pode ser o da empresa que intermedeia pagamentos. Confira onde o pagador identifica a empresa recebedora.',
    evidencias:[fonte],evidenciasNegocio:[fonte],
    passos:[
      'Na página indicada, localize a explicação sobre o nome que aparece no boleto ou na cobrança.',
      'Em uma demonstração com dados fictícios, registre onde aparecem o intermediário e o destinatário. Registre a etapa ou mantenha a identificação pendente se ela não for possível.',
      'Confira qual atendimento esclarece o destinatário e qual atendimento cabe ao fornecedor do produto ou serviço.',
    ],
    criterioSucesso:'O registro distingue intermediário, recebedor e atendimento com uma referência para cada papel ou a indicação de pendência.',
    entregavel:'Ficha de conferência do nome exibido e do destinatário com referência à etapa da cobrança.',
    modeloEntregavel:{versao:1,tipo:'ficha_de_esclarecimento',natureza:'roteiro_de_revisao',campos:[
      {rotulo:'Explicação publicada',valorSugerido:fonte.trecho,origem:'trecho_publicado',evidencia:fonte},
      {rotulo:'Identificação do destinatário',valorSugerido:'Registrar a etapa e o nome exibido com dados fictícios.',origem:'a_confirmar'},
    ]},
    decisao:{familia:'conferir_destinatario_da_cobranca',escopoConfirmado:false},
  });
}
function tarefaMediacaoPublicada(p,o,url,{r,f}){
  const ato=r.forma==='venda_em_nome_de_terceiro'?'a venda em nome de terceiros':'a disponibilização de itens de terceiros';
  const encontrar=url?'Abra a página da oferta ('+url+') e localize o caminho para fazer o pedido.':
    'Identifique a página que recebe o pedido de “'+o.nome+'” e registre a URL.';
  return baseTarefa(p,o,url,'conferir_representacao_publicada',{
    tipo:'confirmar_jornada',eixo:'qualificacao',titulo:'Conferir papéis antes do pedido — '+o.nome,
    acao:'A publicação descreve '+ato+' para “'+o.nome+'”. Confira o que a página do pedido explica sobre quem recebe o pedido, quem entrega e quem recebe o pagamento.',
    evidencias:[f],evidenciasNegocio:[f],
    passos:[encontrar,
      'Compare a página com a declaração publicada. Registre em que ponto aparecem o papel do site, a parte responsável pela entrega ou realização e o destinatário do pagamento.',
      'Antes de qualquer envio, pare na etapa em que a pessoa decide comprar. Registre uma informação que ela consegue identificar e qualquer papel ainda incompleto.'],
    criterioSucesso:'O registro inclui a página consultada, a etapa em que cada parte é identificada e os pontos que ainda precisam de confirmação.',
    entregavel:'Mapa de quem recebe o pedido, quem realiza ou entrega e quem recebe o pagamento, com referências e pendências por etapa.',
    modeloEntregavel:{versao:1,tipo:'ficha_de_esclarecimento',natureza:'roteiro_de_revisao',campos:[
      {rotulo:'Declaração sobre a transação',valorSugerido:r.texto,origem:'trecho_publicado',evidencia:f},
      {rotulo:'Primeira etapa do pedido',valorSugerido:url||'Página a identificar.',origem:url?'declaracao_usuario':'a_confirmar'},
      {rotulo:'Parte que recebe o pedido',valorSugerido:'Registrar a parte informada na página ou a pendência.',origem:'a_confirmar'},
      {rotulo:'Realização ou entrega',valorSugerido:'Indicar quem executa e a página onde isso foi observado.',origem:'a_confirmar'},
      {rotulo:'Destinatário do pagamento',valorSugerido:'Conferir a etapa em que o destinatário aparece.',origem:'a_confirmar'},
    ]},
    decisao:{familia:'conferir_representacao_publicada',escopoConfirmado:false,
      relacaoPublicada:{forma:r.forma,objeto:o.nome,frase:r.texto,fonte:f}},
  });
}
function confirmarJornada(p,o,url,fs,naPagina,agora){
  const faltam=faltantes(o.jornada),corpos=fs.filter(f=>inteira(f)&&corpo(f)&&apoioVinculo(f,o)),corposNaPagina=naPagina.filter(f=>inteira(f)&&corpo(f));
  const soMeta=semTextoVisivel(p,url);
  const ofertasNaPagina=lista(p.perfil?.ofertas).filter(a=>urlPropria(a.url,p.dominio)===url);
  const prazos = new Map();
  const fontesDePrazo = fontesInteirasDaPagina(p.contextoPublico?.fontesDePrazo,p,url,agora);
  if (url&&!soMeta) for (const f of [...corposNaPagina,...fontesDePrazo]) {
    if (f.natureza!=='trecho_literal'||ofertasNaPagina.length>1&&!conferirVinculoResposta(f,o,ofertasNaPagina).sustentado) continue;
    for (const prazo of lerPrazosPublicados(f.trecho)) {
      const chave=normal(prazo.frase);
      if (!prazos.has(chave)) prazos.set(chave,{...prazo,fonte:f});
    }
    if (prazos.size>=3) break;
  }
  const marcos = [...prazos.values()].slice(0,3);
  const evidencias=[...new Map([...marcos.map(m=>m.fonte),...fs
    .filter(f=>inteira(f)&&(META.test(f.campo)||corpo(f)))].map(f=>[chaveFonte(f),f])).values()].slice(0,3);
  const conferirMarcos=marcos.length?['Para cada prazo publicado, confira quem realiza a ação, qual evento ou condição serve de referência e a modalidade coberta. Faça a conferência com uma situação fictícia em que a condição foi atendida e outra em que ainda está pendente.']:[];
  const filtrarContextuais=fontes=>fontes.filter(f=>{
    const n=normal(f.trecho);
    return f.trecho.length>=50&&!materialAuxiliarSemObjetivo(f,o)&&
      !/^(?:qual|quais|por que)\b.{0,70}\bmelhor\w*\b/u.test(n)&&
      !(/\b(?:unico|lider|melhor|reconhecid[oa])\b/u.test(n)&&/\d+\s*%|\bconsumidores\b/u.test(n));
  });
  const vinculadas=filtrarContextuais(corpos),contextual=vinculadas.length?vinculadas:filtrarContextuais(corposNaPagina);
  const publicada=ordenarFontesDoObjetivo(o,contextual)[0]||null;
  const ponto=soMeta?'Conferir o conteúdo renderizado; o HTML inicial não forneceu texto visível.':
    faltam.length?'Esclarecer '+faltam.join('; ')+', mantendo as partes ainda desconhecidas como pendência.':
    !publicada?'Identificar uma publicação inteira que explique esta oferta; o recorte disponível ainda não sustentou uma fonte contextual para o esclarecimento.':
    !apoioVinculo(publicada,o)?'Esclarecer se a publicação abaixo descreve esta oferta e qual atividade ela sustenta; estar na mesma página não confirma esse vínculo.':
    'A descrição foi localizada, mas ainda não sustenta uma etapa operacional para esta decisão. Indicar uma atividade, quem a executa e a publicação que a descreve.';
  const atividades=extrairCondicoesPorAtividade({dominio:p.dominio,fontes:fs.filter(f=>inteira(f)&&corpo(f))}),parAtividades=atividades.comparacoes[0];
  const ficha=[
    {rotulo:'Oferta a esclarecer',valorSugerido:o.nome,origem:'declaracao_usuario'},
    {rotulo:'Objetivo registrado',valorSugerido:texto(o.jornada?.objetivo)||'Ainda não informado.',origem:texto(o.jornada?.objetivo)?'declaracao_usuario':'a_confirmar'},
    {rotulo:'Partes declaradas, ainda sem validação da publicação',valorSugerido:[['Solicita/avalia',o.jornada?.comprador],['Executa',o.jornada?.executor],['Usa/recebe',o.jornada?.beneficiario]].map(([k,v])=>k+': '+(texto(v)||'a esclarecer')).join('. '),origem:'declaracao_usuario'},
    ...(publicada?[{rotulo:'Publicação preservada para esclarecer o vínculo',valorSugerido:publicada.trecho,origem:'trecho_publicado',evidencia:structuredClone(publicada)}]:[]),
    ...(parAtividades?parAtividades.frases.map((frase,i)=>({rotulo:'Regra publicada para a atividade “'+parAtividades.atividades[i]+'”',valorSugerido:frase,origem:'trecho_publicado',evidencia:structuredClone(parAtividades.fonte)})):[]),
    ...marcos.map(m=>({rotulo:'Prazo e referência a conferir',valorSugerido:m.frase,origem:'trecho_publicado',evidencia:m.fonte})),
    {rotulo:'Ponto exato a esclarecer',valorSugerido:ponto,origem:'a_confirmar'},
    {rotulo:'Resposta ainda necessária',valorSugerido:parAtividades?'Confirmar se as atividades “'+parAtividades.atividades.join('” e “')+'” pertencem a esta oferta e modalidade, quais partes participam de cada uma e qual regra se aplica a cada percurso. A publicação separa as atividades; as partes e o alcance desta oferta continuam a esclarecer.':'Informar uma atividade desta oferta, quem a executa, para quem, quais condições se aplicam e qual publicação inteira a sustenta. Se faltar a fonte, registrar a lacuna sem completar por suposição.',origem:'a_confirmar'},
  ];
  const conferirPagina=url?'O revisor abre '+url+' no navegador e registra um trecho operacional inteiro, sua seção e a data, ou mantém o conteúdo como não observado.':'O responsável identifica a URL pública que explica a oferta; mantenha a página desconhecida até obter a referência.';
  const papel=p.perfil?.entendimento;
  if(papel?.papel==='intermediacao'&&papel.natureza==='declaracao_usuario'){
    const pagador=texto(o.jornada?.pagador);
    return baseTarefa(p,o,url,'esclarecer_intermediacao',{
      tipo:'confirmar_jornada',eixo:'qualificacao',titulo:'Conferir papéis e condições da intermediação — '+o.nome,
      acao:'Confira como a contratação desta oferta começa e quais etapas a empresa e os prestadores assumem. A intermediação declarada no perfil precisa ser ligada a esta oferta.',
      evidencias,camposAConfirmar:[...faltam,'quem encaminha o pedido','quem paga e quem recebe','a etapa de cada condição, quando publicada'],
      passos:[
        conferirPagina,
        'Identifique quem solicita, quem encaminha, quem executa e quem recebe. Confirme também quem paga e a quem. Registre a fonte ou a confirmação do responsável para cada papel.',
        'Vincule cada condição publicada de prazo, cobertura, pagamento ou cancelamento à etapa e à parte correspondente. Preserve exceções e registre o que ficou sem confirmação.',
        ...conferirMarcos,
        'Peça a alguém do público contratante para localizar o primeiro passo na página e explicar quem faz o quê. Registre a dúvida observada ou a resposta encontrada, sem enviar um pedido real.',
      ],
      criterioSucesso:'A ficha identifica as partes e as condições por etapa, com fonte para cada resposta ou indicação de pendência. O registro mostra se o contratante encontrou o primeiro passo e entendeu quem é responsável por ele.',
      entregavel:'Ficha de contratação com papéis, condições por etapa e resultado da conferência da página.',
      modeloEntregavel:{versao:1,tipo:'ficha_de_esclarecimento',natureza:'roteiro_de_revisao',campos:[
        ...ficha,
        {rotulo:'Quem paga',valorSugerido:pagador||'Ainda a esclarecer nesta oferta.',origem:pagador?'declaracao_usuario':'a_confirmar'},
        {rotulo:'Quem recebe e por qual etapa',valorSugerido:'Confirme o recebedor, a etapa e as condições declaradas para ela.',origem:'a_confirmar'},
      ]},
      decisao:{familia:'esclarecer_intermediacao',escopoConfirmado:false,somenteMetadados:soMeta,corposPreservadosNaPagina:corposNaPagina.length,corposVinculadosAOferta:corpos.length,...(marcos.length?{marcosPublicados:marcos}:{})},
    });
  }
  return baseTarefa(p,o,url,'esclarecer_jornada',{
    tipo:'confirmar_jornada',eixo:'qualificacao',titulo:(marcos.length?'Conferir prazos e seus marcos':'Confirmar uso e responsabilidades antes da avaliação')+' — '+o.nome,
    acao:soMeta?'O HTML inicial registrou zero texto visível nesta página. Confira o conteúdo renderizado e esclareça as responsabilidades antes de elaborar casos de contratação.':
      marcos.length?'Confira os pares publicados de prazo e marco. '+marcos.map(m=>'“'+m.prazo.texto+'” em relação a “'+m.marco.texto+'”').join('. ')+'. Confirme a ação, a parte responsável e a modalidade coberta.':
      faltam.length?'A leitura contém uma descrição, mas ainda faltam partes da jornada: '+faltam.join('; ')+'. Relacione a rotina publicada a quem solicita, executa e recebe antes de avaliar uma contratação.':
      corposNaPagina.length&&!corpos.length?'Há corpo publicado preservado nesta página, mas o filtro ainda não vinculou um trecho completo a esta oferta. Esclareça o vínculo entre publicação e jornada antes de elaborar casos de contratação.':
      'As partes foram declaradas no perfil, mas ainda não há uma etapa operacional inteira vinculada a esta decisão. Confirme qual condição ou rotina publicada deve orientar a avaliação, sem usar texto de suporte como condição de plano.',
    evidencias,camposAConfirmar:faltam,
    passos:[conferirPagina,
      'O responsável pelo negócio esclarece '+(faltam.length?faltam.join('; '):'quem solicita, executa e recebe em cada rotina')+'. Registre origem declarada e o que continua desconhecido; software não é automaticamente o prestador da rotina do usuário.',
      ...conferirMarcos,
      'Vincule uma rotina identificada ao trecho completo e ao responsável por executá-la. Se isso não for possível, registre a pendência e não prepare casos de contratação nem uma recomendação de plano.'],
    criterioSucesso:'Há um registro que distingue conteúdo renderizado observado, declaração do responsável e dados ainda desconhecidos; as partes ausentes são esclarecidas ou permanecem como pendência. Não é necessário fechar uma contratação para concluir a conferência.',
    entregavel:'Uma rotina com referência completa e partes esclarecidas, ou uma pendência de coleta/jornada explicitamente registrada.',
    modeloEntregavel:{versao:1,tipo:'ficha_de_esclarecimento',natureza:'roteiro_de_revisao',campos:ficha},
    decisao:{familia:'esclarecer_jornada',escopoConfirmado:false,somenteMetadados:soMeta,corposPreservadosNaPagina:corposNaPagina.length,corposVinculadosAOferta:corpos.length,...(marcos.length?{marcosPublicados:marcos}:{})},
  });
}
function capacidade(f,p,o){
  try{
    const r=extrairCondicoesEstruturadas({ofertaId:o.id,dominio:p.dominio,
      fontes:[{id:'condicao',texto:f.trecho,url:f.url,sha256:f.sha256,coletadoEm:f.coletadoEm}],
      escopo:{id:o.id,descricao:o.nome,confirmado:false}});
    return r.condicoes.length===1?r.condicoes[0]:null;
  }catch{return null;}
}
function tarefaCobrancas(p,o,url,f,comparacao){
  return baseTarefa(p,o,url,'conferir_cobrancas_por_etapa',{
    tipo:'conferir_cobrancas_por_etapa',eixo:'qualificacao',titulo:'Conferir cobranças por etapa — '+o.nome,
    acao:'Confira em que momento cada cobrança publicada se aplica. A leitura encontrou uma dispensa na etapa inicial e uma menção a cobrança na operação.',
    evidencias:[f],evidenciasNegocio:[f],
    paginaAlvo:{url,origem:'observada',fonte:'site',coletadoEm:f.coletadoEm},
    passos:[
      'Na página da oferta, localize o trecho de adesão, publicação ou configuração e confira qual cobrança aparece como dispensada.',
      'Confira a frase sobre a operação. Registre quando a cobrança é ativada, quem paga e quem recebe. Mantenha em aberto o que a fonte não informa.',
      'Simule a leitura da página em dois casos, um anterior à operação e outro com a operação descrita. Confira se o visitante consegue atribuir cada condição à etapa certa sem efetuar uma compra.',
    ],
    criterioSucesso:'A ficha liga cada cobrança ou dispensa à etapa, à condição, às partes e à mesma fonte. As respostas ausentes ficam registradas como pendências.',
    entregavel:'Ficha de conferência com as duas etapas, suas condições e o que precisa de confirmação.',
    modeloEntregavel:{versao:1,tipo:'ficha_de_esclarecimento',natureza:'roteiro_de_revisao',campos:[
      {rotulo:'Etapa inicial publicada',valorSugerido:comparacao.entrada.texto,origem:'trecho_publicado',evidencia:f},
      {rotulo:'Operação publicada',valorSugerido:comparacao.transacao.texto,origem:'trecho_publicado',evidencia:f},
      {rotulo:'Quem paga e quem recebe em cada etapa',valorSugerido:'Confirme os papéis e as opções aplicáveis a esta oferta.',origem:'a_confirmar'},
    ]},
    decisao:{familia:'conferir_cobrancas_por_etapa',escopoConfirmado:false,cobrancasPublicadas:comparacao},
  });
}
function grupoDePerguntas(f){
  const o=f.origemEstruturada;
  if(f.natureza!=='resposta_estruturada_publicada'||!o||!/^[a-f0-9]{64}$/u.test(o.jsonLdSha256||''))return null;
  const grupo=/^(.+|)\/mainEntity(?:\/\d+)?\/acceptedAnswer\/text$/u.exec(o.respostaPointer||'');
  return grupo?JSON.stringify([f.url,f.sha256,f.coletadoEm,o.scriptIndice,o.jsonLdSha256,grupo[1]]):null;
}
function fontesDeModalidades(fontes,o,ofertasNaPagina){
  const avaliadas=fontes.map(f=>({f,vinculo:conferirVinculoResposta(f,o,ofertasNaPagina),grupo:grupoDePerguntas(f)}));
  const gruposAncorados=new Set(avaliadas.filter(x=>x.grupo&&x.vinculo.motivo==='faq_nome_explicito_da_oferta').map(x=>x.grupo));
  return avaliadas.flatMap(({f,vinculo,grupo})=>{
    if(vinculo.sustentado)return [f];
    // A common collection permits a question about the link to the offer.
    // It does not certify the scope of another answer in the same collection.
    if(ofertasNaPagina.length===1&&vinculo.motivo==='faq_sem_nome_explicito_da_oferta'&&gruposAncorados.has(grupo))
      return [{...f,vinculoModalidade:'colecao_publicada_a_confirmar'}];
    return [];
  });
}
function tarefaModalidades(p,o,url,comparacao){
  const {unidade,modalidades,casos}=comparacao,nomes=modalidades.map(m=>m.modalidade).join(' e ');
  const medida=({usuarios:'usuários',usuarios_de_campo:'usuários de campo',paginas:'páginas',licencas:'licenças'})[unidade]||unidade;
  const medidaSingular=({usuarios:'usuário',usuarios_de_campo:'usuário de campo',paginas:'página',licencas:'licença'})[unidade]||medida;
  const resultado={
    'abaixo_do_minimo':'abaixo do mínimo publicado',
    'acima_do_maximo':'acima do máximo publicado',
    'dentro_dos_limites_publicados':'dentro dos limites que esta fonte informa',
  };
  const evidencia=[...new Map(modalidades.map(m=>[chaveFonte(m.fonte),m.fonte])).values()];
  const escopoEmAberto=evidencia.some(f=>f.vinculoModalidade);
  return baseTarefa(p,o,url,'conferir_limites_por_modalidade',{
    tipo:'conferir_oferta',eixo:'qualificacao',titulo:'Comparar limites por plano — '+o.nome,
    acao:'Confira os limites de '+medida+' publicados para '+nomes+'. '+(escopoEmAberto?
      'Confirme primeiro a qual oferta pertence cada trecho da página.':
      'Use os casos fictícios para registrar onde é preciso confirmar outras condições.'),
    evidencias:evidencia,evidenciasNegocio:evidencia,
    paginaAlvo:{url,origem:'observada',fonte:'site',coletadoEm:evidencia[0].coletadoEm},
    passos:[
      'Confira o nome de cada plano, seu limite e a unidade na publicação. Registre a data e as condições adicionais que aparecerem.',
      ...(escopoEmAberto?['Localize na página o trecho que liga cada plano à oferta antes de usar os limites para escolher.']:[]),
      ...casos.map(c=>'Compare '+c.quantidade+' '+(c.quantidade===1?medidaSingular:medida)+'. '+c.comparacao.map(x=>x.modalidade+' fica '+resultado[x.resultado]).join('. ')+'.'),
      'Registre quem confirma as condições em casos sem resposta, incluindo situações que excedem um máximo e ficam abaixo de outro mínimo.',
    ],
    criterioSucesso:'A ficha liga cada limite ao plano e à frase de origem. Para cada quantidade, mostra a condição publicada e o que falta verificar para uma escolha.',
    entregavel:'Comparação de capacidades por plano com fontes, casos fictícios e dúvidas encaminhadas.',
    modeloEntregavel:{versao:1,tipo:'ficha_de_esclarecimento',natureza:'roteiro_de_revisao',campos:[
      ...modalidades.map(m=>({rotulo:m.modalidade,valorSugerido:m.frase,origem:'trecho_publicado',evidencia:m.fonte})),
      {rotulo:'Quantidade de '+medida+' necessária',valorSugerido:'Informe a quantidade para o caso analisado.',origem:'a_confirmar'},
      {rotulo:'Condições que ainda precisam de confirmação',valorSugerido:'Confirme as restrições além da contagem antes de escolher um plano.',origem:'a_confirmar'},
    ]},
    decisao:{familia:'conferir_limites_por_modalidade',escopoConfirmado:false,revisarVinculoDaResposta:escopoEmAberto,
      limitesPorModalidade:comparacao},
  });
}
function tarefaCondicao(p,o,url,f){
  const c=capacidade(f,p,o),j=o.jornada;
  const casos=c&&c.maximo!==null&&c.maximo<Number.MAX_SAFE_INTEGER?[
    {entrada:c.maximo,unidade:c.unidade,esperado:'não ultrapassa o máximo explicitamente publicado; os outros requisitos e o escopo ainda precisam de revisão'},
    {entrada:c.maximo+1,unidade:c.unidade,esperado:'ultrapassa o máximo deste trecho; esclarecer outra condição/modalidade antes de escolher'}]:
    c&&c.minimo!==null&&c.minimo>0?[
      {entrada:c.minimo,unidade:c.unidade,esperado:'atinge o mínimo explicitamente publicado; os outros requisitos ainda precisam de revisão'},
      {entrada:c.minimo-1,unidade:c.unidade,esperado:'não atinge o mínimo deste trecho; esclarecer enquadramento antes de escolher'}]:[
      {entrada:'situação descrita pelo trecho completo',esperado:'localizar quais informações correspondem à descrição, sem presumir obrigação, adequação final ou resultado'},
      {entrada:'informação sobre a situação ainda não fornecida',esperado:'manter o ponto como desconhecido e indicar quem pode esclarecê-lo'}];
  const frase='“'+f.trecho+'”'+(f.secao?' (seção '+f.secao+')':'');
  return baseTarefa(p,o,url,'verificar_condicao_publicada',{
    titulo:(c?'Conferir o limite publicado de '+c.unidade:'Comparar a situação publicada')+' — '+o.nome,
    acao:'A página declara '+frase+'. Confira se '+texto(j.comprador)+' distingue a situação descrita da informação que ainda falta. '+(c?'O vínculo do limite à oferta precisa ser revisado antes de escolher plano ou contratar.':'Esse texto não estruturado é informação para comparação; não estabelece sozinho requisito de uso, obrigação de contratar ou adequação final.'),
    evidencias:[f],evidenciasNegocio:[f],paginaAlvo:{url,origem:'observada',fonte:'site',coletadoEm:f.coletadoEm},
    passos:['Responsável da revisão: quem conhece o escopo de '+o.nome+'. Leia o trecho inteiro, sua seção e a data; confirme a qual oferta e rotina a publicação se aplica.',
      'No registro local, use casoA: '+(typeof casos[0].entrada==='number'?casos[0].entrada+' '+casos[0].unidade:casos[0].entrada)+'. Resultado a conferir: '+casos[0].esperado+'.',
      'Compare com casoB: '+(typeof casos[1].entrada==='number'?casos[1].entrada+' '+casos[1].unidade:casos[1].entrada)+'. Resultado a conferir: '+casos[1].esperado+'.',
      'Registre o próximo passo e a parte responsável: '+texto(j.executor)+'. Não envie pedido real, ative integração, emita documento ou altere um plano durante esta conferência.'],
    criterioSucesso:c?'Os dois casos ficam ligados ao trecho e à mesma unidade; o registro identifica qual informação sustenta cada saída, o que ainda falta e quem deve esclarecer. Um caso que excede o limite não recebe elegibilidade presumida.':'O registro distingue informação descrita na publicação de dado desconhecido e aponta quem pode esclarecer a diferença. A descrição não é promovida a obrigação, requisito ou prova de adequação.',
    entregavel:c?'Dois casos especificados, suas saídas condicionais e a referência completa do limite, com escopo/vigência revisados ou pendentes.':'Registro da situação descrita e da informação desconhecida, com referência completa e alcance/vigência revisados ou pendentes.',
    decisao:{familia:'verificar_condicao_publicada',modalidade:c?'limite_publicado':'informacao_publicada',escopoConfirmado:false,apoioVinculo:apoioVinculo(f,o),casos,condicaoInteira:f,capacidadeExtraida:c},
  });
}
function tarefaRotina(p,o,url,f){
  return baseTarefa(p,o,url,'verificar_rotina_publicada',{
    titulo:'Conferir o encaminhamento da rotina publicada — '+o.nome,
    acao:'A página descreve “'+f.trecho+'”'+(f.secao?' na seção '+f.secao:'')+'. Confira qual informação '+texto(o.jornada.comprador)+' precisa fornecer para essa rotina, mantendo '+texto(o.jornada.executor)+' como responsável pela execução declarada.',
    evidencias:[f],evidenciasNegocio:[f],paginaAlvo:{url,origem:'observada',fonte:'site',coletadoEm:f.coletadoEm},
    passos:['O revisor identifica na declaração completa a entrada, a atividade e a saída. Registre como desconhecido o que o trecho não explica.',
      'Quem conhece o negócio compara esse registro com a rotina pretendida por '+texto(o.jornada.comprador)+'. Não transforme o fornecedor do software no executor de uma tarefa que pertence ao usuário.',
      'Na mesma URL, registre o próximo passo publicado ou o que precisa ser esclarecido com '+texto(o.jornada.executor)+'. Só proponha edição se uma dificuldade tiver sido observada.'],
    criterioSucesso:'A entrada, a atividade, a saída e o próximo passo são ligados ao trecho completo, ou ficam explicitamente desconhecidos. A responsabilidade declarada não muda por inferência; não se conclui funcionamento real ou resultado financeiro.',
    entregavel:'Registro de uma rotina publicada com partes, informação necessária e próximo passo, sem executar uma operação real.',
    decisao:{familia:'verificar_rotina_publicada',escopoConfirmado:false,apoioVinculo:apoioVinculo(f,o),rotinaInteira:f},
  });
}
function tarefaFAQ(p,o,url,f){
  const regras=extrairCondicoesPorAtividade({dominio:p.dominio,fontes:[f]}),par=regras.comparacoes[0];
  const condicional=/\b(?:necessari[oa]|precisa|requer|exige|somente|apenas|depende|desde que|obrigatori[oa])\b/u.test(normal(f.trecho)),
    casos=par?par.casosFicticios.map((c,i)=>({id:'atividade_'+(i+1),natureza:'hipotese_controlada',declaracao:'Conferir separadamente a atividade publicada “'+c.atividade+'”. '+c.verificar,atividadeLiteral:c.atividade,condicoesInteiras:f.trecho,adequacaoConfirmada:false})):condicional?[{id:'condicao_declarada',natureza:'hipotese_controlada',declaracao:'O solicitante afirma atender às condições publicadas.',condicoesInteiras:f.trecho,adequacaoConfirmada:false},
      {id:'condicao_desconhecida',natureza:'hipotese_controlada',declaracao:'O solicitante ainda não informou se atende às condições publicadas.',condicoesInteiras:f.trecho,adequacaoConfirmada:false}]:[];
  return baseTarefa(p,o,url,'conferir_resposta_existente',{
    tipo:'conferir_resposta_existente',titulo:(par?'Conferir requisitos por atividade — ':'Conferir a resposta já publicada — ')+o.nome,
    acao:'O HTML contém a pergunta “'+f.pergunta+'” e a resposta “'+f.trecho+'”. Confira se '+texto(o.jornada.comprador)+' consegue localizar essa resposta no percurso de '+texto(o.jornada.objetivo)+'. A presença em JSON-LD ainda não comprova exibição na página.',
    evidencias:[f],evidenciasNegocio:[f],paginaAlvo:{url,origem:'observada',fonte:'site',coletadoEm:f.coletadoEm},
    passos:['Abra '+url+' e procure a pergunta publicada: '+f.pergunta+'. Registre se a resposta está visível, se depende de expandir um controle e qual passo permite encontrá-la.',
      'Compare a resposta visível com o texto preservado: '+f.trecho+'. Mantenha cada condição e a parte que executa a atividade; a publicação não confirma a adequação a um pedido real.',
      ...(par?par.casosFicticios.map((c,i)=>'Caso fictício '+(i===0?'A':'B')+': conferir a atividade “'+c.atividade+'”. '+c.verificar+' Use dados fictícios e confirme o vínculo com a oferta antes de testar um percurso.'):condicional?['Caso fictício A: o solicitante afirma atender às condições dessa resposta. Registre quais condições precisaria comprovar e o passo publicado para continuar; a afirmação não confirma adequação.',
        'Caso fictício B: o solicitante não informou essas condições. Identifique exatamente o que falta perguntar e a quem esclarecer, usando a mesma resposta integral. Não conclua elegibilidade nem transfira uma dispensa de outra atividade.']:[]),
      'Registre resposta encontrada, diferença de conteúdo ou visibilidade ainda desconhecida. Preserve o conteúdo que já atende à pergunta; proponha uma edição somente depois de documentar a dificuldade observada.'],
    criterioSucesso:'Um registro liga a pergunta e a resposta existentes ao percurso observado, preserva condições e responsabilidades e identifica a dificuldade específica ou a ausência de dificuldade. Não é necessário criar outra página ou alterar o texto para concluir a conferência.',
    entregavel:par?'Registro dos dois percursos por atividade, com a resposta integral, as partes e modalidades confirmadas ou ainda pendentes, e a diferença de visibilidade observada.':'Conferência preenchida da resposta existente, sua localização no percurso e eventual diferença observada.',
    ...(par?{modeloEntregavel:{versao:1,tipo:'ficha_de_conferencia_por_atividade',natureza:'roteiro_de_revisao',campos:[
      ...par.frases.map((frase,i)=>({rotulo:'Regra publicada para “'+par.atividades[i]+'”',valorSugerido:frase,origem:'trecho_publicado',evidencia:structuredClone(f)})),
      {rotulo:'Partes, oferta e modalidades a confirmar',valorSugerido:'Confirmar o vínculo de cada atividade com a oferta; uma destinação exclusiva não prova, por si, obrigação. Preservar exceções e pontos desconhecidos.',origem:'a_confirmar'},
      {rotulo:'Visibilidade da resposta',valorSugerido:'Registrar onde a resposta foi encontrada ou manter como não observada.',origem:'a_confirmar'}]}}:{}),
    decisao:{familia:'conferir_resposta_existente',perguntaPublicada:f.pergunta,respostaInteira:f,visibilidadeConfirmada:false,edicaoNecessaria:null,escopoConfirmado:false,casosDeConferencia:casos,...(par?{comparacaoPorAtividade:par}:{} )},
  });
}
function respostaDeAtividadesDoObjetivo(p,o,corpos){
  const objetivo=termos(o.jornada?.objetivo),ofertas=lista(p.perfil?.ofertas);
  for(const f of corpos){
    if(f.natureza!=='resposta_estruturada_publicada')continue;
    const vinculo=conferirVinculoResposta(f,o,ofertas);
    if(!vinculo.sustentado&&vinculo.motivo!=='faq_sem_nome_explicito_da_oferta')continue;
    const par=extrairCondicoesPorAtividade({dominio:p.dominio,fontes:[f]}).comparacoes[0];
    if(!par)continue;
    // This selects a clarification, never a commercial conclusion. Both
    // published activities must occur in the declared objective; a shared
    // page, "account" or generic offer name alone cannot establish scope.
    const grupos=par.atividades.map(a=>termos(a).filter(x=>x.length>=4));
    const atividades=grupos.map((ts,i)=>ts.filter(t=>!grupos.some((outros,j)=>i!==j&&outros.some(x=>x.slice(0,4)===t.slice(0,4)))));
    if(!atividades.every(ts=>ts.some(t=>objetivo.some(x=>x===t||x.length>=4&&x.slice(0,4)===t.slice(0,4)))))continue;
    return{fonte:f,par,vinculo};
  }
  return null;
}
function esclarecerEscopoResposta(p,o,url,{fonte:f,par,vinculo}){
  return baseTarefa(p,o,url,'esclarecer_escopo_resposta',{
    tipo:'esclarecer_escopo_resposta',eixo:'qualificacao',titulo:'Esclarecer o alcance da resposta para “'+par.atividades.join('” e “')+'” — '+o.nome,
    acao:'A resposta à pergunta publicada “'+f.pergunta+'” distingue duas atividades do objetivo declarado. A resposta não nomeia esta oferta; confirme a quais ofertas, partes e modalidades ela se aplica antes de avaliar ou alterar o percurso.',
    evidencias:[f],evidenciasNegocio:[f],paginaAlvo:{url,origem:'observada',fonte:'site',coletadoEm:f.coletadoEm},
    passos:['Abra '+url+' e procure a pergunta “'+f.pergunta+'”. Registre se a resposta está visível; JSON-LD não confirma exibição.',
      ...par.frases.map((frase,i)=>'Leve ao responsável a regra da atividade “'+par.atividades[i]+'”: “'+frase+'”. Confirme se vale para esta oferta e modalidade; não transfira a regra entre atividades.'),
      'Registre a resposta do responsável como declaração, ou mantenha o vínculo desconhecido. Só depois de esclarecer o alcance prepare a conferência do percurso; não execute envio, assinatura ou contratação reais.'],
    modeloEntregavel:{versao:1,tipo:'ficha_de_escopo_da_resposta',natureza:'roteiro_de_esclarecimento',campos:[
      {rotulo:'Objetivo informado',valorSugerido:texto(o.jornada.objetivo),origem:'declaracao_usuario'},
      {rotulo:'Resposta integral publicada',valorSugerido:f.trecho,origem:'trecho_publicado',evidencia:structuredClone(f)},
      ...par.frases.map((frase,i)=>({rotulo:'Regra publicada para “'+par.atividades[i]+'”',valorSugerido:frase,origem:'trecho_publicado',evidencia:structuredClone(f)})),
      {rotulo:'Oferta, partes e modalidades ainda a confirmar',valorSugerido:'Confirmar o vínculo desta resposta com a oferta “'+o.nome+'”, quais partes realizam cada atividade e as exceções. Destinação exclusiva não prova obrigação.',origem:'a_confirmar'}]},
    decisao:{familia:'esclarecer_escopo_resposta',vinculoResposta:vinculo,respostaInteira:f,comparacaoPorAtividade:par,escopoConfirmado:false,visibilidadeConfirmada:false,edicaoNecessaria:null,recomendacaoComercial:false},
    criterioSucesso:'O registro distingue a resposta publicada do vínculo declarado ou ainda desconhecido com a oferta. Cada atividade mantém sua regra e os qualificadores; não se conclui elegibilidade ou defeito na página.',
    entregavel:'Ficha da resposta existente com duas regras, fonte integral e alcance declarado pelo responsável ou ainda pendente.',
  });
}
const alvo=t=>t.paginaAlvo?.url||null;
function grupo(t){return JSON.stringify([lista(t.ofertasAfetadas).map(o=>o.id).sort(),alvo(t)]);}
function repetidaSemDecisao(t){return GENERICAS.has(t.tipo);}
function contextoTecnico(t,p){
  if(t.eixo!=='tecnico')return t;
  const e=lista(t.evidencias).find(x=>x.tipo==='diagnostico'&&x.url===alvo(t)&&texto(x.trecho));
  if(!e)return t;
  const ofertas=lista(t.ofertasAfetadas).map(x=>lista(p.perfil?.ofertas).find(o=>o.id===x.id)).filter(Boolean),
    objetivos=ofertas.map(o=>texto(o.jornada?.objetivo)).filter(Boolean),
    objetivo=objetivos.length?objetivos.join('; '):'Conferir o uso da página; o objetivo da atividade ainda precisa de confirmação.',
    partes=ofertas.filter(o=>o.jornada?.natureza==='declaracao_usuario').map(o=>[o.jornada.comprador,o.jornada.executor,o.jornada.beneficiario].map(texto).filter(Boolean).join('; ')),
    ponto=texto(t.titulo).split(' — ')[0];
  const n={...t,
    acao:'O HTML inicial registrou “'+e.trecho+'”. Objetivo declarado para esta conferência: “'+objetivo+'”. Confira o achado na mesma URL; a declaração da jornada não comprova funcionamento ou causa de ranking.',
    passos:['Abra '+alvo(t)+' e localize o elemento relacionado a “'+ponto+'”. Preserve o achado literal e sua fonte; a contagem do HTML não prova que todos os elementos pertençam a esse percurso.',
      'Confira o ponto no objetivo declarado: '+objetivo+'. '+(partes.length?'Partes declaradas, sem trocar responsabilidades: '+partes.join(' | ')+'.':'Registre as partes como informações a confirmar.'),
      'Registre elemento, função no objetivo e diferença entre HTML inicial e experiência visível. Só proponha ajuste se a dificuldade for confirmada; repita a mesma verificação e preserve o que já estiver adequado. Não envie dados ou pedidos reais.'],
    criterioSucesso:'O registro identifica elemento, função e URL no objetivo declarado, distinguindo achado do HTML e uso visível. Eventual ajuste é reconferido com o mesmo método; nenhum ganho comercial ou de ranking é inferido.',
    comoValidar:'Compare a mesma URL e o mesmo achado com o objetivo declarado; registre o que foi observado e o que continua desconhecido.',
    entregavel:'Registro da conferência de “'+ponto+'” na jornada declarada, com achado e fonte preservados.',
    contextoDeclarado:{objetivo,partes,origem:'perfil_declarado',confirmacaoDeFuncionamento:false}};
  delete n.decisaoCliente;delete n.experimento;delete n.modeloEntregavel;
  return n;
}
export function refinarPlanoAssistido(projeto,planoAnterior,{agora=Date.now}={}){
  const p=structuredClone(projeto),confirmado=p.perfil?.estado==='confirmado',existentes=lista(planoAnterior?.tarefasDisponiveis||p.oportunidades?.planoDeAcao),
    fontesTodas=fontesPublicas(p).filter(f=>Date.parse(f.coletadoEm)<=agora()),
    pendenciasDeOrigem=fontesTodas.filter(f=>classificarOrigemPublicada(f).estado!=='nao_determinada').map(f=>({...f,atribuicao:classificarOrigemPublicada(f),recomendacaoComercial:false})),
    fs=fontesTodas.filter(f=>classificarOrigemPublicada(f).estado==='nao_determinada'),
    diagnostico=pendenciasDeOrigem.map(f=>({motivo:'relato_de_cliente_nao_comprova_atividade_propria',fonte:f})),pendenciasDeOferta=[],novas=[],grupos=new Set(),fracas=new Set();
  if(confirmado)for(const o of lista(p.perfil?.ofertas)){
    const url=urlPropria(o.url,p.dominio),naPagina=fs.filter(f=>f.url===url),fontes=daOferta(fs,o,url,p),corpos=fontes.filter(f=>inteira(f)&&corpo(f)),faltam=faltantes(o.jornada);
    const g=JSON.stringify([[o.id],url]);grupos.add(g);
    const ofertasNaPagina=lista(p.perfil?.ofertas).filter(x=>urlPropria(x.url,p.dominio)===url);
    const semVisivel=semTextoVisivel(p,url);
    if(url&&!semVisivel){
      const evidencia=corpos.map(f=>({f,comparacao:compararCobrancasNoTrecho(f.trecho)}))
        .find(x=>x.comparacao&&conferirVinculoResposta(x.f,o,ofertasNaPagina).sustentado);
      if(evidencia){novas.push(tarefaCobrancas(p,o,url,evidencia.f,evidencia.comparacao));continue;}
      const cartoes=ofertasNaPagina.length===1?fontesInteirasDaPagina(p.evidenciasNegocio?.cartoesDeModalidades,p,url,agora)
        .filter(f=>/\bplanos?\b/u.test(normal(f.tituloPagina)))
        .map(f=>({...f,vinculoModalidade:'pagina_de_planos_a_confirmar'})):[];
      const limites=compararLimitesDeModalidades({dominio:p.dominio,ofertaId:o.id,
        fontes:[...fontesDeModalidades(corpos,o,ofertasNaPagina),...cartoes]});
      if(limites){novas.push(tarefaModalidades(p,o,url,limites));continue;}
    }
    const mediacao=mediacaoDaOferta(p,o,fs);
    if(mediacao){novas.push(tarefaMediacaoPublicada(p,o,url,mediacao));continue;}
    const orcamentos=tarefaOrcamentos(p,o,url,fontes);
    if(orcamentos){novas.push(orcamentos);continue;}
    const fontesDeMediacao=fontesInteirasDaPagina(p.contextoPublico?.fontesDeMediacao,p,url,agora);
    const cobrancaIntermediada=tarefaCobrancaIntermediada(p,o,url,[...fontes,...fontesDeMediacao],ofertasNaPagina);
    if(cobrancaIntermediada){novas.push(cobrancaIntermediada);continue;}
    const cond=condicoesElegiveis(fontes,o,diagnostico);
    if(!url||!corpos.length||semVisivel||faltam.length){novas.push(confirmarJornada(p,o,url,fontes,naPagina,agora));fracas.add(g);continue;}
    const respostaAtividades=respostaDeAtividadesDoObjetivo(p,o,corpos);
    if(respostaAtividades){novas.push(respostaAtividades.vinculo.sustentado?tarefaFAQ(p,o,url,respostaAtividades.fonte):esclarecerEscopoResposta(p,o,url,respostaAtividades));continue;}
    // An operational feature may itself be customer support. Do not mistake
    // the offer's work for generic vendor support when ranking page facts.
    const auxiliares=corpos.filter(f=>materialAuxiliarSemObjetivo(f,o));
    for(const f of auxiliares)diagnostico.push({ofertaId:o.id,motivo:'material_auxiliar_nao_descreve_operacao_da_oferta',url:f.url,campo:f.campo,sha256:f.sha256});
    const rotinas=corpos.filter(f=>OPERACAO.test(normal(f.trecho))&&!etapaComercial(f,o)&&!materialAuxiliarSemObjetivo(f,o)&&apoioVinculo(f,o));
    const candidatas=[...new Map([...cond,...rotinas].map(f=>[chaveFonte(f),f])).values()],
      avaliadas=candidatas.map(f=>({fonte:f,vinculo:conferirVinculoResposta(f,o,ofertasNaPagina)})),
      sustentadas=avaliadas.filter(a=>a.vinculo.sustentado).map(a=>a.fonte),recusadas=avaliadas.filter(a=>!a.vinculo.sustentado);
    if(recusadas.length){
      const pendencia={ofertaId:o.id,ofertaNome:o.nome,url,estado:sustentadas.length?'vinculos_parciais':'sem_vinculo_sustentado',
        natureza:'pendencia_de_atribuicao',recomendacaoComercial:false,
        fontesRecusadas:recusadas.map(a=>({...a.fonte,vinculoResposta:a.vinculo})),
        motivo:'As publicações foram preservadas, mas seu vínculo a esta oferta foi recusado. A recusa não prova ausência do serviço; falta uma publicação sustentada para atribuir a resposta.'};
      pendenciasDeOferta.push(pendencia);
      diagnostico.push({ofertaId:o.id,motivo:'fontes_com_vinculo_recusado_preservadas',pendencia});
    }
    if(candidatas.length&&!sustentadas.length)continue;
    const ordenadas=ordenarFontesDoObjetivo(o,sustentadas),escolhida=ordenadas[0];
    if(escolhida?.natureza==='resposta_estruturada_publicada'){novas.push(tarefaFAQ(p,o,url,escolhida));continue;}
    const tarefa=escolhida?cond.includes(escolhida)?tarefaCondicao(p,o,url,escolhida):tarefaRotina(p,o,url,escolhida):confirmarJornada(p,o,url,fontes,naPagina,agora);
    const concreta=prepararDecisaoPublicada(tarefa,{oferta:o,ofertas:lista(p.perfil?.ofertas),fontes:fs,interacoes:p.contextoPublico?.interacoesPublicas,
      cobertura:p.contextoPublico?.cobertura,validarVinculo:conferirVinculoResposta,agora});
    novas.push(concreta||prepararEntregavelOferta(tarefa,{oferta:o,fontes:ordenadas,contextos:corpos,interacoes:p.contextoPublico?.interacoesPublicas,ofertas:lista(p.perfil?.ofertas).filter(x=>urlPropria(x.url,p.dominio)===url)}));
  }
  const preservadas=existentes.filter(t=>{
    const g=grupo(t);
    const todosAlvosCobertos=lista(t.ofertasAfetadas).length>0&&lista(t.ofertasAfetadas).every(o=>grupos.has(JSON.stringify([[o.id],alvo(t)])));
    if(repetidaSemDecisao(t)&&todosAlvosCobertos){
      diagnostico.push({tarefaId:t.id,motivo:'uma_acao_por_decisao_da_oferta',grupo:g});return false;
    }
    // A weak-HTML hypothesis is part of the content/journey clarification.
    // Real observed findings/publication checks remain separate.
    if(fracas.has(g)&&t.base==='hipotese'&&t.tipo==='corrigir_uso'){
      diagnostico.push({tarefaId:t.id,motivo:'conferencia_renderizada_incorporada_na_confirmacao',grupo:g});return false;
    }
    return true;
  }).map(t=>contextoTecnico(t,p));
  const todas=[...preservadas,...novas].filter(t=>{
    const vinculos=lista(t.decisao?.entrega?.vinculos);
    if(!vinculos.length||!vinculos.every(v=>v.sustentado===false))return true;
    diagnostico.push({tarefaId:t.id,motivo:'rascunho_sem_vinculo_sustentado_nao_priorizado',
      evidenciasPreservadas:structuredClone(lista(t.evidenciasNegocio)),vinculos:structuredClone(vinculos)});
    return false;
  }),porId=new Map(todas.map(t=>[t.id,t])),
    faixa=t=>t.eixo==='publicacao'&&t.base==='observacao'?0:t.base==='observacao'?1:t.decisao?2:3,
    importancia=t=>t.centralidade?.natureza==='declaracao_usuario'?({principal:0,indefinida:1,complementar:2}[t.centralidade.nivel]??1):1,
    apoio=t=>t.decisao?.decisaoPreparada?1:lista(t.decisao?.entrega?.vinculos).some(v=>v.sustentado===false)?2:['verificar_condicao_publicada','conferir_representacao_publicada','conferir_cobrancas_por_etapa','conferir_limites_por_modalidade'].includes(t.decisao?.familia)?0:t.decisao?.familia==='verificar_rotina_publicada'?1:t.tipo==='confirmar_jornada'?2:3;
  const ordenadas=[...porId.values()].sort((a,b)=>faixa(a)-faixa(b)||importancia(a)-importancia(b)||apoio(a)-apoio(b)||a.titulo.localeCompare(b.titulo,'pt-BR'));
  const prioridades=[],confirmacoesPorUrl=new Set(),tecnicasPorUrl=new Set(),comparacoesExibidas=new Set();
  for(const t of ordenadas){
    const comparacao=t.decisao?.decisaoPreparada?.comparacaoGrupo;
    if(comparacao){if(comparacoesExibidas.has(comparacao))continue;comparacoesExibidas.add(comparacao);}
    if(t.eixo==='tecnico'){
      const u=alvo(t)||'url_desconhecida';if(tecnicasPorUrl.has(u))continue;tecnicasPorUrl.add(u);
    }
    if(t.tipo==='confirmar_jornada'){
      const u=alvo(t)||'url_desconhecida';
      if(confirmacoesPorUrl.has(u))continue;
      confirmacoesPorUrl.add(u);
    }
    prioridades.push(t);if(prioridades.length===3)break;
  }
  return{...planoAnterior,versao:1,regrasVersao:9,planoCompletoAnterior:structuredClone(existentes),estado:confirmado?'revisao_assistida':'aguardando_confirmacao',
    prioridades,tarefasDisponiveis:[...porId.values()],pendenciasDeOferta,pendenciasDeOrigem,diagnosticoDeRegras:diagnostico,
    criterios:['Achados observados e intenção de publicação conservam seu escopo de HTML/URL.','Uma ação por decisão de oferta substitui a duplicação entre ficha e simulação.','Coleta fraca pede esclarecimento; condição recortada ou suporte sem vínculo não escolhe plano.','Em atividades sociais, audiência e território gerais não confirmam acesso nem papéis; publicações específicas continuam para revisão.','Título geral, URL ou termo genérico não atribuem a um objeto a resposta de outra oferta; alcance sem apoio fica desconhecido com a publicação preservada.','Casos de decisão são hipóteses de teste, com alternativas, condições e rotas próprias; não confirmam necessidades ou resultado do cliente.'],
    limites:['Propostas com fontes e partes explícitas para revisão; não certificam interpretação, vigência, elegibilidade ou resultado comercial.']};
}
