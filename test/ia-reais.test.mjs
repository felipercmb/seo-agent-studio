import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {analisarPaginas} from '../src/analise.mjs';
import {analisarOportunidades} from '../src/agente.mjs';
import {prepararEntradasIA} from '../src/entrada-ia.mjs';
import {coletarEmpresas, validarEscopo} from '../ia/reais/coletar.mjs';
import {reanalisar} from '../ia/reais/reanalizar.mjs';

const agora = '2026-11-14T20:00:00.000Z';
const pagina = html => ({url:'https://empresa.example/', html, coletadoEm:agora,
  bytes:Buffer.byteLength(html), sha256:createHash('sha256').update(html).digest('hex'), status:200});
const analisar = html => analisarPaginas({dominio:'empresa.example', coletadoEm:agora, paginas:[pagina(html)], falhas:[]});
const obter = rel => rel.verificacoes.find(v=>v.id==='diretiva-noindex-html');

test('noindex no head gera verificação da intenção sem declarar defeito ou posição', () => {
  for (const meta of ['<meta name="robots" content="NOINDEX, nofollow">',
    '<meta name="googlebot" content="none">']) {
    const rel = analisar('<html><head>'+meta+'<title>Empresa</title></head><body><h1>Oferta</h1></body></html>');
    const v = obter(rel);
    assert.equal(v.estado,'atencao');
    assert.match(v.evidencia.trecho,/intenção de publicação não é conhecida/i);
    assert.match(v.orientacao,/antes de propor alterações/i);
    assert.equal(v.evidencia.url,'https://empresa.example/');
  }
});

test('texto, script e diretiva de outro robô não viram noindex do Google', () => {
  const rel = analisar('<html><head><meta name="bingbot" content="noindex"><title>Oferta</title>'+
    '<script>"<meta name=robots content=noindex>"</script></head><body><h1>noindex</h1>'+
    '<template><meta name="robots" content="noindex"></template></body></html>');
  assert.equal(obter(rel).estado,'verificado');
  assert.match(obter(rel).evidencia.trecho,/não confirma indexação/i);
});

test('meta robots no corpo também é observada sem afirmar que o Google já a processou', () => {
  const rel=analisar('<html><head><title>Oferta</title></head><body><meta name="googlebot" content="noindex"><h1>Oferta</h1></body></html>');
  const v=obter(rel);assert.equal(v.estado,'atencao');
  assert.match(v.evidencia.trecho,/HTML inicial/);
  assert.match(v.orientacao,/confirme/i);
  assert.doesNotMatch(v.evidencia.trecho,/não está indexada|não aparece no Google/i);
});

test('none ou noindex usados como valor de outra diretiva não viram bloqueio de indexação', () => {
  for(const content of ['max-image-preview: none, nofollow','max-snippet: noindex']) {
    const rel=analisar('<html><head><meta name="robots" content="'+content+'"><title>Oferta</title></head><body><h1>Oferta</h1></body></html>');
    assert.equal(obter(rel).estado,'verificado');
  }
  const rel=analisar('<html><head><meta name="robots" content="max-image-preview: none, noindex"><title>Oferta</title></head><body><h1>Oferta</h1></body></html>');
  assert.equal(obter(rel).estado,'atencao');
});

test('noindex HTTP tem evidência própria e ausência de cabeçalho histórico não vira resultado negativo', () => {
  const html='<html><head><title>Oferta</title></head><body><h1>Oferta</h1></body></html>';
  const valor='googlebot: noindex',sha256=createHash('sha256').update(valor).digest('hex');
  const p={...pagina(html),cabecalhoRobots:{estado:'noindex',escopo:'googlebot',valor,sha256}};
  const rel=analisarPaginas({dominio:'empresa.example',coletadoEm:agora,paginas:[p],falhas:[]});
  const v=rel.verificacoes.find(x=>x.id==='diretiva-noindex-http');
  assert.equal(v.estado,'atencao');assert.equal(v.evidencia.sha256Cabecalho,sha256);
  assert.notEqual(v.evidencia.sha256Cabecalho,p.sha256);assert.equal(v.evidencia.valorCabecalho,valor);
  assert.equal(rel.paginas[0].cabecalhoRobots.sha256,sha256);
  const agente=analisarOportunidades({dominio:'empresa.example',diagnostico:rel},{agora:()=>Date.parse(agora)});
  const entradas=prepararEntradasIA(agente,{agora:()=>Date.parse(agora)}).entradas;
  const e=entradas.flatMap(x=>x.evidencias).find(x=>x.verificacao?.tipo==='http_robots_noindex');
  assert.equal(e?.sha256_cabecalho,sha256);assert.equal(e?.valor_cabecalho,valor);
  assert.match(entradas.find(x=>x.evidencias.includes(e)).objetivo,/HTTP/);
  const antigo=analisar(html).verificacoes.find(x=>x.id==='diretiva-noindex-http');
  assert.equal(antigo.estado,'indisponivel');assert.match(antigo.evidencia.trecho,/não confirma indexação/i);
  p.cabecalhoRobots.sha256='b'.repeat(64);
  const adulterado=analisarPaginas({dominio:'empresa.example',coletadoEm:agora,paginas:[p],falhas:[]});
  assert.equal(adulterado.verificacoes.find(x=>x.id==='diretiva-noindex-http').estado,'indisponivel');
});

test('resultado negativo do cabeçalho é conferido e não aceita metadados adulterados', () => {
  const html='<html><head><title>Oferta</title></head><body><h1>Oferta</h1></body></html>';
  const valor='nofollow, max-image-preview: none';
  const p={...pagina(html),cabecalhoRobots:{estado:'sem_noindex',valor,sha256:createHash('sha256').update(valor).digest('hex')}};
  const verificar=()=>analisarPaginas({dominio:'empresa.example',coletadoEm:agora,paginas:[p],falhas:[]})
    .verificacoes.find(x=>x.id==='diretiva-noindex-http').estado;
  assert.equal(verificar(),'verificado');
  p.cabecalhoRobots.valor='noindex';assert.equal(verificar(),'indisponivel');
  p.cabecalhoRobots={estado:'sem_noindex'};assert.equal(verificar(),'indisponivel');
});

test('diretiva observada chega à IA com URL e hash sem inventar intenção do proprietário', () => {
  const html = '<html><head><meta name="robots" content="noindex"><title>Oferta</title></head><body><h1>Oferta</h1></body></html>';
  const diagnostico=analisar(html), rel=analisarOportunidades({dominio:'empresa.example', diagnostico}, {agora:()=>Date.parse(agora)});
  const entradas=prepararEntradasIA(rel,{agora:()=>Date.parse(agora)}).entradas;
  const e=entradas.flatMap(x=>x.evidencias).find(x=>x.verificacao?.tipo==='meta_robots_noindex');
  assert.equal(e.pagina,'https://empresa.example/');
  assert.equal(e.sha256_pagina,pagina(html).sha256);
  assert.equal(e.verificacao.intencao,'desconhecida');
  assert.match(entradas.find(x=>x.evidencias.includes(e)).objetivo,/diretiva/);
});

test('fonte ausente é preservada como motivo, não como posição zero', () => {
  const html='<html><head><title>Oferta</title></head><body><h1>Oferta</h1></body></html>';
  const candidato={termo:'Oferta da empresa',tipo:'servico',evidencia:{url:'https://empresa.example/',
    trecho:'Oferta da empresa',coletadoEm:agora,sha256:pagina(html).sha256}};
  const posicoes={versao:2,dominio:'empresa.example',estado:'fonte_nao_configurada',candidatos:[candidato],
    consultas:[],descoberta:{paginasLidas:1,coletadoEm:agora}};
  const rel=analisarOportunidades({dominio:'empresa.example',posicoes},{agora:()=>Date.parse(agora)});
  const e=prepararEntradasIA(rel,{agora:()=>Date.parse(agora)}).entradas[0].evidencias.find(x=>x.tipo==='serp');
  assert.equal(e.estado_fonte,'nao_configurada');assert.equal(e.posicao,null);assert.equal(e.atual,false);
  assert.match(e.descricao,/não está configurada/);
});

test('coleta de pesquisa mantém HTML local, hash e separação de domínios sem consultar SERP', async () => {
  const tmp=await mkdtemp(join(tmpdir(),'seo-reais-'));
  try {
    const escopo={versao:1,sites:[{site:'empresa.example',split:'train'},{site:'outra.example',split:'test'}]};
    assert.throws(()=>validarEscopo({versao:1,sites:[...escopo.sites,{site:'empresa.example',split:'test'}]}));
    const coletar=async dominio=>({dominio,coletadoEm:agora,paginas:[{...pagina('<html><head><title>Oferta</title></head><body><h1>Oferta</h1></body></html>'),url:'https://'+dominio+'/'}],falhas:[]});
    const destino=join(tmp,'coleta'), m=await coletarEmpresas(escopo,destino,{coletar,fetchPublico:()=>{throw new Error('não deveria chamar rede');}});
    assert.deepEqual(m.sites.map(x=>x.split),['train','test']);
    const registro=JSON.parse(await readFile(join(destino,'site-01','registro.json'),'utf8'));
    assert.equal(registro.posicoesGoogle,'nao_consultadas');
    const html=await readFile(join(destino,'site-01','pagina-01.html'));
    assert.equal(registro.arquivos[0].sha256_utf8_local,createHash('sha256').update(html).digest('hex'));
    if(process.platform!=='win32') assert.equal((await stat(join(destino,'site-01','pagina-01.html'))).mode & 0o777,0o600);
    await assert.rejects(coletarEmpresas(escopo,destino,{coletar}));
  } finally {await rm(tmp,{recursive:true,force:true});}
});

test('registro local preserva cabeçalho de indexação e permite reanálise sem rede',async()=>{
  const tmp=await mkdtemp(join(tmpdir(),'seo-http-'));
  try{
    const valor='googlebot: noindex',cabecalhoRobots={estado:'noindex',escopo:'googlebot',valor,sha256:createHash('sha256').update(valor).digest('hex')};
    const html='<html><head><title>Oferta</title></head><body><h1>Oferta</h1></body></html>';
    const coletar=async dominio=>({dominio,coletadoEm:agora,paginas:[{...pagina(html),url:'https://'+dominio+'/',cabecalhoRobots}],falhas:[]});
    const destino=join(tmp,'coleta');await coletarEmpresas({versao:1,sites:[{site:'empresa.example',split:'test'}]},destino,{coletar,fetchPublico:()=>{throw Error('rede');}});
    const revisao=await reanalisar(destino),v=revisao.sites[0].diagnostico.verificacoes.find(x=>x.id==='diretiva-noindex-http');
    assert.equal(v.estado,'atencao');assert.equal(v.evidencia.sha256Cabecalho,cabecalhoRobots.sha256);
  }finally{await rm(tmp,{recursive:true,force:true});}
});
