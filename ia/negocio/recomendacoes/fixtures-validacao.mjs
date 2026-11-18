import{criarControlesRecomendacao}from'./controles.mjs';
export function fixturesValidacao(){
  const cs=criarControlesRecomendacao(),fs=cs.map(c=>({id:c.id,entrada:{tarefa:'recomendar',perfil:c.perfilOracle,fontes:c.fontes.map(({id,texto,tipo})=>({id,texto,tipo}))},saida:c.planejamentoEsperado,esperado:true}));
  const base=fs.find(c=>c.saida.estado==='proposta');
  const mutar=(id,fn,esperado=false)=>{const c=structuredClone(base);c.id=id;fn(c);c.esperado=esperado;fs.push(c);};
  mutar('chave-extra',c=>c.saida.lucro=1000);
  mutar('fonte-desconhecida',c=>c.saida.criterios[0].fontes=['fantasma']);
  mutar('fonte-global-ausente',c=>c.saida.fontes=[]);
  mutar('escopo-inventado',c=>c.saida.criterios[0].escopo='todos os interessados');
  mutar('alternativa-inventada',c=>c.saida.alternativas[0].texto='comprador elegível automaticamente');
  mutar('acao-extensa',c=>c.saida.acao='a'.repeat(421));
  mutar('incerteza-vazia',c=>c.saida.incertezas=[]);
  mutar('hipotese-falsa',c=>c.saida.hipotese=false);
  mutar('refs-duplicadas',c=>c.saida.fontes.push(c.saida.fontes[0]));
  mutar('criterio-interface',c=>{c.entrada.fontes[0].tipo='interface';});
  mutar('entrada-fonte-chave-extra',c=>c.entrada.fontes[0].url='https://example.invalid/');
  mutar('entrada-id-invalido',c=>c.entrada.fontes[0].id='f.01');
  mutar('financeiro-positivo',c=>c.saida.acao='Isso garante lucro.');
  mutar('financeiro-negado',c=>c.saida.acao='Não podemos garantir retorno. Confira a condição publicada.',true);
  mutar('limite-unicode-600-pontos',c=>{const t=c.entrada.fontes[0].texto;c.entrada.fontes[0].texto=t+'😀'.repeat(600-[...t].length);},true);
  const a=structuredClone(fs[0]);a.id='abstencao-com-fonte';a.saida.fontes=[a.entrada.fontes[0].id];a.esperado=false;fs.push(a);
  return fs;
}
