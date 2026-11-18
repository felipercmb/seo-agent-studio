import {readFile,writeFile,mkdir,rm,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join,relative,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const RAIZ=fileURLToPath(new URL('../',import.meta.url));
const ROBUSTEZ=join(RAIZ,'data/ia/robustez');
const hash=v=>createHash('sha256').update(v).digest('hex');
const objeto=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
async function lerJSON(arquivo,maximo=32*1024*1024){
  const stat=await lstat(arquivo);if(!stat.isFile()||stat.size>maximo)throw new Error('Use um arquivo JSON local regular dentro do limite.');
  const raw=await readFile(arquivo),dados=JSON.parse(raw.toString('utf8'));return{raw,dados};
}
const gravar=(arquivo,bytes)=>writeFile(arquivo,bytes,{flag:'wx',mode:0o600});
export const citarShellPosix=valor=>"'"+String(valor).replaceAll("'","'\\''")+"'";
function caminhoDaCaptura(raiz,nome){
  if(typeof nome!=='string'||!nome||nome.includes('\\'))throw new Error('Caminho de captura inválido.');
  const p=resolve(raiz,nome),rel=relative(raiz,p);if(rel.startsWith('..')||!rel)throw new Error('Captura fora da pasta informada.');return p;
}

/** Prepara um pacote cego de respostas já produzidas. Nunca avalia um humano,
 * consulta sites, executa modelos, cria rótulos ou modifica a seleção de IA. */
export async function prepararRevisaoModular({corpus,avaliacao,capturas,saida,modo='hibrida'}={}){
  if(![corpus,avaliacao,capturas,saida].every(x=>typeof x==='string'&&x.trim())||!['hibrida','crua'].includes(modo))throw new Error('Informe corpus, avaliação, pasta de capturas, saída nova e modo hibrida ou crua.');
  const destino=resolve(saida),raizCapturas=resolve(capturas);
  if(dirname(destino)!==ROBUSTEZ||!basename(destino).startsWith('coleta-revisao-'))throw new Error('Use uma pasta nova data/ia/robustez/coleta-revisao-<nome> para compatibilidade com o revisor existente.');
  const c=await lerJSON(resolve(corpus)),a=await lerJSON(resolve(avaliacao));
  if(a.dados.corpusSha256!==hash(c.raw)||!Array.isArray(c.dados.casos)||!Array.isArray(a.dados.resultados)||
      !/^[a-f0-9]{64}$/.test(a.dados.adaptadorSha256||''))throw new Error('Corpus, avaliação e hash do adaptador não conferem.');
  const casos=c.dados.casos,resultados=a.dados.resultados,porId=new Map(resultados.map(r=>[r.id,r]));
  if(!casos.length||casos.length>500||new Set(casos.map(x=>x.id)).size!==casos.length||porId.size!==resultados.length||
      resultados.length!==casos.length||casos.some(x=>!porId.has(x.id)))throw new Error('Inclua todos os casos e resultados, sem repetições nem seleção parcial.');
  const reproducao=a.dados.relogioReferencia||c.dados.relogioReferencia;
  if(typeof reproducao!=='string'||!Number.isFinite(Date.parse(reproducao)))throw new Error('Falta o relógio de referência das evidências.');
  const fontes=new Map(),planejados=[],roteiro=[],mapeamento=[];
  for(const [indice,caso]of casos.entries()){
    const resultado=porId.get(caso.id),campo=modo==='crua'?'saidaCruaComBarreiras':'saidaHibrida',resposta=resultado[campo];
    if(!objeto(caso.entrada)||!Array.isArray(caso.entrada.evidencias)||!objeto(resposta)||
        !['recusada','revisao_necessaria'].includes(resposta.estado))throw new Error('Entrada ou resposta examinada está fora do contrato.');
    const arquivo=caminhoDaCaptura(raizCapturas,caso.origem?.arquivoCaptura);
    let fonte=fontes.get(arquivo);
    if(!fonte){
      const captura=await lerJSON(arquivo);
      if(hash(captura.raw)!==caso.origem.capturaSha256||captura.dados.dominio!==caso.dominio||!Array.isArray(captura.dados.paginas))throw new Error('Uma captura difere da origem registrada.');
      const id='site-'+String(fontes.size+1).padStart(3,'0'),arquivos=[];
      for(const [n,p]of captura.dados.paginas.entries()){
        if(typeof p.html!=='string'||hash(Buffer.from(p.html))!==p.sha256)throw new Error('HTML público alterado após a captura.');
        arquivos.push({arquivo:'pagina-'+String(n+1).padStart(2,'0')+'.html',url:p.url,status:p.status,coletadoEm:p.coletadoEm,
          sha256_utf8_local:p.sha256,html:p.html,...(p.cabecalhoRobots?{cabecalhoRobots:p.cabecalhoRobots}:{})});
      }
      const registro={versao:1,dominio:caso.dominio,coletadoEm:captura.dados.coletadoEm,
        captura_original_sha256:hash(captura.raw),arquivos:arquivos.map(({html,...meta})=>meta)};
      const bytesRegistro=json(registro);
      fonte={id,dominio:caso.dominio,arquivoOrigem:arquivo,sha256_registro:hash(bytesRegistro),bytesRegistro,arquivos};fontes.set(arquivo,fonte);
    }else if(fonte.dominio!==caso.dominio||caso.origem.capturaSha256!==hash((await lerJSON(arquivo)).raw))throw new Error('Origem de captura ambígua.');
    for(const e of caso.entrada.evidencias.filter(e=>e.tipo==='pagina')){
      if(!fonte.arquivos.some(p=>p.url===e.pagina&&p.sha256_utf8_local===e.sha256_pagina))throw new Error('A evidência de página não corresponde ao HTML preservado.');
    }
    const id='revisao-'+String(indice+1).padStart(3,'0');
    // No alvos, critérios de acerto, familia, split ou identidade da seleção
    // entram na cópia destinada ao roteiro de revisão.
    const entrada={site:caso.entrada.site,objetivo:caso.entrada.objetivo,evidencias:caso.entrada.evidencias,
      dados_negocio:caso.entrada.dados_negocio};
    const motivos=[...(resposta.erros||[]),...(resposta.motivos_aplicabilidade||[])];
    const convertido={id,dominio:caso.dominio,tipo:'publico_modular',origem:resposta.origem||'ia',
      escolha:resposta.escolha_ia||null,aceita:resposta.estado==='revisao_necessaria',motivos,
      ajustada_por_regra:!!resposta.ajustada_por_regra,
      ...(resposta.ajustada_por_regra?{escolha_original:resposta.escolha_original_ia||resultado.escolhaCrua}:{}),
      resposta_bruta:resultado.saidaBruta,orientacao_exibida:resposta.orientacao_padrao,limite_exibido:resposta.limite_padrao};
    planejados.push({id,grupo:caso.dominio,tipo:'publico_modular',entrada,fonte:{registro_sha256:fonte.sha256_registro,reproducao_em:reproducao},fonteId:fonte.id,convertido});
    roteiro.push({id,dominio:caso.dominio,objetivo:entrada.objetivo,evidencias:entrada.evidencias,relogioReferencia:reproducao,
      respostaExaminada:{escolha:convertido.escolha,estado:resposta.estado,motivos,orientacao:resposta.orientacao_padrao,limite:resposta.limite_padrao},
      respostaBruta:resultado.saidaBruta,arquivosLocais:fonte.arquivos.map(p=>({arquivo:join(destino,fonte.id,p.arquivo),sha256_utf8_local:p.sha256_utf8_local,url:p.url,coletadoEm:p.coletadoEm}))});
    mapeamento.push({id,casoOriginal:caso.id,arquivoCapturaOriginal:arquivo,capturaSha256:caso.origem.capturaSha256});
  }
  const manifestCapturas=json({versao:1,origem:'Páginas públicas preservadas para revisão humana local; não é revisão concluída.',
    sites:[...fontes.values()].map(f=>({id:f.id,dominio:f.dominio,sha256_registro:f.sha256_registro})),limite:'A captura não mede posições atuais, procura, conversões ou retorno.'});
  const bytesCasos=Buffer.from(planejados.map(({fonteId,convertido,...caso})=>JSON.stringify({...caso,fonte:{...caso.fonte,manifesto_sha256:hash(manifestCapturas)}})).join('\n')+'\n');
  const manifestRevisao=json({versao:1,origem:'Revisão local cega aos alvos automáticos e à seleção do modelo.',
    arquivos:{'casos-test.jsonl':{sha256:hash(bytesCasos),bytes:bytesCasos.length}},
    limite:'test é apenas o nome do recipiente técnico exigido pelo validador; não informa o split original nem aprova o modelo.'});
  const convertido=json({versao:1,split:'test',manifesto_sha256:hash(manifestRevisao),casos_sha256:hash(bytesCasos),
    adaptador_sha256:a.dados.adaptadorSha256,resultados:planejados.map(x=>x.convertido)});
  let criado=false;
  try{
    await mkdir(ROBUSTEZ,{recursive:true,mode:0o700});await mkdir(destino,{mode:0o700});criado=true;
    for(const f of fontes.values()){
      const pasta=join(destino,f.id);await mkdir(pasta,{mode:0o700});await gravar(join(pasta,'registro.json'),f.bytesRegistro);
      for(const p of f.arquivos)await gravar(join(pasta,p.arquivo),p.html);
    }
    await gravar(join(destino,'manifest.json'),manifestCapturas);
    const dados=join(destino,'revisao');await mkdir(dados,{mode:0o700});
    await gravar(join(dados,'manifest.json'),manifestRevisao);await gravar(join(dados,'casos-test.jsonl'),bytesCasos);
    await gravar(join(dados,'avaliacao-revisao.json'),convertido);await gravar(join(destino,'roteiro-cego.json'),json({versao:1,revisaoHumanaRealizada:false,casos:roteiro}));
    await gravar(join(destino,'auditoria-origens.json'),json({versao:1,corpusOriginal:resolve(corpus),corpusSha256:hash(c.raw),avaliacaoOriginal:resolve(avaliacao),avaliacaoSha256:hash(a.raw),modo,copias:mapeamento,revisaoHumanaRealizada:false}));
    const comando=`.venv-ia/bin/python ia/robustez/revisar.py --dados ${citarShellPosix(dados)} --avaliacao ${citarShellPosix(join(dados,'avaliacao-revisao.json'))} --saida data/revisoes/parecer-novo.jsonl --revisor PSEUDONIMO_DO_REVISOR`;
    await gravar(join(destino,'LEIA-ME.md'),Buffer.from('# Revisão humana local pendente\n\nNenhum parecer foi produzido. Todos os '+casos.length+' contextos e suas respostas foram incluídos. O roteiro oculta alvos, métricas automáticas e split original. A auditoria de origens fica em arquivo separado e deve ser consultada após o parecer para preservar o cegamento.\n\nLeia roteiro-cego.json e os HTMLs locais ou use o fluxo interativo existente, executando na raiz do projeto:\n\n```sh\n'+comando+'\n```\n\nEscolha um pseudônimo curto do revisor, sem dados pessoais, e uma saída nova. Não execute o comando como se já houvesse um parecer. Este pacote não treina pesos nem prova resultados comerciais. O formato técnico test atende ao validador existente e não identifica seleção de modelo.\n'));
    return{versao:1,saida:destino,contextos:casos.length,capturas:fontes.size,revisaoHumanaRealizada:false,dados,avaliacao:join(dados,'avaliacao-revisao.json'),manifestoSha256:hash(manifestRevisao)};
  }catch(erro){if(criado)await rm(destino,{recursive:true,force:true});throw erro;}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{const opcoes={};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i]?.replace(/^--/,'');if(!['corpus','avaliacao','capturas','saida','modo'].includes(k)||!process.argv[i+1]||Object.hasOwn(opcoes,k))throw new Error('Use --corpus JSON --avaliacao JSON --capturas PASTA --saida PASTA_NOVA [--modo hibrida|crua].');opcoes[k]=process.argv[i+1];}console.log(JSON.stringify(await prepararRevisaoModular(opcoes),null,2));}
  catch{console.error('Não foi possível preparar a revisão. Confira origem, hashes, todos os IDs e uma saída nova em data/ia/robustez/coleta-revisao-<nome>.');process.exitCode=1;}
}
