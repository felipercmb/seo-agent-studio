import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {coletarSite, criarPoliticaRobots, destinoPermitido, enderecoPublico, selecionarLinks, lerSitemap} from '../src/coleta.mjs';

const html = texto => new Response(texto, {headers: {'content-type': 'text/html; charset=utf-8'}});
const txt = texto => new Response(texto, {headers: {'content-type': 'text/plain'}});
const redireciona = destino => new Response(null, {status: 302, headers: {location: destino}});
const ehDNS = url => ['dns.google', 'cloudflare-dns.com'].includes(new URL(url).hostname);
const xml = texto => new Response(texto, {headers: {'content-type': 'application/xml; charset=utf-8'}});
const mapa = caminhos => '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + caminhos.map(c => '<url><loc>https://empresa.com.br' + c + '</loc></url>').join('') + '</urlset>';

function ambiente({paginas = {}, robots, dns} = {}) {
  const pedidos = [];
  const fetch = async (valor, init) => {
    const url = new URL(valor);
    pedidos.push({url: url.href, init});
    if (ehDNS(url)) {
      if (dns) return dns(url, init);
      return Response.json({Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{type: 1, data: '93.184.215.14'}] : []});
    }
    if (url.pathname === '/robots.txt') return robots ? robots(url, init) : new Response(null, {status: 404});
    return paginas[url.href] ? paginas[url.href](url, init) : html('<title>Uma página</title>');
  };
  return {fetch, pedidos};
}

test('transporte global mantém contexto e usa modos de redirect compatíveis com Workers', async t => {
  const env = ambiente();
  t.mock.method(globalThis, 'fetch', function(url, init) {
    assert.equal(this, globalThis);
    if (!['manual', 'follow'].includes(init.redirect)) throw new TypeError('Invalid redirect value');
    assert.equal(init.redirect, 'manual');
    return env.fetch(url, init);
  });
  const r = await coletarSite('empresa.com.br');
  assert.equal(r.paginas.length, 1);
  assert.deepEqual(r.falhas, []);
});

test('redirect do provedor DNS não é seguido para outro destino', async () => {
  const env = ambiente({dns: () => redireciona('https://127.0.0.1/segredo')});
  const r = await coletarSite('empresa.com.br', env);
  assert.equal(r.paginas.length, 0);
  assert.ok(env.pedidos.every(p => ehDNS(p.url)));
  assert.match(r.falhas[0].motivo, /DNS HTTP_302/);
});

test('endereços só permitem unicast público, incluindo as formas IPv6', () => {
  for (const ip of ['93.184.215.14', '1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2804:14c:3b80:0:0:0:0:1']) assert.equal(enderecoPublico(ip), true, ip);
  for (const ip of ['0.0.0.0', '10.2.3.4', '100.64.0.1', '100.127.255.255', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.254', '192.0.0.9', '192.0.2.1', '192.88.99.1', '192.168.1.2', '198.18.0.1',
    '198.51.100.1', '203.0.113.5', '224.0.0.1', '255.255.255.255', '01.1.1.1', '999.1.1.1',
    '::', '::1', 'fe80::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '2001:db8::1',
    '2001::1', '2002:7f00:1::', '3fff::1', '2606:::1', '2606::1::2', '1234', 'example.com']) {
    assert.equal(enderecoPublico(ip), false, ip);
  }
});

test('destinos aceitam só HTTPS do domínio exato ou www e caminhos públicos sem parâmetros', () => {
  assert.equal(destinoPermitido('/contato', 'empresa.com.br', 'https://empresa.com.br/').href, 'https://empresa.com.br/contato');
  assert.equal(destinoPermitido('https://www.empresa.com.br/sobre', 'empresa.com.br').hostname, 'www.empresa.com.br');
  for (const valor of ['http://empresa.com.br/', 'https://empresa.com.br:8080/', 'https://usuario@empresa.com.br/',
    'https://empresa.com.br.evil.com/', 'https://127.0.0.1/', 'https://loja.empresa.com.br/',
    'https://empresa.com.br/?chave=privada', 'https://empresa.com.br/#contato', 'https://empresa.com.br/log%6Fut',
    'https://empresa.com.br/wp-admin/', 'https://empresa.com.br/api/excluir', 'https://empresa.com.br/conta']) {
    assert.equal(destinoPermitido(valor, 'empresa.com.br'), null, valor);
  }
});

test('robots combina grupos específicos, ignora grupos de outros robôs e resolve regras por especificidade', () => {
  const politica = criarPoliticaRobots(`User-agent: *\nDisallow: /\nUser-agent: ConsultaVisibilidade\nDisallow: /privado\nDisallow: /contato*\nAllow: /contato/equipe$\nUser-agent: ConsultaVisibilidade\nAllow: /privado/publico\nDisallow: /igual\nAllow: /igual\n`);
  assert.equal(politica('/'), true);
  assert.equal(politica('/privado'), false);
  assert.equal(politica('/privado/publico'), true);
  assert.equal(politica('/contato/equipe'), true);
  assert.equal(politica('/contato/equipe/'), false);
  assert.equal(politica('/igual'), true);
  assert.equal(criarPoliticaRobots('User-agent: Googlebot\nDisallow: /')('/'), true);
  assert.equal(criarPoliticaRobots('User-agent: *\nDisallow: /nao\nDisallow: /ação')('/%6Eao'), false);
  assert.equal(criarPoliticaRobots('User-agent: *\nDisallow: /ação')('/a%C3%A7%C3%A3o'), false);
  assert.equal(criarPoliticaRobots('User-agent: *\nDisallow:')('/'), true);
});

test('seleção prioriza contato/sobre/serviços sem seguir ações, arquivos, nofollow ou endereços externos', () => {
  const documento = `<a href="/servicos">Serviços</a><a href="/sobre">Sobre nós</a><a href="/contato">Fale conosco</a>
    <a href="/contato">Contato repetido</a><a href="https://outro.com/contato">Contato externo</a>
    <a href="/logout">Contato</a><a href="/contato?segredo=1">Contato</a><a href="/contato.pdf">Contato PDF</a>
    <a href="/fale-conosco" rel="nofollow">Atendimento</a><div hidden><a href="/atendimento">Atendimento oculto</a></div>`;
  assert.deepEqual(selecionarLinks(documento, 'https://empresa.com.br/', 'empresa.com.br'), ['https://empresa.com.br/contato', 'https://empresa.com.br/sobre']);
});

test('modo busca prioriza uma página comercial e contato; modo social permanece igual', async () => {
  const documento = '<a href="/sobre">Sobre</a><a href="/contato">Contato</a><a href="/servicos">Serviços</a><a href="/produtos">Produtos</a>';
  assert.deepEqual(selecionarLinks(documento, 'https://empresa.com.br/', 'empresa.com.br', 'busca'), ['https://empresa.com.br/servicos','https://empresa.com.br/contato']);
  assert.deepEqual(selecionarLinks(documento, 'https://empresa.com.br/', 'empresa.com.br'), ['https://empresa.com.br/contato','https://empresa.com.br/sobre']);
  const env = ambiente({paginas:{'https://empresa.com.br/':() => html(documento)}});
  const r = await coletarSite('empresa.com.br', {...env, objetivo:'busca'});
  assert.deepEqual(r.paginas.map(p=>p.url), ['https://empresa.com.br/','https://empresa.com.br/servicos','https://empresa.com.br/contato']);
});

test('âncora vazia não ocupa a vaga de uma página comercial diferente',()=>{
  const documento='<a href="#">Serviços e produtos</a><a href="/servicos">Serviços</a><a href="/contato">Contato</a>';
  assert.deepEqual(selecionarLinks(documento,'https://empresa.com.br/','empresa.com.br','busca'),['https://empresa.com.br/servicos','https://empresa.com.br/contato']);
  assert.equal(destinoPermitido('https://empresa.com.br/#','empresa.com.br').href,'https://empresa.com.br/');
  assert.equal(destinoPermitido('/#detalhe','empresa.com.br','https://empresa.com.br/'),null);
});

test('coleta conserva três documentos distintos em vez de buscar a homepage com fragmento outra vez',async()=>{
  const env=ambiente({paginas:{'https://empresa.com.br/':()=>html('<h1>Serviços</h1><a href="#">Serviços e produtos</a><a href="/servicos">Serviços</a><a href="/contato">Contato</a>')}});
  const r=await coletarSite('empresa.com.br',{...env,objetivo:'busca'});
  assert.deepEqual(r.paginas.map(p=>p.url),['https://empresa.com.br/','https://empresa.com.br/servicos','https://empresa.com.br/contato']);
  assert.ok(env.pedidos.every(p=>!p.url.endsWith('#')));
});

test('limite opcional de requisições inclui resolução DNS e impede novos acessos', async () => {
  const env = ambiente();
  const r = await coletarSite('empresa.com.br', {...env, objetivo:'busca', limiteRequisicoes:3});
  assert.equal(env.pedidos.length, 3);
  assert.equal(r.paginas.length, 0);
  assert.match(r.falhas[0].motivo, /limite de requisições/);
  const minimo = ambiente();
  await coletarSite('empresa.com.br', {...minimo, limiteRequisicoes:0});
  assert.equal(minimo.pedidos.length, 1);
});

test('coleta até três páginas, preserva bytes/hash/data e não envia credenciais', async () => {
  const inicio = '<html lang="pt-BR"><title>Oficina</title><a href="/sobre">Sobre</a><a href="/contato">Contato</a><a href="/servicos">Serviços</a></html>';
  const env = ambiente({paginas: {'https://empresa.com.br/': () => html(inicio)}});
  const r = await coletarSite('www.empresa.com.br', {...env, agora: () => new Date('2026-11-14T12:00:00Z')});
  assert.deepEqual(r.paginas.map(p => p.url), ['https://empresa.com.br/', 'https://empresa.com.br/contato', 'https://empresa.com.br/sobre']);
  assert.equal(r.paginas[0].bytes, new TextEncoder().encode(inicio).length);
  assert.equal(r.paginas[0].html, inicio);
  assert.match(r.paginas[0].sha256, /^[a-f\d]{64}$/);
  assert.equal(r.coletadoEm, '2026-11-14T12:00:00.000Z');
  assert.deepEqual(r.falhas, []);
  for (const pedido of env.pedidos) {
    assert.equal(pedido.init.method, 'GET');
    assert.ok(!Object.keys(pedido.init.headers).some(x => /cookie|authorization/i.test(x)));
  }
  assert.equal(env.pedidos.filter(p => p.url.endsWith('/robots.txt')).length, 1);
});

test('DNS privado ou misto interrompe antes de qualquer acesso ao site', async () => {
  for (const ips of [['127.0.0.1'], ['93.184.215.14', '10.0.0.5'], ['::1'], ['2001:db8::1']]) {
    const env = ambiente({dns: () => Response.json({Status: 0, Answer: ips.map(data => ({type: data.includes(':') ? 28 : 1, data}))})});
    const r = await coletarSite('empresa.com.br', env);
    assert.equal(r.paginas.length, 0);
    assert.match(r.falhas[0].motivo, /endereços públicos/);
    assert.ok(env.pedidos.every(p => ehDNS(p.url)));
  }
});

test('DNS indisponível, resposta truncada ou sem endereço não autoriza a coleta', async () => {
  for (const resposta of [() => new Response('', {status: 503}), () => Response.json({Status: 3}), () => Response.json({Status: 0, TC: true}), () => Response.json({Status: 0, Answer: []})]) {
    const env = ambiente({dns: resposta});
    const r = await coletarSite('empresa.com.br', env);
    assert.equal(r.paginas.length, 0);
    assert.ok(env.pedidos.every(p => ehDNS(p.url)));
  }
});

test('robots pode impedir a raiz ou só uma página; erro de robots fecha a coleta', async () => {
  const bloqueado = ambiente({robots: () => txt('User-agent: *\nDisallow: /')});
  const b = await coletarSite('empresa.com.br', bloqueado);
  assert.equal(b.paginas.length, 0);
  assert.match(b.falhas[0].motivo, /robots.txt/);
  assert.ok(!bloqueado.pedidos.some(p => p.url === 'https://empresa.com.br/'));
  const parcial = ambiente({robots: () => txt('User-agent: *\nDisallow: /contato'), paginas: {'https://empresa.com.br/': () => html('<a href="/contato">Contato</a><a href="/sobre">Sobre</a>')}});
  const p = await coletarSite('empresa.com.br', parcial);
  assert.deepEqual(p.paginas.map(p => p.url), ['https://empresa.com.br/', 'https://empresa.com.br/sobre']);
  assert.equal(p.falhas[0].url, 'https://empresa.com.br/contato');
  for (const robots of [() => new Response(null, {status: 403}), () => html('<html>Desafio</html>'), () => txt('<html>Desafio</html>'), () => txt('x'.repeat(65537))]) {
    const env = ambiente({robots});
    assert.equal((await coletarSite('empresa.com.br', env)).paginas.length, 0);
    assert.ok(!env.pedidos.some(p => p.url === 'https://empresa.com.br/'));
  }
});

test('redirect externo, privado, HTTP ou com credenciais é rejeitado sem visitá-lo', async () => {
  for (const destino of ['https://127.0.0.1/', 'https://externo.com/', 'https://usuario:senha@empresa.com.br/', 'http://empresa.com.br/', '/contato?token=secreto']) {
    const env = ambiente({paginas: {'https://empresa.com.br/': () => redireciona(destino)}});
    const r = await coletarSite('empresa.com.br', env);
    assert.equal(r.paginas.length, 0);
    assert.match(r.falhas[0].motivo, /fora do escopo/);
    assert.ok(!env.pedidos.some(p => p.url === destino));
    assert.ok(!JSON.stringify(r).includes('senha'));
    assert.ok(!JSON.stringify(r).includes('secreto'));
  }
});

test('redirect www verifica DNS novamente e consulta robots do novo host', async () => {
  const env = ambiente({paginas: {'https://empresa.com.br/': () => redireciona('https://www.empresa.com.br/')}});
  const r = await coletarSite('empresa.com.br', env);
  assert.equal(r.paginas[0].url, 'https://www.empresa.com.br/');
  assert.ok(env.pedidos.some(p => p.url === 'https://www.empresa.com.br/robots.txt'));
  const i = env.pedidos.findIndex(p => p.url === 'https://www.empresa.com.br/');
  assert.ok(env.pedidos.slice(0, i).some(p => p.url.includes('name=www.empresa.com.br')));
});

test('revalidação DNS bloqueia mudança para IP privado entre robots e HTML', async () => {
  let lote = 0;
  const env = ambiente({dns: url => {
    if (url.searchParams.get('type') === 'A') lote++;
    return Response.json({Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{type: 1, data: lote > 1 ? '10.0.0.3' : '93.184.215.14'}] : []});
  }});
  const r = await coletarSite('empresa.com.br', env);
  assert.equal(r.paginas.length, 0);
  assert.ok(!env.pedidos.some(p => p.url === 'https://empresa.com.br/'));
});

test('limite de redirects e falhas HTTP são visíveis sem virar dados de análise', async () => {
  const paginas = {};
  for (let n = 0; n < 6; n++) paginas['https://empresa.com.br/' + (n || '')] = () => redireciona('/' + (n + 1));
  const env = ambiente({paginas});
  const r = await coletarSite('empresa.com.br', env);
  assert.equal(r.paginas.length, 0);
  assert.match(r.falhas[0].motivo, /redirecionou mais/);
  assert.equal(env.pedidos.filter(p => p.url.startsWith('https://empresa.com.br/') && !p.url.endsWith('/robots.txt')).length, 4);
  const negado = ambiente({paginas: {'https://empresa.com.br/': () => new Response('restrito', {status: 403})}});
  assert.match((await coletarSite('empresa.com.br', negado)).falhas[0].motivo, /HTTP 403/);
});

test('rejeita tipo errado e cancela stream acima do limite sem manter HTML parcial', async () => {
  const binario = ambiente({paginas: {'https://empresa.com.br/': () => new Response('arquivo', {headers: {'content-type': 'application/pdf'}})}});
  assert.match((await coletarSite('empresa.com.br', binario)).falhas[0].motivo, /página HTML/);
  let cancelado = false;
  const grande = ambiente({paginas: {'https://empresa.com.br/': () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel() { cancelado = true; },
  }), {headers: {'content-type': 'text/html'}})}});
  const r = await coletarSite('empresa.com.br', grande);
  assert.equal(r.paginas.length, 0);
  assert.match(r.falhas[0].motivo, /limite de leitura/);
  assert.equal(cancelado, true);
});

test('timeout limita fetch que não responde e cancela corpo que não termina', async () => {
  const travado = ambiente({dns: () => new Promise(() => {})});
  const inicio = Date.now();
  const r = await coletarSite('empresa.com.br', {...travado, tempoRequisicaoMs: 10});
  assert.equal(r.paginas.length, 0);
  assert.match(r.falhas[0].motivo, /demorou/);
  assert.ok(Date.now() - inicio < 1000);
  let cancelado = false;
  const corpo = ambiente({paginas: {'https://empresa.com.br/': () => new Response(new ReadableStream({cancel() { cancelado = true; }}), {headers: {'content-type': 'text/html'}})}});
  const s = await coletarSite('empresa.com.br', {...corpo, tempoRequisicaoMs: 10});
  assert.equal(s.paginas.length, 0);
  assert.equal(cancelado, true);
});

test('domínio inválido não causa requisições', async () => {
  const env = ambiente();
  for (const valor of ['127.0.0.1', '10.0.0.5', 'localhost', 'https://user:secret@empresa.com.br', 'empresa.internal']) {
    await assert.rejects(() => coletarSite(valor, env));
  }
  assert.equal(env.pedidos.length, 0);
});

test('desafio antibot com HTTP 200 nunca vira HTML analisável nem dispara fallback www', async () => {
  for (const emRobots of [false, true]) {
    let cancelado = false;
    const desafio = () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('<html><title>Just a moment</title></html>')); },
      cancel() { cancelado = true; },
    }), {status: 200, headers: {'content-type': 'text/html', 'cf-mitigated': 'challenge'}});
    const env = ambiente(emRobots ? {robots: desafio} : {paginas: {'https://empresa.com.br/': desafio}});
    const r = await coletarSite('empresa.com.br', env);
    assert.equal(r.paginas.length, 0);
    assert.match(r.falhas[0].motivo, /verificação de acesso/);
    assert.equal(cancelado, true);
    assert.ok(!env.pedidos.some(p => p.url.includes('www.empresa.com.br')));
    assert.ok(!JSON.stringify(r).includes('Just a moment'));
  }
});

test('apex sem DNS tenta www com DNS e robots próprios, preservando a falha de cobertura', async () => {
  const env = ambiente({dns: url => {
    if (url.searchParams.get('name') === 'empresa.com.br') return Response.json({Status: 3});
    return Response.json({Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{type: 1, data: '93.184.215.14'}] : []});
  }});
  const r = await coletarSite('www.empresa.com.br', env);
  assert.deepEqual(r.paginas.map(p => p.url), ['https://www.empresa.com.br/']);
  assert.equal(r.falhas[0].url, 'https://empresa.com.br/');
  assert.match(r.falhas[0].motivo, /continuou pelo endereço com www/);
  assert.ok(env.pedidos.some(p => p.url === 'https://www.empresa.com.br/robots.txt'));
  assert.ok(env.pedidos.some(p => p.url.includes('name=www.empresa.com.br')));
});

test('conexão indisponível no apex permite tentar www; recusa de acesso nunca permite', async () => {
  const env = ambiente({paginas: {'https://empresa.com.br/': () => { throw new TypeError('fetch failed'); }}});
  const r = await coletarSite('empresa.com.br', env);
  assert.deepEqual(r.paginas.map(p => p.url), ['https://www.empresa.com.br/']);
  for (const config of [
    {robots: () => txt('User-agent: *\nDisallow: /')},
    {robots: () => new Response(null, {status: 403})},
    {paginas: {'https://empresa.com.br/': () => new Response(null, {status: 403})}},
    {paginas: {'https://empresa.com.br/': () => redireciona('https://fora.com/')}},
    {dns: () => Response.json({Status: 0, Answer: [{type: 1, data: '10.0.0.1'}]})},
  ]) {
    const negado = ambiente(config);
    assert.equal((await coletarSite('empresa.com.br', negado)).paginas.length, 0);
    assert.ok(!negado.pedidos.some(p => p.url.includes('www.empresa.com.br')));
  }
});

test('www de fallback também respeita robots e endereços privados', async () => {
  for (const privado of [false, true]) {
    const env = ambiente({
      dns: url => url.searchParams.get('name') === 'empresa.com.br' ? Response.json({Status: 3}) :
        Response.json({Status: 0, Answer: [{type: 1, data: privado ? '127.0.0.1' : '93.184.215.14'}]}),
      robots: () => txt('User-agent: *\nDisallow: /'),
    });
    const r = await coletarSite('empresa.com.br', env);
    assert.equal(r.paginas.length, 0);
    assert.ok(!env.pedidos.some(p => p.url === 'https://www.empresa.com.br/'));
  }
});

test('Google é o resolvedor primário e desativa envio de sub-rede do cliente', async () => {
  const env = ambiente();
  assert.equal((await coletarSite('empresa.com.br', env)).paginas.length, 1);
  const consultas = env.pedidos.filter(p => ehDNS(p.url));
  assert.ok(consultas.length > 0);
  for (const consulta of consultas) {
    const url = new URL(consulta.url);
    assert.equal(url.origin + url.pathname, 'https://dns.google/resolve');
    assert.equal(url.searchParams.get('edns_client_subnet'), '0.0.0.0/0');
  }
});

test('falha de transporte, HTTP ou JSON do provedor permite uma cadeia alternativa A+AAAA', async () => {
  for (const rejeitar of [
    () => { throw new TypeError('transport-private-detail'); },
    () => new Response('provider-private-body', {status: 503}),
    () => new Response('<html>provider-private-body</html>'),
  ]) {
    const env = ambiente({dns: url => {
      if (url.hostname === 'dns.google') return rejeitar();
      return Response.json({Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{type: 1, data: '93.184.215.14'}] : []});
    }});
    const r = await coletarSite('empresa.com.br', env);
    assert.equal(r.paginas.length, 1);
    assert.deepEqual(r.falhas, []);
    const consultas = env.pedidos.filter(p => ehDNS(p.url));
    assert.deepEqual(consultas.slice(0, 4).map(p => new URL(p.url).hostname), ['dns.google', 'dns.google', 'cloudflare-dns.com', 'cloudflare-dns.com']);
    assert.equal(consultas.filter(p => new URL(p.url).hostname === 'cloudflare-dns.com').length, 4);
  }
});

test('rejeição DNS semântica nunca troca de provedor, mesmo se a outra família falhar por HTTP', async () => {
  for (const semantica of [
    {Status: 3}, {Status: 2}, {Status: 0, TC: true},
    {Status: 0, Answer: [{type: 1, data: '93.184.215.14'}, {type: 1, data: '10.0.0.1'}]},
  ]) {
    const env = ambiente({dns: url => url.searchParams.get('type') === 'A' ? Response.json(semantica) : new Response(null, {status: 503})});
    const r = await coletarSite('empresa.com.br', env);
    assert.equal(r.paginas.length, 0);
    assert.ok(env.pedidos.every(p => new URL(p.url).hostname === 'dns.google'));
  }
});

test('falha pública informa código DNS neutro sem corpo ou exceção do provedor', async () => {
  for (const [responder, codigo] of [
    [() => new Response('secret-provider-body', {status: 403}), 'HTTP_403'],
    [() => new Response('secret-provider-body'), 'JSON_INVALIDO'],
    [() => Response.json({Status: 5}), 'STATUS_5'],
    [() => { throw new Error('secret-provider-body'); }, 'TRANSPORTE'],
  ]) {
    const env = ambiente({dns: responder});
    const r = await coletarSite('empresa.com.br', env);
    assert.equal(r.paginas.length, 0);
    assert.ok(r.falhas[0].motivo.includes('DNS ' + codigo));
    assert.ok(!JSON.stringify(r).includes('secret-provider-body'));
  }
});

test('descoberta amplia links e intercala produtos, serviços e artistas sem ações ou nofollow', () => {
  const documento = '<a href="/produtos/um">Produto um</a><a href="/produtos/dois">Produto dois</a>' +
    '<a href="/servicos/revisao">Revisão</a><a href="/artistas/ana">Ana</a><a href="/historia">História</a>' +
    '<a href="/produtos/nao" rel="nofollow">Não</a><a href="/produtos/ficha.pdf">PDF</a>' +
    '<a href="/logout">Sair</a><a href="https://outro.com/produtos/um">Externo</a><a href="/privacidade">Privacidade</a>';
  const links = selecionarLinks(documento, 'https://empresa.com.br/', 'empresa.com.br', 'descoberta');
  assert.deepEqual(links.slice(0, 3), ['https://empresa.com.br/produtos/um','https://empresa.com.br/servicos/revisao','https://empresa.com.br/artistas/ana']);
  assert.equal(links.length, 5);
  assert.deepEqual(selecionarLinks('<meta name="robots" content="index, nofollow">' + documento,
    'https://empresa.com.br/', 'empresa.com.br', 'descoberta'), []);
});

test('XML restritivo lê urlset e índice, rejeita DTD, entidades e estrutura inválida', () => {
  assert.deepEqual(lerSitemap(mapa(['/servicos/revisao','/produtos/um']), 'https://empresa.com.br/sitemap.xml', 'empresa.com.br'), {
    tipo: 'urlset', urls: ['https://empresa.com.br/servicos/revisao','https://empresa.com.br/produtos/um'], limitada: false,
  });
  assert.equal(lerSitemap('<sitemapindex><sitemap><loc>https://empresa.com.br/catalogo.xml</loc></sitemap></sitemapindex>', 'https://empresa.com.br/', 'empresa.com.br').tipo, 'sitemapindex');
  for (const documento of [
    '<!DOCTYPE urlset [<!ENTITY externo SYSTEM "file:///etc/passwd">]><urlset><url><loc>&externo;</loc></url></urlset>',
    '<urlset><url><loc>&desconhecida;</loc></url></urlset>', '<urlset><url></urlset>',
    '<html><loc>https://empresa.com.br/servicos</loc></html>', '<urlset/><urlset/>',
    '<urlset><url><loc><![CDATA[https://empresa.com.br/servicos]]></loc></url></urlset>',
    '<urlset>' + ' '.repeat(512 * 1024) + '</urlset>',
  ]) assert.throws(() => lerSitemap(documento, 'https://empresa.com.br/', 'empresa.com.br'));
  const seguro = lerSitemap('<urlset><url><loc>https://externo.com/servicos</loc></url><url><loc>http://empresa.com.br/servicos</loc></url>' +
    '<url><loc>https://empresa.com.br/login</loc></url><url><loc>https://empresa.com.br/produtos?token=privado</loc></url></urlset>', 'https://empresa.com.br/', 'empresa.com.br');
  assert.deepEqual(seguro.urls, []);
});

test('descoberta usa sitemap de robots e um índice filho, com máximo de dois XML', async () => {
  const env = ambiente({robots: () => txt('User-agent: *\nAllow: /\nSitemap: https://empresa.com.br/indice.xml\nSitemap: https://externo.com/mapa.xml'), paginas: {
    'https://empresa.com.br/': () => html('<title>Empresa</title>'),
    'https://empresa.com.br/indice.xml': () => xml('<sitemapindex><sitemap><loc>https://empresa.com.br/catalogo.xml</loc></sitemap><sitemap><loc>https://empresa.com.br/outro.xml</loc></sitemap></sitemapindex>'),
    'https://empresa.com.br/catalogo.xml': () => xml(mapa(['/produtos/um','/produtos/dois'])),
  }});
  const r = await coletarSite('empresa.com.br', {...env, objetivo: 'descoberta'});
  assert.deepEqual(r.paginas.map(p => new URL(p.url).pathname), ['/','/produtos/um','/produtos/dois']);
  assert.equal(r.cobertura.sitemapsLidos, 2);
  assert.equal(r.cobertura.limitada, true);
  assert.ok(!env.pedidos.some(p => /outro\.xml|sitemap\.xml|externo\.com/.test(p.url)));
  assert.ok(env.pedidos.length <= 40);
});

test('descoberta segue links em largura além da raiz, sem ultrapassar páginas nem requisições', async () => {
  const paginas = {'https://empresa.com.br/sitemap.xml': () => xml(mapa([]))};
  paginas['https://empresa.com.br/'] = () => html('<a href="/produtos/um">Produto um</a><a href="/servicos/um">Serviço um</a>');
  paginas['https://empresa.com.br/produtos/um'] = () => html('<a href="/produtos/dois">Produto dois</a><a href="/produtos/tres">Produto três</a>');
  paginas['https://empresa.com.br/servicos/um'] = () => html(Array.from({length: 25}, (_, i) => '<a href="/servicos/item-' + i + '">Serviço item ' + i + '</a>').join(''));
  const env = ambiente({paginas});
  const r = await coletarSite('empresa.com.br', {...env, objetivo: 'descoberta'});
  assert.deepEqual(r.paginas.slice(0, 5).map(p => new URL(p.url).pathname), ['/','/produtos/um','/servicos/um','/produtos/dois','/produtos/tres']);
  assert.ok(r.paginas.length > 5 && r.paginas.length <= 12);
  assert.equal(r.cobertura.limitePaginas, 12);
  assert.equal(r.cobertura.limitada, true);
  assert.equal(new Set(r.paginas.map(p => p.url)).size, r.paginas.length);
  assert.ok(env.pedidos.length <= 40);
  assert.ok(r.cobertura.bytesLidos <= 4 * 1024 * 1024);
});

test('robots é verificado também para sitemap e para cada endereço nele declarado', async () => {
  const env = ambiente({robots: () => txt('User-agent: *\nDisallow: /produtos/segredo\nDisallow: /privado.xml\nSitemap: https://empresa.com.br/privado.xml'), paginas: {
    'https://empresa.com.br/': () => html('<h1>Empresa</h1>'),
    'https://empresa.com.br/sitemap.xml': () => xml(mapa(['/produtos/segredo','/produtos/publico'])),
  }});
  const r = await coletarSite('empresa.com.br', {...env, objetivo: 'descoberta'});
  assert.deepEqual(r.paginas.map(p => new URL(p.url).pathname), ['/','/produtos/publico']);
  assert.ok(!env.pedidos.some(p => /\/privado\.xml$|\/produtos\/segredo$/.test(p.url)));
  assert.ok(r.falhas.some(f => f.url.endsWith('/privado.xml') && /robots/.test(f.motivo)));
  assert.ok(r.falhas.some(f => f.url.endsWith('/produtos/segredo') && /robots/.test(f.motivo)));
});

test('sitemap externo, gzip, gigante ou DTD não causa acessos fora do escopo', async () => {
  for (const responder of [
    () => redireciona('https://externo.com/sitemap.xml'),
    () => redireciona('/mapa.xml.gz'),
    () => new Response('zip', {headers: {'content-type': 'application/gzip'}}),
    () => xml('<urlset>' + ' '.repeat(512 * 1024) + '</urlset>'),
    () => xml('<!DOCTYPE urlset SYSTEM "https://externo.com/entidades"><urlset/>'),
  ]) {
    const env = ambiente({paginas: {'https://empresa.com.br/sitemap.xml': responder}});
    const r = await coletarSite('empresa.com.br', {...env, objetivo: 'descoberta'});
    assert.equal(r.paginas.length, 1);
    assert.ok(r.falhas.some(f => f.url.endsWith('/sitemap.xml')));
    assert.ok(env.pedidos.every(p => ehDNS(p.url) || new URL(p.url).hostname === 'empresa.com.br'));
    assert.ok(!env.pedidos.some(p => /\.gz$/.test(p.url)));
  }
});

test('descoberta descarta resposta que excede os quatro MiB agregados', async () => {
  const grande = '<title>Produto grande</title>' + 'x'.repeat(900_000);
  const paginas = {'https://empresa.com.br/': () => html(grande + Array.from({length: 10}, (_, i) => '<a href="/produtos/item-' + i + '">Produto ' + i + '</a>').join('')),
    'https://empresa.com.br/sitemap.xml': () => xml(mapa([]))};
  for (let i = 0; i < 10; i++) paginas['https://empresa.com.br/produtos/item-' + i] = () => html(grande);
  const env = ambiente({paginas});
  const r = await coletarSite('empresa.com.br', {...env, objetivo: 'descoberta'});
  assert.ok(r.paginas.length < 10);
  assert.ok(r.paginas.reduce((n, p) => n + p.bytes, 0) <= 4 * 1024 * 1024);
  assert.ok(r.cobertura.bytesLidos <= 4 * 1024 * 1024);
  assert.equal(r.cobertura.limitada, true);
  assert.ok(r.falhas.some(f => /limite/.test(f.motivo)));
});

test('X-Robots-Tag nofollow impede BFS mas não muda o modo diagnóstico legado', async () => {
  const env = ambiente({paginas: {
    'https://empresa.com.br/': () => new Response('<title>Empresa</title><a href="/produtos/restrito">Produto restrito</a>', {headers: {'content-type': 'text/html', 'x-robots-tag': 'nofollow'}}),
    'https://empresa.com.br/sitemap.xml': () => xml(mapa([])),
  }});
  const r = await coletarSite('empresa.com.br', {...env, objetivo: 'descoberta'});
  assert.equal(r.paginas.length, 1);
  assert.equal(r.paginas[0].segueLinks, false);
  assert.ok(!env.pedidos.some(p => p.url.endsWith('/produtos/restrito')));
});

test('captura noindex HTTP com hash próprio e não confunde preview none com nofollow', async () => {
  const env=ambiente({paginas:{
    'https://empresa.com.br/':()=>new Response('<title>Empresa</title><a href="/produtos/um">Produto</a>',
      {headers:{'content-type':'text/html','x-robots-tag':'googlebot: noindex, max-image-preview: none'}}),
    'https://empresa.com.br/sitemap.xml':()=>xml(mapa([])),
  }});
  const r=await coletarSite('empresa.com.br',{...env,objetivo:'descoberta'}),p=r.paginas[0];
  assert.equal(p.cabecalhoRobots.estado,'noindex');assert.equal(p.cabecalhoRobots.escopo,'googlebot');
  assert.equal(p.cabecalhoRobots.sha256,createHash('sha256').update('googlebot: noindex, max-image-preview: none').digest('hex'));
  assert.equal(p.segueLinks,true);assert.ok(env.pedidos.some(x=>x.url.endsWith('/produtos/um')));
});

test('descoberta preserva páginas de operação e termos comerciais dentro dos primeiros links do site',()=>{
  const catalogo=Array.from({length:10},(_,i)=>'<a href="/servico-'+i+'/opcao">Serviço '+i+'</a>').join('');
  const outros='<a href="/privacidade">Privacidade</a><a href="/termos-de-contratacao" rel="nofollow">Não seguir</a>'+
    '<a href="/como-funciona">Como funciona</a><a href="/static/termos-e-condicoes/#TERMOS">Termos de uso</a>'+
    '<a href="/login/termos-de-uso#compra">Área restrita</a><a href="https://fora.com/termos-de-uso#compra">Externo</a>';
  const links=selecionarLinks(catalogo+outros,'https://empresa.com.br/','empresa.com.br','descoberta')
    .map(u=>new URL(u).pathname);
  assert.deepEqual(links.slice(0,5),[
    '/servico-0/opcao','/servico-1/opcao','/como-funciona','/servico-2/opcao','/static/termos-e-condicoes/'
  ]);
  assert.ok(!links.some(x=>/privacidade|login|contratacao/.test(x)));
  assert.equal(links.length,12);
  assert.deepEqual(selecionarLinks('<a href="/termos-de-uso#compra">Termos</a>',
    'https://empresa.com.br/','empresa.com.br','diagnostico'),[]);
});

test('sitemap com declaração de estilo usa documentos e nunca consulta o recurso de apresentação',async()=>{
  const env=ambiente({robots:()=>txt('User-agent: *\nAllow: /\nSitemap: https://empresa.com.br/indice.xml'),paginas:{
    'https://empresa.com.br/':()=>html('<title>Empresa</title>'),
    'https://empresa.com.br/indice.xml':()=>xml('<?xml version="1.0" encoding="UTF-8"?>'+
      '<?xml-stylesheet type="text/xsl" href="https://empresa.com.br/mapa.xsl"?>'+
      '<sitemapindex><sitemap><loc>https://empresa.com.br/post-sitemap.xml</loc></sitemap>'+
      '<sitemap><loc>https://empresa.com.br/page-sitemap.xml</loc></sitemap></sitemapindex>'),
    'https://empresa.com.br/page-sitemap.xml':()=>xml(mapa(['/servicos/consultoria'])),
  }});
  const r=await coletarSite('empresa.com.br',{...env,objetivo:'descoberta'});
  assert.equal(r.cobertura.sitemapsLidos,2);
  assert.ok(r.paginas.some(x=>x.url.endsWith('/servicos/consultoria')));
  assert.ok(!env.pedidos.some(x=>/mapa\.xsl|post-sitemap\.xml/u.test(x.url)));
  assert.throws(()=>lerSitemap('<urlset><url><loc><?xml-stylesheet href="x"?>https://empresa.com.br/servicos</loc></url></urlset>',
    'https://empresa.com.br/','empresa.com.br'));
});
