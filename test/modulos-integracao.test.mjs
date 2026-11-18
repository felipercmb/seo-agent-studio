import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {abrirBanco} from '../lib/sqlite.mjs';
import {criarCoordenador} from '../src/modulos/coordenador.mjs';
import {criarWorker} from '../src/worker.mjs';
import {consultarGoogle} from '../src/serpapi.mjs';
import {registrarHistorico} from '../src/modulos/acompanhamento.mjs';

const SITE = 'cliente.com.br', TERMO = 'Contratação de artista gospel';
const INSTANTE = Date.parse('2026-11-15T15:00:00Z');
const SEGREDO = 'chave_ficticia_apenas_para_testes_1234567890123456789012345678901234';
const hash = v => createHash('sha256').update(v).digest('hex');

function ambiente(t, {fonte = false, antiga = false, executarIA, executarIACandidata, consultarDemanda} = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'visibilidade-modulos-'));
  const arquivo = join(pasta, 'local.sqlite');
  let db = abrirBanco({arquivo}), instante = INSTANTE, coletas = 0, buscas = [];
  let oferta = TERMO;
  t.after(() => { db.close(); rmSync(pasta, {recursive:true, force:true}); });
  const agora = () => instante;
  const coletar = async dominio => {
    coletas++;
    const data = new Date(antiga ? INSTANTE - 2 * 86400_000 : agora()).toISOString();
    const html = `<html lang="pt-BR"><head><title>Empresa exemplo</title></head><body><h1>${oferta}</h1><h2>Show</h2></body></html>`;
    return {dominio, coletadoEm:data, falhas:[], paginas:[{url:'https://' + dominio + '/', html,
      status:200, coletadoEm:data, sha256:hash(html)}]};
  };
  const fetch = async endereco => {
    const url = new URL(endereco);
    assert.equal(url.origin, 'https://serpapi.com');
    if (url.pathname === '/account.json') return Response.json({account_status:'Active', plan_id:'free',
      plan_name:'Free Plan',plan_monthly_price:0,plan_renewal_date:'2026-12-15',searches_per_month:250,
      plan_searches_left:250,extra_credits:0,total_searches_left:250,this_month_usage:0,
      this_hour_searches:0,account_rate_limit_per_hour:50});
    assert.equal(url.pathname, '/search.json');
    const termo = url.searchParams.get('q');
    buscas.push(termo);
    const data = new Date(agora() - 1000).toISOString();
    return Response.json({search_metadata:{id:'fixture_modular_' + buscas.length,status:'Success',created_at:data,processed_at:data},
      search_parameters:{engine:'google',q:termo,gl:'br',hl:'pt',google_domain:'google.com.br',device:'desktop',location_requested:'Brazil',location_used:'Brazil',start:0},
      search_information:{page_number:1,query_displayed:termo,organic_results_state:'Results for exact spelling'},
      organic_results:Array.from({length:10}, (_, i) => ({position:i+1,title:'Resultado ' + (i+1),
        link:'https://' + (i === 5 ? SITE : `rival${i}.com.br`) + '/contrate'})),
      related_searches:[{query:'Contratação de artista gospel excluido'}]});
  };
  const opcoes = {agora, coletar, executarIA, executarIACandidata, consultarDemanda, consultarGoogle:(entrada, op) => consultarGoogle(entrada, {...op, fetch})};
  const env = {DB:db, MODULOS_LOCAIS:true, SERPAPI_KEY:fonte ? SEGREDO : ''};
  let coordenador = criarCoordenador(opcoes);
  return {env, opcoes, agora, buscas, coletas:() => coletas,
    executar:(acao, extra = {}) => coordenador.executar({site:SITE,acao,...extra}, env),
    avancar:ms => { instante += ms; }, mudarOferta:nome => { oferta = nome; },
    reabrir() { db.close(); db = abrirBanco({arquivo}); env.DB = db; coordenador = criarCoordenador(opcoes); },
  };
}
const confirmar = (a, p, extras = {}) => a.executar('salvar_perfil', {revisao:p.revisao,
  perfil:{confirmado:true, ...extras}});

test('capacidades informam configuração sem revelar segredos ou fingir disponibilidade', async t => {
  const a = ambiente(t), p = await a.executar('iniciar');
  assert.deepEqual(p.capacidades,{posicoes:{configurada:false},demanda:{configurada:false},ia:{instalada:false,estado:'experimental'},
    entendimento:{instalado:false,estado:'experimental_local'},tarefas:{disponivel:true},premissas:{disponivel:true}});
  await assert.rejects(a.executar('experimentar_ia'), e => e.status === 503);
  assert.equal((await a.executar('consultar')).revisao, p.revisao);
});

test('mapa por oferta acompanha revisão do perfil sem consumir fonte e mantém intenção como hipótese',async t=>{
  const a=ambiente(t);let p=await a.executar('iniciar');const rascunho=p.mapaInvestigacao;
  assert.equal(rascunho.estado,'revisao_necessaria');
  p=await confirmar(a,p,{ofertas:[{id:p.perfil.ofertas[0].id,nome:TERMO,url:'https://'+SITE+'/contrate',
    jornada:{comprador:'Organizador do evento',executor:'Artista contratado',beneficiario:'Público presente',objetivo:'Encontrar uma apresentação adequada ao evento'}}]});
  const m=p.mapaInvestigacao,coletas=a.coletas();assert.equal(m.estado,'disponivel');assert.equal(m.porOferta[0].objetivo,'Encontrar uma apresentação adequada ao evento');
  assert.ok(m.porOferta[0].primeirasBuscas.length);assert.ok(m.porOferta[0].primeirasBuscas.every(b=>b.naturezaIntencao==='hipotese_por_regras'));
  assert.equal(m.cobertura.comObservacaoAtual,0);assert.equal(a.buscas.length,0);
  const salvo=await a.executar('consultar');assert.deepEqual(salvo.mapaInvestigacao,m);assert.equal(a.coletas(),coletas);assert.equal(salvo.revisao,p.revisao);
});

test('exportação do plano é local, usa a revisão salva e não consome consultas nem altera histórico', async t => {
  const a=ambiente(t);let p=await a.executar('iniciar');
  p=await confirmar(a,p,{ofertas:[{id:p.perfil.ofertas[0].id,nome:TERMO,
    economia:{contribuicaoPorVenda:9321.87,taxaFechamento:.37123}}]});
  const lido=a.coletas(),consultas=a.buscas.length;
  const plano=await a.executar('exportar_plano',{revisao:p.revisao});
  assert.equal(plano.formato,'markdown');assert.equal(plano.revisao,p.revisao);
  assert.match(plano.conteudo,/Tarefas recomendadas/);assert.doesNotMatch(plano.conteudo,/9321\.87|0\.37123/);
  assert.equal(a.coletas(),lido);assert.equal(a.buscas.length,consultas);
  const salvo=await a.executar('consultar');assert.equal(salvo.revisao,p.revisao);
  assert.deepEqual(salvo.historico,p.historico);
  await assert.rejects(a.executar('exportar_plano',{revisao:p.revisao-1}),e=>e.status===409);
});

test('sugestões da leitura salva preservam correções, valores, revisão e histórico sem uma nova coleta',async t=>{
  const a=ambiente(t);let p=await a.executar('iniciar');
  p=await confirmar(a,p,{resumo:'Descrição revisada pela empresa',ofertas:[{id:p.perfil.ofertas[0].id,nome:'Assessoria de contratação revisada',
    economia:{contribuicaoPorVenda:321.45,taxaFechamento:.17}}]});
  const original=structuredClone(p),coletas=a.coletas();a.avancar(5*60_000);
  const comparacao=await a.executar('revisar_leitura',{revisao:p.revisao});
  assert.equal(comparacao.revisao,original.revisao);assert.deepEqual(comparacao.perfil,original.perfil);
  assert.deepEqual(comparacao.historico,original.historico);assert.equal(a.coletas(),coletas);assert.equal(a.buscas.length,0);
  assert.equal(comparacao.propostaDaLeitura.coletadoEm,original.coletadoEm);
  assert.equal(comparacao.propostaDaLeitura.natureza,'hipotese_da_leitura_salva');
  assert.ok(comparacao.propostaDaLeitura.perfil.ofertas.some(o=>o.nome===TERMO));
  assert.doesNotMatch(JSON.stringify(comparacao.propostaDaLeitura),/321\.45|0\.17|Descrição revisada pela empresa/);
  const salvo=await a.executar('consultar');assert.deepEqual(salvo.perfil,original.perfil);assert.equal(salvo.propostaDaLeitura,undefined);
  await assert.rejects(a.executar('revisar_leitura',{revisao:p.revisao+1}),e=>e.status===409);
});

test('comparação optativa preserva o piloto anterior e invalida ambos quando a evidência vence', async t => {
  const chamadas=[];
  const resposta=nome=>async entrada=>{chamadas.push({nome,entrada});return{versao:1,estado:'experimental',
    resultados:entrada.entradas.map(()=>({estado:'recusada',origem:'ia',erros:[nome]}))};};
  const a=ambiente(t,{executarIA:resposta('anterior'),executarIACandidata:resposta('candidata')});
  let p=await a.executar('iniciar');
  await assert.rejects(a.executar('experimentar_ia_candidata'),e=>e.status===409);
  p=await confirmar(a,p);const anterior=await a.executar('experimentar_ia',{revisao:p.revisao});
  const nova=await a.executar('experimentar_ia_candidata',{revisao:anterior.revisao});
  assert.equal(nova.capacidades.ia.candidata,true);
  assert.deepEqual(nova.ia,anterior.ia);assert.equal(nova.iaCandidata.resultados[0].erros[0],'candidata');
  assert.deepEqual(chamadas.map(c=>c.nome),['anterior','candidata']);assert.deepEqual(chamadas[0].entrada,chamadas[1].entrada);
  assert.equal(a.coletas(),1);assert.equal(a.buscas.length,0);
  a.reabrir();assert.deepEqual((await a.executar('consultar')).iaCandidata,nova.iaCandidata);
  a.avancar(3600_001);const historica=await a.executar('consultar');
  assert.equal(historica.ia.estado,'historica');assert.equal(historica.iaCandidata.estado,'historica');
});

test('comparação candidata não herda o executor padrão quando não está instalada',async t=>{
  const a=ambiente(t,{executarIA:async()=>{throw new Error('Não deve usar o executor padrão.');}});
  const p=await a.executar('iniciar');await confirmar(a,p);
  await assert.rejects(a.executar('experimentar_ia_candidata'),e=>e.status===503);
});

test('correções do negócio ficam auditáveis no histórico sem duplicar os valores financeiros',async t=>{
  const a=ambiente(t);let p=await a.executar('iniciar');
  p=await confirmar(a,p,{resumo:'Intermediação revisada no ensaio local',ofertas:[{id:p.perfil.ofertas[0].id,nome:TERMO,
    economia:{contribuicaoPorVenda:9321.87,taxaFechamento:.37123}}]});
  const auditoria=p.historico.at(-1).revisaoPerfil;
  assert.equal(auditoria.origem,'declaracao_usuario');assert.equal(auditoria.economiaAlterada,true);
  assert.ok(auditoria.campos.some(c=>c.campo==='resumo' && c.depois==='Intermediação revisada no ensaio local'));
  assert.doesNotMatch(JSON.stringify(auditoria),/9321\.87|0\.37123/);
  a.reabrir();assert.deepEqual((await a.executar('consultar')).historico.at(-1).revisaoPerfil,auditoria);
});

test('perfil social confirmado sem vendas produz plano e evita invocar IA sem contexto publicado elegível',async t=>{
  let chamadasIA=0;const a=ambiente(t,{executarIA:async()=>{chamadasIA++;throw new Error('Não há contexto elegível.');}});
  const inicial=await a.executar('iniciar');
  const p=await a.executar('salvar_perfil',{revisao:inicial.revisao,perfil:{confirmado:true,finalidade:'social',ofertas:[],
    atuacoes:[{tipo:'programa_social',nome:'Educação comunitária',url:null}]}});
  assert.equal(p.perfil.estado,'confirmado');assert.equal(p.perfil.ofertas.length,0);
  assert.ok(p.oportunidades.planoDeAcao.some(t=>t.atuacoesRelacionadas?.some(a=>a.nome==='Educação comunitária')));
  assert.ok(p.oportunidades.itens.every(i=>i.observado.posicao===null && i.valorPorContato===null));
  const piloto=await a.executar('experimentar_ia',{revisao:p.revisao});
  assert.equal(chamadasIA,0);assert.equal(piloto.ia.estado,'sem_contexto');
  assert.equal(piloto.ia.resultados.length,0);assert.equal(a.coletas(),1);
});

test('API comporta revisão extensa de ofertas dentro de 64KiB e mantém contrato estrito',async t=>{
  const a=ambiente(t);const inicial=await a.executar('iniciar');
  const worker=criarWorker('portal',{...a.opcoes,htmlProjeto:'projeto'});
  const body=JSON.stringify({site:SITE,acao:'salvar_perfil',revisao:inicial.revisao,perfil:{confirmado:true,
    resumo:'a'.repeat(1600),publico:'Público declarado no teste',ofertas:Array.from({length:8},(_,i)=>({nome:'Oferta de serviço '+i,url:'https://'+SITE+'/servico-'+i+'x'.repeat(1800)}))}});
  assert.ok(Buffer.byteLength(body)>16384 && Buffer.byteLength(body)<65536);
  const resposta=await worker.fetch(new Request('http://localhost/api/projeto',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost'},body}),a.env);
  assert.equal(resposta.status,200);assert.equal((await resposta.json()).perfil.ofertas.length,8);
  const grande=await worker.fetch(new Request('http://localhost/api/projeto',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost'},body:'x'.repeat(65537)}),a.env);
  assert.equal(grande.status,400);
});

test('IA modular recebe somente evidências e preserva recusas e origem, sem divulgar premissas comerciais', async t => {
  let recebida;
  const a = ambiente(t, {executarIA:async entrada => {
    recebida = entrada;
    return {versao:1,estado:'experimental',resultados:entrada.entradas.map((_,i) => i === 0
      ? {estado:'recusada',origem:'ia',erros:['Referência inválida.'],escolha_ia:{acao:'melhorar_pagina',evidencias:['x']}}
      : {estado:'revisao_necessaria',origem:'regra',escolha_ia:{acao:'atualizar_coleta',evidencias:[]},orientacao_padrao:'Conferir fonte.'})};
  }});
  let p = await a.executar('iniciar');
  await assert.rejects(a.executar('experimentar_ia'), e => e.status === 409);
  const oferta = p.perfil.ofertas[0];
  p = await confirmar(a, p, {ofertas:[{nome:oferta.nome,id:oferta.id,
    economia:{contribuicaoPorVenda:9321.87,taxaFechamento:.37}}]});
  const resultado = await a.executar('experimentar_ia', {revisao:p.revisao});
  assert.equal(resultado.ia.estado, 'experimental');
  assert.equal(resultado.ia.resultados[0].estado, 'recusada');
  assert.equal(recebida.versao, 1);
  assert.ok(!JSON.stringify(recebida).includes('9321.87'));
  assert.ok(recebida.entradas.every(e => e.dados_negocio.margem === null));
  assert.ok(!JSON.stringify(recebida).includes('melhorar_pagina'));
  a.avancar(3600_001);
  assert.equal((await a.executar('consultar')).ia.estado, 'historica');
});

test('resposta IA fora do contrato falha sem apagar a análise anterior', async t => {
  const a = ambiente(t, {executarIA:async entrada => ({versao:1,estado:'experimental',
    resultados:entrada.entradas.map(() => ({estado:'revisao_necessaria',origem:'ia',
      escolha_ia:{acao:'aumentar_orcamento',evidencias:['inexistente']}}))})});
  let p = await a.executar('iniciar'); p = await confirmar(a,p);
  await assert.rejects(a.executar('experimentar_ia'));
  const salvo = await a.executar('consultar');
  assert.equal(salvo.revisao,p.revisao);
  assert.equal(salvo.ia,null);
});

test('ação conhecida sem evidência aplicável é preservada como recusa, sem fingir concorrentes', async t => {
  let entrada;
  const a = ambiente(t,{executarIA:async e => {entrada=e;return {versao:1,estado:'experimental',resultados:e.entradas.map(c => ({
    estado:'revisao_necessaria',origem:'ia',escolha_ia:{acao:'comparar_concorrentes',evidencias:[c.evidencias.find(v=>v.tipo==='serp')?.id || c.evidencias[0].id]}}))};}});
  const p=await a.executar('iniciar');await confirmar(a,p);
  const r=await a.executar('experimentar_ia');
  assert.equal(entrada.entradas[0].evidencias.find(e=>e.tipo==='serp').estado_fonte,'nao_configurada');
  assert.ok(r.ia.resultados.every(res=>res.estado==='recusada' && res.recusadaPelaIntegracao));
  assert.ok(r.ia.resultados.every(res=>res.motivos_aplicabilidade.some(m=>m.includes('concorrentes'))));
});

test('domínio inicia os módulos sem fonte; confirmação persiste localmente entre reinicializações', async t => {
  const a = ambiente(t), p = await a.executar('iniciar');
  assert.equal(p.perfil.estado, 'rascunho');
  assert.equal(p.modulos.length, 5);
  assert.ok(p.perfil.ofertas.some(o => o.nome === TERMO));
  assert.equal(p.demanda.estado, 'indisponivel');
  assert.equal(p.posicoes, null);
  assert.equal(p.historico.length, 1);
  assert.ok(p.oportunidades.itens.every(i => i.observado.posicao === null && i.valorPorContato === null));
  const salvo = await confirmar(a, p, {resumo:'Intermediação entre contratantes e artistas'});
  assert.equal(salvo.perfil.estado, 'confirmado');
  assert.ok(salvo.palavras.candidatos.some(c => c.origem === 'hipotese'));
  assert.equal(a.buscas.length, 0);
  a.reabrir();
  const relido = await a.executar('consultar');
  assert.equal(relido.revisao, salvo.revisao);
  assert.equal(relido.perfil.resumo, salvo.perfil.resumo);
  assert.equal(a.coletas(), 1);
  assert.ok(!JSON.stringify(relido).includes('<html'));
  assert.ok(!JSON.stringify(relido).includes(SEGREDO));
});

test('perfil revisado é obrigatório para medir e fonte ausente não vira posição zero', async t => {
  const a = ambiente(t), inicial = await a.executar('iniciar');
  await assert.rejects(a.executar('medir'), e => e.status === 409);
  const p = await confirmar(a, inicial);
  const medido = await a.executar('medir', {revisao:p.revisao});
  assert.equal(medido.posicoes.estado, 'fonte_nao_configurada');
  assert.ok(medido.oportunidades.itens.every(i => i.observado.posicao === null));
  assert.equal(a.buscas.length, 0);
});

test('cenário econômico usa contribuição da oferta, zero é diferente de desconhecido', async t => {
  const a = ambiente(t), p = await a.executar('iniciar');
  const oferta = p.perfil.ofertas[0];
  const r = await confirmar(a, p, {ofertas:[{id:oferta.id,nome:oferta.nome,economia:{contribuicaoPorVenda:800,taxaFechamento:0.1}}]});
  assert.equal(r.oportunidades.itens.find(i => i.termo === TERMO).valorPorContato.valor, 80);
  assert.equal(r.oportunidades.itens.find(i => i.termo === TERMO).valorPorContato.natureza, 'cenario_declarado');
  const z = await confirmar(a, r, {ofertas:[{id:oferta.id,nome:oferta.nome,economia:{contribuicaoPorVenda:0,taxaFechamento:0.1}}]});
  assert.equal(z.oportunidades.itens.find(i => i.termo === TERMO).valorPorContato.valor, 0);
});

test('edições concorrentes não sobrescrevem revisão ou declaração de outra janela', async t => {
  const a = ambiente(t), p = await a.executar('iniciar');
  const resultados = await Promise.allSettled([
    confirmar(a, p, {resumo:'Primeira correção'}), confirmar(a, p, {resumo:'Segunda correção'})]);
  assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(resultados.find(r => r.status === 'rejected').reason.status, 409);
  const novo = await a.executar('consultar');
  assert.equal(novo.revisao, 2);
  await assert.rejects(a.executar('excluir', {revisao:1}), e => e.status === 409);
});

test('site lido há dois dias não trava a medição e relacionadas não furam o plano', async t => {
  const a = ambiente(t, {fonte:true, antiga:true}), p = await a.executar('iniciar');
  const revisado = await confirmar(a, p, {exclusoes:['excluido']});
  await a.executar('medir');
  a.avancar(4000);
  const r = await a.executar('medir');
  assert.ok(a.buscas.length > 0);
  assert.ok(a.buscas.every(termo => revisado.palavras.candidatos.some(c => c.termo === termo)));
  assert.ok(r.posicoes.candidatos.every(c => !c.termo.includes('excluido')));
  assert.ok(r.oportunidades.itens.some(i => i.observado.posicao === 6));
  assert.ok(Date.parse(r.posicoes.descoberta.coletadoEm) < INSTANTE - 86400_000);
  assert.ok(!JSON.stringify(r).includes(SEGREDO));
  a.avancar(3600_001);
  const antiga = await a.executar('consultar');
  assert.equal(antiga.posicoes.estado, 'desatualizada');
  assert.ok(antiga.posicoes.consultas.every(q => q.posicao === null));
  assert.ok(antiga.oportunidades.itens.every(i => i.observado.posicao === null));
  assert.ok(antiga.historico.at(-1).observacoes.some(o => o.posicao === 6));
});

test('mudança do plano invalida fila anterior; releitura preserva declarações confirmadas', async t => {
  const a = ambiente(t, {fonte:true}), p = await a.executar('iniciar');
  await confirmar(a, p, {resumo:'Descrição revisada'});
  await a.executar('medir'); a.avancar(4000);
  const r = await a.executar('medir');
  assert.ok(r.posicoes);
  a.avancar(60_001); a.mudarOferta('Contratação de bandas para eventos');
  const atualizado = await a.executar('reler_site');
  assert.equal(atualizado.perfil.resumo, 'Descrição revisada');
  assert.equal(atualizado.posicoes, null);
  assert.ok(atualizado.palavras.candidatos.some(c => c.termo === 'Contratação de bandas para eventos'));
});

test('reabertura após mudança de regra regenera plano antes de usar cota',async t=>{
  const a=ambiente(t,{fonte:true}),p=await a.executar('iniciar');
  await confirmar(a,p);await a.executar('medir');a.avancar(4000);
  const medido=await a.executar('medir');
  const creditos=a.buscas.length;
  // Emula um relatório gravado por uma versão anterior das regras. O conteúdo
  // observado e o perfil ficam intactos; só o derivado/cache está obsoleto.
  const linha=await a.env.DB.prepare('SELECT payload FROM projetos_modulares WHERE dominio = ?').bind(SITE).first();
  const antigo=JSON.parse(linha.payload);
  antigo.palavras.candidatos=[{termo:'Busca obsoleta',origem:'hipotese',tipo:'servico',ofertaId:'antiga'}];
  antigo.posicoes.planoId='a'.repeat(64);
  await a.env.DB.prepare('UPDATE projetos_modulares SET payload = ? WHERE dominio = ?').bind(JSON.stringify(antigo),SITE).run();
  const aberto=await a.executar('consultar');
  assert.equal(aberto.revisao,medido.revisao);
  assert.ok(aberto.palavras.candidatos.every(c=>c.termo!=='Busca obsoleta'));
  assert.equal(aberto.posicoes,null);
  assert.equal(a.buscas.length,creditos);
  assert.equal(aberto.historico.length,medido.historico.length);
  assert.match(aberto.avisos.join(' '),/seleção de buscas mudou/);
});

test('releitura também preserva correções salvas como rascunho', async t => {
  const a = ambiente(t), p = await a.executar('iniciar');
  await a.executar('salvar_perfil', {revisao:p.revisao, perfil:{resumo:'Correção ainda em revisão', confirmado:false}});
  a.avancar(60_001); a.mudarOferta('Contratação de bandas para eventos');
  const relido = await a.executar('reler_site');
  assert.equal(relido.perfil.resumo, 'Correção ainda em revisão');
  assert.equal(relido.perfil.estado, 'rascunho');
  assert.ok(relido.palavras.candidatos.some(c => c.termo === 'Contratação de bandas para eventos'));
});

test('API rejeita posições e demanda do cliente, origem cruzada e uso em portal público', async t => {
  const a = ambiente(t), worker = criarWorker('portal', {...a.opcoes, htmlProjeto:'projeto'});
  const request = (body, headers = {}) => new Request('http://localhost/api/projeto', {method:'POST',
    headers:{'content-type':'application/json',origin:'http://localhost',...headers}, body:JSON.stringify(body)});
  assert.equal((await worker.fetch(request({site:SITE,acao:'iniciar',posicoes:{posicao:1}}), a.env)).status, 400);
  assert.equal((await worker.fetch(request({site:SITE,acao:'iniciar'}, {origin:'https://terceiro.com'}), a.env)).status, 403);
  assert.equal((await worker.fetch(request({site:SITE,acao:'iniciar'}), {DB:a.env.DB})).status, 404);
  assert.equal((await worker.fetch(new Request('http://localhost/projeto'), a.env)).status, 200);
  assert.equal((await worker.fetch(new Request('http://localhost/projeto'), {DB:a.env.DB})).status, 404);
  const p = await a.executar('iniciar');
  assert.equal((await worker.fetch(request({site:SITE,acao:'salvar_perfil',revisao:p.revisao,
    perfil:{confirmado:true,posicao:1}}), a.env)).status, 400);
});

test('exclusão apaga perfil e histórico, mas não renova a cota consumida', async t => {
  const a = ambiente(t, {fonte:true}), p = await a.executar('iniciar');
  await confirmar(a, p); await a.executar('medir'); a.avancar(4000);
  const r = await a.executar('medir');
  const contar = () => a.env.DB.prepare('SELECT COUNT(*) AS n FROM rank_creditos').first('n');
  const creditos = await contar();
  assert.ok(creditos > 0);
  assert.equal((await a.executar('excluir', {revisao:r.revisao})).estado, 'excluido');
  assert.equal(await contar(), creditos);
  await assert.rejects(a.executar('consultar'), e => e.status === 404);
});

test('histórico compara somente capturas novas no mesmo plano e contexto, sem causalidade', () => {
  const contexto = {pais:'Brasil',idioma:'Português',localidade:'Brasil',dispositivo:'Computador'};
  const base = {revisao:1,perfil:{estado:'confirmado'},palavras:{candidatos:[{termo:TERMO}]},
    posicoes:{planoId:'abc',estado:'verificado',consultas:[{termo:TERMO,coletadoEm:'2026-11-14T15:00:00Z'}]},
    oportunidades:{itens:[{termo:TERMO,observado:{estado:'encontrado',posicao:10,contexto}}]}};
  base.historico = registrarHistorico(base, 'medir', () => INSTANTE);
  base.posicoes.consultas[0].coletadoEm = '2026-11-15T15:00:00Z';
  base.oportunidades.itens[0].observado.posicao = 6;
  const proximo = registrarHistorico(base, 'medir', () => INSTANTE);
  assert.equal(proximo.at(-1).comparacoes[0].variacao, 4);
  assert.match(proximo.at(-1).comparacoes[0].limite, /não comprova/);
  base.historico.push({acao:'medir', planoId:'abc', observacoes:[]});
  assert.equal(registrarHistorico(base, 'medir', () => INSTANTE).at(-1).comparacoes[0].variacao, 4);
  base.oportunidades.itens[0].observado.contexto = {...contexto,localidade:'São Paulo'};
  assert.deepEqual(registrarHistorico(base, 'medir', () => INSTANTE).at(-1).comparacoes, []);
});
