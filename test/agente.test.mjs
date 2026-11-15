import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {analisarOportunidades} from '../src/agente.mjs';
import {consultarGoogle} from '../src/serpapi.mjs';

const INSTANTE=Date.parse('2026-11-14T15:00:00Z'), HORA=3600_000;
const DATA=new Date(INSTANTE-2000).toISOString(), DOMINIO='cliente.com.br';
const CHAVE='chave_ficticia_apenas_para_testes_1234567890123456789012345678901234';
const hash=v=>createHash('sha256').update(v).digest('hex');
function candidato(termo='Contratar consultoria ambiental',tipo='servico',url='https://cliente.com.br/consultoria') {
  return {termo,tipo,evidencia:{url,campo:'h1',trecho:termo,coletadoEm:DATA,sha256:hash(termo)}};
}
function relatorio(candidatos=[],consultas=[]) {
  return {versao:2,dominio:DOMINIO,candidatos,consultas,descoberta:{limitada:false}};
}
const analisar=(posicoes,diagnostico=null)=>analisarOportunidades({dominio:DOMINIO,posicoes,diagnostico},{agora:()=>INSTANTE});

// Real provider parser, simulated HTTP responses: no live key/network/cost.
async function consulta(termo='Contratar consultoria ambiental',posicao=12,url='https://cliente.com.br/consultoria') {
  const paginas=[];
  const ultima=posicao==null ? 2 : Math.ceil(posicao/10);
  for(let pagina=1;pagina<=ultima;pagina++) {
    const inicio=(pagina-1)*10;
    const p=await consultarGoogle({termo,dominio:DOMINIO,chave:CHAVE,inicio,pagina},{agora:()=>INSTANTE,
      fetch:async endereco=>{
        const u=new URL(endereco);assert.equal(u.origin,'https://serpapi.com');
        if(u.pathname==='/account.json') return Response.json({account_status:'Active',plan_id:'free',plan_name:'Free Plan',
          plan_monthly_price:0,extra_credits:0,searches_per_month:250,plan_searches_left:249,total_searches_left:249,
          this_month_usage:1,account_rate_limit_per_hour:50,this_hour_searches:0,plan_renewal_date:'2026-12-14'});
        assert.equal(u.pathname,'/search.json');
        const next=new URL('https://serpapi.com/search.json');
        for(const[k,v]of Object.entries({engine:'google',q:termo,gl:'br',hl:'pt',google_domain:'google.com.br',device:'desktop',location:'Brazil',start:inicio+10}))next.searchParams.set(k,String(v));
        return Response.json({search_metadata:{id:'fixture_'+hash(termo).slice(0,12)+'_'+pagina,status:'Success',created_at:DATA,processed_at:DATA},
          search_parameters:{engine:'google',q:termo,gl:'br',hl:'pt',google_domain:'google.com.br',device:'desktop',location_requested:'Brazil',location_used:'Brazil',start:inicio},
          search_information:{page_number:pagina,query_displayed:termo,organic_results_state:'Results for exact spelling'},
          organic_results:Array.from({length:10},(_,i)=>({position:i+1,title:'Resultado '+(inicio+i+1),
            link:inicio+i+1===posicao ? url : 'https://concorrente'+(inicio+i+1)+'.com.br/servico'})),
          ...(pagina<ultima?{serpapi_pagination:{current:pagina,next:next.href}}:{}),related_searches:[]});
      }});
    // Same bounded page contract persisted by posicoes-atuais.mjs.
    const nomes=['termo','inicio','pagina','proximoInicio','paginacaoInterrompida','paginacaoComLacuna','limiteAtingido',
      'resultados','coletadoEm','profundidadeObservada','fonte','contexto','sha256','hashEscopo','relacionadas'];
    paginas.push(Object.fromEntries(nomes.map(k=>[k,p[k]])));
  }
  const resultados=paginas.flatMap(p=>p.resultados),alvo=resultados.find(r=>r.url===url);
  return {termo,estado:alvo?'encontrado':'nao_encontrado',posicao:alvo?.posicao??null,
    pagina:alvo?.pagina??null,posicaoNaPagina:alvo?.posicaoNaPagina??null,url:alvo?.url??null,
    paginas,resultados,acima:[],contexto:{...paginas[0].contexto},coletadoEm:DATA,concluida:true};
}
function diagnostico(url='https://cliente.com.br/consultoria') {
  return {versao:1,dominio:DOMINIO,estado:'concluido',coletadoEm:DATA,
    paginas:[{url,status:200,sha256:hash(url),coletadoEm:DATA}],
    verificacoes:[{id:'titulo-pagina',titulo:'Dê um título à página',categoria:'Clareza',estado:'atencao',
      paginasAfetadas:[url],evidencia:{url,trecho:'Nenhum title com texto foi identificado.'},
      orientacao:'Use um título claro, sem prometer posições.',passos:['Defina um título fiel ao conteúdo.']}]};
}

test('sem evidência não cria oportunidades nem métricas comerciais',()=>{
  for(const entrada of [null,{}, {dominio:DOMINIO,posicoes:null,diagnostico:null}]) {
    const r=analisarOportunidades(entrada,{agora:()=>INSTANTE});
    assert.equal(r.estado,'sem_dados');assert.deepEqual(r.oportunidades,[]);assert.deepEqual(r.frentes,[]);
    assert.equal(r.resumo.posicoesAtuais,0);assert.ok(r.limites.some(l=>l.includes('receita')));
  }
});

test('sem chave há investigação de candidatos e melhorias observadas, sem posição inventada',()=>{
  const r=analisar(relatorio([candidato()]),diagnostico());
  assert.equal(r.estado,'parcial');assert.equal(r.oportunidades[0].decisao,'investigar');
  assert.equal(r.oportunidades[0].posicao,null);assert.equal(r.oportunidades[0].marco,null);
  assert.equal(r.melhorias.length,1);assert.equal(r.resumo.investigar,1);
  assert.match(r.oportunidades[0].faltam.join(' '),/Cliques, conversões/);
});

test('leitura válida sem alertas não é confundida com ausência de dados ou certificação',()=>{
  const d=diagnostico();d.verificacoes[0].estado='verificado';
  const r=analisar(null,d);
  assert.equal(r.estado,'parcial');assert.equal(r.melhorias.length,0);assert.equal(r.oportunidades.length,0);
  assert.match(r.limites.join(' '),/Há leitura disponível/);assert.match(r.limites.join(' '),/não certifica/);
});

test('posição12 comercial vira teste prioritário; marca já no topo fica em proteção',async()=>{
  const comercial=candidato(),marca=candidato('Cliente','marca','https://cliente.com.br/');
  const q=await consulta(),qm=await consulta(marca.termo,1,marca.evidencia.url);
  const r=analisar(relatorio([marca,comercial],[qm,q]));
  assert.equal(r.oportunidades[0].termo,comercial.termo);assert.equal(r.oportunidades[0].decisao,'priorizar');
  assert.equal(r.oportunidades[0].posicao,12);assert.match(r.oportunidades[0].marco,/dez primeiros/);
  assert.equal(r.oportunidades[1].decisao,'proteger');assert.equal(r.resumo.posicoesAtuais,2);
  assert.equal(r.oportunidades[0].concorrentes.length,5);
  assert.deepEqual(r.oportunidades[0].evidencias.filter(e=>e.tipo==='google').map(e=>e.fonteId),q.paginas.map(p=>p.fonte.id));
  assert.ok(!Object.hasOwn(r.oportunidades[0],'score'));assert.match(r.oportunidades[0].potencial,/retorno não foi estimado/);
});

test('posição37 mantém posição observada, aponta desenvolvimento e não promete facilidade',async()=>{
  const r=analisar(relatorio([candidato()],[await consulta(undefined,37)]));
  assert.equal(r.oportunidades[0].posicao,37);assert.equal(r.oportunidades[0].decisao,'desenvolver');
  assert.match(r.oportunidades[0].motivo,/dificuldade não foi medida/);
});

test('busca informativa não vira intenção comercial pelo tipo extraído',async()=>{
  const c=candidato('Como contratar consultoria ambiental');
  const r=analisar(relatorio([c],[await consulta(c.termo)]));
  assert.equal(r.oportunidades[0].intencao.tipo,'informativa');assert.equal(r.oportunidades[0].decisao,'investigar');
  assert.equal(r.oportunidades[0].posicao,12);
});

test('ausência em páginas válidas não se transforma em posição101 ou oportunidade comprovada',async()=>{
  const r=analisar(relatorio([candidato()],[await consulta(undefined,null)]));
  assert.equal(r.oportunidades[0].posicao,null);assert.equal(r.oportunidades[0].decisao,'investigar');
  assert.equal(r.oportunidades[0].concorrentes.length,0);assert.match(r.oportunidades[0].motivo,/recorte/);
  assert.equal(r.oportunidades[0].evidencias.filter(e=>e.tipo==='google').length,2);
});

test('captura vencida, futura ou página faltante invalida a cadeia inteira',async t=>{
  const base=await consulta();
  for(const [nome,mudar]of[
    ['expirada',q=>{q.paginas[0].coletadoEm=new Date(INSTANTE-HORA).toISOString();}],
    ['futura',q=>{q.paginas[1].coletadoEm=new Date(INSTANTE+1).toISOString();}],
    ['sem página inicial',q=>{q.paginas.shift();}],
    ['sem páginas',q=>{q.paginas=[];}],
    ['outro contexto',q=>{q.paginas[1].contexto.dispositivo='Celular';}],
    ['resumo com outro contexto',q=>{q.contexto.localidade='São Paulo';}],
    ['hash ausente',q=>{delete q.paginas[0].sha256;}],
    ['conteúdo alterado',q=>{q.paginas[0].resultados[0].titulo='Título alterado';}],
    ['resumo falso',q=>{q.posicao=2;}],
    ['resumo de outra URL',q=>{q.url='https://cliente.com.br/errada';}],
    ['outra consulta',q=>{q.paginas[1].termo='outra busca';}],
  ]) await t.test(nome,()=>{
    const q=structuredClone(base);mudar(q);const o=analisar(relatorio([candidato()],[q])).oportunidades[0];
    assert.equal(o.posicao,null);assert.equal(o.decisao,'investigar');assert.deepEqual(o.concorrentes,[]);
  });
});

test('origem vencida não ganha prioridade mesmo com uma posição atual',async()=>{
  const c=candidato();c.evidencia.coletadoEm=new Date(INSTANTE-24*HORA).toISOString();
  const o=analisar(relatorio([c],[await consulta()])).oportunidades[0];
  assert.equal(o.posicao,12);assert.equal(o.decisao,'investigar');assert.match(o.motivo,/24 horas/);
});

test('busca relacionada sem página da oferta fica em investigação',async()=>{
  const c={termo:'Contratar consultoria ambiental',tipo:'relacionada',origem:'busca_relacionada',
    evidencia:{fonte:'SerpApi',fonteId:'fixture_123',termoOrigem:'Consultoria ambiental',coletadoEm:DATA,sha256:hash('fonte')}};
  const o=analisar(relatorio([c],[await consulta()])).oportunidades[0];
  assert.equal(o.decisao,'investigar');assert.match(o.faltam.join(' '),/ligada a uma página/);
});

test('melhoria só se liga à mesma URL comprovadamente lida',async()=>{
  const q=await consulta();const d=diagnostico('https://cliente.com.br/');
  const r=analisar(relatorio([candidato()],[q]),d);
  assert.equal(r.melhorias.length,1);assert.ok(!r.oportunidades[0].acoes.some(a=>a.base==='observacao'));
  const igual=analisar(relatorio([candidato()],[q]),diagnostico());
  assert.ok(igual.oportunidades[0].acoes.some(a=>a.base==='observacao'&&a.titulo==='Dê um título à página'));
  assert.match(igual.oportunidades[0].acoes.find(a=>a.base==='observacao').descricao,/não demonstra a causa da posição/);
  assert.match(igual.frentes[0].proximoPasso,/^Uso e clareza: Dê um título à página/);
  assert.ok(!r.frentes[0].proximoPasso.includes('Dê um título à página'));
  assert.match(igual.frentes[0].motivo,/observado na posição 12/);
  assert.ok(igual.frentes[0].proximoPasso.length<=300);
});

test('diagnóstico manual, vencido, futuro, indisponível ou de outro domínio não vira defeito observado',()=>{
  for(const modificar of [d=>{d.verificacoes[0].estado='manual';},d=>{d.paginas[0].coletadoEm=new Date(INSTANTE-24*HORA).toISOString();},
    d=>{d.paginas[0].coletadoEm=new Date(INSTANTE+1).toISOString();},d=>{d.paginas=[];},
    d=>{d.dominio='outro.com.br';},d=>{d.verificacoes[0].paginasAfetadas=[];}]) {
    const d=diagnostico();modificar(d);assert.equal(analisar(null,d).melhorias.length,0);
  }
});

test('mesmo domínio não é confundido com sufixo malicioso e subdomínio real mantém sua URL',async()=>{
  const fora=await consulta(undefined,12,'https://cliente.com.br.evil.com/consultoria');
  const a=analisar(relatorio([candidato()],[fora]));assert.equal(a.oportunidades[0].posicao,null);
  const dentro=await consulta(undefined,12,'https://loja.cliente.com.br/consultoria');
  const b=analisar(relatorio([candidato()],[dentro]));assert.equal(b.oportunidades[0].posicao,12);
  assert.equal(b.oportunidades[0].paginaAlvo,'https://loja.cliente.com.br/consultoria');
});

test('links de origem inseguros não aparecem como alvos ou evidências',()=>{
  for(const url of ['javascript:alert(1)','http://127.0.0.1','https://user:secret@cliente.com.br/',
    'https://outro.com.br/','https://cliente.com.br/?token=segredo']) {
    const c=candidato(undefined,undefined,url);const o=analisar(relatorio([c])).oportunidades[0];
    assert.equal(o.paginaAlvo,null);assert.deepEqual(o.evidencias,[]);assert.equal(o.decisao,'investigar');
    assert.ok(!JSON.stringify(o).includes('segredo'));
  }
});

test('deduplicação preserva C++ e C#, recusa consultas ambíguas e não muda a entrada',async()=>{
  const c=candidato(),q=await consulta();
  const dados=relatorio([c,{...c,termo:'  CONTRATAR  CONSULTORIA AMBIENTAL '},candidato('Curso C++'),candidato('Curso C#')],[q,structuredClone(q)]);
  const antes=JSON.stringify(dados),r=analisar(dados);
  assert.equal(r.oportunidades.length,3);assert.equal(r.resumo.posicoesAtuais,0);
  assert.ok(r.oportunidades.some(o=>o.termo==='Curso C++'));assert.ok(r.oportunidades.some(o=>o.termo==='Curso C#'));
  assert.equal(JSON.stringify(dados),antes);assert.deepEqual(r,analisar(dados));
});

test('frentes agrupam pela URL e não contam quantidade de termos como retorno',()=>{
  const r=analisar(relatorio([candidato('Curso C++'),candidato('Curso C#'),candidato('Revisão de carros','servico','https://cliente.com.br/revisao')]));
  assert.equal(r.frentes.length,2);assert.equal(r.frentes[0].termos.length,2);
  assert.match(r.limites.join(' '),/Mais palavras por página não significa maior potencial/);
  assert.match(r.limites.join(' '),/decisões dos outros termos podem diferir/);
  assert.ok(r.frentes.every(f=>f.decisao==='investigar'&&f.motivo.includes(f.titulo)));
  assert.notEqual(r.frentes[0].motivo,r.frentes[1].motivo);
});

test('relatório de outro domínio é ignorado e a quantidade processada permanece limitada',()=>{
  assert.equal(analisar({...relatorio([candidato()]),dominio:'outro.com.br'}).oportunidades.length,0);
  const r=analisar(relatorio(Array.from({length:200},(_,i)=>candidato('Consultoria '+i))));
  assert.equal(r.oportunidades.length,100);assert.equal(r.resumo.termosAnalisados,100);
});
