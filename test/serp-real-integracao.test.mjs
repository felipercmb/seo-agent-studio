import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {criarServidor} from '../server.mjs';
import {consultarGoogle} from '../src/serpapi.mjs';
import {coletar} from '../ia/serp_real/coletar.mjs';
import {preparar} from '../ia/serp_real/preparar.mjs';

// Toda a rede da fonte e dos sites é simulada neste teste.
const CHAVE='chave_ficticia_apenas_para_testes_1234567890123456789012345678901234';
const mapa={'alfa.com.br':'Reparação de violinos','beta.com.br':'Oficina de bicicletas','gama.com.br':'Aulas de pintura'};
const sha=s=>createHash('sha256').update(s).digest('hex');

test('captura simulada percorre servidor, arquivo, hashes e divisões sem expor a chave',async t=>{
  const pasta=await mkdtemp(join(tmpdir(),'serp-integracao-'));
  let app;t.after(async()=>{await app?.fechar();await rm(pasta,{recursive:true,force:true});});
  const coletarSite=async dominio=>{
    const html=`<html lang="pt-BR"><head><title>${mapa[dominio]}</title></head><body><h1>${mapa[dominio]}</h1></body></html>`;
    const data=new Date().toISOString();return {dominio,coletadoEm:data,falhas:[],paginas:[{url:'https://'+dominio+'/',
      html,status:200,coletadoEm:data,sha256:sha(html)}]};
  };
  let busca=0;
  const fetchFonte=async endereco=>{
    const u=new URL(endereco);
    if(u.pathname==='/account.json')return Response.json({account_status:'Active',plan_id:'free',plan_name:'Free Plan',
      plan_monthly_price:0,extra_credits:0,searches_per_month:250,plan_searches_left:249,total_searches_left:249,
      this_month_usage:1,account_rate_limit_per_hour:50,this_hour_searches:0,plan_renewal_date:'2027-12-14'});
    const termo=u.searchParams.get('q'),dominio=Object.keys(mapa).find(d=>mapa[d].toLowerCase()===termo.toLowerCase());
    assert.ok(dominio);const data=new Date(Date.now()-1000).toISOString();busca++;
    return Response.json({search_metadata:{id:'fixture_integracao_'+busca,status:'Success',created_at:data},
      search_parameters:{engine:'google',q:termo,gl:'br',hl:'pt',google_domain:'google.com.br',device:'desktop',
        location_requested:'Brazil',location_used:'Brazil',start:0},
      organic_results:[{position:1,title:'Outro site',link:'https://rival.com.br/'},{position:2,title:'Site',link:'https://'+dominio+'/'}]});
  };
  app=await criarServidor({carregarEnv:false,env:{PORT:'0',DATA_DIR:pasta,SERPAPI_KEY:CHAVE},coletar:coletarSite,
    consultarGoogle:(entrada,opcoes)=>consultarGoogle(entrada,{...opcoes,fetch:fetchFonte}),iaLocal:{disponivel:async()=>false}});
  const plano={versao:1,sites:Object.keys(mapa).map((site,i)=>({site,grupo:site,split:['train','valid','test'][i],lotes:1}))};
  const captura=join(pasta,'captura'),casos=join(pasta,'casos');
  const m=await coletar({plano,saida:captura,pastaDados:pasta,porta:app.porta,pausa:async()=>{}});
  assert.equal(m.interrompida,null);assert.equal(busca,3);
  const gerado=await preparar({coleta:captura,saida:casos,pastaDados:pasta});
  assert.deepEqual(gerado.dominios,{train:1,valid:1,test:1});
  for(const s of ['train','valid','test']) {
    const linhas=(await readFile(join(casos,`casos-${s}.jsonl`),'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(linhas.length,2);assert.equal(linhas[0].esperado.acao,'comparar_concorrentes');
    assert.equal(linhas[0].entrada.evidencias.find(e=>e.id==='s1').posicao,2);
  }
  for(const arquivo of await readdir(captura))if(arquivo.endsWith('.json'))assert.ok(!(await readFile(join(captura,arquivo),'utf8')).includes(CHAVE));
});
