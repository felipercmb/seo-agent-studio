import assert from 'node:assert/strict';
import {test} from 'node:test';
import {descobrirTermos} from '../src/descoberta.mjs';

const agora = '2026-11-14T19:00:00.000Z';
const pagina = (html, caminho = '/') => ({url:'https://oficinaboa.com.br' + caminho, html, coletadoEm:agora, sha256:'b'.repeat(64), status:200});
const descobrir = (paginas, extra = {}) => descobrirTermos({dominio:'oficinaboa.com.br', coletadoEm:agora, paginas, falhas:[], ...extra});
const schema = dados => '<script type="application/ld+json">' + JSON.stringify(dados) + '</script>';

test('preserva sinais significativos e descarta chamadas de vídeo e títulos genéricos de FAQ', () => {
  const r = descobrir([pagina('<title>Curso de C++</title><h1>Curso de C#</h1><h2>Veja nosso curso no palco</h2><h2>Assista nosso curso</h2><h2>Perguntas frequentes sobre cursos</h2><h3>Quanto custa o curso de programação?</h3>')]);
  assert.ok(r.candidatos.some(c => c.termo === 'Curso de C++'));
  assert.ok(r.candidatos.some(c => c.termo === 'Curso de C#'));
  assert.ok(r.candidatos.some(c => c.termo === 'Quanto custa o curso de programação?'));
  assert.ok(!r.candidatos.some(c => /^(Veja|Assista|Perguntas frequentes)/.test(c.termo)));
});

test('descarta contadores e comandos evidentes sem suprimir buscas numéricas plausíveis', () => {
  const r=descobrir([pagina('<h1>+ 0 apps disponíveis</h1><h2>+6 milhões</h2><h2>Baixe nosso app</h2>'+
    '<h2>Assine um plano e tenha sua loja</h2><h2>Curso de C++</h2><h2>Seguro de automóvel 24 horas</h2>')]);
  const termos=r.candidatos.map(c=>c.termo);
  assert.ok(!termos.some(t=>/disponíveis|milhões|Baixe|Assine/.test(t)));
  assert.ok(termos.includes('Curso de C++'));assert.ok(termos.includes('Seguro de automóvel 24 horas'));
});

test('não transforma chamadas genéricas de cadastro ou redes sociais em serviços',()=>{
  const r=descobrir([pagina('<h1>Cadastre-se</h1><h2>Siga-nos nas Redes Sociais</h2>'+
    '<h2>Dúvidas frequentes</h2><h2>Links úteis</h2><h2>PRODUTOS RELACIONADOS</h2><h2>Ver tudo</h2>'+
    '<h2>Página inicial</h2><h2>Tradução do site</h2><h2>Opções de acessibilidade</h2>'+
    '<h2>Caso você tenha dúvidas envie um e-mail para</h2><a href="/produtos/corpo">Corpo Leia mais</a><h2>Cadastro de empresas em São Paulo</h2>'+
    '<h2>Como se cadastrar no portal</h2><h2>Gestão de redes sociais</h2>')]);
  const termos=r.candidatos.map(c=>c.termo);
  assert.ok(!termos.some(t=>/^(Cadastre-se|Siga-nos|Dúvidas frequentes|Links úteis|PRODUTOS RELACIONADOS|Ver tudo|Página inicial|Tradução do site|Opções de acessibilidade|Caso você tenha dúvidas|Corpo Leia mais)/.test(t)));
  assert.ok(termos.includes('Cadastro de empresas em São Paulo'));
  assert.ok(termos.includes('Como se cadastrar no portal'));
  assert.ok(termos.includes('Gestão de redes sociais'));
});

test('mantém termos de atendimento, mas consulta ofertas antes deles',()=>{
  const r=descobrir([pagina('<h1>Consultoria de privacidade de dados</h1><h2>Data Privacy enquiries</h2><h2>Customer Support</h2><h2>Para acessar a apólice ou certificado do seguro</h2>'),
    pagina('<h1>Cursos de segurança da informação</h1>','/cursos')]);
  const termos=r.candidatos.map(c=>[c.termo,c.tipo]);
  const atendimento=termos.filter(([,tipo])=>tipo==='atendimento');
  assert.deepEqual(new Set(atendimento.map(([termo])=>termo)),new Set(['Data Privacy enquiries','Customer Support','Para acessar a apólice ou certificado do seguro']));
  assert.ok(termos.findIndex(([t])=>t==='Consultoria de privacidade de dados')<termos.findIndex(([,tipo])=>tipo==='atendimento'));
  assert.ok(termos.findIndex(([t])=>t==='Cursos de segurança da informação')<termos.findIndex(([,tipo])=>tipo==='atendimento'));
});

test('preserva slogans institucionais sem apresentá-los como serviços prioritários',()=>{
  const dados={'@context':'https://schema.org','@type':'Organization',name:'Suzano'};
  const r=descobrir([pagina('<title>Suzano: nós plantamos o futuro</title>'+schema(dados)+
    '<h1>A maior empresa de tecnologia do Brasil</h1><h2>Mais de 7 mil empresas de serviços utilizam sistemas</h2><h2>Sistemas para instituições financeiras</h2>')]);
  const termos=r.candidatos.map(c=>[c.termo,c.tipo]);
  assert.deepEqual(termos.find(([t])=>t==='Suzano: nós plantamos o futuro')?.[1],'institucional');
  assert.deepEqual(termos.find(([t])=>t==='A maior empresa de tecnologia do Brasil')?.[1],'institucional');
  assert.deepEqual(termos.find(([t])=>t==='Mais de 7 mil empresas de serviços utilizam sistemas')?.[1],'institucional');
  assert.equal(termos.find(([t])=>t==='Suzano')?.[1],'marca');
  assert.ok(termos.findIndex(([t])=>t==='Sistemas para instituições financeiras')<termos.findIndex(([,tipo])=>tipo==='institucional'));
});

test('cabeçalho ambíguo fica como tema, enquanto oferta explícita tem prioridade',()=>{
  const r=descobrir([pagina('<title>Reforma tributária em contagem regressiva</title>'+
    '<h1>Sistemas para instituições financeiras</h1><h2>Logística reversa</h2>'),
    pagina('<h1>Recuperação profissional especializada</h1>','/servicos/restauracao')]);
  const termos=r.candidatos.map(c=>[c.termo,c.tipo]);
  assert.equal(termos.find(([t])=>t==='Reforma tributária em contagem regressiva')?.[1],'tema');
  assert.equal(termos.find(([t])=>t==='Sistemas para instituições financeiras')?.[1],'servico');
  assert.equal(termos.find(([t])=>t==='Logística reversa')?.[1],'servico');
  assert.equal(termos.find(([t])=>t==='Recuperação profissional especializada')?.[1],'servico');
  assert.ok(termos.findIndex(([t])=>t==='Sistemas para instituições financeiras')<termos.findIndex(([,tipo])=>tipo==='tema'));
});

test('categoria de produtos contendo área de serviço não vira oferta de serviços',()=>{
  const r=descobrir([pagina('<h1>Móveis para Áreas de Serviço</h1>','/categoria/moveis-para-areas-de-servico')]);
  const c=r.candidatos.find(x=>x.termo==='Móveis para Áreas de Serviço');
  assert.equal(c.tipo,'tema');assert.equal(c.evidencia.campo,'h1');
});

test('coleções, promoções e eventos não viram serviços ou produtos individuais',()=>{
  const r=descobrir([pagina('<title>Produtos com até 70%OFF</title><h1>Top Produtos Star Wars</h1>'+
    '<h2>Desenvolvimento Institucional e RH</h2><h3>II Encontro de Gestão de Pessoas e Administração</h3>'+
    '<h2>Consultoria de desenvolvimento de produtos</h2>'),
    pagina('<title>Produtos de cuidado corporal NIVEA</title><h1>Produtos NIVEA</h1>','/produtos/corpo'),
    pagina(schema({'@context':'https://schema.org','@type':'Product',name:'NIVEA LUMINOUS630 Skin Glow Sérum 30 ml'}),'/produtos/serum')]);
  for (const t of ['Produtos com até 70%OFF','Top Produtos Star Wars','Desenvolvimento Institucional e RH',
    'II Encontro de Gestão de Pessoas e Administração','Produtos de cuidado corporal NIVEA','Produtos NIVEA'])
    assert.equal(r.candidatos.find(c=>c.termo===t)?.tipo,'tema',t);
  assert.equal(r.candidatos.find(c=>c.termo==='Consultoria de desenvolvimento de produtos')?.tipo,'servico');
  assert.equal(r.candidatos.find(c=>c.termo==='NIVEA LUMINOUS630 Skin Glow Sérum 30 ml')?.tipo,'produto');
});

test('slug de notícia iniciado por serviços não é confundido com diretório de serviços',()=>{
  const r=descobrir([pagina('<title>Vapt Vupt Rotativo atende em quatro municípios em novembro</title>',
    '/servicos-publicos-da-vapt-vupt-unidade-rotativa-chega-a-quatro-municipios/'),
    pagina('<h1>Recuperação profissional especializada</h1>','/servicos/restauracao')]);
  assert.equal(r.candidatos.find(c=>c.termo==='Vapt Vupt Rotativo atende em quatro municípios em novembro')?.tipo,'tema');
  assert.equal(r.candidatos.find(c=>c.termo==='Recuperação profissional especializada')?.tipo,'servico');
});

test('âncora de produto ambígua fica como tema, mas nome estruturado é preservado',()=>{
  const r=descobrir([pagina('<a href="/produtos/corre">corre</a><a href="/produtos/promocao">50% OFF no verão</a><a href="/produtos/camisa">Camisa de algodão</a>'+
    schema({'@context':'https://schema.org','@type':'Product',name:'Tênis'}))]);
  assert.equal(r.candidatos.find(c=>c.termo==='corre')?.tipo,'tema');
  assert.equal(r.candidatos.find(c=>c.termo==='50% OFF no verão')?.tipo,'tema');
  assert.equal(r.candidatos.find(c=>c.termo==='Camisa de algodão')?.tipo,'produto');
  assert.equal(r.candidatos.find(c=>c.termo==='Tênis')?.tipo,'produto');
});

test('sem página lida explica bloqueios conhecidos sem refletir mensagens externas',()=>{
  const a=descobrir([],{falhas:[{motivo:'Não foi possível confirmar a permissão de leitura em robots.txt.'}]});
  assert.ok(a.limites.some(l=>/permissão de leitura em robots\.txt/.test(l)));
  const b=descobrir([],{falhas:[{motivo:'A página não liberou o conteúdo para esta consulta (HTTP 403).'}]});
  assert.ok(b.limites.some(l=>/HTTP 403/.test(l)));
  const c=descobrir([],{falhas:[{motivo:'token privado que não deve aparecer'}]});
  assert.doesNotMatch(JSON.stringify(c),/token privado/);
});

test('parâmetro de prévia none não desativa descoberta em âncoras',()=>{
  const r=descobrir([pagina('<meta name="robots" content="max-image-preview: none">'+
    '<a href="/servicos/revisao">Revisão de motores</a>')]);
  assert.ok(r.candidatos.some(c=>c.termo==='Revisão de motores'));
});

test('extrai frases publicadas e preserva evidência de cada candidato sem inventar volume', () => {
  const r = descobrir([pagina('<title>Conserto de motores | Oficina Boa</title><h1>Conserto de motores</h1><h2>Troca de óleo</h2><h2>Revisão automotiva</h2><h2>Alinhamento e balanceamento</h2><h2>Contato</h2>')]);
  assert.equal(r.candidatos.length, 5);
  assert.equal(r.candidatos.filter(c => c.tipo === 'marca').length, 1);
  assert.equal(r.candidatos.find(c => c.tipo === 'marca').termo, 'Oficina Boa');
  assert.equal(r.candidatos.filter(c => c.termo === 'Conserto de motores').length, 1);
  assert.ok(!r.candidatos.some(c => c.termo === 'Contato'));
  for (const c of r.candidatos) {
    assert.equal(c.evidencia.url, 'https://oficinaboa.com.br/');
    assert.equal(c.evidencia.coletadoEm, agora);
    assert.equal(c.evidencia.sha256, 'b'.repeat(64));
    assert.ok(c.evidencia.trecho.includes(c.termo));
    assert.ok(!('volume' in c) && !('posicao' in c));
  }
});

test('não usa texto oculto, formulários, scripts comuns ou valores pessoais', () => {
  const r = descobrir([pagina(`<title>Troca de pneus | oficina@exemplo.com</title><h1>Troca de <span hidden>dados pessoais</span>pneus</h1>
    <div hidden><h2>Serviço inexistente oculto</h2></div><h2 aria-hidden="true">Oferta escondida</h2>
    <div style="display:none"><h2>Coisa oculta</h2></div><form><h2>Maria da Silva</h2><input value="123.456.789-00"></form>
    <script>const segredo = 'Conserto de fogões';</script><h2>Ligue 27 99999-8888</h2><h2>email@exemplo.com</h2><h2>site:concorrente.com</h2>`) ]);
  assert.deepEqual(r.candidatos.map(c => c.termo), ['Troca de pneus']);
  assert.ok(!JSON.stringify(r).includes('oficina@'));
});

test('rejeita mojibake sem adivinhar a palavra e conserva acentos válidos', () => {
  const r = descobrir([pagina(schema({'@context':'https://schema.org','@type':'Organization',name:'MÃE E FILHA'}) +
    '<h1>RevisÃ£o de motores</h1><h2>Manuten��o geral</h2><h2>Revisão de motores</h2><h2>MÃE E FILHA</h2>')]);
  assert.ok(r.candidatos.some(c => c.termo === 'Revisão de motores'));
  assert.ok(r.candidatos.some(c => c.termo === 'MÃE E FILHA'));
  assert.ok(!r.candidatos.some(c => /Ã£|�/.test(c.termo)));
});

test('JSON-LD reconhecido oferece marca, serviço e localização sustentada no mesmo serviço', () => {
  const documento = schema({'@context':'https://schema.org', '@graph':[
    {'@type':'LocalBusiness', name:'Oficina Boa', address:{'@type':'PostalAddress', addressLocality:'Vitória'}},
    {'@type':'Service', serviceType:'Conserto de motores', areaServed:{'@type':'City', name:'Vitória'}},
  ]});
  const r = descobrir([pagina(documento)]);
  assert.deepEqual(new Set(r.candidatos.map(c => c.tipo)), new Set(['servico','marca','local']));
  const local = r.candidatos.find(c => c.tipo === 'local');
  assert.equal(local.termo, 'Conserto de motores em Vitória');
  assert.match(local.evidencia.campo, /Service.*areaServed/);
  assert.match(local.evidencia.trecho, /Vitória/);
});

test('não transfere endereço da empresa para a área atendida de serviço sem localização', () => {
  const r = descobrir([pagina(schema({'@context':'https://schema.org','@graph':[
    {'@type':'LocalBusiness',name:'Oficina Boa',address:{addressLocality:'Vitória'}},
    {'@type':'Service',serviceType:'Revisão de motores'},
  ]}))]);
  assert.ok(r.candidatos.some(c => c.termo === 'Revisão de motores'));
  assert.ok(!r.candidatos.some(c => c.tipo === 'local'));
});

test('JSON-LD inválido, tipo Person e contexto desconhecido não viram buscas', () => {
  const r = descobrir([pagina('<script type="application/ld+json">{Inválido}</script>' +
    schema({'@context':'https://outro.example', '@type':'Service',name:'Busca falsa'}) +
    schema({'@type':'Service',name:'Sem contexto'}) +
    schema({'@context':'https://schema.org','@type':'Person',name:'Nome particular'}) +
    '<script type="application/json">{"@context":"https://schema.org","@type":"Service","name":"Não é JSON-LD"}</script>')]);
  assert.deepEqual(r.candidatos, []);
});

test('serviço aninhado em catálogo preserva contexto sem ler nomes de reviews ou clientes', () => {
  const r = descobrir([pagina(schema({'@context':'https://schema.org','@type':'LocalBusiness',name:'Oficina Boa',
    review:{'@type':'Service',name:'Busca que não pertence à oferta'},
    hasOfferCatalog:{'@type':'OfferCatalog',itemListElement:[{'@type':'Offer',itemOffered:{'@type':'Service',serviceType:['Troca de óleo','Troca de filtros']}}]},
  }))]);
  assert.ok(r.candidatos.some(c => c.termo === 'Troca de óleo'));
  assert.ok(r.candidatos.some(c => c.termo === 'Troca de filtros'));
  assert.ok(!r.candidatos.some(c => c.termo.includes('não pertence')));
});

test('marca repetida não domina a descoberta e localidade só classifica frase realmente publicada', () => {
  const ld = schema({'@context':'https://schema.org','@type':'LocalBusiness',name:'Oficina Boa',address:{addressLocality:'Vitória'}});
  const r = descobrir([
    pagina(ld+'<title>Oficina Boa | Troca de óleo</title><h1>Oficina Boa</h1><h2>Troca de pneus em Vitória</h2>'),
    pagina('<title>Oficina Boa | Alinhamento</title><h1>Oficina Boa</h1><h2>Revisão de motores</h2>','/servicos'),
    pagina('<title>Oficina Boa | Balanceamento</title>','/produtos'),
  ]);
  assert.equal(r.candidatos.length, 6);
  assert.equal(r.candidatos.filter(c => c.tipo === 'marca').length, 1);
  assert.equal(r.candidatos.filter(c => c.tipo === 'servico').length, 4);
  assert.equal(r.candidatos.find(c => c.tipo === 'local').termo, 'Troca de pneus em Vitória');
});

test('não cria marca do domínio sem coleta nem aceita páginas de outro site ou de erro', () => {
  for (const paginas of [[], [pagina(' ')], [{...pagina('<h1>Conserto de motores</h1>'),url:'https://outro.com/'}], [{...pagina('<h1>Conserto de motores</h1>'),status:403}]]) {
    const r = descobrir(paginas);
    assert.deepEqual(r.candidatos, []);
    assert.ok(r.limites.some(l => /Nenhum termo foi inferido/.test(l)));
  }
});

test('não corta título longo arbitrariamente; só separpalcos editoriais originam frases', () => {
  const longo = 'Nossa equipe oferece atendimento personalizado para cuidar de todos os detalhes da sua manutenção com muito carinho todos os dias';
  const r = descobrir([pagina('<title>'+longo+'</title><h1>Conserto de motores — Troca de óleo</h1>')]);
  assert.deepEqual(r.candidatos.map(c => c.termo), ['Conserto de motores','Troca de óleo']);
});

test('rótulos de listagem vazia, categorias genéricas e abreviação de marca não consomem consultas de serviço', () => {
  const r = descobrir([pagina(schema({'@context':'https://schema.org','@type':'Organization',name:'VILA VIX IMOVEIS'})+
    '<h1>Imóveis na Planta em Vila Velha e Vitória</h1><h1>Vila Vix</h1><h1>Empreendimentos</h1><h2>0 Encontrado</h2><h2>Nenhum imóvel encontrado</h2>')]);
  assert.deepEqual(r.candidatos.map(c=>[c.termo,c.tipo]), [['Imóveis na Planta em Vila Velha e Vitória','servico'],['VILA VIX IMOVEIS','marca']]);
});

test('conteúdo real da Palco preserva título comercial e marca sem gastar cinco buscas com slogan e gêneros', () => {
  const html = '<title>Palco Shows — Agência de Artistas e Shows no Brasil</title>' +
    '<meta name="description" content="Agência com mais de 400 artistas Gospel, Católico, Sertanejo, Forró, Axé, Samba, Pagode, MPB e Internacional. Orçamento em até 24h.">' +
    '<h1>Seu evento começa com o artista certo</h1>' +
    ['Gospel','Católico','Sertanejo','Forró','Pregpalcos','Axé','Samba e Pagode','MPB','Rock','Internacional','Pronto para fechar o próximo show?'].map(s => '<h2>'+s+'</h2>').join('');
  const r = descobrirTermos({dominio:'palcoshows.example', coletadoEm:agora, paginas:[
    {...pagina(html),url:'https://palcoshows.example/'},
    {...pagina('<title>Quem Somos — Palco Shows</title><h1>Quem somos.</h1><h2>Pronto para o próximo show?</h2><h2>Mais de 15 anos no palco.</h2>'),url:'https://palcoshows.example/quem-somos'},
  ]});
  assert.deepEqual(r.candidatos.map(c => [c.termo,c.tipo]), [
    ['Agência de Artistas e Shows no Brasil','servico'],['Palco Shows','marca'],
  ]);
  assert.equal(r.candidatos[0].evidencia.campo, 'title');
  assert.equal(r.candidatos[0].evidencia.trecho, 'Agência de Artistas e Shows no Brasil');
  assert.ok(!r.candidatos.some(c => /contratar|orçamento|Gospel/.test(c.termo)));
});

test('título comercial tem prioridade e os demais cabeçalhos permanecem descobertos', () => {
  const r = descobrir([pagina('<h1>Troca de pneus</h1><h2>Troca de óleo</h2><h2>Revisão automotiva</h2>' +
    '<h2>Conserto de motores</h2><h2>Alinhamento e balanceamento</h2><title>Manutenção de veículos comerciais | Oficina Boa</title>')]);
  assert.equal(r.candidatos.length, 7);
  assert.equal(r.candidatos[0].termo, 'Manutenção de veículos comerciais');
  assert.equal(r.candidatos[0].evidencia.campo, 'title');
  assert.equal(r.candidatos.filter(c => c.tipo === 'marca').length, 1);
});

test('CTA, histórico promocional e slogan não viram buscas mesmo com vagas na franquia', () => {
  const r = descobrir([pagina('<title>Oficina Boa</title>' +
    ['Seu carro merece o melhor','Pronto para cuidar do seu veículo?','Solicite seu orçamento',
      'Agende sua revisão','Conheça nossos diferenciais','Mais de 20 anos de experiência',
      'Qualidade que faz a diferença','O melhor cuidado para o seu carro'].map(s => '<h1>'+s+'</h1>').join(''))]);
  assert.deepEqual(r.candidatos.map(c => [c.termo,c.tipo]), [['Oficina Boa','marca']]);
});

test('categoria isolada não ganha contexto inventado e Service explícito de uma palavra é conservado', () => {
  const r = descobrir([pagina('<title>Oficina Boa</title><h1>Seu projeto começa aqui</h1>' +
    '<h2>Premium</h2><h2>Internacional</h2><h2>Moda e Beleza</h2><h2>Consultoria</h2>' +
    schema({'@context':'https://schema.org','@type':'Service',name:'Consultoria'}))]);
  assert.deepEqual(r.candidatos.map(c => [c.termo,c.tipo]), [['Consultoria','servico'],['Oficina Boa','marca']]);
  assert.equal(r.candidatos[0].evidencia.campo, 'jsonld.Service.name');
  assert.equal(r.candidatos[0].evidencia.trecho, 'Consultoria');
});

test('não força palavras até o limite quando todas as fontes só oferecem slogans e categorias', () => {
  const r = descobrir([pagina('<h1>Seu sonho começa aqui</h1><h2>Pronto para começar?</h2><h2>Premium</h2><h2>Moda e Beleza</h2>')]);
  assert.deepEqual(r.candidatos, []);
  assert.ok(r.limites.some(l => /não é preenchido artificialmente/.test(l)));
});

test('doze páginas produzem mais de cinco hipóteses e a cobertura informa teto de cem', () => {
  const paginas = Array.from({length: 12}, (_, p) => pagina(Array.from({length: 12}, (_, n) =>
    '<h3>Manutenção de equipamento modelo ' + p + ' ' + n + '</h3>').join(''), '/servicos/grupo-' + p));
  const r = descobrir(paginas);
  assert.equal(r.candidatos.length, 100);
  assert.deepEqual(r.cobertura, {paginasLidas: 12, limitePaginas: 12, limiteTermos: 100, termosDescobertos: 144, limitada: true});
  assert.equal(new Set(r.candidatos.slice(0, 12).map(c => c.evidencia.url)).size, 11);
  assert.equal(new Set(r.candidatos.map(c => c.evidencia.url)).size, 12);
  assert.ok(r.candidatos.every(c => c.evidencia.campo === 'h3'));
});

test('produto, serviço e oferta aninhados preservam evidências e intenção diferente', () => {
  const r = descobrir([pagina(schema({'@context': 'https://schema.org', '@type': 'OfferCatalog', itemListElement: [
    {'@type': 'Offer', name: 'Kit Executivo', itemOffered: {'@type': 'Product', name: 'Notebook ThinkPad X1'}},
    {'@type': 'Offer', name: 'Pacote de manutenção anual', itemOffered: {'@type': 'Service', name: 'Manutenção de computpalcos'}},
    {'@type': 'Offer', name: 'Nome sem produto ou serviço associado'},
  ]}))]);
  assert.equal(r.candidatos.find(c => c.termo === 'Notebook ThinkPad X1').tipo, 'produto');
  assert.equal(r.candidatos.find(c => c.termo === 'Notebook ThinkPad X1').evidencia.campo, 'jsonld.Product.name');
  assert.equal(r.candidatos.find(c => c.termo === 'Kit Executivo').evidencia.campo, 'jsonld.Offer.name');
  assert.equal(r.candidatos.find(c => c.termo === 'Pacote de manutenção anual').tipo, 'servico');
  assert.ok(!r.candidatos.some(c => c.termo.startsWith('Nome sem')));
});

test('catálogo Palco fornece artistas como entidades publicadas e mantém rotulagem explícita', () => {
  const nomes = ['Ana Carolina', 'Banda Horizonte', 'Adele', 'João Gomes', 'Maria Rita', 'Ana Castela', 'Marcos e Belutti'];
  const html = '<title>Palco Shows — Agência de Artistas e Shows no Brasil</title><h1>Seu evento começa com o artista certo</h1>' +
    nomes.map((n, i) => '<a href="/artistas/artista-' + i + '"><h3>' + n + '</h3></a>').join('') +
    '<section class="equipe"><h3>Nome Particular</h3></section><form><a href="/artistas/privado">Contato Particular</a></form>';
  const r = descobrirTermos({dominio: 'palcoshows.example', coletadoEm: agora, paginas: [{...pagina(html), url: 'https://palcoshows.example/'}]});
  assert.ok(r.candidatos.length > 5);
  assert.deepEqual(new Set(r.candidatos.filter(c => c.tipo === 'entidade').map(c => c.termo)), new Set(nomes));
  assert.ok(r.candidatos.filter(c => c.tipo === 'entidade').every(c => c.rotulo === 'Artista publicado no catálogo' && c.evidencia.campo === 'a.texto'));
  assert.ok(!r.candidatos.some(c => /Particular/.test(c.termo)));
  assert.ok(!JSON.stringify(r.candidatos).includes('volume'));
});

test('perfil comercial de artista aceita título publicado sem tratar pessoas comuns como oferta', () => {
  const r = descobrir([
    pagina('<title>Ana Carolina | Oficina Boa</title><h1>Ana Carolina</h1>', '/artistas/ana-carolina'),
    pagina('<h1>Maria da Silva</h1><h2>João Souza</h2>' + schema({'@context':'https://schema.org','@type':'Person', name:'Pedro Santos'}), '/equipe'),
  ]);
  assert.equal(r.candidatos.find(c => c.termo === 'Ana Carolina').tipo, 'entidade');
  assert.ok(!r.candidatos.some(c => /Maria|João|Pedro/.test(c.termo)));
});

test('âncoras comerciais exigem destino seguro, visibilidade e ausência de nofollow', () => {
  const html = '<a href="/produtos/camisa">Camisa de algodão</a><a href="/servicos/limpeza">Limpeza de estofados</a>' +
    '<a href="/produtos/oculto" hidden>Produto oculto</a><a href="/produtos/privado" rel="nofollow">Produto privado</a>' +
    '<a href="https://externo.com/produtos/externo">Produto externo</a><a href="/produtos/segredo?token=1">Produto com token</a>' +
    '<a href="/produtos/manual.pdf">Manual de produto</a><a href="/produtos/download" download>Produto download</a>';
  const r = descobrir([pagina(html)]);
  assert.deepEqual(new Set(r.candidatos.map(c => c.termo)), new Set(['Camisa de algodão','Limpeza de estofados']));
  assert.equal(r.candidatos.find(c => c.termo === 'Camisa de algodão').tipo, 'produto');
  assert.deepEqual(descobrir([pagina('<meta name="robots" content="nofollow">' + html)]).candidatos, []);
  assert.deepEqual(descobrir([{...pagina(html), segueLinks: false}]).candidatos, []);
});

test('meta descrição só contribui com fragmentos editoriais comerciais explícitos', () => {
  const r = descobrir([pagina('<meta name="description" content="Consultoria ambiental; Gestão de resíduos; Agende uma reunião">' +
    '<meta name="description" content="Nossa empresa oferece manutenção de computpalcos para cuidar de todos os seus projetos">')]);
  assert.deepEqual(new Set(r.candidatos.map(c => c.termo)), new Set(['Consultoria ambiental','Gestão de resíduos']));
  assert.ok(r.candidatos.every(c => c.evidencia.campo === 'meta.description.fragmento'));
});

test('deduplicação normaliza acentos e caixa, sem preencher artificialmente a capacidade', () => {
  const r = descobrir([pagina('<h1>Revisão automotiva</h1><h2>REVISAO AUTOMOTIVA</h2><h3>Revisão automotiva</h3>'),
    pagina('<title>Revisão automotiva</title>', '/servicos/revisao')]);
  assert.equal(r.candidatos.length, 1);
  assert.equal(r.cobertura.termosDescobertos, 1);
  assert.equal(r.cobertura.paginasLidas, 2);
  assert.equal(r.cobertura.limitada, false);
  assert.equal(r.candidatos[0].evidencia.campo, 'title');
});

test('páginas além do limite, falhas ou cobertura parcial do coletor são explícitas', () => {
  const paginas = Array.from({length: 13}, (_, n) => pagina('<h1>Manutenção de equipamento ' + n + '</h1>', '/servicos/item-' + n));
  const r = descobrir(paginas);
  assert.equal(r.cobertura.paginasLidas, 12);
  assert.equal(r.cobertura.limitada, true);
  assert.ok(!r.candidatos.some(c => c.termo === 'Manutenção de equipamento 12'));
  assert.equal(descobrir([pagina('<h1>Conserto de motores</h1>')], {cobertura: {limitada: true}}).cobertura.limitada, true);
  assert.equal(descobrir([], {falhas: [{url:'https://oficinaboa.com.br/'}]}).cobertura.limitada, true);
  assert.equal(descobrir(null).cobertura.paginasLidas, 0);
});

test('título dentro de um link de evento não gera produtos, datas ou uma oferta Venda Geral', () => {
  const r=descobrir([pagina('<title>Agenda cultural</title><a href="/event/show-da-cidade">'+
    '<div><h3>Show da Cidade | Recife | 14/12/2026 | Venda Geral</h3></div></a>'+
    '<h2>Produção de Eventos</h2><a href="https://fora.com/event/externo"><h3>Consultoria para eventos</h3></a>')]);
  const c=r.candidatos.find(c=>c.termo==='Show da Cidade');
  assert.equal(c.tipo,'tema');
  assert.equal(c.rotulo,'Evento listado no site');
  assert.match(c.evidencia.trecho,/Venda Geral$/);
  assert.ok(r.candidatos.some(c=>c.termo==='Produção de Eventos'&&c.tipo==='servico'));
  assert.ok(r.candidatos.some(c=>c.termo==='Consultoria para eventos'&&c.tipo==='servico'));
  assert.ok(!r.candidatos.some(c=>['Venda Geral','Recife','14/12/2026'].includes(c.termo)));
});
