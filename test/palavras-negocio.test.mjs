import test from 'node:test';
import assert from 'node:assert/strict';
import {gerarPalavras} from '../src/modulos/palavras.mjs';

test('atividade pública já descoberta perde intenção comercial e mantém a fonte literal original',()=>{
  const e={url:'https://exemplo.com.br/programas',campo:'h2',trecho:'Projeto Apoio Cultural',coletadoEm:'2026-11-15T20:00:00.000Z',sha256:'a'.repeat(64)};
  const perfil={dominio:'exemplo.com.br',estado:'rascunho',ofertas:[],entendimento:{atuacoes:[{id:'social-1',tipo:'programa_social',nome:'Projeto Apoio Cultural',evidencias:[e]}]}};
  const r=gerarPalavras({perfil,descoberta:{candidatos:[{termo:'Projeto Apoio Cultural',tipo:'servico',evidencia:e},{termo:'Fale conosco',tipo:'atendimento',evidencia:{...e,trecho:'Fale conosco'}}]}});
  const a=r.candidatos.find(c=>c.termo==='Projeto Apoio Cultural');
  assert.equal(a.intencao,'informacional');assert.equal(a.atuacaoId,'social-1');assert.equal(a.ofertaId,null);assert.deepEqual(a.evidencia,e);
  assert.ok(r.candidatos.every(c=>!c.motivo.includes('A pessoa declarou')));
});

const dominio='negocio.com.br',data='2026-11-15T21:00:00Z';
const evidencia=nome=>({url:'https://negocio.com.br/',campo:'h1',trecho:nome,coletadoEm:data,sha256:'a'.repeat(64)});
const oferta=(id,nome,nivel)=>({id,nome,origem:'site',centralidade:{nivel,natureza:'hipotese'},evidencias:[evidencia(nome)]});

test('atividades principais precedem ofertas complementares sem apagar sua investigação',()=>{
  const ofertas=[oferta('aulas','Aulas de surf','complementar'),oferta('hotel','Hotéis','principal'),oferta('rest','Restaurantes','principal')];
  const perfil={dominio,nome:'Negócio',estado:'confirmado',ofertas,exclusoes:[],regioes:[]};
  const descoberta={candidatos:ofertas.map(o=>({termo:o.nome,tipo:'servico',evidencia:evidencia(o.nome)}))};
  const r=gerarPalavras({perfil,descoberta});assert.ok(r.candidatos.slice(0,5).every(c=>c.ofertaId!=='aulas'));
  assert.ok(r.candidatos.some(c=>c.ofertaId==='aulas'));assert.ok(r.candidatos.some(c=>c.termo==='reservar Hotéis' && c.origem==='hipotese'));
  assert.ok(r.candidatos.some(c=>c.termo==='reserva em Restaurantes' && c.origem==='hipotese'));
  assert.ok(r.candidatos.filter(c=>c.origem==='hipotese').every(c=>!c.evidencia));
});
test('hospedagem de sites não recebe hipótese de reserva de hotel',()=>{
  const p={dominio,nome:'Infraestrutura',estado:'confirmado',ofertas:[oferta('web','Hospedagem de sites','principal')],exclusoes:[],regioes:[]};
  const r=gerarPalavras({perfil:p});assert.ok(!r.candidatos.some(c=>/^reservar/i.test(c.termo)));
});

test('hipóteses comerciais seguem inscrição, compra e reserva, sem cotação genérica de cursos ou passagens',()=>{
  const nomes=['Pós-graduação em Gestão de Projetos','Passagens de ônibus online','Ingressos para eventos','Apartamentos e Casas','Plataforma de venda de ingressos'];
  const p={dominio,estado:'confirmado',ofertas:nomes.map((nome,i)=>oferta('of'+i,nome,'principal')),regioes:[],exclusoes:[]};
  const r=gerarPalavras({perfil:p});
  for(const t of ['inscrição em Pós-graduação em Gestão de Projetos','comprar Passagens de ônibus online','comprar Ingressos para eventos','comprar Apartamentos e Casas','contratar Plataforma de venda de ingressos'])assert.ok(r.candidatos.some(c=>c.termo===t&&c.origem==='hipotese'&&!c.evidencia),t);
  assert.ok(!r.candidatos.some(c=>/^orçamento para/.test(c.termo)));
});

test('serviços sobre imóveis e cursos não viram compra de imóvel nem modelo de matrícula',()=>{
  const p={dominio,estado:'confirmado',ofertas:[oferta('a','Limpeza de casas','principal'),oferta('b','Software para escolas','principal'),oferta('c','Consultoria para cursos','principal'),oferta('d','Desenvolvimento web para hotéis','principal')],regioes:[],exclusoes:[]};
  const r=gerarPalavras({perfil:p});assert.ok(!r.candidatos.some(c=>/^comprar Limpeza/.test(c.termo)||/^inscrição/.test(c.termo)||/^reservar Desenvolvimento/.test(c.termo)));
  assert.ok(r.candidatos.some(c=>c.termo==='orçamento para Limpeza de casas'));
});
test('participação social tem consultas informacionais e não fabrica intenção de venda',()=>{
  const atividade={id:'educacao',tipo:'programa_social',nome:'Educação comunitária',evidencias:[evidencia('Educação comunitária')]};
  const p={dominio,estado:'rascunho',ofertas:[],entendimento:{finalidade:{tipo:'social'},atuacoes:[atividade]},exclusoes:[]};
  const inicial=gerarPalavras({perfil:p});assert.equal(inicial.candidatos.length,1);assert.equal(inicial.candidatos[0].origem,'site');
  const confirmado=gerarPalavras({perfil:{...p,estado:'confirmado'}});
  assert.ok(confirmado.candidatos.some(c=>c.termo==='como funciona Educação comunitária' && c.origem==='hipotese'));
  assert.ok(confirmado.candidatos.every(c=>c.intencao==='informacional' && !c.ofertaId && c.atuacaoId==='educacao'));
  assert.ok(!confirmado.candidatos.some(c=>/orçamento|preço/i.test(c.termo)));
});

test('rótulos de idioma e navegação não gastam a fila, preservando nomes com objeto e declarações exatas',()=>{
  const nomes=['Português (BR)','O que fazemos','Quem somos','Curso de Português para estrangeiros','Software para gestão de idiomas'];
  const descoberta={candidatos:nomes.map(termo=>({termo,tipo:'tema',evidencia:evidencia(termo)}))};
  const p={dominio,estado:'rascunho',ofertas:[],exclusoes:[]};
  const original=structuredClone(descoberta),r=gerarPalavras({perfil:p,descoberta});
  assert.equal(r.cobertura.rotulosSemObjetoDescartados,3);assert.deepEqual(descoberta,original);
  assert.deepEqual(r.candidatos.map(c=>c.termo),nomes.slice(3));
  const revisado=gerarPalavras({perfil:{...p,estado:'confirmado',ofertas:[{id:'declarada',nome:'Quem somos',origem:'usuario'}]},descoberta});
  assert.ok(revisado.candidatos.some(c=>c.termo==='Quem somos'&&c.ofertaId==='declarada'));
});
