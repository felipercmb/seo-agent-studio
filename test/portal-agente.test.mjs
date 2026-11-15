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
