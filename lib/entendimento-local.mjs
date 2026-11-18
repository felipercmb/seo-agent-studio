import {spawn} from 'node:child_process';
import {access,readFile,writeFile,mkdir,lstat,readdir,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {normalizarSite} from '../src/consulta.mjs';
import {ErroProjeto} from '../src/modulos/repositorio.mjs';
import {publicarProposicoes,conferirProjecaoProposicoes} from './proposicoes-publicas.mjs';
import {selecionarCartoesDeModalidades} from '../src/modulos/comparar-modalidades.mjs';

const RAIZ=fileURLToPath(new URL('../',import.meta.url));
const PYTHON=join(RAIZ,'.venv-ia/bin/python');
const SCRIPT=join(RAIZ,'ia/negocio/jornadas/executar.py');
const MODELO=join(RAIZ,'data/ia/negocio/modelos/qwen35-4b-4bit-sem-pensamento');
const MOTORES={jornadas:{script:SCRIPT,versao:2,modeloBase:'qwen35-4b',pasta:MODELO,pesos:['model.safetensors']},
  proposicoes:{script:join(RAIZ,'ia/negocio/proposicoes/executar.py'),versao:3,modeloBase:'qwen35-9b',pasta:join(RAIZ,'data/ia/negocio/modelos/qwen35-9b-4bit'),pesos:['model.safetensors.index.json','model-00001-of-00002.safetensors','model-00002-of-00002.safetensors']}};
const MAX_SNAPSHOT=12*1024*1024,MAX_ENTRADA=1024*1024,MAX_SAIDA=1024*1024,MAX_STDERR=256*1024;
const OBJ=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const SHA=x=>createHash('sha256').update(x).digest('hex');
const json=x=>Buffer.from(JSON.stringify(x));
const ordenar=x=>Array.isArray(x)?x.map(ordenar):OBJ(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordenar(x[k])])):x;
const digestPython=x=>SHA(json(ordenar(x)));
const clonar=x=>structuredClone(x);
const falhar=(mensagem,status=400)=>{throw new ErroProjeto(mensagem,status);};
const CAP=/^cap_[a-f0-9]{64}$/,JOB=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CODIGOS=new Set(['resposta_invalida','persistencia','servidor_encerrado','nao_iniciada','saida_excedida','entrada_interrompida','processo_indisponivel','processo_falhou','tempo_excedido','execucao_sem_continuidade']);
let ATIVO=null;
const ESCRITAS=new Map();

function campos(x,chaves,nome){if(!OBJ(x)||Object.keys(x).some(k=>!chaves.includes(k)))falhar(`${nome} inválido.`);}
function dominio(x){try{return normalizarSite(x);}catch{falhar('Domínio inválido.');}}
function texto(x,max,nome){if(typeof x!=='string'||!x.trim()||x.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(x))falhar(`${nome} inválido.`);return x;}
function data(x){if(typeof x!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x)||!Number.isFinite(Date.parse(x))||new Date(x).toISOString().slice(0,19)!==x.slice(0,19)||Date.parse(x)>Date.now())falhar('Data da captura inválida.');return x;}
function validarBase(b,d){
  campos(b,['versao','dominio','fontes'],'Base');
  if(b.versao!==1||b.dominio!==d||!Array.isArray(b.fontes)||b.fontes.length>16)falhar('Base incompatível com o domínio.');
  const ids=new Set(),modos=new Set();
  for(const f of b.fontes){
    campos(f,['id','texto','tipo','contexto'],'Fonte');
    if(!/^s\d{2}$/.test(f.id)||ids.has(f.id)||!['declaracao','descricao','conteudo','interface'].includes(f.tipo))falhar('Fonte inválida ou repetida.');
    ids.add(f.id);texto(f.texto,600,'Texto de fonte');modos.add(Object.hasOwn(f,'contexto'));
    if(f.contexto===undefined)continue;
    const c=f.contexto;
    campos(c,['paginaId','url','tituloPagina','titulos','campo','coletadoEm','sha256','recortado','classePagina'],'Contexto da fonte');
    if(typeof c.url!=='string'||c.url.length>2048)falhar('URL da fonte inválida.');
    let u;try{u=new URL(c.url);}catch{falhar('URL da fonte inválida.');}
    if(u.protocol!=='https:'||![d,'www.'+d].includes(u.hostname)||u.username||u.password||u.port||u.search||u.hash||/[?#\\\s]/u.test(c.url))falhar('URL da fonte fora do domínio.');
    if(!/^pag_[a-f0-9]{20}$/.test(c.paginaId)||!/^[a-f0-9]{64}$/.test(c.sha256)||typeof c.recortado!=='boolean'||!['editorial','politica','institucional','nao_determinada'].includes(c.classePagina))falhar('Proveniência da fonte inválida.');
    if(c.tituloPagina!==null)texto(c.tituloPagina,240,'Título da página');texto(c.campo,120,'Campo da fonte');data(c.coletadoEm);
    if(!Array.isArray(c.titulos)||c.titulos.length>6)falhar('Hierarquia da página inválida.');
    let nivel=0;for(const h of c.titulos){campos(h,['nivel','texto'],'Cabeçalho');if(!Number.isInteger(h.nivel)||h.nivel<=nivel||h.nivel>6)falhar('Hierarquia da página inválida.');texto(h.texto,240,'Cabeçalho');nivel=h.nivel;}
  }
  if(modos.size>1)falhar('Fontes com contextos incompatíveis.');
  if(json({base:b,maxOfertas:1}).length>MAX_ENTRADA)falhar('As fontes excedem o limite de entrada local.',413);
}
function recuperacaoPublica(r){
  if(!OBJ(r))return null;
  const saida={};for(const k of ['versao','maxFontes','maxCaracteres','caracteresComContexto','fontesNoPool','candidatosElegiveis','fontesRetidas','paginasRetidas'])
    if(Number.isSafeInteger(r[k])&&r[k]>=0)saida[k]=r[k];
  if(typeof r.limitada==='boolean')saida.limitada=r.limitada;
  if(typeof r.orcamentoContado==='string'&&r.orcamentoContado.length<=240&&!/[\\]|(?:\/Users\/|\/home\/|file:)/.test(r.orcamentoContado))saida.orcamentoContado=r.orcamentoContado;
  if(Array.isArray(r.limites))saida.limites=r.limites.filter(x=>typeof x==='string'&&x.length<=600&&!/[\\]|(?:\/Users\/|\/home\/|file:)/.test(x)).slice(0,16);
  return saida;
}
function reservaDaPreparacao(preparacao,d){
  if(preparacao.pool?.fontes===undefined)return [];
  const fs=preparacao.pool.fontes;
  if(!Array.isArray(fs)||fs.length>640)falhar('O conjunto privado de fontes excede o limite local.',413);
  const ids=new Set();
  return fs.map(f=>{
    if(!OBJ(f))falhar('Fonte de reserva inválida.');texto(f.id,128,'Identificador de reserva');if(ids.has(f.id))falhar('Fontes de reserva repetidas.');ids.add(f.id);
    const fonte={id:f.id,texto:f.texto,tipo:f.tipo,...(f.contexto!==undefined?{contexto:f.contexto}:{})};
    validarBase({versao:1,dominio:d,fontes:[{...fonte,id:'s01'}]},d);return clonar(fonte);
  });
}
async function diretorio(p){await mkdir(p,{recursive:true,mode:0o700});const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink())falhar('O diretório de evidências deve ser local e regular.',503);}
async function ler(p,max=MAX_SNAPSHOT){const s=await lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>max)falhar('Artefato local inválido ou acima do limite.',503);const b=await readFile(p);if(b.length>max)falhar('Artefato local acima do limite.',503);return b;}
function decodificar(b){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));}
async function novoArquivo(p,b){
  // Publica um arquivo completo com criação exclusiva do nome. O link atômico
  // temporário evita overwrite em uma corrida; removido o temporário, há uma
  // única entrada para o inode, sem aliases persistentes.
  const existente=await ler(p,Math.max(MAX_SNAPSHOT,b.length)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(existente){if(!existente.equals(b))falhar('Um artefato imutável já existe com conteúdo diferente.',409);return;}
  const temp=p+'.parcial-'+randomUUID();
  await writeFile(temp,b,{flag:'wx',mode:0o600});
  try{
    try{await link(temp,p);}catch(e){if(e.code!=='EEXIST')throw e;const atual=await ler(p,Math.max(MAX_SNAPSHOT,b.length));if(!atual.equals(b))falhar('Um artefato imutável já existe com conteúdo diferente.',409);}
    await unlink(temp);
  }catch(e){await unlink(temp).catch(()=>{});throw e;}
}
async function unicaEscrita(p,b){
  const anterior=ESCRITAS.get(p);if(anterior){await anterior;const salvo=await ler(p);if(!salvo.equals(b))falhar('Captura imutável divergente.',409);return;}
  const promessa=novoArquivo(p,b);ESCRITAS.set(p,promessa);try{await promessa;}finally{if(ESCRITAS.get(p)===promessa)ESCRITAS.delete(p);}
}
async function existe(p){try{return(await lstat(p)).isFile();}catch{return false;}}
async function instalacaoPresente(motor=MOTORES.jornadas){
  if(process.platform!=='darwin'||process.arch!=='arm64')return false;
  try{
    await access(PYTHON,constants.X_OK);
    for(const p of [motor.script,join(RAIZ,'.venv-ia/pyvenv.cfg'),...['proveniencia-local.json','config.json','tokenizer.json','chat_template.jinja',...motor.pesos].map(n=>join(motor.pasta,n))])if(!await existe(p))return false;
    const libs=await readdir(join(RAIZ,'.venv-ia/lib'));
    for(const dir of libs.filter(n=>/^python3\.\d+$/.test(n))){
      const nomes=new Set(await readdir(join(RAIZ,'.venv-ia/lib',dir,'site-packages')).catch(()=>[]));
      if(['mlx','mlx_lm','transformers','outlines_core'].every(n=>nomes.has(n)))return true;
    }
  }catch{/* Presença não é aprovação nem tenta instalar dependências. */}
  return false;
}
function listaTextos(x,maxItens=6,maxTexto=240){if(!Array.isArray(x)||x.length>maxItens)falhar('Lista de saída inválida.',503);return x.map(t=>texto(t,maxTexto,'Texto da saída'));}
function refs(ids,citacoes,fontes){
  if(!Array.isArray(ids)||!ids.length||ids.length>3||new Set(ids).size!==ids.length||ids.some(i=>!fontes.has(i)))falhar('Referências da saída inválidas.',503);
  const reais=ids.map(i=>fontes.get(i));if(digestPython(citacoes)!==digestPython(reais))falhar('Citações divergentes das fontes da captura.',503);return clonar(reais);
}
function resultadoPublico(r,base,reserva=[]){
  campos(r,['versao','estado','dominio','ofertas','duvidas','ofertasIdentificadas','ofertasAnalisadas','recusadas','modelo','inferencias','entradaSha256','codigo','perfilConfirmado','limite'],'Resposta local');
  if(!OBJ(r)||r.versao!==2||r.dominio!==base.dominio||r.perfilConfirmado!==false||!['sem_fontes','insuficiente','revisao_necessaria'].includes(r.estado)||!Array.isArray(r.ofertas)||r.ofertas.length>1)falhar('Resposta local incompatível.',503);
  if(base.fontes.length===0){if(r.estado!=='sem_fontes'||r.ofertas.length)falhar('Resposta sem fontes incompatível.',503);}
  else if(r.estado==='sem_fontes'||r.entradaSha256!==digestPython(base))falhar('Identidade de entrada da resposta não confere.',503);
  const fontes=new Map(base.fontes.map(f=>[f.id,f]));
  const ofertas=r.ofertas.map(o=>{
    if(!OBJ(o)||!['software','servico','produto','programa_social','indefinido'].includes(o.natureza)||!['disponibiliza','executa','vende','intermedeia','indefinido'].includes(o.papel_site)||o.revisaoSemantica!=='pendente')falhar('Oferta de saída incompatível.',503);
    const oferta={nome:texto(o.nome,120,'Nome da oferta'),natureza:o.natureza,papel_site:o.papel_site,
      evidencias:clonar(o.evidencias),citacoes:refs(o.evidencias,o.citacoes,fontes),revisaoSemantica:'pendente'};
    const j=o.jornada;if(!OBJ(j)||j.perfilConfirmado!==false||j.revisaoSemantica!=='pendente')falhar('Jornada incompatível.',503);
    const entradaJornada={versao:1,dominio:base.dominio,fontes:j.fontesSelecionadas};validarBase(entradaJornada,base.dominio);
    if(j.entradaSha256!==digestPython(entradaJornada))falhar('Identidade da entrada da jornada não confere.',503);
    const conteudo=f=>digestPython((({id,...resto})=>resto)(f));
    const permitidas=new Set([...base.fontes,...reserva].map(conteudo));
    if(j.fontesSelecionadas.some(f=>!permitidas.has(conteudo(f))))falhar('A jornada cita fonte fora da captura preservada.',503);
    const fontesJornada=new Map(j.fontesSelecionadas.map(f=>[f.id,f]));
    const jornada={};for(const campo of ['compradores','executores','beneficiarios','pagadores']){
      if(!Array.isArray(j[campo])||j[campo].length>2)falhar('Atores da jornada inválidos.',503);
      jornada[campo]=j[campo].map(a=>{if(a.revisaoSemantica!=='pendente')falhar('Ator sem revisão pendente.',503);return{grupo:texto(a.grupo,120,'Grupo'),evidencias:clonar(a.evidencias),citacoes:refs(a.evidencias,a.citacoes,fontesJornada),revisaoSemantica:'pendente'};});
    }
    if(!Array.isArray(j.condicoes)||j.condicoes.length>4)falhar('Condições da jornada inválidas.',503);
    jornada.condicoes=j.condicoes.map(c=>{
      if(c.revisaoSemantica!=='pendente'||!['elegibilidade','limite','preco','prazo','exclusao','canal','outro'].includes(c.categoria)||!['esta_oferta','formulario','indefinida'].includes(c.aplicacao))falhar('Condição inválida.',503);
      if(c.oferta!==(c.aplicacao==='esta_oferta'?o.nome:null))falhar('Condição associada a outra oferta.',503);
      return{categoria:c.categoria,evidencia:c.evidencia,aplicacao:c.aplicacao,oferta:c.oferta,citacoes:refs([c.evidencia],c.citacoes,fontesJornada),revisaoSemantica:'pendente'};
    });
    jornada.duvidas=listaTextos(j.duvidas);jornada.revisaoSemantica='pendente';jornada.perfilConfirmado=false;
    jornada.entradaSha256=j.entradaSha256;jornada.fontesRetidas=j.fontesSelecionadas.length;
    jornada.itensRecusados=Array.isArray(j.recusados)?j.recusados.length:0;
    if(j.erro!==undefined)jornada.erro=texto(j.erro,120,'Código de erro');
    oferta.jornada=jornada;return oferta;
  });
  return {versao:2,estado:r.estado,dominio:base.dominio,ofertas,duvidas:listaTextos(r.duvidas),
    ofertasIdentificadas:Number.isInteger(r.ofertasIdentificadas)&&r.ofertasIdentificadas>=ofertas.length&&r.ofertasIdentificadas<=3?r.ofertasIdentificadas:ofertas.length,
    ofertasAnalisadas:ofertas.length,itensRecusados:Array.isArray(r.recusadas)?r.recusadas.length:0,
    entradaSha256:digestPython(base),perfilConfirmado:false,revisaoSemantica:'pendente',
    modeloBase:r.estado==='sem_fontes'?null:'qwen35-4b',inferenciasExecutadas:Array.isArray(r.inferencias)?r.inferencias.filter(i=>i?.inferida===true).length:0,
    limite:'Entendimento experimental para revisão. Citações e estrutura não aprovam a interpretação; o perfil e os anúncios não foram alterados.'};
}
function resumo(m,resultado){return{id:m.id,estado:m.estado,dominio:m.dominio,capturaId:m.capturaId,criadoEm:m.criadoEm,...(m.motor==='proposicoes'?{motor:'proposicoes'}:{}),
  ...(m.finalizadoEm?{finalizadoEm:m.finalizadoEm}:{}),...(m.erro?{erro:m.erro}:{}),...(resultado?{resultado}:{}),
  limite:'Execução local experimental; disponibilidade não significa modelo aprovado.'};}

/** Serviço interno. Nenhuma opção deste factory deve vir do navegador. */
export function criarEntendimentoLocal({dataDir,preparar,iniciar=spawn,limiteMs=360000,podeIniciar=()=>true,motor='jornadas'}={}){
  if(typeof dataDir!=='string'||!dataDir.trim()||typeof preparar!=='function'||typeof iniciar!=='function'||typeof podeIniciar!=='function'||!Number.isInteger(limiteMs)||limiteMs<1||limiteMs>3600000||typeof motor!=='string'||!Object.hasOwn(MOTORES,motor))falhar('Configuração do entendimento local inválida.');
  const configuracaoMotor=MOTORES[motor];
  const projetar=(r,base,reserva,meta)=>{
    if(motor==='jornadas')return resultadoPublico(r,base,reserva);
    const codigos=meta?.identidade?.codigo;
    const essenciais=['executar','contrato','protocolo','unidades','controle','__init__'].map(n=>'ia/negocio/proposicoes/'+n+'.py').concat(['ia/negocio/jornadas/recuperacao.py','ia/negocio/jornadas/contrato.py','ia/negocio/relacoes/contrato.py','ia/negocio/modelos.py','ia/negocio/runtime_negocio.py','ia/negocio/protocolo.py','ia/negocio/decodificacao/core_mlx.py']);
    if(!OBJ(r?.codigo)||!OBJ(codigos)||Object.entries(r.codigo).some(([p,sha])=>codigos[p]!==sha)||essenciais.some(p=>!r.codigo[p]))falhar('O código da execução de relações diverge do registro inicial.',409);
    return publicarProposicoes(r,base,reserva,{validarBase,modeloBaseEsperado:meta.identidade.modeloBase});
  };
  const raiz=join(resolve(dataDir),'evidencias-negocio'),capturas=join(raiz,'capturas'),execucoes=join(raiz,'execucoes'),dono=randomUUID();
  let fechado=false,inicializacao;
  const inicializar=()=>inicializacao??=(async()=>{await diretorio(raiz);await diretorio(capturas);await diretorio(execucoes);})();
  const lerCaptura=async(capturaId,d)=>{
    if(typeof capturaId!=='string'||!CAP.test(capturaId))falhar('Identificador de captura inválido.');
    const b=await ler(join(capturas,capturaId+'.json')).catch(e=>{if(e.code==='ENOENT')falhar('Captura não encontrada.',404);throw e;});
    if('cap_'+SHA(b)!==capturaId)falhar('A captura salva mudou; faça uma nova leitura do site.',409);
    const c=decodificar(b);if(c.versao!==1||c.dominio!==d||c.coleta?.dominio!==d||!OBJ(c.preparacao))falhar('Captura não encontrada para este domínio.',404);
    validarBase(c.preparacao.base,d);return c;
  };
  async function finalizar(a,estado,erro,codigo=null,sinal=null){
    if(a.finalizando)return a.finalizando;
    a.finalizando=(async()=>{
      clearTimeout(a.timer);const bruto=Buffer.concat(a.stdout),stderr=Buffer.concat(a.stderr);let publico=null;
      if(estado==='concluido')try{publico=projetar(decodificar(bruto),a.base,a.reserva,a.meta);}catch(e){a.erroValidacao={tipo:String(e?.name||'Error'),mensagem:String(e?.message||'Resposta incompatível.').slice(0,2000)};estado='falhou';erro={codigo:'resposta_invalida',mensagem:'A resposta local não passou pela verificação de formato, domínio, fontes ou identidade da entrada.'};}
      const meta={...a.meta,estado,finalizadoEm:new Date().toISOString(),codigoProcesso:Number.isInteger(codigo)?codigo:null,sinalProcesso:typeof sinal==='string'?sinal:null,
        stdoutSha256:SHA(bruto),stderrSha256:SHA(stderr),stdoutBytes:bruto.length,stderrBytes:stderr.length,stdoutTruncado:a.stdoutTruncado,stderrTruncado:a.stderrTruncado,
        ...(erro?{erro}:{}),...(a.erroValidacao?{erroValidacao:a.erroValidacao}:{}),...(publico?{resultadoSha256:SHA(json(publico))}:{})};
      try{
        await novoArquivo(join(a.pasta,'stdout.bin'),bruto);await novoArquivo(join(a.pasta,'stderr.bin'),stderr);
        if(publico)await novoArquivo(join(a.pasta,'resultado.json'),json(publico));
        await novoArquivo(join(a.pasta,'final.json'),json(meta));a.publico=resumo(meta,publico);
      }catch{a.publico=resumo({...meta,estado:'falhou',erro:{codigo:'persistencia',mensagem:'Não foi possível salvar todos os artefatos locais da execução.'}});}
      finally{a.terminou=true;if(ATIVO===a)ATIVO=null;a.resolver();}
    })();return a.finalizando;
  }
  return{
    async disponivel(){return !fechado&&await instalacaoPresente(configuracaoMotor);},
    ocupado(){return ATIVO!==null;},
    async registrar(coleta){
      if(fechado)falhar('O executor local foi encerrado.',503);
      if(!OBJ(coleta))falhar('Captura inválida.');const d=dominio(coleta.dominio);if(d!==coleta.dominio)falhar('Domínio da captura não é canônico.');
      const coletadoEm=data(coleta.coletadoEm),captura=clonar(coleta);
      if(json(captura).length>MAX_SNAPSHOT)falhar('Captura acima do limite local.',413);
      const preparada=await preparar(clonar(captura));campos(preparada,['base','mapaIds','pool','recuperacao'],'Preparação');validarBase(preparada.base,d);
      const envelope={versao:1,dominio:d,coletadoEm,coleta:captura,preparacao:preparada},b=json(envelope);
      if(b.length>MAX_SNAPSHOT)falhar('Captura e preparação excedem o limite local.',413);
      const capturaId='cap_'+SHA(b);await inicializar();await unicaEscrita(join(capturas,capturaId+'.json'),b);
      const cartoesDeModalidades=selecionarCartoesDeModalidades(Array.isArray(preparada.pool?.fontes)?preparada.pool.fontes:[]);
      return{capturaId,dominio:d,coletadoEm,base:clonar(preparada.base),recuperacao:recuperacaoPublica(preparada.recuperacao),
        ...(cartoesDeModalidades.length?{cartoesDeModalidades:clonar(cartoesDeModalidades)}:{})};
    },
    async iniciar(pedido){
      campos(pedido,['dominio','capturaId'],'Pedido de entendimento');const d=dominio(pedido.dominio);
      if(fechado)falhar('O executor local foi encerrado.',503);if(ATIVO)falhar('Já existe uma análise local em execução. Aguarde sua conclusão.',409);
      const a={dono,raiz,id:randomUUID(),child:null,terminou:false,stdout:[],stderr:[],stdoutBytes:0,stderrBytes:0,stdoutTruncado:false,stderrTruncado:false};
      a.conclusao=new Promise(r=>{a.resolver=r;});ATIVO=a;
      try{
        if(await podeIniciar()!==true)falhar('Outro modelo local já está em execução. Aguarde sua conclusão.',409);
        await inicializar();const c=await lerCaptura(pedido.capturaId,d);a.base=clonar(c.preparacao.base);a.reserva=reservaDaPreparacao(c.preparacao,d);
        const entrada=json({base:a.base,maxOfertas:1,...(a.reserva.length?{fontesReserva:a.reserva}:{})});
        if(entrada.length>MAX_ENTRADA)falhar('As fontes completas excedem o limite de entrada local; nenhuma frase foi truncada.',413);
        a.pasta=join(execucoes,a.id);await diretorio(a.pasta);
        const fontesCodigo=[...(await readdir(join(RAIZ,'ia/negocio/jornadas'))).filter(n=>/^[a-z_]+\.py$/.test(n)).map(n=>'ia/negocio/jornadas/'+n),
          ...(motor==='proposicoes'?[...(await readdir(join(RAIZ,'ia/negocio/proposicoes'))).filter(n=>/^[a-z_]+\.py$/.test(n)).map(n=>'ia/negocio/proposicoes/'+n),'ia/negocio/relacoes/contrato.py','ia/negocio/protocolo.py','ia/negocio/decodificacao/core_mlx.py']:[]),
          'ia/negocio/modelos.py','ia/negocio/runtime_negocio.py'];
        const codigo={};for(const nome of fontesCodigo)codigo[nome]=SHA(await ler(join(RAIZ,nome),1024*1024));
        a.meta={versao:1,id:a.id,dominio:d,capturaId:pedido.capturaId,estado:'em_execucao',criadoEm:new Date().toISOString(),
          instancia:dono,pidServidor:process.pid,entradaArquivoSha256:SHA(entrada),entradaSha256:digestPython(a.base),maxOfertas:1,
          ...(motor==='proposicoes'?{motor}:{}),identidade:{executor:'ia/negocio/'+(motor==='proposicoes'?'proposicoes':'jornadas')+'/executar.py',modeloBase:configuracaoMotor.modeloBase,codigo},limiteMs};
        await novoArquivo(join(a.pasta,'entrada.json'),entrada);await novoArquivo(join(a.pasta,'iniciado.json'),json(a.meta));
        a.publico=resumo(a.meta);
        if(fechado){await finalizar(a,'interrompido',{codigo:'servidor_encerrado',mensagem:'O servidor local foi encerrado antes da inferência.'});return a.publico;}
        const env={PATH:'/usr/bin:/bin',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',HF_HUB_DISABLE_IMPLICIT_TOKEN:'1',PYTHONUNBUFFERED:'1',PYTHONDONTWRITEBYTECODE:'1'};
        if(process.env.HOME)env.HOME=process.env.HOME;if(process.env.TMPDIR)env.TMPDIR=process.env.TMPDIR;
        const parar=(estado,erro)=>{if(a.terminou||a.finalizando||a.motivo)return;a.motivo={estado,erro};try{a.child?.kill('SIGKILL');}catch{/* O encerramento é confirmado pelo evento close. */}};
        a.parar=parar;
        try{a.child=iniciar(PYTHON,[configuracaoMotor.script],{cwd:RAIZ,env,shell:false,stdio:['pipe','pipe','pipe']});}
        catch{await finalizar(a,'falhou',{codigo:'nao_iniciada',mensagem:'Não foi possível iniciar o ambiente Python local.'});return a.publico;}
        const guardar=(parte,tipo,max)=>{
          const b=Buffer.isBuffer(parte)?parte:Buffer.from(parte),restante=Math.max(0,max-a[tipo+'Bytes']);
          if(restante)a[tipo].push(b.subarray(0,restante));a[tipo+'Bytes']+=Math.min(b.length,restante);
          if(b.length>restante){a[tipo+'Truncado']=true;if(tipo==='stdout')parar('falhou',{codigo:'saida_excedida',mensagem:'A resposta local excedeu o limite permitido.'});}
        };
        a.child.stdout.on('data',p=>guardar(p,'stdout',MAX_SAIDA));a.child.stderr.on('data',p=>guardar(p,'stderr',MAX_STDERR));
        a.child.stdin.on('error',()=>parar('falhou',{codigo:'entrada_interrompida',mensagem:'O processo local não recebeu a entrada completa.'}));
        a.child.once('error',()=>{const erro={codigo:'processo_indisponivel',mensagem:'Não foi possível executar o processo local.'};
          if(Number.isInteger(a.child.pid))parar('falhou',erro);else void finalizar(a,'falhou',erro);});
        a.child.once('close',(codigo,sinal)=>{const m=a.motivo;void finalizar(a,m?.estado||(codigo===0?'concluido':'falhou'),m?.erro||(codigo===0?null:{codigo:'processo_falhou',mensagem:'O processo local não concluiu a análise. Os detalhes foram preservados no computador.'}),codigo,sinal);});
        a.timer=setTimeout(()=>parar('interrompido',{codigo:'tempo_excedido',mensagem:'A análise atingiu o limite de tempo e o processo próprio foi encerrado.'}),limiteMs);
        try{a.child.stdin.end(entrada);}catch{parar('falhou',{codigo:'entrada_interrompida',mensagem:'Não foi possível enviar a entrada ao processo local.'});}
        return clonar(a.publico);
      }catch(e){if(ATIVO===a)ATIVO=null;a.terminou=true;a.resolver();throw e instanceof ErroProjeto?e:new ErroProjeto('Não foi possível preparar os artefatos da execução local.',503);}
    },
    async consultar(pedido){
      campos(pedido,['dominio','id'],'Consulta do entendimento');const d=dominio(pedido.dominio);
      if(typeof pedido.id!=='string'||!JOB.test(pedido.id))falhar('Identificador de execução inválido.');
      await inicializar();const pasta=join(execucoes,pedido.id);let meta;
      try{meta=decodificar(await ler(join(pasta,'iniciado.json'),128*1024));}catch(e){if(e.code==='ENOENT')falhar('Execução não encontrada.',404);throw e;}
      if(meta.versao!==1||meta.id!==pedido.id||meta.dominio!==d||!CAP.test(meta.capturaId)||(meta.motor||'jornadas')!==motor)falhar('Execução não encontrada para este domínio e modo.',404);
      data(meta.criadoEm);
      if(ATIVO?.raiz===raiz&&ATIVO.id===pedido.id)return clonar(ATIVO.publico||resumo(meta));
      let final=await ler(join(pasta,'final.json'),128*1024).then(decodificar).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(!final){final={...meta,estado:'interrompido',finalizadoEm:new Date().toISOString(),erro:{codigo:'execucao_sem_continuidade',mensagem:'A execução anterior foi interrompida. Nenhum processo foi retomado automaticamente.'}};
        try{await unicaEscrita(join(pasta,'final.json'),json(final));}catch(e){if(e.status!==409)throw e;}
        final=decodificar(await ler(join(pasta,'final.json'),128*1024));}
      if(final.id!==meta.id||final.dominio!==d||final.capturaId!==meta.capturaId||!['concluido','falhou','interrompido'].includes(final.estado))falhar('Registro final da execução inválido.',503);
      data(final.finalizadoEm);
      if(final.estado!=='concluido')return resumo({...final,erro:{codigo:CODIGOS.has(final.erro?.codigo)?final.erro.codigo:'execucao_interrompida',mensagem:final.estado==='interrompido'?'A execução local foi interrompida; os artefatos disponíveis foram preservados.':'A execução local não produziu uma resposta válida. Os detalhes foram preservados no computador.'}});
      const c=await lerCaptura(meta.capturaId,d),b=await ler(join(pasta,'resultado.json'),MAX_SAIDA),entrada=await ler(join(pasta,'entrada.json'),MAX_ENTRADA),bruto=await ler(join(pasta,'stdout.bin'),MAX_SAIDA);
      if(SHA(b)!==final.resultadoSha256||digestPython(c.preparacao.base)!==meta.entradaSha256||SHA(entrada)!==meta.entradaArquivoSha256||
          final.entradaArquivoSha256!==meta.entradaArquivoSha256||final.entradaSha256!==meta.entradaSha256||SHA(bruto)!==final.stdoutSha256)falhar('A identidade do resultado salvo não confere.',409);
      const resultado=decodificar(b);if(resultado.versao!==configuracaoMotor.versao||resultado.dominio!==d||resultado.perfilConfirmado!==false||resultado.entradaSha256!==meta.entradaSha256)falhar('Resultado salvo incompatível.',409);
      const conferido=projetar(decodificar(bruto),c.preparacao.base,reservaDaPreparacao(c.preparacao,d),meta);
      if(motor==='proposicoes'?!conferirProjecaoProposicoes(conferido,resultado):digestPython(conferido)!==digestPython(resultado))falhar('A projeção pública diverge da saída preservada.',409);
      return resumo(final,resultado);
    },
    async fechar(){
      fechado=true;const a=ATIVO;if(!a||a.dono!==dono)return;
      if(a.parar)a.parar('interrompido',{codigo:'servidor_encerrado',mensagem:'O servidor local encerrou seu próprio processo de análise.'});
      await a.conclusao;
    },
  };
}
