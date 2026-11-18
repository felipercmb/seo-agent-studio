import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {consultarGoogle} from '../src/serpapi.mjs';
import {criarCasos} from '../ia/serp_real/preparar.mjs';

// Resposta inteiramente simulada: testa o formato, não posições reais.
const CHAVE='chave_ficticia_apenas_para_testes_1234567890123456789012345678901234';
const instante=Date.parse('2026-11-15T12:00:00.000Z'),data=new Date(instante-1000).toISOString();
const hash=x=>createHash('sha256').update(x).digest('hex');
async function registro({site='cliente.com.br',grupo='a',split='train',termo='produto de exemplo'}={}) {
  const pagina=await consultarGoogle({termo,dominio:site,chave:CHAVE},{agora:()=>instante,fetch:async url=>{
    const u=new URL(url);
    if(u.pathname==='/account.json')return Response.json({account_status:'Active',plan_id:'free',plan_name:'Free Plan',
      plan_monthly_price:0,extra_credits:0,searches_per_month:250,plan_searches_left:249,total_searches_left:249,
      this_month_usage:1,account_rate_limit_per_hour:50,this_hour_searches:0,plan_renewal_date:'2026-12-14'});
    return Response.json({search_metadata:{id:'captura_ficticia_123456',status:'Success',created_at:data},
      search_parameters:{engine:'google',q:termo,gl:'br',hl:'pt',google_domain:'google.com.br',device:'desktop',location_requested:'Brazil',location_used:'Brazil',start:0},
      organic_results:[{position:1,title:'Concorrente fictício',link:'https://rival.com.br/'},
        {position:2,title:'Cliente fictício',link:'https://'+site+'/'}]});
  }});
  const nomes=['termo','inicio','pagina','proximoInicio','paginacaoInterrompida','paginacaoComLacuna','limiteAtingido',
    'resultados','coletadoEm','profundidadeObservada','fonte','contexto','sha256','hashEscopo','relacionadas'];
  const p=Object.fromEntries(nomes.map(k=>[k,pagina[k]])),alvo=p.resultados[1];
  const q={termo,estado:'encontrado',posicao:2,pagina:1,posicaoNaPagina:2,url:alvo.url,paginas:[p],contexto:p.contexto};
  return {site:{site,grupo,split},sha256Relatorio:hash(site),relatorio:{versao:2,dominio:site,geradoEm:new Date(instante).toISOString(),
    candidatos:[{termo,tipo:'servico',evidencia:{url:'https://'+site+'/',trecho:termo,coletadoEm:data,sha256:hash(termo)}}],consultas:[q]}};
}

test('reproduz fonte e concorrente apenas quando a cadeia confere',async()=>{
  const r=await registro(),saida=criarCasos([r]);assert.equal(saida.casos.length,2);
  assert.ok(saida.casos.every(c=>c.esperado.acao==='comparar_concorrentes'));
  const s=saida.casos[0].entrada.evidencias.find(e=>e.id==='s1');
  assert.equal(s.posicao,2);assert.equal(s.concorrentes[0].posicao,1);assert.equal(s.fontes_serp[0].sha256,r.relatorio.consultas[0].paginas[0].sha256);
  const adulterado=structuredClone(r);adulterado.relatorio.consultas[0].paginas[0].resultados[0].titulo='alterado';
  assert.equal(criarCasos([adulterado]).casos.length,0);
  const expirado=structuredClone(r);expirado.relatorio.geradoEm='2026-11-15T14:00:00.000Z';
  assert.equal(criarCasos([expirado]).casos.length,0);
});

test('descarta consultas repetidas em divisões diferentes',async()=>{
  const a=await registro(),b=await registro({site:'cliente.org.br',grupo:'b',split:'test'});
  const resultado=criarCasos([a,b]);assert.equal(resultado.casos.length,0);assert.equal(resultado.descartes.cruzam_divisoes,2);
});
