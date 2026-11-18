import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {extrairContextoPublico} from '../src/modulos/contexto-publico.mjs';
import {inferirPerfil, corrigirPerfil} from '../src/modulos/perfil.mjs';
import {descobrirTermos} from '../src/descoberta.mjs';
import {ErroConsulta} from '../src/consulta.mjs';
import {refinarPlanoAssistido} from '../src/modulos/prioridades-assistidas.mjs';
import {avaliarOportunidades} from '../src/modulos/oportunidades.mjs';

// Controlled development cases. These are illustrative HTML, not live clients.
const dominio = 'exemplo.com.br', coletadoEm = '2026-11-15T20:00:00.000Z';
function executar(html, caminho = '/', adicionais = []) {
  const captura = {dominio,coletadoEm,paginas:[{url:'https://'+dominio+caminho,html,status:200,coletadoEm},...adicionais]};
  const contextoPublico = extrairContextoPublico(captura);
  return {contextoPublico,perfil:inferirPerfil({dominio,coletadoEm,contextoPublico,descoberta:descobrirTermos(captura)})};
}
const nomes = p => p.ofertas.map(o=>o.nome).join('\n');

test('descoberta conserva evento de catálogo com URL plana sem inferir sua produção pelo negócio', () => {
  const oferta = 'Produção de Eventos';
  const evento = 'Recital municipal de piano — Projeto Música no Bairro';
  const html = '<title>Agenda Cultural</title>' +
    '<section class="event-description"><a href="/recital-municipal.html"><h2 class="event-title">' + evento +
    '</h2></a><p class="event-date">18/11/2026</p></section>' +
    '<section class="event-description"><a href="/servicos/producao"><h2 class="event-title">' + oferta + '</h2></a></section>';
  const {perfil,contextoPublico} = executar(html);
  assert.deepEqual(perfil.ofertas.map(o => o.nome), [oferta]);
  assert.ok(![...contextoPublico.evidencias,...contextoPublico.detalhesPublicados].some(e => e.trecho.includes(evento)));
  const descoberta = descobrirTermos({dominio,paginas:[{url:'https://'+dominio+'/',html,status:200,coletadoEm}]});
  const cadastrado = descoberta.candidatos.find(c => c.termo === 'Recital municipal de piano');
  assert.equal(cadastrado?.tipo, 'tema');
  assert.equal(cadastrado.evidencia.trecho, evento);
  assert.ok(!descoberta.candidatos.some(c => c.termo === 'Projeto Música no Bairro'));
});

test('orçamentos de prestadores separam percurso da plataforma e trabalhos anunciados',()=>{
  const url='https://'+dominio+'/';
  const pedido='<p>Recebemos 12.000 solicitações de contratantes que procuram prestadores do bairro.</p>';
  const comparacao='<meta name="description" content="Compare orçamentos sem compromisso.">';
  const {perfil,contextoPublico}=executar('<title>Vizinhança de Serviços</title>'+comparacao+pedido+
    '<h2>Cursos de artesanato</h2><p>Receba até 3 orçamentos.</p>');
  assert.equal(perfil.entendimento.papel,'intermediacao');
  assert.deepEqual(perfil.ofertas.map(o=>[o.nome,o.url]),[['orçamentos',null]]);
  const publicada=perfil.entendimento.relacoes.find(r=>r.forma==='comparacao_de_orcamentos');
  assert.equal(publicada.tipo,'conexao_entre_partes');
  assert.ok(publicada.evidencias.every(e=>e.url===url&&e.sha256===publicada.evidencias[0].sha256));
  const confirmado=corrigirPerfil(perfil,{confirmado:true,ofertas:[{nome:'Comparação de orçamentos',url}]});
  const trabalho=refinarPlanoAssistido({dominio,perfil:confirmado,contextoPublico}, {},{agora:()=>Date.parse(coletadoEm)+1000});
  const tarefa=trabalho.tarefasDisponiveis.find(t=>t.decisao?.familia==='conferir_jornada_de_orcamentos');
  assert.equal(tarefa?.decisao.escopoConfirmado,false);
  assert.ok(tarefa.evidencias.some(e=>e.trecho==='Receba até 3 orçamentos.'));

  const semVinculo=executar('<title>Vizinhança de Serviços</title>'+comparacao,'/',[
    {url:url+'blog/exemplo',html:pedido,status:200,coletadoEm},
  ]).perfil;
  assert.ok(!semVinculo.entendimento.relacoes.some(r=>r.forma==='comparacao_de_orcamentos'));
});

test('intermediação de pagamentos tem ficha apenas quando o aviso aparece na página da oferta',()=>{
  const url='https://'+dominio+'/';
  const aviso='<p>A Exemplo faz a intermediação de pagamentos entre várias empresas e consumidores. No boleto recebido, pode aparecer o nome da Exemplo.</p>';
  const produto='<title>Plataforma de cobrança</title><h1>Plataforma de cobrança</h1>';
  const {perfil,contextoPublico}=executar('<title>Exemplo</title>'+aviso,'/',[
    {url:url+'cobranca',html:produto+aviso,status:200,coletadoEm},
    {url:url+'outro-pagamento',html:produto,status:200,coletadoEm},
  ]);
  const r=perfil.entendimento.relacoes.find(r=>r.forma==='intermediacao_entre_partes');
  assert.deepEqual(r.atores,['empresas','consumidores']);
  assert.equal(perfil.entendimento.papel,'intermediacao');
  const agora=()=>Date.parse(coletadoEm)+1000;
  function abrir(caminho){
    const p=corrigirPerfil(perfil,{confirmado:true,ofertas:[{nome:'Plataforma de cobrança',url:url+caminho}]});
    return refinarPlanoAssistido({dominio,perfil:p,contextoPublico},{},{agora})
      .tarefasDisponiveis.find(t=>t.decisao?.familia==='conferir_destinatario_da_cobranca');
  }
  assert.equal(abrir('cobranca')?.evidencias[0].url,url+'cobranca');
  assert.equal(abrir('outro-pagamento'),undefined);
});

test('descrição principal preserva o objeto literal e títulos promocionais não ocupam o perfil',()=>{
  const h='<title>Exemplo | Crie sua loja virtual</title><meta name="description" content="Descubra a melhor plataforma de e-commerce para montar sua loja."><h1>A era do lojista perder vendas acabou</h1><h2>O CRM mais completo do mercado</h2>';
  const htmlPlanos='<title>Recursos, Planos e Preços para criar sua loja</title><h2>Gestão completa dentro da plataforma</h2>';
  const {perfil}=executar(h,'/',[{url:'https://'+dominio+'/planos',html:htmlPlanos,status:200,coletadoEm}]);
  const oferta=perfil.ofertas.find(o=>o.nome==='plataforma de e-commerce');
  assert.equal(oferta?.evidencias[0].campo,'meta.description');
  assert.match(oferta.evidencias[0].trecho,/plataforma de e-commerce/);
  assert.doesNotMatch(nomes(perfil),/A era|mais completo|Recursos, Planos|Gestão completa/u);
});

test('recrutamento, título institucional e setores atendidos não viram ofertas ou programas de participação',()=>{
  const pagina=(caminho,html)=>({url:'https://'+dominio+caminho,html,status:200,coletadoEm});
  const {perfil}=executar('<title>Empresa Exemplo</title><h1>Plataforma de atendimento</h1><h3>Serviços Financeiros</h3><a href="/segmentos/financeiro">Serviços Financeiros</a><a href="/carreiras">Trabalhe conosco</a><a href="/seja-parceiro">Seja parceiro</a>','/',[
    pagina('/carreiras','<title>Trabalhe conosco</title><h1>Faça parte do nosso time</h1>'),
    pagina('/seja-parceiro','<title>Seja parceiro</title><h1>Seja parceiro</h1><p>Cadastre sua empresa interessada em distribuir nossas soluções.</p>'),
    pagina('/nossa-historia','<title>Sobre a Exemplo: Gestão inteligente</title><h2>Cada venda que você faz transforma uma vida. Comece agora</h2>'),
    pagina('/segmentos/financeiro','<title>Serviços Financeiros | Exemplo</title><h1>Plataforma para bancos e fintechs</h1><h2>Venda mais e atenda melhor na Black Friday</h2>'),
    pagina('/contato','<title>Contato Exemplo: Fale com Especialistas em Gestão</title>'),
  ]);
  assert.match(nomes(perfil),/Plataforma para bancos e fintechs/i);
  assert.doesNotMatch(nomes(perfil),/Sobre a Exemplo|Comece agora|Serviços Financeiros|Black Friday|Contato Exemplo/i);
  const participacoes=perfil.entendimento.atuacoes.filter(a=>a.tipo==='participacao');
  assert.ok(participacoes.some(a=>/seja parceiro/i.test(a.nome)));
  assert.ok(participacoes.every(a=>!a.url.endsWith('/carreiras')));
});

test('título e cabeçalho do mesmo convite de agenciamento preservam duas fontes e uma tarefa de candidatura', () => {
  const oferecer = 'Seja um artista exclusivo da Agência Exemplo';
  const anuncio = 'Seja um artista exclusivo de música regional ou popular';
  const url = 'https://'+dominio+'/seja-artista';
  const html = '<title>'+anuncio+'</title><h1>'+oferecer+'</h1>'+
    '<meta name="description" content="Agenciamento exclusivo para artistas de música regional ou popular.">'+
    '<p>Esta página reúne as informações de apresentação para artistas. A equipe recebe as candidaturas e registra as etapas da avaliação. O contato inicial explica o prazo de retorno e os materiais para encaminhar a candidatura.</p>';
  const outra = {url:'https://'+dominio+'/seja-artista-local',html:'<h1>Seja um artista exclusivo no litoral</h1>',status:200,coletadoEm};
  const {perfil,contextoPublico} = executar('<h1>Agência de artistas e shows</h1>','/',[
    {url,html,status:200,coletadoEm,sha256:createHash('sha256').update(html).digest('hex')},outra,
  ]);
  const atividades = perfil.entendimento.atuacoes.filter(a => a.tipo==='participacao'&&a.url===url);
  assert.equal(atividades.length,1);
  assert.equal(atividades[0].nome,oferecer);
  assert.deepEqual(atividades[0].evidencias.map(e=>e.campo).sort(),['h1','title']);
  assert.ok(perfil.entendimento.atuacoes.some(a=>a.url===outra.url));
  assert.ok(!perfil.ofertas.some(o=>o.url===url));
  const confirmado = corrigirPerfil(perfil,{confirmado:true});
  const plano = avaliarOportunidades({perfil:confirmado,contextoPublico},
    {agora:()=>Date.parse(coletadoEm)+1000});
  const tarefas = plano.planoDeAcao.filter(t=>t.paginaAlvo?.url===url);
  assert.equal(tarefas.length,1);
  assert.match(tarefas[0].titulo,/candidatura ao agenciamento/);
  assert.ok(tarefas[0].modeloEntregavel.campos.some(c=>c.evidencia?.campo==='meta.description'));
  assert.ok(!tarefas[0].passos.join(' ').includes('doador'));
});

test('hotel preserva categoria e objeto de hospedagem publicados, sem vender a chamada de reserva', () => {
  const {perfil} = executar('<title>Rede Brisa | Site Oficial</title><meta name="description" content="Faça sua reserva. Hotéis na serra para viagens de lazer."><h1>Encontre sua próxima experiência</h1><p>Somos uma rede de hotéis que oferece hospedagem para famílias e viajantes.</p>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.match(nomes(perfil),/Hotéis na serra|hospedagem/i);
  assert.ok(!/Faça sua reserva|Encontre sua próxima/.test(nomes(perfil)));
  assert.ok(perfil.ofertas.every(o=>o.evidencias.length));
});

test('assinatura educacional encontra cabeçalho de cursos, removendo somente contagem editorial', () => {
  const {perfil} = executar('<title>Hub de Aprendizado | Assinatura</title><meta name="description" content="Mais de cem cursos e trilhas de formação."><h4>+100 Cursos Online</h4><h2>Planos</h2><p>Oferecemos cursos online para profissionais de tecnologia.</p>');
  assert.match(nomes(perfil),/Cursos Online/i);
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.ok(!perfil.ofertas.some(o=>o.nome==='Planos'));
});

test('fabricante identifica categorias nominais do catálogo e não o slogan', () => {
  const {perfil} = executar('<title>Equipamentos da Serra</title><h1>O produto perfeito para sua necessidade</h1><p>Somos fabricantes de equipamentos para uso residencial e industrial.</p><p>Nosso portfólio inclui Compressores de Ar.</p><h2>Ferramentas Elétricas</h2>','/produtos');
  assert.equal(perfil.entendimento.papel,'produtos');
  assert.match(nomes(perfil),/Compressores de Ar|Ferramentas Elétricas/);
  assert.ok(!/produto perfeito/.test(nomes(perfil)));
});

test('imobiliária e corretora têm papel de intermediação pelas declarações próprias', () => {
  for(const html of [
    '<title>Imobiliária na capital - Imóveis à Venda e Locação</title><meta name="description" content="Comprar e alugar imóveis com a nossa imobiliária.">',
    '<title>Corretora de seguros</title><h1>Consultoria de seguros</h1><p>Somos uma corretora de seguros para empresas.</p>',
  ]) assert.equal(executar(html).perfil.entendimento.papel,'intermediacao');
});

test('organização social modela missão e beneficiários, sem vender programas ou doações', () => {
  const {perfil} = executar('<title>Instituto Horizonte</title><p>Somos uma organização sem fins lucrativos que atua com famílias em comunidades precárias.</p><h2>Missão</h2><p>Desenvolver soluções de moradia e educação para famílias em situação de vulnerabilidade.</p><h2>Programa Moradia Digna</h2><p>Nosso programa de moradia atende famílias em comunidades precárias.</p><h2>Doação de produtos</h2><p>Mobilizamos jovens voluntários para trabalhar junto às comunidades.</p>');
  assert.equal(perfil.entendimento.finalidade?.tipo,'social');
  assert.equal(perfil.entendimento.papel,'indefinido');
  assert.ok(perfil.entendimento.proposito?.texto);
  assert.ok(perfil.entendimento.publicos.some(p=>p.tipo==='beneficiario'&&/famílias/i.test(p.texto)));
  assert.ok(perfil.entendimento.publicos.some(p=>p.tipo==='participante'&&/voluntários/i.test(p.texto)));
  assert.ok(perfil.entendimento.atuacoes.some(a=>a.tipo==='programa_social'));
  assert.ok(perfil.entendimento.atuacoes.some(a=>a.tipo==='captacao'));
  assert.equal(perfil.ofertas.length,0);
});

test('finalidade social preserva venda explicitamente declarada sem converter programa em produto', () => {
  const {perfil} = executar('<title>Instituto Costura</title><p>Somos uma organização sem fins lucrativos.</p><p>Vendemos camisetas de algodão para financiar nossos programas sociais.</p><h2>Programa de alfabetização</h2>');
  assert.equal(perfil.entendimento.finalidade?.tipo,'social');
  assert.match(nomes(perfil),/camisetas de algodão/i);
  assert.ok(!/Programa de alfabetização/.test(nomes(perfil)));
});

test('campanha de doação não prova que uma loja é organização social', () => {
  const {perfil} = executar('<title>Loja de Móveis</title><p>Vendemos móveis para residências.</p><h2>Doe alimentos neste Natal</h2>');
  assert.equal(perfil.entendimento.finalidade?.tipo,'comercial');
  assert.equal(perfil.entendimento.papel,'produtos');
});

test('declarações incompatíveis registram conflito e abstenção, em vez de escolher a primeira', () => {
  const {perfil} = executar('<title>Empresa Exemplo</title><p>Somos uma corretora de seguros que faz a intermediação de apólices.</p><p>Não fazemos intermediação de seguros. Prestamos apenas serviços de consultoria.</p>');
  assert.equal(perfil.entendimento.papel,'indefinido');
  assert.equal(perfil.entendimento.qualidade?.estado,'conflitante');
  assert.ok(perfil.entendimento.conflitos.some(c=>c.campo==='papel'));
});

test('HTML sem conteúdo útil mantém negócio e finalidade desconhecidos', () => {
  const {perfil,contextoPublico} = executar('<html><body><div id="app"></div><script>window.empresa="Corretora de seguros"</script></body></html>');
  assert.equal(perfil.entendimento.papel,'indefinido');
  assert.equal(perfil.entendimento.finalidade?.tipo,'indefinida');
  assert.equal(perfil.entendimento.qualidade?.estado,'insuficiente');
  assert.equal(perfil.ofertas.length,0);
  assert.equal(contextoPublico.cobertura.paginas[0].caracteresTextoVisivel,0);
});

test('depoimentos, formulários e texto escondido não declaram identidade do negócio', () => {
  const {perfil,contextoPublico} = executar('<title>Exemplo</title><section class="testimonial"><p>Somos uma corretora de seguros cliente da plataforma.</p></section><form><p>Somos uma ONG</p></form><p hidden>Somos fabricantes de máquinas.</p><p>Oferecemos software de gestão para corretoras de seguros.</p>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.ok(!contextoPublico.evidencias.some(e=>/cliente da plataforma|Somos uma ONG|Somos fabricantes/.test(e.trecho)));
});

test('contexto editorial menciona produtos sem assumir que o autor os vende', () => {
  const {perfil} = executar('<title>Compressores de Ar: como escolher</title><p>Somos uma corretora de seguros, diz nosso entrevistado.</p><h2>Ferramentas Elétricas</h2>','/blog/comparacao');
  assert.equal(perfil.entendimento.papel,'indefinido');
  assert.equal(perfil.ofertas.length,0);
});

test('declaração negativa não cria oferta nem papel de fabricante por palavra isolada', () => {
  const {perfil} = executar('<title>Exemplo</title><p>Não somos fabricantes de equipamentos e não vendemos compressores de ar.</p><p>Oferecemos consultoria industrial.</p>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.ok(!/compressores|fabricantes/i.test(nomes(perfil)));
  assert.match(nomes(perfil),/consultoria industrial/i);
});

test('cobertura por página conserva hash, data, quantidade visível e recorte HTML inicial', () => {
  const html='<title>Exemplo</title><p>Somos uma escola de formação profissional.</p>';
  const {contextoPublico} = executar(html);
  const pagina=contextoPublico.cobertura.paginas[0];
  assert.equal(pagina.htmlInicial,true);
  assert.equal(pagina.coletadoEm,coletadoEm);
  assert.equal(pagina.sha256,createHash('sha256').update(html).digest('hex'));
  assert.ok(pagina.caracteresTextoVisivel>20);
  assert.ok(!JSON.stringify(contextoPublico).includes('<title>'));
});

test('correção de papel não converte finalidade inferida nem outras fontes em declaração do usuário', () => {
  const {perfil} = executar('<title>Loja de Móveis</title><p>Vendemos móveis para residências.</p>');
  const corrigido=corrigirPerfil(perfil,{papel:'misto',resumo:'Também prestamos serviços de montagem.'});
  assert.equal(corrigido.entendimento.natureza,'declaracao_usuario');
  assert.deepEqual(corrigido.entendimento.finalidade,perfil.entendimento.finalidade);
  assert.equal(corrigido.entendimento.finalidade.natureza,'hipotese');
  const declarado=corrigirPerfil(corrigido,{finalidade:'social'});
  assert.equal(declarado.entendimento.finalidade.natureza,'declaracao_usuario');
  assert.deepEqual(declarado.entendimento.finalidade.evidencias,[]);
  assert.throws(()=>corrigirPerfil(perfil,{finalidade:'beneficente'}),ErroConsulta);
});

test('atividades sociais são corrigíveis, removíveis e confirmáveis sem ofertas comerciais', () => {
  const {perfil} = executar('<title>Instituto</title><p>Somos uma organização sem fins lucrativos.</p><h2>Programa de moradia</h2>');
  const entrada={finalidade:'social',atuacoes:[{tipo:'programa_social',nome:'Moradia e habitat',url:'https://exemplo.com.br/programas'}],confirmado:true};
  const p=corrigirPerfil(perfil,entrada);
  assert.equal(p.estado,'confirmado');
  assert.equal(p.ofertas.length,0);
  assert.equal(p.entendimento.atuacoes[0].natureza,'declaracao_usuario');
  assert.deepEqual(p.entendimento.atuacoes[0].evidencias,[]);
  assert.equal(corrigirPerfil(p,{resumo:'Missão revisada'}).entendimento.atuacoes[0].nome,'Moradia e habitat');
  assert.equal(corrigirPerfil(p,{atuacoes:[]}).entendimento.atuacoes.length,0);
  assert.throws(()=>corrigirPerfil(p,{atuacoes:[{tipo:'produto',nome:'Nome'}]}),ErroConsulta);
  assert.throws(()=>corrigirPerfil(p,{atuacoes:[{tipo:'captacao',nome:'Nome',url:'https://fora.com/'}]}),ErroConsulta);
  assert.throws(()=>corrigirPerfil(p,{atuacoes:Array.from({length:9},(_,n)=>({tipo:'captacao',nome:'Nome '+n}))}),ErroConsulta);
});

test('renomear ou trocar o tipo de atividade não importa evidências da hipótese anterior', () => {
  const {perfil} = executar('<title>Instituto</title><p>Somos uma organização sem fins lucrativos.</p><h2>Programa Moradia Digna</h2>');
  const a=perfil.entendimento.atuacoes.find(a=>a.tipo==='programa_social');
  assert.ok(a?.evidencias.length);
  const igual=corrigirPerfil(perfil,{atuacoes:[{tipo:a.tipo,nome:a.nome,url:a.url}]}).entendimento.atuacoes[0];
  assert.deepEqual(igual.evidencias,a.evidencias);
  const renome=corrigirPerfil(perfil,{atuacoes:[{tipo:a.tipo,nome:'Outro programa',url:a.url}]}).entendimento.atuacoes[0];
  assert.deepEqual(renome.evidencias,[]);
  const tipo=corrigirPerfil(perfil,{atuacoes:[{tipo:'participacao',nome:a.nome,url:a.url}]}).entendimento.atuacoes[0];
  assert.deepEqual(tipo.evidencias,[]);
});

test('subtipo estruturado próprio pode declarar papel, organização externa não o transfere', () => {
  const schema=v=>'<script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org',...v})+'</script>';
  const propria=executar('<title>Exemplo</title>'+schema({'@type':'InsuranceAgency',name:'Corretora Exemplo',url:'https://exemplo.com.br/'})).perfil;
  assert.equal(propria.entendimento.papel,'intermediacao');
  const externa=executar('<title>Exemplo</title>'+schema({'@type':'InsuranceAgency',name:'Corretora Externa',url:'https://fora.com/'})).perfil;
  assert.equal(externa.entendimento.papel,'indefinido');
});

test('ferramentas de carreira em plataforma educacional não indicam venda de ferramentas físicas', () => {
  const {perfil}=executar('<title>Hub de Formação | Assinatura</title><p>Ferramentas de Carreira IA como: Construtor CV e Validador de currículo.</p><h4>+120 Cursos Online</h4>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.ok(perfil.ofertas.some(o=>o.nome==='Cursos Online'));
  assert.ok(!perfil.ofertas.some(o=>/Ferramentas de Carreira/.test(o.nome)));
});

test('corretora de saúde e de benefícios preserva intermediação sem vender a frase institucional', () => {
  const {perfil}=executar('<title>Corretora de planos de saúde empresariais</title><h1>A corretora que cuida da saúde da sua empresa</h1><p>Somos uma corretora de benefícios que orienta as escolhas das pessoas.</p><h2>Consultoria de benefícios</h2>');
  assert.equal(perfil.entendimento.papel,'intermediacao');
  assert.ok(!/Somos uma|A corretora que/.test(nomes(perfil)));
  assert.match(nomes(perfil),/planos de saúde/);
});

test('portfólio industrial dá contexto a sistema físico, mas mantém serviço separado explicitamente declarado', () => {
  const base='<title>Exemplo</title><p>Nosso portfólio apresenta uma ampla linha de produtos para geração de ar comprimido e equipamentos industriais.</p><h2>Compressores de Ar</h2><h1>Sistema de purificação de ar comprimido</h1>';
  const p=executar(base).perfil;
  assert.equal(p.entendimento.papel,'produtos');
  assert.ok(!/ampla linha de produtos/.test(nomes(p)));
  const misto=executar(base+'<script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'Service',name:'Manutenção de equipamentos'})+'</script>').perfil;
  assert.equal(misto.entendimento.papel,'misto');
});

test('muitas chamadas de captação não retiram o programa e a participação das oito atividades', () => {
  const chamadas=Array.from({length:20},(_,n)=>'<h3>Doação de materiais '+n+'</h3>').join('');
  const {perfil}=executar('<title>Instituto</title><p>Somos uma organização sem fins lucrativos.</p>'+chamadas+'<h2>Programa de moradia</h2><p>Mobilizamos jovens voluntários em iniciativas de moradia e habitat.</p>');
  const atividades=perfil.entendimento.atuacoes.filter(a=>a.tipo!=='oferta');
  assert.ok(atividades.length<=8);
  for(const tipo of ['programa_social','captacao','participacao'])assert.ok(atividades.some(a=>a.tipo===tipo),tipo);
});

test('rótulo de missão sozinho não inventa uma declaração de propósito', () => {
  const {perfil}=executar('<title>Software de gestão</title><h2>Nossa missão</h2><p>Conheça mais.</p>');
  assert.equal(perfil.entendimento.proposito,null);
});

test('notícia sobre programa de terceiro e fundação histórica não transferem identidade ou atuação', () => {
  const {perfil}=executar('<title>Loja de Móveis</title><h2>Últimas notícias</h2><h3>Parceira lança programa de educação na cidade</h3><p>É oficialmente criada a fundação sem fins lucrativos de outra organização em 1980.</p>');
  assert.equal(perfil.entendimento.finalidade.tipo,'comercial');
  assert.ok(!perfil.entendimento.atuacoes.some(a=>a.tipo==='programa_social'));
});

test('negação de finalidade social não é lida como afirmação e conflito explícito exige revisão', () => {
  const a=executar('<title>Loja de Roupas</title><p>Não somos uma organização sem fins lucrativos.</p>').perfil;
  assert.equal(a.entendimento.finalidade.tipo,'comercial');
  const b=executar('<title>Instituto</title><p>Somos uma organização sem fins lucrativos.</p><p>Somos uma empresa com fins lucrativos.</p>').perfil;
  assert.equal(b.entendimento.finalidade.tipo,'indefinida');
  assert.equal(b.entendimento.qualidade.estado,'conflitante');
  assert.ok(b.entendimento.conflitos.some(c=>c.campo==='finalidade'));
});

test('contradição explícita de fabricação se abstém, lojista que não fabrica continua varejista', () => {
  const conflito=executar('<title>Compressores de Ar</title><p>Somos fabricantes de equipamentos industriais.</p><p>Não somos fabricantes de equipamentos.</p>').perfil;
  assert.equal(conflito.entendimento.papel,'indefinido');
  assert.equal(conflito.entendimento.qualidade.estado,'conflitante');
  const varejo=executar('<title>Loja de Roupas</title><p>Não somos fabricantes de roupas. Vendemos produtos de várias marcas.</p>').perfil;
  assert.equal(varejo.entendimento.papel,'produtos');
  assert.equal(varejo.entendimento.conflitos.length,0);
});

test('atividade de domínio externo e conteúdo aria-hidden em caixa alta não são evidências próprias', () => {
  const {perfil,contextoPublico}=executar('<title>Exemplo</title><p aria-hidden=" TRUE ">Somos uma corretora de seguros.</p><p>Oferecemos consultoria ambiental.</p>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.ok(!contextoPublico.evidencias.some(e=>/corretora/.test(e.trecho)));
  const externo=inferirPerfil({dominio,descoberta:{candidatos:[{termo:'Doação de produtos',tipo:'servico',evidencia:{url:'https://fora.com/',campo:'h2',trecho:'Doação de produtos'}}]}});
  assert.deepEqual(externo.entendimento.atuacoes,[]);
});

test('declaração de escola sem oferta de venda não comprova finalidade comercial', () => {
  const {perfil}=executar('<title>Escola Exemplo</title><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'School',name:'Escola Exemplo',url:'https://exemplo.com.br/'})+'</script>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.equal(perfil.entendimento.finalidade.tipo,'indefinida');
});

test('centro de educação pública identifica finalidade e destinatários sem vender apoio cultural', () => {
  const {perfil}=executar('<title>Instituto de Educação</title><p>Somos um centro de inovação em educação que atua pela qualidade da educação pública e mobilização social.</p><p>Nosso trabalho desenvolve o potencial de crianças e jovens.</p><p>Disponibilizamos propostas educacionais para professores, gestores e redes de ensino.</p><p>Contamos com o apoio de parceiros e doadores para continuar nossa causa.</p><h2>Projeto Apoio Cultural</h2>');
  assert.equal(perfil.entendimento.finalidade.tipo,'social');
  assert.equal(perfil.ofertas.length,0);
  for(const tipo of ['beneficiario','participante','apoiador'])assert.ok(perfil.entendimento.publicos.some(p=>p.tipo===tipo),tipo);
  assert.ok(perfil.entendimento.atuacoes.some(a=>a.tipo==='programa_social'||a.tipo==='captacao'));
});

test('públicos publicados de curso distinguem aluno/participante de empresa destinatária', () => {
  const {perfil}=executar('<title>Cursos de formação profissional</title><p>Ideal para profissionais que buscam atuar como gestores.</p><p>Para alunos que querem ampliar suas habilidades.</p><h2>Esta escola também é para empresas</h2>');
  assert.ok(perfil.entendimento.publicos.some(p=>p.tipo==='cliente'&&/empresas|profissionais/.test(p.texto)));
  assert.ok(perfil.entendimento.publicos.some(p=>p.tipo==='participante'&&/alunos|profissionais/.test(p.texto)));
});

test('núcleo de hotéis e restaurantes precede experiências de uma única página', () => {
  const adicionais=[{url:'https://exemplo.com.br/experiencias',status:200,coletadoEm,
    html:'<title>Experiências</title>'+Array.from({length:12},(_,n)=>'<h2>Aula de dança modalidade '+n+'</h2>').join('')}];
  const {perfil}=executar('<title>Grupo Exemplo</title><h2>Hotéis</h2><h2>Restaurantes</h2><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'Hotel',name:'Grupo Exemplo',url:'https://exemplo.com.br/'})+'</script>','/',adicionais);
  assert.deepEqual(perfil.ofertas.slice(0,2).map(o=>o.nome),['Hotéis','Restaurantes']);
  assert.equal(perfil.entendimento.papel,'servicos');
});

test('equipamento explicitamente de cortesia para hóspedes não estabelece venda de produto', () => {
  const {perfil}=executar('<title>Hotel Exemplo</title><h2>Equipamentos de Surfe</h2><p>Os equipamentos estão disponíveis como cortesia para os hóspedes.</p><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'Hotel',name:'Hotel Exemplo',url:'https://exemplo.com.br/'})+'</script>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.ok(!perfil.ofertas.some(o=>o.nome==='Equipamentos de Surfe'));
  assert.ok(!/como cortesia/.test(nomes(perfil)));
  assert.ok(perfil.entendimento.publicos.some(p=>p.tipo==='beneficiario'&&/hóspedes/.test(p.texto)));
});

test('detalhes de apoio preservam declarações úteis e excluem navegação, formulário e depoimento', () => {
  const {contextoPublico}=executar('<title>Educação</title><nav><p>Segredo do menu</p></nav><h2>Trilha inicial</h2><p>Para profissionais iniciantes, a trilha tem aulas remotas e projetos orientados.</p><h2>Trilha avançada</h2><p>Para profissionais experientes, o programa exige experiência anterior e tem aulas presenciais.</p><form><p>Segredo de formulário</p></form><section class="testimonial"><p>Segredo de depoimento</p></section><footer><p>Segredo do rodapé</p></footer>');
  const detalhes=contextoPublico.detalhesPublicados;
  assert.ok(detalhes.length<=24);
  assert.ok(detalhes.some(t=>/experiência anterior/.test(t.trecho)));
  assert.ok(!JSON.stringify(detalhes).includes('Segredo'));
  assert.equal(detalhes[0].coletadoEm,coletadoEm);
  assert.ok(detalhes.every(t=>t.trecho.length<=360));
});

test('importância publicada é hipótese, revisão é declaração e renomear não herda a importância anterior', () => {
  const {perfil}=executar('<title>Consultoria ambiental</title>');
  const o=perfil.ofertas[0],original=structuredClone(perfil);
  assert.equal(o.centralidade.nivel,'principal');
  assert.equal(o.centralidade.natureza,'hipotese');
  const igual=corrigirPerfil(perfil,{ofertas:[{id:o.id,nome:o.nome,url:o.url,economia:{contribuicaoPorVenda:100}}]}).ofertas[0];
  assert.deepEqual(igual.centralidade,o.centralidade);
  const corrigida=corrigirPerfil(perfil,{ofertas:[{id:o.id,nome:o.nome,url:o.url,centralidade:'complementar'}]}).ofertas[0];
  assert.equal(corrigida.centralidade.natureza,'declaracao_usuario');
  assert.equal(corrigida.centralidade.nivel,'complementar');
  assert.deepEqual(corrigida.centralidade.evidencias,[]);
  const nova=corrigirPerfil(perfil,{ofertas:[{id:o.id,nome:'Auditoria energética',url:o.url}]}).ofertas[0];
  assert.equal(nova.centralidade,undefined);
  const manual=corrigirPerfil(perfil,{ofertas:[{nome:'Auditoria energética',centralidade:'principal'}]}).ofertas[0];
  assert.equal(manual.centralidade.natureza,'declaracao_usuario');
  assert.deepEqual(manual.centralidade.evidencias,[]);
  for(const valor of ['rentavel',false,{nivel:'principal'}])assert.throws(()=>corrigirPerfil(perfil,{ofertas:[{nome:o.nome,centralidade:valor}]}),ErroConsulta);
  assert.deepEqual(perfil,original);
});

test('detalhes reservam quatro trechos por URL antes de preencher sessenta e quatro e marcam recortes', () => {
  const paginas=Array.from({length:12},(_,i)=>({url:'https://exemplo.com.br/pagina-'+i,status:200,coletadoEm,
    html:'<title>Página '+i+'</title>'+Array.from({length:30},(_,j)=>'<h2>Modalidade '+i+'-'+j+'</h2><p>Para profissionais da modalidade '+i+'-'+j+', o formato inclui aulas remotas. '+('Condição pública de apoio. '.repeat(20))+'</p>').join('')}));
  const c=extrairContextoPublico({dominio,coletadoEm,paginas});
  assert.equal(c.detalhesPublicados.length,64);
  for(const p of paginas){const n=c.detalhesPublicados.filter(d=>d.url===p.url).length;assert.ok(n>=4&&n<=24,p.url+':'+n);}
  assert.ok(c.detalhesPublicados.every(d=>d.trecho.length<=360));
  assert.ok(c.detalhesPublicados.some(d=>d.recortado));
  assert.equal(c.coberturaDetalhes.limitada,true);
  assert.equal(c.coberturaDetalhes.limiteTotal,64);
});

test('fonte sem HTML por falha não apresenta cobertura dos detalhes como completa', () => {
  const c=extrairContextoPublico({dominio,paginas:[],falhas:[{url:'https://exemplo.com.br/',motivo:'tempo limite'}]});
  assert.deepEqual(c.detalhesPublicados,[]);
  assert.equal(c.coberturaDetalhes.limitada,true);
});

test('nome regional São não é confundido com o predicado são ao validar frase nominal', () => {
  const {perfil}=executar('<title>Loja de Móveis</title><h2>Móveis de São Bento</h2><h2>Ambiente de exposição</h2><p>Os móveis são oferecidos como cortesia aos visitantes.</p>');
  assert.ok(perfil.ofertas.some(o=>o.nome==='Móveis de São Bento'));
  assert.ok(!perfil.ofertas.some(o=>/são oferecidos/.test(o.nome)));
});

test('remover ofertas e corrigir finalidade não deixa atividades comerciais antigas no perfil', () => {
  const {perfil}=executar('<title>Consultoria ambiental</title>');
  assert.equal(perfil.entendimento.atuacoes.filter(a=>a.tipo==='oferta').length,1);
  const editado=corrigirPerfil(perfil,{ofertas:[],finalidade:'social',atuacoes:[{tipo:'programa_social',nome:'Educação ambiental',url:'https://exemplo.com.br/programas'}],confirmado:true});
  assert.equal(editado.ofertas.length,0);
  assert.ok(editado.entendimento.atuacoes.every(a=>a.tipo!=='oferta'));
  assert.deepEqual(editado.entendimento.atuacoes.map(a=>a.nome),['Educação ambiental']);
  assert.equal(editado.entendimento.finalidade.natureza,'declaracao_usuario');
  assert.equal(editado.entendimento.papel,'indefinido');
  const novo=corrigirPerfil(editado,{ofertas:[{nome:'Reflorestamento',url:'https://exemplo.com.br/servicos'}]});
  assert.deepEqual(novo.entendimento.atuacoes.filter(a=>a.tipo==='oferta').map(a=>a.nome),['Reflorestamento']);
  assert.ok(!JSON.stringify(novo.entendimento.atuacoes).includes('Consultoria ambiental'));
  assert.equal(novo.entendimento.finalidade.tipo,'social');
});

test('condição de cortesia de outro objeto na mesma seção não remove categoria publicada', () => {
  const {perfil}=executar('<title>Loja de Móveis</title><h2>Móveis de São Bento</h2><p>Os vasos decorativos são oferecidos como cortesia aos visitantes.</p>');
  assert.ok(perfil.ofertas.some(o=>o.nome==='Móveis de São Bento'));
});

test('negação em segunda frase não promove fragmento de oferta e não remove outro serviço afirmado', () => {
  const trecho='Oferecemos consultoria industrial. Não oferecemos aluguel de máquinas.';
  const fonte={url:'https://exemplo.com.br/servicos',campo:'p',trecho,coletadoEm,sha256:'a'.repeat(64)};
  const perfil=inferirPerfil({dominio,descoberta:{candidatos:[
    {termo:'Consultoria industrial',tipo:'servico',evidencia:fonte},
    {termo:'Aluguel de máquinas',tipo:'servico',evidencia:fonte},
  ]}});
  assert.deepEqual(perfil.ofertas.map(o=>o.nome),['Consultoria industrial']);
});

test('verbo próprio de intermediação identifica o papel sem deduzir representação de entidades citadas', () => {
  const {perfil}=executar('<title>Serviços para eventos</title><p>Intermediamos a contratação entre organizadores de eventos e fornecedores.</p><p>Atendemos contratantes e organizadores de eventos.</p>');
  assert.equal(perfil.entendimento.papel,'intermediacao');
  assert.ok(perfil.entendimento.publicos.some(p=>p.tipo==='cliente'&&/contratantes|organizadores/.test(p.texto)));
  assert.ok(!perfil.ofertas.some(o=>/representação|exclusividade/i.test(o.nome)));
});

test('cortesia liga material genérico ao qualificador literal do cabeçalho, sem inverter uma negação', () => {
  const h='<title>Hotel Exemplo</title><h2>Equipamentos de mergulho</h2>';
  const a=executar(h+'<p>Disponibilizamos materiais de mergulho como cortesia para os hóspedes.</p>').perfil;
  assert.ok(!a.ofertas.some(o=>o.nome==='Equipamentos de mergulho'));
  const b=executar(h+'<p>Não oferecemos materiais de mergulho como cortesia. Alugue os equipamentos separadamente.</p>').perfil;
  assert.ok(b.ofertas.some(o=>o.nome==='Equipamentos de mergulho'));
});

test('banner de projeto sem descrição não cria programa de beneficiário, descrição ligada sustenta hipótese', () => {
  const cabeca='<title>Instituto</title><p>Somos uma organização sem fins lucrativos.</p>';
  const a=executar(cabeca+'<h2>Projeto Apoio Cultural</h2><a href="/apoio">Saiba mais</a>').perfil;
  assert.ok(!a.entendimento.atuacoes.some(a=>a.nome==='Projeto Apoio Cultural'));
  const b=executar(cabeca+'<h2>Projeto de alfabetização</h2><p>Oferecemos formação e atividades de alfabetização para crianças da comunidade.</p>').perfil;
  assert.ok(b.entendimento.atuacoes.some(a=>a.tipo==='programa_social'&&a.nome==='Projeto de alfabetização'));
  assert.ok(b.entendimento.atuacoes.find(a=>a.nome==='Projeto de alfabetização').evidencias.some(e=>e.campo==='p'&&/Oferecemos formação/.test(e.trecho)));
});

test('grupo nominal termina antes de oração com infinitivo flexionado, preservando a evidência original', () => {
  const frase='Nosso trabalho ajuda jovens a cruzarem suas próprias linhas de chegada com mais oportunidades.';
  const {perfil}=executar('<title>Instituto</title><p>Somos uma organização sem fins lucrativos.</p><p>'+frase+'</p>');
  const grupo=perfil.entendimento.publicos.find(p=>p.tipo==='beneficiario'&&/^jovens/i.test(p.texto));
  assert.equal(grupo.texto,'jovens');
  assert.equal(grupo.natureza,'hipotese');
  assert.equal(grupo.evidencias[0].trecho,frase);
  assert.equal(grupo.evidencias[0].coletadoEm,coletadoEm);
});

test('oração de finalidade e predicado verbal não são parte do nome do público', () => {
  const a=executar('<title>Cursos profissionais</title><p>Oferecemos cursos para profissionais a crescerem em suas carreiras.</p>').perfil;
  assert.equal(a.entendimento.publicos.find(p=>p.tipo==='cliente').texto,'profissionais');
  const b=executar('<title>Instituto</title><p>Somos uma organização sem fins lucrativos.</p><p>Jovens encontram na educação novas oportunidades.</p>').perfil;
  assert.equal(b.entendimento.publicos.find(p=>p.tipo==='beneficiario').texto,'Jovens');
});

test('qualificadores nominais legítimos e nomes regionais continuam publicados sem expansão', () => {
  const {perfil}=executar('<title>Instituto</title><p>Somos uma organização sem fins lucrativos.</p><p>Atendemos famílias em situação de vulnerabilidade.</p><p>Atendemos moradores de São Bento.</p><p>Atendemos jovens empreendedores.</p>');
  const grupos=perfil.entendimento.publicos.filter(p=>p.tipo==='beneficiario').map(p=>p.texto);
  for(const esperado of ['famílias em situação de vulnerabilidade','moradores de São Bento','jovens empreendedores'])assert.ok(grupos.includes(esperado),esperado);
  const lazer=executar('<title>Formações profissionais</title><p>Oferecemos formação para profissionais de lazer.</p>').perfil;
  assert.equal(lazer.entendimento.publicos.find(p=>p.tipo==='cliente').texto,'profissionais de lazer');
});

test('limite textual não deixa preposição pendurada no público nem inventa idade', () => {
  const {perfil}=executar('<title>Instituto</title><p>Somos uma organização sem fins lucrativos.</p><p>Atendemos jovens a partir de 18 anos em programas educacionais.</p>');
  const grupo=perfil.entendimento.publicos.find(p=>p.tipo==='beneficiario'&&/^jovens/i.test(p.texto));
  assert.equal(grupo.texto,'jovens');
  assert.ok(grupo.evidencias[0].trecho.includes('18 anos'));
  assert.ok(!grupo.texto.includes('18'));
});

test('o título de outra seção não é emprestado ao trecho nem ao papel da organização',()=>{
  const {contextoPublico}=executar('<title>Exemplo</title>'+
    '<section><h2>Plataforma Financeira</h2><p>Oferecemos suporte para analisar despesas.</p></section>'+
    '<section><p>Desenvolvemos um sistema para organizar filas de atendimento.</p></section>');
  const depois=contextoPublico.detalhesPublicados.find(f=>f.trecho.startsWith('Desenvolvemos'));
  assert.ok(depois);
  assert.equal(depois.secao,'');
  assert.deepEqual(depois.titulos,[]);
});

test('declaração e texto de formulário oculto não se juntam em uma fonte comercial',()=>{
  const {perfil,contextoPublico}=executar('<title>Exemplo</title>'+
    '<p>Oferecemos <span aria-hidden="true"> em parceria com fornecedores </span> passagens.</p>'+
    '<div role="navigation"><p>Vendemos móveis industriais.</p></div>'+
    '<p>Oferecemos consultoria para fabricantes.</p>');
  assert.ok(perfil.ofertas.some(o=>o.nome==='consultoria'));
  assert.ok(!perfil.ofertas.some(o=>/passagens|móveis/.test(o.nome)));
  assert.ok(!contextoPublico.evidencias.some(f=>f.trecho==='Oferecemos passagens.'));
  assert.ok(contextoPublico.coberturaDetalhes.fontesDescontinuasDescartadas>=1);
});

test('rótulo literal ao lado da garantia dá contexto sem emprestar garantias entre blocos',()=>{
  const {perfil,contextoPublico}=executar('<title>Serviços Hidráulicos</title>'+
    '<div><p>Serviço com garantia</p><p>Oferecemos garantia contra danos para ter segurança.</p></div>'+
    '<div><h2>Garantia estendida para equipamentos</h2><p>Vendemos garantia estendida para equipamentos.</p></div>');
  const e=contextoPublico.evidencias.find(f=>f.trecho.startsWith('Oferecemos garantia'));
  assert.equal(e.rotuloDeBloco,'Serviço com garantia');
  assert.ok(!perfil.ofertas.some(o=>o.nome==='garantia contra danos'));
  assert.ok(perfil.ofertas.some(o=>/garantia estendida para equipamentos/i.test(o.nome)));
});
