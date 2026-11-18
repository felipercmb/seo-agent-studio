import {mkdir,lstat,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {interpretarCapturaGoogle,ErroGoogleLocal} from '../src/google-local.mjs';
import {normalizarSite} from '../src/consulta.mjs';
import {destinoGooglePublicado,redirecionamentoGoogleSemDestino} from '../src/google-identidade.mjs';
import {parseFragment,serialize} from 'parse5';

const ordenar=v=>Array.isArray(v)?v.map(ordenar):v!==null&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordenar(v[k])])):v;
const json=v=>Buffer.from(JSON.stringify(ordenar(v))+'\n');
const digest=b=>createHash('sha256').update(b).digest('hex');
const ID=/^gl1_[a-f0-9]{64}$/u;
function minimizarLinksGoogle(captura){
  const fragmento=parseFragment(captura.html),pilha=[fragmento];let mudou=false;
  while(pilha.length){
    const n=pilha.pop();pilha.push(...(n.childNodes||[]));if(n.tagName!=='a')continue;
    const href=n.attrs?.find(a=>a.name==='href');if(!href)continue;
    try{
      const u=new URL(href.value,captura.url);
      if(!['google.com','www.google.com','google.com.br','www.google.com.br'].includes(u.hostname))continue;
      if(u.username||u.password){href.value='';mudou=true;continue;}
      if(['/url','/goto'].includes(u.pathname)&&!destinoGooglePublicado(href.value,captura.url)&&!redirecionamentoGoogleSemDestino(href.value,captura.url)){href.value='';mudou=true;continue;}
      const permitidos=u.pathname==='/url'||u.pathname==='/goto'&&destinoGooglePublicado(href.value,captura.url)?['q','url']:u.pathname==='/search'?['q','udm','start','hl','gl','pws','uule']:[];
      let neste=false;for(const k of [...u.searchParams.keys()])if(!permitidos.includes(k)){u.searchParams.delete(k);neste=true;}
      if(neste){href.value=u.href;mudou=true;}
    }catch{/* Link inválido será descartado na interpretação. */}
  }
  return{html:mudou?serialize(fragmento):captura.html,mudou};
}
async function lerRegular(p){const st=await lstat(p);if(!st.isFile()||st.isSymbolicLink()||st.size>65536)throw new ErroGoogleLocal('Artefato Google local inválido.',409);return readFile(p);}
export function criarGoogleLocal({dataDir,agora=Date.now}={}){
  if(typeof dataDir!=='string'||!dataDir.trim())throw new ErroGoogleLocal('Diretório de capturas locais inválido.');
  const pasta=join(resolve(dataDir),'google-local','capturas');
  const diretorio=async()=>{await mkdir(pasta,{recursive:true,mode:0o700});const s=await lstat(pasta);if(!s.isDirectory()||s.isSymbolicLink())throw new ErroGoogleLocal('As capturas precisam de um diretório local regular.',503);};
  return{
    async registrar({dominio,captura}){
      const d=normalizarSite(dominio),recebida=interpretarCapturaGoogle(captura,{dominio:d,agora});
      const limpa=minimizarLinksGoogle(captura),fonte={...captura,url:recebida.urlConsulta,html:limpa.html};
      const resultado=interpretarCapturaGoogle(fonte,{dominio:d,agora});
      const minimizacao={versao:1,linksGoogleNormalizados:limpa.mudou,sha256TrechoRecebido:recebida.sha256Trecho};
      const b=json({versao:1,dominio:d,captura:fonte,minimizacao}),capturaId='gl1_'+digest(b);
      if(b.length>65536)throw new ErroGoogleLocal('A captura excedeu o limite do arquivo local.',413);
      await diretorio();const destino=join(pasta,capturaId+'.json');
      try{await writeFile(destino,b,{flag:'wx',mode:0o600});}
      catch(e){if(e.code!=='EEXIST')throw e;const salvo=await lerRegular(destino);if(!salvo.equals(b))throw new ErroGoogleLocal('O artefato existente diverge da captura.',409);}
      return{capturaId,...resultado,minimizacao};
    },
    async ler({dominio,capturaId}){
      const d=normalizarSite(dominio);if(typeof capturaId!=='string'||!ID.test(capturaId))throw new ErroGoogleLocal('Identificador de captura inválido.');
      const b=await lerRegular(join(pasta,capturaId+'.json'));
      if('gl1_'+digest(b)!==capturaId)throw new ErroGoogleLocal('A captura Google salva foi alterada.',409);
      const envelope=JSON.parse(b);if(envelope.versao!==1||envelope.dominio!==d)throw new ErroGoogleLocal('Captura não encontrada para este site.',404);
      return{capturaId,...interpretarCapturaGoogle(envelope.captura,{dominio:d,agora}),...(envelope.minimizacao?{minimizacao:envelope.minimizacao}:{})};
    },
  };
}
