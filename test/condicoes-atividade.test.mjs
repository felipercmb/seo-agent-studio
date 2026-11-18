import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extrairCondicoesPorAtividade} from '../src/modulos/condicoes-atividade.mjs';
import {inferirEntendimentoNegocio} from '../src/modulos/entendimento-negocio.mjs';
const D='example.com',H='a'.repeat(64),T='2026-11-17T10:00:00.000Z';
const fonte=(trecho,extra={})=>({tipo:'declaracao',campo:'p',trecho,url:'https://example.com/',sha256:H,coletadoEm:T,recortado:false,...extra});
const frase='Não. Seu cliente não precisa criar conta para assinar. Conta é só para quem envia.';
const extrair=(texto=frase,extra={})=>extrairCondicoesPorAtividade({dominio:D,fontes:[fonte(texto,extra)]});

test('dispensa de assinar e destinacao a quem envia permanecem separadas sem inventar obrigacao',()=>{
  const r=extrair();assert.equal(r.itens.length,2);assert.deepEqual(r.itens.map(x=>x.efeito),['dispensa_publicada','destinacao_restrita_publicada']);assert.deepEqual(r.itens.map(x=>x.atividade.texto),['assinar','envia']);assert.equal(r.comparacoes.length,1);assert.equal(r.comparacoes[0].contradicaoConfirmada,false);assert.match(r.comparacoes[0].casosFicticios[1].verificar,/não prova essa obrigação/);assert.ok(r.itens.every(x=>x.aplicacaoConfirmada===false));
});

test('requisito explicito sem sujeito nao inventa uma pessoa e negacao tem prioridade',()=>{
  const a=extrair('É necessário ter conta para enviar documentos.'),b=extrair('Não é necessário criar conta para assinar.');assert.equal(a.itens[0].efeito,'requisito_publicado');assert.equal(a.itens[0].parte,null);assert.equal(b.itens.length,1);assert.equal(b.itens[0].efeito,'dispensa_publicada');
});

test('qualificador dentro da atividade ou apos virgula nao e omitido e tem offsets exatos',()=>{
  for(const texto of ['Seu cliente não precisa criar conta para assinar quando usar o plano Livre.','Seu cliente não precisa criar conta para assinar, exceto no plano Corporativo.']){
    const r=extrair(texto).itens[0];assert.equal(r.atividade.texto,'assinar');assert.ok(r.qualificador);assert.equal(texto.slice(r.qualificador.inicio,r.qualificador.fim),r.qualificador.texto);assert.equal(r.fonte.trecho,texto);assert.equal(r.fraseLiteral,texto);
  }
});

test('pares nao sao inventados entre fontes, paginas ou atividades com o mesmo nome',()=>{
  const r=extrairCondicoesPorAtividade({dominio:D,fontes:[fonte('Seu cliente não precisa criar conta para assinar.'),fonte('Conta é só para quem envia.')]});assert.equal(r.itens.length,2);assert.equal(r.comparacoes.length,0);
  const s=extrair('Seu cliente não precisa criar conta para assinar. É necessário ter conta para assinar.');assert.equal(s.comparacoes.length,0);assert.equal(s.itens.length,2);
});

test('pergunta, recorte, fonte externa e ausencia de hash nao sao declaracoes de requisito',()=>{
  assert.equal(extrair('Seu cliente precisa criar conta para assinar?').itens.length,0);
  for(const extra of [{recortado:true},{url:'https://rival.com/'},{sha256:null},{coletadoEm:null}])assert.equal(extrair(frase,extra).itens.length,0);
});

test('FAQ conserva a ponte de origem e nao confirma visibilidade',()=>{
  const r=extrair(frase,{campo:'jsonld.FAQPage.mainEntity.acceptedAnswer.text',origemEstruturada:{jsonLdSha256:H,respostaPointer:'/mainEntity/0/acceptedAnswer/text'}});assert.equal(r.itens[0].fonte.respostaPointer,'/mainEntity/0/acceptedAnswer/text');assert.equal(r.itens[0].fonte.visibilidade,'nao_verificada');assert.equal(r.itens[0].fonte.trecho,frase);
});

test('todos os campos e fonte sao preservados sem mutacao e com offsets definidos',()=>{
  const f=fonte('😀 Contexto. '+frase),antes=structuredClone(f),r=extrairCondicoesPorAtividade({dominio:D,fontes:[f]});assert.equal(r.itens.length,2);
  for(const x of r.itens)for(const k of ['parte','requisito','atividade','marcador'])if(x[k])assert.equal(f.trecho.slice(x[k].inicio,x[k].fim),x[k].texto);assert.deepEqual(f,antes);
});

test('entendimento inclui FAQ publicada sem transformar destinacao em comprador ou pagador',()=>{
  const f=fonte(frase),ctx={versao:1,dominio:D,evidencias:[],detalhesPublicados:[],perguntasPublicadas:[f]},r=inferirEntendimentoNegocio({dominio:D,contextoPublico:ctx});assert.equal(r.condicoesPorAtividade.itens.length,2);assert.equal(r.papel,'indefinido');assert.equal(r.natureza,'hipotese');
});


test('contraste depois da atividade não amplia dispensa ao segundo percurso',()=>{
  for(const texto of ['Seu cliente não precisa criar conta para assinar mas precisa ter conta para enviar.','Seu cliente não precisa criar conta para assinar, mas precisa ter conta para enviar.','Seu cliente não precisa criar conta para assinar porém precisa ter conta para enviar.']){
    const r=extrair(texto);assert.equal(r.itens.length,1);const x=r.itens[0];assert.equal(x.efeito,'dispensa_publicada');assert.equal(x.atividade.texto,'assinar');assert.match(x.qualificador.texto,/precisa ter conta para enviar/u);assert.equal(texto.slice(x.qualificador.inicio,x.qualificador.fim),x.qualificador.texto);assert.equal(x.fonte.trecho,texto);assert.equal(r.comparacoes.length,0);
  }
});

test('nova oração de requisito após e é preservada sem virar atividade dispensada',()=>{
 const texto='Seu cliente não precisa criar conta para assinar e precisa ter cadastro para enviar documentos.';const x=extrair(texto).itens[0];assert.equal(x.atividade.texto,'assinar');assert.equal(x.qualificador.texto,'e precisa ter cadastro para enviar documentos');assert.equal(texto.slice(x.qualificador.inicio,x.qualificador.fim),x.qualificador.texto);
});

test('coordenação de atividades sob a mesma regra continua inteira',()=>{
 const x=extrair('Seu cliente não precisa criar conta para assinar e enviar documentos.').itens[0];assert.equal(x.atividade.texto,'assinar e enviar documentos');assert.equal(x.qualificador,null);
});
