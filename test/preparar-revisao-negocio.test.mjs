import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,lstat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {prepararRevisaoNegocio} from '../scripts/preparar-revisao-negocio.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
async function fixture(t){const pasta=await mkdtemp(join(tmpdir(),'revisao-negocio-'));t.after(()=>rm(pasta,{recursive:true,force:true}));const avaliacao=join(pasta,'entrada-alvos-secretos.json'),saida=join(pasta,'pacote-novo');
 const entrada={versao:1,splits:['validation'],rotulosSha256:'ROTULO_OCULTO',avaliadorSha256:'AVALIACAO_OCULTA',denominadores:{nota:99},resultados:Array.from({length:4},(_,i)=>{
  const dominio='empresa'+i+'.com.br',url='https://'+dominio+'/',e={url,campo:'h1',trecho:'<script>alert("conteudo")</script> Oferta pública',sha256:hash('html'+i),coletadoEm:'2026-11-15T20:00:00Z'};
  return{id:'ID_ALVO_OCULTO_'+i,dominio,split:'validation',familia:'FAMILIA_OCULTA',rotulos:{correto:'GABARITO_OCULTO'},perfilIndicadores:{nota:99},capturaSha256:hash('captura'+i),paginasCapturadas:i===3?0:i+1,
   rascunho:{perfil:{nome:'Empresa '+i,resumo:i===3?'Leitura indisponível':'Descrição pública da empresa.',publico:'DADO_PRIVADO_OCULTO',ofertas:i===3?[]:[{id:'OFERTA_ID_OCULTO',nome:'Curso profissional',url,economia:{contribuicaoPorVenda:9876,taxaFechamento:0.33},evidencias:[e]}],entendimento:{papel:'servicos',finalidade:{tipo:'comercial'},proposito:{texto:'Formação profissional'},publicos:i===3?[]:[{tipo:'participante',texto:'Profissionais em formação'}],atuacoes:i===3?[]:[{tipo:'participacao',nome:'Oficinas abertas',url}]}}},
   condicional:{palavras:{candidatos:i===3?[]:Array.from({length:7},(_,n)=>({termo:'Curso profissional '+n,ofertaId:'OFERTA_ID_OCULTO',intencao:'ROTULO_INTENCAO_OCULTO'}))},oportunidades:{planoDeAcao:i===3?[]:Array.from({length:4},(_,n)=>({id:'TAREFA_ID_OCULTO',titulo:'Conferir a formação '+n,acao:'Compare formato e público publicados.',base:'hipotese',paginaAlvo:{url},passos:['Confira o formato publicado.'],entregavel:'Registro de dúvidas.',criterioSucesso:'Conferência com fontes.',valorPorContato:{valor:12345},modeloEntregavel:{campos:[{rotulo:'Formato',valorSugerido:'Aulas ao vivo',origem:'trecho_publicado'}]},evidenciasNegocio:[e]}))}},contextoPublico:{evidencias:[e]},
  }})};await writeFile(avaliacao,JSON.stringify(entrada));return{pasta,avaliacao,saida,entrada};}

test('inclui as quatro organizações com notas vazias, limites de consultas/tarefas e nenhum gabarito ou dado financeiro estruturado',async t=>{
 const f=await fixture(t),antes=hash(await readFile(f.avaliacao)),r=await prepararRevisaoNegocio(f),raw=await readFile(join(f.saida,'revisao.json'),'utf8'),j=JSON.parse(raw);
 assert.equal(r.casos,4);assert.equal(r.consultas,15);assert.equal(r.tarefas,9);assert.equal(j.revisaoHumanaRealizada,false);assert.equal(j.consentimentoTreino.autorizado,false);
 assert.equal(new Set(j.casos.map(c=>c.idRevisao)).size,4);assert.ok(j.casos.every(c=>Object.values(c.parecer).every(v=>v===null)));
 const tarefas=j.casos.flatMap(c=>c.tarefas);assert.equal(j.versao,2);assert.equal(new Set(tarefas.map(t=>t.idRevisao)).size,9);
 assert.ok(tarefas.every(t=>t.idRevisao.startsWith('tarefa-')&&Object.keys(t.parecer).length===5&&Object.values(t.parecer).every(v=>v===null)));
 assert.ok(j.casos.every(c=>c.consultas.length<=5&&c.tarefas.length<=3));assert.equal(j.casos.find(c=>c.dominio==='empresa3.com.br').tarefas.length,0);
 for(const segredo of ['ID_ALVO_OCULTO','OFERTA_ID_OCULTO','TAREFA_ID_OCULTO','GABARITO_OCULTO','ROTULO_INTENCAO_OCULTO','DADO_PRIVADO_OCULTO','contribuicaoPorVenda','valorPorContato','perfilIndicadores','familia'])assert.ok(!raw.includes(segredo),segredo);
 assert.equal(hash(await readFile(f.avaliacao)),antes);assert.equal(j.casos[0].fontes[0].coletadoEm,'2026-11-15T20:00:00Z');
});
test('página local escapa markup público e impede scripts e recursos de rede',async t=>{
 const f=await fixture(t);await prepararRevisaoNegocio(f);const html=await readFile(join(f.saida,'leitura.html'),'utf8');
 assert.ok(html.includes('&lt;script&gt;alert('));assert.ok(!html.includes('<script>'));assert.ok(html.includes("default-src 'none'"));assert.ok(!/<(?:script|iframe|img)\b/i.test(html));
 for(const mostrado of ['Ofertas propostas','Atividades propostas','Públicos propostos','Curso profissional','Oficinas abertas','Profissionais em formação','hipótese da leitura pública','U1 objeto; U2 fonte; U3 ação específica; U4 verificação'])assert.ok(html.includes(mostrado),mostrado);
});
test('credenciais ou valores financeiros em texto são omitidos explicitamente e URLs com query são descartadas',async t=>{
 const f=await fixture(t);f.entrada.resultados[0].rascunho.perfil.resumo='Receita R$ 45678';f.entrada.resultados[0].rascunho.perfil.ofertas[0].url='https://empresa0.com.br/?token=SEGREDO_QUERY';
 f.entrada.resultados[0].condicional.oportunidades.planoDeAcao[0].modeloEntregavel.campos[0].valorSugerido='api_key=SEGREDO_TEXTO';await writeFile(f.avaliacao,JSON.stringify(f.entrada));
 await prepararRevisaoNegocio(f);const raw=await readFile(join(f.saida,'revisao.json'),'utf8');assert.ok(!raw.includes('45678'));assert.ok(!raw.includes('SEGREDO_QUERY'));assert.ok(!raw.includes('SEGREDO_TEXTO'));assert.ok(raw.includes('Trecho omitido'));
});
test('recusa conjunto parcial ou diferente e não sobrescreve pasta existente',async t=>{
 const f=await fixture(t);f.entrada.resultados[0].split='holdout';await writeFile(f.avaliacao,JSON.stringify(f.entrada));await assert.rejects(prepararRevisaoNegocio(f),/quatro organizações de validação/);await assert.rejects(lstat(f.saida),e=>e.code==='ENOENT');
 f.entrada.resultados[0].split='validation';f.entrada.resultados.pop();await writeFile(f.avaliacao,JSON.stringify(f.entrada));await assert.rejects(prepararRevisaoNegocio(f),/quatro organizações/);
 const g=await fixture(t);await prepararRevisaoNegocio(g);const antes=await readFile(join(g.saida,'manifesto.json'));await assert.rejects(prepararRevisaoNegocio(g));assert.deepEqual(await readFile(join(g.saida,'manifesto.json')),antes);
});
test('zero páginas é preservado e quantidade ausente ou inválida continua desconhecida no JSON e HTML',async t=>{
 const f=await fixture(t);delete f.entrada.resultados[0].paginasCapturadas;f.entrada.resultados[1].paginasCapturadas='0';f.entrada.resultados[2].paginasCapturadas=-1;await writeFile(f.avaliacao,JSON.stringify(f.entrada));
 await prepararRevisaoNegocio(f);const j=JSON.parse(await readFile(join(f.saida,'revisao.json'))),html=await readFile(join(f.saida,'leitura.html'),'utf8');
 assert.equal(j.casos.find(c=>c.dominio==='empresa3.com.br').cobertura.paginasCapturadas,0);
 assert.ok(j.casos.filter(c=>c.dominio!=='empresa3.com.br').every(c=>c.cobertura.paginasCapturadas===null));
 assert.ok(html.includes('Páginas capturadas:</strong> 0.'));assert.ok(html.includes('Páginas capturadas:</strong> desconhecida.'));
});
