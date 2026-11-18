import test from 'node:test';
import assert from 'node:assert/strict';
import {compararRevisaoPerfil} from '../src/modulos/revisao-perfil.mjs';

const oferta = (extras = {}) => ({id:'oferta_1',nome:'Consultoria ambiental',url:'https://cliente.com.br/consultoria',
  economia:{contribuicaoPorVenda:null,taxaFechamento:null},...extras});
const perfil = (extras = {}) => ({versao:1,dominio:'cliente.com.br',nome:'Cliente',resumo:'Uma consultoria.',publico:'Empresas',
  entendimento:{papel:'servicos',natureza:'hipotese'},regioes:['Brasil'],exclusoes:[],estado:'rascunho',ofertas:[oferta()],...extras});

test('perfil inalterado não produz mudanças e comparação não modifica entradas', () => {
  const a = perfil(), d = structuredClone(a), original = structuredClone(a);
  const r = compararRevisaoPerfil(a,d);
  assert.deepEqual(r.campos,[]);
  assert.deepEqual(r.ofertas,{adicionadas:[],removidas:[],alteradas:[]});
  assert.equal(r.economiaAlterada,false);
  assert.equal(r.origem,'declaracao_usuario');
  assert.deepEqual(a,original);
  assert.deepEqual(d,original);
});

test('rascunho corrigido registra antes e depois sem implicar confirmação ou treinamento', () => {
  const a = perfil(), d = perfil({nome:'Empresa corrigida',resumo:'Atende pequenas empresas.',publico:'Pequenas empresas',
    entendimento:{papel:'intermediacao'},regioes:['Goiânia'],exclusoes:['serviço gratuito']});
  const r = compararRevisaoPerfil(a,d);
  assert.equal(r.campos.find(c=>c.campo==='nome').antes,'Cliente');
  assert.equal(r.campos.find(c=>c.campo==='nome').depois,'Empresa corrigida');
  assert.deepEqual(r.campos.find(c=>c.campo==='regioes').depois,['Goiânia']);
  assert.equal(r.campos.find(c=>c.campo==='papel').depois,'intermediacao');
  assert.ok(!r.campos.some(c=>c.campo==='estado'));
  assert.match(r.nota,/incluindo rascunhos/);
  assert.match(r.nota,/Não treina modelos/);
  assert.match(r.nota,/não confirma fatos do site/);
});

test('confirmação e retorno a rascunho têm registro explícito de estado', () => {
  const a = perfil(), confirmado = perfil({estado:'confirmado'});
  assert.deepEqual(compararRevisaoPerfil(a,confirmado).campos,[{campo:'estado',antes:'rascunho',depois:'confirmado'}]);
  assert.deepEqual(compararRevisaoPerfil(confirmado,a).campos,[{campo:'estado',antes:'confirmado',depois:'rascunho'}]);
});

test('nome e página de oferta com identidade estável têm antes e depois', () => {
  const a = perfil(), d = perfil({ofertas:[oferta({nome:'Assessoria ambiental',url:'https://cliente.com.br/assessoria'})]});
  const r = compararRevisaoPerfil(a,d);
  assert.equal(r.ofertas.alteradas.length,1);
  assert.deepEqual(r.ofertas.alteradas[0].campos,['nome','url']);
  assert.deepEqual(r.ofertas.alteradas[0].antes,{nome:'Consultoria ambiental',url:'https://cliente.com.br/consultoria'});
  assert.deepEqual(r.ofertas.alteradas[0].depois,{nome:'Assessoria ambiental',url:'https://cliente.com.br/assessoria'});
});

test('renomear com ID novo registra remoção e adição sem presumir identidade pela página', () => {
  const a = perfil(), d = perfil({ofertas:[oferta({id:'oferta_renomeada',nome:'Produção de eventos'})]});
  const r = compararRevisaoPerfil(a,d);
  assert.equal(r.ofertas.removidas[0].nome,'Consultoria ambiental');
  assert.equal(r.ofertas.adicionadas[0].nome,'Produção de eventos');
  assert.deepEqual(r.ofertas.alteradas,[]);
  assert.equal(r.economiaAlterada,false);
});

test('ordem das ofertas não é mudança de identidade nem transfere premissas', () => {
  const a = perfil({ofertas:[oferta(),oferta({id:'oferta_2',nome:'Auditoria'})]});
  const d = {...a,ofertas:[a.ofertas[1],a.ofertas[0]]};
  assert.deepEqual(compararRevisaoPerfil(a,d).ofertas,{adicionadas:[],removidas:[],alteradas:[]});
});

test('zero e contribuição negativa são diferentes de desconhecido e nunca são serializados', () => {
  for(const [antes, depois] of [[null,0],[0,null],[null,-13579.25],[-13579.25,null],[12001.75,-13579.25]]) {
    const a = perfil({ofertas:[oferta({economia:{contribuicaoPorVenda:antes,taxaFechamento:null}})]});
    const d = perfil({ofertas:[oferta({economia:{contribuicaoPorVenda:depois,taxaFechamento:null}})]});
    const r = compararRevisaoPerfil(a,d), json = JSON.stringify(r);
    assert.equal(r.economiaAlterada,true);
    assert.deepEqual(r.campos.find(c=>c.campo==='economia'),{campo:'economia',alterado:true});
    assert.deepEqual(r.ofertas.alteradas[0].campos,['economia']);
    assert.ok(!json.includes('-13579.25'));
    assert.ok(!json.includes('12001.75'));
    assert.ok(!json.includes('contribuicaoPorVenda'));
    assert.ok(!json.includes('taxaFechamento'));
  }
});

test('troca de taxa é somente flag e ausência equivale a desconhecido', () => {
  const a = perfil({ofertas:[oferta({economia:{contribuicaoPorVenda:null,taxaFechamento:0.918273}})]});
  const d = perfil({ofertas:[oferta({economia:{contribuicaoPorVenda:null,taxaFechamento:0}})]});
  const r = compararRevisaoPerfil(a,d);
  assert.equal(r.economiaAlterada,true);
  assert.ok(!JSON.stringify(r).includes('0.918273'));
  const desconhecido = perfil({ofertas:[oferta({economia:{}})]});
  assert.equal(compararRevisaoPerfil(desconhecido,perfil()).economiaAlterada,false);
});

test('adição e remoção de oferta financeira registra só campos públicos e flag', () => {
  const comValor = perfil({ofertas:[oferta({economia:{contribuicaoPorVenda:987654.125,taxaFechamento:0.123456}})]});
  const semOferta = perfil({ofertas:[]});
  for(const r of [compararRevisaoPerfil(semOferta,comValor),compararRevisaoPerfil(comValor,semOferta)]) {
    assert.equal(r.economiaAlterada,true);
    const json=JSON.stringify(r);
    assert.ok(!json.includes('987654.125'));
    assert.ok(!json.includes('0.123456'));
    for(const o of [...r.ofertas.adicionadas,...r.ofertas.removidas]) assert.deepEqual(Object.keys(o),['id','nome','url']);
  }
});

test('métricas e evidências extras não são copiadas para a auditoria', () => {
  const a = perfil(), d = perfil({posicao:1,demanda:9999,evidencias:[{segredo:'privado'}],
    ofertas:[oferta({nome:'Novo nome',custo:999888777,valorPorContato:{valor:777888999},evidencias:['nao-copiar']})]});
  const json=JSON.stringify(compararRevisaoPerfil(a,d));
  for(const marcador of ['999888777','777888999','privado','nao-copiar','"posicao"','"demanda"'])assert.ok(!json.includes(marcador));
});

test('auditoria respeita oito ofertas e rejeita perfis cruzados ou identidades duplicadas', () => {
  const a = perfil({ofertas:[]}), d = perfil({ofertas:Array.from({length:12},(_,n)=>oferta({id:'id'+n,nome:'Oferta '+n}))});
  assert.equal(compararRevisaoPerfil(a,d).ofertas.adicionadas.length,8);
  assert.throws(()=>compararRevisaoPerfil(a,{...d,dominio:'outro.com.br'}),TypeError);
  assert.throws(()=>compararRevisaoPerfil(a,perfil({ofertas:[oferta(),oferta({nome:'Outra'})]})),TypeError);
  assert.throws(()=>compararRevisaoPerfil(null,d),TypeError);
});

test('finalidade e atividades não comerciais ficam corrigíveis sem copiar dados econômicos',()=>{
  const a=perfil({entendimento:{papel:'indefinido',finalidade:{tipo:'indefinida'},atuacoes:[]}});
  const d=perfil({entendimento:{papel:'indefinido',finalidade:{tipo:'social'},atuacoes:[{tipo:'programa_social',nome:'Educação comunitária',url:'https://cliente.com.br/projeto',economia:{valorSecreto:9812345}}]}});
  const r=compararRevisaoPerfil(a,d);assert.ok(r.campos.some(c=>c.campo==='finalidade' && c.depois==='social'));
  assert.deepEqual(r.atuacoes.adicionadas,[{tipo:'programa_social',nome:'Educação comunitária',url:'https://cliente.com.br/projeto'}]);
  assert.doesNotMatch(JSON.stringify(r),/9812345|valorSecreto/);
  const removido=compararRevisaoPerfil(d,a);assert.equal(removido.atuacoes.removidas.length,1);
});
