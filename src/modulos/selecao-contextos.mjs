import {normalizarSite} from '../consulta.mjs';

const normal = valor => typeof valor === 'string' ? valor.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim() : '';
const lista = valor => Array.isArray(valor) ? valor : [];
const DIA = 86400_000;
function paginaAtual(e, dominio, instante) {
  if(!e || typeof e.trecho!=='string' || !e.trecho.trim() || !/^[a-f0-9]{64}$/i.test(e.sha256 || ''))return false;
  const data=Date.parse(e.coletadoEm);
  if(!Number.isFinite(data) || data>instante || instante-data>=DIA)return false;
  try {
    const u=new URL(e.url);
    return ['http:','https:'].includes(u.protocol) && !u.username && !u.password && !u.port && !u.search && !u.hash && normalizarSite(u.href)===dominio;
  }catch{return false;}
}

/** Select evidence for a useful review; do not fill the budget with slogans. */
export function selecionarContextosNegocio(projeto, relatorio, {agora=Date.now}={}) {
  const instante=typeof agora==='function' ? agora() : agora;
  const dominio=normalizarSite(projeto.dominio);
  const ofertas=new Set(lista(projeto.perfil?.ofertas).map(o=>o.id).filter(Boolean));
  const atividades=lista(projeto.perfil?.entendimento?.atuacoes).filter(a=>['programa_social','captacao','participacao'].includes(a.tipo));
  const publicados=lista(projeto.palavras?.candidatos).filter(c=>c.origem==='site');
  const elegiveis=[],excluidos=[];
  for(const c of publicados){
    let motivo=null;
    const atividade=c.atuacaoId && atividades.some(a=>a.id===c.atuacaoId || normal(a.nome)===normal(c.termo));
    if((!c.ofertaId || !ofertas.has(c.ofertaId)) && !atividade)motivo='sem_oferta_ou_atividade_relacionada';
    else if(!atividade && (['navegacional','indefinida'].includes(c.intencao) ||
      ['negacao','institucional','atendimento','participacao'].includes(c.contextoFonte)))motivo='intencao_ou_contexto_nao_comercial';
    else if(!paginaAtual(c.evidencia,dominio,instante))motivo='origem_sem_evidencia_atual';
    if(motivo)excluidos.push({termo:c.termo,motivo});else elegiveis.push(c);
  }
  const ordem=new Map(elegiveis.map((c,i)=>[normal(c.termo),i]));
  const paginas=new Set(elegiveis.map(c=>c.evidencia.url));
  const melhorias=lista(relatorio.melhorias).filter(m=>{
    if(['diretiva-noindex-html','diretiva-noindex-http'].includes(m.verificacaoId))return true;
    return paginas.has(m.paginaAlvo);
  });
  const oportunidades=lista(relatorio.oportunidades).filter(o=>ordem.has(normal(o.termo)))
    .slice().sort((a,b)=>ordem.get(normal(a.termo))-ordem.get(normal(b.termo)));
  return {relatorio:{...relatorio,oportunidades,melhorias},
    selecao:{versao:2,criterio:'oferta_publicada_e_achado_verificavel',candidatosPublicados:publicados.length,
      candidatosElegiveis:elegiveis.length,excluidos,
      limite:'Até três páginas com oferta ou atividade publicada relacionada, ou diretiva de publicação observada. Navegação e termos sem atuação não preenchem o recorte. A seleção não comprova demanda, participação nem retorno.'}};
}
