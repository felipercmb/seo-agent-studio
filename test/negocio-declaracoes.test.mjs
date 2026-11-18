import assert from 'node:assert/strict';
import {test} from 'node:test';
import {extrairContextoPublico} from '../src/modulos/contexto-publico.mjs';
import {inferirPerfil} from '../src/modulos/perfil.mjs';
import {descobrirTermos} from '../src/descoberta.mjs';
const dominio='exemplo.com.br',coletadoEm='2026-11-16T00:00:00.000Z';
function executar(html,caminho='/') {
  const c={dominio,coletadoEm,paginas:[{url:'https://exemplo.com.br'+caminho,status:200,coletadoEm,html}]};
  const contextoPublico=extrairContextoPublico(c);
  return {contextoPublico,perfil:inferirPerfil({dominio,contextoPublico,descoberta:descobrirTermos(c)})};
}

test('passagens são objeto curto publicado e operação terceira sustenta intermediação',()=>{
  const {perfil}=executar('<title>Empresa | Passagens de Ônibus Online para mais de 4.800 destinos</title><h1>Compre sua passagem de ônibus</h1><p>Na nossa plataforma você escolhe veículos operados por mais de 200 empresas e compra sua passagem de ônibus online.</p>');
  assert.ok(perfil.ofertas.some(o=>/^Passagens de Ônibus Online$/i.test(o.nome)));
  assert.ok(perfil.ofertas.every(o=>!o.nome.includes('4.800')));
  assert.equal(perfil.entendimento.papel,'intermediacao');
  assert.ok(perfil.entendimento.relacoes.some(r=>r.tipo==='execucao_por_terceiros'));
});

test('comercialização de ingresso não prova produção própria nem operador terceiro não declarado',()=>{
  const {perfil}=executar('<title>Ingressos para shows e eventos</title><p>Na nossa plataforma você compra ingressos para shows e eventos com checkout seguro.</p>');
  assert.ok(perfil.ofertas.length);
  assert.equal(perfil.entendimento.papel,'indefinido');
  assert.ok(perfil.entendimento.relacoes.some(r=>r.tipo==='canal_comercializacao'));
  assert.ok(!perfil.entendimento.relacoes.some(r=>r.tipo==='execucao_por_terceiros'));
});

test('prestação de transporte declarada não vira intermediação por vender passagens',()=>{
  const {perfil}=executar('<title>Passagens de ônibus</title><p>Prestamos transporte rodoviário de passageiros com frota própria.</p><p>Você pode comprar passagens em nosso site.</p>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.ok(!perfil.entendimento.relacoes.some(r=>r.tipo==='execucao_por_terceiros'));
});

test('agenciamento e contratos entre partes definem relação sem inventar execução de faxina',()=>{
  const {perfil}=executar('<title>Agendamento de profissionais de limpeza</title><p>A empresa trabalha agenciando profissionais para clientes.</p><p>A nossa plataforma tem como objetivo a formalização de contratos entre as partes.</p>');
  assert.equal(perfil.entendimento.papel,'intermediacao');
  assert.ok(perfil.entendimento.relacoes.some(r=>r.tipo==='formalizacao_entre_partes'));
});

test('produção e comercialização com objeto explícito recuperam atividade de cooperativa',()=>{
  const {perfil}=executar('<title>Cooperativa</title><p>A cooperativa é do ramo agroindustrial, produzindo e comercializando alimentos derivados de aves e leite.</p>');
  assert.equal(perfil.entendimento.papel,'produtos');
  assert.ok(perfil.ofertas.some(o=>/alimentos derivados de aves e leite/i.test(o.nome)));
  assert.ok(perfil.entendimento.relacoes.some(r=>r.tipo==='execucao_propria'));
});

test('fragmento de localidade em título imobiliário não é oferta; objeto imobiliário permanece',()=>{
  const {perfil}=executar('<title>Imóveis à venda | Cidade Nova | Apartamentos e Casas | Empresa</title>','/imoveis/estado/cidade-nova');
  assert.ok(perfil.ofertas.some(o=>/Imóveis à venda|Apartamentos e Casas/.test(o.nome)));
  assert.ok(!perfil.ofertas.some(o=>o.nome==='Cidade Nova'));
});

test('produto formal com nome regional não é excluído por heurística de título',()=>{
  const {perfil}=executar('<title>Imóveis à venda | Cidade Nova | Empresa</title><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'Product',name:'Cidade Nova'})+'</script>','/imoveis/estado/cidade-nova');
  assert.ok(perfil.ofertas.some(o=>o.nome==='Cidade Nova'&&o.evidencias[0].campo==='jsonld.Product.name'));
});

test('parceria sem operação alheia não transforma consultoria própria em intermediação',()=>{
  const {perfil}=executar('<title>Consultoria ambiental</title><p>Prestamos consultoria ambiental para empresas.</p><p>Trabalhamos com nossos parceiros em eventos técnicos.</p>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.ok(perfil.entendimento.relacoes.some(r=>r.tipo==='parceria'));
});

test('software para empresas operadoras não importa para si o papel do cliente',()=>{
  const {perfil}=executar('<title>Software para transportadoras</title><p>Oferecemos software de gestão para empresas que operam veículos de transporte.</p>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.ok(!perfil.entendimento.relacoes.some(r=>r.tipo==='execucao_por_terceiros'));
});

test('interface de compra isolada não informa papel na cadeia ou oferta',()=>{
  const {perfil}=executar('<title>Empresa</title><form><label>Origem<input value="segredo"></label><button>Comprar passagens</button></form>');
  assert.equal(perfil.ofertas.length,0);
  assert.equal(perfil.entendimento.papel,'indefinido');
  assert.deepEqual(perfil.entendimento.relacoes,[]);
});

test('categoria de catálogo declarada com seus produtos não pressupõe loja ou fabricação',()=>{
  const {perfil}=executar('<title>Marca de design</title><p>Com muitos anos de história, a empresa é referência em metais sanitários que unem design e durabilidade. Seus produtos têm qualidade reconhecida.</p>');
  assert.ok(perfil.ofertas.some(o=>o.nome==='metais sanitários'));
  assert.equal(perfil.entendimento.papel,'produtos');
  assert.ok(!perfil.entendimento.relacoes.some(r=>r.tipo==='execucao_propria'));
});

test('benefícios abstratos e frases de compra não se tornam nomes de ofertas',()=>{
  const {perfil}=executar('<title>Projetos de tecnologia</title><p>Entregamos projetos e equipes de tecnologia com excelência técnica.</p><h2>Velocidade comprovada</h2><h2>Governança completa</h2><h2>Escala com padrão</h2><h2>Autonomia de verdade: o agente executa, verifica e corrige</h2><h2>Aqui, você compra passagens de ônibus em promoção e aproveita destinos incríveis!</h2><h2>Buscar Médico/Serviços</h2>');
  assert.ok(perfil.ofertas.some(o=>o.nome==='projetos e equipes de tecnologia'));
  assert.ok(!perfil.ofertas.some(o=>/Governança completa|Escala com padrão|Autonomia de verdade|Aqui,|Buscar Médico/.test(o.nome)));
});

test('companhia que ajuda grandes empresas conserva o grupo nominal como hipótese de público',()=>{
  const {perfil}=executar('<title>Tecnologia</title><meta name="description" content="Somos uma companhia de tecnologia que ajuda grandes empresas a evoluir com engenharia de software."><p>Entregamos projetos de tecnologia.</p>');
  assert.ok(perfil.entendimento.publicos.some(p=>p.texto==='grandes empresas'&&p.natureza==='hipotese'));
});

test('fragmento vazio em URL não cria uma segunda página lida',()=>{
  const html='<title>Curso de fotografia</title>';
  const contexto=extrairContextoPublico({dominio,coletadoEm,paginas:[{url:'https://exemplo.com.br/',status:200,html},{url:'https://exemplo.com.br/#',status:200,html}]});
  assert.equal(contexto.cobertura.paginasLidas,1);
});

test('benefício coordenado com vírgula não se torna catálogo e comparação permanece informacional',()=>{
  const {perfil}=executar('<title>Limpeza residencial</title><h2>Limpeza comum x Faxina pesada</h2><h2>Velocidade e escala, com governança e qualidade</h2><p>Prestamos limpeza residencial para empresas.</p>','/servicos/limpeza');
  assert.ok(!perfil.ofertas.some(o=>/Limpeza comum x|Velocidade e escala/.test(o.nome)));
});

test('nomes comerciais estruturados podem coincidir com benefício ou comparação',()=>{
  const {perfil}=executar('<title>Catálogo</title><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@graph':[{'@type':'Service',name:'Governança completa'},{'@type':'Product',name:'Linha X Linha'}]})+'</script>');
  assert.ok(perfil.ofertas.some(o=>o.nome==='Governança completa'));
  assert.ok(perfil.ofertas.some(o=>o.nome==='Linha X Linha'));
});

test('negação de execução por terceiros não é evidência de intermediação',()=>{
  const {perfil}=executar('<title>Passagens de ônibus</title><p>Na nossa plataforma você compra passagens e os veículos não são operados por empresas terceiras.</p><p>Prestamos transporte rodoviário com frota própria.</p>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.ok(!perfil.entendimento.relacoes.some(r=>r.tipo==='execucao_por_terceiros'));
});

test('parceria operacional não vira apoiador, apoio explicitamente declarado continua elegível',()=>{
  const a=executar('<title>Consultoria</title><p>Prestamos consultoria junto aos nossos parceiros de tecnologia.</p>').perfil;
  assert.ok(!a.entendimento.publicos.some(p=>p.tipo==='apoiador'));
  assert.ok(a.entendimento.relacoes.some(r=>r.tipo==='parceria'));
  const b=executar('<title>Instituto</title><p>Somos uma organização sem fins lucrativos.</p><p>Contamos com o apoio de parceiros e doadores para continuar nossa causa.</p>').perfil;
  assert.ok(b.entendimento.publicos.some(p=>p.tipo==='apoiador'&&p.texto==='parceiros'));
});

test('missão infinitiva publicada precede identidade e território não inventa público humano',()=>{
  const missao='Fomentar iniciativas que promovam a justiça social e o desenvolvimento sustentável de periferias urbanas.';
  const {perfil}=executar('<title>Fundação</title><meta name="description" content="'+missao+'"><h3>A fundação é uma organização não governamental criada há muitos anos.</h3><p>As periferias urbanas são o foco do trabalho.</p>');
  assert.equal(perfil.entendimento.finalidade.tipo,'social');
  assert.equal(perfil.entendimento.proposito.texto,missao);
  assert.ok(perfil.entendimento.territorios.some(t=>t.texto==='periferias urbanas'));
  assert.deepEqual(perfil.entendimento.publicos,[]);
  assert.deepEqual(perfil.regioes,[]);
});

test('objeto técnico coordenado precisa de relação própria com o destinatário, não simples menção',()=>{
  const a=executar('<title>Empresa</title><meta name="description" content="Somos uma companhia de tecnologia que ajuda grandes empresas a evoluir com engenharia de software, dados e inteligência artificial.">').perfil;
  assert.ok(a.ofertas.some(o=>o.nome==='engenharia de software, dados e inteligência artificial'));
  const b=executar('<title>Empresa</title><p>Nossos clientes contratam engenharia de software, dados e inteligência artificial de fornecedores externos.</p>').perfil;
  assert.ok(!b.ofertas.some(o=>o.nome==='engenharia de software, dados e inteligência artificial'));
  const c=executar('<title>Empresa</title><meta name="description" content="Somos uma companhia que ajuda empresas a crescer com confiança, ética e qualidade.">').perfil;
  assert.equal(c.ofertas.length,0);
});

test('negação de agenciamento e identidade de corretora não é afirmação do papel',()=>{
  for(const frase of ['A empresa não trabalha agenciando profissionais.','A empresa não é uma corretora.']){
    const {perfil}=executar('<title>Consultoria</title><p>'+frase+'</p><p>Prestamos consultoria empresarial.</p>');
    assert.equal(perfil.entendimento.papel,'servicos');
  }
});

test('fornecedor de logística terceirizado não transforma o fabricante em intermediário dos produtos',()=>{
  const {perfil}=executar('<title>Fábrica de alimentos</title><p>Fabricamos alimentos para empresas.</p><p>Você compra produtos em nosso catálogo.</p><p>Os veículos de entrega são operados por empresas parceiras.</p>');
  assert.equal(perfil.entendimento.papel,'produtos');
  assert.ok(perfil.entendimento.relacoes.some(r=>r.tipo==='execucao_por_terceiros'));
});

test('seções de diferenciais e benefícios de uma oferta não são outras ofertas',()=>{
  const {perfil}=executar('<title>Pós-graduação em Gestão de Projetos</title><h2>Diferenciais da Pós-graduação em Gestão de Projetos</h2><h2>Vantagens do curso de Gestão de Projetos</h2><h2>Benefícios de contratar consultoria</h2>','/cursos/gestao');
  assert.ok(perfil.ofertas.some(o=>o.nome==='Pós-graduação em Gestão de Projetos'));
  assert.ok(!perfil.ofertas.some(o=>/^(Diferenciais|Vantagens|Benefícios)/.test(o.nome)));
});

test('nomes estruturados Service Course e Product preservam os mesmos prefixos',()=>{
  const nomes=['Diferenciais de caminhão','Vantagens da negociação','Benefícios de assistência'];
  const {perfil}=executar('<title>Catálogo</title><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@graph':nomes.map((name,i)=>({'@type':['Product','Course','Service'][i],name}))})+'</script>');
  for(const nome of nomes)assert.ok(perfil.ofertas.some(o=>o.nome===nome),nome);
});

test('objeto de consultoria e curso sobre benefícios continua sendo oferta nominal',()=>{
  const {perfil}=executar('<title>Consultoria de benefícios fiscais</title><h2>Curso sobre vantagens da negociação</h2>','/servicos');
  for(const nome of ['Consultoria de benefícios fiscais','Curso sobre vantagens da negociação'])assert.ok(perfil.ofertas.some(o=>o.nome===nome),nome);
});

test('agência que declara conectar grupos conserva participantes e destinatários literais',()=>{
  const {perfil}=executar('<title>Agência de Artistas</title><p>A empresa é uma agência de agenciamento musical. Há muitos anos conectamos artistas de primeira linha a produtores, prefeituras, igrejas, festivais e empresas que procuram apresentações.</p>');
  assert.equal(perfil.entendimento.papel,'intermediacao');
  assert.ok(perfil.entendimento.relacoes.some(r=>r.tipo==='conexao_entre_partes'));
  assert.ok(perfil.entendimento.publicos.some(p=>p.tipo==='participante'&&p.texto==='artistas'));
  for(const nome of ['produtores','prefeituras','igrejas','festivais','empresas'])assert.ok(perfil.entendimento.publicos.some(p=>p.tipo==='cliente'&&p.texto===nome),nome);
});

test('conectar sistemas de artistas não transforma software em agência nem cria participantes',()=>{
  const {perfil}=executar('<title>Software de integração</title><p>Somos uma empresa de software. Conectamos sistemas de artistas a sistemas de produtores e empresas.</p>');
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.ok(!perfil.entendimento.relacoes.some(r=>r.tipo==='conexao_entre_partes'));
  assert.ok(!perfil.entendimento.publicos.some(p=>p.texto==='artistas'||p.texto==='produtores'));
});

test('negativa de conexão não adiciona os grupos negados à relação',()=>{
  const {perfil}=executar('<title>Agência de Artistas</title><p>Somos uma agência de agenciamento musical. Não conectamos artistas a produtores ou empresas.</p>');
  assert.ok(!perfil.entendimento.relacoes.some(r=>r.tipo==='conexao_entre_partes'));
  assert.ok(!perfil.entendimento.publicos.some(p=>p.texto==='artistas'||p.texto==='produtores'));
});

test('comercialização de terceiros dá objeto ao perfil e guarda a declaração sem URL de oferta',()=>{
  const declaracao='A Exemplo disponibiliza para aquisição ingressos, mercadorias e vouchers de terceiros fornecedores independentes.';
  const {perfil}=executar('<title>Política de compra</title><p>Oferecemos nosso Marketplace “no estado em que se encontra” sem garantias.</p>'+
    '<p>'+declaracao+'</p>','/static/termos-de-uso');
  assert.equal(perfil.entendimento.papel,'intermediacao');
  assert.equal(perfil.entendimento.natureza,'hipotese');
  assert.deepEqual(perfil.ofertas.map(o=>o.nome),['ingressos','vouchers']);
  assert.ok(perfil.ofertas.every(o=>o.url===null&&o.evidencias[0].url.endsWith('/static/termos-de-uso')));
  const relacao=perfil.entendimento.relacoes.find(r=>r.tipo==='representacao_na_transacao');
  assert.equal(relacao.texto,declaracao);
  assert.equal(relacao.evidencias[0].trecho,declaracao);
  assert.deepEqual(relacao.objetos,['ingressos','vouchers']);
  assert.ok(!perfil.entendimento.relacoes.some(r=>r.tipo==='execucao_propria'));
});

test('venda em nome de organizadores recupera objeto mesmo em documento com outro assunto na primeira frase',()=>{
  const {perfil}=executar('<p>Esta política trata de compras. “Ingressos” são ingressos vendidos por nós em nome das pessoas que realizam os eventos.</p>',
    '/static/termos-de-uso');
  assert.equal(perfil.entendimento.papel,'intermediacao');
  assert.equal(perfil.ofertas.find(o=>o.nome==='ingressos')?.url,null);
  assert.ok(perfil.entendimento.relacoes.find(r=>r.forma==='venda_em_nome_de_terceiro'));
});

test('negação, pergunta, menção de outra marca, depoimento e conteúdo editorial não promovem intermediação',()=>{
  const entradas=[
    ['<p>Os ingressos não são vendidos por nós em nome dos organizadores.</p>','/termos-de-uso'],
    ['<p>Ingressos são vendidos por nós em nome dos organizadores?</p>','/'],
    ['<p>A OutraMarca disponibiliza para aquisição ingressos de terceiros fornecedores.</p>','/'],
    ['<h2>Depoimentos</h2><p>Ingressos são vendidos por nós em nome dos organizadores.</p>','/'],
    ['<p>Ingressos são vendidos por nós em nome dos organizadores.</p>','/blog/artigo'],
  ];
  for(const [html,caminho] of entradas){
    const {perfil}=executar(html,caminho);
    assert.notEqual(perfil.entendimento.papel,'intermediacao',html);
    assert.ok(!perfil.ofertas.some(o=>o.nome==='ingressos'),html);
  }
});

test('garantia que acompanha o serviço e momento de pagamento ficam fora das ofertas',()=>{
  const {perfil}=executar('<title>Serviços Hidráulicos</title><h2>Serviço com garantia</h2>'+
    '<p>Oferecemos garantia contra danos para você ter certeza que está seguro.</p>'+
    '<h2>Pague só depois do serviço realizado</h2><h2>Quebrou? Sujou? Precisa de instalação</h2>');
  assert.ok(perfil.ofertas.some(o=>o.nome==='Serviços Hidráulicos'));
  assert.ok(!perfil.ofertas.some(o=>/garantia contra danos|Pague|Quebrou/u.test(o.nome)));
});
