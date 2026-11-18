import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {extrairFontesNegocio} from '../ia/negocio/fontes-v2.mjs';

const dominio='exemplo.com.br',coletadoEm='2026-11-16T03:00:00Z';
function coleta(html){return{dominio,coletadoEm,paginas:[{url:'https://exemplo.com.br/',html,status:200,sha256:createHash('sha256').update(html).digest('hex'),coletadoEm}]};}

test('feedback de formulário é template de interface e não evidência de sucesso ou negócio',()=>{
  const html='<section><h2>Converse com a equipe</h2><p>Primeiro texto publicado antes do formulário.</p><div class="w-form"><form><label>Nome<input value="DADO_PRIVADO"></label><button>Enviar</button></form><div class="w-form-done"><div>Thank you! Your submission has been received!</div></div><div class="w-form-fail"><div>Oops! Something went wrong while submitting the form.</div></div></div><p>Último texto publicado depois do formulário.</p></section>';
  const r=extrairFontesNegocio(coleta(html));
  const feedbacks=r.fontes.filter(f=>f.texto.includes('Thank you!')||f.texto.includes('Oops!'));
  assert.equal(feedbacks.length,2);assert.ok(feedbacks.every(f=>f.tipo==='interface'&&f.projecao.estado==='template_nao_executado'&&f.projecao.envioObservado===false));
  assert.ok(!r.fontes.some(f=>f.tipo!=='interface'&&(f.texto.includes('Thank you!')||f.texto.includes('Oops!'))));
  assert.ok(!JSON.stringify(r).includes('DADO_PRIVADO'));assert.ok(r.cobertura.feedbacksSeparadosComoInterface>=2);
});

test('não junta declaração e restrição pelos lados de um form omitido',()=>{
  const r=extrairFontesNegocio(coleta('<section><h2>Atendimento técnico</h2><p>Oferecemos instalação de equipamentos em empresas.</p><form><input aria-label="Contato" value="SEGREDO"></form><p>Não realizamos manutenção de equipamentos de terceiros.</p></section>'));
  assert.ok(r.fontes.some(f=>f.texto==='Oferecemos instalação de equipamentos em empresas.'));
  assert.ok(r.fontes.some(f=>f.texto==='Não realizamos manutenção de equipamentos de terceiros.'));
  assert.ok(!r.fontes.some(f=>f.texto.includes('Oferecemos instalação')&&f.texto.includes('Não realizamos')));
  assert.ok(r.cobertura.projecoesComOmissaoDescartadas>=1);
});

test('regra comercial fora do formulário e alerta próprio são mantidos literalmente',()=>{
  const r=extrairFontesNegocio(coleta('<main><p role="alert" class="success">O plano básico atende somente empresas com uma filial.</p><form><button>Enviar</button></form><p>É obrigatório apresentar documento na retirada do equipamento.</p></main>'));
  assert.ok(r.fontes.some(f=>f.tipo!=='interface'&&f.texto==='O plano básico atende somente empresas com uma filial.'));
  assert.ok(r.fontes.some(f=>f.tipo!=='interface'&&f.texto==='É obrigatório apresentar documento na retirada do equipamento.'));
});

test('bloco limpo continua preservando nome e condição juntos',()=>{
  const texto='Plano Inicial Inclui cinco usuários, com aulas online e suporte por chat.';
  const r=extrairFontesNegocio(coleta('<section><h2>Plano Inicial</h2><p>Inclui cinco usuários, com aulas online e suporte por chat.</p></section>'));
  assert.ok(r.fontes.some(f=>f.campo==='bloco.titulo-conteudo'&&f.texto===texto&&f.projecao.subarvoresOmitidas===false));
});

test('omissão oculta dentro do parágrafo não cria uma nova frase contínua',()=>{
  const r=extrairFontesNegocio(coleta('<section><h2>Descrição pública</h2><p>Começo da declaração comercial <span hidden>CONTEUDO_OCULTO</span> final da declaração comercial.</p><p>Oferecemos consultoria técnica presencial sob agendamento.</p></section>'));
  assert.ok(!r.fontes.some(f=>f.texto.includes('Começo da declaração')&&f.texto.includes('final da declaração')));
  assert.ok(r.fontes.some(f=>f.texto==='Oferecemos consultoria técnica presencial sob agendamento.'));
  assert.ok(!JSON.stringify(r).includes('CONTEUDO_OCULTO'));
});

test('rótulo alterado pelo helper não recebe fidelidade literal e valores não entram',()=>{
  const r=extrairFontesNegocio(coleta('<form><label>Origem\u200d Final<input value="PESSOA_PRIVADA"></label><label>Destino<input value="LOCAL_PRIVADO"></label><button>Buscar</button></form>'));
  assert.ok(!r.fontes.some(f=>f.texto==='Origem Final'));assert.ok(r.cobertura.rotulosNaoLiteraisDescartados>=1);
  assert.ok(r.fontes.some(f=>f.tipo==='interface'&&f.texto==='Destino'));
  assert.ok(!JSON.stringify(r).includes('PESSOA_PRIVADA'));assert.ok(!JSON.stringify(r).includes('LOCAL_PRIVADO'));
});

test('feedback genérico estruturado em form-success também fica separado',()=>{
  const r=extrairFontesNegocio(coleta('<div><h2>Solicite uma proposta</h2><form><button>Enviar</button></form><div class="form-success">Mensagem enviada com sucesso.</div><p>Não atendemos pedidos de equipamentos usados.</p></div>'));
  const f=r.fontes.find(f=>f.texto==='Mensagem enviada com sucesso.');assert.equal(f.tipo,'interface');assert.equal(f.projecao.envioObservado,false);
  assert.ok(r.fontes.some(f=>f.tipo!=='interface'&&f.texto==='Não atendemos pedidos de equipamentos usados.'));
});

test('fontes retêm data, URL, hash e caracteres de formato em conteúdo publicado',()=>{
  const c=coleta('<meta name="description" content="Somos uma empresa de cursos."><p>Oferecemos programas online.\u200d Exigimos inscrição prévia.</p>');const r=extrairFontesNegocio(c);
  assert.ok(r.fontes.some(f=>f.texto.includes('\u200d')));assert.ok(r.fontes.every(f=>f.url===c.paginas[0].url&&f.sha256===c.paginas[0].sha256&&f.coletadoEm===coletadoEm));assert.equal(r.versao,2);
});

test('ícone sem texto e formulário no fim não apagam um único trecho publicado',()=>{
  const r=extrairFontesNegocio(coleta('<section><h2>Plano Empresarial</h2><p><svg><path d="M0 0"/></svg>Inclui atendimento presencial e cinco usuários.</p><form><input aria-label="Contato"></form></section>'));
  assert.ok(r.fontes.some(f=>f.texto==='Inclui atendimento presencial e cinco usuários.'));
  const bloco=r.fontes.find(f=>f.campo==='bloco.titulo-conteudo');assert.equal(bloco.texto,'Plano Empresarial Inclui atendimento presencial e cinco usuários.');assert.equal(bloco.projecao.subarvoresOmitidas,true);assert.equal(bloco.projecao.continuidade,'um_segmento_sem_compor_os_lados');
});

test('menu ou layout entre título e regra não liga modalidade do menu à condição',()=>{
  for(const tag of ['nav','header','footer','aside']){
    const r=extrairFontesNegocio(coleta('<section><h2>Planos empresariais</h2><'+tag+'><a>Plano Gratuito</a></'+tag+'><p>Inclui até quatro usuários na modalidade contratada.</p></section>'));
    assert.ok(!r.fontes.some(f=>f.tipo!=='interface'&&f.texto.includes('Plano Gratuito')));
    assert.ok(r.fontes.some(f=>f.texto==='Inclui até quatro usuários na modalidade contratada.'));
    assert.ok(!r.fontes.some(f=>f.campo==='bloco.titulo-conteudo'&&f.texto.includes('Planos empresariais')&&f.texto.includes('Inclui até')));
  }
});
