import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {coletarSite} from '../src/coleta.mjs';
import {fetchPublico} from '../lib/rede-publica.mjs';

const hash = v => createHash('sha256').update(v).digest('hex');

export async function coletarEscopo(escopo, destino) {
  if (escopo.versao !== 1 || !Array.isArray(escopo.sites) || escopo.sites.length > 8 ||
      new Set(escopo.sites.map(s => s.dominio)).size !== escopo.sites.length) throw new Error('Escopo inválido');
  await mkdir(destino,{recursive:true,mode:0o700});
  const fila = [...escopo.sites], resultados = [];
  async function consumir() {
    while (fila.length) {
      const site = fila.shift(), inicio = new Date().toISOString(), acessos = [];
      const pasta = join(destino,site.split === 'development' ? 'desenvolvimento' : site.split,site.id);
      await mkdir(pasta,{recursive:true,mode:0o700});
      let captura, erro = null;
      try {
        captura = await coletarSite(site.dominio,{objetivo:'descoberta',limiteRequisicoes:24,tempoTotalMs:20000,
          fetch:async (url,init) => {
            const inicioRequisicao=Date.now();
            try {
              const resposta=await fetchPublico(url,init);
              acessos.push({url:String(url),status:resposta.status,tipo:resposta.headers.get('content-type'),
                iniciadoEm:new Date(inicioRequisicao).toISOString(),tempoAteCabecalhosMs:Date.now()-inicioRequisicao});
              return resposta;
            } catch (falha) {
              acessos.push({url:String(url),estado:'falhou',iniciadoEm:new Date(inicioRequisicao).toISOString()});
              throw falha;
            }
          }});
      } catch (falha) {
        erro=String(falha.message);
        captura={dominio:site.dominio,coletadoEm:inicio,paginas:[],falhas:[{url:`https://${site.dominio}/`,motivo:erro}]};
      }
      const bytes=JSON.stringify(captura,null,2);
      await writeFile(join(pasta,'captura.json'),bytes,{flag:'wx',mode:0o600});
      const registro={...site,inicio,fim:new Date().toISOString(),natureza:'captura pública real sem autenticação',
        paginasLidas:captura.paginas.length,cobertura:captura.cobertura??null,falhas:captura.falhas,erro,
        arquivo:'captura.json',sha256:hash(bytes),acessos,
        paginas:captura.paginas.map(p => ({url:p.url,coletadoEm:p.coletadoEm,sha256:p.sha256,
          sha256HtmlLocal:hash(p.html),status:p.status,bytes:Buffer.byteLength(p.html)}))};
      await writeFile(join(pasta,'registro.json'),JSON.stringify(registro,null,2),{flag:'wx',mode:0o600});
      resultados.push(registro);
      console.log(JSON.stringify({id:site.id,split:site.split,paginas:registro.paginasLidas,falhas:registro.falhas.length}));
    }
  }
  await Promise.all([consumir(),consumir()]);
  resultados.sort((a,b) => a.id.localeCompare(b.id));
  const manifest={versao:1,geradoEm:new Date().toISOString(),dominiosSolicitados:escopo.sites.length,
    dominiosComLeitura:resultados.filter(r => r.paginasLidas>0).length,
    totalPaginas:resultados.reduce((n,r) => n+r.paginasLidas,0),registros:resultados,
    limites:['Falhas e bloqueios ficam no denominador; não há substituição automática de sites.',
      'Coletor respeita robots, HTTPS, rede pública e limites existentes. Não houve login, Google SERP ou API paga.']};
  await writeFile(join(destino,'manifesto-coleta-reservado.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args=process.argv.slice(2);
  if (args.length!==2) throw new Error('Uso: node scripts/coletar-capturas-reais.mjs ESCOPO DESTINO_NOVO');
  const escopo=JSON.parse(await readFile(resolve(args[0]),'utf8'));
  await coletarEscopo(escopo,resolve(args[1]));
}
