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
