const CAMPOS=['papel','finalidade','ofertas','publicos','atuacoes','condicoes'];
const FALTAM=new Set([...CAMPOS,'canal','modelo_receita']);
const normal=t=>String(t).normalize('NFKC').replace(/\s+/gu,' ').trim();
const objeto=x=>x&&typeof x==='object'&&!Array.isArray(x);
function exigir(ok,mensagem){if(!ok)throw Error(mensagem);}
function span(texto,fonte){
  const alvo=normal(texto),origem=normal(fonte);let i=origem.indexOf(alvo);
  while(i!==-1){const antes=origem[i-1],depois=origem[i+alvo.length];if((!antes||!/[\p{L}\p{N}_+#]/u.test(antes))&&(!depois||!/[\p{L}\p{N}_+#]/u.test(depois)))return true;i=origem.indexOf(alvo,i+1);}return false;
}

/** Mechanical validation only; it cannot approve meaning or client use. */
export function validarCasoRotulado(caso){
  exigir(typeof caso.id==='string'&&caso.id.length<=120,'ID de caso inválido.');
  exigir(Array.isArray(caso.fontes)&&caso.fontes.length<=16,'Limite de fontes inválido.');
  const fontes=new Map();
  for(const f of caso.fontes){exigir(objeto(f)&&typeof f.id==='string'&&f.id.length<=160&&!fontes.has(f.id),'ID de fonte inválido/duplicado.');exigir(typeof f.texto==='string'&&f.texto.trim()&&f.texto.length<=600,'Texto de fonte inválido.');exigir(['declaracao','descricao','conteudo','interface'].includes(f.tipo),'Tipo de fonte inválido.');exigir(/^[a-f0-9]{64}$/.test(f.sha256||'')&&Number.isFinite(Date.parse(f.coletadoEm)),'Fonte sem hash/data válidos.');fontes.set(f.id,f);}
  exigir(objeto(caso.alvosPorCampo)&&Object.keys(caso.alvosPorCampo).sort().join()===CAMPOS.slice().sort().join(),'Seis campos obrigatórios.');
  const resultados=[];
  for(const campo of CAMPOS){const alvo=caso.alvosPorCampo[campo];exigir(objeto(alvo)&&Object.keys(alvo).sort().join()==='estado,faltam,fontes,valor','Quatro chaves obrigatórias em '+campo);exigir(['hipotese','insuficiente'].includes(alvo.estado),'Estado inválido.');exigir(Array.isArray(alvo.faltam)&&alvo.faltam.every(x=>FALTAM.has(x))&&new Set(alvo.faltam).size===alvo.faltam.length,'Faltam inválido.');
    const validarRefs=refs=>{exigir(Array.isArray(refs)&&new Set(refs).size===refs.length,'Referências inválidas.');for(const id of refs)exigir(fontes.has(id)&&fontes.get(id).tipo!=='interface','Interface/referência ausente usada como prova de entendimento.');};validarRefs(alvo.fontes);
    if(['papel','finalidade'].includes(campo)){const permitidos=campo==='papel'?['intermediacao','servicos','produtos','misto','indefinido']:['comercial','social','mista','indefinida'];exigir(permitidos.includes(alvo.valor),'Enum inválido.');if(alvo.estado==='insuficiente')exigir(alvo.valor===(campo==='papel'?'indefinido':'indefinida'),'Enum de abstenção inválido.');}
    else{exigir(Array.isArray(alvo.valor)&&alvo.valor.length<=(campo==='publicos'?6:4),'Lista inválida.');if(alvo.estado==='insuficiente')exigir(alvo.valor.length===0,'Abstenção deve esvaziar a lista.');if(alvo.estado==='hipotese')exigir(alvo.valor.length>0,'Hipótese sem conteúdo.');
      for(const item of alvo.valor){const chaves=campo==='ofertas'||campo==='atuacoes'?['texto','tipo','fontes']:campo==='publicos'?['texto','funcao','escopo','fontes']:['texto','escopo','fontes'];exigir(objeto(item)&&Object.keys(item).sort().join()===chaves.sort().join(),'Item com chaves inválidas em '+campo);exigir(typeof item.texto==='string'&&item.texto.length>0&&item.texto.length<=(campo==='condicoes'?240:120),'Texto do item inválido.');validarRefs(item.fontes);exigir(item.fontes.length>0&&item.fontes.some(id=>span(item.texto,fontes.get(id).texto)),'Texto não literal nas fontes atribuídas: '+item.texto);exigir(item.fontes.every(id=>alvo.fontes.includes(id)),'Referência de item ausente no alvo.');
        if(campo==='publicos')exigir(['cliente','beneficiario','prestador','participante','apoiador','excluido','indefinido'].includes(item.funcao),'Função de público inválida.');if(campo==='ofertas')exigir(['produto','servico','indefinido'].includes(item.tipo),'Tipo da oferta inválido.');if(campo==='atuacoes')exigir(['programa','participacao','captacao','informacao'].includes(item.tipo),'Tipo da atuação inválido.');
        if('escopo'in item)exigir(item.escopo===null||typeof item.escopo==='string'&&item.escopo.length>0&&item.escopo.length<=120&&item.fontes.some(id=>span(item.escopo,fontes.get(id).texto)),'Escopo não literal nas fontes.');
      }
    }
    exigir(alvo.estado==='insuficiente'||alvo.fontes.length>0,'Hipótese sem fonte.');resultados.push({casoId:caso.id,campo,estado:alvo.estado,validacaoMecanica:true});
  }
  return resultados;
}

export function ferramentasRotulagem(caso){
  const refs=ns=>ns.map(n=>{const id=caso.fontes[n-1]?.id;exigir(id,'Fonte ordinal ausente: '+caso.id+' '+n);return id;});
  const h=(valor,ns,faltam=[])=>({estado:'hipotese',valor,fontes:refs(ns),faltam});
  const lista=(valor,faltam=[])=>({estado:'hipotese',valor,fontes:[...new Set(valor.flatMap(v=>v.fontes))],faltam});
  const vazio=campo=>({estado:'insuficiente',valor:campo==='papel'?'indefinido':campo==='finalidade'?'indefinida':[],fontes:[],faltam:[campo]});
  return{h,lista,vazio,alvosVazios:()=>Object.fromEntries(CAMPOS.map(c=>[c,vazio(c)])),oferta:(texto,tipo,ns)=>({texto,tipo,fontes:refs(ns)}),publico:(texto,funcao,escopo,ns)=>({texto,funcao,escopo,fontes:refs(ns)}),atuacao:(texto,tipo,ns)=>({texto,tipo,fontes:refs(ns)}),condicao:(texto,escopo,ns)=>({texto,escopo,fontes:refs(ns)})};
}
