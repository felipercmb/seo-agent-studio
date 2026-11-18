import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recuperarFontesNegocio} from '../ia/negocio/recuperacao.mjs';

const dominio='exemplo.com.br',sha256='a'.repeat(64),coletadoEm='2026-11-16T03:00:00Z';
const fonte=(id,texto,extras={})=>({id,texto,tipo:'conteudo',url:'https://exemplo.com.br/',campo:'p',coletadoEm,sha256,recortado:false,...extras});
const pool=fontes=>({versao:1,dominio,fontes});

test('entendimento prefere declaração própria e deixa interface fora da prova',()=>{
  const entrada=pool([fonte('s1','Somos uma plataforma que conecta contratantes e prestadores.',{tipo:'declaracao'}),fonte('s2','Fale com um especialista',{tipo:'interface',campo:'button'}),fonte('s3','A cor do ano foi anunciada em uma exposição artística.')]);
  const r=recuperarFontesNegocio(entrada,{campo:'papel'});
  assert.equal(r.fontes[0].id,'s1');assert.ok(!r.fontes.some(f=>f.tipo==='interface'));assert.ok(r.auditoria.descartes.some(f=>f.id==='s2'));
  assert.equal(r.modo,'end_to_end');assert.equal(r.alvos,undefined);
});

test('restrição explícita de público permanece inteira e com prioridade de leitura',()=>{
  const texto='Inscrição e seleção: CNPJ obrigatório. Indisponível para profissionais autônomos. A seleção depende da abertura de oportunidades.';
  const r=recuperarFontesNegocio(pool([fonte('neg',texto),...Array.from({length:8},(_,i)=>fonte('positivo'+i,'Clientes de empresas podem conhecer os nossos serviços '+i+'.'))]),{campo:'publicos',maxFontes:2});
  assert.equal(r.fontes[0].id,'neg');assert.equal(r.fontes[0].texto,texto);assert.ok(r.auditoria.candidatos.find(c=>c.id==='neg').motivos.some(m=>m.criterio==='restricao_de_elegibilidade_preservada'));
});

test('páginas relevantes diferentes não desaparecem atrás de uma página longa',()=>{
  const fontes=Array.from({length:30},(_,i)=>fonte('home'+i,'Oferecemos serviços de manutenção e produtos técnicos para empresas '+i+'.'));
  for(const [i,nome] of ['Consultoria','Cursos','Locação'].entries())fontes.push(fonte('outra'+i,'Oferecemos '+nome+' para clientes empresariais.',{url:'https://exemplo.com.br/linha-'+i}));
  const r=recuperarFontesNegocio(pool(fontes),{campo:'ofertas',maxFontes:4});
  assert.equal(new Set(r.fontes.map(f=>f.url)).size,4);assert.ok(r.fontes.every(f=>fontes.some(origem=>JSON.stringify(origem)===JSON.stringify(f))));
});

test('texto repetido na mesma URL não consome duas fontes',()=>{
  const r=recuperarFontesNegocio(pool([fonte('p','Oferecemos consultoria de tecnologia.'),fonte('meta','Oferecemos consultoria de tecnologia.',{tipo:'descricao',campo:'meta.description'})]),{campo:'ofertas'});
  assert.equal(r.fontes.length,1);assert.ok(r.auditoria.descartes.some(d=>d.motivo==='texto_repetido_na_mesma_pagina'));
});

test('nome estruturado de produto pode entrar sem vocabulário comercial adicional',()=>{
  const r=recuperarFontesNegocio(pool([fonte('produto','Mesa dobrável 120',{tipo:'declaracao',campo:'jsonld.Product.name'})]),{campo:'ofertas'});
  assert.equal(r.fontes[0].texto,'Mesa dobrável 120');assert.equal(r.fontes[0].campo,'jsonld.Product.name');
});

test('orçamento descarta fontes inteiras sem cortar condição ou alterar entrada',()=>{
  const longa=fonte('longa','Oferecemos serviços. '+('Condição publicada extensa. '.repeat(16))),curta=fonte('curta','Serviços com atendimento mediante agendamento.');
  const entrada=pool([longa,curta]),copia=structuredClone(entrada);const r=recuperarFontesNegocio(entrada,{campo:'condicoes',maxCaracteres:150});
  assert.ok(r.auditoria.caracteresModelo<=150);assert.ok(!r.fontes.some(f=>f.id==='longa'));assert.deepEqual(entrada,copia);assert.ok(r.fontes.every(f=>f.texto===entrada.fontes.find(x=>x.id===f.id).texto));
});

test('contexto de escopo preserva cabeçalho vizinho antes de preencher o limite',()=>{
  const r=recuperarFontesNegocio(pool([fonte('titulo','Plano Essencial',{campo:'h2'}),fonte('condicao','Indisponível para empresas com filial no exterior.',{secao:'Plano Essencial'}),fonte('outro','Produtos e serviços para empresas com mensalidade e garantia.')]),{campo:'condicoes',maxFontes:2});
  assert.ok(r.fontes.some(f=>f.id==='condicao'));assert.ok(r.fontes.some(f=>f.id==='titulo'));assert.deepEqual(r.auditoria.escoposVizinhos,[{fonteId:'condicao',contextoId:'titulo',origem:'ordem_de_leitura',relacaoSemanticaConfirmada:false}]);
});

test('bloco publicado com nome e condição não é reconstruído de trechos distantes',()=>{
  const texto='Plano Essencial Disponível apenas para empresas com um estabelecimento.';
  const r=recuperarFontesNegocio(pool([fonte('condicao','Disponível apenas para empresas com um estabelecimento.',{secao:'Plano Essencial'}),fonte('bloco',texto,{campo:'bloco.titulo-conteudo',secao:'Plano Essencial'}),fonte('outra','Plano Avançado',{campo:'h2'})]),{campo:'condicoes'});
  assert.ok(r.fontes.some(f=>f.id==='bloco'&&f.texto===texto));assert.ok(!r.fontes.some(f=>f.texto.includes('Avançado')&&f.texto.includes('estabelecimento')));
});

test('interface só é canal para recomendação e tem cota própria',()=>{
  const entrada=pool(['Fale conosco','Onde encontrar','Solicitar orçamento','Agendar'].map((t,i)=>fonte('i'+i,t,{tipo:'interface',campo:'button'})));
  assert.equal(recuperarFontesNegocio(entrada,{campo:'ofertas'}).fontes.length,0);
  const r=recuperarFontesNegocio(entrada,{campo:'recomendar'});assert.equal(r.fontes.length,2);assert.ok(r.fontes.every(f=>f.tipo==='interface'));
});

test('sem HTML exportado retorna abstenção de contexto, sem completar pelo domínio',()=>{
  const r=recuperarFontesNegocio(pool([]),{campo:'papel'});assert.deepEqual(r.fontes,[]);assert.equal(r.auditoria.fontesNoPool,0);assert.equal(r.auditoria.caracteresModelo,13);
});

test('metadado inválido ou fonte de outro domínio é rejeitada sem consertar hash/data',()=>{
  const r=recuperarFontesNegocio(pool([fonte('externa','Somos uma empresa de serviços.',{url:'https://outra.com/'}),fonte('data','Somos uma empresa de serviços.',{coletadoEm:null}),fonte('hash','Somos uma empresa de serviços.',{sha256:'x'})]),{campo:'papel'});assert.equal(r.fontes.length,0);assert.equal(r.auditoria.descartes.length,3);
});

test('Cf publicado sobrevive à recuperação e sua projeção é contada',()=>{
  const f=fonte('cf','Serviços indisponíveis.\u200d Para outros planos, consulte as condições.');const r=recuperarFontesNegocio(pool([f]),{campo:'condicoes'});assert.deepEqual(r.fontes,[f]);assert.equal(r.auditoria.caracteresModelo,JSON.stringify({fontes:[{id:f.id,texto:f.texto,tipo:f.tipo}]}).length);
});

test('deduplicação não apaga grafias e nomes distintos por remoção de acentos',()=>{
  const r=recuperarFontesNegocio(pool([fonte('a','Café',{tipo:'declaracao',campo:'jsonld.Product.name'}),fonte('b','Cafe',{tipo:'declaracao',campo:'jsonld.Product.name'})]),{campo:'ofertas'});assert.equal(r.fontes.length,2);
});

test('escopo de outra URL ou subpalavra C+ não é emprestado a C++',()=>{
  const r=recuperarFontesNegocio(pool([fonte('curto','Curso C+',{tipo:'declaracao',campo:'jsonld.Course.name'}),fonte('outro','Curso C++ Inclui vinte aulas.',{campo:'bloco.titulo-conteudo'}),fonte('externo','Curso C+ Inclui vinte aulas.',{campo:'bloco.titulo-conteudo',url:'https://exemplo.com.br/outra'})]),{campo:'ofertas'});assert.equal(r.fontes.length,3);assert.ok(!r.auditoria.escoposVizinhos.some(v=>v.fonteId==='curto'));
});
