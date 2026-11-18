import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

const html=readFileSync(new URL('../src/portal.html',import.meta.url),'utf8');
function trecho(inicio,fim){
  const a=html.indexOf(inicio),b=html.indexOf(fim,a);
  assert.ok(a>=0&&b>a,'As funções reais da interface devem estar disponíveis.');
  return html.slice(a,b);
}
const funcoes=trecho('function validarRelatorioAgente(', 'function validarRelatorioPosicoes(');
const elementos=trecho('function elem(', 'function endereco(');
const imprimir=trecho('function imprimir(', "window.addEventListener('afterprint'");

class Elemento {
  constructor(tag){this.tagName=tag;this.children=[];this.attrs={};this.eventos={};this._texto='';this.hidden=false;}
  set textContent(valor){this._texto=String(valor);this.children=[];}
  get textContent(){return this._texto+this.children.map(c=>typeof c==='string'?c:c.textContent).join(' ');}
  set innerHTML(_valor){throw new Error('HTML não deve ser usado para apresentar evidências.');}
  append(...filhos){this.children.push(...filhos);}
  replaceChildren(...filhos){this.children=filhos;this._texto='';}
  setAttribute(nome,valor){this.attrs[nome]=String(valor);}
  removeAttribute(nome){delete this.attrs[nome];}
  addEventListener(nome,fn){this.eventos[nome]=fn;}
  focus(){this.focado=true;}
}
const nos=raiz=>[raiz,...raiz.children.filter(c=>c instanceof Elemento).flatMap(nos)];
function contexto(){
  const painelAgente=new Elemento('section'),espelho=new Elemento('article'),timers=new Map(),pedidos=[];
  let id=0;
  const c={URL,AbortController,Date,document:{createElement:tag=>new Elemento(tag),createDocumentFragment:()=>new Elemento('fragment'),
      getElementById:id=>nos(painelAgente).find(no=>no.id===id),body:{classList:{add(){},remove(){}}}},
    painelAgente,espelho,agenteAtual:null,pedidoAgente:null,dominioAgente:null,timerAgente:null,revisaoAgente:0,
    IA_LOCAL_HABILITADA:true,IA_CANDIDATA_HABILITADA:true,pedidoIA:null,relatorioIA:null,erroIA:null,executandoIA:false,revisaoIA:0,modoIA:'padrao',
    filtroAgente:'todas',limiteAgente:5,dataHora:valor=>valor||'data indisponível',
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:n=>timers.delete(n),
    fetch:(url,opcoes)=>new Promise(resolve=>pedidos.push({url,opcoes,resolve})),
    pedido:null,timerContinuacao:null,atual:null,diagnosticoAtual:null,impressao:null,
    pausarPosicoes(){},exibirPosicoes:()=>new Elemento('ranking'),exibirDiagnostico:()=>new Elemento('diagnostico'),window:{print(){c.impressoes++;}},impressoes:0};
  runInNewContext(elementos+funcoes+imprimir,c);
  return {c,timers,pedidos,painelAgente,espelho,
    disparar(){const [chave,timer]=[...timers].find(([,t])=>t.ms===200)||[];assert.ok(timer,'deve haver debounce pendente');timers.delete(chave);timer.fn();}};
}
function oportunidade(extra={}){
  return {id:'a',termo:'Contratar manutenção',paginaAlvo:'https://negocio.com/manutencao',decisao:'investigar',
    intencao:{tipo:'comercial',rotulo:'Contratação',motivo:'Sinal no texto; precisa de confirmação.'},posicao:null,marco:null,
    motivo:'Confirmar a posição e a oferta antes de investir.',potencial:'Hipótese de encontrar pessoas interessadas no serviço.',
    evidencias:[{tipo:'site',url:'https://negocio.com/manutencao',trecho:'Serviço de manutenção',coletadoEm:'2026-11-15T12:00:00Z'}],
    concorrentes:[],acoes:[{titulo:'Conferir a oferta',descricao:'Verifique se o serviço é oferecido nesta página.',base:'hipotese'}],
    medir:['Registrar pedidos qualificados.'],faltam:['Volume de buscas e conversões não medidos.'],...extra};
}
function relatorio(extra={}){
  return {versao:1,dominio:'negocio.com',geradoEm:'2026-11-15T12:01:00Z',metodo:'regras-abertas-v1',estado:'parcial',
    resumo:{termosAnalisados:1,posicoesAtuais:0,priorizar:0,desenvolver:0,proteger:0,investigar:1},
    oportunidades:[oportunidade()],frentes:[],melhorias:[],limites:['Não há previsão de vendas.'],...extra};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function responder(pedido,rel){pedido.resolve({ok:true,json:async()=>rel});await tick();}

test('contrato do agente exige domínio, versão e listas válidas; posição ausente continua null',()=>{
  const {c}=contexto(),r=relatorio();assert.equal(c.validarRelatorioAgente(r,'negocio.com'),r);
  for(const ruim of [null,{...r,versao:2},{...r,metodo:'modelo-opaco'},{...r,dominio:'outro.com'},
    {...r,geradoEm:'data inventada'},{...r,resumo:{}},{...r,limites:null},{...r,melhorias:Array(7).fill({})},
    {...r,oportunidades:[oportunidade({posicao:101})]},{...r,oportunidades:[oportunidade({posicao:'12'})]},
    {...r,oportunidades:[oportunidade({acoes:[{titulo:'x',descricao:'x',base:'comprovada'}]})]}]){
    assert.throws(()=>c.validarRelatorioAgente(ruim,'negocio.com'),/incompleta/);
  }
});

test('IA experimental apresenta apenas sugestões aceitas, com evidência tratada como texto',()=>{
  const {c}=contexto();
  c.relatorioIA={resultados:[{estado:'recusada',orientacao_padrao:'NÃO MOSTRAR',motivos_aplicabilidade:['Falta fonte.']},
    {estado:'revisao_necessaria',orientacao_padrao:'Conferir o título.',limite_padrao:'Revisão necessária.',
      evidencias_citadas:[{tipo:'pagina',descricao:'<script>instrução indevida</script>',pagina:'javascript:alert(1)',sha256_pagina:'a'.repeat(64)}]}]};
  const painel=c.exibirIA('negocio.com');assert.match(painel.textContent,/Sugestão bloqueada/);
  assert.doesNotMatch(painel.textContent,/NÃO MOSTRAR/);assert.match(painel.textContent,/<script>/);
  assert.ok(!nos(painel).some(n=>['script','a'].includes(n.tagName)));assert.match(painel.textContent,/SHA-256/);
});

test('interface distingue orientação por regra de escolha do modelo',()=>{
  const {c}=contexto();
  c.relatorioIA={resultados:[{estado:'revisao_necessaria',origem:'regra',orientacao_padrao:'Confirme a intenção de publicação.',
    limite_padrao:'A intenção não é conhecida.',evidencias_citadas:[]},
    {estado:'revisao_necessaria',origem:'ia',orientacao_padrao:'Revise a página.',limite_padrao:'Revise a escolha.',evidencias_citadas:[]}]};
  const texto=c.exibirIA('negocio.com').textContent;
  assert.match(texto,/Escolha por regra verificada/);assert.match(texto,/Escolha da IA/);
});

test('a interface explica quando uma regra substitui uma escolha da IA',()=>{
  const {c}=contexto();c.relatorioIA={resultados:[{estado:'revisao_necessaria',origem:'regra',ajustada_por_regra:true,
    aviso:'A IA não citou um diagnóstico específico.',orientacao_padrao:'Investigue a demanda.',
    limite_padrao:'A demanda não foi medida.',evidencias_citadas:[]}]};
  const texto=c.exibirIA('negocio.com').textContent;
  assert.match(texto,/Escolha por regra verificada/);assert.match(texto,/IA não citou um diagnóstico/);
});

test('evidência atual da busca mostra termo, posição, concorrente e captura sem interpretar HTML',()=>{
  const {c}=contexto();
  c.relatorioIA={resultados:[{estado:'revisao_necessaria',origem:'regra',orientacao_padrao:'Compare os resultados.',
    limite_padrao:'Não sabemos a causa.',evidencias_citadas:[{tipo:'serp',termo:'oferta <script>x</script>',
      atual:true,posicao:27,pagina:'https://negocio.com/',concorrentes:[{pagina:'https://rival.example/',posicao:3},
        {pagina:'javascript:alert(1)',posicao:5}],fontes_serp:[{id:'captura_123',sha256:'a'.repeat(64),descricao:'Página 3'}]}]}]};
  const painel=c.exibirIA('negocio.com');
  assert.match(painel.textContent,/Busca: oferta <script>x<\/script>/);assert.match(painel.textContent,/Posição observada: 27/);
  assert.match(painel.textContent,/posição 3/);assert.match(painel.textContent,/rival\.example/);
  assert.match(painel.textContent,/captura_123/);assert.match(painel.textContent,/SHA-256 da captura/);
  assert.ok(!nos(painel).some(n=>n.tagName==='script'));
  assert.ok(!nos(painel).some(n=>n.tagName==='a'&&String(n.href).startsWith('javascript:')));
});

test('recorte sem posição mostra páginas examinadas sem inventar classificação',()=>{
  const {c}=contexto();
  c.relatorioIA={resultados:[{estado:'revisao_necessaria',origem:'regra',orientacao_padrao:'Confira o recorte.',
    limite_padrao:'A posição é desconhecida.',evidencias_citadas:[{tipo:'serp',termo:'busca de teste',
      atual:false,posicao:null,estado_fonte:'nao_observado_recorte',
      recorte_serp:[{id:'captura_123',sha256:'a'.repeat(64),observado_em:'2026-11-15T12:00:00Z'}]}]}]};
  const texto=c.exibirIA('negocio.com').textContent;
  assert.match(texto,/Página examinada: captura captura_123/);assert.match(texto,/SHA-256 da captura/);
  assert.doesNotMatch(texto,/Posição observada:/);
});

test('passos específicos aparecem somente quando a evidência corresponde ao mesmo diagnóstico',()=>{
  const {c}=contexto(),data='2026-11-15T12:00:00Z',hash='a'.repeat(64),url='https://negocio.com/oferta';
  const melhoria={paginaAlvo:url,sha256Pagina:hash,evidencia:'Nenhum title foi identificado.',coletadoEm:data,
    orientacao:'Confira o título da página.',passos:['Abra a página.','Peça revisão do título <script>não executar</script>.']};
  c.agenteAtual=relatorio({melhorias:[melhoria]});
  const evidencia={id:'d1',tipo:'pagina',pagina:url,atual:true,sha256_pagina:hash,observado_em:data,descricao:melhoria.evidencia};
  c.relatorioIA={resultados:[{estado:'revisao_necessaria',escolha_ia:{acao:'melhorar_pagina'},
    orientacao_padrao:'Revise a página.',limite_padrao:'Não garante posição.',evidencias_citadas:[evidencia]}]};
  let painel=c.exibirIA('negocio.com');assert.match(painel.textContent,/Como conferir este ponto/);
  assert.match(painel.textContent,/Confira o título da página/);assert.match(painel.textContent,/<script>não executar<\/script>/);
  assert.ok(!nos(painel).some(n=>n.tagName==='script'));
  evidencia.sha256_pagina='b'.repeat(64);painel=c.exibirIA('negocio.com');
  assert.doesNotMatch(painel.textContent,/Como conferir este ponto/);
});

test('identifica o termo a investigar só quando há correspondência única com a origem',()=>{
  const {c}=contexto(),data='2026-11-15T12:00:00Z',hash='a'.repeat(64),url='https://negocio.com/oferta';
  const origem={tipo:'site',url,trecho:'Serviço de manutenção',sha256:hash,coletadoEm:data};
  const oferta=oportunidade({termo:'Manutenção de equipamentos',paginaAlvo:url,evidencias:[origem]});
  c.agenteAtual=relatorio({oportunidades:[oferta]});
  const evidencia={id:'p1',tipo:'pagina',pagina:url,atual:true,sha256_pagina:hash,observado_em:data,descricao:origem.trecho};
  c.relatorioIA={resultados:[{estado:'revisao_necessaria',escolha_ia:{acao:'validar_demanda'},
    orientacao_padrao:'Investigue a procura.',limite_padrao:'A procura não foi medida.',evidencias_citadas:[evidencia]}]};
  assert.match(c.exibirIA('negocio.com').textContent,/Termo para investigar: Manutenção de equipamentos/);
  c.agenteAtual.oportunidades.push({...oferta,termo:'Outro termo'});
  assert.doesNotMatch(c.exibirIA('negocio.com').textContent,/Termo para investigar:/);
});

test('mudança de domínio descarta resposta atrasada da IA e solicita apenas o site',async()=>{
  const a=contexto();a.c.prepararAgente('negocio.com');a.c.agenteAtual=relatorio();
  const pedido=a.c.analisarIA('negocio.com');assert.equal(a.pedidos[0].url,'/api/ia');
  assert.deepEqual(JSON.parse(a.pedidos[0].opcoes.body),{site:'negocio.com'});
  a.c.prepararAgente('novo.com');assert.equal(a.pedidos[0].opcoes.signal.aborted,true);
  a.pedidos[0].resolve({ok:true,json:async()=>({versao:1,estado:'experimental',dominio:'negocio.com',resultados:[{estado:'recusada'}]})});
  await pedido;assert.equal(a.c.relatorioIA,null);assert.doesNotMatch(a.painelAgente.textContent,/Sugestão bloqueada/);
});

test('ajuste não aprovado é optativo e usa rota fixa com aviso visível',async()=>{
  const a=contexto();a.c.prepararAgente('negocio.com');a.c.agenteAtual=relatorio();
  const pendente=a.c.analisarIA('negocio.com',true);
  assert.equal(a.pedidos[0].url,'/api/ia-candidata');assert.deepEqual(JSON.parse(a.pedidos[0].opcoes.body),{site:'negocio.com'});
  a.pedidos[0].resolve({ok:true,json:async()=>({versao:1,estado:'experimental',dominio:'negocio.com',resultados:[{estado:'recusada'}]})});
  await pendente;assert.match(a.painelAgente.textContent,/não atingiu todos os critérios/);
  assert.match(a.painelAgente.textContent,/Resultado do novo ajuste em avaliação/);
});

test('filtro mantém a ordem recebida, mostra cinco por vez e permite chegar aos cem',()=>{
  const {c}=contexto(),entrada=Array.from({length:100},(_,i)=>oportunidade({id:String(i),decisao:i%2?'investigar':'priorizar'}));
  const primeiro=c.filtrarOportunidades(entrada);assert.equal(primeiro.itens.length,5);assert.equal(primeiro.total,100);assert.equal(primeiro.temMais,true);
  const todos=c.filtrarOportunidades(entrada,'todas',999);assert.equal(todos.itens.length,100);assert.equal(todos.temMais,false);
  const categoria=c.filtrarOportunidades(entrada,'priorizar',10);assert.equal(categoria.total,50);assert.equal(categoria.itens[1],entrada[2]);
  assert.equal(c.filtrarOportunidades(entrada,'proteger').total,0);assert.equal(entrada.length,100);
  assert.equal(c.rotuloDecisaoAgente('__proto__'),'Investigar primeiro');
});

test('estado sem dados não cria oportunidades, posição ou retorno prometido',()=>{
  const {c}=contexto(),r=relatorio({estado:'sem_dados',oportunidades:[],resumo:{termosAnalisados:0,posicoesAtuais:0,priorizar:0,desenvolver:0,proteger:0,investigar:0}});
  const tela=c.exibirAgente(r);assert.match(tela.textContent,/Ainda não há evidências suficientes/);
  assert.match(tela.textContent,/não previsão de vendas/);assert.ok(!tela.textContent.includes('Posição observada:'));
  assert.equal(nos(tela).filter(no=>no.className==='oportunidade').length,0);
});

test('render mantém hipótese sem posição e trata texto da evidência como texto; links perigosos não viram âncoras',()=>{
  const {c}=contexto();
  const o=oportunidade({termo:'<img src=x onerror=alert(1)>',paginaAlvo:'javascript:alert(1)',
    evidencias:[{tipo:'site',trecho:'<script>exfiltrar()</script>',url:'https://usuario:segredo@negocio.com',coletadoEm:'2026-11-15T12:00:00Z'}]});
  const item=c.oportunidadeAgente(o,false);assert.match(item.textContent,/Posição não verificada/);
  assert.match(item.textContent,/Intenção inferida/);assert.match(item.textContent,/<script>exfiltrar/);
  assert.ok(!nos(item).some(no=>['img','script'].includes(no.tagName)));
  assert.ok(!nos(item).some(no=>no.tagName==='a'));
});

test('duas evidências próximas disparam uma análise local após debounce, sem chamar Google ou diagnóstico',async()=>{
  const a=contexto();a.c.prepararAgente('negocio.com');a.c.agendarAgente('negocio.com');a.c.agendarAgente('negocio.com');
  assert.equal(a.pedidos.length,0);assert.equal([...a.timers.values()].filter(t=>t.ms===200).length,1);
  a.disparar();assert.equal(a.pedidos.length,1);assert.equal(a.pedidos[0].url,'/api/agente');
  assert.deepEqual(JSON.parse(a.pedidos[0].opcoes.body),{site:'negocio.com'});
  await responder(a.pedidos[0],relatorio());assert.equal(a.c.agenteAtual.dominio,'negocio.com');assert.equal(a.painelAgente.attrs['aria-busy'],undefined);
});

test('trocar domínio limpa a análise imediatamente e ignora resposta atrasada do site anterior',async()=>{
  const a=contexto();a.c.prepararAgente('negocio.com');a.c.agendarAgente('negocio.com');a.disparar();const antigo=a.pedidos[0];
  a.c.agenteAtual=relatorio();a.c.redesenharAgente();assert.match(a.painelAgente.textContent,/Contratar manutenção/);
  a.c.prepararAgente('novo.com');assert.equal(a.c.agenteAtual,null);assert.ok(!a.painelAgente.textContent.includes('Contratar manutenção'));assert.equal(antigo.opcoes.signal.aborted,true);
  a.c.agendarAgente('novo.com');a.disparar();await responder(antigo,relatorio());assert.equal(a.c.agenteAtual,null);
  const novo=relatorio({dominio:'novo.com'});await responder(a.pedidos[1],novo);assert.equal(a.c.agenteAtual,novo);
});

test('uma revisão nova invalida resposta antiga do mesmo domínio, mesmo se o transporte ignorar abort',async()=>{
  const a=contexto();a.c.prepararAgente('negocio.com');a.c.agendarAgente('negocio.com');a.disparar();
  a.c.agendarAgente('negocio.com');a.disparar();assert.equal(a.pedidos[0].opcoes.signal.aborted,true);
  const nova=relatorio({geradoEm:'2026-11-15T12:05:00Z'});await responder(a.pedidos[1],nova);
  await responder(a.pedidos[0],relatorio());assert.equal(a.c.agenteAtual,nova);
});

test('erro da API preserva relatório anterior com aviso de que novas evidências não foram incorporadas',async()=>{
  const a=contexto();a.c.prepararAgente('negocio.com');const anterior=relatorio();a.c.agenteAtual=anterior;
  a.c.agendarAgente('negocio.com');a.disparar();a.pedidos[0].resolve({ok:false,json:async()=>({erro:'falha'})});await tick();
  assert.equal(a.c.agenteAtual,anterior);assert.match(a.painelAgente.textContent,/novas evidências ainda não foram incorporadas/);
  assert.equal(nos(a.painelAgente).find(n=>n.attrs.role==='alert')?.tagName,'div');
});

test('impressão inclui todos os dados recebidos do agente, ignora filtro da tela e não inicia consultas',()=>{
  const a=contexto(),r=relatorio({oportunidades:Array.from({length:8},(_,i)=>oportunidade({id:String(i),termo:'Termo '+i}))});
  a.c.prepararAgente('negocio.com');a.c.agenteAtual=r;a.c.atual={dominio:'negocio.com'};a.c.filtroAgente='proteger';
  a.c.agendarAgente('negocio.com');assert.equal([...a.timers.values()].filter(t=>t.ms===200).length,1);
  a.c.imprimir({disabled:false});assert.equal(a.pedidos.length,0);assert.equal(a.c.impressoes,1);
  assert.equal([...a.timers.values()].filter(t=>t.ms===200).length,0);
  assert.match(a.espelho.textContent,/2026-11-15T12:01:00Z/);assert.match(a.espelho.textContent,/Termo 7/);
  assert.equal(nos(a.espelho).filter(no=>no.className==='oportunidade').length,8);
  assert.equal(nos(a.espelho).filter(no=>no.tagName==='details'&&!no.open).length,0);
});
