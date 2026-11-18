import {createHash} from 'node:crypto';
import {classificarOrigemPublicada} from './atribuicao-publica.mjs';
import {rotuloContatoExplicito} from './interacoes-publicas.mjs';

const lista=v=>Array.isArray(v)?v:[];
const texto=v=>typeof v==='string'?v.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/gu,' ').trim():'';
const normal=v=>texto(v).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const palavras=v=>[...new Set(normal(v).match(/[a-z]{4,}/g)||[])];
const temasComuns=new Set(['para','como','mais','pela','pelo','sobre','empresa','empresas','equipe','equipes','nosso','nossa','sistema','plataforma','software','servicos','servico','gestao','oferta','solucoes','antes','depois','conferir','comparar','distinguir','publicado','informacoes','ainda','necessidade','necessidades']);
const termos=v=>palavras(v).filter(x=>!temasComuns.has(x));
function objetivoPositivo(v){
  const n=normal(v),m=/\b(?:sem|nao)\s+(?:aplic\w*|copi\w*|atribu\w*|generaliz\w*|promet\w*|transfer\w*|compar\w*)/u.exec(n);
  return m?n.slice(0,m.index).replace(/[;,]\s*$/u,'').trim():n;
}
const raiz=v=>v.length>=7?v.slice(0,6):v.replace(/s$/,'');
const comum=(a,b)=>termos(a).filter(x=>termos(b).some(y=>raiz(x)===raiz(y))).length;
const id=v=>'dp_'+createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,20);
const corpo=f=>/^(?:p|li|dd|bloco\.titulo-conteudo|jsonld\.(?:Service|Product|Organization)\.description)$/u.test(f.campo||'');
const titulo=f=>texto(f.secao).split(' / ').at(-1)||'Publicação da atividade';
const chave=f=>JSON.stringify([f.url,f.sha256,f.campo,f.secao,f.trecho]);
const comId=f=>({...f,fonteId:f.fonteId||'pub_'+createHash('sha256').update(JSON.stringify([f.url,f.campo,f.sha256,f.trecho])).digest('hex').slice(0,20),
  contextoPublicacaoId:id([f.url,f.sha256,f.campo,f.secao,f.trecho])});
const juntar=fs=>[...new Map(lista(fs).filter(Boolean).map(f=>[chave(f),comId(f)])).values()];
const negada=f=>/\b(?:nao (?:oferece|oferecemos|inclui|disponibiliza)|exemplo ficticio|caso de sucesso|depoimento)\b/u.test(normal(f.trecho+' '+f.secao));
function restrita(f,objetivo){
  const n=normal(f.trecho),m=/(?:especificamente|somente|exclusivamente|ideal)\s+para\s+(?:empresas\s+de\s+)?([^,.;:]{5,120})/u.exec(n);
  return !!m&&comum(m[1],objetivoPositivo(objetivo))===0;
}
function fontesValidas(fontes,cobertura,agora){
  const candidatas=juntar(fontes).filter(f=>f.recortado===false&&corpo(f)&&f.trecho.length<=1600&&!negada(f)&&classificarOrigemPublicada(f).estado==='nao_determinada'&&
    !['politica','editorial'].includes(f.classePagina)&&Date.parse(f.coletadoEm)<=agora()&&
    !/\b(?:newsletter|blog|imprensa|depoimentos|testimonials)\b/u.test(normal(f.secao))&&
    !lista(cobertura?.paginas).some(p=>p.url===f.url&&p.sha256&&p.sha256!==f.sha256));
  const porUrl=new Map();
  for(const f of candidatas){const grupo=porUrl.get(f.url)||[];grupo.push(f);porUrl.set(f.url,grupo);}
  return [...porUrl.values()].flatMap(grupo=>{
    if(new Set(grupo.map(f=>f.sha256)).size===1)return grupo;
    const ultima=Math.max(...grupo.map(f=>Date.parse(f.coletadoEm))),hashes=new Set(grupo.filter(f=>Date.parse(f.coletadoEm)===ultima).map(f=>f.sha256));
    return hashes.size===1?grupo.filter(f=>f.sha256===[...hashes][0]):[];
  });
}
function naPagina(fs,o){return fs.filter(f=>f.url===o.url);}
function score(f,o){
  const goal=objetivoPositivo(o.jornada?.objetivo),temporal=/\b(?:duracao|acesso|periodo|prazo)\b/u.test(goal)&&/\b(?:por mes|ate o dia|acesso (?:por|durante))\b/u.test(normal(f.trecho));
  return comum(goal,f.trecho+' '+f.secao)*4+comum(o.nome,f.trecho)*2+(temporal?8:0)-
    (restrita(f,o.jornada?.objetivo)?30:0)-(/\b(?:tudo para|em um so lugar|e muito mais)\b/u.test(normal(f.trecho))?20:0);
}
function preferir(fs,o){return [...fs].sort((a,b)=>score(b,o)-score(a,o)||b.trecho.length-a.trecho.length);}
function opcao(nome,fonte,extra={}){
  return{id:id([nome,chave(fonte)]),nome,fonte:comId(fonte),...extra};
}
function caso(idCaso,dados,necessidade,alternativas,justificativa){
  return{id:idCaso,natureza:'hipotese_controlada',dadosEntrada:dados,necessidade,
    esperado:{alternativas:alternativas.map(a=>a.id),natureza:'roteiro_de_conferencia',justificativa},
    fontes:alternativas.map(a=>a.fonte.fonteId)};
}
function idade(f){
  const s=titulo(f)+' '+f.trecho;
  const contextoEtario=/\b(?:idade|criancas|jovens|adolescentes|adultos)\b/u.test(normal(s));
  const faixaNoRotulo=/\(\d{1,2}\s*[–-]\s*\d{1,2}\s*anos\)/iu.test(titulo(f));
  if(!contextoEtario&&!faixaNoRotulo)return null;
  if(/\b(?:anos de (?:experiencia|atuacao|mercado|existencia)|anos no mercado)\b/u.test(normal(s))&&!faixaNoRotulo)return null;
  let m=/(\d{1,2})\s*(?:[–-]|a|e)\s*(\d{1,2})\s*anos/iu.exec(s);
  if(m&&+m[1]<=+m[2]&&+m[2]<=120&&+m[2]-+m[1]<=30)return{minimo:+m[1],maximo:+m[2],unidade:'anos',literal:m[0]};
  m=/(?:a partir de\s+(\d{1,2})\s+anos|\((\d{1,2})\+\))/iu.exec(s);
  return m?{minimo:+(m[1]||m[2]),maximo:null,unidade:'anos',literal:m[0]}:null;
}
function porIdade(o,fs){
  if(!/\b(?:idade|idades|faixa etaria)\b/u.test(objetivoPositivo(o.jornada?.objetivo)))return null;
  const mapa=new Map();
  for(const f of naPagina(fs,o)){
    const faixa=idade(f),n=titulo(f);
    if(!faixa||!/\b(?:curso|crianca|jovem|adolescente|adulto|idade)\w*/u.test(normal(n+' '+f.trecho)))continue;
    if(comum(o.nome,n+' '+f.trecho)===0)continue;
    const ant=mapa.get(normal(n));
    if(!ant||f.trecho.length>ant.fonte.trecho.length)mapa.set(normal(n),opcao(n,f,{faixa,escopo:'faixa_mencionada_na_modalidade'}));
  }
  const opcoes=[...mapa.values()].sort((a,b)=>a.faixa.minimo-b.faixa.minimo).slice(0,5);
  if(opcoes.length<2||opcoes[0].faixa.minimo===opcoes.at(-1).faixa.minimo)return null;
  const representativa=a=>a.faixa.maximo===null?a.faixa.minimo:Math.ceil((a.faixa.minimo+a.faixa.maximo)/2);
  const valores=[representativa(opcoes[0]),representativa(opcoes.at(-1))];
  const casos=valores.map((v,i)=>{
    const candidatas=opcoes.filter(a=>v>=a.faixa.minimo&&(a.faixa.maximo===null||v<=a.faixa.maximo));
    return caso('idade_'+(i+1),{idadeAnos:v,nivel:null,objetivoDeAprendizagem:null},
      'Caso fictício: uma pessoa de '+v+' anos procura a modalidade de '+o.nome+'; nível, rotina e objetivo ainda precisam ser informados.',candidatas,
      'A idade coincide apenas com a faixa mencionada nestas publicações. Confira nível, etapa escolar, objetivo, modalidade, agenda e demais condições antes de considerar matrícula.');
  });
  return{tipo:'comparar_faixas_publicadas',pergunta:'Qual modalidade publicada deve ser conferida primeiro para a idade informada?',
    opcoes,casos,entradaReal:'Idade da pessoa, nível, etapa escolar quando citada, objetivo e horários; continuam desconhecidos neste cenário.',
    mecanismo:'A idade dos dois casos muda o bloco de modalidade a consultar. Isso evita copiar a faixa ou o limite de turma de um curso infantil para todo o catálogo.',
    limites:['A faixa é um primeiro filtro de leitura, não decisão de elegibilidade ou matrícula.','O recorte inclui apenas modalidades com faixa explícita coletada; outras modalidades permanecem fora desta comparação.']};
}
function porCorrecao(o,fs,validar,ofertas){
  const goal=objetivoPositivo(o.jornada?.objetivo);
  if(!/\b(?:redacao|correcao|feedback|revisao)\b/u.test(goal))return null;
  const page=naPagina(fs,o);
  const objetos=[['redação',/\bredac\w*/u],['documento',/\bdocument\w*/u],['texto',/\btextos?\b/u],['código',/\bcodig\w*/u],['contrato',/\bcontrat\w*/u]];
  const objetivoObjeto=objetos.find(([,p])=>p.test(goal));
  const adequado=f=>!objetivoObjeto||objetivoObjeto[1].test(normal(f.trecho));
  const ai=preferir(page.filter(f=>adequado(f)&&/\b(?:por ia|inteligencia artificial)\b/u.test(normal(f.trecho))&&/\b(?:redac|correc|revis)/u.test(normal(f.trecho))),o)[0];
  const humano=preferir(page.filter(f=>adequado(f)&&/\b(?:por (?:um |uma )?(?:professor|especialista|revisor)|um professor|uma professora)\b/u.test(normal(f.trecho))&&/\b(?:corrig|correc|revis)/u.test(normal(f.trecho))),o)[0];
  if(!ai||!humano||ai.sha256!==humano.sha256)return null;
  const objeto=objetivoObjeto||objetos.find(([,p])=>p.test(normal(ai.trecho))&&p.test(normal(humano.trecho)));
  if(!objeto)return null;
  const credito=page.find(f=>f.sha256===humano.sha256&&adequado(f)&&validar(f,o,ofertas.filter(x=>x.url===f.url)).sustentado&&/\bcredito\b/u.test(normal(f.trecho))&&/\b(?:professor|correc|redac)/u.test(normal(f.trecho)));
  const quantidade=/(\d{1,5})\s+correc\w*[^.!?]{0,100}\bpor mes\b/u.exec(normal(ai.trecho)),q=quantidade?+quantidade[1]:null;
  const anunciada=q!==null&&q<99999?{valor:q,unidade:'correcoes',periodo:'mes',natureza:'quantidade_anunciada_nao_maximo_inferido'}:null;
  const a=opcao('Retorno automatizado anunciado',ai,{modo:'automatizado',quantidadeAnunciada:anunciada}),b=opcao('Retorno humano anunciado',humano,{modo:'humano',condicoes:credito?[comId(credito)]:[]});
  const pedido=anunciada?anunciada.valor+1:null;
  const resultado={tipo:'comparar_modalidades_de_correcao',pergunta:'A necessidade pede retorno automatizado ou retorno de uma pessoa, e quais condições pertencem a cada modalidade?',
    opcoes:[a,b],casos:[
      caso('feedback_1',{tipoDeRetorno:'automatizado',objeto:objeto[0],quantidadeNoMes:pedido},'Caso fictício: quero o retorno automatizado anunciado sobre '+objeto[0]+(pedido!==null?', para '+pedido+' envios no mesmo mês':'')+'; preciso conferir a quantidade e o período publicados.',[a],
        'Conferir o recurso descrito como IA. '+(anunciada?'O pedido de '+pedido+' ultrapassa a quantidade anunciada de '+anunciada.valor+' por mês; esclarecer os envios adicionais, sem concluir indisponibilidade. ':'')+'Não apresentá-lo como avaliação por professor nem ampliar a quantidade ou duração anunciadas.'),
      caso('feedback_2',{tipoDeRetorno:'humano',objeto:objeto[0],planoContratado:null,creditosDisponiveis:null},'Caso fictício: preciso que uma pessoa faça a revisão de '+objeto[0]+' e devolva orientação; ainda não sei plano nem créditos disponíveis.',[b],
        'Conferir a modalidade humana e as condições completas do trecho. Não supor que a quantidade da modalidade automatizada inclua professor ou créditos.')],
    entradaReal:'Tipo de retorno desejado, quantidade, plano e eventual saldo/validade de créditos. Nenhum desses dados do cliente foi confirmado.',
    mecanismo:'Os casos diferem pelo tipo de retorno. As condições de IA e de correção humana permanecem em linhas separadas, em vez de confundir lista de recursos com uma necessidade de feedback.',
    limites:['Disponibilidade, plano aplicável, créditos, preço e prazo só valem no alcance explicitamente publicado.','Não se promete qualidade de correção, aprovação, resultado de estudo ou inclusão de um serviço no outro.']};
  resultado.casos[0].esperado.quantidadeStatus=anunciada?'acima_da_quantidade_anunciada':'quantidade_nao_extraida';
  resultado.casos[0].esperado.adequacaoConfirmada=false;
  return resultado;
}
function porPresencaRecurso(o,fs,validar,ofertas){
  const goal=objetivoPositivo(o.jornada?.objetivo);
  if(!/\b(?:modalidade|modalidades|alternativa|alternativas|compar\w*|distingu\w*|diferenc\w*)\b/u.test(goal))return null;
  const groups=new Map(),page=naPagina(fs,o);
  for(const f of page){
    const label=titulo(f),m=/^(Com|Sem)\s+(.{5,80})$/iu.exec(label);if(!m)continue;
    const resource=normal(m[2]);
    if(/\d|\b(?:desconto|juros|taxa|preco|custo|risco|garantia|voce|conosco)\b/u.test(resource))continue;
    if(normal(f.trecho).includes((normal(m[1])==='com'?'sem ':'com ')+resource))continue;
    if(!/\b(?:assina\w*|envia\w*|utiliza\w*|registra\w*|configura\w*|emite\w*|solicita\w*|precisa\w*|requer\w*|permite\w*|adquir\w*)\b/u.test(normal(f.trecho)))continue;
    if(!validar(f,o,ofertas.filter(x=>x.url===f.url)).sustentado)continue;
    const parent=texto(f.secao).split(' / ').slice(0,-1).map(normal).join(' / '),key=JSON.stringify([f.url,f.sha256,parent,resource]);
    if(!groups.has(key))groups.set(key,{resource:m[2],com:[],sem:[]});groups.get(key)[normal(m[1])].push(f);
  }
  const candidatos=[...groups.values()].filter(g=>g.com.length&&g.sem.length).map(g=>({...g,a:preferir(g.com,o)[0],b:preferir(g.sem,o)[0]}));
  // The base and public-detail extractors can expose identical paragraphs
  // with full or abbreviated heading chains. Count the same literal pair
  // once; different bodies, pages and captures remain distinct choices.
  const equivalentes=new Map();
  for(const g of candidatos){const k=JSON.stringify([normal(g.resource),g.a.url,g.a.sha256,g.a.trecho,g.b.trecho]),old=equivalentes.get(k);
    if(!old||texto(g.a.secao).length+texto(g.b.secao).length>texto(old.a.secao).length+texto(old.b.secao).length)equivalentes.set(k,g);}
  const unicas=[...equivalentes.values()];
  const pai=f=>normal(texto(f.secao).split(' / ').slice(0,-1).join(' / '));
  const pairs=unicas.filter(g=>!unicas.some(q=>q!==g&&normal(q.resource)===normal(g.resource)&&q.a.url===g.a.url&&q.a.sha256===g.a.sha256&&
    (!pai(g.a)||pai(q.a)===pai(g.a))&&(!pai(g.b)||pai(q.b)===pai(g.b))&&
    q.a.trecho.includes(g.a.trecho)&&q.b.trecho.includes(g.b.trecho)&&
    (q.a.trecho.length>g.a.trecho.length||q.b.trecho.length>g.b.trecho.length)));
  if(!pairs.length)return null;
  const scored=pairs.map(g=>({...g,score:comum(g.resource,goal)})).sort((a,b)=>b.score-a.score);
  if(scored.length>1&&scored[0].score===scored[1].score)return null;
  const {resource,a,b}=scored[0],yes=opcao(titulo(a),a,{recursoPublicado:resource,presenca:'com_recurso'}),no=opcao(titulo(b),b,{recursoPublicado:resource,presenca:'sem_recurso'});
  return{tipo:'comparar_presenca_de_recurso',titulo:'Comparar percursos com e sem '+resource,pergunta:'O percurso declarado é “'+yes.nome+'” ou “'+no.nome+'”, e que condições pertencem a cada alternativa?',opcoes:[yes,no],
    casos:[caso('recurso_presente',{recursoPublicado:resource,presencaDeclarada:'com_recurso',recursoRealConfirmado:false},
      'Caso fictício: o solicitante declara que dispõe de “'+resource+'” e quer conferir o percurso “'+yes.nome+'”.',[yes],
      'Conferir a instrução e as condições integrais dessa alternativa; não aplicar a dispensa descrita na outra. A declaração fictícia não confirma adequação ou funcionamento.'),
      caso('recurso_ausente',{recursoPublicado:resource,presencaDeclarada:'sem_recurso',recursoRealConfirmado:false},
      'Caso fictício: o solicitante ainda não dispõe de “'+resource+'” e quer conferir o percurso “'+no.nome+'”.',[no],
      'Conferir o que a alternativa sem o recurso publica e qual próximo passo ela descreve. Não transformar a dispensa do recurso em dispensa de todas as condições.')],
    entradaReal:'Se o solicitante dispõe de “'+resource+'”, qual modalidade pretende usar e quais condições consegue confirmar. Essas informações reais ainda não foram coletadas.',
    mecanismo:'Os casos diferem pela presença do recurso nomeado nos dois títulos. Cada resposta permanece na sua fonte, com papéis declarados e condições próprias, sem escolher pela popularidade de uma palavra.',
    limites:['Os rótulos com/sem são observados no HTML; não comprovam adequação, validade jurídica, integração, funcionamento ou resultado financeiro.','A leitura usa uma hipótese de percurso para conferência; não executa o serviço nem confirma as informações do cliente.']};
}
function porInterfaceOuIntegracao(o,fs,validar,ofertas){
 const goal=objetivoPositivo(o.jornada?.objetivo);
 if(!/\b(?:compar\w*|alternativas|modalidades)\b/u.test(goal)||!/\b(?:api|integracao|interface|plataforma|tela|painel)\b/u.test(goal))return null;
 const candidates=naPagina(fs,o).filter(f=>{
  const n=normal(f.trecho);
  return !/^nao\b/u.test(n)&&!restrita(f,goal)&&
   /\b(?:envie|envia|gere|gera|crie|cria|acesse|acessa|utilize|utiliza)\b.{0,90}\b(?:pela|na|pelo|no)\s+(?:nossa?\s+)?(?:plataforma|tela|interface|painel)\b.{0,130}\bou\b.{0,100}\b(?:integracao|integrar)\b/u.test(n)&&
   /\bapi\b/u.test(n)&&!/(?:nao (?:permite|oferece|suporta|disponibiliza)|sem)\s+(?:a\s+)?(?:integracao|api)\b/u.test(n)&&validar(f,o,ofertas.filter(x=>x.url===f.url)).sustentado;
 });
 if(!candidates.length)return null;
 const ranked=preferir(candidates,o),first=ranked.find(f=>ranked.every(q=>f.trecho.includes(q.trecho)));
 if(!first)return null;
 const ui=opcao('Uso pela interface publicada',first,{canal:'interface'}),api=opcao('Avaliar integração por API',first,{canal:'integracao_api'});
 return{tipo:'comparar_interface_e_integracao',titulo:'Comparar interface e integração por API',pergunta:'A necessidade é usar a interface ou avaliar a integração publicada com o sistema da equipe?',opcoes:[ui,api],
  casos:[caso('operacao_pela_interface',{canalPretendido:'interface',necessidadeRealConfirmada:false},
    'Caso fictício: a equipe quer preparar a operação pela interface publicada, sem presumir uma integração existente.',[ui],
    'Conferir o percurso na interface, quem prepara a operação e quais informações ela solicita. A publicação não demonstra que a equipe tenha conta, acesso ou plano adequado.'),
   caso('avaliar_integracao',{canalPretendido:'integracao_api',sistemaExistenteConfirmado:false,integracaoDisponivelConfirmada:false},
    'Caso fictício: a equipe já organiza o processo em outro sistema e quer investigar a alternativa de integração publicada.',[api],
    'Identificar o sistema, a rotina e a pessoa técnica responsável; conferir documentação e requisitos antes de propor a integração. Não presumir compatibilidade, gratuidade ou disponibilidade para o cliente.')],
  entradaReal:'Como a equipe realiza a operação hoje, qual sistema pretende conectar, quem executa cada etapa e quais requisitos da integração consegue confirmar.',
  mecanismo:'A publicação oferece duas rotas para a mesma operação. Os casos deixam explícita a diferença entre usar a interface e investigar uma integração; o texto integral que descreve ambas acompanha cada alternativa.',
  limites:['Não escolhe um canal pelo cliente, executa integração ou diagnostica defeito na página.','A menção a API não comprova acesso, compatibilidade, preço, segurança, disponibilidade nem retorno financeiro.']};
}
function finalidade(f){
  const t=f.trecho;
  const recortar=v=>texto(v).split(/\s+(?:em at[eé]|por apenas|com at[eé]|a partir de|pode(?:m)?\s+(?:proporcionar|garantir|melhorar)|antes da concorr[eê]ncia)(?=\s|$)/iu)[0];
  let m=/\bpara\s+((?:colocar|publicar|registrar|proteger|organizar|controlar|gerenciar|gerir|criar|aprender|desenvolver|acompanhar|automatizar|dominar|avaliar|contratar|manter|reduzir)[^.!?;]{8,200})/iu.exec(t);
  if(m)return recortar(m[1]);
  m=/\b((?:Proteja|Garanta|Organize|Controle|Aprenda|Desenvolva|Registre|Publique|Gerencie|Domine)\s+[^.!?;]{10,220})/u.exec(t);
  if(m)return recortar(m[1]);
  m=/\b((?:dominar|aprender|desenvolver|organizar|controlar)\s+[^.!?;]{10,180})/iu.exec(t);
  return m?recortar(m[1]):null;
}
function fonteNomeada(o,fs,validar,ofertas){
  const page=naPagina(fs,o).filter(f=>!restrita(f,o.jornada?.objetivo)&&finalidade(f));
  return preferir(page.filter(f=>{
    const vinculo=validar(f,o,ofertas.filter(x=>x.url===f.url));
    const contextoProprio=comum(o.nome,titulo(f))>=2&&!['outro_objeto_nomeado_no_corpo','catalogo_geral_sem_nome_da_oferta'].includes(vinculo.motivo);
    if(!vinculo.sustentado&&!contextoProprio)return false;
    if(normal(f.trecho).includes(normal(o.nome)))return true;
    if(normal(titulo(f))===normal(o.nome))return true;
    // Explicit audience+purpose on a dedicated reviewed page supports routing,
    // not programme eligibility or plan features.
    const alvoEmpresa=/\b(?:empresas|corporativ|equipes)\b/u.test(normal(o.nome));
    return alvoEmpresa&&/\bempresa\b/u.test(normal(f.trecho))&&/\bequipe\b/u.test(normal(f.trecho))||
      comum(o.nome,f.trecho+' '+titulo(f))>=2&&(vinculo.sustentado||contextoProprio);
  }),o)[0]||null;
}
function porObjetos(o,ofertas,fs,validar){
  if(!/\b(?:compar\w*|distingu\w*|separ\w*|diferenci\w*)\b/u.test(objetivoPositivo(o.jornada?.objetivo)))return null;
  const principal=fonteNomeada(o,fs,validar,ofertas);
  if(!principal)return null;
  const outros=ofertas.filter(x=>x.id!==o.id&&x.nome!==o.nome&&comum(objetivoPositivo(o.jornada?.objetivo),x.nome)>0).map(x=>({o:x,f:fonteNomeada(x,fs,validar,ofertas)})).filter(x=>x.f);
  outros.sort((a,b)=>comum(o.jornada?.objetivo,b.o.nome)-comum(o.jornada?.objetivo,a.o.nome));
  if(!outros.length)return null;
  const par=[{o,f:principal},outros[0]],opcoes=par.map(x=>{
    const faixa=idade(x.f),nome=normal(x.o.nome),cabecalho=normal(titulo(x.f)),modalidade=!!faixa||cabecalho!==nome&&cabecalho.startsWith(nome);
    return opcao(x.o.nome+(modalidade?' — exemplo publicado: '+titulo(x.f):''),x.f,{ofertaId:x.o.id,ofertaNome:x.o.nome,url:x.o.url,faixa,modalidadeEspecifica:modalidade,
      finalidade:finalidade(x.f),escopo:modalidade?'exemplo_de_modalidade':'objeto_e_finalidade_publicados'});
  });
  const casos=opcoes.map((a,i)=>caso('objeto_'+(i+1),{objetivoProposto:a.finalidade,idadeAnos:a.faixa?(a.faixa.maximo===null?a.faixa.minimo:Math.ceil((a.faixa.minimo+a.faixa.maximo)/2)):null,servicoExistente:null,condicoesDeContratacao:null},
    'Caso fictício: o objetivo é “'+a.finalidade+'”. '+(a.modalidadeEspecifica?'O teste usa somente o exemplo publicado “'+titulo(a.fonte)+'”'+(a.faixa?', com faixa '+a.faixa.literal:'')+'; outras modalidades e perfis não são classificados por esse exemplo. ':'')+'Qual objeto do comparativo publica esse propósito e o que precisa ser esclarecido antes de contratar?',[a],
    'Conferir a linha “'+a.nome+'”, sua publicação e suas próprias condições. Bônus ou condições da outra linha não são transferidos, e o caso não confirma a necessidade real do cliente.'));
  return{tipo:'comparar_objetos_publicados',pergunta:'Qual objeto publicado atende ao propósito do pedido, antes de comparar as condições de contratação?',
    opcoes,casos,entradaReal:'Objetivo real do pedido, serviços já existentes e condições que precisam da equipe. Os dois objetivos acima são testes fictícios.',
    mecanismo:'A comparação separa os objetos e seus propósitos, com a condição no bloco em que foi publicada. Os dois pedidos têm encaminhamentos preparados, sem escolher pelo desconto ou por uma palavra em comum.',
    limites:['A finalidade é a declaração do site usada no teste, não comprovação de adequação ou de benefício.','Quando uma fonte é de uma modalidade específica, ela é apenas um exemplo: suas condições não cobrem as demais modalidades.','Preço, vigência, renovação, disponibilidade e condições adicionais permanecem para confirmação quando não forem explicitados.']};
}
function porDemandas(o,fs,validar,ofertas){
  const goal=normal(o.jornada?.objetivo);
  if(!/\b(?:contrat|recurso|proposta|orcament|process|pedido|operacao|gestao)\w*/u.test(goal))return null;
  const page=naPagina(fs,o).filter(f=>!restrita(f,o.jornada?.objetivo)&&validar(f,o,ofertas.filter(x=>x.url===f.url)).sustentado);
  const proposta=page.find(f=>/\b(?:criacao|elaboracao|geracao)\b/u.test(normal(f.trecho))&&/\bpropostas?\b/u.test(normal(f.trecho))&&/\b(?:custos|itens|pecas|servicos)\b/u.test(normal(f.trecho)));
  const contrato=preferir(page.filter(f=>/\bcontratos?\b/u.test(normal(f.trecho))&&/\b(?:recursos|produtos|custos|alocacao)\b/u.test(normal(f.trecho))),o)[0];
  if(!proposta||!contrato||proposta.sha256!==contrato.sha256||chave(proposta)===chave(contrato))return null;
  const a=opcao(titulo(proposta),proposta,{etapa:'preparacao_da_proposta'}),b=opcao('Acompanhamento de contratos e recursos',contrato,{etapa:'acompanhamento_do_contrato'});
  return{tipo:'confrontar_demandas_operacionais',pergunta:'A avaliação começa pela preparação de uma proposta ou pelo acompanhamento de recursos de um contrato?',
    opcoes:[a,b],casos:[
      caso('demanda_1',{artefato:'proposta',servico:'serviço fictício A',pecaOuItem:'item fictício B',custos:null,margem:null},
        'Caso fictício: preparar uma proposta que reúne um serviço e um item, mantendo custos e margem ainda a informar.',[a],
        'Conferir o que a publicação diz sobre compor a proposta e quais dados precisam ser apresentados. Não calcular margem nem afirmar que a integração funciona.'),
      caso('demanda_2',{artefato:'contrato',recursosAlocados:null,produtosAlocados:null,custos:null,segmento:null},
        'Caso fictício: um contrato já existe e é preciso conferir como acompanhar os recursos, produtos e custos associados a ele.',[b],
        'Conferir a função de gestão do contrato publicada. O segmento e as integrações ainda precisam ser esclarecidos; uma função restrita a outro segmento não vira necessidade geral.')],
    entradaReal:'Estado do trabalho (proposta ou contrato), segmento, dados e integrações do processo real. Os nomes e itens dos testes são fictícios.',
    mecanismo:'Os pedidos diferem pelo artefato e momento do trabalho. O roteiro liga cada demanda à função publicada e prepara a pergunta para demonstração, sem mandar apenas ler uma lista de recursos.',
    limites:['Não conclui adequação do sistema, implantação, execução terceirizada, compliance ou rentabilidade.','A relação entre funções/módulos precisa de demonstração; presença na mesma página não prova integração ou inclusão no mesmo plano.']};
}
function proximoPasso(plano,interacoes){
  const fontes=juntar(plano.opcoes.flatMap(a=>[a.fonte,...lista(a.condicoes)]));
  for(const f of fontes){
    const instrucao=/^(?:Compre|Escolha|Acesse|Solicite|Fale|Entre|Registre|Encontre)\b/iu.test(titulo(f));
    if(instrucao)return{tipo:'instrucao_publicada',descricao:'Na página '+f.url+', localize “'+titulo(f)+'” e confronte a instrução publicada. O percurso não foi executado.',fonte:f};
  }
  const c=lista(interacoes).find(i=>i.htmlInicial===true&&i.modo==='nao_preenchido'&&['botao','link'].includes(i.tipo)&&['contatar','solicitar_orcamento','agendar'].includes(i.acao)&&
    (i.acao!=='contatar'||rotuloContatoExplicito(i.rotulo))&&
    fontes.some(f=>i.url===f.url&&i.sha256===f.sha256));
  if(c)return{tipo:'canal_da_pagina',descricao:'Na página '+c.url+', o rótulo “'+c.rotulo+'” é um canal observado para esclarecer o roteiro. Não comprova atendimento, adequação ou contratação; nenhum envio foi feito.',
    fonte:{...c,trecho:c.rotulo,tipo:'interface_publica',natureza:'rotulo_literal'}};
  const f=fontes.find(x=>texto(x.secao));
  return f?{tipo:'consulta_de_bloco_publicado',descricao:'Abra '+f.url+' e localize o bloco “'+titulo(f)+'” para conferir esta decisão. O canal de matrícula/compra e seu funcionamento continuam desconhecidos.',fonte:f}:null;
}
const campo=(rotulo,valorSugerido,origem,evidencia=null)=>({rotulo,valorSugerido,origem,...(evidencia?{evidencia}:{})});
/** Compiles a public choice into two proposed needs and expected reading routes.
 * It never treats a proposed need, case match or publisher claim as client truth.
 */
export function prepararDecisaoPublicada(tarefa,{oferta,ofertas=[],fontes=[],interacoes=[],cobertura,validarVinculo,agora=Date.now}={}){
  if(typeof validarVinculo!=='function'||!texto(oferta?.jornada?.objetivo))return null;
  if(/^(?:nao|nunca)\s+(?:compar|distingu|separ)|\bnao (?:quero|preciso|pretendo) comparar\b/u.test(normal(oferta.jornada.objetivo)))return null;
  const fs=fontesValidas(fontes,cobertura,agora);
  const plano=porIdade(oferta,fs)||porCorrecao(oferta,fs,validarVinculo,ofertas)||porPresencaRecurso(oferta,fs,validarVinculo,ofertas)||porInterfaceOuIntegracao(oferta,fs,validarVinculo,ofertas)||porDemandas(oferta,fs,validarVinculo,ofertas)||porObjetos(oferta,ofertas,fs,validarVinculo);
  if(!plano)return null;
  const fontesUsadas=juntar(plano.opcoes.flatMap(a=>[a.fonte,...lista(a.condicoes)]));
  const proximos=plano.opcoes.map(a=>({alternativaId:a.id,nome:a.nome,passo:proximoPasso({opcoes:[a]},interacoes)}));
  const rotasComPasso=proximos.filter(p=>p.passo),iguais=rotasComPasso.length===proximos.length&&new Set(rotasComPasso.map(p=>JSON.stringify([p.passo.tipo,p.passo.descricao]))).size===1;
  const passo=iguais?rotasComPasso[0].passo:rotasComPasso.length?{tipo:'condicional_por_alternativa',descricao:proximos.map(p=>p.nome+': '+(p.passo?.descricao||'próximo passo desconhecido.')).join(' | '),fonte:null}:null;
  for(const c of plano.casos)c.esperado.proximosPassos=proximos.filter(p=>c.esperado.alternativas.includes(p.alternativaId));
  const campos=[
    campo('Decisão a preparar',plano.pergunta,'hipotese_controlada'),
    campo('Entradas reais ainda necessárias',plano.entradaReal,'a_confirmar'),
    ...plano.casos.map((c,i)=>campo('Caso fictício '+(i+1)+' e encaminhamento esperado',c.necessidade+' Encaminhamento: '+c.esperado.alternativas.map(i=>plano.opcoes.find(a=>a.id===i)?.nome).join(' ou ')+'. '+c.esperado.justificativa+' Próximo passo deste caso: '+c.esperado.proximosPassos.map(p=>p.passo?.descricao||'desconhecido').join(' ou '),'hipotese_controlada')),
    ...plano.opcoes.map(a=>campo('Alternativa publicada: '+a.nome,(a.faixa?'Faixa mencionada: '+a.faixa.literal+'. ':'')+'Seção coletada: “'+titulo(a.fonte)+'”. '+a.fonte.trecho,'trecho_publicado',a.fonte)),
    campo('Próximo passo publicado ou observado',passo?.descricao||null,passo?'trecho_publicado':'a_confirmar',passo?.fonte),
    campo('Mensagem preparada para esclarecer o caso','Quero comparar estas necessidades: '+plano.casos.map(c=>c.necessidade).join(' / ')+'. Preciso confirmar '+plano.entradaReal,'hipotese_controlada'),
    campo('Condições e limites da comparação',plano.limites.join(' '),'a_confirmar'),
  ];
  const incertezas=[plano.entradaReal,...plano.limites];
  const comparadas=plano.opcoes.filter(a=>a.ofertaId).map(a=>({id:a.ofertaId,nome:a.ofertaNome||a.nome})),grupo=plano.tipo==='comparar_objetos_publicados'?id(comparadas.map(a=>a.id).sort()):null;
  return{...tarefa,...(comparadas.length>1?{ofertasAfetadas:comparadas}:{}),tipo:'conferir_oferta',eixo:'negocio',base:'hipotese',titulo:(plano.titulo||'Preparar a decisão: '+plano.pergunta)+' — '+oferta.nome,
    acao:plano.mecanismo+' Use os dois casos fictícios já preparados para conferir alternativas e encaminhamento na página; uma necessidade real ainda não foi confirmada.',
    entregavel:'Comparativo preenchido com duas necessidades de teste, alternativas/fontes, respostas esperadas, pendências e mensagem pronta para o próximo passo.',
    modeloEntregavel:{versao:1,tipo:'decisao_com_necessidades',natureza:'hipotese_editorial',campos,
      limite:'Os casos foram propostos para testar uma escolha; não são dados ou necessidades confirmados do cliente. Uma correspondência de publicação não confirma adequação, elegibilidade, resultado nem funcionamento.'},
    passos:['Responsável: quem conhece a oferta e quem revisa o conteúdo. Use os dados dos dois casos abaixo, mantendo-os como hipóteses controladas.',
      ...plano.casos.map(c=>'Entrada preparada: '+c.necessidade+' Resultado a conferir: '+c.esperado.justificativa),
      'Use o próximo passo registrado: '+(passo?.descricao||'nenhum canal de avanço foi sustentado; registre a pergunta específica no roteiro sem inventar contato.'),
      'Registre qual condição ou encaminhamento muda entre os casos. Só proponha edição se a dúvida for observada; se a página já sustentar a escolha, preserve-a. Não contrate, inscreva ou envie dados reais.'],
    criterioSucesso:'O registro dos dois casos identifica o dado que distingue a necessidade, a alternativa e sua fonte, as condições que permanecem desconhecidas e o próximo passo publicado ou pendente. As saídas são rotas de conferência, sem aprovar plano, matrícula, elegibilidade ou ganho financeiro.',
    evidenciasNegocio:fontesUsadas,evidencias:[...fontesUsadas,...(passo?.fonte?.tipo==='interface_publica'?[passo.fonte]:[])],
    decisaoCliente:{objeto:oferta.nome,objetivo:texto(oferta.jornada.objetivo),escolha:plano.pergunta,
      fatos:fontesUsadas.map(f=>({descricao:f.trecho,evidencias:[f]})),percurso:plano.casos.map(c=>c.necessidade),
      restricoes:plano.limites,incertezas,resultadoAConferir:'Relacionar os dois pedidos preparados às fontes e ao próximo passo, sem transferir condições entre alternativas.'},
    decisao:{familia:'decisao_publicada',origemDeSelecao:structuredClone(tarefa.decisao||{}),escopoConfirmado:false,decisaoPreparada:{versao:1,tipo:plano.tipo,comparacaoGrupo:grupo,pergunta:plano.pergunta,
      casos:plano.casos,alternativas:plano.opcoes,entradaReal:plano.entradaReal,proximoPasso:passo,proximosPassos:proximos,incertezas,
      origemDasNecessidades:'hipotese_controlada',confirmacaoRealCliente:false}},
  };
}
