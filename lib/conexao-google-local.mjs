import {randomBytes,createHash} from 'node:crypto';
import {normalizarSite} from '../src/consulta.mjs';
import {ErroGoogleLocal,interpretarCapturaGoogle} from '../src/google-local.mjs';

const digest=v=>createHash('sha256').update(v).digest('hex');
const objeto=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const falhar=(m,s=400)=>{throw new ErroGoogleLocal(m,s);};
const ordenar=v=>Array.isArray(v)?v.map(ordenar):objeto(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordenar(v[k])])):v;
export const origemExtensaoGoogle=v=>typeof v==='string'&&/^chrome-extension:\/\/[a-p]{32}$/u.test(v)?v:null;

/** Ephemeral upload-only grants. Tokens never enter project state, files or
 * exports. All writes still use the coordinator's revision/idempotency checks. */
export function criarConexoesGoogleLocais({consultarProjeto,registrarCaptura,agora=Date.now}={}){
  if(typeof consultarProjeto!=='function'||typeof registrarCaptura!=='function')throw TypeError('Conexão requer as operações locais do projeto.');
  const sessoes=new Map(),ttl=10*60*1000;
  const limpar=()=>{for(const[k,s]of sessoes)if(s.expira<=agora())sessoes.delete(k);};
  const obter=codigo=>{
    limpar();if(typeof codigo!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(codigo))falhar('Código de conexão inválido ou expirado.',401);
    const s=sessoes.get(digest(codigo));if(!s)falhar('Código de conexão inválido ou expirado.',401);return s;
  };
  const resumo=s=>({dominio:s.dominio,expiraEm:new Date(s.expira).toISOString(),limiteNovasCapturas:20,restantes:20-s.recebidas,permissao:'somente_enviar_capturas'});
  return{
    async criar(entrada){
      if(!objeto(entrada)||Object.keys(entrada).some(k=>!['site','revisao'].includes(k))||!Number.isSafeInteger(entrada.revisao)||entrada.revisao<1)falhar('Informe projeto e revisão antes de conectar a extensão.');
      const dominio=normalizarSite(entrada.site),p=await consultarProjeto(dominio);
      if(p?.dominio!==dominio||p.revisao!==entrada.revisao)falhar('O projeto mudou. Atualize a análise antes de gerar outro código.',409);
      limpar();for(const[k,s]of sessoes)if(s.dominio===dominio)sessoes.delete(k);
      if(sessoes.size>=20)falhar('Há muitas conexões locais temporárias. Aguarde a expiração.',429);
      const codigo=randomBytes(32).toString('base64url'),s={dominio,revisao:p.revisao,expira:agora()+ttl,recebidas:0,capturasNoProjeto:Array.isArray(p.capturasGoogleLocais)?p.capturasGoogleLocais.length:null,recibos:new Map(),ocupado:false};sessoes.set(digest(codigo),s);
      return{codigo,...resumo(s)};
    },
    consultar(codigo){return resumo(obter(codigo));},
    revogar(codigo){obter(codigo);sessoes.delete(digest(codigo));return{revogada:true};},
    async registrar(entrada){
      if(!objeto(entrada)||Object.keys(entrada).some(k=>!['codigo','captura'].includes(k)))falhar('Envie apenas o código e a captura.');
      const s=obter(entrada.codigo);
      if(!objeto(entrada.captura)||Buffer.byteLength(JSON.stringify(entrada.captura))>60000)falhar('A captura deve ser um objeto de até 60.000 bytes.',413);
      const captura=structuredClone(entrada.captura);interpretarCapturaGoogle(captura,{dominio:s.dominio,agora});
      const chave=digest(JSON.stringify(ordenar(captura))),anterior=s.recibos.get(chave);
      if(anterior)return{...anterior,...resumo(s),revisao:s.revisao,capturasNoProjeto:s.capturasNoProjeto,estado:'ja_recebida'};
      if(s.ocupado)falhar('Aguarde o envio anterior desta conexão.',409);
      if(s.recebidas>=20)falhar('O código atingiu o limite de 20 capturas. Gere outro no projeto.',429);
      if(s.recibos.size>=40)falhar('O código atingiu o limite de envios. Gere outro no projeto.',429);
      s.ocupado=true;
      try{
        const p=await consultarProjeto(s.dominio);
        if(p?.dominio!==s.dominio||p.revisao!==s.revisao)falhar('O projeto foi alterado. Atualize a análise e gere outro código.',409);
        if(obter(entrada.codigo)!==s)falhar('Código de conexão inválido ou expirado.',401);
        const novo=await registrarCaptura({site:s.dominio,revisao:s.revisao,captura});
        if(novo?.dominio!==s.dominio||!Number.isSafeInteger(novo.revisao)||novo.revisao<s.revisao)falhar('A gravação não foi confirmada pelo projeto local.',503);
        if(novo.revisao!==s.revisao)s.recebidas++;
        s.revisao=novo.revisao;s.capturasNoProjeto=Array.isArray(novo.capturasGoogleLocais)?novo.capturasGoogleLocais.length:null;
        const recibo={...resumo(s),revisao:novo.revisao,estado:'recebida',capturasNoProjeto:s.capturasNoProjeto};
        s.recibos.set(chave,recibo);return recibo;
      }finally{s.ocupado=false;}
    },
    fechar(){sessoes.clear();},
  };
}
