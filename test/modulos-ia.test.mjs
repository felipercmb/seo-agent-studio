import test from 'node:test';
import assert from 'node:assert/strict';
import {prepararIAProjeto,registrarIAProjeto} from '../src/modulos/ia.mjs';

const agora=()=>Date.parse('2026-11-15T19:00:00Z');
test('IA prioriza uma oferta publicada acima de temporizadores e hipóteses sem alterar os fatos enviados',()=>{
  const termos=['1,5 minuto','Ajuda','Atualizações','ZZZ contratação de artistas'];
  const candidatos=termos.map((termo,i)=>({termo,origem:'site',intencao:i===3?'comercial':'indefinida',
    ...(i===3?{ofertaId:'artistas'}:{}),evidencia:{url:'https://cliente.com.br/pagina-'+i,
      trecho:termo,coletadoEm:'2026-11-15T18:59:00Z',sha256:'a'.repeat(64)}}));
  candidatos.push({termo:'Outra hipótese',origem:'hipotese',ofertaId:'artistas',intencao:'comercial'});
  const projeto={dominio:'cliente.com.br',perfil:{ofertas:[{id:'artistas',nome:'ZZZ contratação de artistas'}]},coletadoEm:'2026-11-15T18:59:00Z',
    palavras:{candidatos},descoberta:{cobertura:{paginasLidas:4}},diagnostico:null,
    capacidades:{posicoes:{configurada:false}}};
  const antes=JSON.stringify(projeto),r=prepararIAProjeto(projeto,{agora});
  assert.equal(r.entrada.entradas[0].evidencias.find(e=>e.tipo==='serp').termo,'ZZZ contratação de artistas');
  assert.equal(r.selecao.candidatosPublicados,4);assert.equal(r.selecao.contextos,1);
  assert.equal(r.selecao.excluidos.length,3);
  assert.doesNotMatch(JSON.stringify(r.entrada),/Outra hipótese|artistas"\s*:/);
  assert.ok(r.entrada.entradas.every(e=>e.dados_negocio.volume_busca===null && e.evidencias.every(v=>v.tipo!=='serp' || v.posicao===null)));
  assert.equal(JSON.stringify(projeto),antes);
});

test('registro liga a resposta ao modelo por hashes e rejeita metadados incompatíveis',()=>{
  const modelo={versao:1,modo:'candidata',selecaoSha256:'a'.repeat(64),adaptadorSha256:'b'.repeat(64),configSha256:'c'.repeat(64)};
  const resultado={versao:1,estado:'experimental',modelo,resultados:[{estado:'recusada',origem:'ia',erros:['Sem evidência.']}]};
  const entrada={hashEntrada:'d'.repeat(64),entrada:{entradas:[{evidencias:[]}]}};
  const p={revisao:7};
  const gravado=registrarIAProjeto(p,resultado,entrada,{agora,modoEsperado:'candidata'});
  assert.deepEqual(gravado.modelo,modelo);assert.notEqual(gravado.modelo,modelo);
  for(const m of [{...modelo,modo:'padrao'},{...modelo,adaptadorSha256:'hash errado'},{...modelo,caminho:'/arquivo/privado'}]){
    assert.throws(()=>registrarIAProjeto(p,{...resultado,modelo:m},entrada,{agora,modoEsperado:'candidata'}),/Identificação/);
  }
  const legado={...resultado};delete legado.modelo;
  assert.equal(registrarIAProjeto(p,legado,entrada,{agora}).modelo,undefined);
});

test('contexto do negócio acompanha a evidência sem enviar campos financeiros como fatos',()=>{
  const p={dominio:'cliente.com.br',revisao:1,coletadoEm:'2026-11-15T18:59:00Z',
    perfil:{estado:'confirmado',publico:'Contratantes de eventos',ofertas:[{id:'o1',nome:'Contratação de artistas',economia:{contribuicaoPorVenda:9321.87,taxaFechamento:.37123}}],
      entendimento:{papel:'intermediacao',finalidade:{tipo:'comercial'}}},
    palavras:{candidatos:[{termo:'Contratação de artistas',origem:'site',ofertaId:'o1',intencao:'comercial',contextoFonte:'oferta',
      evidencia:{url:'https://cliente.com.br/contrate',campo:'h1',trecho:'Contratação de artistas',coletadoEm:'2026-11-15T18:59:00Z',sha256:'a'.repeat(64)}}]},
    descoberta:{cobertura:{paginasLidas:1}},diagnostico:null};
  const a=prepararIAProjeto(p,{agora});assert.equal(a.entrada.entradas[0].contexto_negocio.papel,'intermediacao');
  assert.equal(a.entrada.entradas[0].contexto_negocio.publicoDeclarado,'Contratantes de eventos');
  assert.doesNotMatch(JSON.stringify(a.entrada),/9321\.87|0\.37123/);
  p.perfil.publico='Organizações religiosas';const b=prepararIAProjeto(p,{agora});assert.notEqual(a.hashEntrada,b.hashEntrada);
});
