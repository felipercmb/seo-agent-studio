import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inferirPerfil, corrigirPerfil} from '../src/modulos/perfil.mjs';
import {gerarPalavras} from '../src/modulos/palavras.mjs';
import {ErroConsulta} from '../src/consulta.mjs';
import {extrairContextoPublico} from '../src/modulos/contexto-publico.mjs';
import {createHash} from 'node:crypto';

const dominio = 'exemplo.com.br';
const coletadoEm = '2026-11-15T12:00:00.000Z';
const candidato = (termo, tipo = 'servico', url = 'https://exemplo.com.br/servicos') => ({termo, tipo,
  evidencia: {url, campo: 'schema:Service.name', trecho: termo, coletadoEm, sha256: 'a'.repeat(64)}});
const descoberta = {candidatos: [candidato('Exemplo', 'marca'), candidato('Contratação de artistas gospel'),
  candidato('Ana Paula Valadão', 'entidade'), candidato('show', 'tema')], cobertura: {paginasLidas: 3, limitada: true}};
const base = () => inferirPerfil({dominio, descoberta, coletadoEm});

test('perfil identifica somente ofertas publicadas sem inferir representação de artistas ou público', () => {
  const p = base();
  assert.equal(p.nome, 'Exemplo');
  assert.equal(p.estado, 'rascunho');
  assert.equal(p.ofertas.length, 1);
  assert.equal(p.ofertas[0].nome, 'Contratação de artistas gospel');
  assert.equal(p.ofertas[0].evidencias[0].sha256, 'a'.repeat(64));
  assert.equal(p.ofertas[0].origem, 'site');
  assert.deepEqual(p.ofertas[0].economia, {contribuicaoPorVenda: null, taxaFechamento: null});
  assert.equal(p.publico, '');
  assert.deepEqual(p.regioes, []);
  assert.match(p.resumo, /Confirme/);
  assert.equal(p.cobertura.paginasLidas, 3);
});

test('convites de recrutamento e parceria não viram ofertas, preservando termos publicados e contratação', () => {
  const convites = ['Seja um artista exclusivo da Agência Aurora', 'Seja nosso parceiro', 'Trabalhe conosco',
    'Junte-se à nossa equipe de artistas', 'Cadastre-se como artista', 'Faça parte do nosso time',
    'Torne-se um representante', 'Venha trabalhar conosco'];
  const servicos = ['Agenciamento e contratação de artistas', 'Contratação de artistas gospel',
    'Contratar Ana Paula Valadão'];
  const d = {candidatos: [...convites, ...servicos].map(termo => candidato(termo)), cobertura: {paginasLidas: 2}};
  const perfil = inferirPerfil({dominio, descoberta: d, coletadoEm});
  assert.deepEqual(perfil.ofertas.map(o => o.nome), servicos);
  const palavras = gerarPalavras({perfil, descoberta: d}).candidatos;
  for (const convite of convites) {
    const publicado = palavras.find(c => c.termo === convite);
    assert.equal(publicado.origem, 'site');
    assert.equal(publicado.ofertaId, null);
    assert.equal(publicado.evidencia.trecho, convite);
  }
  for (const servico of servicos) assert.ok(palavras.find(c => c.termo === servico).ofertaId);
});

test('sem ofertas ou com referência externa não fabrica negócio a partir do domínio', () => {
  const p = inferirPerfil({dominio: 'artistasgospel.com.br', descoberta: {candidatos: [candidato('Agenciamento', 'servico')]}});
  assert.equal(p.ofertas.length, 0);
  assert.equal(p.nome, 'artistasgospel.com.br');
  assert.match(p.resumo, /não identificou ofertas/);
  assert.equal(p.coletadoEm, null);
});

test('confirmação e correção são explícitas, isoladas por cópia e não retreinam modelo', () => {
  const p = base(), original = structuredClone(p);
  const confirmado = corrigirPerfil(p, {confirmado: true, publico: 'Organizadores de eventos', regioes: ['Goiânia']});
  assert.equal(confirmado.estado, 'confirmado');
  assert.equal(confirmado.publico, 'Organizadores de eventos');
  assert.deepEqual(p, original);
  assert.equal(corrigirPerfil(confirmado, {publico: 'Igrejas'}).estado, 'rascunho');
  assert.equal(corrigirPerfil(confirmado, {ofertas: [], confirmado: false}).ofertas.length, 0);
  assert.throws(() => corrigirPerfil(p, {ofertas: [], confirmado: true}), ErroConsulta);
  assert.ok(confirmado.limites.some(l => /não treinam automaticamente/.test(l)));
});

test('preserva ID e evidência ao confirmar; mudança do nome descarta ambos', () => {
  const p = base(), oferta = p.ofertas[0];
  const igual = corrigirPerfil(p, {ofertas: [{id: oferta.id, nome: oferta.nome, url: oferta.url}], confirmado: true}).ofertas[0];
  assert.equal(igual.id, oferta.id);
  assert.equal(igual.origem, 'site');
  assert.deepEqual(igual.evidencias, oferta.evidencias);
  const diferente = corrigirPerfil(p, {ofertas: [{id: oferta.id, nome: 'Produção de eventos'}]}).ofertas[0];
  assert.notEqual(diferente.id, oferta.id);
  assert.deepEqual(diferente.evidencias, []);
  assert.equal(diferente.url, null);
  assert.equal(diferente.origem, 'usuario');
});

test('dados financeiros declarados aceitam zero e desconhecido sem interpretar contrato como receita', () => {
  const p = base(), o = p.ofertas[0];
  const nova = corrigirPerfil(p, {ofertas: [{id: o.id, nome: o.nome, economia: {contribuicaoPorVenda: 2500, taxaFechamento: 0.1}}]}).ofertas[0];
  assert.deepEqual(nova.economia, {contribuicaoPorVenda: 2500, taxaFechamento: 0.1});
  assert.equal(nova.origem, 'usuario');
  const zero = corrigirPerfil(p, {ofertas: [{nome: o.nome, economia: {contribuicaoPorVenda: 0, taxaFechamento: 0}}]}).ofertas[0];
  assert.equal(zero.economia.taxaFechamento, 0);
  for (const economia of [{contribuicaoPorVenda: -1_000_000_001}, {contribuicaoPorVenda: Infinity}, {contribuicaoPorVenda: '100'},
    {taxaFechamento: 10}, {taxaFechamento: NaN}, {taxaFechamento: false}, {lucro: 1000}]) {
    assert.throws(() => corrigirPerfil(p, {ofertas: [{nome: o.nome, economia}]}), ErroConsulta);
  }
});

test('rejeita campos de evidência, métricas, IDs estranhos e URLs fora do domínio', () => {
  const p = base(), o = p.ofertas[0];
  for (const entrada of [{posicao: 1}, {volume: 500}, {confirmado: 'true'}, {nome: 'x'.repeat(121)},
    {ofertas: [{nome: o.nome, evidencias: []}]}, {ofertas: [{id: 'estranho', nome: o.nome}]},
    {regioes: ['Goiânia', 'Goiania']}, {ofertas: Array.from({length: 9}, (_, n) => ({nome: 'Oferta ' + n}))}]) {
    assert.throws(() => corrigirPerfil(p, entrada), ErroConsulta);
  }
  for (const url of ['https://outro.com/servico', 'javascript:alert(1)', 'https://exemplo.com.br/p?email=segredo',
    'http://127.0.0.1/', 'https://u:senha@exemplo.com.br/', 'https://exemplo.com.br:9000/', 'https://exemplo.com.br/p#segredo']) {
    assert.throws(() => corrigirPerfil(p, {ofertas: [{nome: o.nome, url}]}), ErroConsulta);
  }
});

test('palavras publicadas preservam origem; rascunho não cria variações ou volumes', () => {
  const r = gerarPalavras({perfil: base(), descoberta});
  assert.equal(r.cobertura.hipoteses, 0);
  assert.equal(r.candidatos.length, 4);
  assert.equal(r.candidatos[0].termo, 'Contratação de artistas gospel');
  assert.equal(r.candidatos[0].ofertaId, base().ofertas[0].id);
  assert.equal(r.candidatos[0].intencao, 'comercial');
  assert.equal(r.candidatos.find(c => c.termo === 'Ana Paula Valadão').ofertaId, null);
  assert.equal(r.candidatos.find(c => c.termo === 'show').intencao, 'informacional');
  assert.ok(r.candidatos.every(c => !Object.hasOwn(c, 'volume') && !Object.hasOwn(c, 'posicao')));
});

test('hipóteses vêm apenas de ofertas e regiões confirmadas, com exclusões e deduplicação', () => {
  const perfil = corrigirPerfil(base(), {confirmado: true, regioes: ['RJ'], exclusoes: ['preço de', 'show']});
  const r = gerarPalavras({perfil, descoberta});
  assert.ok(r.candidatos.some(c => c.termo === 'Contratação de artistas gospel em RJ' && c.origem === 'hipotese'));
  assert.ok(r.candidatos.some(c => c.termo === 'orçamento para Contratação de artistas gospel'));
  assert.equal(r.candidatos.filter(c => c.termo === 'Contratação de artistas gospel').length, 1);
  assert.equal(r.candidatos.find(c => c.termo === 'Contratação de artistas gospel').origem, 'site');
  assert.ok(!r.candidatos.some(c => /preço de|^show$|orçamento para Ana Paula/i.test(c.termo)));
  assert.ok(r.cobertura.excluidos >= 2);
});

test('oferta nova do usuário é hipótese sem evidência falsamente atribuída ao site', () => {
  const perfil = corrigirPerfil(base(), {confirmado: true, ofertas: [{nome: 'Produção de eventos'}]});
  const r = gerarPalavras({perfil, descoberta});
  const nova = r.candidatos.find(c => c.termo === 'Produção de eventos');
  assert.equal(nova.origem, 'hipotese');
  assert.equal(nova.evidencia, undefined);
  assert.equal(nova.ofertaId, perfil.ofertas[0].id);
  assert.equal(r.candidatos.find(c => c.termo === 'Contratação de artistas gospel').ofertaId, null);
});

test('não perde distinção entre linguagens C++ e C# e limita seleção priorizando vínculo', () => {
  const d = {candidatos: [candidato('Curso de C++'), candidato('Curso de C#'),
    ...Array.from({length: 98}, (_, n) => candidato('Tema publicado ' + n, 'tema'))]};
  const perfil = corrigirPerfil(inferirPerfil({dominio, descoberta: d}), {confirmado: true, regioes: ['São Paulo']});
  const r = gerarPalavras({perfil, descoberta: d});
  assert.equal(r.candidatos.length, 100);
  assert.equal(r.cobertura.limitada, true);
  assert.ok(r.candidatos.some(c => c.termo === 'Curso de C++'));
  assert.ok(r.candidatos.some(c => c.termo === 'Curso de C#'));
  assert.ok(r.candidatos.some(c => c.termo === 'inscrição em Curso de C++'));
  assert.ok(r.candidatos.some(c => c.termo === 'inscrição em Curso de C#'));
  assert.ok(r.candidatos.some(c => c.termo === 'Curso de C# em São Paulo'));
});

test('não enfileira combinação acima do limite de 160 caracteres nem corta a consulta', () => {
  const oferta = 'Consultoria de ' + 'a'.repeat(100);
  const regiao = 'Região ' + 'b'.repeat(50);
  const perfil = corrigirPerfil(base(), {confirmado: true, ofertas: [{nome: oferta}], regioes: [regiao]});
  const combinado = oferta + ' em ' + regiao;
  assert.ok(combinado.length > 160 && combinado.length <= 180);
  const r = gerarPalavras({perfil, descoberta});
  assert.ok(r.candidatos.every(c => c.termo.length <= 160));
  assert.ok(r.candidatos.some(c => c.termo === oferta));
  assert.ok(!r.candidatos.some(c => c.termo === combinado || c.termo === combinado.slice(0, 160)));
});

test('negação e títulos editoriais não se tornam ofertas pelo rótulo do extrator', () => {
  const d = {candidatos:[
    candidato('Instalação de ar-condicionado', 'servico', 'https://exemplo.com.br/servicos'),
    candidato('Não oferecemos instalação de ar-condicionado'),
    candidato('Sem instalação de ar-condicionado para automóveis'),
    {...candidato('Instalação de ar-condicionado industrial'), evidencia:{...candidato('x').evidencia,trecho:'Não realizamos instalação de ar-condicionado industrial'}},
    {...candidato('Guia de instalação de ar-condicionado'), evidencia:{...candidato('x').evidencia,campo:'h1',trecho:'Guia de instalação de ar-condicionado'}},
    {...candidato('O que é instalação de ar-condicionado'), evidencia:{...candidato('x').evidencia,campo:'h1',trecho:'O que é instalação de ar-condicionado'}},
  ]};
  const perfil = inferirPerfil({dominio,descoberta:d});
  assert.deepEqual(perfil.ofertas.map(o=>o.nome), ['Instalação de ar-condicionado']);
  const palavras = gerarPalavras({perfil:corrigirPerfil(perfil,{confirmado:true}),descoberta:d}).candidatos;
  assert.equal(palavras.find(c=>c.termo==='Não oferecemos instalação de ar-condicionado').ofertaId,null);
  assert.equal(palavras.find(c=>c.termo==='Não oferecemos instalação de ar-condicionado').intencao,'indefinida');
  assert.equal(palavras.find(c=>c.termo==='Guia de instalação de ar-condicionado').intencao,'informacional');
  assert.ok(!palavras.some(c=>c.origem==='hipotese' && /Não oferecemos|Sem instalação|Guia de|O que é/.test(c.termo)));
});

test('vagas são recrutamento e não herdam vínculo comercial de oferta confirmada', () => {
  const d = {candidatos:[candidato('Corretagem de imóveis'),candidato('Vagas para corretores de imóveis')]};
  const perfil = inferirPerfil({dominio,descoberta:d});
  assert.deepEqual(perfil.ofertas.map(o=>o.nome),['Corretagem de imóveis']);
  const palavras = gerarPalavras({perfil,descoberta:d}).candidatos;
  const vaga = palavras.find(c=>c.termo.startsWith('Vagas'));
  assert.equal(vaga.origem,'site');
  assert.equal(vaga.ofertaId,null);
  assert.equal(vaga.intencao,'navegacional');
});

test('trecho deve conter a expressão proposta e não confunde C++ com C#', () => {
  const d = {candidatos:[candidato('Curso de C++'),
    {...candidato('Curso de C#'),evidencia:{...candidato('x').evidencia,trecho:'Curso de C++'}},
    {...candidato('Assessoria jurídica'),evidencia:{...candidato('x').evidencia,trecho:'Esta página vende móveis'}}]};
  const perfil = inferirPerfil({dominio,descoberta:d});
  assert.deepEqual(perfil.ofertas.map(o=>o.nome),['Curso de C++']);
  const palavras = gerarPalavras({perfil,descoberta:d}).candidatos;
  assert.deepEqual(palavras.map(c=>c.termo),['Curso de C++']);
});

test('hipóteses flexionam apenas verbos iniciais de compra preservando a oferta original', () => {
  const d = {candidatos:[candidato('Contratar grupos musicais'),candidato('Comprar cadeiras'),candidato('Alugar equipamentos')]};
  const perfil = corrigirPerfil(inferirPerfil({dominio,descoberta:d}),{confirmado:true});
  const palavras = gerarPalavras({perfil,descoberta:d}).candidatos;
  assert.equal(palavras.find(c=>c.termo==='Contratar grupos musicais').origem,'site');
  for(const termo of ['orçamento para contratação de grupos musicais','preço de compra de cadeiras','orçamento para aluguel de equipamentos']) {
    assert.equal(palavras.find(c=>c.termo===termo)?.origem,'hipotese');
  }
  assert.ok(!palavras.some(c=>/^(?:orçamento para|preço de) (?:Contratar|Comprar|Alugar)/.test(c.termo)));
});

test('papel do negócio é hipótese corrigível e não infere público nem comissão', () => {
  const perfil = base();
  // Contratação sozinha não demonstra que a empresa intermediou o contrato.
  assert.equal(perfil.entendimento.papel,'servicos');
  assert.equal(perfil.entendimento.natureza,'hipotese');
  const inter = inferirPerfil({dominio,descoberta:{candidatos:[candidato('Agenciamento de artistas')]}});
  assert.equal(inter.entendimento.papel,'intermediacao');
  assert.ok(inter.entendimento.evidencias.length);
  assert.equal(inter.publico,'');
  assert.equal(inter.ofertas[0].economia.contribuicaoPorVenda,null);
  const declarado = corrigirPerfil(inter,{papel:'servicos',confirmado:true,publico:'Organizadores de eventos',regioes:['Brasil']});
  assert.equal(declarado.entendimento.papel,'servicos');
  assert.equal(declarado.entendimento.natureza,'declaracao_usuario');
  assert.deepEqual(declarado.entendimento.evidencias,[]);
  assert.ok(!declarado.perguntas.some(p=>['papel','publico','regioes'].includes(p.id)));
  assert.throws(()=>corrigirPerfil(inter,{papel:'exclusividade'}),ErroConsulta);
  assert.throws(()=>corrigirPerfil(inter,{entendimento:{papel:'servicos'}}),ErroConsulta);
});

test('livro ou guia declarado como produto não é descartado como notícia', () => {
  const d = {candidatos:[candidato('Guia de jardinagem','produto')]};
  const perfil = inferirPerfil({dominio,descoberta:d});
  assert.equal(perfil.ofertas[0].nome,'Guia de jardinagem');
  assert.equal(perfil.entendimento.papel,'produtos');
});

test('página de vagas e declaração de quem está contratando não definem oferta ao comprador', () => {
  const d = {candidatos:[candidato('Manutenção predial'),
    candidato('Assistente comercial','servico','https://exemplo.com.br/vagas/assistente'),
    candidato('Contratamos técnicos de manutenção','servico','https://exemplo.com.br/equipe')]};
  const perfil = inferirPerfil({dominio,descoberta:d});
  assert.deepEqual(perfil.ofertas.map(o=>o.nome),['Manutenção predial']);
  const palavras = gerarPalavras({perfil,descoberta:d}).candidatos;
  for(const termo of ['Assistente comercial','Contratamos técnicos de manutenção']) {
    assert.equal(palavras.find(c=>c.termo===termo).ofertaId,null);
    assert.equal(palavras.find(c=>c.termo===termo).intencao,'navegacional');
  }
});

test('alterar só premissas econômicas não apaga hipótese do papel sustentada pelo site', () => {
  const perfil = inferirPerfil({dominio,descoberta:{candidatos:[candidato('Agenciamento de artistas')]}});
  const oferta = perfil.ofertas[0];
  const editado = corrigirPerfil(perfil,{ofertas:[{id:oferta.id,nome:oferta.nome,url:oferta.url,economia:{contribuicaoPorVenda:100}}]});
  assert.equal(editado.entendimento.papel,'intermediacao');
  assert.equal(editado.entendimento.evidencias[0].trecho,oferta.nome);
});

test('vínculo literal reconhece pontuação final, diacríticos e preserva limites de palavras', () => {
  const d = {candidatos:[candidato('Contratar Fernandinho'),
    candidato('Quanto custa contratar Fernandinho?','tema'),
    candidato('Quanto custa contratar Fernandinhos?','tema'),
    candidato('Consultoria ambiental'),candidato('Consultória ambiental: orçamento','tema'),
    candidato('Curso de C++'),candidato('Curso de C#'),
    candidato('Preço do Curso de C++?','tema'),candidato('Preço do Curso de C#?','tema')]};
  const perfil = inferirPerfil({dominio,descoberta:d});
  const palavras = gerarPalavras({perfil,descoberta:d}).candidatos;
  const id = nome => perfil.ofertas.find(o => o.nome === nome).id;
  assert.equal(palavras.find(c=>c.termo==='Quanto custa contratar Fernandinho?').ofertaId,id('Contratar Fernandinho'));
  assert.equal(palavras.find(c=>c.termo==='Quanto custa contratar Fernandinhos?').ofertaId,null);
  assert.equal(palavras.find(c=>c.termo==='Consultória ambiental: orçamento').ofertaId,id('Consultoria ambiental'));
  assert.equal(palavras.find(c=>c.termo==='Preço do Curso de C++?').ofertaId,id('Curso de C++'));
  assert.equal(palavras.find(c=>c.termo==='Preço do Curso de C#?').ofertaId,id('Curso de C#'));
});

test('cem variantes de uma oferta não retiram todos os candidatos das outras ofertas', () => {
  const d = {candidatos:Array.from({length:100},(_,n)=>candidato('Consultoria ambiental setor '+n))};
  const perfil = corrigirPerfil(base(),{confirmado:true,ofertas:[{nome:'Consultoria ambiental'},{nome:'Auditoria energética'}]});
  const r = gerarPalavras({perfil,descoberta:d});
  assert.equal(r.candidatos.length,100);
  const segunda = perfil.ofertas.find(o=>o.nome==='Auditoria energética');
  assert.ok(r.candidatos.some(c=>c.ofertaId===segunda.id && c.termo==='Auditoria energética'));
  assert.ok(r.candidatos.findIndex(c=>c.ofertaId===segunda.id)<3);
  assert.equal(r.cobertura.limitada,true);
});

test('deduplicação de pontuação preserva primeira publicação e tecnologias distintas', () => {
  const d = {candidatos:[candidato('Consultoria ambiental'),candidato('Consultoria ambiental?'),
    candidato('Curso de C++'),candidato('Curso de C#')]};
  const r = gerarPalavras({perfil:inferirPerfil({dominio,descoberta:d}),descoberta:d});
  assert.ok(r.candidatos.some(c=>c.termo==='Consultoria ambiental'));
  assert.ok(!r.candidatos.some(c=>c.termo==='Consultoria ambiental?'));
  assert.ok(r.candidatos.some(c=>c.termo==='Curso de C++'));
  assert.ok(r.candidatos.some(c=>c.termo==='Curso de C#'));
});

test('vínculo conserva a oferta mais específica quando ambas aparecem literalmente', () => {
  const d = {candidatos:[candidato('Consultoria ambiental'),candidato('Consultoria ambiental industrial'),
    candidato('Preço de Consultoria ambiental industrial?','tema')]};
  const perfil = inferirPerfil({dominio,descoberta:d});
  const especifica = perfil.ofertas.find(o=>o.nome==='Consultoria ambiental industrial');
  const r = gerarPalavras({perfil,descoberta:d});
  assert.equal(r.candidatos.find(c=>c.termo==='Preço de Consultoria ambiental industrial?').ofertaId,especifica.id);
});

test('propósito editorial e pós-venda não estabelecem ofertas comerciais do domínio', () => {
  const cabecalho = (termo, caminho) => ({...candidato(termo,'servico','https://exemplo.com.br'+caminho),
    evidencia:{...candidato(termo).evidencia,url:'https://exemplo.com.br'+caminho,campo:'h2'}});
  const d = {candidatos:[candidato('Instalação de câmeras'),
    cabecalho('Garantia e assistência','/suporte/garantia'),
    cabecalho('Garantia e suporte','/servicos/cameras'),
    cabecalho('Comparação entre equipamentos de som','/conteudos/comparacao'),
    cabecalho('Câmera X vs Câmera Y','/pt-br/conteudos/comparacao')]};
  const perfil = inferirPerfil({dominio,descoberta:d});
  assert.deepEqual(perfil.ofertas.map(o=>o.nome),['Instalação de câmeras']);
  const r = gerarPalavras({perfil,descoberta:d}).candidatos;
  assert.equal(r.find(c=>c.termo==='Garantia e assistência').intencao,'navegacional');
  assert.equal(r.find(c=>c.termo==='Comparação entre equipamentos de som').intencao,'informacional');
  assert.equal(r.find(c=>c.termo==='Câmera X vs Câmera Y').intencao,'informacional');
});

test('garantia estendida e suporte ofertado explicitamente continuam elegíveis', () => {
  const d = {candidatos:[candidato('Garantia estendida para equipamentos'),
    candidato('Suporte técnico contratado'),
    {...candidato('Assistência técnica','servico','https://exemplo.com.br/servicos/assistencia'),
      evidencia:{...candidato('Assistência técnica').evidencia,url:'https://exemplo.com.br/servicos/assistencia',campo:'h1'}},
    candidato('Comparador de preços de equipamentos','produto','https://exemplo.com.br/produtos/comparador')]};
  const perfil = inferirPerfil({dominio,descoberta:d});
  assert.deepEqual(perfil.ofertas.map(o=>o.nome),d.candidatos.map(c=>c.termo));
});

test('atendimento não herda uma oferta por substring; oferta exata declarada tem origem explícita', () => {
  const d = {candidatos:[candidato('Instalação de câmeras'),
    candidato('Ajuda com Instalação de câmeras','atendimento','https://exemplo.com.br/ajuda'),
    candidato('Suporte técnico','atendimento','https://exemplo.com.br/suporte')]};
  const perfil = corrigirPerfil(inferirPerfil({dominio,descoberta:d}),{confirmado:true,
    ofertas:[{nome:'Instalação de câmeras'},{nome:'Suporte técnico'}]});
  const r = gerarPalavras({perfil,descoberta:d}).candidatos;
  assert.equal(r.find(c=>c.termo==='Ajuda com Instalação de câmeras').ofertaId,null);
  const suporte = r.find(c=>c.termo==='Suporte técnico');
  assert.equal(suporte.ofertaId,perfil.ofertas.find(o=>o.nome==='Suporte técnico').id);
  assert.equal(suporte.contextoFonte,'atendimento');
  assert.match(suporte.motivo,/pessoa declarou/);
  assert.equal(suporte.intencao,'navegacional');
  assert.equal(r.find(c=>c.termo==='orçamento para Suporte técnico').intencao,'comercial');
});

test('contexto público recupera descrição e nome de serviço exato de um título quando a descoberta não o classificou', () => {
  const html = '<html><head><title>Hospedagem de Sites: Rápida e Segura | Exemplo</title><meta name="description" content="Hospedagem de sites para criar e gerenciar seu negócio."></head><body><h1>Sua ideia no ar.</h1></body></html>';
  const coleta = {dominio,coletadoEm,paginas:[{url:'https://exemplo.com.br/',html,status:200,coletadoEm}]};
  const contextoPublico = extrairContextoPublico(coleta);
  const perfil = inferirPerfil({dominio,descoberta:{candidatos:[]},coletadoEm,contextoPublico});
  assert.equal(contextoPublico.cobertura.paginasLidas,1);
  assert.ok(!JSON.stringify(contextoPublico).includes('<html>'));
  assert.equal(perfil.ofertas[0].nome,'Hospedagem de Sites');
  assert.equal(perfil.ofertas[0].evidencias[0].trecho,'Hospedagem de Sites: Rápida e Segura | Exemplo');
  assert.equal(perfil.entendimento.descricaoPublicada.texto,'Hospedagem de sites para criar e gerenciar seu negócio.');
  assert.match(perfil.resumo,/descrição publicada/);
  const palavras = gerarPalavras({perfil,descoberta:{candidatos:[]}}).candidatos;
  assert.equal(palavras[0].termo,'Hospedagem de Sites');
  assert.equal(palavras[0].origem,'site');
  assert.equal(palavras[0].evidencia.sha256,createHash('sha256').update(html).digest('hex'));
  assert.ok(!palavras.some(c=>c.termo===perfil.entendimento.descricaoPublicada.texto));
});

test('contexto usa declarações Service/Product e não executa scripts nem lê valores de formulário', () => {
  const html = '<html><head><title>Exemplo</title><script>globalThis.contextoExecutou=true</script><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@graph':[{'@type':'Organization',name:'Empresa Exemplo',description:'A descrição publicada pela empresa.'},{'@type':'Service',name:'Assinatura digital de documentos'},{'@type':'Product',name:'Mesa ajustável'}]})+'</script></head><body><form><input value="segredo_do_formulario"><h1>Hospedagem oculta</h1></form></body></html>';
  globalThis.contextoExecutou = false;
  const contextoPublico = extrairContextoPublico({dominio,paginas:[{url:'https://exemplo.com.br/',html,status:200,coletadoEm}]});
  assert.equal(globalThis.contextoExecutou,false);
  delete globalThis.contextoExecutou;
  assert.ok(!JSON.stringify(contextoPublico).includes('segredo_do_formulario'));
  assert.ok(!contextoPublico.evidencias.some(e=>e.trecho==='Hospedagem oculta'));
  const perfil = inferirPerfil({dominio,contextoPublico});
  assert.equal(perfil.nome,'Empresa Exemplo');
  assert.ok(perfil.ofertas.some(o=>o.nome==='Assinatura digital de documentos'));
  assert.ok(perfil.ofertas.some(o=>o.nome==='Mesa ajustável'));
  assert.equal(perfil.entendimento.papel,'misto');
});

test('contexto rejeita página externa, hash divergente e conteúdo bloqueado sem rejuvenescer data', () => {
  const html = '<title>Plataforma de gestão</title>';
  const contextoPublico = extrairContextoPublico({dominio,coletadoEm,paginas:[
    {url:'https://outro.com/',html,status:200,coletadoEm},
    {url:'https://exemplo.com.br/divergente',html,status:200,coletadoEm,sha256:'a'.repeat(64)},
    {url:'https://exemplo.com.br/bloqueado',html,status:403,coletadoEm},
    {url:'https://exemplo.com.br/valido',html,status:200,coletadoEm:'2026-01-01T10:00:00Z'},
  ]});
  assert.equal(contextoPublico.cobertura.paginasLidas,1);
  assert.equal(contextoPublico.cobertura.limitada,true);
  assert.equal(contextoPublico.evidencias[0].coletadoEm,'2026-01-01T10:00:00Z');
});

test('contexto e resumo têm limites, incluindo páginas, evidências e textos', () => {
  const paginas = Array.from({length:14},(_,n)=>({url:'https://exemplo.com.br/p'+n,status:200,coletadoEm,
    html:'<title>Plataforma de gestão '+n+'</title><meta name="description" content="'+('Descrição publicada '.repeat(50))+'"><h1>Sistema de gestão '+n+'</h1>'}));
  const contextoPublico = extrairContextoPublico({dominio,coletadoEm,paginas});
  assert.equal(contextoPublico.cobertura.paginasLidas,12);
  assert.equal(contextoPublico.cobertura.limitada,true);
  assert.ok(contextoPublico.evidencias.length<=24);
  assert.ok(contextoPublico.evidencias.every(e=>e.trecho.length<=600));
  const perfil = inferirPerfil({dominio,coletadoEm,contextoPublico});
  assert.ok(perfil.resumo.length<=1600);
  assert.ok(perfil.ofertas.length<=8);
});

test('correções do usuário preservam a descrição pública como fonte independente do papel', () => {
  const html = '<title>Sistema de gestão</title><meta name="description" content="Sistema de gestão para empresas.">';
  const contextoPublico = extrairContextoPublico({dominio,coletadoEm,paginas:[{url:'https://exemplo.com.br/',html,coletadoEm,status:200}]});
  const perfil = inferirPerfil({dominio,contextoPublico});
  const fonte = perfil.entendimento.descricaoPublicada;
  const corrigido = corrigirPerfil(perfil,{papel:'produtos',resumo:'Descrição revisada por quem conhece a empresa.',ofertas:[{nome:'Produto declarado'}],confirmado:true});
  assert.equal(corrigido.resumo,'Descrição revisada por quem conhece a empresa.');
  assert.deepEqual(corrigido.entendimento.descricaoPublicada,fonte);
  assert.equal(corrigido.entendimento.natureza,'declaracao_usuario');
  assert.equal(corrigido.ofertas[0].origem,'usuario');
});

test('perguntas de FAQ e slogans não são nomes de oferta; orçamento continua hipótese comercial', () => {
  const d = {candidatos:[candidato('Contratar músico'),
    {...candidato('O software é seguro?'),evidencia:{...candidato('O software é seguro?').evidencia,campo:'h2'}},
    candidato('Quanto custa contratar músico?','tema'),
    {...candidato('Quer ver tudo que você pode contratar?'),evidencia:{...candidato('Quer ver tudo que você pode contratar?').evidencia,campo:'h2'}},
    candidato('o maior petshop online do Brasil'),candidato('Welcome to automation in the agentic era')]};
  const perfil = inferirPerfil({dominio,descoberta:d});
  assert.deepEqual(perfil.ofertas.map(o=>o.nome),['Contratar músico']);
  const r = gerarPalavras({perfil,descoberta:d}).candidatos;
  assert.equal(r.find(c=>c.termo==='O software é seguro?').intencao,'informacional');
  assert.equal(r.find(c=>c.termo==='Quanto custa contratar músico?').intencao,'comercial');
  assert.ok(r.find(c=>c.termo==='Quanto custa contratar músico?').ofertaId);
});

test('benefícios publicados na página de recrutamento não viram ofertas ao comprador', () => {
  const d = {candidatos:[candidato('Contratação de shows'),
    {...candidato('Mais shows, melhores cachês','servico','https://exemplo.com.br/seja-artista'),
      evidencia:{...candidato('Mais shows, melhores cachês').evidencia,url:'https://exemplo.com.br/seja-artista',campo:'h2'}}]};
  const perfil = inferirPerfil({dominio,descoberta:d});
  assert.deepEqual(perfil.ofertas.map(o=>o.nome),['Contratação de shows']);
  const r = gerarPalavras({perfil,descoberta:d}).candidatos;
  assert.equal(r.find(c=>c.termo==='Mais shows, melhores cachês').intencao,'navegacional');
  assert.equal(r.find(c=>c.termo==='Mais shows, melhores cachês').ofertaId,null);
});

test('títulos de comércio e cabeçalhos descritivos recuperam ofertas sem criar catálogo específico', () => {
  const html = '<title>Exemplo | Loja de móveis e artigos para casa</title><h2>Comércio de equipamentos para restaurantes</h2><h2>Plano de saúde para cães</h2><h3>VPS NVMe 4</h3>';
  const contextoPublico = extrairContextoPublico({dominio,paginas:[{url:'https://exemplo.com.br/',html,status:200,coletadoEm}]});
  const perfil = inferirPerfil({dominio,contextoPublico});
  for (const nome of ['Loja de móveis e artigos para casa','Comércio de equipamentos para restaurantes','Plano de saúde para cães','VPS NVMe 4']) {
    const oferta = perfil.ofertas.find(o=>o.nome===nome);
    assert.ok(oferta, nome);
    assert.ok(oferta.evidencias[0].trecho.includes(nome));
  }
  assert.equal(perfil.entendimento.papel,'misto');
  assert.ok(!perfil.ofertas.some(o=>o.nome==='Sofá' || o.nome==='Ração'));
});

test('declaração Store/OnlineStore prova somente hipótese de atividade comercial, não produtos específicos', () => {
  for(const tipo of ['Store','OnlineStore']) {
    const html = '<title>Exemplo</title><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':tipo,name:'Loja Exemplo',url:'/'})+'</script>';
    const contextoPublico = extrairContextoPublico({dominio,paginas:[{url:'https://exemplo.com.br/',html,status:200,coletadoEm}]});
    assert.ok(contextoPublico.evidencias.some(e=>e.campo==='jsonld.'+tipo+'.name'));
    const perfil = inferirPerfil({dominio,contextoPublico});
    assert.equal(perfil.entendimento.papel,'produtos');
    assert.equal(perfil.entendimento.natureza,'hipotese');
    assert.equal(perfil.ofertas.length,0);
    assert.equal(perfil.entendimento.evidencias[0].campo,'jsonld.'+tipo+'.name');
  }
});

test('software para comércio e artigo sobre loja não são declarados como varejistas', () => {
  for (const [titulo, caminho, papel] of [['Software para loja de móveis','/','servicos'],['Loja de móveis','/blog/comparacao','indefinido']]) {
    const contextoPublico = extrairContextoPublico({dominio,paginas:[{url:'https://exemplo.com.br'+caminho,html:'<title>'+titulo+'</title>',status:200,coletadoEm}]});
    const perfil = inferirPerfil({dominio,contextoPublico});
    assert.equal(perfil.entendimento.papel,papel);
  }
});

test('Produto no depoimento e Store de domínio externo não definem negócio desta empresa', () => {
  const html = '<title>Exemplo</title><section class="testimonials"><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'Product',name:'Objeto elogiado'})+'</script></section><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'OnlineStore',name:'Loja externa',url:'https://outro.com/'})+'</script>';
  const contextoPublico = extrairContextoPublico({dominio,paginas:[{url:'https://exemplo.com.br/',html,status:200,coletadoEm}]});
  assert.ok(!contextoPublico.evidencias.some(e=>/Objeto elogiado|Loja externa/.test(e.trecho)));
  const perfil = inferirPerfil({dominio,contextoPublico});
  assert.equal(perfil.ofertas.length,0);
  assert.equal(perfil.entendimento.papel,'indefinido');
});

test('perfil mostra que oito propostas são um recorte quando há mais nomes elegíveis', () => {
  const d = {candidatos:Array.from({length:12},(_,n)=>candidato('Serviço especializado '+n)),cobertura:{paginasLidas:2,limitada:false}};
  const perfil = inferirPerfil({dominio,descoberta:d});
  assert.equal(perfil.ofertas.length,8);
  assert.equal(perfil.cobertura.ofertasElegiveis,12);
  assert.equal(perfil.cobertura.ofertasLimitadas,true);
  assert.equal(perfil.cobertura.limitada,true);
});

test('contribuição declarada pode ser negativa sem virar prejuízo observado e mantém limites da taxa', () => {
  const perfil = base(), oferta = perfil.ofertas[0];
  const corrigido = corrigirPerfil(perfil,{ofertas:[{id:oferta.id,nome:oferta.nome,
    economia:{contribuicaoPorVenda:-125.5,taxaFechamento:0.2}}],confirmado:true});
  assert.equal(corrigido.ofertas[0].economia.contribuicaoPorVenda,-125.5);
  assert.equal(corrigido.ofertas[0].origem,'usuario');
  for(const contribuicao of [-1_000_000_001,1_000_000_001]) {
    assert.throws(()=>corrigirPerfil(perfil,{ofertas:[{nome:oferta.nome,economia:{contribuicaoPorVenda:contribuicao}}]}),ErroConsulta);
  }
  assert.throws(()=>corrigirPerfil(perfil,{ofertas:[{nome:oferta.nome,economia:{contribuicaoPorVenda:-100,taxaFechamento:-0.1}}]}),ErroConsulta);
});

test('cabeçalho comercial exige forma nominal, preservando planos gratuitos e nomes de ofertas', () => {
  const html = '<title>Exemplo</title><h2>Faça como outras empresas e impulsione sua gestão financeira</h2><h2>Você sobe a foto. A plataforma cuida do resto.</h2><h3>4 ways to use contact management automation</h3><h3>Platform controls</h3><h2>Plano gratuito da plataforma</h2><h2>Criação de Loja Virtual Completa</h2><h3>VPS NVMe 4</h3>';
  const contextoPublico = extrairContextoPublico({dominio,paginas:[{url:'https://exemplo.com.br/',html,status:200,coletadoEm}]});
  const perfil = inferirPerfil({dominio,contextoPublico});
  assert.deepEqual(perfil.ofertas.map(o=>o.nome),['Plano gratuito da plataforma','Criação de Loja Virtual Completa','VPS NVMe 4']);
  assert.ok(!contextoPublico.evidencias.some(e=>/Faça como|Você sobe|4 ways|Platform controls/.test(e.trecho)));
});
