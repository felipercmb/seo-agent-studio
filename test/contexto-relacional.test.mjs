import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extrairFontesNegocio} from '../ia/negocio/fontes-v3.mjs';
import {prepararRelacoes,semContexto} from '../ia/negocio/relacoes/preparar.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
function coleta(body){const html='<html><head><title>Serviços publicados</title></head><body><main>'+body+'</main></body></html>';return {dominio:'exemplo.com.br',coletadoEm:'2026-11-16T12:30:00Z',paginas:[{url:'https://exemplo.com.br/',status:200,html,sha256:hash(html)}]};}

test('página e hierarquia atravessam a preparação, com origem conferível',()=>{
  const c=coleta('<h1>Serviços</h1><section><h2>Instalação</h2><h3>Empresas</h3><p>Oferecemos instalação de equipamentos para empresas.</p></section>');
  const r=prepararRelacoes(c);const f=r.pool.fontes.find(f=>f.texto==='Oferecemos instalação de equipamentos para empresas.');
  assert.ok(f);assert.deepEqual(f.contexto.titulos.map(x=>x.texto),['Serviços','Instalação','Empresas']);
  assert.equal(f.contexto.tituloPagina,'Serviços publicados');assert.equal(f.contexto.sha256,c.paginas[0].sha256);
  // Retrieval may retain a larger, continuous DOM block instead of its child.
  const escolhida=r.entrada.fontes.find(x=>x.texto.includes(f.texto));assert.ok(escolhida);
  assert.deepEqual(r.pool.fontes.find(x=>x.id===r.mapaIds[escolhida.id]).contexto,escolhida.contexto);
});

test('restrição de seção irmã não recebe o título anterior',()=>{
  const r=extrairFontesNegocio(coleta('<h1>Serviços</h1><section><h2>Plano Inicial</h2><p>Inclui até cinco usuários por empresa.</p></section><section><p>O formulário não coleta dados de menores de 13 anos.</p></section>'));
  const f=r.fontes.find(f=>f.texto==='O formulário não coleta dados de menores de 13 anos.');
  assert.deepEqual(f.contexto.titulos.map(x=>x.texto),['Serviços']);assert.ok(!f.secao.includes('Plano Inicial'));
});

test('mesma condição em ofertas diferentes mantém os dois escopos',()=>{
  const r=extrairFontesNegocio(coleta('<section><h2>Plano A</h2><p>Exige agendamento prévio com a equipe.</p></section><section><h2>Plano B</h2><p>Exige agendamento prévio com a equipe.</p></section>'));
  const fs=r.fontes.filter(f=>f.campo==='p'&&f.texto==='Exige agendamento prévio com a equipe.');
  assert.equal(fs.length,2);assert.notEqual(fs[0].id,fs[1].id);assert.deepEqual(fs.map(f=>f.contexto.titulos[0].texto),['Plano A','Plano B']);
});

test('botões de página não herdam a última oferta visitada',()=>{
  const r=extrairFontesNegocio(coleta('<section><h2>Oferta Premium</h2><p>Serviço presencial para empresas mediante orçamento.</p></section><form><button>Solicitar orçamento</button></form>'));
  assert.ok(r.fontes.filter(f=>f.tipo==='interface').every(f=>f.contexto.titulos.length===0));
});

test('ablação remove só contexto, mantendo IDs e textos escolhidos',()=>{
  const r=prepararRelacoes(coleta('<p>Somos uma empresa. Prestamos manutenção por contratação para empresas.</p>'));
  const a=semContexto(r.entrada);assert.ok(a.fontes.length);assert.deepEqual(a.fontes,r.entrada.fontes.map(({id,texto,tipo})=>({id,texto,tipo})));
  assert.ok(r.entrada.fontes.every(f=>f.contexto));
});

test('orçamento considera metadados completos sem cortar trechos',()=>{
  const r=prepararRelacoes(coleta('<h1>Consultoria</h1><p>Prestamos consultoria para pequenas empresas mediante contratação.</p>'),{maxCaracteres:256});
  assert.ok(r.recuperacao.caracteresComContexto<=256);assert.equal(r.entrada.fontes.length,0);assert.ok(r.recuperacao.descartes.some(d=>d.motivo==='orcamento_contexto_integral'));
});

test('simulação no HTML não é prova de exclusão de um cliente real',()=>{
  const r=extrairFontesNegocio(coleta('<section><h2>Resultado da Simulação</h2><p>Não atendemos a cidade selecionada</p></section><section><h2>Atendimento</h2><p>Oferecemos contabilidade para microempresas.</p></section>'));
  const f=r.fontes.find(f=>f.texto==='Não atendemos a cidade selecionada');
  assert.equal(f.tipo,'interface');assert.equal(f.projecao.estado,'template_nao_executado');
  assert.ok(r.fontes.some(f=>f.tipo!=='interface'&&f.texto==='Oferecemos contabilidade para microempresas.'));
});

test('não recompõe texto ao redor de formulário omitido',()=>{
  const r=extrairFontesNegocio(coleta('<section><h2>Oferta</h2><p>Instalação técnica para empresas.</p><form><input value="VALOR_DE_CONTROLE"></form><p>Não inclui manutenção de terceiros.</p></section>'));
  assert.ok(!JSON.stringify(r).includes('VALOR_DE_CONTROLE'));
  assert.ok(!r.fontes.some(f=>f.texto.includes('Instalação técnica')&&f.texto.includes('Não inclui')));
});

test('captura adulterada não vira fonte contextual',()=>{
  const c=coleta('<p>Prestamos serviços mediante contratação.</p>');c.paginas[0].html+='alterado';
  assert.equal(prepararRelacoes(c).entrada.fontes.length,0);
});

test('novo exportador mantém versão anterior independente',async()=>{
  const {extrairFontesNegocio:anterior}=await import('../ia/negocio/fontes-v2.mjs');
  const c=coleta('<p>Prestamos serviços para empresas por contratação.</p>');
  assert.equal(anterior(c).versao,2);assert.equal(extrairFontesNegocio(c).versao,3);
  assert.ok(anterior(c).fontes.every(f=>!Object.hasOwn(f,'contexto')));
});

test('categorias de controle de escolha não se transformam em ofertas',()=>{
  const r=extrairFontesNegocio(coleta('<h1>Publique uma solicitação</h1><ul><li class="select-with-search-id-42"><span>Análise de requisitos</span><span>[x]</span></li></ul><p>Conectamos empresas a profissionais independentes.</p>'));
  assert.ok(!r.fontes.some(f=>f.tipo!=='interface'&&f.texto.includes('Análise de requisitos')));
  assert.ok(r.fontes.some(f=>f.texto==='Conectamos empresas a profissionais independentes.'));
});
