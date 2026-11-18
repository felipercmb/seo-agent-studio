import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext, Script} from 'node:vm';
import {test} from 'node:test';
import {revisarEscopoProposicoes} from '../src/modulos/escopo-proposicoes.mjs';

const html=readFileSync(new URL('../src/projeto.html',import.meta.url),'utf8');
const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1];
const render=script.slice(script.indexOf('function node('),script.indexOf('// END_RENDER_FUNCTIONS'));

class Elemento {
  constructor(tag){this.tagName=tag;this.children=[];this.attrs={};this.eventos={};this._texto='';this._value='';this.hidden=false;this.disabled=false;this.parent=null;this.classList={add(){},remove(){},toggle(){}};}
  set textContent(valor){this._texto=String(valor);this.children=[];}
  get textContent(){return this._texto+this.children.map(c=>typeof c==='string'?c:c.textContent).join(' ');}
  set innerHTML(_valor){throw new Error('Não interpretar HTML de uma evidência.');}
  set value(valor){this._value=String(valor);}
  get value(){return this._value;}
  append(...filhos){for(const filho of filhos){if(filho instanceof Elemento)filho.parent=this;this.children.push(filho);}}
  replaceChildren(...filhos){this.children=[];this._texto='';this.append(...filhos);}
  setAttribute(nome,valor){this.attrs[nome]=String(valor);}
  addEventListener(nome,fn){this.eventos[nome]=fn;}
  focus(){this.focado=true;}
  select(){this.selecionado=true;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  querySelector(seletor){return nos(this).find(n=>n.tagName===seletor);}
  reportValidity(){return true;}
  click(){this.clicado=true;this.eventos.click?.();}
}
const nos=raiz=>[raiz,...raiz.children.filter(c=>c instanceof Elemento).flatMap(nos)];
function contexto(completo=false){
  const body=new Elemento('body');
  for(const [id,tag] of [['site','input'],['site-form','form'],['abrir','button'],['status','p'],['erro','p'],['report','div']]){const n=new Elemento(tag);n.id=id;body.append(n);}
  const pedidos=[],timers=[],downloads=[];
  class URLTeste extends URL {static createObjectURL(blob){downloads.push(blob);return 'blob:teste-local';} static revokeObjectURL(){}}
  const c={URL:URLTeste,Date,Number,Blob,AbortController,document:{body,createElement:tag=>new Elemento(tag),
    getElementById:id=>nos(body).find(n=>n.id===id),querySelectorAll:seletor=>nos(body).filter(n=>seletor.split(',').includes(n.tagName))},
    fetch:(url,opcoes)=>new Promise(resolve=>pedidos.push({url,opcoes,resolve})),setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:id=>{if(timers[id-1])timers[id-1].cancelado=true;}};
  runInNewContext(completo?script:render,c);
  return {c,body,pedidos,timers,downloads,get:id=>c.document.getElementById(id)};
}
function projeto(extra={}){return{versao:1,dominio:'negocio.com',revisao:1,geradoEm:'2026-11-15T14:00:00Z',perfil:{estado:'rascunho',nome:'Negócio',resumo:'Oferece manutenção.',publico:'Empresas',regioes:[],exclusoes:[],ofertas:[{id:'o1',nome:'Manutenção industrial',url:'https://negocio.com/servico',origem:'site',economia:{contribuicaoPorVenda:null,taxaFechamento:null},evidencias:[]}],limites:[]},palavras:{candidatos:[],limites:[]},posicoes:null,demanda:{estado:'indisponivel'},oportunidades:{estado:'parcial',itens:[],limites:[]},historico:[],modulos:[],limites:[],...extra};}
const item=(extra={})=>({termo:'Contratar manutenção',prioridade:'investigar',motivo:'Oferta relacionada à intenção.',observado:{posicao:null,estado:'nao_medido',buscasMensais:null},acao:'Conferir a procura.',comoValidar:'Comparar contatos qualificados.',faltam:['Dados de procura'],confianca:'baixa',valorPorContato:null,evidencias:[],...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('FAQ e relato de cliente usam texto seguro, preservam origem e não expõem outros campos',()=>{
 const {c}=contexto(),f={pergunta:'Quem executa <script>teste</script>?',url:'javascript:alert(1)',trecho:'<img src=x onerror=alert(1)> A equipe do cliente executa a rotina.',sha256:'e'.repeat(64),coletadoEm:'2026-11-17T10:00:00Z',premissasEconomicas:{contribuicao:987654321}};
 const painel=c.exibirPerguntasPublicadas({perguntasPublicadas:[f]});assert.match(painel.textContent,/não confirmam quem executa/);assert.match(painel.textContent,/<img src=x/);assert.ok(!nos(painel).some(n=>n.href?.startsWith('javascript:')));assert.doesNotMatch(painel.textContent,/987654321/);
 const pend=c.exibirPendenciasDeOferta({pendenciasDeOrigem:[{...f,recomendacaoComercial:false,atribuicao:{estado:'relato_ou_resultado_de_terceiro',marcador:'clientes que cresceram'}}]});assert.match(pend.textContent,/Relatos de clientes/);assert.match(pend.textContent,/não comprova/);assert.doesNotMatch(pend.textContent,/987654321/);
});
test('sequência de Google mostra lacuna, contexto e ordem local sem somar start',()=>{
 const {c}=contexto(true),s={termo:'Busca autoral',paginasCapturadas:2,paginasEncadeadas:1,recente:true,contextoSolicitado:{origemGoogle:'www.google.com.br',idiomaSolicitado:'pt-BR',paisSolicitado:'br',pwsSolicitado:'0',uuleSolicitado:'UULE_AUTORAL',dispositivo:'computador'},encontros:[{inicioSolicitado:20,ordemNaPagina:2,naSequenciaDesdePrimeira:false}],paginasForaDaSequencia:['id'],lacunas:[{url:'https://www.google.com.br/search?q=Busca&udm=14&start=10'}],conflitos:[],repeticoes:[],linksEmMaisDeUmaPagina:[],proximaAcao:'capturar_primeira_pagina'};
 const d=c.exibirGoogleLocal(projeto({capacidades:{googleLocal:{disponivel:true}},googleLocal:{capturas:[],sequencias:[s]}}));assert.match(d.textContent,/páginas avulsas/);assert.match(d.textContent,/2º link reconhecido/);assert.match(d.textContent,/posição absoluta permanece desconhecida/);assert.doesNotMatch(d.textContent,/posição 22/);const a=nos(d).find(n=>n.textContent==='Abrir a primeira página desta busca');assert.equal(new URL(a.href).hostname,'www.google.com.br');assert.equal(new URL(a.href).searchParams.get('uule'),'UULE_AUTORAL');
});
test('código da extensão é criado somente por clique e fica fora da exportação do projeto',async()=>{
 const a=contexto(true);a.get('site').value='negocio.com';const r=projeto({capacidades:{googleLocal:{disponivel:true,conexaoDireta:true}},googleLocal:{capturas:[]}}),start=a.c.enviar('iniciar');await responder(a.pedidos[0],r);await start;assert.equal(a.pedidos.length,1);
 const click=a.get('conectar-extensao-google').eventos.click();await tick();assert.equal(a.pedidos.length,2);assert.equal(a.pedidos[1].url,'/api/google-local/conexao');assert.deepEqual(JSON.parse(a.pedidos[1].opcoes.body),{site:'negocio.com',revisao:1});const codigo='8794.'+'x'.repeat(43);await responder(a.pedidos[1],{codigoLocal:codigo,dominio:'negocio.com',expiraEm:'2026-11-17T12:00:00Z'});await click;assert.equal(a.get('codigo-conexao-google').value,codigo);a.c.exportar();assert.ok(!(await a.downloads[0].text()).includes(codigo));a.c.marcarAlterado();assert.equal(a.get('conectar-extensao-google').disabled,true);assert.equal(a.get('atualizar-capturas-google').disabled,true);
});
test('resposta vazia preserva a análise e orienta consultar estado salvo sem repetir uma mutação automaticamente',async()=>{
 const a=contexto(true);a.get('site').value='negocio.com';const p=projeto(),start=a.c.enviar('iniciar');await responder(a.pedidos[0],p);await start;
 const falha=a.c.enviar('analisar',{revisao:1});await tick();a.pedidos[1].resolve({ok:false,json:async()=>{throw new SyntaxError('Unexpected end of JSON input');}});await falha;assert.match(a.get('erro').textContent,/Abra a análise salva/);assert.match(a.get('status').textContent,/Não foi possível confirmar/);assert.equal(a.pedidos.length,2);assert.ok(a.get('titulo-projeto'));assert.doesNotMatch(a.get('erro').textContent,/SyntaxError|Unexpected end/);
 const abrir=a.c.enviar('consultar');await responder(a.pedidos[2],{...p,revisao:2});await abrir;assert.equal(JSON.parse(a.pedidos[2].opcoes.body).acao,'consultar');assert.match(a.get('report').textContent,/Revisão 2/);
});

test('publicação sem vínculo permanece revisável sem virar ação ou executar seu HTML',()=>{
 const {c}=contexto(),p={natureza:'pendencia_de_atribuicao',recomendacaoComercial:false,ofertaNome:'Serviço revisado',motivo:'O trecho precisa de vínculo com esta oferta.',fontesRecusadas:[{url:'javascript:alert(1)',trecho:'<img src=x onerror=alert(1)> Publicação de outro objeto.',campo:'p',sha256:'f'.repeat(64),coletadoEm:'2026-11-17T00:00:00Z'}],premissasEconomicas:{contribuicaoPorVenda:987654321}};
 const painel=c.exibirPendenciasDeOferta({pendenciasDeOferta:[p]});
 assert.match(painel.textContent,/escopo a revisar/);assert.match(painel.textContent,/não sustentam uma recomendação de edição/);
 assert.match(painel.textContent,/<img src=x onerror=alert\(1\)>/);
 assert.equal(nos(painel).filter(n=>n.tagName==='button').length,0);
 assert.ok(!nos(painel).some(n=>n.href?.startsWith('javascript:')));assert.doesNotMatch(painel.textContent,/987654321/);
 assert.equal(c.exibirPendenciasDeOferta({}).textContent,'');
});

test('caso controlado de decisão é apresentado como fictício, separado de publicação e declaração do cliente',()=>{
 const {c}=contexto();
 const painel=c.exibirOportunidades({regrasPrioridades:7,planoPrioritario:[{id:'caso',titulo:'Comparar alternativas',acao:'Conferir duas escolhas',eixo:'negocio',ofertasAfetadas:[],passos:[],modeloEntregavel:{campos:[{rotulo:'Entrada de teste',valorSugerido:'Pessoa fictícia com necessidade X',origem:'hipotese_controlada'},{rotulo:'Condição da publicação',valorSugerido:'Limite publicado Y',origem:'trecho_publicado'}]}}],itens:[]},{estado:'indisponivel'});
 assert.match(painel.textContent,/Caso proposto e fictício/);assert.match(painel.textContent,/não é necessidade observada do cliente/);assert.match(painel.textContent,/Origem: trecho publicado/);
});


test('captura do navegador mostra ordem local e não promove posição absoluta ou concorrentes sem alvo',()=>{
 const {c}=contexto();
 const dados={metodo:'captura_declarada_pagina_aberta',termo:'Serviço <script>teste</script>',estado:'parcial',coletadoEm:'2026-11-17T00:00:00.000Z',atual:false,inicioSolicitado:20,totalLinksReconhecidos:1,ordemNaPagina:null,termoNaSelecao:false,contexto:{dispositivo:'computador'},outrosResultados:[{ordemNaPagina:1,url:'javascript:alert(1)',titulo:'Texto <b>literal</b>'}],limites:[],sha256Trecho:'a'.repeat(64),capturaId:'gl1_'+'a'.repeat(64)};
 const painel=c.exibirGoogleLocal(projeto({googleLocal:{capturas:[dados]}}));
 assert.match(painel.textContent,/Histórica/);assert.match(painel.textContent,/posição exata é desconhecida/);
 assert.match(painel.textContent,/não confirmam quem está antes/);assert.match(painel.textContent,/<script>teste<\/script>/);
 assert.ok(!nos(painel).some(n=>n.href?.startsWith('javascript:')));
 assert.doesNotMatch(painel.textContent,/Posição observada: 21|posição 21/);
});
test('importação do navegador só começa por clique e envia a captura à API local',async()=>{
 const a=contexto(true);a.get('site').value='negocio.com';const r=projeto({capacidades:{posicoes:{configurada:false},googleLocal:{disponivel:true}},palavras:{candidatos:[{termo:'Contratar serviço'}],limites:[]},googleLocal:{capturas:[]}});
 const start=a.c.enviar('iniciar');await responder(a.pedidos[0],r);await start;assert.equal(a.pedidos.length,1);
 const arquivo={formato:'visibilidade-google-local',versao:1,metodo:'pagina_aberta',html:'<div>teste</div>'};
 a.get('arquivo-google-local').files=[{size:100,text:async()=>JSON.stringify(arquivo)}];
 const click=a.get('importar-google-local').eventos.click();await tick();
 assert.equal(a.pedidos.length,2);assert.equal(a.pedidos[1].url,'/api/projeto');
 const body=JSON.parse(a.pedidos[1].opcoes.body);assert.equal(body.acao,'registrar_google_local');assert.deepEqual(body.captura,arquivo);assert.equal(body.revisao,1);
 await responder(a.pedidos[1],{...r,revisao:2});await click;assert.match(a.get('status').textContent,/Captura local salva/);
 const externo=nos(a.get('report')).find(n=>n.tagName==='a'&&n.textContent==='Abrir esta busca na aba Web do Google');assert.ok(externo.href.includes('udm=14'));assert.equal(new URL(externo.href).searchParams.get('q'),'Contratar serviço');
});
test('arquivo inválido ou grande não envia requisição nem substitui a análise',async()=>{
 const a=contexto(true);a.get('site').value='negocio.com';const r=projeto({capacidades:{googleLocal:{disponivel:true}},googleLocal:{capturas:[]}});
 const start=a.c.enviar('iniciar');await responder(a.pedidos[0],r);await start;
 for(const f of [{size:60001,text:async()=>'{}'},{size:5,text:async()=>'{'}]){
  a.get('arquivo-google-local').files=[f];await a.get('importar-google-local').eventos.click();assert.equal(a.pedidos.length,1);
 }
 assert.match(a.get('erro').textContent,/JSON válida/);assert.ok(a.get('report').textContent.includes('O que seu negócio faz'));
});

async function responder(pedido,r,ok=true){pedido.resolve({ok,json:async()=>r});await tick();}

test('prioridades refinadas conservam observações sem republicar ações legadas incompatíveis',()=>{
  const {c}=contexto();const tarefa={id:'atual',titulo:'Conferir limite publicado',acao:'Ação atual com escopo a confirmar',eixo:'negocio',passos:['Conferir a fonte'],criterioSucesso:'Registro da conferência',ofertasAfetadas:[]};
  const painel=c.exibirOportunidades({regrasPrioridades:2,planoPrioritario:[tarefa],planoDeAcao:[{...tarefa,titulo:'AÇÃO LEGADA'}],frentes:[{ofertaNome:'FRENTE LEGADA'}],itens:[item({motivo:'MOTIVO LEGADO',acao:'DECISÃO LEGADA',observado:{posicao:12,buscasMensais:100}})]},{estado:'disponivel'});
  assert.match(painel.textContent,/Ação atual com escopo a confirmar/);assert.match(painel.textContent,/Posição observada 12/);assert.match(painel.textContent,/100 buscas mensais/);
  assert.doesNotMatch(painel.textContent,/AÇÃO LEGADA|FRENTE LEGADA|MOTIVO LEGADO|DECISÃO LEGADA/);
  assert.match(painel.textContent,/ações atuais estão no plano por oferta/);
});

test('ausência de prioridade refinada não restaura plano antigo descartado',()=>{
  const {c}=contexto();const painel=c.exibirOportunidades({regrasPrioridades:2,planoPrioritario:[],planoDeAcao:[{titulo:'Escolher com trecho recortado',passos:[],ofertasAfetadas:[]}],itens:[]},{estado:'indisponivel'});
  assert.doesNotMatch(painel.textContent,/Escolher com trecho recortado/);assert.match(painel.textContent,/não sustentam uma prioridade executável/);
});

test('editar jornada conserva custos em faixa, zero declarado e coorte das premissas',()=>{
  const {c}=contexto();const valores={origem:'registro_local',referencia:'Resumo interno de contatos distintos',inicio:'2026-10-01',fim:'2026-10-31',populacao:'Pedidos do serviço industrial',criterio:'Empresa com data e escopo de manutenção',contatos:'20',fechamentos:'0',minContrib:'100',maxContrib:'300',minTaxa:'',maxTaxa:'',aquisicao:'',fixos:'',minAquisicao:'200',maxAquisicao:'450',minFixos:'500',maxFixos:'900'};
  const linha={nome:{value:'Manutenção industrial'},url:{value:'https://negocio.com/servico'},contribuicao:{value:''},taxa:{value:''},jornada:{comprador:{value:'Gestor industrial'},objetivo:{value:'Retomar a linha de produção'}},premissas:Object.fromEntries(Object.entries(valores).map(([k,value])=>[k,{value}]))};
  const oferta=c.montarOferta(linha),p=oferta.premissasEconomicas;
  assert.equal(oferta.jornada.objetivo,'Retomar a linha de produção');
  assert.deepEqual(JSON.parse(JSON.stringify(p.custosAquisicao)),{escopo:'total_periodo_coorte',total:{tipo:'intervalo',minimo:200,maximo:450}});
  assert.equal(p.custosFixos.total.maximo,900);assert.equal(p.fechamento.fechamentos,0);assert.equal(p.fechamento.contatosQualificados,20);assert.equal(p.periodo.fim,'2026-10-31');
  linha.removerPremissas=true;assert.equal(c.montarOferta(linha).premissasEconomicas,null);
});

test('corrigir o objetivo retira confirmação e exige nova revisão explícita',async()=>{
  const a=contexto(true);a.get('site').value='negocio.com';const r=projeto();r.perfil.estado='confirmado';
  const p=a.c.enviar('iniciar');await responder(a.pedidos[0],r);await p;
  assert.equal(a.get('confirmado').checked,true);
  a.get('perfil-form').eventos.input({target:{id:'objetivo-editado'}});
  assert.equal(a.get('confirmado').checked,false);assert.equal(a.get('medir').disabled,true);
  a.get('confirmado').checked=true;a.get('perfil-form').eventos.input({target:a.get('confirmado')});
  assert.equal(a.get('confirmado').checked,true);
});

test('script da interface modular tem sintaxe válida e não inicia chamadas nem monitoramento ao abrir',()=>{
  assert.doesNotThrow(()=>new Script(script));const a=contexto(true);assert.equal(a.pedidos.length,0);assert.equal(a.timers.length,0);
  assert.match(html,/<html lang="pt-BR">/);assert.match(html,/role="alert"/);assert.match(html,/prefers-reduced-motion/);
});

test('contrato incompleto não substitui análise e limites de ofertas e palavras são exigidos',()=>{
  const {c}=contexto();const valido=projeto();assert.equal(c.validarProjeto(valido),valido);
  for(const r of [null,{...valido,versao:2},{...valido,revisao:0},{...valido,perfil:{estado:'confirmado',ofertas:Array(9).fill({})}},
    {...valido,palavras:{candidatos:Array(101).fill({})}},{...valido,historico:null}])assert.throws(()=>c.validarProjeto(r),/incompleta/);
});

test('descoberta mostra a origem e não executa markup ou links maliciosos',()=>{
  const {c}=contexto();const painel=c.exibirPalavras({candidatos:[{termo:'<img src=x onerror=alert(1)>',origem:'hipotese',intencao:'comercial',motivo:'<script>roubar()</script>',evidencia:{url:'javascript:alert(1)',trecho:'Título <b>não interpretar</b>'}}]});
  assert.match(painel.textContent,/Sugestão a validar/);assert.match(painel.textContent,/<script>roubar/);
  assert.ok(!nos(painel).some(n=>['img','script','b'].includes(n.tagName)));
  assert.ok(!nos(painel).some(n=>n.tagName==='a'));
  assert.equal(c.linkSeguro('https://user:password@negocio.com').tagName,'span');
});

test('mapa liga oferta a pergunta de investigação sem promover intenção ou vínculo de página a fato',()=>{
  const {c}=contexto(),painel=c.exibirMapaInvestigacao({versao:1,porOferta:[{nome:'Intermediação de artistas',objetivo:'Encontrar uma apresentação para a data',comprador:'Organizador',pagina:{url:'https://negocio.com/contrate'},primeirasBuscas:[{termo:'contratar artista gospel',origem:'hipotese',intencao:'comercial',questao:'Qual apresentação atende ao evento?',observado:{estado:'nao_medido',posicao:null}}],outrasBuscas:4,proximoPasso:'Conferir intenção e página',limite:'Não recomenda verba.'}],semVinculo:{quantidade:1,primeirasBuscas:[{termo:'show',questao:'É uma oferta ou tema amplo?'}]},outrasAtividades:{quantidade:0},limites:[]});
  assert.match(painel.textContent,/Intermediação de artistas|contratar artista gospel/);assert.match(painel.textContent,/hipótese de intenção/);
  assert.match(painel.textContent,/não confirma o conteúdo/);assert.match(painel.textContent,/Posição ainda não medida/);
  assert.match(painel.textContent,/4 outras expressões/);assert.match(painel.textContent,/show — É uma oferta ou tema amplo/);
  assert.doesNotMatch(painel.textContent,/R\$|Posição observada 0|retorno garantido/);
});

test('leitura por atividade conserva sujeito, ação e objeto sem exibir hipótese como cliente ou pagamento confirmado',()=>{
  const {c}=contexto(true),resultado={versao:3,ofertasAnalisadas:1,ofertasIdentificadas:1,ofertas:[{nome:'Ferramenta Aurora',natureza:'software',papel_site:'disponibiliza',fonteNome:'s01',citacoes:[],jornada:{proposicoes:[{sujeito:'A ferramenta',tipoSujeito:'ferramenta',acao:'organiza',objeto:'os pedidos',relacao:'executa',relacaoOrigem:'regra_verbo_literal',escopo:'uso',unidadeLiteral:{texto:'A ferramenta organiza os pedidos.'},citacoes:[]}],condicoes:[],incertezas:[]}}],incertezas:[],limite:'Revisão pendente.'};
  const painel=c.exibirProposicoesNovo({proposicoesNovo:{job:{estado:'concluido',resultado}}});
  assert.match(painel.textContent,/A ferramenta — organiza os pedidos/);assert.match(painel.textContent,/interpretação e os papéis continuam pendentes/);
  assert.match(painel.textContent,/Tipo proposto: ferramenta/);assert.doesNotMatch(painel.textContent,/Comprador confirmado|Pagamento confirmado|Confiabilidade alta/);
  assert.match(painel.textContent,/categoria da relação foi atribuída por uma regra do programa/);
});

test('escopo de outra página aparece somente como interpretação pendente sem alterar o job ou o perfil',async()=>{
  const a=contexto(true),sha256='a'.repeat(64),fonte=(id,url)=>({id,texto:'Declaração publicada.',contexto:{url,sha256}});
  a.get('site').value='negocio.com';
  const resultado={versao:3,dominio:'negocio.com',ofertasAnalisadas:1,ofertasIdentificadas:1,ofertas:[{nome:'Boleto',fonteNome:'s1',citacoes:[fonte('s1','https://negocio.com/boleto')],jornada:{proposicoes:[
    {id:'p1',sujeito:'O titular',acao:'emite',objeto:'boletos',unidadeLiteral:{texto:'O titular emite boletos.'},citacoes:[fonte('s1','https://negocio.com/boleto')]},
    {id:'p2',sujeito:'<script>Cliente</script>',acao:'gera',objeto:'QR code',unidadeLiteral:{texto:'<img src=x onerror=alert(1)> é texto preservado.'},citacoes:[fonte('s2','https://negocio.com/pix')]}],condicoes:[],incertezas:[]}}],incertezas:[],limite:'Interpretação pendente.'};
  const antes=JSON.stringify(resultado),r=projeto({proposicoesNovo:{job:{estado:'concluido',resultado},revisaoEscopo:revisarEscopoProposicoes(resultado)}});
  const p=a.c.enviar('iniciar');await responder(a.pedidos[0],r);await p;
  const painel=a.get('report'),pendente=nos(painel).find(n=>n.tagName==='details'&&n.children.some(c=>c.tagName==='summary'&&c.textContent.startsWith('Interpretações com escopo a confirmar')));
  assert.ok(pendente);assert.match(pendente.textContent,/<script>Cliente<\/script> gera QR code/);
  assert.match(pendente.textContent,/não prova que a relação esteja errada/);
  assert.ok(nos(pendente).some(n=>n.href==='https://negocio.com/pix'));
  const propostas=nos(painel).filter(n=>n.tagName==='summary').map(n=>n.textContent);
  assert.ok(propostas.includes('O titular — emite boletos'));
  assert.ok(!propostas.some(t=>t.includes('Cliente')&&t.includes('QR code')));
  assert.ok(!nos(painel).some(n=>['script','img'].includes(n.tagName)));
  assert.equal(JSON.stringify(resultado),antes);assert.equal(a.pedidos.length,1);
  assert.equal(r.perfil.ofertas.length,1);assert.equal(r.perfil.ofertas[0].nome,'Manutenção industrial');
});

test('copiar a leitura por atividade mantém atores vazios, usa prova do nome e exige nova confirmação',async()=>{
  const a=contexto(true);a.get('site').value='negocio.com';const r=projeto();r.perfil.estado='confirmado';
  r.proposicoesNovo={job:{estado:'concluido',resultado:{versao:3,ofertasAnalisadas:1,ofertasIdentificadas:1,ofertas:[{nome:'Ferramenta Aurora',natureza:'software',papel_site:'disponibiliza',fonteNome:'s01',citacoes:[{id:'s02',texto:'Implantação',contexto:{url:'https://negocio.com/implantacao'}},{id:'s01',texto:'Ferramenta Aurora',contexto:{url:'https://negocio.com/aurora'}}],jornada:{proposicoes:[],condicoes:[],incertezas:[]}}],incertezas:[],limite:'Hipótese.'}}};
  const inicial=a.c.enviar('iniciar');await responder(a.pedidos[0],r);await inicial;
  nos(a.body).find(n=>n.tagName==='button'&&n.textContent==='Copiar nome e tipo para conferir').eventos.click();
  assert.equal(a.get('confirmado').checked,false);assert.equal(a.pedidos.length,1);
  assert.match(a.get('ofertas').textContent,/Rascunho sugerido pela IA/);
  a.get('confirmado').checked=true;a.get('perfil-form').eventos.submit({preventDefault(){}});
  const pedido=JSON.parse(a.pedidos[1].opcoes.body),nova=pedido.perfil.ofertas.find(o=>o.nome==='Ferramenta Aurora');
  assert.equal(nova.url,'https://negocio.com/aurora');assert.equal(nova.entrega.tipoOferta,'software');
  assert.ok(Object.values(nova.jornada).every(v=>v===''));assert.equal(pedido.perfil.ofertas[0].nome,'Manutenção industrial');
  await responder(a.pedidos[1],{...r,revisao:2});
});

test('poll da alternativa por atividade consulta o modo correto e preserva rascunho não salvo',async()=>{
  const a=contexto(true);a.get('site').value='negocio.com';const r=projeto({proposicoesNovo:{estado:'em_execucao',job:{estado:'em_execucao'}}});
  const p=a.c.enviar('iniciar');await responder(a.pedidos[0],r);await p;
  a.timers.at(-1).fn();assert.equal(JSON.parse(a.pedidos[1].opcoes.body).acao,'consultar_proposicoes');
  await responder(a.pedidos[1],r);a.get('perfil-form').eventos.input();const n=a.pedidos.length;
  a.timers.at(-1).fn();assert.equal(a.pedidos.length,n);assert.equal(a.get('confirmado').checked,false);
});

test('cem candidatos continuam acessíveis sem truncar silenciosamente a lista',()=>{
  const {c}=contexto();const painel=c.exibirPalavras({candidatos:Array.from({length:100},(_,i)=>({termo:'Busca '+i,origem:'site',intencao:'indefinida'}))});
  const tbody=nos(painel).find(n=>n.tagName==='tbody');assert.equal(tbody.children.filter(n=>!n.hidden).length,20);
  nos(painel).find(n=>n.tagName==='button').eventos.click();assert.equal(tbody.children.filter(n=>!n.hidden).length,100);
});

test('ausência no recorte não vira posição nem afirma que concorrentes estão à frente',()=>{
  const {c}=contexto();const painel=c.exibirPosicoes({estado:'parcial',cobertura:{verificadas:1,pendentes:2},consultas:[{termo:'Serviço',estado:'nao_encontrado',posicao:null,profundidadeObservada:19,paginas:[{pagina:1},{pagina:2}],resultados:[{url:'https://rival.com',dominio:'rival.com',posicao:2}],contexto:{pais:'Brasil',idioma:'Português',dispositivo:'Computador',localidade:'Brasil'},coletadoEm:'2026-11-15T13:00:00Z'}]});
  assert.match(painel.textContent,/Posição exata desconhecida/);assert.match(painel.textContent,/não confirmam quem está à frente/);
  assert.match(painel.textContent,/19 resultados observados/);assert.match(painel.textContent,/Brasil \/ Português \/ Brasil \/ Computador/);
  assert.doesNotMatch(painel.textContent,/Posição observada:/);
});

test('fonte ausente aparece como indisponível, sem posições fabricadas',()=>{
  const {c}=contexto();const painel=c.exibirPosicoes({estado:'fonte_nao_configurada',aviso:'Configure uma fonte.',consultas:[],cobertura:{verificadas:0,pendentes:7}});
  assert.match(painel.textContent,/Fonte não configurada/);assert.match(painel.textContent,/7 ainda pendentes/);assert.doesNotMatch(painel.textContent,/Posição observada:/);
});

test('volume ausente, zero explícito e valor por contato não são confundidos com receita',()=>{
  const {c}=contexto();const ausente=c.exibirOportunidades({itens:[item()]},{estado:'indisponivel'});
  assert.match(ausente.textContent,/Volume de buscas indisponível/);assert.doesNotMatch(ausente.textContent,/0 buscas mensais/);
  const zero=c.exibirOportunidades({itens:[item({observado:{posicao:12,estado:'encontrado',buscasMensais:0},valorPorContato:{valor:0,moeda:'BRL',natureza:'cenario_declarado'}})]},{estado:'parcial',fonte:'Fonte exemplo',periodoInicio:'2026-09',periodoFim:'2026-10',pais:'Brasil',idioma:'Português'});
  assert.match(zero.textContent,/0 buscas mensais/);assert.match(zero.textContent,/parcialmente disponível/);assert.doesNotMatch(zero.textContent,/Valor por contato|R\$/);assert.match(zero.textContent,/Período: 2026-09 a 2026-10/);
});

test('percentual do formulário converte para fração mantendo vazio desconhecido e zero explícito',()=>{
  const {c}=contexto();const linha={id:'o1',nome:{value:'Manutenção'},url:{value:''},contribuicao:{value:''},taxa:{value:''}};
  let resultado=c.montarOferta(linha);assert.equal(resultado.economia.contribuicaoPorVenda,null);assert.equal(resultado.economia.taxaFechamento,null);
  linha.contribuicao.value='0';linha.taxa.value='12.345';resultado=c.montarOferta(linha);assert.equal(resultado.economia.contribuicaoPorVenda,0);assert.equal(resultado.economia.taxaFechamento,.12345);
  for(const taxa of ['101','-1','Infinity']){linha.taxa.value=taxa;assert.throws(()=>c.montarOferta(linha),/Confira/);}
});

test('médias compartilhadas de variantes não viram volume individual da oportunidade',()=>{
  const {c}=contexto();const tela=c.exibirOportunidades({itens:[item()]},{estado:'parcial',grupos:[{termos:['contratar artista','contratação de artista'],buscasMensais:500}]});
  assert.match(tela.textContent,/Média mensal do conjunto de variantes: 500/);assert.match(tela.textContent,/Não atribua esta média a cada termo/);assert.match(tela.textContent,/Volume de buscas indisponível/);
  assert.doesNotMatch(tela.textContent,/Estimativa histórica: 500 buscas mensais/);
});

test('interface exige confirmação para medir e bloqueia ações que perderiam perfil não salvo',async()=>{
  const a=contexto(true);a.get('site').value='negocio.com';const pendente=a.c.enviar('iniciar');assert.equal(a.pedidos.length,1);
  assert.equal(a.pedidos[0].url,'/api/projeto');assert.deepEqual(JSON.parse(a.pedidos[0].opcoes.body),{site:'negocio.com',acao:'iniciar'});assert.equal(a.pedidos[0].opcoes.credentials,'same-origin');
  await responder(a.pedidos[0],projeto());await pendente;assert.equal(a.get('medir').disabled,true);assert.equal(a.get('analisar').disabled,true);assert.equal(a.timers.length,0);
  const salvo=projeto();salvo.perfil.estado='confirmado';const consulta=a.c.enviar('consultar');await responder(a.pedidos[1],salvo);await consulta;
  assert.equal(a.get('medir').disabled,false);a.get('perfil-form').eventos.input();assert.equal(a.get('medir').disabled,true);assert.equal(a.get('reler-site').disabled,true);
  await a.c.enviar('consultar');assert.equal(a.pedidos.length,2);assert.match(a.get('erro').textContent,/Salve o perfil/);
  nos(a.body).find(n=>n.tagName==='button'&&n.textContent==='Descartar alterações').eventos.click();assert.equal(a.get('medir').disabled,false);
});

test('erro preserva relatório exibido e atualização depende de ação explícita',async()=>{
  const a=contexto(true);a.get('site').value='negocio.com';let p=a.c.enviar('iniciar');await responder(a.pedidos[0],projeto());await p;
  const texto=a.get('report').textContent;p=a.c.enviar('historico');assert.equal(a.get('site').disabled,true);
  await responder(a.pedidos[1],{erro:'Falha local temporária.'},false);await p;
  assert.equal(a.get('report').textContent,texto);assert.match(a.get('erro').textContent,/Falha local/);assert.equal(a.get('site').disabled,false);assert.equal(a.pedidos.length,2);assert.equal(a.timers.length,0);
});

test('comparar sugestões não sobrescreve os campos revisados nem transforma a data da fonte em coleta nova',async()=>{
  const a=contexto(true);a.get('site').value='negocio.com';let chamada=a.c.enviar('iniciar');
  const salvo=projeto();salvo.perfil.resumo='Entendimento corrigido pelo responsável';salvo.perfil.ofertas[0].nome='Oferta corrigida';
  await responder(a.pedidos[0],salvo);await chamada;
  chamada=a.c.enviar('revisar_leitura',{revisao:salvo.revisao});
  assert.deepEqual(JSON.parse(a.pedidos[1].opcoes.body),{site:'negocio.com',acao:'revisar_leitura',revisao:1});
  const comProposta={...salvo,propostaDaLeitura:{coletadoEm:'2026-10-01T12:00:00Z',perfil:{resumo:'Hipótese da leitura',ofertas:[{nome:'Oferta encontrada no site',evidencias:[]}]}}};
  await responder(a.pedidos[1],comProposta);await chamada;
  assert.ok(nos(a.get('perfil-form')).some(n=>n.tagName==='textarea'&&n.value==='Entendimento corrigido pelo responsável'));
  assert.ok(nos(a.get('perfil-form')).some(n=>n.value==='Oferta corrigida'));
  assert.match(a.get('report').textContent,/Oferta encontrada no site/);
  assert.match(a.get('report').textContent,/a coleta não foi renovada/);
  assert.match(a.get('report').textContent,/Nenhuma sugestão foi aplicada automaticamente/);
  a.get('perfil-form').eventos.input();assert.equal(a.get('revisar-leitura').disabled,true);
  await a.c.enviar('revisar_leitura',{revisao:1});assert.equal(a.pedidos.length,2);assert.match(a.get('erro').textContent,/Salve o perfil/);
});

test('diagnóstico contextual mantém evidências e não cria falhas a partir de ausência de leitura',()=>{
  const {c}=contexto();const painel=c.exibirDiagnostico({estado:'parcial',verificacoes:[{estado:'atencao',titulo:'Identifique os campos',orientacao:'Confira os rótulos.',evidencia:{url:'https://negocio.com/',trecho:'2 controles sem nome.'},passos:['Adicionar <label> aos campos.']},{estado:'manual',titulo:'Não é falha confirmada'}]});
  assert.match(painel.textContent,/2 controles sem nome/);assert.match(painel.textContent,/<label>/);assert.doesNotMatch(painel.textContent,/Não é falha confirmada/);assert.ok(!nos(painel).some(n=>n.tagName==='label'));
  assert.match(c.exibirDiagnostico({estado:'indisponivel'}).textContent,/leitura não foi suficiente/);
});

test('histórico usa texto compreensível sem serialização técnica do resumo',()=>{
  const {c}=contexto();assert.equal(c.resumirEvento({resumo:{perfil:'confirmado',palavras:8,verificadas:2,fonte:'parcial'}}),'Perfil: Confirmado. 8 buscas candidatas; 2 buscas com observações válidas nesta execução. Fonte: Parcial.');
});

test('histórico de captura local resume o recorte e mantém entradas antigas legíveis',()=>{
  const {c}=contexto();
  const antigo={acao:'registrar_google_local',resumo:{verificadas:0,fonte:'nao_consultada'}};
  assert.match(c.resumirEvento(antigo),/Captura do navegador registrada/);
  const recente={...antigo,resumo:{...antigo.resumo,googleLocal:{
    termo:'contratação de artistas',coletadoEm:'2026-11-17T20:00:00Z',totalBlocosWeb:10,ordemBloco:7,
  }}};
  const texto=c.resumirEvento(recente);
  assert.match(texto,/contratação de artistas.*10 blocos web reconhecidos.*bloco 7 do recorte/);
  assert.doesNotMatch(texto,/Ainda não consultada|posiç[ãa]o absoluta/);
  recente.resumo.googleLocal.totalBlocosWeb=0;
  assert.match(c.resumirEvento(recente),/recorte requer conferência/);
});

test('frentes reúnem trabalho por oferta sem somar volumes ou repetir cenário financeiro',()=>{
  const {c}=contexto();const painel=c.exibirFrentes([{nome:'Agenciamento',prioridade:'investigar',termos:['Contratar artista','Agenciamento gospel'],motivo:'Reunir a investigação.',
    paginaAlvo:{url:'https://negocio.com/contrate',origem:'declarada'},resumo:{termosPlanejados:2,posicoesAtuais:0,demandasIndividuais:1},
    proximoTeste:{titulo:'Conferir a página da oferta',acao:'Verificar próximo passo para contratar.',comoValidar:'Registrar a alteração.'},faltam:['Volume individual.']}]);
  assert.match(painel.textContent,/Um próximo passo para cada oferta/);
  assert.match(painel.textContent,/volumes e cenários não são somados/);
  assert.match(painel.textContent,/2 buscas ligadas à oferta; 0 com observações atuais/);
  assert.match(painel.textContent,/Conferir a página da oferta/);
});

test('piloto distingue respostas históricas, recusas e decisões por regra',()=>{
  const {c}=contexto();const painel=c.exibirIA({estado:'historica',geradoEm:'2026-11-15T14:00:00Z',revisaoOrigem:2,aviso:'Evidência mudou.',
    resultados:[{estado:'recusada',origem:'ia',erros:['id ausente']},{estado:'revisao_necessaria',origem:'regra',escolha_ia:{acao:'validar_intencao'},orientacao_padrao:'Conferir intenção.'}],contextos:[]});
  assert.match(painel.textContent,/Evidência mudou/);assert.match(painel.textContent,/Resposta recusada/);assert.match(painel.textContent,/Decisão de uma regra/);
  assert.match(painel.textContent,/Conferir a intenção/);assert.doesNotMatch(painel.textContent,/aceita para uso com clientes/);
});

test('perfil permite contestar papel e confirmação não esconde pendências',async()=>{
  const a=contexto(true);a.get('site').value='negocio.com';let p=a.c.enviar('iniciar');
  const r=projeto();r.perfil.entendimento={papel:'intermediacao',natureza:'hipotese',evidencias:[]};
  r.perfil.perguntas=[{pergunta:'Quem é o comprador?',motivo:'Pode diferir do beneficiário.'}];
  await responder(a.pedidos[0],r);await p;
  assert.match(a.get('report').textContent,/hipótese a confirmar/);assert.match(a.get('report').textContent,/Quem é o comprador/);
  a.get('papel-negocio').value='servicos';a.get('perfil-form').eventos.submit({preventDefault(){}});
  assert.equal(JSON.parse(a.pedidos[1].opcoes.body).perfil.papel,'servicos');
  assert.equal(JSON.parse(a.pedidos[1].opcoes.body).perfil.confirmado,false);
});

test('falta de fonte bloqueia medição e mostra motivo mesmo com perfil confirmado',async()=>{
  const a=contexto(true);a.get('site').value='negocio.com';const p=a.c.enviar('iniciar');
  const r=projeto({capacidades:{posicoes:{configurada:false},ia:{instalada:false}}});r.perfil.estado='confirmado';
  await responder(a.pedidos[0],r);await p;
  assert.equal(a.get('medir').disabled,true);assert.match(a.get('report').textContent,/sem fonte de posições/);
  assert.equal(a.get('analisar').disabled,false);
});

test('baixar plano preserva o projeto e recusa resposta de outra revisão',async()=>{
  const a=contexto(true);a.get('site').value='negocio.com';let p=a.c.enviar('iniciar');
  await responder(a.pedidos[0],projeto());await p;const antes=a.get('report').textContent;
  p=a.c.enviar('exportar_plano',{revisao:1});
  await responder(a.pedidos[1],{versao:1,dominio:'negocio.com',revisao:2,formato:'markdown',conteudo:'Outro plano'});await p;
  assert.equal(a.downloads.length,0);assert.equal(a.get('report').textContent,antes);
  p=a.c.enviar('exportar_plano',{revisao:1});
  await responder(a.pedidos[2],{versao:1,dominio:'negocio.com',revisao:1,formato:'markdown',conteudo:'# Plano local\nEvidências conferíveis.'});await p;
  assert.equal(a.downloads.length,1);assert.equal(await a.downloads[0].text(),'# Plano local\nEvidências conferíveis.');
  assert.equal(a.downloads[0].type,'text/markdown;charset=utf-8');
  assert.equal(a.get('report').textContent,antes);assert.match(a.get('status').textContent,/Plano de trabalho salvo/);
});

test('candidata sem piloto padrão é acessível e campos financeiros negativos continuam declarados',async()=>{
  const a=contexto(true);a.get('site').value='negocio.com';const p=a.c.enviar('iniciar');
  const r=projeto({capacidades:{ia:{instalada:false,candidata:true},posicoes:{configurada:false}}});r.perfil.estado='confirmado';
  await responder(a.pedidos[0],r);await p;
  assert.ok(a.get('experimentar-ia-candidata'));assert.equal(a.get('experimentar-ia-candidata').disabled,false);
  assert.equal(a.get('experimentar-ia'),undefined);
  const oferta=a.c.montarOferta({id:'o1',nome:{value:'Oferta'},url:{value:''},contribuicao:{value:'-120.50'},taxa:{value:'0'}});
  assert.equal(oferta.economia.contribuicaoPorVenda,-120.5);assert.equal(oferta.economia.taxaFechamento,0);
});

test('plano distingue hipótese de observação e não duplica o mesmo critério',()=>{
  const {c}=contexto();const painel=c.exibirPlanoDeAcao([{titulo:'Conferir contratação',base:'hipotese',acao:'Conferir o caminho.',
    criterioSucesso:'Contato possível sem dúvida.',comoValidar:'Contato possível sem dúvida.',passos:['Verificar no celular.'],
    paginaAlvo:{url:'https://negocio.com/'},ofertasAfetadas:[{nome:'Manutenção'}],evidencias:[]}]);
  assert.match(painel.textContent,/Hipótese a conferir/);assert.equal(painel.textContent.split('Contato possível sem dúvida.').length,2);
  assert.match(painel.textContent,/Verificar no celular/);
});

test('plano conserva achados visíveis e permite abrir todas as conferências',()=>{
  const {c}=contexto(),tarefas=Array.from({length:6},(_,i)=>({titulo:'Tarefa '+i,base:i===5?'observacao':'hipotese',acao:'Conferir a página.'}));
  const painel=c.exibirPlanoDeAcao(tarefas),itens=nos(painel).filter(n=>n.tagName==='li');
  assert.equal(itens.filter(n=>!n.hidden).length,3);assert.equal(itens[5].hidden,false);
  nos(painel).find(n=>n.tagName==='button').eventos.click();assert.ok(itens.every(n=>!n.hidden));
});

test('tarefas técnicas não ocultam as três primeiras decisões do visitante',()=>{
  const {c}=contexto(),tarefas=[...Array.from({length:3},(_,i)=>({titulo:'Técnica '+i,eixo:'tecnico',base:'hipotese',acao:'Conferir a página.'})),
    ...Array.from({length:4},(_,i)=>({titulo:'Escolha '+i,eixo:'negocio',base:'hipotese',acao:'Comparar condições publicadas.'}))];
  const painel=c.exibirPlanoDeAcao(tarefas),itens=nos(painel).filter(n=>n.tagName==='li');
  assert.equal(itens[2].hidden,true);assert.ok(itens.slice(3,6).every(n=>!n.hidden));assert.equal(itens[6].hidden,true);
  const mostrar=nos(painel).find(n=>n.tagName==='button');assert.match(mostrar.textContent,/outras 2 tarefas/);
  mostrar.eventos.click();assert.ok(itens.every(n=>!n.hidden));
});

test('auditoria da revisão mostra a correção como declaração e omite valores econômicos',()=>{
  const {c}=contexto(),painel=c.exibirRevisaoPerfil({campos:[{campo:'publico',antes:'Pessoas',depois:'Empresas'},{campo:'economia',alterado:true}],
    ofertas:{adicionadas:[{nome:'Nova oferta'}],removidas:[],alteradas:[]},economiaAlterada:true});
  assert.match(painel.textContent,/Pessoas.*Empresas/);assert.match(painel.textContent,/não confirma fatos do Google/);
  assert.match(painel.textContent,/valores não são repetidos/);assert.doesNotMatch(painel.textContent,/undefined/);
});

test('piloto identifica a busca e distingue evidência citada do restante do contexto',()=>{
  const {c}=contexto(),painel=c.exibirIA({geradoEm:'2026-11-15T19:00:00Z',revisaoOrigem:2,
    selecao:{contextos:1,candidatosPublicados:73,limite:'Recorte parcial.'},
    resultados:[{estado:'revisao_necessaria',origem:'ia',escolha_ia:{acao:'validar_demanda',evidencias:['p1']}}],
    contextos:[{evidencias:[{id:'s1',tipo:'serp',termo:'Contratação de artistas',descricao:'Fonte não configurada.'},
      {id:'p1',tipo:'pagina',pagina:'https://negocio.com/contratar',descricao:'Contratação de artistas publicada.'}]}]});
  assert.match(painel.textContent,/Busca candidata: Contratação de artistas/);assert.match(painel.textContent,/1 contexto.*73 termos/);
  assert.equal(nos(painel).filter(n=>n.tagName==='strong' && n.textContent==='Citada na resposta').length,1);
});

test('entendimento distingue comprador de beneficiário e mantém finalidade como hipótese',()=>{
  const {c}=contexto(),painel=c.exibirEntendimentoNegocio({finalidade:{tipo:'social',natureza:'hipotese'},
    proposito:{texto:'Apoiamos moradia comunitária.'},publicos:[{tipo:'beneficiario',texto:'Famílias participantes',evidencias:[]},
      {tipo:'apoiador',texto:'Voluntários',evidencias:[]}],qualidade:{estado:'insuficiente',motivos:['HTML inicial limitado.']}});
  assert.match(painel.textContent,/hipótese da leitura pública/);assert.match(painel.textContent,/Público possivelmente beneficiado: Famílias/);
  assert.match(painel.textContent,/Possível apoiador: Voluntários/);assert.match(painel.textContent,/HTML inicial limitado/);
  assert.match(painel.textContent,/não identifica quem decide, paga ou se torna cliente/);
  assert.doesNotMatch(painel.textContent,/compradores confirmados|0 vendas/);
});

test('território não é apresentado como público humano ou região confirmada e o propósito tem fonte',()=>{
  const {c}=contexto(),fonte={url:'https://negocio.com/quem-somos',trecho:'Fomentar iniciativas nas periferias urbanas.',coletadoEm:'2026-11-15T20:00:00Z',sha256:'b'.repeat(64)};
  const painel=c.exibirEntendimentoNegocio({proposito:{texto:'Fomentar iniciativas.',evidencias:[fonte]},territorios:[{texto:'periferias urbanas',evidencias:[fonte]}]});
  assert.match(painel.textContent,/Fonte do propósito proposto/);assert.match(painel.textContent,/Territórios citados na atuação/);
  assert.match(painel.textContent,/não identificam um público humano nem confirmam a região/);
  assert.doesNotMatch(painel.textContent,/Público possivelmente beneficiado|Possível comprador/);
  assert.ok(nos(painel).some(n=>n.tagName==='a'&&n.href==='https://negocio.com/quem-somos'));
});

test('interface distingue rótulo de formulário de ação executada e nunca mostra valores preenchidos',()=>{
  const {c}=contexto();const p=c.exibirInteracoesPublicas({interacoesPublicas:[{grupoId:'g1',tipo:'campo',rotulo:'Origem',url:'https://negocio.com/',modo:'nao_preenchido',value:'DADO_PRIVADO_9981',coletadoEm:'2026-11-16T00:00:00Z',sha256:'a'.repeat(64)},{grupoId:'g1',tipo:'botao',rotulo:'Buscar passagens',url:'https://negocio.com/',modo:'nao_preenchido'}]});
  assert.match(p.textContent,/Campo: Origem/);assert.match(p.textContent,/Botão: Buscar passagens/);assert.match(p.textContent,/Nenhum campo foi preenchido nem ação foi executada/);assert.doesNotMatch(p.textContent,/DADO_PRIVADO_9981/);
});

test('tarefa de decisão mostra escolha, condições, fonte e incerteza sem chamar isso de resultado comercial',()=>{
  const {c}=contexto();const p=c.exibirPlanoDeAcao([{titulo:'Conferir a escolha do trajeto',acao:'Conferir a busca disponível.',eixo:'negocio',base:'hipotese',decisaoCliente:{objeto:'Passagens',objetivo:'Escolher trajeto e data.',escolha:'Origem e destino',percurso:['Localizar a busca.'],fatos:[{descricao:'Há um controle de origem.',evidencias:[{tipo:'interface_publica',natureza:'rotulo_literal',trecho:'Origem',url:'https://negocio.com/'}]}],restricoes:['Não comprar durante a conferência.'],incertezas:['Operadora do trajeto a conferir'],resultadoAConferir:'A pessoa identifica o próximo passo.'}}]);
  for(const s of ['Decisão do visitante','Origem e destino','Não comprar durante a conferência','Operadora do trajeto a conferir','ação não foi executada','A pessoa identifica o próximo passo'])assert.ok(p.textContent.includes(s),s);
  assert.ok(!nos(p).some(n=>n.tagName==='input'));assert.doesNotMatch(p.textContent,/conversão confirmada|receita garantida/);
});

test('organização social pode revisar atividades e finalidade sem inventar ofertas comerciais',async()=>{
  const a=contexto(true);a.get('site').value='negocio.com';const p=a.c.enviar('iniciar');const r=projeto();r.perfil.ofertas=[];
  r.perfil.entendimento={papel:'indefinido',finalidade:{tipo:'social',natureza:'hipotese'},atuacoes:[{tipo:'programa_social',nome:'Educação comunitária',url:'https://negocio.com/projeto'}]};
  await responder(a.pedidos[0],r);await p;
  assert.equal(a.get('finalidade-negocio').value,'social');
  a.get('confirmado').checked=true;a.get('perfil-form').eventos.submit({preventDefault(){}});
  const corpo=JSON.parse(a.pedidos[1].opcoes.body);assert.equal(corpo.perfil.finalidade,'social');
  assert.equal(corpo.perfil.ofertas.length,0);assert.deepEqual(corpo.perfil.atuacoes,[{tipo:'programa_social',nome:'Educação comunitária',url:'https://negocio.com/projeto'}]);
  assert.equal(corpo.perfil.confirmado,true);
});

test('plano social sem itens comerciais continua visível e oferece rascunho com campos desconhecidos',()=>{
  const {c}=contexto(),painel=c.exibirOportunidades({estado:'parcial',itens:[],planoDeAcao:[{
    titulo:'Conferir como participar',base:'hipotese',acao:'Revisar a participação no projeto.',entregavel:'Ficha de participação revisada.',
    atuacoesRelacionadas:[{nome:'Educação comunitária'}],modeloEntregavel:{campos:[{rotulo:'Quem participa',valorSugerido:null}]},
    dependencias:[{descricao:'Confirmar requisitos com o responsável',estado:'pendente'}],evidencias:[]}]},{estado:'indisponivel'});
  assert.match(painel.textContent,/Ficha de participação revisada/);assert.match(painel.textContent,/Atividades relacionadas: Educação/);
  assert.match(painel.textContent,/A preencher/);assert.doesNotMatch(painel.textContent,/Confirme as ofertas e gere a análise/);
});
