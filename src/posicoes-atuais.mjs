import {normalizarSite, ErroConsulta, redirecionamentoGoogleOpaco} from './consulta.mjs';
import {descobrirTermos, chamadaDeNavegacao, rotuloDeAtendimento, rotuloInstitucional, cabecalhoSemOferta, ancoraProdutoAmbigua, rotuloDeTema} from './descoberta.mjs';
import {consultarGoogle, ErroFonte} from './serpapi.mjs';
import {criarFranquia, MAX_DOMINIO_DIA} from './franquia.mjs';

const CONTEXTO = {pais: 'Brasil', idioma: 'Português', dispositivo: 'Computador', localidade: 'Brasil'};
const MAX_TERMOS = 100, MAX_PAGINAS = 5, LOTE = 4, GRUPO = 4, MAX_CAPTURAS = 24;
const HORA = 3600_000, DIA = 86400_000, ESPERA = 3000;
const normal = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const idTermo = s => 't:' + s.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
const pertence = (host, dominio) => host === dominio || host.endsWith('.' + dominio);
const atual = (p, agora) => Number.isFinite(Date.parse(p?.coletadoEm)) && Date.parse(p.coletadoEm) <= agora &&
  agora - Date.parse(p.coletadoEm) < HORA && Array.isArray(p.resultados) &&
  p.resultados.every(r => typeof r?.url === 'string' && !redirecionamentoGoogleOpaco(r.url));
const termos = job => job.candidatos.map(c => ({c, k: idTermo(c.termo), q: job.termos[idTermo(c.termo)]}));
const motivoFonte = codigo => ({
  cota: 'A franquia gratuita compartilhada está esgotada neste período.',
  cota_dominio: 'Este domínio atingiu o limite de novas páginas de busca em 24 horas. As capturas atuais continuam disponíveis.',
  plano_incompativel: 'A fonte não está em um plano gratuito compatível. Nenhuma busca paga será iniciada.',
  configuracao: 'A fonte de posições precisa ser ativada pelo responsável pelo portal.',
  controle: 'Não foi possível acessar o controle da franquia gratuita.',
  prazo: 'O prazo deste lote terminou. A verificação pode continuar do ponto salvo.',
  ocupada: 'Outra consulta já está verificando esta busca. A captura poderá ser reutilizada em seguida.',
  limite: 'Este relatório alcançou o limite de capturas recentes desta consulta.',
}[codigo] || 'A fonte não forneceu uma captura válida. Nenhuma posição foi atribuída.');

function limparExpiradas(job, agora) {
  for (const q of Object.values(job.termos)) {
    if (q.paginas?.length && q.paginas.some(p => !atual(p, agora))) {
      // A chain is indivisible: never join today's page 2 to yesterday's page 1.
      q.paginas = []; q.concluida = false; q.expirada = true;
    }
  }
  job.ativos = job.ativos.filter(k => job.termos[k] && !job.termos[k].expirada && !job.termos[k].concluida);
}
function limparChamadasAntigas(job) {
  const removidos = new Set(job.candidatos.filter(c => chamadaDeNavegacao(c?.termo)).map(c => idTermo(c.termo)));
  const marcas = job.candidatos.filter(c => c?.tipo === 'marca').map(c => c.termo);
  const atendimentos = new Set(job.candidatos.filter(c => c?.tipo === 'servico' && rotuloDeAtendimento(c.termo)).map(c => idTermo(c.termo)));
  const institucionais = new Set(job.candidatos.filter(c => c?.tipo === 'servico' && !atendimentos.has(idTermo(c.termo)) && rotuloInstitucional(c.termo,marcas)).map(c => idTermo(c.termo)));
  const temas = new Set(job.candidatos.filter(c =>
    (c?.tipo === 'servico' && !atendimentos.has(idTermo(c.termo)) && !institucionais.has(idTermo(c.termo)) &&
      (cabecalhoSemOferta(c.termo,c.evidencia?.campo,c.evidencia?.url) || rotuloDeTema(c.termo,c.evidencia?.campo))) ||
    (c?.tipo === 'produto' && (ancoraProdutoAmbigua(c.termo,c.evidencia?.campo) || rotuloDeTema(c.termo,c.evidencia?.campo)))).map(c => idTermo(c.termo)));
  if (!removidos.size && !atendimentos.size && !institucionais.size && !temas.size) return;
  job.candidatos = job.candidatos.filter(c => !removidos.has(idTermo(c.termo)));
  for (const c of job.candidatos) if (atendimentos.has(idTermo(c.termo))) c.tipo = 'atendimento';
  else if (institucionais.has(idTermo(c.termo))) c.tipo = 'institucional';
  else if (temas.has(idTermo(c.termo))) c.tipo = 'tema';
  const faixa = c => c.tipo === 'atendimento' ? 3 : c.tipo === 'institucional' ? 2 : c.tipo === 'tema' ? 1 : 0;
  job.candidatos.sort((a,b) => faixa(a)-faixa(b));
  for (const k of removidos) delete job.termos[k];
  job.ativos = job.ativos.filter(k => !removidos.has(k) && !atendimentos.has(k) && !institucionais.has(k) && !temas.has(k));
  if (Number.isInteger(job.descoberta.termosDescobertos))
    job.descoberta.termosDescobertos = Math.max(0, job.descoberta.termosDescobertos-removidos.size);
  const aviso = 'Chamadas genéricas foram retiradas e termos de atendimento, temas e rótulos institucionais foram adiados; outras sugestões continuam hipóteses.';
  if (!job.limites.includes(aviso)) job.limites.push(aviso);
}
function elegivel(q, agora) {
  if (!q) return true;
  if (q.falhou && agora - q.tentadaEm < HORA) return false;
  return !q.concluida || !q.paginas?.length || q.paginas.some(p => !atual(p, agora));
}
function preencherGrupo(job, agora) {
  const disponiveis = termos(job).filter(({k,q}) => !job.ativos.includes(k) && elegivel(q, agora))
    .sort((a,b) => (a.q?.tentadaEm || 0) - (b.q?.tentadaEm || 0));
  for (const {c,k,q} of disponiveis) {
    if (job.ativos.length >= GRUPO) break;
    if (!q || q.expirada || q.falhou || q.concluida) job.termos[k] = {termo:c.termo,paginas:[],concluida:false,tentadaEm:q?.tentadaEm || 0};
    job.ativos.push(k);
  }
}
function compactarPagina(p) {
  return {termo:p.termo,inicio:p.inicio,pagina:p.pagina,proximoInicio:p.proximoInicio,
    paginacaoInterrompida:!!p.paginacaoInterrompida,paginacaoComLacuna:!!p.paginacaoComLacuna,limiteAtingido:!!p.limiteAtingido,
    resultados:p.resultados,coletadoEm:p.coletadoEm,profundidadeObservada:p.profundidadeObservada,
    fonte:p.fonte,contexto:p.contexto,sha256:p.sha256,hashEscopo:p.hashEscopo,relacionadas:p.relacionadas || []};
}
function incluirRelacionadas(job, pagina, candidato) {
  // Only one generation, and with an informative word shared with the source
  // term. Related suggestions are candidates, never proof of impressions.
  if (candidato.origem === 'busca_relacionada') return;
  const ignorar = new Set(['para','como','onde','mais','melhor','melhores','brasil','servico','servicos','produto','produtos','site']);
  const palavras = normal(candidato.termo).split(' ').filter(p => p.length >= 4 && !ignorar.has(p));
  const vistos = new Set(job.candidatos.map(c => idTermo(c.termo)));
  for (const r of pagina.relacionadas || []) {
    if (job.candidatos.length >= MAX_TERMOS) break;
    if (typeof r.termo !== 'string' || r.termo.length < 3 || r.termo.length > 90 || /[<>@]|https?:|\d[\d\s().+/-]{6,}\d/i.test(r.termo)) continue;
    const k = idTermo(r.termo), partes = normal(r.termo).split(' ');
    if (vistos.has(k) || !palavras.some(p => partes.includes(p))) continue;
    job.candidatos.push({termo:r.termo,tipo:'relacionada',origem:'busca_relacionada',evidencia:{
      campo:'Google.related_searches',trecho:r.termo,termoOrigem:candidato.termo,fonte:'SerpApi',fonteId:pagina.fonte.id,
      coletadoEm:pagina.coletadoEm,sha256:pagina.sha256}});
    vistos.add(k);
  }
}
function resumirConsulta(q, dominio) {
  const paginas = q.paginas || [];
  if (!paginas.length) return q.falhou ? {termo:q.termo,estado:'indisponivel',posicao:null,resultados:[],acima:[],paginas:[],concluida:false,motivo:motivoFonte(q.falhou)} : null;
  const resultados = paginas.flatMap(p => p.resultados.map(r => ({...r,coletadoEm:p.coletadoEm,fonte:p.fonte})));
  const encontrado = resultados.find(r => pertence(r.dominio, dominio));
  const pagina = encontrado ? paginas.find(p => p.pagina === encontrado.pagina) : paginas.at(-1);
  const vistos = new Set();
  const acima = encontrado ? resultados.filter(r => {
    if (r.posicao >= encontrado.posicao || pertence(r.dominio, dominio) || vistos.has(r.dominio)) return false;
    vistos.add(r.dominio); return true;
  }) : [];
  return {termo:q.termo,estado:encontrado?'encontrado':'nao_encontrado',posicao:encontrado?.posicao ?? null,
    posicaoNaPagina:encontrado?.posicaoNaPagina ?? null,pagina:encontrado?.pagina ?? null,url:encontrado?.url ?? null,
    resultados,acima,paginas,profundidadeObservada:resultados.length,coletadoEm:pagina.coletadoEm,
    fonte:pagina.fonte,sha256:pagina.sha256,contexto:{...CONTEXTO},concluida:!!q.concluida &&
      (!!encontrado || !['paginacao_inconsistente','pagina_repetida'].includes(q.interrompidaPor)),
    interrompidaPor:q.interrompidaPor || null,motivo:q.falhou?motivoFonte(q.falhou):null};
}
function relatorio(job, agora, {codigo=null,novas=0,reutilizadas=0,continuar=false,reutilizado=false}={}) {
  const consultas = termos(job).map(({q}) => q && resumirConsulta(q,job.dominio)).filter(Boolean);
  const verificadas = consultas.filter(c => c.paginas.length).length;
  const encontradas = consultas.filter(c => c.estado === 'encontrado').length;
  const finalizadas = consultas.filter(c => c.concluida).length;
  const paginasConsultadas = consultas.reduce((n,c) => n+c.paginas.length,0);
  const pendentes = job.candidatos.length-finalizadas;
  const estado = codigo==='configuracao'?'fonte_nao_configurada':
    ['cota','cota_dominio'].includes(codigo)?'cota_esgotada':!job.candidatos.length?(continuar?'parcial':codigo?'indisponivel':'sem_termos'):verificadas && !pendentes?'verificado':
    verificadas || continuar?'parcial':'indisponivel';
  return {versao:2,dominio:job.dominio,estado,geradoEm:new Date(agora).toISOString(),candidatos:job.candidatos,consultas,
    descoberta:job.descoberta,cobertura:{selecionadas:job.candidatos.length,termosDescobertos:job.candidatos.length,
      verificadas,encontradas,finalizadas,pendentes,tentados:Object.values(job.termos).filter(q=>q.tentadaEm).length,
      paginasConsultadas,limiteTermos:MAX_TERMOS,limitePaginasPorTermo:MAX_PAGINAS,limitePaginasPorLote:LOTE,...CONTEXTO},
    progresso:{continuar,esperaMs:codigo==='ocupada'?5000:ESPERA,motivo:codigo || (continuar?'fila':'concluido'),limiteDiario:MAX_DOMINIO_DIA,
      paginasNesteLote:novas,paginasReutilizadasNesteLote:reutilizadas},cache:{reutilizado},
    aviso:codigo?motivoFonte(codigo):continuar?'A descoberta está disponível. As posições são verificadas em lotes; acompanhe a cobertura e as datas.':
      !job.candidatos.length?'Não houve conteúdo suficiente para descobrir termos com evidência.':'Confira o recorte e a data de cada busca. A cobertura não representa todas as pesquisas do Google.',
    limites:[...job.limites,
      job.planoExterno ? 'Este plano combina termos publicados com hipóteses do perfil revisado; nenhum candidato comprova procura ou posição.' : 'Descobrimos até 100 termos no conteúdo de até 12 páginas públicas. São candidatos, não prova de procura ou de posição.',
      'A verificação percorre até cinco páginas por termo, conforme a continuação fornecida pela fonte. A quantidade de resultados pode variar.',
      'A posição exibida soma o deslocamento da paginação à posição orgânica dentro da página; preservamos ambos na evidência. Não é uma posição universal ou personalizada.',
      'As páginas são capturas separadas. Concorrentes de páginas diferentes têm suas próprias datas; a busca pode variar durante a paginação.',
      'Buscas relacionadas são hipóteses sugeridas pela fonte, filtradas pela relação com um termo do site. Não comprovam volume, impressões ou posição.',
      'A ausência vale somente para as páginas consultadas. Capturas com mais de uma hora deixam de confirmar posições atuais.',
      'Há até 20 novas páginas do Google por domínio em 24 horas, dentro da franquia global de 200 ao mês e 40 por hora. A verificação para quando algum limite é atingido.',
      'O progresso é guardado por até sete dias. Novos lotes só são executados enquanto você acompanha a consulta ou pede para continuar; não há monitoramento em segundo plano.',
    ]};
}

export function criarPosicoesAtuais(opcoes={}) {
  // Identificador interno: separa planos editados sem mudar a franquia global
  // ou permitir ao navegador escolher uma chave de cache.
  if (opcoes.planoId != null && !/^[a-f0-9]{64}$/.test(opcoes.planoId)) throw new Error('Identificador de plano inválido');
  const coletar=opcoes.coletar, descobrir=opcoes.descobrir??descobrirTermos, consultar=opcoes.consultarGoogle??consultarGoogle, agora=opcoes.agora??Date.now;
  const pendentes=new Map();
  async function executar(dominio,continuacao,env) {
    const prazo=agora()+65_000, banco=opcoes.franquia??criarFranquia(env.DB,agora), chave='ranking-plano-v2:'+dominio+(opcoes.planoId ? ':modular:'+opcoes.planoId : '');
    const vazio=()=>({versao:2,dominio,planoExterno:!!opcoes.planoId,candidatos:[],descoberta:{paginasLidas:0,limitePaginas:12,limiteTermos:MAX_TERMOS,termosDescobertos:0,limitada:true},limites:[],termos:{},ativos:[],ultimoLote:0});
    let job=vazio(), token=null, criado=false;
    try {
      if (banco) {
        token=await banco.bloquear(chave);
        if (!token) { const salvo=await banco.obter(chave); if(salvo?.versao===2)job=salvo; limparChamadasAntigas(job); limparExpiradas(job,agora()); return relatorio(job,agora(),{codigo:'ocupada',continuar:true,reutilizado:!!salvo}); }
        const salvo=await banco.obter(chave);
        if(salvo?.versao===2 && salvo.dominio===dominio)job=salvo;
      }
      limparChamadasAntigas(job); limparExpiradas(job,agora());
      const ultimaLeitura=Date.parse(job.descoberta.releituraTentadaEm || job.descoberta.coletadoEm);
      // A failed initial read should not suppress retries for a whole day.
      // Keep a minimum interval so repeated page loads do not hammer a site.
      const leituraFalhou=job.descoberta.paginasLidas===0 && Number.isFinite(ultimaLeitura) && agora()-ultimaLeitura>=900_000;
      const precisaDescobrir=opcoes.planoId ? !job.descoberta.planoPreparadoEm :
        (!job.descoberta.coletadoEm || agora()-Date.parse(job.descoberta.coletadoEm)>=DIA || leituraFalhou) &&
        (!job.descoberta.releituraTentadaEm || agora()-Date.parse(job.descoberta.releituraTentadaEm)>=900_000);
      if(precisaDescobrir) {
        let coleta;
        try{coleta=await coletar(dominio);}catch{coleta={dominio,paginas:[],falhas:[]};}
        const descoberta=descobrir(coleta);
        // A failed re-read cannot erase a still-current SERP observation or
        // label yesterday's discovery as newly observed.
        if(!descoberta.candidatos.length && job.candidatos.length) {
          job.descoberta.releituraTentadaEm=new Date(agora()).toISOString();
          job.descoberta.releituraIndisponivel=true;job.descoberta.limitada=true;
          const aviso='A nova leitura não confirmou termos suficientes. Os candidatos anteriores mantêm suas datas originais; as posições têm validade própria.';
          if(!job.limites.includes(aviso))job.limites.push(aviso);
        }else{
          job.candidatos=descoberta.candidatos.slice(0,MAX_TERMOS);
          job.limites=descoberta.limites;
          job.descoberta={...descoberta.cobertura,paginasLidas:descoberta.cobertura?.paginasLidas??coleta.paginas.length,
            limitePaginas:12,limiteTermos:MAX_TERMOS,termosDescobertos:job.candidatos.length,coletadoEm:coleta.coletadoEm||new Date(agora()).toISOString(),
            ...(opcoes.planoId ? {planoPreparadoEm:new Date(agora()).toISOString()} : {})};
          const validos=new Map(job.candidatos.map(c=>[idTermo(c.termo),c.termo]));
          job.termos=Object.fromEntries(Object.entries(job.termos).filter(([k,q])=>validos.get(k)===q.termo));
          job.ativos=job.ativos.filter(k=>validos.has(k));
        }
        criado=true;
      }
      if(!job.candidatos.length) {if(banco)await banco.guardar(chave,job,7*DIA);return relatorio(job,agora());}
      if(!env.SERPAPI_KEY || !banco) {
        if(banco)await banco.guardar(chave,job,7*DIA);
        return relatorio(job,agora(),{codigo:!env.SERPAPI_KEY?'configuracao':'controle',reutilizado:!criado});
      }
      preencherGrupo(job,agora());
      // Crawling and SERP work run in separate bounded requests. Merely
      // re-opening a report does not repeat captures or consume another lot.
      if(criado || !continuacao || agora()-job.ultimoLote<ESPERA) {
        await banco.guardar(chave,job,7*DIA);
        return relatorio(job,agora(),{continuar:job.ativos.length>0,reutilizado:!criado});
      }
      let novas=0,reutilizadas=0,codigo=null;
      for(let passo=0;passo<LOTE;passo++) {
        limparExpiradas(job,agora()); preencherGrupo(job,agora());
        if(!job.ativos.length)break;
        if(Object.values(job.termos).reduce((n,q)=>n+q.paginas.length,0)>=MAX_CAPTURAS){codigo='limite';break;}
        if(agora()+25_000>prazo){codigo='prazo';break;}
        const k=job.ativos.slice().sort((a,b)=>job.termos[a].paginas.length-job.termos[b].paginas.length)[0];
        const q=job.termos[k], candidato=job.candidatos.find(c=>idTermo(c.termo)===k);
        const inicio=q.paginas.length?q.paginas.at(-1).proximoInicio:0, pagina=q.paginas.length+1;
        if(inicio==null || pagina>MAX_PAGINAS){q.concluida=true;job.ativos=job.ativos.filter(x=>x!==k);continue;}
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([q.termo,inicio,CONTEXTO])));
        const cacheKey='google-pagina-v2:'+Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
        let paginaToken=null;
        try {
          let p=await banco.obter(cacheKey), cache=!!p&&atual(p,agora())&&p.pagina===pagina&&p.termo===q.termo;
          if(!cache) {
            paginaToken=await banco.bloquear(cacheKey);
            if(!paginaToken)throw new ErroFonte('ocupada','Outra verificação em andamento.');
            p=await banco.obter(cacheKey);cache=!!p&&atual(p,agora())&&p.pagina===pagina&&p.termo===q.termo;
            if(!cache) {
              p=compactarPagina(await consultar({termo:q.termo,dominio,chave:env.SERPAPI_KEY,inicio,pagina},{agora,antesDaBusca:async()=>{
                if(agora()+13_000>prazo)throw new ErroFonte('prazo','Prazo encerrado.');
                let reservado;
                try{reservado=await banco.reservar(dominio);}catch{throw new ErroFonte('controle','Controle indisponível.');}
                if(!reservado){const saldo=await banco.saldo(dominio);throw new ErroFonte(saldo.dominio===0?'cota_dominio':'cota','Franquia esgotada.');}
                novas++;
              }}));
              if(!atual(p,agora()) || p.inicio!==inicio || p.pagina!==pagina || p.termo!==q.termo)throw new ErroFonte('indisponivel','Captura inconsistente.');
              if(!p.resultados.length)throw new ErroFonte('indisponivel','Sem resultados confirmados.');
              // Only validated public capture fields are shared between targets.
              try { await banco.guardar(cacheKey,p,Math.max(1,Date.parse(p.coletadoEm)+HORA-agora())); }
              catch { if(!job.limites.includes('Uma captura não pôde ser guardada no cache compartilhado.'))job.limites.push('Uma captura não pôde ser guardada no cache compartilhado.'); }
            }
          }
          if(cache)reutilizadas++;
          if(!p.resultados.length)throw new ErroFonte('indisponivel','Sem resultados confirmados.');
          const identidade=p.resultados.map(r=>r.url).join('\n');
          if(q.paginas.some(ant=>ant.fonte.id===p.fonte.id || ant.resultados.map(r=>r.url).join('\n')===identidade)) {
            q.concluida=true;q.interrompidaPor='pagina_repetida';
          }else{
            q.paginas.push(p);q.tentadaEm=agora();delete q.falhou;
            if (!job.planoExterno) incluirRelacionadas(job,p,candidato);
            q.concluida=p.resultados.some(r=>pertence(r.dominio,dominio)) || p.proximoInicio==null || pagina>=MAX_PAGINAS;
            q.interrompidaPor=p.paginacaoInterrompida?'paginacao_inconsistente':pagina>=MAX_PAGINAS?'limite_paginas':null;
          }
          if(q.concluida)job.ativos=job.ativos.filter(x=>x!==k);
        }catch(erro){
          const cod=erro instanceof ErroFonte?erro.codigo:'controle';
          if(['cota','cota_dominio','configuracao','plano_incompativel','controle','prazo','ocupada'].includes(cod)){codigo=cod;break;}
          q.falhou=cod;q.tentadaEm=agora();q.interrompidaPor='fonte_indisponivel';q.concluida=false;
          job.ativos=job.ativos.filter(x=>x!==k);
        }finally{if(paginaToken)await banco.liberar(cacheKey,paginaToken).catch(()=>{});}
      }
      job.ultimoLote=agora();
      preencherGrupo(job,agora());
      let continuar=job.ativos.length>0 && !codigo;
      if(['prazo','ocupada'].includes(codigo))continuar=job.ativos.length>0;
      await banco.guardar(chave,job,7*DIA);
      return relatorio(job,agora(),{codigo,novas,reutilizadas,continuar,reutilizado:novas===0});
    }catch{
      limparExpiradas(job,agora());return relatorio(job,agora(),{codigo:'controle'});
    }finally{if(token)await banco.liberar(chave,token).catch(()=>{});}
  }
  return async function posicoes(entrada,env={}) {
    if(!entrada||typeof entrada!=='object'||Array.isArray(entrada)||Object.keys(entrada).some(k=>!['site','continuar'].includes(k))||('continuar'in entrada&&typeof entrada.continuar!=='boolean'))throw new ErroConsulta('Informe o domínio para descobrir buscas e acompanhar a verificação.');
    const dominio=normalizarSite(entrada.site);
    if(pendentes.has(dominio))return pendentes.get(dominio);
    if(pendentes.size>=2)throw new ErroConsulta('Há consultas em andamento. Tente novamente em instantes.');
    const tarefa=executar(dominio,entrada.continuar===true,env);pendentes.set(dominio,tarefa);
    try{return await tarefa;}finally{pendentes.delete(dominio);}
  };
}
