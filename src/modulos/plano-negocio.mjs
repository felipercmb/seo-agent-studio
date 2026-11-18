import {normalizarSite} from '../consulta.mjs';
import {createHash} from 'node:crypto';
import {conviteDeAgenciamento} from './linguagem-negocio.mjs';

const limpar=(v,max=600)=>typeof v==='string'?v.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const normal=v=>limpar(v).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const hashValido=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const evidenciasDe=v=>Array.isArray(v?.evidencias)?v.evidencias.slice(0,32):[];
const campoLiteral=v=>typeof v==='string'&&/^(?:title|meta\.(?:description|og:description)|h[1-6]|p|li|a|jsonld\.[A-Za-z]+\.(?:name|description))$/.test(v);
function fonteLiteral(e){
  // A computed finding can share the URL/hash of its input. That provenance
  // does not turn the diagnostic's explanation into words published by the site.
  return e&&campoLiteral(e.campo)&&!e.verificacaoId&&
    !['diagnostico','google','demanda','cenario_declarado'].includes(e.tipo);
}
function fonteAtual(e,dominio,url,agora){
  try{const u=new URL(e?.url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port&&
    normalizarSite(u.href)===dominio&&(!url||u.href===url)&&hashValido(e.sha256)&&limpar(e.trecho)&&
    typeof e.coletadoEm==='string'&&Number.isFinite(Date.parse(e.coletadoEm))&&Date.parse(e.coletadoEm)<=agora&&agora-Date.parse(e.coletadoEm)<86400_000;
  }catch{return false;}
}
function fontesDoNegocio(perfil,oferta,pagina,contexto,agora){
  const dominio=perfil.dominio,url=pagina?.url;
  const doContexto=contexto?.versao===1&&contexto.dominio===dominio&&Array.isArray(contexto.evidencias)?contexto.evidencias.slice(0,24):[];
  const paginas=Array.isArray(contexto?.cobertura?.paginas)?contexto.cobertura.paginas:[],coleta=paginas.find(p=>p?.url===url);
  return [...new Map([...evidenciasDe(oferta),...doContexto].filter(e=>fonteLiteral(e)&&fonteAtual(e,dominio,url,agora)&&
    (!coleta||coleta.sha256===e.sha256&&coleta.coletadoEm===e.coletadoEm))
    .map(e=>[JSON.stringify([e.url,e.campo,e.trecho,e.sha256]),{url:e.url,campo:e.campo,trecho:limpar(e.trecho),coletadoEm:e.coletadoEm,sha256:e.sha256,
      tipo:'negocio_publicado',natureza:'trecho_literal',relacao:'contexto_da_pagina',tipoOriginal:limpar(e.tipo,40)||null,...(e.secao?{secao:limpar(e.secao,120)}:{})}])).values()].slice(0,8);
}
function detalhesDoNegocio(perfil,pagina,contexto,agora){
  if(!pagina||contexto?.versao!==1||contexto.dominio!==perfil.dominio||!Array.isArray(contexto.detalhesPublicados))return[];
  const paginas=Array.isArray(contexto?.cobertura?.paginas)?contexto.cobertura.paginas:[],coleta=paginas.find(p=>p?.url===pagina.url);
  return [...new Map(contexto.detalhesPublicados.slice(0,64).filter(e=>fonteLiteral(e)&&
    ['cabecalho','paragrafo','item'].includes(e.tipo)&&fonteAtual(e,perfil.dominio,pagina.url,agora)&&
    (!coleta||coleta.sha256===e.sha256&&coleta.coletadoEm===e.coletadoEm))
    .map(e=>[JSON.stringify([e.campo,e.trecho,e.sha256]),{url:e.url,campo:e.campo,trecho:limpar(e.trecho,360),
      coletadoEm:e.coletadoEm,sha256:e.sha256,tipo:'negocio_publicado',natureza:'trecho_literal',relacao:'contexto_da_pagina',tipoOriginal:e.tipo,
      ...(e.secao?{secao:limpar(e.secao,120)}:{}),recortado:e.recortado===true}])).values()].slice(0,24);
}
const palavrasDe=v=>normal(v).match(/[a-z0-9]{4,}/g)||[];
const GENERICAS=new Set(['para','como','mais','pela','pelo','sobre','comercial','contratacao','oferta','ofertas','servico','servicos','produto','produtos','equipamento','equipamentos','curso','cursos','aula','aulas','formacao','formacoes','plataforma','programa','institucional']);
function ligadoAOferta(e,oferta){
  if(normal(e.secao)===normal(oferta.nome))return true;
  const termos=palavrasDe(oferta.nome).filter(t=>!GENERICAS.has(t));
  return termos.length>0&&[e.trecho,e.secao].some(v=>termos.filter(t=>palavrasDe(v).includes(t)).length>=Math.ceil(termos.length*.6));
}
function condicaoVinculada(oferta,fontes){
  // A courtesy attached to another activity must not become a standalone sale.
  // Require the literal condition and a link to this reviewed activity; a
  // courtesy elsewhere on the same page is insufficient.
  return fontes.find(e=>ligadoAOferta(e,oferta)&&!e.recortado&&/\b(?:como cortesia|de cortesia|em cortesia|(?:e|sao|esta|estao) (?:uma )?cortesia)\b/.test(normal(e.trecho))&&
    !/\b(?:nao|nunca|sem)\b[^.!?;]{0,80}\bcortesia\b/.test(normal(e.trecho)))||null;
}
function leituraFraca(perfil,pagina,contexto,agora){
  if(!pagina||contexto?.dominio!==perfil.dominio||!Array.isArray(contexto.cobertura?.paginas))return false;
  const p=contexto.cobertura.paginas.find(p=>p.url===pagina.url);
  if(!p||!hashValido(p.sha256)||typeof p.coletadoEm!=='string'||!Number.isFinite(Date.parse(p.coletadoEm))||
      Date.parse(p.coletadoEm)>agora||agora-Date.parse(p.coletadoEm)>=86400_000)return false;
  // This is a conservative reading policy, not detection of a SPA or a missing
  // section. The rendered page may contain everything that the HTML omitted.
  return p.limitada===true||p.htmlInicial===true&&Number.isFinite(p.caracteresTextoVisivel)&&p.caracteresTextoVisivel<160;
}
const campo=(rotulo,valorSugerido=null,origem='a_confirmar')=>({rotulo,valorSugerido,origem});
function modelo(oferta,perfil,campos){
  return{natureza:'rascunho_editorial',campos:[campo('Oferta ou atividade',limpar(oferta.nome,120),'perfil_revisado'),...campos],
    limite:'Estrutura para preencher e revisar localmente. Campos desconhecidos ficam vazios; não modifica formulários nem envia pedidos.'};
}
function atividadeSocial(perfil,oferta){
  const atuacoes=Array.isArray(perfil.entendimento?.atuacoes)?perfil.entendimento.atuacoes:[];
  const atividade=atuacoes.find(a=>normal(a.nome)===normal(oferta.nome)&&['programa_social','participacao','captacao'].includes(a.tipo));
  if(atividade)return atividade.tipo;
  if(atuacoes.some(a=>a.tipo==='oferta'&&normal(a.nome)===normal(oferta.nome)))return null;
  const produtoExplicito=evidenciasDe(oferta).some(e=>/^jsonld\.Product\./.test(e.campo||''))||/\b(?:loja|venda|camisetas|produtos)\b/.test(normal(oferta.nome));
  return !produtoExplicito&&perfil.entendimento?.finalidade?.tipo==='social'?'participacao':null;
}
function jornada(perfil,oferta,fontes){
  const nome=normal(oferta.nome),papel=perfil.entendimento?.papel;
  const social=atividadeSocial(perfil,oferta);
  if(social==='participacao'&&conviteDeAgenciamento(nome)){
    const declaracao=fontes.find(e=>!e.recortado&&/\bagenciamento exclusivo para artistas\b/u.test(normal(e.trecho)));
    if(declaracao)return{tipo:'candidatura_para_agenciamento',categoria:'participacao',declaracao};
  }
  if(social)return{tipo:'participacao_social',categoria:'participacao',social,
    percurso:/\bvoluntari/.test(nome)?'voluntariado':social==='captacao'?/\b(?:doacao|doacoes|doe|donation|donate)\b/.test(nome)?'doacao':'apoio':social==='programa_social'?'beneficiario':'participacao'};
  if((papel==='intermediacao'||/\bagenciamento\b/.test(nome))&&/\b(?:artistas?|artists?|shows?|gospel|bandas?|bands?|atracoes|musicais)\b/.test(nome))return{tipo:'pedido_artistico',categoria:'contratacao'};
  if(condicaoVinculada(oferta,fontes))return{tipo:'comodidade_vinculada',categoria:'uso',condicao:condicaoVinculada(oferta,fontes)};
  if(/\b(?:hoteis|hotel|hospedagem|pousada|reserva de hospedagem)\b/.test(nome))return{tipo:'pedido_hospedagem',categoria:'contratacao'};
  if(/\bcompressores?\b/.test(nome))return{tipo:'especificacao_equipamento',categoria:'compra'};
  if(/\b(?:cursos?|courses?|formacao|treinamento|training|aulas?|classes|pos[ -]graduacao|mba)\b/.test(nome)||evidenciasDe(oferta).some(e=>/^jsonld\.Course\./.test(e.campo||'')))return{tipo:'ficha_inscricao',categoria:'contratacao'};
  if(/\b(?:restaurantes?|gastronomia|menu degustacao|reserva de mesa)\b/.test(nome))return{tipo:'reserva_restaurante',categoria:'contratacao'};
  if(papel==='produtos'||evidenciasDe(oferta).some(e=>/^jsonld\.Product\./.test(e.campo||'')))return{tipo:'ficha_compra',categoria:'compra'};
  // A software/artists reference elsewhere in the description can refer to a
  // customer, a partner or a negated offer. Only the reviewed activity's own
  // explicit wording determines these specialized draft fields.
  if(/\b(?:software|sistema|system|plataforma|platform|crm|erp)\b/.test(nome)&&!/\b(?:consultoria|consulting|implantacao|implementacao|implementation|engenharia|engineering|desenvolvimento|development|projetos?|equipes?|squads?)\b/.test(nome))return{tipo:'avaliacao_sistema',categoria:'contratacao'};
  if(/\bassinatura\b/.test(nome)&&!/\b(?:digital|eletronica|documentos|contratos)\b/.test(nome))return{tipo:'ficha_assinatura',categoria:'contratacao'};
  return{tipo:papel==='intermediacao'?'pedido_intermediacao':'escopo_servico',categoria:'contratacao'};
}
function rascunhoDaJornada(j,oferta,perfil){
  const publico=limpar(perfil.publico,500)||null,regioes=Array.isArray(perfil.regioes)&&perfil.regioes.length?perfil.regioes.map(v=>limpar(v,100)).join('; '):null;
  const dado=(rotulo,valor)=>campo(rotulo,valor,valor===null?'a_confirmar':'declaracao_usuario');
  if(j.tipo==='candidatura_para_agenciamento')return modelo(oferta,perfil,[
    {...campo('Agenciamento descrito na página',j.declaracao.trecho,'trecho_publicado'),evidencia:j.declaracao},
    campo('Perfis de artistas e requisitos declarados para se candidatar'),
    campo('Dados ou materiais solicitados no primeiro contato'),
    campo('Canal de candidatura e etapa de avaliação pela agência'),
    campo('Como o artista recebe retorno sobre a candidatura'),
  ]);
  if(j.tipo==='participacao_social'){
    const campos=j.percurso==='doacao'?[campo('Modalidades de doação realmente declaradas'),campo('Finalidade do recurso declarada'),campo('Canal institucional para conferir como doar'),campo('Como confirmar o encaminhamento e consultar transparência e atendimento')]
      :j.percurso==='apoio'?[campo('Modalidades de apoio realmente declaradas'),campo('Finalidade e destinatário do apoio'),campo('Canal institucional para encaminhar apoio'),campo('Como confirmar o encaminhamento e esclarecer dúvidas')]
      :j.percurso==='voluntariado'?[campo('Atividades de voluntariado declaradas'),campo('Requisitos e disponibilidade solicitada'),campo('Território ou formato de participação'),campo('Etapas de inscrição e orientação pela equipe')]
        :[campo('Quem pode participar ou receber apoio'),campo('Região ou forma de participação'),campo('Requisitos e critérios de elegibilidade declarados'),campo('Etapas para participar ou pedir encaminhamento'),campo('Custo ou gratuidade, se declarados'),campo('Canal responsável e confirmação do encaminhamento')];
    // An organization may address recipients, donors, volunteers and buyers.
    // Its global audience/territory does not assign any of those roles, or
    // establish access to this activity. Linked publications remain quoted
    // separately by ancorarFicha, without filling an eligibility conclusion.
    return {...modelo(oferta,perfil,campos),limite:'A audiência e a região gerais da organização não confirmam quem pode acessar esta atividade, seu território ou o papel de cada pessoa. Confira o vínculo específico com o responsável; trechos operacionais publicados ficam separados de elegibilidade confirmada. Campos sem esse vínculo permanecem desconhecidos. Não altera o site nem envia pedidos.'};
  }
  if(j.tipo==='pedido_artistico')return modelo(oferta,perfil,[campo('Artista ou atração desejada'),campo('Data ou período do evento'),campo('Local e formato do evento'),dado('Quem solicita e qual a finalidade',publico),campo('Condições necessárias para consultar disponibilidade'),campo('Próximo passo para retorno da equipe')]);
  if(j.tipo==='pedido_hospedagem')return modelo(oferta,perfil,[campo('Destino ou unidade de hospedagem'),campo('Datas de entrada e saída'),campo('Quantidade e perfil dos hóspedes'),campo('Condições e categoria de acomodação declaradas'),campo('Disponibilidade, tarifas e regras a confirmar no canal oficial'),campo('Próximo passo de reserva, sem efetuar contratação durante a conferência')]);
  if(j.tipo==='reserva_restaurante')return modelo(oferta,perfil,[campo('Restaurante ou unidade desejada'),campo('Data, horário e quantidade de pessoas'),campo('Menu e condições de atendimento publicados'),campo('Canal oficial e confirmação necessária para a reserva')]);
  if(j.tipo==='comodidade_vinculada')return modelo(oferta,perfil,[{...campo('Condição publicada da comodidade',j.condicao.trecho,'trecho_publicado'),evidencia:j.condicao},campo('Atividade principal e público aos quais a condição se aplica'),campo('Disponibilidade e encaminhamento no canal responsável')]);
  if(j.tipo==='especificacao_equipamento')return modelo(oferta,perfil,[campo('Aplicação e ambiente de uso'),campo('Requisitos técnicos a confirmar com responsável'),campo('Especificação do modelo na ficha técnica'),campo('Condições de instalação e uso declaradas'),campo('Canal para orientação técnica e próximo passo')]);
  if(j.tipo==='ficha_compra')return modelo(oferta,perfil,[campo('Especificação ou variante do produto'),campo('Quantidade ou necessidade de uso'),dado('Região de entrega ou retirada',regioes),campo('Condições de entrega e troca'),campo('Disponibilidade e próximo passo de compra')]);
  if(j.tipo==='avaliacao_sistema')return modelo(oferta,perfil,[campo('Processo ou tarefa que a pessoa precisa resolver'),dado('Perfil de equipe ou usuário atendido',publico),campo('Exemplo de uso a conferir'),campo('Requisitos e limites informados pela oferta'),campo('Forma de avaliação ou demonstração, se disponível'),campo('Próximo passo informado pelo fornecedor')]);
  if(j.tipo==='ficha_inscricao')return modelo(oferta,perfil,[campo('Conteúdo e objetivo da formação'),dado('Público e pré-requisitos',publico),campo('Formato, acesso e duração declarados'),campo('Condições e próximo passo de inscrição')]);
  if(j.tipo==='ficha_assinatura')return modelo(oferta,perfil,[campo('Conteúdo ou acesso incluído na assinatura'),dado('Público e necessidade atendida',publico),campo('Modalidades e condições realmente declaradas'),campo('Como esclarecer dúvidas de adesão, acesso e cancelamento'),campo('Canal oficial para o próximo passo de adesão')]);
  return modelo(oferta,perfil,[campo(/\bequipamentos?\b/.test(normal(oferta.nome))?'Equipamento e escopo do atendimento':'Escopo e objeto do serviço'),dado('Público atendido',publico),dado('Região ou formato de atendimento',regioes),campo('Informações necessárias para avaliar a solicitação'),campo('Condições e próximo passo para obter resposta')]);
}
function ancorarFicha(j,oferta,ficha,fontes){
  const fontesUnicas=[...new Map(fontes.map(e=>[JSON.stringify([e.url,e.campo,e.trecho,e.sha256]),e])).values()];
  const comparaveis=j.tipo==='ficha_inscricao'||j.tipo==='ficha_assinatura';
  const especifica=evidenciasDe(oferta).some(e=>/^jsonld\.Course\./.test(e.campo||''))||
    fontesUnicas.some(e=>/^h[2-4]$/.test(e.campo)&&normal(e.trecho)===normal(oferta.nome));
  const ampla=comparaveis&&!especifica;
  const relevantes=fontesUnicas.filter(e=>(['p','li','meta.description'].includes(e.campo)||/^h[2-4]$/.test(e.campo))&&
    // Same URL is a page context, not proof that a picnic condition applies to
    // a cooking class. Broad education catalogs may compare named pathways;
    // specific activities keep only their own explicit reading context.
    (ampla||ligadoAOferta(e,oferta)||j.tipo==='pedido_hospedagem'&&/\b(?:hotel|hoteis|hospedagem|hospedes)\b/.test(normal(e.trecho))));
  const nominal=v=>/\b(?:trilhas?|formacao|cursos?|mba|pos[ -]graduacao|assinatura|planos?)\b/.test(normal(v))&&
    !/[?]/.test(v)&&!/^\s*\d+[ .]/.test(v)&&! /\b(?:tem|tenha|conheca|encontre|precisam|precisa|aprenda|aprender|seu|sua|nosso|nossa|quem|cada|melhor|melhores|impactamos)\b/.test(normal(v))&&
    !/^(?:como|o que|para|beneficios|nossos|nossas|alguns|todos)\b/.test(normal(v))&&v.length<=120;
  const porNome=new Map();
  if(ampla)for(const e of relevantes){
    const nome=nominal(e.secao||'')?e.secao:/^h[2-4]$/.test(e.campo)&&nominal(e.trecho)?e.trecho:null;
    if(!nome||e.recortado)continue;
    const atual=porNome.get(normal(nome));
    if(!atual||/^h/.test(atual.fonte.campo)&&!/^h/.test(e.campo))porNome.set(normal(nome),{nome,fonte:e});
  }
  const todasOpcoes=[...porNome.values()].slice(0,3),opcoes=todasOpcoes.length>1?todasOpcoes:[];
  const facetas=j.tipo==='ficha_inscricao'||j.tipo==='ficha_assinatura'
    ?[['Público ou objetivo publicado',/\b(?:para (?:quem|profissionais|executivos|lideres|pessoas)|destinad[oa]s? a|voltad[oa]s? a|aprenda|aprender|avance|desenvolva|objetivo|pre[ -]requisito)\b/],['Formato ou acesso publicado',/\b(?:online|on[ -]line|presencial|ao vivo|gravado|streaming|acesso|duracao|encontros)\b/]]
    :j.tipo==='pedido_hospedagem'?[['Unidade ou destino publicado',/\b(?:hotel|hoteis|hospedagem|hospedes|pousada)\b/],['Encaminhamento ou condição publicada',/\b(?:reserva|reservas|check[ -]in|check[ -]out|diaria|concierge|disponibilidade)\b/]]
      :j.tipo==='especificacao_equipamento'?[['Aplicações publicadas',/\b(?:residencial|industrial|profissional|aplicacao|aplicacoes)\b/],['Especificação ou encaminhamento publicado',/\b(?:pressao|vazao|potencia|modelo|catalogo|ficha tecnica|assistencia)\b/]]
        :j.tipo==='participacao_social'?[['Público ou finalidade publicada',/\b(?:beneficiarios|criancas|jovens|educadores|professores|estudantes|participantes|familias|comunidades)\b/],['Participação ou apoio publicado',/\b(?:doacao|doacoes|apoio|apoiar|voluntari|participar|inscricao|elegibilidade|redes de ensino|secretarias)\b/]]
          :j.tipo==='reserva_restaurante'?[['Local ou modalidade publicados',/\b(?:restaurante|gastronomia|menu|jantar|almoco)\b/],['Condição de atendimento publicada',/\b(?:reserva|pessoas|horario|mesa|atendimento)\b/]]
            :j.tipo==='avaliacao_sistema'?[['Processo ou público publicado',/\b(?:equipe|empresas|processo|estoque|financeiro|vendas|atendimento|gestao)\b/],['Uso ou avaliação publicada',/\b(?:demonstracao|teste|integracao|automatiza|requisito|plano|funcionalidade)\b/]]
              :j.tipo==='pedido_artistico'?[['Atividade ou público publicado',/\b(?:artistas?|shows?|eventos?|contratantes|igrejas)\b/],['Condição ou encaminhamento publicado',/\b(?:disponibilidade|agenda|solicitacao|contratacao|evento|agenciamento)\b/]]
                :[['Escopo ou público publicado',/\b(?:oferecemos|atuamos|prestamos|somos|para (?:quem|empresas|pessoas)|atendemos|destinado)\b/]];
  const escolhidos=[];
  for(const [rotulo,padrao] of facetas){
    const candidatos=relevantes.filter(e=>!/^h/.test(e.campo)&&padrao.test(normal(e.trecho))&&
      // A number/percentage-only promotional claim is not an operational
      // condition or a verified financial result.
      !/\b(?:aprovacao|avaliacao 5 estrelas|milhoes de alunos|roi|lucro garantido)\b/.test(normal(e.trecho)));
    candidatos.sort((a,b)=>Number(ligadoAOferta(b,oferta))-Number(ligadoAOferta(a,oferta)));
    const candidata=candidatos.find(c=>!escolhidos.some(e=>e.fonte?.trecho===c.trecho));
    if(candidata)escolhidos.push({rotulo,fonte:candidata});
  }
  if(opcoes.length>1)escolhidos.unshift(...opcoes.map(o=>({rotulo:'Trecho para conferir na seção “'+o.nome+'”',fonte:o.fonte})));
  if(j.tipo==='comodidade_vinculada'&&!escolhidos.some(e=>e.fonte?.trecho===j.condicao.trecho))escolhidos.unshift({rotulo:'Condição da atividade publicada',fonte:j.condicao});
  const campos=escolhidos.map(e=>({...campo(e.rotulo,e.fontes?e.fontes.map(f=>f.trecho).join(' / '):e.fonte.trecho,'trecho_publicado'),
    ...(e.fontes?{evidencias:e.fontes}:{evidencia:e.fonte})}));
  const usadas=escolhidos.flatMap(e=>e.fontes||[e.fonte]);
  return{ficha:campos.length?{...ficha,campos:[ficha.campos[0],...campos,...ficha.campos.slice(1)],
    limite:'Trechos publicados são autodeclarações do site, não validação independente. A seção é contexto de leitura; não atribua automaticamente um público ou formato a outra modalidade. Campos sem fonte permanecem desconhecidos. Não altera o site nem envia solicitações.'+(j.tipo==='participacao_social'?' '+ficha.limite:'')}:ficha,
    usadas,opcoes,concreto:escolhidos.length>0};
}
function percursoDaAtividade(j,nome){
  const caminhos={pedido_artistico:'escolher a atração e entender quais informações do evento encaminhar à equipe',
    pedido_hospedagem:'distinguir a unidade de hospedagem, as datas e os hóspedes antes de acessar o canal oficial de reserva',
    reserva_restaurante:'distinguir o restaurante e a unidade, consultar o atendimento e encontrar o canal oficial de reserva de mesa',
    especificacao_equipamento:'conferir a aplicação desejada, localizar a ficha técnica do modelo e saber onde pedir orientação técnica',
    ficha_compra:'conferir a variante e as condições publicadas do produto antes do próximo passo de compra',
    avaliacao_sistema:'comparar a tarefa que a equipe quer resolver com as funções e as condições de avaliação publicadas',
    ficha_inscricao:'distinguir o objetivo, o público e o formato da formação antes de localizar a inscrição',
    ficha_assinatura:'distinguir os conteúdos incluídos e as condições de acesso antes de localizar a adesão',
    comodidade_vinculada:'entender a condição de cortesia e o vínculo com a atividade principal, sem presumir contratação separada',
    pedido_intermediacao:'entender o objeto da intermediação e quais dados são necessários para receber orientação',
    escopo_servico:'entender o escopo desta atividade e localizar o próximo passo informado pela equipe'};
  return j.tipo==='participacao_social'?{doacao:'entender as modalidades de doação declaradas e localizar o canal institucional de dúvidas',apoio:'entender como encaminhar apoio institucional e conferir sua finalidade',voluntariado:'entender os requisitos e localizar a orientação de voluntariado',beneficiario:'entender quem pode acessar o programa e localizar o encaminhamento indicado',participacao:'entender como participar e localizar o encaminhamento indicado'}[j.percurso]||'entender a atividade e como participar':caminhos[j.tipo]||'entender “'+nome+'” e seu próximo passo';
}
function verificacaoDoConteudo(j,fontes){
  const trecho=fontes.map(e=>normal(e.trecho)).join(' ');
  if(j.tipo==='ficha_inscricao'&&/\bao vivo\b/.test(trecho)&&/\bgravadas?\b/.test(trecho))return{
    titulo:'Conferir a distinção entre aulas ao vivo e gravadas',
    passo:'Teste especificamente se a pessoa distingue os encontros ao vivo do conteúdo gravado e encontra como conferir a agenda antes da inscrição. Registre quais informações permitem conciliar essas duas formas de aula com a rotina; não prometa horários ou flexibilidade que a fonte não declara.',
    entrega:'Registro da distinção entre aulas ao vivo e conteúdo gravado, do caminho para conferir a agenda e das dúvidas que precisam da escola.'};
  if(j.tipo==='participacao_social'&&j.percurso==='beneficiario'&&/\b(?:professores|gestores|redes de ensino|secretarias)\b/.test(trecho))return{
    titulo:'Conferir o encaminhamento institucional e a participação',
    passo:'Separe o encaminhamento institucional de educadores, gestores ou redes de ensino do percurso das pessoas beneficiadas pelo programa. Confira no canal indicado se o acesso depende da rede ou de uma parceria, ou se existe participação individual; não presuma matrícula direta, custo ou gratuidade.',
    entrega:'Mapa de encaminhamento institucional e de participação: público referido no texto, canal a conferir e dúvidas sobre acesso, sem presumir inscrição individual.'};
  if(j.tipo==='especificacao_equipamento'){
    const aplicacoes=['residencial','profissional','industrial'].filter(t=>new RegExp('\\b'+t+'\\b').test(trecho));
    if(aplicacoes.length>1)return{passo:'Compare as aplicações '+aplicacoes.join(', ')+' mencionadas no conteúdo publicado. Para cada uma, localize a ficha técnica e os requisitos indicados; registre a dúvida para o canal técnico em vez de escolher potência, pressão ou modelo sem os dados de uso.',
      titulo:'Comparar aplicações publicadas e fichas técnicas',
      entrega:'Quadro das aplicações publicadas e das fichas técnicas encontradas, com os requisitos ainda necessários para orientar uma escolha.'};
  }
  if(j.tipo==='avaliacao_sistema'&&/\b(?:demonstracao|teste gratuito|experimente)\b/.test(trecho))return{
    titulo:'Conferir o processo anunciado e o caminho de demonstração',
    passo:'Use o exemplo de processo publicado para conferir o caminho de avaliação ou demonstração anunciado. Registre o que será mostrado, quais requisitos a equipe precisa esclarecer e como pedir orientação, sem criar conta nem enviar dados reais durante a conferência.',
    entrega:'Registro do processo anunciado, do caminho de demonstração e dos requisitos que precisam ser esclarecidos antes de uma avaliação real.'};
  return null;
}
function nomesNaPaginaDeContato(j,pagina,detalhes){
  if(j.tipo!=='pedido_hospedagem'||!pagina)return[];
  let contato=false;try{contato=/\/(?:contato|contact|contacts)\/?$/.test(new URL(pagina.url).pathname);}catch{return[];}
  if(!contato)return[];
  return detalhes.filter(e=>e.campo==='h3'&&e.trecho.length>=5&&e.trecho.length<=100&&
    !/[?]/.test(e.trecho)&&! /^(?:coming soon|contato|contact|endere[cç]o|eventos?|mais informa[cç][oõ]es|newsletter)$/i.test(e.trecho)).slice(0,3);
}
function metadados(teste,categoria,lacuna,entregavel,{nivel='revisao_de_conteudo',motivo='Exige conferir e registrar informações, antes de propor alterações técnicas.'}={}){
  return{...teste,categoria,lacuna,entregavel,
    esforco:{nivel,natureza:'estimativa_editorial',motivo},
    priorizacao:{criterios:[...(teste.priorizacao?.criterios||[]),{criterio:'base_da_tarefa',valor:teste.base==='observacao'?'achado_registrado':'conferencia_proposta'},
      {criterio:'execucao_local',valor:'sem_servico_pago'}],limite:'Ordem editorial de trabalho. Não estima retorno, dificuldade de SEO ou probabilidade de resultado.'}};
}

/** Enriches an existing decision with an executable business-specific draft.
 * Only literal/public evidence and user-reviewed business fields may prefill it.
 * It does not diagnose sections missing from rendered pages or predict ranking.
 */
export function especificarTesteNegocio({teste,perfil,oferta,pagina,contextoPublico,melhoria,candidato}={}, {agora=Date.now}={}){
  if(!teste||!oferta)return teste;
  const instante=agora(),nome=limpar(oferta.nome,120),fontes=fontesDoNegocio(perfil,oferta,pagina,contextoPublico,instante),
    detalhes=detalhesDoNegocio(perfil,pagina,contextoPublico,instante);
  const dependencias=[{tipo:'perfil_revisado',estado:perfil.estado==='confirmado'?'disponivel':'pendente',descricao:'Revisão da oferta e da finalidade por quem conhece o negócio.'}];
  if(pagina)dependencias.push({tipo:'pagina_da_atividade',estado:pagina.origem==='observada'?'disponivel':'pendente',descricao:'Conferir a URL relacionada à oferta; a leitura automática não executa o atendimento.'});
  else dependencias.push({tipo:'pagina_da_atividade',estado:'pendente',descricao:'Vincular uma página existente à atividade. A ficha pode ser preparada localmente antes dessa vinculação.'});
  const social=atividadeSocial(perfil,oferta);
  dependencias.push({tipo:'publico_atendido',estado:!social&&limpar(perfil.publico)?'disponivel':'pendente',descricao:social?
    'Esclarecer quem participa, recebe, apoia ou executa nesta atividade. A audiência global não confirma esses papéis nem critérios de acesso; publicações específicas continuam para revisão.':
    'Identificar quem procura esta atividade. O rascunho pode ser preparado com o campo desconhecido.'});
  const criterios=[{criterio:'atividade_revisada',valor:perfil.estado==='confirmado'?'perfil_confirmado':'rascunho',natureza:'estado_do_perfil'},
    {criterio:'importancia_no_negocio',valor:['principal','complementar'].includes(oferta.centralidade?.nivel)?oferta.centralidade.nivel:'indefinida',
      natureza:oferta.centralidade?.natureza==='declaracao_usuario'?'declaracao_usuario':'hipotese'},
    {criterio:'declaracao_publicada_atual',valor:fontes.length||detalhes.length?'disponivel':'nao_identificada_nesta_pagina',natureza:'observacao'},
    {criterio:'intencao_da_busca',valor:candidato?.intencao||'nao_classificada',natureza:'hipotese'},
    {criterio:'retorno_comercial',valor:'nao_medido',natureza:'limite'}];
  const comuns={...teste,dependencias,evidenciasNegocio:fontes,priorizacao:{criterios}};
  if(melhoria){
    const publicacao=melhoria.verificacaoId.startsWith('diretiva-noindex-'),editorial=['titulo-pagina','titulo-principal','alternativas-imagens'].includes(melhoria.verificacaoId);
    if(!publicacao&&leituraFraca(perfil,pagina,contextoPublico,instante))return metadados({...comuns,base:'hipotese',
      titulo:'Conferir no navegador: '+limpar(melhoria.titulo,160),
      acao:'O recorte do HTML inicial registrou “'+limpar(melhoria.evidencia,350)+'”, mas a leitura é pequena ou limitada. Confira o elemento na experiência renderizada desta URL antes de considerar uma edição.',
      passos:['Abra a URL no navegador local e aguarde o conteúdo visível.',
        'Confira especificamente o ponto de “'+limpar(melhoria.titulo,160)+'” na página renderizada. Registre se a condição do HTML inicial também ocorre no uso.',
        'Se o conteúdo ou controle já estiver adequado, preserve-o e registre a diferença da coleta. Só proponha alteração se a dificuldade for confirmada.'],
      criterioSucesso:'O registro distingue o achado no HTML inicial da condição observada no navegador; a coleta limitada não vira diagnóstico de falta de conteúdo no site.',
      comoValidar:'Confronte a evidência inicial com o elemento visível na mesma URL. Esta conferência não identifica a causa do ranking nem mede retorno.'},
      'verificabilidade',{natureza:'evidencia_insuficiente',descricao:'Há um sinal no HTML inicial, mas a amostra não confirma a condição da experiência renderizada.'},
      'Registro da presença e do uso do elemento na página renderizada, relacionado ao achado inicial.',
      {nivel:'conferencia_com_responsavel',motivo:'É necessário observar a página antes de decidir se existe uma alteração a fazer.'});
    const j=jornada(perfil,oferta,[...detalhes,...fontes]),ancorada=ancorarFicha(j,oferta,rascunhoDaJornada(j,oferta,perfil),[...detalhes,...fontes]),percurso=percursoDaAtividade(j,nome);
    const citacao=ancorada.usadas[0]?.trecho;
    const extras=publicacao?{}:{
      acao:'O HTML inicial registrou “'+limpar(melhoria.evidencia,300)+'”. Confira esse ponto no percurso de “'+nome+'”: '+percurso+'. O achado não identifica a causa de uma posição no Google.',
      passos:[...(citacao?['Use como referência o trecho já publicado nesta URL: “'+limpar(citacao,300)+'”. Confira sua relação com a atividade antes de reutilizar a condição.']:[]),
        'Na página visível, tente '+percurso+'. Registre o elemento e a dúvida encontrados; não envie um pedido real nem efetue contratação.',
        ...(melhoria.verificacaoId==='titulo-principal'||melhoria.verificacaoId==='titulo-pagina'?[
          'Confronte a abertura e o título da página com esse percurso. Se o conteúdo já estiver claro no navegador, registre a diferença do HTML inicial; só prepare um texto de apoio ou ajuste da marcação quando a necessidade for confirmada.']:
          melhoria.verificacaoId==='rotulos-formulario'?['Confira especificamente os campos e botões encontrados nesse percurso, incluindo os controles com ícones. Registre quais nomes descrevem o propósito; um total de controles sem nome no HTML não prova que todos pertençam a este encaminhamento.']:
            melhoria.verificacaoId==='alternativas-imagens'?['Confira as imagens presentes nesse percurso: registre quais são decorativas e quais comunicam informação necessária à escolha. Só proponha uma alternativa textual depois de identificar a função da imagem.']:
              ['Confronte o elemento observado no percurso com a verificação inicial antes de decidir se há um ajuste a fazer.']),
        'Se um ajuste for necessário, registre a alteração localizada e repita a verificação da mesma URL. Preserve o conteúdo adequado; esta conferência não mede ganho de ranking ou resultado comercial.'],
      criterioSucesso:'O registro identifica o elemento da mesma URL e sua função no percurso de “'+nome+'”, separando o achado do HTML inicial da experiência visível. Uma eventual alteração é conferida com a mesma verificação. Este registro não mede ganho de ranking ou vendas.',
      evidenciasNegocio:[...new Map([...ancorada.usadas,...fontes.filter(e=>ligadoAOferta(e,oferta))].map(e=>[JSON.stringify([e.url,e.campo,e.trecho,e.sha256]),e])).values()].slice(0,8),
    };
    const especifico={...comuns,...extras,titulo:limpar(melhoria.titulo,160)+' — '+nome};
    return metadados(especifico,publicacao?'publicacao':editorial?'conteudo':'acessibilidade',
      {natureza:'observada',descricao:limpar(melhoria.evidencia),url:melhoria.paginaAlvo,sha256:melhoria.sha256Pagina,coletadoEm:melhoria.coletadoEm},
      publicacao?'Decisão registrada sobre a intenção de publicação desta URL.':'Registro da conferência de “'+limpar(melhoria.titulo,160)+'” na mesma URL, antes e depois de eventual ajuste.',
      {nivel:publicacao?'conferencia_com_responsavel':editorial?'revisao_de_conteudo':'ajuste_tecnico',motivo:publicacao?'A intenção da exclusão precisa ser confirmada antes de editar.':'O esforço depende da ferramenta de edição e da conferência do achado; não foi estimado em horas ou dinheiro.'});
  }
  if(!['conferir_oferta','revisar_pagina'].includes(teste.tipo))return metadados(comuns,teste.tipo==='validar_economia'?'dados':'verificabilidade',
    {natureza:'hipotese',descricao:'Esta etapa resolve uma informação necessária antes de decidir sobre a oferta; não é um defeito constatado na página.'},
    'Registro da conferência de “'+nome+'”, com origem das informações e decisão do próximo passo.');
  if(perfil.entendimento?.qualidade?.estado==='conflitante')return metadados({...comuns,
    titulo:'Resolver as declarações conflitantes sobre “'+nome+'”',
    acao:'Confira com o responsável qual atividade, público e finalidade correspondem a esta oferta antes de adaptar o conteúdo ou a jornada.',
    passos:['Compare as declarações registradas no perfil e suas fontes, sem escolher automaticamente a que parece mais comercial.',
      'Registre a explicação do responsável e corrija o perfil. Preserve como desconhecido o que não puder ser confirmado.'],
    criterioSucesso:'O conflito foi esclarecido por quem conhece o negócio ou permanece identificado como pendência; não há uma jornada de venda presumida.',
    comoValidar:'A correção deve apontar a declaração ou confirmação usada. Ela orienta a análise local e não treina pesos automaticamente.'},
    'verificabilidade',{natureza:'evidencia_insuficiente',descricao:'O entendimento do negócio registra declarações conflitantes; a finalidade da tarefa ainda precisa ser confirmada.'},
    'Registro da resolução ou manutenção explícita do conflito do perfil.',{nivel:'conferencia_com_responsavel',motivo:'Exige esclarecer a atividade antes de especificar o processo.'});
  if(leituraFraca(perfil,pagina,contextoPublico,instante)){
    return metadados({...comuns,titulo:'Conferir o conteúdo renderizado de “'+nome+'”',
      acao:'A amostra do HTML inicial é pequena ou limitada. Abra a URL e confira o conteúdo que o navegador mostra antes de propor uma edição para esta oferta.',
      passos:['Abra a página relacionada a “'+nome+'” no navegador local e aguarde o conteúdo visível.',
        'Registre o que a pessoa vê sobre a oferta e o próximo passo, separando o que aparece após scripts do que está no HTML coletado.',
        'Só proponha uma mudança depois dessa conferência; se o conteúdo já atende à necessidade, registre isso e preserve-o.'],
      criterioSucesso:'Há um registro da experiência renderizada desta URL. A limitação da coleta não é confundida com ausência de conteúdo no site.',
      comoValidar:'Compare a experiência visível com os trechos coletados. Não conclua que o site é uma SPA ou que falta uma seção apenas com esta amostra.'},
      'verificabilidade',{natureza:'evidencia_insuficiente',descricao:'O recorte de HTML inicial não basta para avaliar a experiência renderizada desta oferta.'},
      'Registro local do conteúdo renderizado e da cobertura da leitura para esta URL.',{nivel:'conferencia_com_responsavel',motivo:'Depende de observar a página visível, sem alterar o site nem enviar pedidos.'});
  }
  const j=jornada(perfil,oferta,[...detalhes,...fontes]),ancorada=ancorarFicha(j,oferta,rascunhoDaJornada(j,oferta,perfil),[...detalhes,...fontes]),ficha=ancorada.ficha;
  const nomesContato=nomesNaPaginaDeContato(j,pagina,detalhes);
  if(nomesContato.length){
    const nomes=nomesContato.map(e=>'“'+e.trecho+'”').join(', '),urlContato=new URL(pagina.url).pathname;
    return metadados({...comuns,titulo:'Conferir o caminho dos contatos à reserva de “'+nome+'”',
      acao:'A URL relacionada usa o caminho '+urlContato+' e publica nomes como '+nomes+'. Confira como a pessoa identifica a unidade e o canal correto antes de continuar a reserva. Não presume que uma lista de contatos mostre disponibilidade ou tarifas.',
      passos:['Use estes nomes realmente publicados como pontos de partida: '+nomes+'. A lista é um recorte; confira na página quais correspondem à unidade desejada e seu canal.',
        'Escolha uma necessidade de hospedagem e confira se a pessoa distingue a unidade, datas e hóspedes antes de seguir o canal oficial. Registre onde ela consegue consultar disponibilidade e regras, sem inventá-las nem efetuar reserva.',
        'Confronte o canal escolhido com a unidade desejada. Registre se o encaminhamento atende à reserva ou se é preciso outro caminho informado pelo próprio site; não substitua contato por um formulário novo sem necessidade confirmada.',
        'Se a pessoa se confundir entre unidades ou canais, prepare apenas o ajuste de indicação que resolva a dúvida observada. Se o encaminhamento já estiver claro, registre isso e preserve-o.'],
      modeloEntregavel:{...ficha,campos:[ficha.campos[0],...nomesContato.map(e=>({...campo('Nome publicado para conferir unidade e canal',e.trecho,'trecho_publicado'),evidencia:e})),...ficha.campos.slice(1)]},
      evidenciasNegocio:[...nomesContato,...fontes.filter(e=>ligadoAOferta(e,oferta))].slice(0,8),
      experimento:{tipo:j.tipo,percurso:'contatos_para_reserva',ofertaId:oferta.id||null,url:pagina.url,objetivo:'Conferir a associação entre unidade, canal e próximo passo de reserva na página existente.'},
      criterioSucesso:'O registro liga o nome conferido à unidade e ao canal oficial encontrado, distinguindo contato, disponibilidade e confirmação de reserva. Dúvidas reais orientam eventual ajuste; não há reserva ou resultado comercial presumido.',
      comoValidar:'Compare o nome e o canal na mesma URL e confira o encaminhamento no navegador, sem contratar hospedagem ou preencher dados pessoais.'},
      'contratacao',{natureza:'hipotese',descricao:'Há nomes publicados na URL de contato. A clareza da associação entre unidade, canal e reserva ainda precisa de conferência no uso.'},
      'Mapa dos nomes e canais conferidos para a unidade de hospedagem, com o próximo passo de reserva e as dúvidas encontradas.');
  }
  const testeConteudo=verificacaoDoConteudo(j,ancorada.usadas);
  const rotulos={pedido_artistico:'pedido de contratação artística',pedido_hospedagem:'conferência de hospedagem e reserva',reserva_restaurante:'escolha do restaurante e reserva de mesa',comodidade_vinculada:'conferência de uma comodidade vinculada',especificacao_equipamento:'comparação da aplicação e ficha técnica',ficha_compra:'comparação e encaminhamento da compra',avaliacao_sistema:'avaliação do sistema',ficha_inscricao:'decisão de inscrição',ficha_assinatura:'conferência de acesso e adesão',participacao_social:'participação ou apoio',pedido_intermediacao:'encaminhamento da intermediação',escopo_servico:'solicitação do serviço'};
  const finalidade=j.tipo==='participacao_social'?{doacao:'conferência das informações de doação',apoio:'encaminhamento do apoio institucional',voluntariado:'inscrição e orientação de voluntariado',beneficiario:'acesso ao programa social',participacao:'participação na atividade'}[j.percurso]:j.tipo==='candidatura_para_agenciamento'?'candidatura ao agenciamento':rotulos[j.tipo];
  const citacoes=ancorada.usadas.slice(0,3).map(e=>'“'+limpar(e.trecho,260)+'”').join('; ');
  const opcoes=ancorada.opcoes.map(e=>'“'+e.nome+'”').join(', ');
  const passos=[ancorada.concreto?'Parta do que esta URL já publica: '+citacoes+'. Preserve cada condição e sua origem; sem presumir que os demais campos estejam ausentes no site.':'Use a página relacionada a “'+nome+'” e preencha a ficha apenas com condições publicadas ou confirmadas, sem presumir que os campos estejam ausentes no site. Mantenha desconhecidos os campos sem informação.',
    opcoes?'Compare os trechos coletados junto às seções '+opcoes+' na mesma página: confira no uso visível a associação correta entre cada trajetória, seu objetivo, público e formato. A última seção lida é um contexto de coleta, não prova sozinha a associação. Não copie condições entre opções.':j.tipo==='comodidade_vinculada'?'Confira como a condição de cortesia se relaciona à atividade principal e a quem pode utilizar “'+nome+'”. Não trate a comodidade como venda ou contratação avulsa sem uma declaração adicional que comprove isso.':testeConteudo?.passo||'Confira os campos de '+finalidade+': '+ficha.campos.slice(1).filter(c=>c.origem!=='trecho_publicado').map(c=>c.rotulo).join('; ')+'.',
    j.tipo==='participacao_social'?'Primeiro esclareça o vínculo e o papel da pessoa nesta atividade; doador, apoiador, voluntário, comprador e destinatário podem ter caminhos diferentes. Depois, peça a alguém desse percurso para localizar as respostas e o próximo passo. Não envie dados, pedido ou inscrição real.':'Peça a uma pessoa do público para localizar essas respostas e o próximo passo na página. Registre onde ela teve dúvida; não envie um pedido real nem faça compra durante a conferência.',
    'Se uma dúvida for confirmada, prepare uma alteração localizada no conteúdo ou no caminho de encaminhamento. Se as respostas já estiverem claras, registre a conferência e preserve a página.'];
  return metadados({...comuns,titulo:(opcoes?'Comparar as trajetórias publicadas':j.tipo==='comodidade_vinculada'?'Conferir a condição de cortesia':testeConteudo?.titulo||'Preparar a ficha de '+finalidade)+' de “'+nome+'”',
    acao:opcoes?'Confira a diferença entre '+opcoes+' que esta URL já apresenta. Use as condições e públicos publicados para testar se a pessoa consegue escolher a trajetória adequada ao seu objetivo, antes de sugerir qualquer alteração.':j.tipo==='comodidade_vinculada'?'A página descreve uma condição de cortesia relacionada a “'+nome+'”. Confira seu vínculo e encaminhamento na atividade principal; isso não comprova uma venda separada.':testeConteudo?'Use os trechos publicados de “'+nome+'” para esta conferência: '+testeConteudo.passo:'Converta as condições de “'+nome+'” em uma ficha de '+finalidade+' vinculada à URL. O objetivo é identificar uma dúvida concreta do público antes de propor edição; não pressupõe que a página tenha um defeito.',
    evidenciasNegocio:[...new Map([...ancorada.usadas,...fontes.filter(e=>ligadoAOferta(e,oferta))].map(e=>[JSON.stringify([e.url,e.campo,e.trecho,e.sha256]),e])).values()].slice(0,8),
    passos,modeloEntregavel:ficha,experimento:{tipo:j.tipo,percurso:j.percurso||null,ofertaId:oferta.id||null,url:pagina?.url||null,
      objetivo:opcoes?'Conferir a associação e as diferenças entre as trajetórias publicadas '+opcoes+'.':'Conferir se o público encontra informação suficiente para '+finalidade+'.'},
    criterioSucesso:opcoes?'A comparação distingue os trechos e condições de '+opcoes+', confere a associação na página visível e registra como a pessoa escolhe a trajetória e localiza o próximo passo. Condições sem suporte continuam desconhecidas; isso não mede vendas ou ranking.':j.tipo==='participacao_social'?'A ficha separa o trecho publicado, o papel específico ainda a esclarecer e o encaminhamento da atividade. A audiência global não confirma acesso, elegibilidade ou território. Campo sem vínculo fica desconhecido com a pergunta para o responsável, sem concluir que a pessoa é elegível ou inelegível. Só após esclarecer o percurso, confira a localização das respostas e do próximo passo; registre a dúvida antes de propor alteração.':'A ficha distingue condições confirmadas de campos desconhecidos, e uma pessoa consegue localizar as respostas e o próximo passo de “'+nome+'” na URL. Dúvidas e eventual alteração ficam registradas; não é uma meta inventada de vendas ou ranking.',
    comoValidar:'Confronte cada campo preenchido com sua origem e confira a experiência com uma pessoa do público. Uma edição só será proposta quando a dúvida for observada, sem atribuir causalidade de SEO.'},
    j.categoria,{natureza:'hipotese',descricao:ancorada.usadas.length||fontes.some(e=>ligadoAOferta(e,oferta))?'Há trechos atuais a conferir no contexto da atividade, mas a compreensão e o encaminhamento pelo público ainda não foram testados.':'A atividade foi revisada no perfil; falta conferir a experiência na URL. Nenhuma ausência de conteúdo foi constatada.'},
    opcoes?'Comparação de '+opcoes+', com trechos de origem, associação conferida na página e diferenças de objetivo, público e formato; campos sem suporte e dúvidas ficam registrados.':testeConteudo?.entrega||'Ficha de '+finalidade+' de “'+nome+'”, com condições confirmadas, campos desconhecidos e dúvidas registradas.');
}

function interacoesAtuais(perfil,pagina,contexto,agora){
  if(contexto?.versao!==1||contexto.dominio!==perfil.dominio||!Array.isArray(contexto.interacoesPublicas))return[];
  const paginas=Array.isArray(contexto.cobertura?.paginas)?contexto.cobertura.paginas:[];
  return contexto.interacoesPublicas.slice(0,48).filter(e=>['campo','botao','link'].includes(e?.tipo)&&
    e.natureza==='interface_publica'&&e.modo==='nao_preenchido'&&e.htmlInicial===true&&
    typeof e.rotulo==='string'&&e.rotulo.trim()&&e.rotulo.length<=120&&typeof e.grupoId==='string'&&
    ['formulario','busca','pagina'].includes(e.tipoGrupo)&&
    /^(?:label\.texto|legend\.texto|aria-label|aria-labelledby|button\.texto|a\.texto)$/.test(e.campo||'')&&
    fonteAtual({...e,trecho:e.rotulo},perfil.dominio,pagina?.url||null,agora)&&
    paginas.some(p=>p.url===e.url&&p.sha256===e.sha256&&p.coletadoEm===e.coletadoEm))
    .map(e=>({url:e.url,campo:e.campo,trecho:limpar(e.rotulo,120),coletadoEm:e.coletadoEm,sha256:e.sha256,
      tipo:'interface_publica',natureza:'rotulo_literal',modo:'nao_preenchido',htmlInicial:true,
      grupoId:e.grupoId,tipoGrupo:e.tipoGrupo,tipoControle:e.tipo,acao:e.acao,naturezaDaAcao:'classificacao_do_rotulo'}));
}
function contextoLiteralAtual(perfil,contexto,agora){
  if(contexto?.versao!==1||contexto.dominio!==perfil.dominio)return[];
  const ps=Array.isArray(contexto.cobertura?.paginas)?contexto.cobertura.paginas:[];
  return [...new Map([...(Array.isArray(contexto.evidencias)?contexto.evidencias.slice(0,24):[]),
    ...(Array.isArray(contexto.detalhesPublicados)?contexto.detalhesPublicados.slice(0,64):[])].filter(e=>fonteLiteral(e)&&fonteAtual(e,perfil.dominio,null,agora)&&
      ps.some(p=>p.url===e.url&&p.sha256===e.sha256&&p.coletadoEm===e.coletadoEm))
    .map(e=>[JSON.stringify([e.url,e.campo,e.trecho]),{url:e.url,campo:e.campo,trecho:limpar(e.trecho),
      coletadoEm:e.coletadoEm,sha256:e.sha256,tipo:'negocio_publicado',natureza:'trecho_literal',...(e.secao?{secao:limpar(e.secao,120)}:{})}])).values()];
}
const unificarFontes=fontes=>[...new Map(fontes.filter(Boolean).map(e=>[JSON.stringify([e.url,e.campo,e.trecho,e.sha256]),e])).values()].slice(0,32);
function construirDecisao({perfil,oferta,pagina,base,receita,fontes}){
  const fatos=unificarFontes(fontes).slice(0,12),nome=limpar(oferta.nome,120),limites=[
    'As condições e os rótulos foram observados no HTML inicial. Não comprovam funcionamento do fluxo, disponibilidade, procura ou resultado financeiro.',
    'A conferência usa um cenário fictício e não envia dados pessoais, pedido, reserva ou compra.',
    ...(receita.restricoes||[])];
  const paginas=[pagina,...fatos.map(e=>({url:e.url,origem:'observada',fonte:'site',coletadoEm:e.coletadoEm,sha256:e.sha256}))].filter(Boolean),
    relacionadas=[...new Map(paginas.map(p=>[p.url,p])).values()].slice(0,4);
  const decisoes={objeto:nome,objetos:[nome],objetivo:receita.objetivo,escolha:receita.escolha,percurso:receita.percurso,
    fatos:fatos.map(e=>({descricao:e.trecho,evidencias:[e]})),restricoes:limites,
    incertezas:receita.incertezas||['O funcionamento do percurso e a compreensão pelo cliente ainda precisam ser observados.',
      'Disponibilidade, responsabilidades e condições não publicadas permanecem desconhecidas.'],resultadoAConferir:receita.resultado,
    natureza:'hipotese_de_melhoria_de_uso',revisaoHumanaRequerida:true};
  if(receita.condicoesDeterminantes?.length)decisoes.condicoesDeterminantes=unificarFontes(receita.condicoesDeterminantes);
  return{...base,tipo:'conferir_oferta',eixo:'negocio',titulo:receita.titulo+' — '+nome,acao:receita.objetivo+' '+receita.escolha,
    base:'hipotese',categoria:receita.categoria||base.categoria||'decisao_do_cliente',
    passos:[...receita.passos,'Registre a escolha, a fonte que a sustentou e o ponto em que faltou informação. Proponha uma alteração localizada somente se a dúvida for observada; preserve o que já atende ao caso.'],
    entregavel:receita.entregavel,criterioSucesso:receita.resultado,
    comoValidar:'Confronte os fatos com as fontes e observe o percurso na mesma URL ou nas páginas explicitamente comparadas. '+receita.resultado,
    evidenciasNegocio:fatos,decisaoCliente:decisoes,paginasRelacionadas:relacionadas,
    modeloEntregavel:{natureza:'roteiro_de_decisao_com_fontes',campos:[campo('Objeto da decisão',nome,'perfil_revisado'),
      ...fatos.slice(0,6).map(e=>({...campo(e.natureza==='rotulo_literal'?'Rótulo público a conferir':'Condição publicada a conferir',e.trecho,'trecho_publicado'),evidencia:e}))],
      limite:'As fontes já estão preenchidas. Registre a escolha e a dúvida após observar o percurso, sem presumir condições ausentes nem completar dados comerciais.'},
    experimento:{tipo:receita.tipo,ofertaId:oferta.id||null,url:pagina?.url||null,objetivo:receita.objetivo},
    lacuna:{natureza:'hipotese',descricao:'Há suporte público para esta escolha. Ainda não se observou se o cliente consegue realizá-la e encontrar o próximo passo.'},
    priorizacao:{criterios:[...(base.priorizacao?.criterios||[]),{criterio:'decisao_do_cliente',valor:receita.tipo,natureza:'hipotese'},
      {criterio:'suporte_publico',valor:'fatos_e_percurso_especificados',natureza:'observacao'}],limite:'Prioridade editorial de uma decisão verificável; não estima lucro ou dificuldade de SEO.'},
    esforco:base.esforco||{nivel:'conferencia_com_responsavel',natureza:'estimativa_editorial',motivo:'Exige conferir o percurso e registrar a escolha, sem estimar horas ou custos.'},
    limites,dependencias:base.dependencias||[]};
}

/** A business decision is independent of technical findings. It needs a public
 * condition, a real comparison or an object + a specific public interaction.
 * A form/name/checklist alone is insufficient and returns null. */
export function planejarDecisaoNegocio({perfil,oferta,pagina,contextoPublico}={}, {agora=Date.now}={}){
  if(perfil?.estado!=='confirmado'||!oferta||!pagina||perfil.entendimento?.qualidade?.estado==='conflitante')return null;
  const instante=agora(),fontes=unificarFontes([...detalhesDoNegocio(perfil,pagina,contextoPublico,instante),...fontesDoNegocio(perfil,oferta,pagina,contextoPublico,instante)]);
  if(!fontes.length)return null;
  const nome=normal(oferta.nome),j=jornada(perfil,oferta,fontes),ancorada=ancorarFicha(j,oferta,rascunhoDaJornada(j,oferta,perfil),fontes),
    legado=especificarTesteNegocio({teste:{tipo:'conferir_oferta',base:'hipotese'},perfil,oferta,pagina,contextoPublico},{agora:()=>instante}),
    publicar=receita=>construirDecisao({perfil,oferta,pagina,base:legado,receita,fontes:receita.fontes||fontes});
  const texto=fontes.map(e=>normal(e.trecho)).join(' '),interacoes=interacoesAtuais(perfil,pagina,contextoPublico,instante),
    gerais=contextoLiteralAtual(perfil,contextoPublico,instante),interfaces=interacoesAtuais(perfil,null,contextoPublico,instante);
  if(ancorada.opcoes.length>1){const nomes=ancorada.opcoes.map(o=>'“'+o.nome+'”').join(', ');return publicar({tipo:'comparar_modalidades',titulo:'Comparar trajetórias e condições publicadas',
    objetivo:'Conferir qual trajetória atende ao objetivo da pessoa entre '+nomes+'.',escolha:'A escolha deve usar as diferenças publicadas, sem transferir o público, formato ou condição de uma modalidade a outra.',
    percurso:ancorada.opcoes.map(o=>o.nome),fontes:ancorada.usadas,
    restricoes:['Os cabeçalhos delimitam trechos para comparar; não comprovam contratos ou preços independentes entre as modalidades.'],
    passos:legado.passos,entregavel:legado.entregavel,resultado:legado.criterioSucesso});}
  const condicao=verificacaoDoConteudo(j,ancorada.usadas);
  if(condicao)return publicar({tipo:'conferir_condicao_publicada',titulo:condicao.titulo,objetivo:condicao.passo,
    escolha:'Use a condição publicada para registrar uma escolha ou uma dúvida que precisa da equipe, sem substituir informação desconhecida por promessa.',
    percurso:[j.tipo],fontes:ancorada.usadas,passos:[...legado.passos.slice(0,1),condicao.passo],entregavel:condicao.entrega,resultado:condicao.entrega+' A origem de cada condição e a dúvida ainda não resolvida ficam identificadas.'});
  if(j.tipo==='comodidade_vinculada')return publicar({tipo:'conferir_vinculo_da_comodidade',titulo:'Distinguir a comodidade da contratação principal',
    objetivo:'Conferir em que condição “'+oferta.nome+'” pode ser utilizada, preservando a declaração de cortesia.',escolha:'Identifique o público e o vínculo com a atividade principal antes de tratar a comodidade como aquisição avulsa.',
    percurso:['condicao_publicada','atividade_principal','encaminhamento'],fontes:[j.condicao],passos:legado.passos,entregavel:'Registro da condição de cortesia, do vínculo conferido e do canal responsável.',
    resultado:'O registro distingue comodidade, elegibilidade e atividade principal; não presume disponibilidade ou venda separada.'});
  const contato=nomesNaPaginaDeContato(j,pagina,fontes);
  if(contato.length)return publicar({tipo:'escolher_unidade_e_canal',titulo:'Ligar a unidade publicada ao canal de reserva',objetivo:legado.acao,
    escolha:'Confira a associação entre unidade e canal, distinguindo contato, consulta de disponibilidade e reserva confirmada.',percurso:contato.map(e=>e.trecho),fontes:contato,
    passos:legado.passos,entregavel:legado.entregavel,resultado:legado.criterioSucesso});
  if(/\b(?:passagens?|passagem|bilhetes?)\b/.test(nome)&&/\b(?:onibus|viacao|viacoes|passagens)\b/.test(texto)){
    const grupos=[...new Set(interacoes.filter(e=>['formulario','busca'].includes(e.tipoGrupo)).map(e=>e.grupoId))].map(g=>interacoes.filter(e=>e.grupoId===g));
    const g=grupos.find(g=>g.some(e=>/\borigem\b/.test(normal(e.trecho)))&&g.some(e=>/\bdestino\b/.test(normal(e.trecho)))&&g.some(e=>/\bdata\b/.test(normal(e.trecho)))&&g.some(e=>e.acao==='buscar'));
    if(g){const rotulos=g.map(e=>'“'+e.trecho+'”').join(', ');return publicar({tipo:'escolher_trajeto_e_bilhete',titulo:'Conferir trajeto, datas e encaminhamento do bilhete',
      objetivo:'O conteúdo apresenta compra de passagens e o mesmo grupo público reúne '+rotulos+'.',escolha:'Conferir como a pessoa escolhe o trajeto e entende o bilhete antes de continuar a compra.',
      percurso:g.map(e=>e.trecho),fontes:[fontes.find(e=>/\b(?:passagens|passagem)\b/.test(normal(e.trecho))),...g],
      passos:['Na URL, localize juntos os rótulos '+rotulos+'. A existência dos controles não comprova que a busca funciona.',
        'Prepare um trajeto e período fictícios no registro local. Confira na interface como a pessoa distingue origem, destino, ida e eventual volta, sem enviar a busca ou efetuar compra.',
        'Registre onde o percurso informa a operadora, as condições do bilhete e o próximo passo. Se não houver essa informação no recorte, deixe a responsabilidade como dúvida a esclarecer.'],
      entregavel:'Mapa do trajeto fictício entre os controles publicados, com escolha de ida/volta, ponto de identificação do bilhete/operadora e dúvidas registradas.',
      resultado:'O registro explica a relação entre origem, destino, datas e bilhete e aponta onde conferir o responsável; nenhuma passagem ou resultado de busca foi simulado como real.'});}
  }
  if(/\bingressos?\b/.test(nome)&&/\bingressos?\b/.test(texto)){
    const busca=gerais.find(e=>e.campo==='meta.description'&&/\bevento\b/.test(normal(e.trecho))&&/\bartista\b/.test(normal(e.trecho))&&/\bcidade\b/.test(normal(e.trecho))&&/\bdata\b/.test(normal(e.trecho)));
    const botao=busca&&interfaces.find(e=>e.url===busca.url&&e.acao==='buscar');
    if(busca&&botao)return publicar({tipo:'escolher_evento_e_ingresso',titulo:'Distinguir o evento, os filtros e o ingresso',objetivo:'A página declara “'+busca.trecho+'” e mostra o rótulo “'+botao.trecho+'”.',
      escolha:'Conferir como a pessoa passa de artista/cidade/data ao evento correto e às condições do ingresso, sem presumir quem organiza o evento.',percurso:['artista','cidade','tipo','data','evento','ingresso'],fontes:[busca,botao],
      passos:['Na URL '+busca.url+', confronte a descrição da busca com a experiência visível. Use um evento fictício no registro local, sem enviar dados ou comprar ingresso.',
        'Confira como a pessoa distingue artista, cidade, tipo e data e reconhece o evento a que o ingresso se refere. Registre o ponto em que falta condição ou identificação.',
        'Confronte o próximo passo com a informação de organizador e atendimento que a página realmente apresentar. Não atribua organização ou intermediação se a fonte não resolver o papel.'],
      entregavel:'Registro de escolha do evento a partir das dimensões publicadas e dos pontos para conferir ingresso, organizador e atendimento.',
      resultado:'A escolha distingue artista/evento/ingresso e preserva desconhecidas as responsabilidades não publicadas; não há compra, preço ou procura presumidos.'});
  }
  if(/\b(?:imoveis|imobiliaria|casas?|apartamentos?|locacao)\b/.test(nome)){
    const porUrl=new Map();for(const e of gerais)if(e.campo==='title'&&/\b(?:imoveis|apartamentos|casas)\b/.test(normal(e.trecho))&&e.url!==pagina.url&&new URL(e.url).pathname!=='/')porUrl.set(e.url,e);
    const propria=gerais.find(e=>e.url===pagina.url&&e.campo==='title'&&/\b(?:imoveis|apartamentos|casas)\b/.test(normal(e.trecho))&&new URL(e.url).pathname!=='/');if(propria)porUrl.set(propria.url,propria);
    const opcoes=[...porUrl.values()].slice(0,3);if(opcoes.length>1)return publicar({tipo:'escolher_recorte_de_imovel',titulo:'Comparar páginas de imóveis e o recorte desejado',
      objetivo:'O site publica páginas distintas: '+opcoes.map(e=>'“'+e.trecho+'”').join('; ')+'.',escolha:'Escolher a página compatível com a localidade e o tipo de imóvel desejados antes de solicitar orientação; um nome de cidade é contexto, não serviço separado.',
      percurso:opcoes.map(e=>e.url),fontes:opcoes,passos:['Compare os títulos e URLs indicados e registre qual recorte corresponde à necessidade da pessoa.',
        'Na página escolhida, confira como se distingue cidade, empreendimento e tipo de imóvel e onde fica o canal oficial de orientação. O título não comprova estoque, preço ou elegibilidade.',
        'Registre o que depende de consulta ao responsável, incluindo disponibilidade e modalidade de atendimento, sem preencher dados pessoais ou solicitar contratação.'],
      entregavel:'Mapa da escolha entre páginas de imóveis, com separação de cidade/tipo/empreendimento e dúvidas sobre disponibilidade e atendimento.',
      resultado:'A página escolhida tem fonte identificada e o registro separa oferta de recorte geográfico; nenhuma unidade disponível ou condição de financiamento foi inventada.'});
  }
  const ligada=fontes.filter(e=>ligadoAOferta(e,oferta));
  const canais=interacoes.filter(e=>['contatar','solicitar_orcamento','agendar'].includes(e.acao));
  const canalGenerico=e=>/^(?:contato|fale|falar|whatsapp|entre em contato|contate|solicite|solicitar|peca|pedir)\b/.test(normal(e.trecho));
  let canal=canais.find(e=>canalGenerico(e))||canais.find(e=>ligadoAOferta(e,oferta));
  if(!canal){const origem=ligada.find(e=>/(?:Peça|Solicite|Entre em contato|Converse com)[^.!?]{0,180}/iu.test(e.trecho));
    if(origem){const trecho=origem.trecho.match(/(?:Peça|Solicite|Entre em contato|Converse com)[^.!?]{0,180}/iu)[0];canal={...origem,trecho};}}
  const provaArtistica=fontes.find(e=>/\b(?:artistas?|shows?)\b/.test(normal(e.trecho))&&
    /\b(?:agencia|agenciamento|contrate|contratacao|intermediacao|representa)\b/.test(normal(e.trecho))&&
    !/\b(?:nao|nunca)\b[^.!?]{0,80}\b(?:agencia|agenciamento|contratacao|representa)\b/.test(normal(e.trecho)));
  if(canal&&j.tipo==='pedido_artistico'&&provaArtistica)return publicar({tipo:'esclarecer_pedido_artistico',titulo:'Preparar um pedido compatível com o canal publicado',objetivo:'A atuação artística tem como próximo passo publicado “'+canal.trecho+'”.',
    escolha:'Distinguir escolha de atração, consulta de disponibilidade e confirmação da contratação; representação e agenda não podem ser presumidas.',percurso:['atracao','evento','consulta','confirmacao'],fontes:[provaArtistica,...ligada.slice(0,1),canal],
    passos:['Escolha um cenário fictício de evento e confira no site quais informações a equipe solicita para identificar a atração e consultar disponibilidade.',
      'Confronte o rótulo “'+canal.trecho+'” com o encaminhamento visível. Registre se ele orienta uma consulta ou já promete confirmação; não envie mensagem nem trate a lista de artistas como agenda disponível.',
      'Registre o que precisa ser esclarecido pela equipe antes de um pedido, preservando desconhecidos cachê, agenda, representação e resultado comercial.'],
    entregavel:'Roteiro de consulta artística com o canal publicado, informações solicitadas para o evento e distinção entre pedido e confirmação.',
    resultado:'O registro permite encaminhar uma consulta adequada e deixa disponibilidade e condições não publicadas para a equipe, sem contratação ou contato enviado.'});
  const buscaProduto=interacoes.find(e=>e.acao==='buscar'&&/\bbuscar? produtos?\b/.test(normal(e.trecho))),
    ondeComprar=interacoes.find(e=>/\bonde (?:comprar|encontrar)\b/.test(normal(e.trecho)));
  if(buscaProduto&&ondeComprar&&(perfil.entendimento?.papel==='produtos'||/\b(?:produtos|loja|metais|moveis|roupas|alimentos|compressores)\b/.test(nome))){
    const prova=fontes.find(e=>/\b(?:produtos|catalogo|metais|moveis|roupas|alimentos|compressores)\b/.test(normal(e.trecho)));
    if(prova)return publicar({tipo:'distinguir_catalogo_e_canal_de_compra',titulo:'Conferir o modelo no catálogo antes do canal de compra',
      objetivo:'A página apresenta produtos e os caminhos “'+buscaProduto.trecho+'” e “'+ondeComprar.trecho+'”.',
      escolha:'Distinguir a consulta de um modelo e suas especificações do encaminhamento para encontrar onde adquirir; esses rótulos não comprovam checkout ou venda direta pelo site.',
      percurso:[buscaProduto.trecho,'modelo e ficha específica',ondeComprar.trecho],fontes:[prova,buscaProduto,ondeComprar],
      passos:['Parta de uma necessidade fictícia e confira como localizar o produto em “'+buscaProduto.trecho+'”. Registre o modelo e a fonte da especificação encontrada, sem presumir estoque.',
        'Confronte a característica desejada com a ficha desse modelo. Uma tecnologia ou benefício descrito para a marca não pode ser atribuído automaticamente a todos os produtos.',
        'Confira como o caminho “'+ondeComprar.trecho+'” encaminha a pessoa e o que precisa ser confirmado pelo vendedor ou representante. Não efetue compra nem conclua que a organização vende diretamente.'],
      entregavel:'Registro de modelo, especificação conferida e canal de aquisição encontrado, com distinção entre tecnologia genérica e condição daquele modelo.',
      resultado:'A escolha registra uma fonte para o modelo e o encaminhamento; tecnologias, disponibilidade, preço e venda direta permanecem desconhecidos quando não forem comprovados.',
      incertezas:['Os rótulos não comprovam que existe checkout, estoque ou venda direta.','Uma descrição geral de tecnologia não determina presença, compatibilidade ou benefício em cada modelo.']});
  }
  if(j.tipo==='especificacao_equipamento'&&ondeComprar){
    const aplicacao=gerais.find(e=>['residencial','profissional','industrial'].filter(t=>new RegExp('\\b'+t+'\\b').test(normal(e.trecho))).length>1);
    if(aplicacao)return publicar({tipo:'escolher_aplicacao_antes_do_modelo',titulo:'Definir aplicação e requisitos antes de escolher o modelo',objetivo:'A organização declara “'+aplicacao.trecho+'” e publica “'+ondeComprar.trecho+'”.',
      escolha:'Escolher o contexto de aplicação antes de comparar fichas técnicas e encaminhar a consulta, sem supor que cada modelo atende a todos os mercados citados.',percurso:['aplicacao','requisitos','ficha do modelo',ondeComprar.trecho],fontes:[aplicacao,ondeComprar],
      passos:['Registre uma aplicação fictícia e confronte-a com os mercados explicitamente citados pela fonte.',
        'Confira quais requisitos de uso a ficha do modelo exige. Registre as dúvidas de pressão, vazão, instalação ou compatibilidade para orientação técnica, sem inventar especificações.',
        'Confronte o modelo escolhido com o canal “'+ondeComprar.trecho+'”; a atuação da empresa em um mercado não garante adequação de todos os equipamentos a esse uso.'],
      entregavel:'Registro da aplicação desejada, requisitos ainda necessários, ficha técnica encontrada e canal responsável.',resultado:'A escolha de aplicação e a ficha estão documentadas com origem; o registro não recomenda um modelo ou parâmetros técnicos sem dados suficientes.'});
  }
  if(canal&&(j.tipo==='avaliacao_sistema'||/\b(?:software|squads?|tecnologia|automacao|dados|inteligencia artificial)\b/.test(nome))){
    const entrega=fontes.find(e=>/\b(?:modelo de entrega|projetos e equipes|entrega de software|equipes de tecnologia)\b/.test(normal(e.trecho))),
      responsabilidade=[...fontes,...gerais.filter(e=>ligadoAOferta(e,oferta))].find(e=>/\b(?:humanos|especialistas|equipe)\b/.test(normal(e.trecho))&&/\b(?:validam|validar|prioridades|decisoes|requisitos)\b/.test(normal(e.trecho)));
    if(entrega&&responsabilidade)return publicar({tipo:'definir_demanda_e_validacao_da_entrega',titulo:'Distinguir a demanda, a entrega e a validação humana',
      objetivo:'Os trechos publicados descrevem “'+entrega.trecho+'” e “'+responsabilidade.trecho+'”.',
      escolha:'Conferir se a necessidade pede uma entrega/projeto/equipe e onde ficam a prioridade e a decisão humana, em vez de presumir compra de uma plataforma pronta ou autonomia irrestrita.',
      percurso:['demanda','criterio de aceite','entrega','validacao humana',canal.trecho],fontes:[entrega,responsabilidade,canal],condicoesDeterminantes:[responsabilidade],
      passos:['Descreva uma única demanda fictícia com uma condição observável de aceite. Confronte esse objeto com o modelo de entrega que o texto realmente descreve.',
        'Registre quem precisa definir prioridades e validar uma decisão crítica, usando o trecho público e mantendo como dúvida a responsabilidade que a fonte não esclarecer.',
        'Confira o caminho para “'+canal.trecho+'” para esclarecer escopo e validação. Não trate alegações de produtividade, ROI ou automação como resultado do cliente.'],
      entregavel:'Registro de uma demanda, critério de aceite, tipo de entrega e pontos de validação humana a esclarecer com o responsável.',
      resultado:'O registro distingue o trabalho pedido, a entrega e a validação; não presume software pronto, execução autônoma ou ganho financeiro.'});
    const plano=fontes.find(e=>/\bplanos?\b/.test(normal(e.trecho))&&/\b(?:porte|necessidades|funcionalidades|faturamento)\b/.test(normal(e.trecho)));
    if(plano&&j.tipo==='avaliacao_sistema')return publicar({tipo:'comparar_necessidade_e_escopo_do_sistema',titulo:'Conferir necessidade operacional antes do plano do sistema',
      objetivo:'A fonte declara “'+plano.trecho+'” e apresenta o canal “'+canal.trecho+'”.',
      escolha:'Distinguir o processo que a equipe precisa resolver das condições de enquadramento em um plano; a descrição pública não calcula o preço ou o resultado da empresa.',percurso:['processo da equipe','funcoes publicadas','limites do plano',canal.trecho],fontes:[plano,canal],
      passos:['Registre um processo fictício da equipe, com entrada, tarefa e saída esperada. Compare-o com as funções efetivamente publicadas na mesma página.',
        'Registre quais limites ou condições do plano precisam ser esclarecidos e qual informação falta para decidir. Não estime faturamento, margem ou preço a partir do site.',
        'Confira como apresentar essa necessidade no canal “'+canal.trecho+'”, sem contratar plano, abrir conta ou enviar registros reais da empresa.'],
      entregavel:'Registro de um processo, funções publicadas pertinentes e dúvidas sobre limites/enquadramento do plano para esclarecer no canal oficial.',
      resultado:'A necessidade fica ligada a funções e limites com fonte; preço, adequação final e resultado comercial continuam sem conclusão quando não houver dados.'});
  }
  if(j.tipo==='participacao_social'){
    const territorio=gerais.find(e=>e.campo==='p'&&/\b(?:territorio|desenvolvimento local)\b/.test(normal(e.secao+' '+e.trecho))&&/\b(?:presenca|construcao|desenvolvimento|comunidade|moradia)\b/.test(normal(e.trecho))),
      fomento=gerais.find(e=>e.campo==='p'&&/\bfomento\b/.test(normal(e.secao))&&/\b(?:investimentos|apoio|apoiar)\b/.test(normal(e.trecho))),
      influencia=gerais.find(e=>e.campo==='p'&&/\b(?:influencia|advocacy)\b/.test(normal(e.secao))&&/\b(?:opinia|publica|politicas|desigualdades)\b/.test(normal(e.trecho)));
    const frentes=[territorio,fomento,influencia].filter(Boolean);
    if(frentes.length>1)return publicar({tipo:'escolher_frente_de_atuacao_social',titulo:'Distinguir a finalidade de cada frente antes do encaminhamento',
      objetivo:'As fontes descrevem frentes diferentes: '+frentes.map(e=>'“'+(e.secao||e.trecho)+'”').join('; ')+'.',
      escolha:'Escolher o encaminhamento conforme a pessoa queira conhecer uma ação territorial, esclarecer fomento ou acompanhar iniciativas de influência; a existência da frente não comprova inscrição ou apoio abertos.',
      percurso:frentes.map(e=>e.secao||e.url),fontes:frentes,
      passos:['Registre um objetivo fictício de uma pessoa ou organização e compare-o com a finalidade literal de cada frente citada.',
        'Para uma demanda ligada ao território, confira o local e o contato institucional publicado. Para quem procura apoio ou parceria, confira primeiro a frente de fomento e registre quais critérios e formas de acesso precisam da equipe; não presuma edital ou benefício aberto.',
        'Diferencie esse encaminhamento do acompanhamento de influência/políticas e de contatos de imprensa. Registre o canal encontrado e as dúvidas, sem enviar pedido ou tratar a atividade social como venda.'],
      entregavel:'Mapa do objetivo da pessoa/organização para a frente pertinente, com fontes da finalidade, canal a conferir e critérios de acesso ainda desconhecidos.',
      resultado:'O registro distingue as finalidades das frentes e o encaminhamento apropriado; não presume concessão de recurso, inscrição, elegibilidade ou retorno social medido.',
      incertezas:['Os trechos não comprovam edital, inscrição, apoio aberto ou critérios de elegibilidade.','Local, contato institucional e assessoria de imprensa podem ter finalidades diferentes e precisam ser conferidos antes do encaminhamento.']});
    const papeis=gerais.find(e=>e.campo==='p'&&/\bvoluntari\w*/.test(normal(e.trecho))&&/\bmoradores\b/.test(normal(e.trecho))&&/\b(?:conjunto|conjunta|com os)\b/.test(normal(e.trecho)));
    if(papeis)return publicar({tipo:'distinguir_voluntariado_e_atuacao_com_moradores',titulo:'Distinguir o papel de participação antes de buscar encaminhamento',
      objetivo:'A fonte descreve “'+papeis.trecho+'”.',escolha:'Conferir se a pessoa procura atuar como voluntária, conhecer a ação com moradores ou esclarecer acesso às soluções; esses papéis podem se sobrepor e não são inscrições automaticamente abertas.',
      percurso:['objetivo da pessoa','papel de participacao','acao com moradores','canal a conferir'],fontes:[papeis],
      passos:['Registre um objetivo fictício e confronte-o com os papéis de voluntariado e atuação com moradores mencionados no texto.',
        'Na página da atividade, confira qual caminho informa participação e qual orienta uma pessoa da comunidade. Registre requisitos e canal somente quando estiverem publicados; não prometa atendimento, construção ou inscrição.',
        'Registre a pergunta que a equipe precisa responder quando o mesmo canal não esclarecer o papel e o acesso. Não envie dados pessoais nem solicitação durante a conferência.'],
      entregavel:'Registro do objetivo de participação, do papel aludido na fonte, do encaminhamento encontrado e das dúvidas de acesso.',
      resultado:'O registro separa objetivo, papel e forma de encaminhamento sem transformar a missão em promessa de benefício ou inscrição aberta.'});
    const acao=gerais.find(e=>e.campo==='p'&&/\ba[cç][oõ]es\b/iu.test(e.trecho)&&/\bcontato\b/.test(normal(e.trecho))&&!/\bimprensa\b/.test(normal(e.trecho))),
      imprensa=gerais.find(e=>e.campo==='p'&&/\bassessoria de imprensa\b/.test(normal(e.trecho)));
    if(acao&&imprensa&&acao.url!==imprensa.url)return publicar({tipo:'separar_canais_de_participacao_e_imprensa',titulo:'Distinguir o contato das ações do contato de imprensa',
      objetivo:'Há um contato que declara “'+acao.trecho+'” e outro que declara “'+imprensa.trecho+'”.',
      escolha:'Escolher o encaminhamento conforme o objetivo da pessoa, sem tratar contato de imprensa como inscrição, pedido de apoio ou atendimento de uma ação social.',percurso:[acao.url,imprensa.url],fontes:[...ligada.slice(0,1),acao,imprensa],
      passos:['Registre um objetivo fictício ligado à atividade e compare com as finalidades dos dois canais citados.',
        'Na página de contato das ações, confira como a pessoa identifica a unidade ou encaminhamento adequado. Endereço ou contato de um espaço não comprova inscrição aberta, elegibilidade ou apoio financeiro.',
        'Reserve a rota de assessoria de imprensa para essa finalidade. Registre onde é necessário esclarecer participação, acesso ou parceria com a equipe, sem enviar solicitação.'],
      entregavel:'Mapa entre objetivo da pessoa e canal institucional ou de imprensa, com dúvidas de acesso/participação e fontes das finalidades.',
      resultado:'O registro distingue finalidades e encaminhamentos; não presume doação, matrícula, elegibilidade ou atendimento aberto a partir da existência de um contato.'});
  }
  if(canal){
    const modalidade=ligada.find(e=>/\bpresencial\b/.test(normal(e.trecho))&&/\bonline\b/.test(normal(e.trecho)));
    if(modalidade)return publicar({tipo:'comparar_formas_de_atendimento',titulo:'Distinguir atendimento presencial e online',objetivo:'A oferta declara “'+modalidade.trecho+'” e apresenta o canal “'+canal.trecho+'”.',
      escolha:'Conferir qual modalidade atende à necessidade e quais condições precisam da equipe antes do encaminhamento.',percurso:['necessidade','modalidade','canal'],fontes:[modalidade,canal],
      passos:['Compare presencial e online apenas no escopo da atividade citada; registre o que o texto declara e o que depende de região, horário ou disponibilidade.',
        'Prepare uma necessidade fictícia e confira como a pessoa escolhe a modalidade e chega a “'+canal.trecho+'”, sem enviar informações reais.',
        'Registre a condição que impede a escolha ou a dúvida a encaminhar à equipe. Não estenda a mesma modalidade a serviços que o trecho não cobre.'],
      entregavel:'Registro da escolha entre atendimento presencial e online, com condições citadas e dúvidas para o canal responsável.',resultado:'A modalidade escolhida está ligada à atividade e à fonte; região, agenda e condições não publicadas permanecem desconhecidas.'});
    const garantia=ligada.find(e=>/\bgarantia\b/.test(normal(e.trecho))&&/\b(?:meses|dias|anos)\b/.test(normal(e.trecho)));
    if(garantia)return publicar({tipo:'conferir_escopo_e_garantia',titulo:'Conferir escopo, garantia declarada e encaminhamento',objetivo:'O trecho da atividade declara “'+garantia.trecho+'”.',
      escolha:'Conferir se a solicitação se enquadra no serviço e que parte da garantia precisa de esclarecimento antes de pedir atendimento.',percurso:['servico','condicao_de_garantia','canal'],fontes:[garantia,canal],
      passos:['Use uma necessidade fictícia para localizar o serviço descrito e a condição de garantia na mesma fonte.',
        'Registre a relação entre serviço, prazo publicado e condições/exclusões que a equipe precisa esclarecer. Não transforme o prazo em cobertura ilimitada.',
        'Confira o caminho para “'+canal.trecho+'” e registre como pedir esclarecimento, sem enviar pedido ou dados pessoais.'],
      entregavel:'Registro do serviço enquadrado, da condição de garantia citada e das dúvidas a esclarecer no canal publicado.',resultado:'A solicitação é comparada ao escopo e à garantia realmente declarados; cobertura não publicada não é presumida.'});
  }
  return null;
}

export function tarefasDeAtuacoesSociais({perfil,contextoPublico}, {agora=Date.now}={}){
  if(perfil?.estado!=='confirmado'||!Array.isArray(perfil.entendimento?.atuacoes))return[];
  const vistas=new Set(),tarefas=[];
  for(const a of perfil.entendimento.atuacoes.slice(0,12)){
    if(!['programa_social','participacao','captacao'].includes(a?.tipo)||!limpar(a.nome,120))continue;
    const fonte=evidenciasDe(a).find(e=>fonteLiteral(e)&&fonteAtual(e,perfil.dominio,null,agora()));
    const declarada=a.natureza==='declaracao_usuario'||a.origem==='usuario';if(!fonte&&!declarada)continue;
    const chave=(fonte?.url||'declarada')+'|'+normal(a.nome);if(vistas.has(chave))continue;vistas.add(chave);
    let declaradaUrl=null;
    try{const u=new URL(a.url);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&normalizarSite(u.href)===perfil.dominio)declaradaUrl=u.href;}catch{/* A declared activity may still have no page. */}
    const oferta={id:null,nome:limpar(a.nome,120),evidencias:fonte?[fonte]:[]},pagina=fonte?{url:fonte.url,origem:'observada',fonte:'site',coletadoEm:fonte.coletadoEm}:declaradaUrl?{url:declaradaUrl,origem:'declarada',fonte:'perfil',coletadoEm:null}:null;
    const teste=planejarDecisaoNegocio({perfil,oferta,pagina,contextoPublico},{agora})||
      {...especificarTesteNegocio({teste:{tipo:'conferir_oferta',base:'hipotese'},perfil,oferta,pagina,contextoPublico},{agora}),eixo:'qualificacao'};
    tarefas.push({...teste,id:'atividade_'+createHash('sha256').update(chave).digest('hex').slice(0,20),prioridade:'investigar',paginaAlvo:pagina,
      ofertasAfetadas:[],atuacoesRelacionadas:[{nome:a.nome,tipo:a.tipo,natureza:fonte?'declaracao_publicada':'declaracao_usuario'}],termosRelacionados:[],evidencias:fonte?[{...fonte,tipo:'atividade_publicada'}]:[],melhoriasObservadas:[],
      limites:['A atividade é uma declaração publicada, não uma oferta comercial confirmada.','O objetivo é clareza de participação ou apoio. Não estima doações, receita, ranking ou impacto social.']});
  }
  return tarefas;
}
