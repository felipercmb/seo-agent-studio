import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analisarPaginas} from '../src/analise.mjs';

const agora = '2026-11-14T20:00:00.000Z';
const pagina = (html, caminho = '/') => ({url: 'https://oficina.example' + caminho, html,
  coletadoEm: agora, bytes: new TextEncoder().encode(html).length, sha256: 'a'.repeat(64), status: 200});
const completo = corpo => `<!doctype html><html lang="pt-BR"><head><title>Oficina &amp; consertos</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Consertos</h1><a href="tel:+552700000000">Telefone</a>${corpo}</body></html>`;
const analisar = (paginas, falhas = []) => analisarPaginas({dominio: 'oficina.example', coletadoEm: agora, paginas, falhas});
const item = (rel, id) => rel.verificacoes.find(v => v.id === id);

test('produz até três correções com evidência, sem vazar HTML ou valores preenchidos', () => {
  const rel = analisar([pagina('<html><body><h1>Oficina</h1><input value="DADO_PESSOAL"><button></button><img src="foto.jpg"></body></html>')]);
  assert.equal(rel.estado, 'concluido');
  assert.deepEqual(rel.acoes.map(v => v.id), ['rotulos-formulario', 'contato-identificavel', 'viewport-mobile']);
  assert.equal(item(rel, 'rotulos-formulario').evidencia.quantidade, 2);
  assert.equal(item(rel, 'alternativas-imagens').estado, 'atencao');
  assert.equal(item(rel, 'titulo-pagina').estado, 'atencao');
  assert.equal(item(rel, 'idioma-pagina').estado, 'atencao');
  assert.ok(rel.acoes.every(v => v.passos.length && v.prioridade && v.esforco && v.evidencia.url));
  assert.ok(!JSON.stringify(rel).includes('DADO_PESSOAL'));
  assert.ok(!('html' in rel.paginas[0]));
  assert.equal(rel.paginas[0].sha256, 'a'.repeat(64));
});

test('reconhece rótulos nativos, referências ARIA válidas, entidades e nomes de botões', () => {
  const rel = analisar([pagina(completo(`
    <label for="nome">Nome &amp; sobrenome</label><input id="nome">
    <label>Seu e-mail <input type="email"></label>
    <span id="pedido" hidden>Descreva o pedido</span><textarea aria-labelledby="inexistente pedido">DADO_PESSOAL</textarea>
    <select aria-label="Serviço"><option>Uma opção</option></select>
    <button><img alt="Enviar pedido" src="enviar.png"></button>
    <button><svg><title>Abrir menu</title></svg></button>
    <input type="submit"><input type="reset"><input type="button" value="Cancelar">
    <input type="image" alt="Enviar"><input title="Referência do pedido">
  `))]);
  assert.equal(item(rel, 'rotulos-formulario').estado, 'verificado');
  assert.deepEqual(rel.acoes.map(v => v.estado), ['manual', 'manual', 'manual']);
  assert.equal(item(rel, 'titulo-pagina').estado, 'verificado');
  assert.ok(!JSON.stringify(rel).includes('DADO_PESSOAL'));
});

test('referência ARIA inválida e placeholder não substituem o nome; controles ocultos não viram problemas', () => {
  const rel = analisar([pagina(completo(`
    <input aria-labelledby="fantasma" placeholder="Seu nome">
    <input aria-labelledby="vazio"><span id="vazio"></span>
    <input disabled><input type="hidden"><div hidden><input><button></button></div>
    <div aria-hidden="true"><input></div><div style="display: none !important"><input></div>
    <script>document.write('<input>')</script><template><input></template>
  `))]);
  assert.equal(item(rel, 'rotulos-formulario').evidencia.quantidade, 2);
});

test('alt vazio e imagens decorativas são aceitos; falta de alternativa é observada sem avaliar sua qualidade', () => {
  const rel = analisar([pagina(completo(`
    <img alt=""><img role="presentation"><img role="none"><img aria-label="Serviço"><img aria-labelledby="descricao">
    <span id="descricao">Peça consertada</span><img hidden><div hidden><img></div><img src="sem-alt.jpg">
  `))]);
  assert.equal(item(rel, 'alternativas-imagens').evidencia.quantidade, 1);
  assert.match(item(rel, 'alternativas-imagens').orientacao, /decorativas/);
});

test('HTML malformado é analisado por parser e SVG title não substitui o título da página', () => {
  const rel = analisar([pagina('<html lang="português brasileiro"><meta name="viewport" content="width=device-width"><body><h1>Reparo <b>rápido</b><svg><title>Logo</title></svg><label for="n">Nome &amp; sobrenome</label><input id="n">')]);
  assert.equal(item(rel, 'rotulos-formulario').estado, 'verificado');
  assert.equal(item(rel, 'titulo-pagina').estado, 'atencao');
  assert.equal(item(rel, 'titulo-principal').estado, 'verificado');
  assert.equal(item(rel, 'viewport-mobile').estado, 'verificado');
  assert.equal(item(rel, 'idioma-pagina').estado, 'atencao');
});

test('agrega ocorrências mas conserva as páginas afetadas e não afirma ausência de contato quando encontrou um link', () => {
  const inicial = pagina('<html lang="pt-BR"><title>Oficina</title><h1>Oficina</h1><img><input>');
  const contato = pagina(completo('<img><img><input aria-label="Nome">'), '/contato');
  const rel = analisar([inicial, contato], [{url: 'https://oficina.example/servicos', motivo: 'Timeout'}]);
  assert.equal(rel.estado, 'parcial');
  assert.equal(item(rel, 'alternativas-imagens').evidencia.quantidade, 3);
  assert.deepEqual(item(rel, 'alternativas-imagens').paginasAfetadas, [inicial.url, contato.url]);
  assert.equal(item(rel, 'alternativas-imagens').evidencia.url, inicial.url);
  assert.equal(item(rel, 'contato-identificavel').estado, 'verificado');
  assert.equal(item(rel, 'contato-identificavel').evidencia.url, contato.url);
  assert.match(item(rel, 'contato-identificavel').evidencia.trecho, /não foram testados/);
  assert.match(rel.limites.join(' '), /não comprova ausência no site inteiro/);
});

test('falha de coleta entrega conferências humanas, sem inventar defeitos de título, contato ou acessibilidade', () => {
  const rel = analisar([], [{url: 'https://oficina.example/', motivo: 'A leitura foi bloqueada.'}]);
  assert.equal(rel.estado, 'indisponivel');
  assert.deepEqual(rel.paginas, []);
  assert.equal(rel.acoes.length, 3);
  assert.ok(rel.acoes.every(v => v.estado === 'manual'));
  assert.equal(item(rel, 'titulo-pagina'), undefined);
  assert.equal(item(rel, 'coleta-publica').estado, 'indisponivel');
  assert.ok(!rel.verificacoes.some(v => v.estado === 'atencao'));
});

test('limita HTML e páginas sem diagnosticar HTML truncado, páginas de erro ou conteúdo vazio', () => {
  const rejeitado = analisar([pagina('x'.repeat(1024 * 1024 + 1)), {...pagina('<title>Erro</title>'), status: 403}, pagina(' ') ]);
  assert.equal(rejeitado.estado, 'indisponivel');
  assert.equal(rejeitado.falhas.length, 3);
  const limitado = analisar([0, 1, 2, 3].map(i => pagina(completo(''), '/pagina-' + i)));
  assert.equal(limitado.paginas.length, 3);
  assert.equal(limitado.estado, 'parcial');
  assert.match(limitado.falhas[0].motivo, /três páginas/);
});

test('a mesma captura produz o mesmo diagnóstico e os identificpalcos permanecem estáveis após correção', () => {
  const antes = analisar([pagina(completo('<input>'))]);
  assert.deepEqual(antes, analisar([pagina(completo('<input>'))]));
  const depois = analisar([pagina(completo('<label>Nome<input></label>'))]);
  assert.deepEqual(antes.verificacoes.map(v => v.id), depois.verificacoes.map(v => v.id));
  assert.equal(item(antes, 'rotulos-formulario').estado, 'atencao');
  assert.equal(item(depois, 'rotulos-formulario').estado, 'verificado');
  assert.ok(depois.verificacoes.every(v => v.evidencia.trecho.length <= 220));
});

test('id duplicado não associa o rótulo do primeiro controle ao segundo', () => {
  const rel = analisar([pagina(completo('<label for="n">Nome</label><input id="n"><input id="n">'))]);
  assert.equal(item(rel, 'rotulos-formulario').evidencia.quantidade, 1);
});

test('valor explicitamente vazio em botão de envio não é confundido com nome padrão', () => {
  const rel = analisar([pagina(completo('<input type="submit" value=""><input type="reset" value=""><input type="submit">'))]);
  assert.equal(item(rel, 'rotulos-formulario').evidencia.quantidade, 2);
});

test('muitos rótulos explícitos e envolventes mantêm associações corretas em HTML limitado', () => {
  const quantidade = 2500;
  const html = completo(Array.from({length: quantidade}, (_, i) =>
    `<label for="campo-${i}">Nome ${i}</label><input id="campo-${i}"><label>Telefone ${i}<input></label>`).join(''));
  const rel = analisar([pagina(html)]);
  assert.equal(rel.estado, 'concluido');
  assert.equal(item(rel, 'rotulos-formulario').estado, 'verificado');
});

test('âncora de contato é um indício, mas parâmetro de busca e aria-label em title vazio não são', () => {
  const comAncora = analisar([pagina('<title>Oficina</title><a href="#contato">Contato</a><section id="contato">Atendimento</section>')]);
  assert.equal(item(comAncora, 'contato-identificavel').estado, 'verificado');
  const semIndicio = analisar([pagina('<title aria-label="Nome"></title><a href="/busca?proximo=/contato">Pesquisar</a>')]);
  assert.equal(item(semIndicio, 'contato-identificavel').estado, 'atencao');
  assert.equal(item(semIndicio, 'titulo-pagina').estado, 'atencao');
});
