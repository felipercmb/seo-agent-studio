import{readFile,writeFile}from'node:fs/promises';import{resolve}from'node:path';
const rodada='data/experimentos-modulares/rodada-treino-negocio-7h-20261116-031117',p=rodada+'/dados/pools-v2/';
const escolhas={
 'brq.com':['fonte_04b90bf004f812ca91fa','fonte_03defbd872ea05f88710','fonte_82490e7a936bbd87faac','fonte_c9380d67590ec39d4ec7','fonte_4de3b18041d6554b5bb9'],
 'buser.com.br':['fonte_d8ce25241a4d92b1eb45','fonte_ca08b28523a0e25948de','fonte_e81a10d2609d86c47a03','fonte_9581bec0ee38cfc0bb67'],
 'clickbus.com.br':['fonte_b33984d2330f4dd1c756','fonte_73905e327139607e2703','fonte_6faeead35f355879d5c5'],
 'maryhelp.com.br':['fonte_19af9bf4c5f55b65af9a','fonte_9fdd74a9137c91063054','fonte_af48061ef89a5f7ff3a4','fonte_b969d80c01048d47be4b','fonte_46906bf87f7d62c47c41','fonte_48cd418cbe708a41f7e0'],
 'contabilizei.com.br':['fonte_661320ceb275c313b1dc','fonte_baa4519fac9bdad482d1','fonte_55025ba83ea300af64b6'],
 'omie.com.br':['fonte_f12af03f7c9870675bc3','fonte_8dcb36eff8ada06224c7','fonte_c6ba411dc573e0677d84','fonte_73498328af33629b87de','fonte_3a72fe38cb74e988fd7e','fonte_edca0f1ff301f5056697'],
 'bluesoft.com.br':['fonte_1e2651bf0cfef8b3cf5f','fonte_23829d55f237ec10fa86','fonte_45cdf579d29278fb9973'],
 'nibo.com.br':['fonte_a50758642ea638ce53a2','fonte_6d4d48c87a0e11a47c41','fonte_d06fa07c31708f5ef431','fonte_db422e7c4dfe3dc48514','fonte_9648818ff60786d255c9','fonte_55aca768ea71f68158be'],
 'agendor.com.br':['fonte_2dd0afe8bb44be2c7f2f','fonte_32154fed7b12ce2f8a40','fonte_ec00dddfd69efdabc56d','fonte_5409ed6fc749adccdca5'],
 'lojaintegrada.com.br':['fonte_711661b5409ec79b3322','fonte_7d3a08d9bcdbd1c0d3fc','fonte_a76322d79b1803b25607'],
 'clicksign.com':['fonte_01d24bac4f13dd58c2fd','fonte_e1f51f27480558a6264c','fonte_b0698aa712b016489079'],
 'zapier.com':['fonte_4740e595b1eae7721b5e','fonte_e15787ab5dff82f7bb93','fonte_494e3f565e1ecb6aada3','fonte_8b0af7a9bcf6a8ee1936'],
};
const casos=[];for(const[dominio,ids]of Object.entries(escolhas)){const id='real-'+dominio.replaceAll('.','-')+'-v1',d=JSON.parse(await readFile(p+id+'.json')),fontes=ids.map((fonteId,i)=>{const f=d.pool.fontes.find(f=>f.id===fonteId);if(!f)throw Error(dominio+': fonte ausente '+fonteId);if(f.texto.length>600)throw Error('Texto extenso.');return{...f,id:id+'-F'+String(i+1).padStart(2,'0'),idOriginal:fonteId};});
  casos.push({id,dominio,grupoEmpresarial:dominio,split:'desenvolvimento',captura:d.captura,fontes,origemSelecao:{natureza:'oracle_de_desenvolvimento',revisorAgente:'rodada_valor_fontes',pool:resolve(p+id+'.json'),limite:'Seleção manual de fontes conhecidas; não recuperação end-to-end nem rótulo de verdade.'}});
}
const o={versao:1,geradoEm:new Date().toISOString(),natureza:'Segundo lote de fontes propostas para revisão de entendimento e recomendações, não treino liberado.',casos};await writeFile(rodada+'/dados/fontes-entendimento-lote2-propostas.json',JSON.stringify(o,null,2),{flag:'wx'});console.log(JSON.stringify({casos:casos.length,fontes:casos.reduce((s,c)=>s+c.fontes.length,0),arquivo:rodada+'/dados/fontes-entendimento-lote2-propostas.json'}));
