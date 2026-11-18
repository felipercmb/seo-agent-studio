import {createHash} from 'node:crypto';
import {normalizarSite} from '../consulta.mjs';
import {extrairAtribuicoesNominais} from './atribuicoes-nominais.mjs';
import {extrairCondicoesPorAtividade} from './condicoes-atividade.mjs';
import {extrairMediacoesDaFonte,extrairComparacaoDeOrcamentos} from './mediacao-publicada.mjs';
import {cabecalhoComercialPublicado, contextoDaExpressao, conviteDeAgenciamento, evidenciaContemExpressao,
  finalidadeDaPagina, nomeDeComercioPublicado, nomeDeProdutoPublicado,nomeDeAcessoPublicado,objetoDeCompraPublicado,paginaDeCarreira} from './linguagem-negocio.mjs';

const lista=v=>Array.isArray(v)?v:[];
const normal = v=>String(v??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
function identidadeSocial(t) {
  if(/^somos (?:o |um |uma |a )?(?:instituto|centro|fundacao|associacao)\b/.test(t)&&
    /\b(?:educacao publica|mobilizacao social|desenvolvimento social|desenvolvimento humano|combate a pobreza|direitos humanos)\b/.test(t))return true;
  return t.split(/(?<=[.!?])\s+/u).some(frase=>{
    if(/\bnao somos\b/.test(frase))return false;
    return /\b(?:somos (?:(?:uma?|um) )?organizacao|e (?:uma?|um) (?:organizacao|ecossistema)|somos (?:um )?ecossistema)\b/.test(frase)&&
      /\b(?:sem fins lucrativos|desenvolvimento social|pobreza|voluntari|comunidades|vulnerabilidade|direitos)\w*/.test(frase) ||
      /\b(?:organizacao da sociedade civil|organizacao nao[- ]governamental)\b/.test(frase)&&
        (!/^.{0,50}\b(?:era|foi|criada|fundada)\b/.test(frase)||/\be (?:uma?|um) organizacao\b/.test(frase)) ||
      /^cnpj\b/.test(frase)&&/\bsem fins lucrativos\b/.test(frase);
  });
}
const tiposIntermediacao = /jsonld\.(?:RealEstateAgent|InsuranceAgency|TravelAgency|EmploymentAgency)\.name$/;
const tiposServico = /jsonld\.(?:Hotel|LodgingBusiness|BedAndBreakfast|Restaurant|FoodEstablishment|School|CollegeOrUniversity|EducationalOrganization|ProfessionalService)\.name$/;
const tiposProduto = /jsonld\.(?:Store|OnlineStore)\.name$/;
const trechos = e=>String(e.trecho||'').split(/(?<=[.!?])\s+/u).filter(Boolean);
const semAspasAlheias = t=>!/(?:segundo (?:o|a|nosso)|diz (?:nosso|o|a)|nosso entrevistado|nosso cliente|cliente da plataforma)/.test(t);
const idAtuacao = (dominio,tipo,nome)=>'atuacao_'+createHash('sha256').update(dominio+'\n'+tipo+'\n'+normal(nome)).digest('hex').slice(0,16);

function fonteValida(e,dominio) {
    if(typeof e?.trecho!=='string'||!e.trecho.trim()||e.trecho.length>600||typeof e.campo!=='string')return false;
    try{const u=new URL(e.url);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&normalizarSite(u.href)===dominio;}
    catch{return false;}
}
function fontesPublicas(contexto,dominio) {
  if(contexto?.versao!==1||contexto.dominio!==dominio||!Array.isArray(contexto.evidencias))return [];
  return contexto.evidencias.slice(0,24).filter(e=>fonteValida(e,dominio));
}
function fontesDeApoio(contexto,dominio) {
  if(contexto?.versao!==1||contexto.dominio!==dominio||!Array.isArray(contexto.detalhesPublicados))return [];
  return contexto.detalhesPublicados.slice(0,64).filter(e=>fonteValida(e,dominio));
}
const fonteInstitucional = e=>!['editorial','participacao','documentacao','atendimento'].includes(finalidadeDaPagina(e.url));
const evidencia = e=>({url:e.url,campo:e.campo,trecho:e.trecho,coletadoEm:e.coletadoEm??null,sha256:e.sha256??null,
  ...(typeof e.recortado==='boolean'?{recortado:e.recortado}:{})});
const fontesUnicas = es=>[...new Map(es.map(e=>[JSON.stringify([e.url,e.campo,e.trecho]),evidencia(e)])).values()].slice(0,4);

export function condicaoDeCortesia(candidato,contexto,dominio) {
  if(!nomeDeProdutoPublicado(candidato?.termo))return null;
  const nome=normal(candidato.termo);
  const objeto=nome.replace(/^(?:a|o|as|os|uma|um) /,'').split(' ')[0];
  const qualificadores=nome.split(' ').filter(p=>p!==objeto&&p.length>=4);
  return [...fontesPublicas(contexto,dominio),...fontesDeApoio(contexto,dominio)].find(e=>e.url===candidato.evidencia?.url&&normal(e.secao)===nome&&!e.recortado&&
    trechos(e).some(frase=>{
      const t=normal(frase);
      if(/\bnao\b/.test(t)||!/\b(?:como cortesia|de cortesia|incluid[oa]s? n[ao] (?:hospedagem|diaria|estadia)|uso gratuito para (?:os )?hospedes)\b/.test(t))return false;
      const materialGenerico=/\b(?:disponibilizamos|oferecemos|disponibiliza|oferece) (?:os |as )?(?:materiais|equipamentos|itens|produtos|artigos|acessorios)\b/.test(t);
      return evidenciaContemExpressao(objeto,frase)||materialGenerico&&qualificadores.some(p=>evidenciaContemExpressao(p,frase));
    }))||null;
}

/** Centrality is the importance suggested by the publisher's own structure,
 * not popularity, rank, profitability or a confirmed business priority. */
export function centralidadeDaOferta(candidato,contexto,dominio) {
  const fontes=fontesPublicas(contexto,dominio).filter(fonteInstitucional),n=normal(candidato.termo);
  const fonte=evidencia(candidato.evidencia),urlPrincipal=contexto?.cobertura?.paginas?.[0]?.url||fontes[0]?.url;
  const hoteis=fontes.find(e=>/^jsonld\.(?:Hotel|LodgingBusiness|BedAndBreakfast)\.name$/.test(e.campo));
  const restaurantes=fontes.find(e=>/^jsonld\.(?:Restaurant|FoodEstablishment)\.name$/.test(e.campo)||
    e.url===urlPrincipal&&['title','h1','h2'].includes(e.campo)&&/\b(?:restaurantes?|gastronomia)\b/.test(normal(e.trecho)));
  const educacao=fontes.find(e=>/^jsonld\.(?:School|CollegeOrUniversity|EducationalOrganization)\.name$/.test(e.campo));
  const comercio=fontes.find(e=>tiposProduto.test(e.campo)||e.url===urlPrincipal&&['title','h1'].includes(e.campo)&&nomeDeComercioPublicado(e.trecho));
  const industriais=fontes.find(e=>/^nosso portfolio\b/.test(normal(e.trecho))&&/\b(?:linha de produtos|equipamentos|maquinas|compressores)\b/.test(normal(e.trecho)));
  const principal=(motivo,e)=>({nivel:'principal',natureza:'hipotese',motivos:[motivo],evidencias:fontesUnicas([fonte,...(e?[e]:[])])});
  const complementar=(motivo,e)=>({nivel:'complementar',natureza:'hipotese',motivos:[motivo],evidencias:fontesUnicas([fonte,...(e?[e]:[])])});
  if(hoteis&&/\b(?:hotel|hoteis|hospedagem|reservas?)\b/.test(n))return principal('A expressão é compatível com a atividade hoteleira explicitamente declarada.',hoteis);
  if(restaurantes&&/\b(?:restaurantes?|gastronomia|menu degustacao|jantar)\b/.test(n))return principal('O nome corresponde à atividade de restaurantes ou gastronomia declarada no núcleo do site.',restaurantes);
  if(educacao&&(/\b(?:curso|cursos|formacao|pos[- ]graduacao|mba|certificacao)\b/.test(n)||candidato.evidencia?.campo==='jsonld.Course.name'))return principal('A oferta corresponde à atividade educacional declarada pela organização.',educacao);
  if((comercio||industriais)&&(candidato.tipo==='produto'||candidato.declaracaoTransacional)) {
    if(/^acessorios\b/.test(n))return complementar('O catálogo publica a expressão como uma linha de acessórios; confirme sua importância.',comercio||industriais);
    return principal('O nome é compatível com o comércio ou portfólio de produtos declarado.',comercio||industriais);
  }
  if((hoteis||restaurantes)&&/\b(?:aulas?|equipamentos?|passeios?|experiencias?)\b/.test(n))return complementar('A atividade aparece junto ao núcleo de hotelaria ou gastronomia; confirme se é uma oferta independente.',hoteis||restaurantes);
  if(candidato.evidencia?.url===urlPrincipal&&['title','h1','h2'].includes(candidato.evidencia?.campo)&&cabecalhoComercialPublicado(candidato.termo)) {
    return principal('O nome nominal é publicado em um título ou cabeçalho da página principal; a importância ainda precisa de revisão.');
  }
  return {nivel:'indefinida',natureza:'hipotese',motivos:['Há uma expressão publicada, mas o recorte não determina sua importância no negócio.'],evidencias:[fonte]};
}

export function mediacoesPublicadas(contexto,dominio) {
  const fontes=[...fontesPublicas(contexto,dominio),...fontesDeApoio(contexto,dominio)];
  const achados=new Map();
  for(const e of fontes) {
    if(!['p','li','meta.description','meta.og:description'].includes(e.campo)||
      ['editorial','participacao','atendimento'].includes(finalidadeDaPagina(e.url)))continue;
    for(const m of extrairMediacoesDaFonte(e,dominio)) {
      const chave=JSON.stringify([e.url,m.frase]);
      if(!achados.has(chave))achados.set(chave,{...m,evidencia:evidencia(e)});
    }
  }
  const principal=contexto?.cobertura?.paginas?.[0]?.url;
  const orcamentos=extrairComparacaoDeOrcamentos(fontes.filter(f=>f.url===principal&&fonteInstitucional(f)));
  if(orcamentos) {
    const {fonte,complemento,...m}=orcamentos;
    achados.set(JSON.stringify([fonte.url,m.frase]),{...m,evidencia:evidencia(complemento),origemDoPedido:evidencia(fonte)});
  }
  return [...achados.values()].slice(0,6);
}

export function candidatosMediados(mediacoes) {
  return mediacoes.flatMap(m=>m.objetos.map(termo=>({termo,tipo:'servico',evidencia:m.evidencia,
    intermediacaoPublicada:true,urlNaoIdentificada:true})));
}

/** Names are exact substrings of statements, not generated service descriptions.
 * A verb of sale identifies a product; a vague promise is not a named offer. */
export function candidatosDeDeclaracoes(contexto,dominio) {
  const encontrados=[];
  const paginaPrincipal=contexto?.cobertura?.paginas?.[0]?.url;
  for(const e of fontesPublicas(contexto,dominio).filter(fonteInstitucional)) {
    const frases=[];
    if(e.tipo==='titulo'&&['h1','h2','h3','h4'].includes(e.campo))frases.push({nome:objetoDeCompraPublicado(e.trecho.replace(/^\+?\s*\d+\s+/,'')),venda:false});
    if(['descricao','declaracao'].includes(e.tipo)) {
      for(const frase of trechos(e)) {
        const limpo=frase.replace(/[.!?]+$/,'').trim();
        if(cabecalhoComercialPublicado(limpo)&&limpo.split(/\s+/).length<=12&&!/\b(?:com mais de|que da|que cuida|que transforma)\b|\d/iu.test(limpo))frases.push({nome:limpo,venda:false});
        if(e.campo==='meta.description'&&e.url===paginaPrincipal&&!e.recortado) {
          const apresentacao=/^(?:Descubra|Conhe[çc]a)\s+(?:o|a)\s+(?:melhor\s+)?((?:plataforma de|software de|sistema de)\s+[^.,!?]{3,72}?)(?=\s+para\s+|[.,!?]|$)/iu.exec(limpo);
          if(apresentacao)frases.push({nome:apresentacao[1],venda:false});
        }
        const declarada=/^(?:(?:Nós|Nos)\s+)?(Oferecemos|Vendemos|Fabricamos|Comercializamos|Prestamos|Entregamos)\s+(.+)$/iu.exec(limpo)||
          /^(?:A|Nossa|Esta) empresa (oferece|vende|fabrica|comercializa|presta)\s+(.+)$/iu.exec(limpo);
        const portfolio=/^Nosso portf[oó]lio (?:inclui|apresenta|oferece)\s+(.+)$/iu.exec(limpo);
        if(declarada||portfolio) {
          let objeto=(declarada?.[2]||portfolio?.[1]||'').replace(/^(?:um|uma|os|as|nossos|nossas)\s+/iu,'').split(/\s+(?:para|que|com o objetivo de|a fim de)\s+/iu)[0].split(/,\s+(?:contribuindo|garantindo|com (?:responsabilidade|seguran[çc]a|qualidade|efici[êe]ncia))|\s+com\s+excel[êe]ncia/iu)[0].trim();
          const rotulo=typeof e.secao==='string'?e.secao.trim():'';
          if(objeto&&rotulo&&normal(rotulo).startsWith(normal(objeto)+' para ')&&
            !/[.!?]/u.test(rotulo)&&evidenciaContemExpressao(rotulo,limpo))objeto=rotulo;
          // Broad brand promises have no identifiable object to prioritize.
          if(!/^(?:solu[çc][õo]es|experi[êe]ncias|resultados|qualidade|inova[çc][ãa]o|dignidade|o melhor|tudo|(?:(?:ampla|vasta|completa) )?linha de produtos|produtos$)\b/iu.test(objeto)) {
            frases.push({nome:objeto,venda:/^(?:vendemos|vende|fabricamos|fabrica|comercializamos|comercializa)$/iu.test(declarada?.[1]||'')});
          }
        }
        if(/\bseus produtos\b/.test(normal(e.trecho))) {
          const categoria=/(?:^|\s)[ée] refer[êe]ncia em\s+(.+?)(?:\s+que\b|[.!?]|$)/iu.exec(limpo);
          if(categoria)frases.push({nome:categoria[1].trim(),venda:true});
        }
        const producao=/\b(?:produzimos|fabricamos|comercializamos|produzindo e comercializando|produz e comercializa|fabrica e comercializa)\s+(.+)$/iu.exec(limpo);
        if(producao&&!/\b(?:nao|não)\b/iu.test(limpo)&&/\b(?:cooperativa|empresa|fabricante|industria|indústria|nossa|nosso)\b|^(?:produzimos|fabricamos|comercializamos)\b/iu.test(limpo)) {
          const nome=producao[1].split(/\s+(?:para|com o objetivo de)\s+/iu)[0].trim();
          frases.push({nome,venda:true});
        }
      }
    }
    if(['descricao','declaracao'].includes(e.tipo)&&semAspasAlheias(normal(e.trecho))) {
      const propria=/^(?:somos (?:uma?|um) (?:companhia|empresa|consultoria|organizacao)\b|nossa (?:companhia|empresa|consultoria)\b)/u.test(normal(e.trecho));
      const relacao=propria?/\b(?:ajuda|ajudamos|auxilia|auxiliamos)\s+[^.!?]{3,100}?\s+a\s+[^.!?]{3,80}?\s+com\s+([^.!?]+)[.!?]?$/iu.exec(e.trecho):null;
      const nome=relacao?.[1]?.trim();
      if(nome&&/\b(?:engenharia de|desenvolvimento de|consultoria|inteligencia artificial|software|automacao|projetos? de)\b/.test(normal(nome)))frases.push({nome,venda:false,relacaoTecnica:true});
    }
    for(const {nome,venda,relacaoTecnica=false} of frases) {
      if(nome.length<3||nome.length>120||nome.split(/\s+/).length>16||!evidenciaContemExpressao(nome,e.trecho))continue;
      if (!venda && /^garantia\b/u.test(normal(nome)) && [e.rotuloDeBloco,e.secao].some(s=>/^servico com garantia\b/u.test(normal(s)))) continue;
      const nominal=cabecalhoComercialPublicado(nome), declarada=e.campo==='p'&&/^(?:oferecemos|vendemos|fabricamos|comercializamos|prestamos|entregamos|nosso portfolio|(?:a|nossa|esta) empresa (?:oferece|vende|fabrica|comercializa|presta))\b|\bproduzindo e comercializando\b|\breferencia em .+seus produtos\b/.test(normal(e.trecho));
      if(!nominal&&!declarada&&!relacaoTecnica)continue;
      const candidato={termo:nome,tipo:venda||nomeDeProdutoPublicado(nome)||nomeDeComercioPublicado(nome)?'produto':'servico',
        evidencia:evidencia(e),declaracaoTransacional:venda};
      if(contextoDaExpressao(candidato)==='oferta')encontrados.push(candidato);
    }
  }
  return [...new Map(encontrados.map(c=>[normal(c.termo),c])).values()].slice(0,40);
}

function identidades(fontes) {
  const sinais=[];
  for(const e of fontes.filter(fonteInstitucional)) {
    if(tiposIntermediacao.test(e.campo))sinais.push({papel:'intermediacao',e});
    if(tiposServico.test(e.campo))sinais.push({papel:'servicos',e});
    if(tiposProduto.test(e.campo))sinais.push({papel:'produtos',e});
    const t=normal(e.trecho);
    if(!semAspasAlheias(t))continue;
    const titulo=['title','h1'].includes(e.campo);
    if(trechos(e).some(f=>/^(?:intermediamos|agenciamos|fazemos a intermediacao|atuamos como (?:corretora|intermediarios))\b/.test(normal(f))))sinais.push({papel:'intermediacao',e});
    if(/\btrabalha agenciando\b|\bvende(?:mos)?[^.!?]{0,40}\bagenciamento\b/.test(t)&&
      !/\bnao (?:trabalha agenciando|vende|vendemos)\b/.test(t))sinais.push({papel:'intermediacao',e});
    const propria=/(?:^|[.!?] )somos\b|\be (?:uma? )?(?:organizacao|ecossistema|empresa|rede|corretora|imobiliaria|fabricante|escola)\b/.test(t);
    if(/^nosso portfolio\b/.test(t)&&/\b(?:linha de produtos|equipamentos|maquinas|compressores|ferramentas)\b/.test(t))sinais.push({papel:'produtos',e});
    for(const frase of trechos(e)) {
      const n=normal(frase), negada=/\bnao (?:somos|e|fazemos|realizamos|oferecemos|vendemos|fabricamos|prestamos)\b/.test(n);
      if(negada||!titulo&&!propria)continue;
      // The object of "software para corretoras" is the customer's activity.
      const identidade=n.split(/\bpara\b/u)[0];
      if(/\b(?:imobiliaria|corretora(?: de\b)?|corretagem|intermediacao|agenciamento|agencia de (?:artistas|shows|viagens))\b/.test(identidade))sinais.push({papel:'intermediacao',e});
      if(/\b(?:somos (?:(?:uma?|os) )?fabricantes?|somos uma? industria|somos uma? loja|somos uma? distribuidora)\b/.test(identidade)||titulo&&nomeDeComercioPublicado(n.split(/\s*[|｜:]\s*|\s+[–—-]\s*/u).at(-1)))sinais.push({papel:'produtos',e});
      if(/\bsomos (?:(?:uma? )?(?:rede de )?)?(?:hoteis|hotel|pousada|escola)\b/.test(identidade))sinais.push({papel:'servicos',e});
    }
  }
  return sinais;
}

function conexaoEntrePartes(e) {
  if(e.recortado||!semAspasAlheias(normal(e.trecho)))return null;
  const t=normal(e.trecho);
  const identidade=/\b(?:somos|e) (?:(?:uma?|um) )?(?:agencia|corretora|imobiliaria|intermediarios|plataforma de (?:intermediacao|agenciamento))\b/.test(t)&&
    /\b(?:agenciamento|intermediacao|corretagem|agencia de (?:artistas|shows|viagens|recrutamento))\b/.test(t);
  if(!identidade)return null;
  for(const frase of trechos(e)) {
    if(/\b(?:nao|nunca)\s+(?:conectamos|aproximamos|ligamos)\b/.test(normal(frase)))continue;
    const origem=/\b(?:conectamos|aproximamos|ligamos)\s+(artistas|profissionais|fornecedores|prestadores de servi[çc]os|vendedores)\b/iu.exec(frase);
    const destino=/\s+(?:a|aos|[àa]s|com)\s+((?:produtores|prefeituras|igrejas|festivais|empresas|contratantes|organizadores|compradores|clientes)\b[^.!?]*)[.!?]?$/iu.exec(frase);
    if(!origem||!destino||destino.index<origem.index)continue;
    const destinatarios=[...destino[1].matchAll(/\b(?:produtores|prefeituras|igrejas|festivais|empresas|contratantes|organizadores|compradores|clientes)\b/giu)].map(m=>m[0]);
    if(destinatarios.length)return{frase,origem:origem[1],destinatarios:[...new Set(destinatarios)]};
  }
  return null;
}

function relacoesPublicadas(fontes) {
  const relacoes=[];
  const adicionar=(tipo,frase,e,objeto=null)=>{
    if(relacoes.length>=6||relacoes.some(r=>r.tipo===tipo&&normal(r.texto)===normal(frase)))return;
    const atores=[...frase.matchAll(/\b(?:empresas|profissionais|clientes|fornecedores|parceiros|partes|plataforma|cooperativa|artistas|produtores|prefeituras|igrejas|festivais|contratantes|organizadores|compradores|vendedores)\b/giu)].map(m=>m[0]);
    relacoes.push({tipo,texto:frase,objeto:objeto&&objeto.length<=120?objeto:null,atores:[...new Set(atores)].slice(0,6),
      natureza:'hipotese',recortado:Boolean(e.recortado),evidencias:[evidencia({...e,trecho:frase})]});
  };
  for(const e of fontes.filter(fonteInstitucional)) {
    if(!semAspasAlheias(normal(e.trecho)))continue;
    const conexao=conexaoEntrePartes(e);
    if(conexao)adicionar('conexao_entre_partes',conexao.frase,e);
    const frases=trechos(e);
    if(e.recortado&&!/[.!?]$/.test(e.trecho))frases.pop();
    for(const frase of frases) {
      const t=normal(frase);
      if(/\bnao (?:vende|vendemos|oferece|oferecemos|presta|prestamos)\b/.test(t))continue;
      if(/\bformalizacao de contratos entre (?:as )?partes\b/.test(t))adicionar('formalizacao_entre_partes',frase,e);
      const terceiros=/\b(?:veiculos|servicos|atividades|entregas|viagens)\b[^.!?]{0,80}\b(?:operad[oa]s?|executad[oa]s?|prestad[oa]s?|realizad[oa]s?) por (?:(?:mais de|cerca de) )?(?:\d+ )?(?:empresas|profissionais|parceiros|fornecedores)\b/.exec(t);
      if(terceiros&&!/\b(?:nao|nunca)\b/.test(terceiros[0]))adicionar('execucao_por_terceiros',frase,e);
      const canal=/\b(?:voc[êe] (?:pode )?(?:comprar|compra)|compra(?:r)? sua|compre|vendemos|comercializamos)\b[^.!?]{0,100}\b(passage(?:m|ns)[^.!?]{0,70}|ingressos?[^.!?]{0,70}|produtos?[^.!?]{0,70})/iu.exec(frase);
      if(canal)adicionar('canal_comercializacao',frase,e,canal[1].trim());
      if(/^(?:prestamos|fabricamos|produzimos|entregamos|desenvolvemos)\b/.test(t)||/\bproduzindo e comercializando\b/.test(t)) {
        const objeto=/\b(?:prestamos|fabricamos|produzimos|entregamos|desenvolvemos|produzindo e comercializando)\s+(.+?)[.!?]?$/iu.exec(frase)?.[1]?.trim();
        adicionar('execucao_propria',frase,e,objeto);
      }
      if(/\b(?:nossos parceiros|nossas empresas parceiras|trabalhamos com (?:nossos )?parceiros)\b/.test(t))adicionar('parceria',frase,e);
    }
  }
  return relacoes;
}

export function finalidadePublicada(contexto,dominio) {
  return fontesPublicas(contexto,dominio).filter(fonteInstitucional).some(e=>
    /^jsonld\.NGO\./.test(e.campo)||semAspasAlheias(normal(e.trecho))&&identidadeSocial(normal(e.trecho)))?'social':'indefinida';
}

/** Donation, recruiting and social programs are different journeys. A social
 * organization can still publish an actual product for sale. */
export function naturezaDaAtuacao(candidato,finalidade='indefinida') {
  const n=normal(candidato?.termo), contexto=contextoDaExpressao(candidato);
  if(candidato?.intermediacaoPublicada===true&&finalidade!=='social')return 'oferta';
  if(contexto==='captacao')return 'captacao';
  if(contexto==='participacao')return 'participacao';
  if(contexto!=='oferta')return null;
  if(finalidade==='social') {
    if(/^(?:programa|projeto|iniciativa)\b/.test(n))return 'programa_social';
    if(candidato.declaracaoTransacional===true||candidato.tipo==='produto'&&/^(?:jsonld\.|schema:)Product\.name$/.test(candidato.evidencia?.campo||''))return 'oferta';
    return null;
  }
  return contexto==='oferta'?'oferta':null;
}

function recortarGrupoNominal(valor) {
  const palavras=[...valor.matchAll(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu)];
  const verbos=new Set(['sao','estao','tem','terao','podem','devem','precisam','buscam','desejam','querem','recebem',
    'vivem','trabalham','estudam','aprendem','participam','acessam','encontram','enfrentam','conseguem','foram','eram','tiveram']);
  let fim=valor.length;
  for(let i=1;i<palavras.length;i++) {
    const atual=normal(palavras[i][0]),anterior=normal(palavras[i-1][0]),proxima=normal(palavras[i+1]?.[0]);
    const nomeRegional=atual==='sao'&&['de','do','da','em','no','na','para'].includes(anterior);
    const oracao=verbos.has(atual)&&!nomeRegional||['que','quem','quando','onde','cujo','cujos','cujas'].includes(atual);
    const infinitivo=['a','ao','aos','para'].includes(atual)&&/(?:ar|er|ir|or)(?:em|mos|es)?$/u.test(proxima);
    if(oracao||infinitivo){fim=palavras[i].index;break;}
  }
  let grupo=valor.slice(0,fim).trim(),anterior;
  do {anterior=grupo;grupo=grupo.replace(/\s+(?:a|ao|aos|de|da|do|das|dos|e|em|na|no|nas|nos|para|com|por|sua|seu|suas|seus)$/iu,'').trim();}while(grupo!==anterior);
  return grupo;
}

function declaracaoAfirmativaDoPublico(grupo,trecho) {
  // Availability is scoped to a clause and its object. A later positive clause
  // is independent; absence of registration requirements is not an exclusion.
  const clausulas=trecho.split(/(?<=[.!?;])\s+|\s+(?:mas|por[ée]m|contudo)\s+|,\s*(?=(?:dispon[íi]vel|indispon[íi]vel|atendemos|n[ãa]o atendemos)\b)/iu);
  const exclusao=/\b(?:indisponiv(?:el|eis)|nao (?:esta |e |estao |sao )?disponiv(?:el|eis)|nao (?:atendemos|aceitamos|recebemos|recrutamos)|nao (?:e |sao )?(?:destinad[oa]s?|voltad[oa]s?|elegiv(?:el|eis)|permitid[oa]s?)|sem atendimento|exceto para|nao se aplica)\b/u;
  for(const clausula of clausulas) {
    if(!evidenciaContemExpressao(grupo,clausula))continue;
    const n=normal(clausula),g=normal(grupo);let pos=n.indexOf(g);
    while(pos!==-1) {
      const antes=n.slice(0,pos),depois=n.slice(pos+g.length);
      const indisponivelDepois=/^\s*,?\s*(?:(?:o|a|os|as) (?:servico|atendimento|acesso|programa|participacao|vaga|inscricao|plano)\s+)?(?:(?:esta|e|estao|sao|permanece)\s+)?(?:indisponiv(?:el|eis)|nao disponiv(?:el|eis))\b/u.test(depois);
      if(!exclusao.test(antes)&&!indisponivelDepois)return clausula.trim();
      pos=n.indexOf(g,pos+g.length);
    }
  }
  return null;
}

function publicosDasFontes(fontes,finalidade) {
  const resultados=[];
  const adicionar=(tipo,texto,e)=>{
    const t=recortarGrupoNominal(texto.trim().replace(/[.,;:]+$/,''));
    if(t.length<3||t.length>180||!evidenciaContemExpressao(t,e.trecho)||resultados.some(p=>p.tipo===tipo&&normal(p.texto)===normal(t)))return;
    const afirmacao=declaracaoAfirmativaDoPublico(t,e.trecho);
    if(!afirmacao)return;
    resultados.push({tipo,texto:t,natureza:'hipotese',evidencias:[evidencia({...e,trecho:afirmacao})]});
  };
  const educacional=fontes.some(e=>/^jsonld\.(?:School|EducationalOrganization|Course)\./.test(e.campo)||['title','h1'].includes(e.campo)&&/\b(?:cursos?|formacao|escola|educacao)\b/.test(normal(e.trecho)));
  for(const e of fontes.filter(e=>!['editorial','documentacao'].includes(finalidadeDaPagina(e.url)))) {
    const t=e.trecho;
    if(!semAspasAlheias(normal(t)))continue;
    const conexao=conexaoEntrePartes(e);
    if(conexao) {
      adicionar('participante',conexao.origem,e);
      for(const destinatario of conexao.destinatarios)adicionar('cliente',destinatario,e);
    }
    const participantes=t.match(/(?:jovens\s+)?volunt[áa]ri[oa]s?(?:\s+e\s+volunt[áa]rias)?/giu)||[];
    for(const grupo of participantes)adicionar('participante',grupo,e);
    const apoioExplicito=/\b(?:apoio|apoiadores|doadores|doacoes|captacao|patrocinio|patrocinadores)\b/.test(normal(t));
    const apoiadores=t.match(apoioExplicito?/(?:empresas?\s+parceiras?|doadores?|apoiadores?|parceiros|patrocinadores)/giu:/(?:doadores?|apoiadores?|patrocinadores)/giu)||[];
    for(const grupo of apoiadores)adicionar('apoiador',grupo,e);
    for(const grupo of t.match(/(?:h[óo]spedes|pacientes|viajantes|visitantes)/giu)||[])adicionar('beneficiario',grupo,e);
    if(educacional||finalidade==='social')for(const grupo of t.match(/(?:professores|gestores|redes de ensino|educadores|alunos|estudantes)/giu)||[])adicionar('participante',grupo,e);
    if(finalidade==='social') {
      for(const grupo of t.match(/(?:fam[íi]lias|moradores|crian[çc]as|jovens(?! volunt[áa]rios)|adolescentes|comunidades|pessoas\s+em\s+situa[çc][ãa]o)(?:\s+(?!que\b|para\b|e\b|com\b|por\b|todos\b|recebem\b|beneficiad[oa]s\b)[\p{L}-]+){0,6}/giu)||[])adicionar('beneficiario',grupo,e);
    } else {
      for(const match of t.matchAll(/\b(?:para|atendemos|ajuda|ajudamos)\s+((?:(?:grandes|pequenas|m[ée]dias|micro)\s+)?(?:empresas|profissionais|organizadores|contratantes|promotores de eventos|empreendedores|lojistas|ind[úu]strias|resid[êe]ncias|fam[íi]lias|viajantes)(?:\s+(?!que\b|para\b|e\b|com\b)[\p{L}-]+){0,4})/giu))adicionar('cliente',match[1],e);
      if(educacional)for(const match of t.matchAll(/\bpara\s+(profissionais(?:\s+de\s+[\p{L} ]{3,50})?)/giu))adicionar('participante',match[1].split(/\s+que\s+/iu)[0],e);
    }
  }
  const especificos=resultados.filter(p=>!resultados.some(outro=>outro!==p&&outro.tipo===p.tipo&&outro.texto.length>p.texto.length&&evidenciaContemExpressao(p.texto,outro.texto)));
  const filas=['beneficiario','cliente','participante','apoiador'].map(tipo=>especificos.filter(p=>p.tipo===tipo));
  const escolhidos=[];
  while(escolhidos.length<8&&filas.some(f=>f.length))for(const fila of filas)if(fila.length&&escolhidos.length<8)escolhidos.push(fila.shift());
  return escolhidos;
}

function territoriosDasFontes(fontes) {
  const resultados=[];
  for(const e of fontes.filter(fonteInstitucional)) {
    if(!semAspasAlheias(normal(e.trecho)))continue;
    const grupos=[...e.trecho.matchAll(/\b((?:periferias|territ[óo]rios|bairros|regi[õo]es|comunidades)(?:\s+[\p{L}-]+){0,4})\s+(?:s[ãa]o|[ée])\s+o foco\s+(?:do (?:nosso )?trabalho|da (?:nossa )?atua[çc][ãa]o)/giu)];
    for(const grupo of grupos) {
      const texto=grupo[1].trim();
      if(texto.length>180||resultados.some(r=>normal(r.texto)===normal(texto)))continue;
      resultados.push({texto,natureza:'hipotese',evidencias:[evidencia(e)]});
      if(resultados.length>=6)return resultados;
    }
  }
  return resultados;
}

export function inferirEntendimentoNegocio({dominio,ofertas=[],candidatos=[],contextoPublico=null,mediacoes=mediacoesPublicadas(contextoPublico,dominio)}) {
  const fontes=fontesPublicas(contextoPublico,dominio), proprias=fontes.filter(fonteInstitucional);
  const relacoesDeMediacao=mediacoes.map(m=>({tipo:['comparacao_de_orcamentos','intermediacao_entre_partes'].includes(m.forma)?'conexao_entre_partes':'representacao_na_transacao',texto:m.frase,
    objeto:m.objetos.join(', '),objetos:m.objetos,forma:m.forma,atores:m.atores||[],natureza:'hipotese',
    recortado:false,evidencias:m.origemDoPedido?[m.origemDoPedido,m.evidencia]:[m.evidencia]}));
  const relacoes=[...relacoesDeMediacao,...relacoesPublicadas([...fontes,...fontesDeApoio(contextoPublico,dominio)])].slice(0,6);
  const sociais=proprias.filter(e=>/^jsonld\.NGO\./.test(e.campo)||semAspasAlheias(normal(e.trecho))&&identidadeSocial(normal(e.trecho)));
  const sinais=[...relacoesDeMediacao.map(r=>({papel:'intermediacao',e:r.evidencias[0]})),...identidades(fontes)];
  const tipos=new Set(sinais.map(s=>s.papel));
  const intermediacaoRelacionada=relacoes.some(r=>!r.recortado&&r.tipo==='execucao_por_terceiros'&&
    /\bnossa plataforma\b/.test(normal(r.texto))&&relacoes.some(c=>c.tipo==='canal_comercializacao'&&c.texto===r.texto&&c.evidencias[0]?.url===r.evidencias[0]?.url));
  if(relacoes.some(r=>!r.recortado&&r.tipo==='formalizacao_entre_partes')||intermediacaoRelacionada) {
    tipos.add('intermediacao');
    for(const r of relacoes.filter(r=>['formalizacao_entre_partes','execucao_por_terceiros'].includes(r.tipo)))sinais.push({papel:'intermediacao',e:r.evidencias[0]});
  }
  const fontesOfertas=ofertas.flatMap(o=>o.evidencias||[]);
  const candidatosOfertas=ofertas.map(o=>candidatos.find(c=>normal(c.termo)===normal(o.nome))).filter(Boolean);
  const intermedias=ofertas.filter(o=>/\b(?:agenciamento|intermediacao|corretagem)\b/.test(normal(o.nome)));
  if(intermedias.length)tipos.add('intermediacao');
  const temTipoProduto=candidatosOfertas.some(c=>c.tipo==='produto'),temTipoServico=candidatosOfertas.some(c=>c.tipo==='servico');
  if(!tipos.has('intermediacao')) {
    const servicoDeclarado=sinais.some(s=>s.papel==='servicos')||relacoes.some(r=>r.tipo==='execucao_propria'&&/^(?:prestamos|desenvolvemos|entregamos)\b/.test(normal(r.texto))),produtoExplicito=candidatosOfertas.some(c=>c.tipo==='produto'&&
      (/^(?:jsonld\.|schema:)Product\.name$/.test(c.evidencia?.campo||'')||nomeDeComercioPublicado(c.termo)||c.declaracaoTransacional));
    if(temTipoProduto&&(!servicoDeclarado||produtoExplicito))tipos.add('produtos');
    const servicoExplicito=candidatosOfertas.some(c=>c.tipo==='servico'&&
      (/^(?:jsonld\.|schema:)Service\.name$/.test(c.evidencia?.campo||'')||/^(?:servicos?|consultoria|instalacao|manutencao|locacao|aluguel|hospedagem|planos? de saude|software|sistema de gestao)\b/.test(normal(c.termo))));
    if(temTipoServico&&(!sinais.some(s=>s.papel==='produtos')||servicoExplicito)&&
      (servicoDeclarado||candidatosOfertas.some(c=>c.tipo==='servico'&&!nomeDeAcessoPublicado(c.termo))))tipos.add('servicos');
  }
  let papel=tipos.has('intermediacao')?'intermediacao':tipos.has('produtos')&&tipos.has('servicos')?'misto':tipos.has('produtos')?'produtos':tipos.has('servicos')?'servicos':'indefinido';
  const conflitos=[];
  const negacaoIntermediacao=proprias.filter(e=>/\bnao (?:intermediamos|agenciamos)\b|\bnao (?:fazemos|realizamos|somos|atuamos como)\b[^.!?]{0,65}\b(?:intermediacao|corretora|imobiliaria|agenciamento)\b/.test(normal(e.trecho)));
  if(papel==='intermediacao'&&negacaoIntermediacao.length) {
    conflitos.push({campo:'papel',motivo:'Há uma declaração de intermediação e outra que nega esse papel. É necessária revisão do responsável.',
      evidencias:fontesUnicas([...sinais.filter(s=>s.papel==='intermediacao').map(s=>s.e),...negacaoIntermediacao])});
    papel='indefinido';
  }
  for(const par of [
    {nome:'fabricação',positiva:/\bsomos (?:(?:uma?|os) )?fabricantes?\b/,negativa:/\bnao somos (?:(?:uma?|os) )?fabricantes?\b/},
    {nome:'prestação de serviços',positiva:/\bprestamos servicos\b/,negativa:/\bnao prestamos servicos\b/},
    {nome:'venda de produtos',positiva:/\bvendemos produtos\b/,negativa:/\bnao vendemos produtos\b/},
  ]) {
    const afirmam=proprias.filter(e=>trechos(e).some(f=>par.positiva.test(normal(f))&&!par.negativa.test(normal(f))));
    const negam=proprias.filter(e=>par.negativa.test(normal(e.trecho)));
    if(afirmam.length&&negam.length) {
      conflitos.push({campo:'papel',motivo:`Os trechos publicados afirmam e negam ${par.nome}; confirme o papel com o responsável.`,evidencias:fontesUnicas([...afirmam,...negam])});
      papel='indefinido';
    }
  }
  let finalidade=sociais.length?'social':ofertas.length||sinais.some(s=>!/^jsonld\.(?:School|CollegeOrUniversity|EducationalOrganization)\./.test(s.e.campo))?'comercial':'indefinida';
  const finalidadeComercialDeclarada=proprias.filter(e=>trechos(e).some(f=>/\bsomos (?:uma? )?(?:empresa|organizacao) com fins lucrativos\b/.test(normal(f))&&!/\bnao somos\b/.test(normal(f))));
  if(sociais.length&&finalidadeComercialDeclarada.length) {
    conflitos.push({campo:'finalidade',motivo:'Há declarações incompatíveis sobre a finalidade da organização. A existência de vendas por si só não cria esse conflito.',evidencias:fontesUnicas([...sociais,...finalidadeComercialDeclarada])});
    finalidade='indefinida';
  }
  const propositos=proprias.filter(e=>e.tipo==='declaracao'&&e.campo==='p'&&e.trecho.length>=25&&
    (/^(?:missao|proposito)$/u.test(normal(e.secao))||/\b(?:nossa missao|nosso proposito|nosso objetivo)\b/.test(normal(e.trecho))));
  const missaoNaDescricao=finalidade==='social'?proprias.find(e=>e.tipo==='descricao'&&
    /^(?:fomentar|promover|transformar|reduzir|combater|garantir|desenvolver|ampliar|fortalecer|contribuir|proteger|apoiar)\b/.test(normal(e.trecho))&&
    /\b(?:justica social|desenvolvimento (?:social|humano|sustentavel)|equidade|educacao|pobreza|direitos humanos|vulnerabilidade|desigualdades)\b/.test(normal(e.trecho))):null;
  const p=propositos[0]||missaoNaDescricao||sociais.find(e=>e.trecho.length>40)||null;
  const proposito=p?{texto:p.trecho,natureza:'hipotese',evidencias:[evidencia(p)]}:null;
  const atuacoes=ofertas.map(o=>({id:idAtuacao(dominio,'oferta',o.nome),tipo:'oferta',nome:o.nome,url:o.url,
    natureza:o.origem==='usuario'?'declaracao_usuario':'hipotese',evidencias:structuredClone(o.evidencias||[])}));
  const naoComerciais=[];
  const apoioDeAtuacao=[...proprias,...fontesDeApoio(contextoPublico,dominio).filter(fonteInstitucional)];
  const adicionar=(tipo,nome,e)=>{
    if(!tipo||tipo==='oferta'||nome.length>120||nome.length<3||naoComerciais.some(a=>a.tipo===tipo&&normal(a.nome)===normal(nome)))return;
    if(tipo==='participacao'&&(paginaDeCarreira(e.url)||/^(?:trabalhe conosco|trabalhe com a gente|venha trabalhar|vagas? (?:para|de) emprego)\b/u.test(normal(nome))))return;
    if(tipo==='participacao'&&conviteDeAgenciamento(nome)&&['title','h1'].includes(e.campo)&&e.sha256){
      const outroCampo=e.campo==='title'?'h1':'title';
      const convite=naoComerciais.find(a=>a.tipo===tipo&&a.url===e.url&&conviteDeAgenciamento(a.nome)&&
        a.evidencias.some(f=>f.campo===outroCampo&&f.sha256===e.sha256&&f.coletadoEm===e.coletadoEm));
      if(convite){
        convite.evidencias=fontesUnicas([...convite.evidencias,e]);
        if(e.campo==='h1'){
          convite.nome=nome;
          convite.id=idAtuacao(dominio,tipo,nome);
        }
        return;
      }
    }
    const evidenciasAtuacao=[evidencia(e)];
    if(tipo==='programa_social'&&/^(?:projetos?|iniciativas?)\b/.test(normal(nome))) {
      const descricao=apoioDeAtuacao.find(f=>f.url===e.url&&(normal(f.secao)===normal(nome)||evidenciaContemExpressao(nome,f.trecho))&&
        !f.recortado&&!/^h[1-6]$/.test(f.campo)&&/\b(?:oferecemos|atendemos|beneficia|construimos|desenvolvemos|implementamos|formamos|capacita|alfabetizacao|formacao)\b/.test(normal(f.trecho)));
      if(!descricao)return;
      if(descricao.campo!==e.campo||descricao.trecho!==e.trecho)evidenciasAtuacao.push(evidencia(descricao));
    }
    if(naoComerciais.length>=40)return;
    naoComerciais.push({id:idAtuacao(dominio,tipo,nome),tipo,nome,url:e.url,natureza:'hipotese',evidencias:evidenciasAtuacao});
  };
  for(const c of candidatos)if(fonteValida(c?.evidencia,dominio)&&evidenciaContemExpressao(c.termo,c.evidencia.trecho)) {
    const tipo=naturezaDaAtuacao(c,finalidade);
    // A page for recruiting participants can also contain slogans and benefits;
    // those are not separate activities merely because they share the page.
    if(tipo!=='participacao'||/^(?:seja|torne|junte|faca parte|trabalhe|cadastre|venha|vagas?|voluntariado)\b/.test(normal(c.termo)))adicionar(tipo,c.termo,c.evidencia);
  }
  for(const e of proprias)if(e.tipo==='declaracao'&&/^h[1-4]$/.test(e.campo)) {
    const t=normal(e.trecho);
    const tipo=/^(?:doacao|doacoes|doe\b|apadrinhe|captacao)\b/.test(t)?'captacao':/\bvoluntariado\b/.test(t)?'participacao':finalidade==='social'&&/^(?:programa|projeto|iniciativa)\b/.test(t)?'programa_social':null;
    adicionar(tipo,e.trecho,e);
  }
  if(finalidade==='social')for(const e of apoioDeAtuacao)if(['declaracao','descricao','paragrafo'].includes(e.tipo)&&!/^h[1-6]$/.test(e.campo)) {
    if(/\b(?:disponibilizamos|desenvolvemos|implementamos|nossas? propostas|nossos? programas|somos)\b/.test(normal(e.trecho))) {
      for(const match of e.trecho.matchAll(/\b(?:propostas|projetos|programas|solu[çc][õo]es) educacionais\b|\bforma[çc][ãa]o de educadores\b/giu))adicionar('programa_social',match[0],e);
    }
    for(const match of e.trecho.matchAll(/\b(?:programas?|projetos?|iniciativas|solu[çc][õo]es) de (?:[\p{L}-]+ ){0,9}[\p{L}-]+/giu)) {
      const nome=match[0].split(/\s+(?:em|para|que|nas|nos|ao|fortalecendo)\s+/iu)[0].trim().replace(/\s+(?:e|de|da|do|com|para)$/iu,'');
      adicionar('programa_social',nome,e);
    }
    for(const match of e.trecho.matchAll(/\b(?:mobiliz[\p{L}]+ (?:o |a )?(?:voluntariado jovem|jovens volunt[áa]rios)|voluntariado jovem)\b/giu))adicionar('participacao',match[0],e);
  }
  if(finalidade==='social')for(const e of apoioDeAtuacao)if(/^h[1-4]$/.test(e.campo)&&/^(?:fomento (?:a|de)|desenvolvimento territorial|forma[çc][ãa]o de educadores|apoio a iniciativas)\b/iu.test(e.trecho))adicionar('programa_social',e.trecho,e);
  const ordemDaFonte=a=>a.evidencias.some(e=>e.campo==='p'||e.campo==='meta.description')?0:/^programa\b/.test(normal(a.nome))?1:2;
  const filas=['programa_social','participacao','captacao'].map(tipo=>naoComerciais.filter(a=>a.tipo===tipo).sort((a,b)=>ordemDaFonte(a)-ordemDaFonte(b)));
  let restantes=8;
  while(restantes&&filas.some(f=>f.length))for(const fila of filas)if(fila.length&&restantes){atuacoes.push(fila.shift());restantes--;}
  const bases=fontesUnicas([...sinais.map(s=>s.e),...intermedias.flatMap(o=>o.evidencias),...fontesOfertas]);
  const motivos=[];
  if(!fontes.length)motivos.push('Não há contexto declarativo do HTML inicial; somente as evidências de ofertas disponíveis podem ser usadas.');
  if(contextoPublico?.cobertura?.paginas?.length&&contextoPublico.cobertura.paginas.every(p=>p.caracteresTextoVisivel<80))motivos.push('O HTML inicial tem pouco texto visível; a página renderizada pode conter informações não lidas.');
  if(contextoPublico?.cobertura?.limitada)motivos.push('A leitura está limitada a parte das páginas e trechos públicos.');
  const insuficiente=!bases.length&&!sociais.length&&!proposito;
  if(insuficiente)motivos.push('Não foi encontrada uma declaração suficiente para classificar o negócio.');
  return {versao:2,papel,natureza:'hipotese',evidencias:bases.slice(0,3),
    finalidade:{tipo:finalidade,natureza:'hipotese',evidencias:fontesUnicas(sociais.length?sociais:[...sinais.map(s=>s.e),...fontesOfertas])},
    proposito,publicos:publicosDasFontes([...fontes,...fontesDeApoio(contextoPublico,dominio)],finalidade),
    territorios:territoriosDasFontes([...fontes,...fontesDeApoio(contextoPublico,dominio)]),atuacoes,relacoes,conflitos,
    atribuicoesNominais:extrairAtribuicoesNominais({dominio,fontes:[...fontes,...fontesDeApoio(contextoPublico,dominio)]}),
    condicoesPorAtividade:extrairCondicoesPorAtividade({dominio,fontes:[...lista(contextoPublico?.perguntasPublicadas),...fontes,...fontesDeApoio(contextoPublico,dominio)]}),
    qualidade:{estado:conflitos.length?'conflitante':insuficiente?'insuficiente':'hipotese',motivos},
  };
}
