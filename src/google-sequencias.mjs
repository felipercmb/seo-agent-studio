import {createHash} from 'node:crypto';

const JANELA_MS=15*60*1000;
const reconhecida=c=>['capturada','parcial'].includes(c.estado)&&c.totalLinksReconhecidos>0;
const comDominios=c=>['capturada','parcial','dominios_exibidos'].includes(c.estado)&&Number.isInteger(c.totalBlocosWeb)&&c.totalBlocosWeb>0&&Array.isArray(c.dominiosExibidos)&&c.dominiosExibidos.length>0;
const paginaInterpretada=c=>reconhecida(c)||comDominios(c);
const alvoExibido=c=>comDominios(c)&&Number.isInteger(c.ordemDominioExibido)&&c.ordemDominioExibido>0&&c.ordemDominioExibido<=c.totalBlocosWeb;
const id=v=>'seq_'+createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24);
const contexto=c=>({origemGoogle:(()=>{try{return new URL(c.urlConsulta).hostname;}catch{return null;}})(),
  idiomaSolicitado:c.contexto?.idiomaSolicitado??null,paisSolicitado:c.contexto?.paisSolicitado??null,
  dispositivo:c.contexto?.dispositivo??'desconhecido',localidadeDeclarada:c.contexto?.localidadeDeclarada??null,
  pwsSolicitado:c.contexto?.pwsSolicitado??null,uuleSolicitado:c.contexto?.uuleSolicitado??null});
const instante=c=>Date.parse(c.coletadoEm);
const identidade=c=>c.capturaId||id([c.urlConsulta,c.coletadoEm,c.sha256Trecho]);

/** Organizes supplied observations. It does not query, fetch, paginate or
 * compute absolute rank. URL start is just the requested pagination value. */
export function organizarSequenciasGoogle(capturas=[]){
  const grupos=new Map(),vistos=new Set();
  for(const c of (Array.isArray(capturas)?capturas:[]).slice(-100)){
    if(c?.parserVersao!==2||!Number.isFinite(instante(c))||!Number.isInteger(c.inicioSolicitado)||c.inicioSolicitado<0||c.inicioSolicitado>500||!c.chaveBusca||!c.dominio)continue;
    const ident=identidade(c);if(vistos.has(ident))continue;vistos.add(ident);
    const ctx=contexto(c),key=JSON.stringify([c.dominio,c.chaveBusca,ctx]);
    if(!grupos.has(key))grupos.set(key,{ctx,key,itens:[]});grupos.get(key).itens.push(c);
  }
  const sequencias=[];
  for(const {ctx,key,itens} of grupos.values()){
    const ordenadas=[...itens].sort((a,b)=>instante(b)-instante(a)||identidade(a).localeCompare(identidade(b))),janelas=[];
    for(const c of ordenadas){let janela=janelas.find(j=>j.maisRecente-instante(c)<=JANELA_MS);if(!janela){janela={maisRecente:instante(c),itens:[]};janelas.push(janela);}janela.itens.push(c);}
    for(const janela of janelas){
      const porInicio=new Map(),repeticoes=[],conflitos=[];
      for(const c of janela.itens){
        if(porInicio.has(c.inicioSolicitado)){
          const ant=porInicio.get(c.inicioSolicitado);
          if(instante(ant)===instante(c)&&ant.sha256Trecho!==c.sha256Trecho){
            conflitos.push({inicioSolicitado:c.inicioSolicitado,capturas:[identidade(ant),identidade(c)],motivo:'mesmo_horario_com_trechos_diferentes'});
            porInicio.set(c.inicioSolicitado,{...ant,estado:'capturas_conflitantes',totalLinksReconhecidos:null,ordemNaPagina:null,ordemDominioExibido:null,proximaPagina:null,resultados:[],dominiosExibidos:[],exibidosDoAlvo:[]});
          }else repeticoes.push({inicioSolicitado:c.inicioSolicitado,capturaId:identidade(c),substituidaPor:identidade(ant)});
          continue;
        }
        porInicio.set(c.inicioSolicitado,c);
      }
      const paginas=[...porInicio.values()].sort((a,b)=>a.inicioSolicitado-b.inicioSolicitado),cadeia=[],lacunas=[];
      let atual=porInicio.get(0),termino=atual?'sem_proxima_identificada':'primeira_pagina_nao_capturada';
      while(atual){
        cadeia.push(atual);
        if(!paginaInterpretada(atual)){termino='pagina_requer_conferencia';break;}
        if(!atual.proximaPagina){termino='sem_proxima_identificada';break;}
        const proxima=paginas.find(c=>c.urlConsulta===atual.proximaPagina&&c.inicioSolicitado>atual.inicioSolicitado);
        if(!proxima){termino='proxima_pagina_sem_captura';lacunas.push({aposCapturaId:identidade(atual),url:atual.proximaPagina});break;}
        atual=proxima;
      }
      const idsCadeia=new Set(cadeia.map(identidade)),linksPorPagina=new Map();
      for(const c of paginas.filter(reconhecida))for(const url of new Set((c.resultados||[]).map(r=>r.url))){
        const aparicoes=linksPorPagina.get(url)||[];aparicoes.push(identidade(c));linksPorPagina.set(url,aparicoes);
      }
      const encontros=paginas.filter(c=>reconhecida(c)&&Number.isInteger(c.ordemNaPagina)&&c.ordemNaPagina>0).map(c=>({capturaId:identidade(c),inicioSolicitado:c.inicioSolicitado,ordemNaPagina:c.ordemNaPagina,
        coletadoEm:c.coletadoEm,naSequenciaDesdePrimeira:idsCadeia.has(identidade(c))}));
      const primeiro=cadeia.find(c=>reconhecida(c)&&c.ordemNaPagina>0);
      const encontrosDominiosExibidos=paginas.filter(alvoExibido).map(c=>({capturaId:identidade(c),inicioSolicitado:c.inicioSolicitado,ordemBloco:c.ordemDominioExibido,coletadoEm:c.coletadoEm,naSequenciaDesdePrimeira:idsCadeia.has(identidade(c)),urlDestino:null,posicaoGoogle:null}));
      const primeiroDominio=cadeia.find(alvoExibido),recentes=paginas.every(c=>c.atual===true),validas=cadeia.filter(paginaInterpretada);
      const estado=primeiro?'site_observado_na_sequencia':encontros.length?'site_observado_fora_da_sequencia':primeiroDominio?'dominio_exibido_na_sequencia':encontrosDominiosExibidos.length?'dominio_exibido_fora_da_sequencia':validas.some(comDominios)?'alvo_nao_identificado_nas_observacoes':validas.length?'site_nao_observado_no_recorte':'requer_conferencia';
      sequencias.push({id:id([key,janela.maisRecente]),dominio:paginas[0].dominio,termo:paginas[0].termo,chaveBusca:paginas[0].chaveBusca,
        contextoSolicitado:ctx,contextoEfetivoConfirmado:false,estado,recente:recentes,
        primeiraColetaEm:new Date(Math.min(...janela.itens.map(instante))).toISOString(),ultimaColetaEm:new Date(janela.maisRecente).toISOString(),
        janelaMaximaMs:JANELA_MS,posicaoGoogle:null,termino,
        paginasCapturadas:paginas.length,paginasReconhecidas:paginas.filter(reconhecida).length,paginasComDominiosExibidos:paginas.filter(comDominios).length,paginasInterpretadas:paginas.filter(paginaInterpretada).length,paginasEncadeadas:cadeia.length,
        paginas:paginas.map(c=>({capturaId:identidade(c),inicioSolicitado:c.inicioSolicitado,coletadoEm:c.coletadoEm,estado:c.estado,
          totalLinksReconhecidos:c.totalLinksReconhecidos,ordemNaPagina:c.ordemNaPagina??null,ordemDominioExibido:alvoExibido(c)?c.ordemDominioExibido:null,totalBlocosWeb:comDominios(c)?c.totalBlocosWeb:null,naSequenciaDesdePrimeira:idsCadeia.has(identidade(c)),sha256Trecho:c.sha256Trecho})),
        encontros,primeiroEncontroNaSequencia:primeiro?encontros.find(e=>e.capturaId===identidade(primeiro)):null,
        encontrosDominiosExibidos,primeiroDominioExibidoNaSequencia:primeiroDominio?encontrosDominiosExibidos.find(e=>e.capturaId===identidade(primeiroDominio)):null,
        paginasForaDaSequencia:paginas.filter(c=>!idsCadeia.has(identidade(c))).map(identidade),lacunas,repeticoes,conflitos,
        linksEmMaisDeUmaPagina:[...linksPorPagina].filter(([,ids])=>ids.length>1).map(([url,capturas])=>({url,capturas})),
        proximaAcao:!porInicio.has(0)?'capturar_primeira_pagina':termino==='proxima_pagina_sem_captura'?'capturar_proxima_pagina':termino==='pagina_requer_conferencia'?'conferir_pagina':'rever_recorte',
        limites:['Mesma consulta e parâmetros solicitados em até 15 minutos não comprovam mesma localização efetiva ou personalização.',
          'A sequência segue apenas os links de próxima página preservados. Páginas avulsas e repetidas ficam explícitas.',
          'Início solicitado, número de páginas e quantidade de links não são convertidos em posição absoluta.',
          'A citação de um domínio permite registrar seu bloco e a continuidade publicada, mantendo a URL de destino e a posição absoluta desconhecidas.',
          'Não haver próximo link reconhecido não comprova que os resultados terminaram. Ausência no recorte não é ausência no Google.']});
    }
  }
  return sequencias.sort((a,b)=>Date.parse(b.ultimaColetaEm)-Date.parse(a.ultimaColetaEm)||a.id.localeCompare(b.id));
}
