import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extrairAtribuicoesNominais} from '../src/modulos/atribuicoes-nominais.mjs';
import {inferirEntendimentoNegocio} from '../src/modulos/entendimento-negocio.mjs';
const D='example.com',H='a'.repeat(64),T='2026-11-17T10:00:00.000Z';
const fonte=(trecho,extra={})=>({tipo:'declaracao',campo:'p',trecho,url:'https://example.com/',sha256:H,coletadoEm:T,recortado:false,...extra});
const extrair=(texto,extra={})=>extrairAtribuicoesNominais({dominio:D,fontes:[fonte(texto,extra)]});

test('atribuicao nominal conserva marcador e partes sem fabricar verbo ou executor',()=>{
  const texto='A decisão e a execução continuam sempre do cliente.',r=extrair(texto);assert.equal(r.itens.length,1);const x=r.itens[0];assert.equal(x.tipo,'atribuicao_de_atividade');assert.equal(x.ator.texto,'cliente');assert.equal(x.objeto.texto,'A decisão e a execução');assert.equal(x.marcador.texto,'continuam sempre do');assert.equal(x.acaoVerbal,null);assert.equal(x.execucaoRealConfirmada,false);assert.equal(x.responsabilidadeJuridicaConfirmada,false);assert.equal(x.fonte.trecho,texto);assert.match(x.pergunta,/qual parte cabe/);
});

test('responsabilidade explicita e posse de dados ficam com tipos diferentes',()=>{
  const a=extrair('A instalação é responsabilidade do cliente.').itens[0],b=extrair('Os dados coletados são de propriedade do cliente.').itens[0];assert.equal(a.tipo,'responsabilidade_publicada');assert.equal(b.tipo,'posse_publicada');assert.match(b.pergunta,/propriedade/);assert.equal(b.perfilConfirmado,false);
});

test('qualificador nao vira parte, permanece na frase e na fonte',()=>{
  const r=extrair('A implantação é responsabilidade do cliente após aprovação do contrato.').itens[0];assert.equal(r.ator.texto,'cliente');assert.match(r.fraseLiteral,/após aprovação do contrato/);assert.match(r.fonte.trecho,/após aprovação do contrato/);
});

test('negacao, hipotese, referencia relatada e texto recortado nao aprovam atividade',()=>{
  for(const texto of ['A instalação não é responsabilidade do cliente.','Se a instalação é responsabilidade do cliente, confirme o plano.','A empresa informa que a instalação é responsabilidade do cliente.','Os produtos continuam sempre do cliente.'])assert.equal(extrair(texto).itens.length,0,texto);
  assert.equal(extrair('A instalação é responsabilidade do cliente.',{recortado:true}).itens.length,0);
  assert.equal(extrair('A instalação é responsabilidade do cliente.',{secao:'Depoimentos de clientes'}).itens[0].estado,'contexto_documental_pendente');
});

test('contrato preserva a atribuicao como documental pendente em vez de generalizar a operacao',()=>{
  const r=extrair('A instalação é responsabilidade do cliente.',{url:'https://example.com/termos-de-contratacao'});assert.equal(r.itens[0].estado,'contexto_documental_pendente');assert.equal(r.itens[0].revisaoSemantica,'pendente');
});

test('offsets UTF16 recuperam campos exatos mesmo depois de emoji e sem alterar fonte',()=>{
  const texto='😀 Contexto anterior. A instalação é responsabilidade do cliente.',f=fonte(texto),antes=structuredClone(f),r=extrairAtribuicoesNominais({dominio:D,fontes:[f]});assert.equal(r.itens.length,1);for(const k of ['ator','objeto','marcador']){const p=r.itens[0][k];assert.equal(texto.slice(p.inicio,p.fim),p.texto);}assert.deepEqual(f,antes);assert.equal(r.itens[0].unidadeOffsets,'utf16_no_trecho');
});

test('fonte externa, sem hash ou data e ator truncado nao geram atribuição',()=>{
  for(const extra of [{url:'https://rival.com/'},{sha256:null},{coletadoEm:null}])assert.equal(extrair('A instalação é responsabilidade do cliente.',extra).itens.length,0);
  assert.equal(extrair('A instalação é responsabilidade do '+('cliente '.repeat(30))+'.').itens.length,0);
});

test('entendimento integra evidencias nominais sem preencher compradores ou pagadores',()=>{
  const f=fonte('A decisão e a execução continuam sempre do cliente.'),ctx={versao:1,dominio:D,evidencias:[f],detalhesPublicados:[f]},r=inferirEntendimentoNegocio({dominio:D,contextoPublico:ctx});assert.equal(r.atribuicoesNominais.itens.length,1);assert.equal(r.atribuicoesNominais.itens[0].acaoVerbal,null);assert.equal(r.natureza,'hipotese');assert.equal(r.papel,'indefinido');
});
