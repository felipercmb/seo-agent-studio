import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {extrairContextoPublico} from '../src/modulos/contexto-publico.mjs';
import {inferirPerfil} from '../src/modulos/perfil.mjs';
const dominio='exemplo.com.br',coletadoEm='2026-11-16T00:00:00.000Z';
const extrair=(html,paginas=[])=>extrairContextoPublico({dominio,coletadoEm,paginas:[{url:'https://exemplo.com.br/',html,status:200,coletadoEm},...paginas]});
test('produto que contém WhatsApp não vira canal de atendimento por coincidência de palavra',()=>{
 const c=extrair('<title>Ferramentas</title><a href="/produto/easy-whatsapp">Easy WhatsApp</a><a href="/solucoes/api-whatsapp">API WhatsApp</a><a href="/contato">Fale com a equipe</a>');
 assert.deepEqual(c.interacoesPublicas.map(i=>i.rotulo),['Fale com a equipe']);assert.equal(c.interacoesPublicas[0].acao,'contatar');
});

test('lê nomes de controles sem valores, hidden, placeholders, opções, textarea ou destino de envio',()=>{
  const html='<title>Exemplo</title><form action="/envio?token=SEGREDO_ACTION"><label for="de">Origem</label><input id="de" name="SEGREDO_NAME" value="SEGREDO_VALUE" placeholder="SEGREDO_PLACEHOLDER"><label for="para">Destino</label><select id="para"><option selected>SEGREDO_OPTION</option></select><label for="csrf">Token oculto</label><input id="csrf" type="hidden" value="SEGREDO_CSRF"><textarea>SEGREDO_DIGITADO</textarea><button><style>.SEGREDO_CSS{color:red}</style>Buscar</button></form>';
  const c=extrair(html),itens=c.interacoesPublicas;
  assert.deepEqual(itens.map(i=>i.rotulo),['Origem','Destino','Buscar']);
  assert.ok(!JSON.stringify(c).includes('SEGREDO'));
  assert.equal(new Set(itens.map(i=>i.grupoId)).size,1);
  assert.ok(itens.every(i=>i.tipoGrupo==='formulario'&&i.modo==='nao_preenchido'&&i.sha256===createHash('sha256').update(html).digest('hex')));
  assert.equal(itens.at(-1).acao,'buscar');
});

test('elementos ocultos, senhas e depoimentos não originam interações',()=>{
  const c=extrair('<title>Exemplo</title><form hidden><button>Comprar oculto</button></form><form aria-hidden="TRUE"><input aria-label="Origem secreta"></form><div inert><button>Reservar secreto</button></div><section class="testimonial"><button>Agendar depoimento</button></section><input type="password" aria-label="Senha"><button>Agendar visita</button>');
  assert.deepEqual(c.interacoesPublicas.map(i=>i.rotulo),['Agendar visita']);
});

test('IDs internos e atributos de dados não são emitidos, e aria-label é fonte de nome',()=>{
  const c=extrair('<title>Exemplo</title><div role="search"><span id="SEGREDO_ID">Data de ida</span><input aria-labelledby="SEGREDO_ID" value="SEGREDO"><input aria-label="Data de volta" value="SEGREDO"><button aria-label="Buscar passagens"></button></div>');
  assert.deepEqual(c.interacoesPublicas.map(i=>i.rotulo),['Data de ida','Data de volta','Buscar passagens']);
  assert.ok(!JSON.stringify(c).includes('SEGREDO'));
  assert.ok(c.interacoesPublicas.every(i=>i.tipoGrupo==='busca'));
});

test('rótulos com dados pessoais explícitos são descartados e nome não é inferido de placeholder',()=>{
  const c=extrair('<title>Exemplo</title><input placeholder="Origem" name="Origem" value="Cidade"><input aria-label="joana@exemplo.com"><button>Contato 11987654321</button><button>Solicitar orçamento</button>');
  assert.deepEqual(c.interacoesPublicas.map(i=>i.rotulo),['Solicitar orçamento']);
  assert.equal(c.interacoesPublicas[0].acao,'solicitar_orcamento');
});

test('ação pública de link não emite URL-alvo nem comprova uma ação concluída',()=>{
  const c=extrair('<title>Exemplo</title><a href="https://externo.com/?cpf=SEGREDO">Comprar ingresso</a><a href="/sobre">Sobre a empresa</a>');
  assert.equal(c.interacoesPublicas.length,1);
  assert.equal(c.interacoesPublicas[0].tipo,'link');
  assert.equal(c.interacoesPublicas[0].url,'https://exemplo.com.br/');
  assert.equal(c.interacoesPublicas[0].acao,'comprar');
  assert.ok(!JSON.stringify(c).includes('SEGREDO'));
  assert.equal(c.interacoesPublicas[0].natureza,'interface_publica');
});

test('rótulos de formulário não viram ofertas ou evidências de identidade',()=>{
  const c=extrair('<title>Exemplo</title><form><label>Hospedagem de sites<input value="SEGREDO"></label><button>Comprar hospedagem</button></form>');
  assert.ok(c.interacoesPublicas.length);
  const p=inferirPerfil({dominio,contextoPublico:c});
  assert.equal(p.ofertas.length,0);
  assert.equal(p.entendimento.papel,'indefinido');
  assert.ok(!c.evidencias.some(e=>/Hospedagem/.test(e.trecho)));
});

test('cotas preservam quatro itens por página e não passam de oito por URL ou 48 no total',()=>{
  const html=n=>'<title>Exemplo</title><form>'+Array.from({length:12},(_,i)=>'<input aria-label="Data '+n+'-'+i+'">').join('')+'</form>';
  const p=Array.from({length:11},(_,i)=>({url:'https://exemplo.com.br/p'+i,html:html(i),status:200,coletadoEm}));
  const c=extrair(html(99),p);
  assert.equal(c.interacoesPublicas.length,48);
  for(const url of ['https://exemplo.com.br/',...p.map(x=>x.url)]){const n=c.interacoesPublicas.filter(i=>i.url===url).length;assert.ok(n>=4&&n<=8);}
  assert.equal(c.coberturaInteracoes.limitada,true);
});
