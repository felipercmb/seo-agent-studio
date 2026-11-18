import test from 'node:test';
import assert from 'node:assert/strict';
import {extrairCondicoesEstruturadas, verificarCompatibilidade, ErroCondicaoEstruturada} from '../src/modulos/condicoes-estruturadas.mjs';

const hash = 'a'.repeat(64);
const coleta = '2026-11-16T10:00:00.000Z';
const fonte = texto => ({id: 'fonte_1', texto, url: 'https://empresa.com.br/plano', sha256: hash, coletadoEm: coleta});
const escopo = {id: 'plano_amplo', descricao: 'Capacidade do plano Amplo', confirmado: true};
const extrair = (texto, extra = {}) => extrairCondicoesEstruturadas({ofertaId: 'oferta_1', dominio: 'empresa.com.br', fontes: [fonte(texto)], escopo, ...extra});
const publicada = (texto = 'Entre 81 e 200 itens.') => extrair(texto).condicoes[0];
const comparar = (pub, min, max, extra = {}) => verificarCompatibilidade(pub, {...pub, minimo: min, maximo: max, ...extra});

test('extrai os padrões explícitos com e sem espaços preservando limites inclusivos', () => {
  for (const [frase, min, max] of [['até10 usuários', null, 10], ['no máximo 10 usuários', null, 10], ['de11a30 usuários', 11, 30],
    ['de 11 até 30 usuários', 11, 30], ['entre81e200 usuários', 81, 200], ['mais de80 e até200 usuários', 81, 200], ['mais de 80 usuários', 81, null]]) {
    const r = extrair(frase);
    assert.equal(r.condicoes.length, 1, frase);
    assert.deepEqual([r.condicoes[0].minimo, r.condicoes[0].maximo], [min, max], frase);
    assert.equal(r.condicoes[0].unidade, 'usuarios');
    assert.equal(r.condicoes[0].fraseLiteral, frase);
  }
});

test('origem, objeto, escopo e frase contínua são preservados', () => {
  const original = 'Plano Amplo — entre 81 e 200 itens. Detalhes.';
  const p = publicada(original);
  assert.equal(p.fonteId, 'fonte_1');
  assert.equal(p.ofertaId, 'oferta_1');
  assert.equal(p.url, fonte('').url);
  assert.equal(p.sha256, hash);
  assert.equal(p.coletadoEm, coleta);
  assert.equal(p.escopoId, escopo.id);
  assert.equal(p.escopoConfirmado, true);
  assert.equal(p.vigenciaConfirmada, false);
  assert.equal(original.slice(p.inicio, p.fim), p.fraseLiteral);
});

test('não confirma automaticamente o escopo da oferta', () => {
  const p = extrair('Até 10 usuários.', {escopo: undefined}).condicoes[0];
  assert.equal(p.escopoId, null);
  assert.equal(p.escopoConfirmado, false);
  assert.equal(verificarCompatibilidade(p, p).compativel, false);
  assert.ok(verificarCompatibilidade(p, p).erros.includes('escopo_nao_confirmado'));
});

test('ausência de limite inferior não é convertida em zero ou capacidade ilimitada', () => {
  const p = publicada('Até 10 usuários.');
  assert.equal(p.minimo, null);
  assert.equal(p.minimoPublicado, false);
  const r = comparar(p, null, 10);
  assert.equal(r.compativel, true);
  assert.equal(r.estado, 'compativel_nos_limites_publicados');
  assert.deepEqual(r.limitesNaoPublicados, ['minimo']);
  assert.equal(r.elegibilidadeConfirmada, false);
  const criado = comparar(p, 0, 10);
  assert.equal(criado.compativel, false);
  assert.ok(criado.erros.includes('minimo_sem_base_publicada'));
});

test('ausência de teto não é preenchida por conveniência', () => {
  const p = publicada('Mais de 80 documentos.');
  assert.equal(p.maximo, null);
  assert.equal(p.maximoPublicado, false);
  assert.ok(comparar(p, 81, 200).erros.includes('maximo_sem_base_publicada'));
});

test('faixa 81..200 distingue fronteiras 80,81,200,201', () => {
  const p = publicada();
  for (const [n, esperado] of [[80, false], [81, true], [200, true], [201, false]]) {
    assert.equal(comparar(p, n, n).compativel, esperado, String(n));
  }
});

test('omissão de teto fornece contraexemplo 201', () => {
  const r = comparar(publicada(), 81, null);
  assert.equal(r.compativel, false);
  assert.ok(r.erros.includes('limite_superior_omitido'));
  assert.deepEqual(r.contraexemplos, [201]);
});

test('faixa disjunta acima fornece contraexemplo presente na recomendação', () => {
  const r = comparar(publicada(), 300, 400);
  assert.equal(r.compativel, false);
  assert.deepEqual(r.contraexemplos, [300]);
});

test('faixa disjunta abaixo e ampliação dos dois lados fornecem testemunhas válidas', () => {
  assert.deepEqual(comparar(publicada(), 0, 10).contraexemplos, [10]);
  const r = comparar(publicada(), 0, 500);
  assert.deepEqual(r.contraexemplos, [80, 201]);
});

test('subfaixa é compatível sem afirmar elegibilidade ou atualidade', () => {
  const r = comparar(publicada(), 100, 180);
  assert.equal(r.compativel, true);
  assert.equal(r.elegibilidadeConfirmada, false);
  assert.equal(r.vigenciaConfirmada, false);
});

test('cada unidade tem identidade própria, sem converter assinaturas em usuários', () => {
  const unidades = ['usuários', 'itens', 'documentos', 'assinaturas', 'colaboradores', 'produtos', 'projetos', 'arquivos', 'sites', 'páginas', 'licenças', 'contatos', 'kg'];
  const ps = unidades.map(u => publicada(`Entre 1 e 10 ${u}.`));
  for (let i = 0; i < ps.length; i++) {
    for (let j = 0; j < ps.length; j++) {
      assert.equal(verificarCompatibilidade(ps[i], ps[j]).compativel, i === j, `${unidades[i]} / ${unidades[j]}`);
    }
  }
});

test('normaliza somente singular e plural explícitos da mesma unidade', () => {
  assert.equal(publicada('Até 1 usuário.').unidade, 'usuarios');
  assert.equal(publicada('Até 1 item.').unidade, 'itens');
  assert.equal(publicada('Até 1 colaborador.').unidade, 'colaboradores');
  assert.equal(extrair('Até 10 colaboradore.').condicoes.length, 0);
});

test('troca de oferta, escopo, descrição ou evidência bloqueia compatibilidade', () => {
  const p = publicada();
  for (const extra of [{ofertaId: 'oferta_2'}, {escopoId: 'outro'}, {escopoDescricao: 'Outro objeto'}, {escopoConfirmado: false},
    {fonteId: 'fonte_2'}, {url: 'https://outra.com.br/plano'}, {sha256: 'b'.repeat(64)}, {coletadoEm: '2026-11-15T10:00:00.000Z'}]) {
    const r = comparar(p, 81, 200, extra);
    assert.equal(r.compativel, false, JSON.stringify(extra));
    assert.equal(r.contraexemplos.length, 0);
  }
});

test('não confunde duração de teste com capacidade', () => {
  const r = extrair('30 dias de teste; até 10 usuários.');
  assert.equal(r.condicoes.length, 1);
  assert.equal(r.condicoes[0].maximo, 10);
  assert.equal(r.condicoes[0].unidade, 'usuarios');
  assert.ok(r.naoInterpretadas.some(x => x.motivo === 'duracao_nao_e_capacidade'));
  assert.equal(extrair('Até 30 dias de teste.').condicoes.length, 0);
});

test('não converte taxa mensal ou por usuário em estoque absoluto', () => {
  for (const s of ['até10 assinaturas/mês', 'Até 10 assinaturas por mês.', 'Até 10 documentos, por mês.',
    'Por mês, até 10 documentos.', 'Até 10 assinaturas digitais por mês.', 'Até 10 documentos por usuário.', 'Até 10 documentos a cada dia.',
    'Até 10 documentos ao mês.', 'Até 10 documentos, mensalmente.', 'Mensalmente, até 10 documentos.', 'Até 10 documentos em 30 dias.']) {
    const r = extrair(s);
    assert.equal(r.condicoes.length, 0, s);
    assert.ok(r.naoInterpretadas.some(x => x.motivo === 'taxa_ou_periodicidade_nao_comparavel_a_capacidade'), s);
  }
});

test('recusa unidades qualificadas, exceções e negação sem resumir a regra', () => {
  for (const s of ['Até 10 usuários ativos.', 'Até 10 usuários simultâneos.', 'Não inclui até 10 usuários.',
    'Até 10 usuários se houver contrato anual.', 'Até 10 usuários, exceto convidados.', 'Até 10 usuários sem custo.', 'Até 10 usuários ou até 20 documentos.']) {
    assert.equal(extrair(s).condicoes.length, 0, s);
  }
});

test('padrões ausentes ou não suportados ficam sem interpretação', () => {
  for (const s of ['Usuários ilimitados.', 'A partir de 10 usuários.', 'Menos de 10 usuários.', 'Até 1.000 usuários.',
    'De 1,5 até 10 usuários.', 'De -1 até 10 usuários.', 'Entre 1.5 e até 10 usuários.', 'Até -10 usuários.', '10 usuários.', 'Até 10 usuáriosVIP.']) {
    const r = extrair(s);
    assert.equal(r.condicoes.length, 0, s);
    assert.ok(r.naoInterpretadas.length > 0, s);
  }
});

test('intervalo vazio e overflow não viram faixa útil', () => {
  for (const s of ['De 30 a 11 usuários.', 'Mais de 200 e até 200 itens.', `Mais de ${Number.MAX_SAFE_INTEGER} usuários.`, 'Até 9007199254740992 documentos.']) {
    const r = extrair(s);
    assert.equal(r.condicoes.length, 0, s);
    assert.ok(r.naoInterpretadas.length > 0, s);
  }
});

test('booleans, negativos, fracionários, NaN, intervalos vazios e ambos desconhecidos são recusados', () => {
  const p = publicada();
  for (const [min, max] of [[true, 200], [81, false], [-1, 200], [1.5, 200], [NaN, 200], [81, Infinity], [201, 200], [null, null], ['81', 200]]) {
    const r = comparar(p, min, max);
    assert.equal(r.compativel, false);
    assert.equal(r.estado, 'entrada_invalida');
  }
});

test('marcadores de limite publicado precisam ser consistentes', () => {
  const p = publicada();
  assert.equal(verificarCompatibilidade({...p, minimoPublicado: false}, p).estado, 'entrada_invalida');
});

test('valida fonte, domínio, hash e instante sem consultar nada', () => {
  const original = fonte('Até 10 usuários.');
  for (const extra of [{url: 'http://localhost/plano'}, {url: 'https://empresa.com.br@outra.com.br/plano'},
    {url: 'https://outra.com.br/plano'}, {url: 'https://empresa.com.br:8080/plano'}, {url: 'file:///tmp/a'},
    {url: 'https://empresa.com.br/plano#outro'}, {sha256: 'não é hash'}, {coletadoEm: '2026-02-30T00:00:00Z'},
    {coletadoEm: '2026-11-16'}, {texto: 'Até 10 usuários.\u202e'}]) {
    assert.throws(() => extrair('ignorado', {fontes: [{...original, ...extra}]}), ErroCondicaoEstruturada, JSON.stringify(extra));
  }
});

test('fontes não podem ser coladas para produzir uma faixa que nenhuma publicou', () => {
  const r = extrair('ignorado', {fontes: [fonte('De 11 a'), {...fonte('30 usuários.'), id: 'fonte_2'}]});
  assert.equal(r.condicoes.length, 0);
  assert.equal(r.naoInterpretadas.length, 2);
});

test('duas capacidades no mesmo segmento continuam separadas', () => {
  const r = extrair('Até 10 usuários e até 20 documentos.');
  assert.deepEqual(r.condicoes.map(c => [c.unidade, c.maximo]), [['usuarios', 10], ['documentos', 20]]);
});

test('offsets de citação usam os índices do texto original, inclusive emoji', () => {
  const s = '📦 Plano: até 10 usuários.';
  const r = extrair(s);
  const p = r.condicoes[0];
  assert.equal(s.slice(p.inicio, p.fim), 'até 10 usuários');
  assert.equal(r.naoInterpretadas.length, 0);
});

test('entrada e escopo inválidos não ganham confirmação implícita', () => {
  for (const escopoRuim of [{id: 'x', descricao: 'y', confirmado: 'true'}, {id: '', descricao: 'y', confirmado: true}, {id: 'x', confirmado: true}]) {
    assert.throws(() => extrair('Até 10 usuários.', {escopo: escopoRuim}), ErroCondicaoEstruturada);
  }
  assert.throws(() => extrairCondicoesEstruturadas({ofertaId: 'oferta_1', fontes: [] , ignorado: 1}), ErroCondicaoEstruturada);
  assert.throws(() => extrair('Até 10 usuários.', {fontes: [fonte('Até 10 usuários.'), fonte('Até 20 usuários.')]}), ErroCondicaoEstruturada);
});

test('leitura vazia preserva ausência e nenhuma entrada é modificada', () => {
  const entrada = {ofertaId: 'oferta_1', fontes: [fonte('Entre 81 e 200 itens.')], escopo};
  const copia = structuredClone(entrada);
  extrairCondicoesEstruturadas(entrada);
  assert.deepEqual(entrada, copia);
  const vazio = extrairCondicoesEstruturadas({ofertaId: 'oferta_1', fontes: []});
  assert.deepEqual(vazio.condicoes, []);
  assert.deepEqual(vazio.naoInterpretadas, []);
});

test('comparação de faixas pequenas concorda com inclusão enumerada e toda testemunha é válida', () => {
  const p = publicada();
  for (let a = 0; a <= 5; a++) for (let b = a; b <= 5; b++) {
    const pub = {...p, minimo: a, maximo: b};
    for (let c = 0; c <= 5; c++) for (let d = c; d <= 5; d++) {
      const r = comparar(pub, c, d);
      const candidatos = Array.from({length: d - c + 1}, (_, i) => c + i);
      assert.equal(r.compativel, candidatos.every(n => n >= a && n <= b), `${a}..${b} vs ${c}..${d}`);
      if (!r.compativel) assert.ok(r.contraexemplos.length > 0);
      for (const n of r.contraexemplos) assert.ok(n >= c && n <= d && (n < a || n > b));
    }
  }
});


test('peso inteiro em kg mantém a referência e produz limite sem converter outras unidades',()=>{
 const texto='Suas encomendas até 50 kg na modalidade rodoviária.',c=extrair(texto).condicoes[0];assert.equal(c.unidade,'kg');assert.equal(c.maximo,50);assert.equal(c.minimo,null);assert.equal(texto.slice(c.inicio,c.fim),c.fraseLiteral);assert.equal(c.vigenciaConfirmada,false);assert.equal(publicada('Até 30 quilos.').unidade,'kg');assert.equal(publicada('Até 30 quilogramas.').maximo,30);
});

test('peso decimal, taxa e unidade diferente não viram capacidade inteira em kg',()=>{
 for(const texto of ['Até 1,5 kg.','Até 1.5 kg.','Até 50 kg por dia.','Até 50 g.','Até 50 kgf.','Mais de 10 kg.','Mais de 10 e até 50 kg.'])assert.equal(extrair(texto).condicoes.length,0,texto);
});

test('capacidade em kg não é comparada com contagem de produtos',()=>{
 const a=publicada('Até 50 kg.'),b=publicada('Até 50 produtos.'),r=verificarCompatibilidade(a,b);assert.equal(r.compativel,false);assert.ok(r.erros.includes('unidade_diferente'));assert.equal(r.elegibilidadeConfirmada,undefined);
});
