import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extrairFontesNegocio} from '../ia/negocio/fontes-v4.mjs';
import {prepararJornadas} from '../ia/negocio/jornadas/preparar.mjs';

const hash=v=>createHash('sha256').update(v).digest('hex');
function coleta(body,{dominio='exemplo.com.br',caminho='/',titulo='Serviços para empresas'}={}){
  const html=`<html><head><title>${titulo}</title></head><body><main>${body}</main></body></html>`;
  return {dominio,coletadoEm:'2026-11-16T13:00:00Z',paginas:[{url:`https://${dominio}${caminho}`,status:200,html,sha256:hash(html)}]};
}
const negocio='<h1>Gestão de projetos</h1><section><h2>Plano Empresa</h2><p>Disponibilizamos software de projetos para empresas contratantes.</p><p>Usuário é quem cria projetos. Participante recebe convites sem criar conta.</p><p>O Plano Empresa inclui até 30 usuários. Mais usuários exigem avaliação da equipe.</p></section>';

test('fonte tardia não some pelo antigo limite ordenado de240segmentos',()=>{
  const filler=Array.from({length:300},(_,i)=>`<p>Mensagem institucional de arquivo número ${i} sem descrição comercial.</p>`).join('');
  const r=prepararJornadas(coleta(filler+negocio));
  assert.ok(r.pool.fontes.length>240);
  assert.ok(r.base.fontes.some(f=>f.texto.includes('Mais usuários exigem avaliação')));
});

test('metadados exatos e IDs locais preservam página, hierarquia e origem',()=>{
  const r=prepararJornadas(coleta(negocio));
  const keys=['paginaId','url','tituloPagina','titulos','campo','coletadoEm','sha256','recortado','classePagina'].sort();
  assert.ok(r.base.fontes.length>0);
  for(const f of r.base.fontes){
    assert.deepEqual(Object.keys(f.contexto).sort(),keys);
    assert.match(f.id,/^s\d{2}$/u);
    const original=r.pool.fontes.find(p=>p.id===r.mapaIds[f.id]);
    assert.ok(original);assert.equal(f.texto,original.texto);assert.deepEqual(f.contexto,original.contexto);
  }
});

test('orçamento inclui todo o JSON contextual, sem fatiar condição',()=>{
  const r=prepararJornadas(coleta(negocio),{maxCaracteres:900});
  assert.equal(r.recuperacao.caracteresComContexto,JSON.stringify(r.base).length);
  assert.ok(JSON.stringify(r.base).length<=900);
  assert.ok(r.base.fontes.every(f=>!f.contexto.recortado));
  assert.ok(r.recuperacao.descartes.some(d=>d.motivo==='orcamento_contexto_integral'));
});

test('condição longa cortada não vira fonte selecionada sem a exceção final',()=>{
  const longo='O plano inclui serviços para empresas. '+('Detalhes publicados para leitura. '.repeat(25))+' Exceto para empresas com mais de30usuários.';
  const r=prepararJornadas(coleta(`<section><h2>Plano Empresa</h2><p>${longo}</p></section>`));
  assert.ok(r.pool.fontes.some(f=>f.recortado));
  assert.ok(!r.base.fontes.some(f=>f.texto.startsWith('O plano inclui serviços')));
  assert.ok(r.recuperacao.descartes.some(d=>d.motivo==='segmento_recortado_nao_selecionado'));
});

test('navegação semântica e depoimentos não entram como fatos',()=>{
  const html='<div role="navigation"><h2>Serviços especiais</h2><p>Oferecemos ouro ilimitado para todos os clientes.</p></div><div class="testimonial"><p>O cliente diz que obteve100milvendas com retorno garantido.</p></div>'+negocio;
  const r=prepararJornadas(coleta(html));
  assert.ok(!r.base.fontes.some(f=>/ouro ilimitado|retorno garantido/u.test(f.texto)));
  assert.ok(r.base.fontes.some(f=>f.texto.includes('software de projetos')));
});

test('mesmo rótulo em seção irmã não transfere a condição',()=>{
  const r=prepararJornadas(coleta('<h1>Planos</h1><section><h2>Plano A</h2><p>O Plano A inclui até cinco usuários para empresas.</p></section><section><h2>Plano B</h2><p>O Plano B inclui até trinta usuários para empresas.</p></section>'));
  const a=r.pool.fontes.find(f=>f.campo==='p'&&f.texto.startsWith('O Plano A'));
  const b=r.pool.fontes.find(f=>f.campo==='p'&&f.texto.startsWith('O Plano B'));
  assert.deepEqual(a.contexto.titulos.map(h=>h.texto),['Planos','Plano A']);
  assert.deepEqual(b.contexto.titulos.map(h=>h.texto),['Planos','Plano B']);
});

test('o programa não recompõe os lados de formulário ou expõe valores',()=>{
  const r=prepararJornadas(coleta('<section><h2>Consulta</h2><p>Oferecemos consulta para empresas.</p><form><input value="SEGREDO_DE_CONTROLE"></form><p>Não inclui consulta presencial para terceiros.</p></section>'));
  assert.ok(!JSON.stringify(r).includes('SEGREDO_DE_CONTROLE'));
  assert.ok(!r.base.fontes.some(f=>f.texto.includes('Oferecemos consulta')&&f.texto.includes('Não inclui')));
});

test('simulador e feedback não produzem exclusão real do negócio',()=>{
  const r=prepararJornadas(coleta('<section><h2>Resultado da Simulação</h2><p>Não atendemos a cidade selecionada.</p></section><div class="w-form-done">Seu pedido foi aprovado com sucesso.</div>'+negocio));
  assert.ok(!r.base.fontes.some(f=>/cidade selecionada|pedido foi aprovado/u.test(f.texto)));
});

test('hash adulterado ou ausência de data não viram evidência para inferência',()=>{
  const adulterada=coleta(negocio);adulterada.paginas[0].html+='alterado';
  assert.equal(prepararJornadas(adulterada).base.fontes.length,0);
  const semData=coleta(negocio);delete semData.coletadoEm;
  assert.equal(prepararJornadas(semData).base.fontes.length,0);
});

test('seleção é determinística, limitada e independente de marca por regras',()=>{
  const r=prepararJornadas(coleta(negocio),{maxFontes:3});
  assert.deepEqual(r,prepararJornadas(coleta(negocio),{maxFontes:3}));
  const outro=prepararJornadas(coleta(negocio,{dominio:'outraempresa.com.br'}),{maxFontes:3});
  assert.deepEqual(r.base.fontes.map(f=>f.texto),outro.base.fontes.map(f=>f.texto));
  assert.ok(r.base.fontes.length<=3);
});

test('versão anterior permanece independente e fonte v4 explicita limites',async()=>{
  const {extrairFontesNegocio:anterior}=await import('../ia/negocio/fontes-v3.mjs');
  const c=coleta(negocio);
  assert.equal(anterior(c).versao,3);assert.equal(extrairFontesNegocio(c).versao,4);
  assert.equal(extrairFontesNegocio(c).cobertura.maxFontesPorPagina,2048);
  assert.throws(()=>prepararJornadas(c,{maxFontes:17}));
  assert.throws(()=>prepararJornadas(c,{maxCaracteres:250}));
});

test('pergunta FAQ isolada não é resposta e controle visual não é dado de cliente',()=>{
  const r=prepararJornadas(coleta('<section><h2>Perguntas frequentes</h2><p>Qual a diferença entre cliente e prestador?</p><p>Cliente contrata o trabalho. Prestador é quem executa o serviço para o cliente.</p></section><section><h2>Exemplo de processo</h2><p>Contrate a consultoria.</p><div class="example-input">PESSOA_DEMONSTRACAO</div><p>Pedido123aprovado com sucesso.</p></section>'));
  assert.ok(!r.base.fontes.some(f=>f.texto==='Qual a diferença entre cliente e prestador?'));
  assert.ok(r.base.fontes.some(f=>f.texto.includes('Prestador é quem executa')));
  assert.ok(!JSON.stringify(r.pool.fontes).includes('PESSOA_DEMONSTRACAO'));
});

test('reserva640é limitada após pontuar e preserva fonte tardia relevante',()=>{
  const filler=Array.from({length:700},(_,i)=>`<p>Mensagem institucional de arquivo número ${i} sem descrição comercial.</p>`).join('');
  const r=prepararJornadas(coleta(filler+negocio));
  assert.ok(r.pool.cobertura.fontesAntesReserva>640);assert.equal(r.pool.fontes.length,640);
  assert.equal(r.pool.cobertura.reservaLimitada,true);
  assert.ok(r.pool.fontes.some(f=>f.texto.includes('Mais usuários exigem avaliação')));
  assert.ok(r.recuperacao.descartes.some(d=>d.motivo==='limite_reserva_apos_pontuacao'));
});
