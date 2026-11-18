import test from 'node:test';
import assert from 'node:assert/strict';
import {avaliarOportunidades} from '../src/modulos/oportunidades.mjs';
import {construirPrioridades} from '../src/modulos/prioridades-local.mjs';

const DOMINIO='projeto-comunitario.com.br',URL='https://'+DOMINIO+'/programas',T=Date.parse('2026-11-16T21:40:00Z'),DATA='2026-11-16T21:00:00.000Z',H='b'.repeat(64);
const MISTO='Famílias atendidas, voluntários, pessoas e empresas doadoras, apoiadores e compradores da loja. O perfil específico de acesso a cada programa não foi informado.';
const fonte=(trecho,secao='Programa Aprender',extra={})=>({tipo:'paragrafo',campo:'p',trecho,secao,url:URL,coletadoEm:DATA,sha256:H,recortado:false,...extra});
function projeto({publico=MISTO,regioes=['Brasil'],atividades,fs=[]}={}){
 const atuacoes=atividades||[{tipo:'programa_social',nome:'Programa Aprender',url:URL,natureza:'declaracao_usuario',evidencias:fs.slice(0,1)}];
 return{dominio:DOMINIO,perfil:{dominio:DOMINIO,estado:'confirmado',nome:'Associação comunitária',publico,regioes,ofertas:[],
   entendimento:{papel:'indefinido',finalidade:{tipo:'social',natureza:'declaracao_usuario'},atuacoes}},
   palavras:{candidatos:[]},diagnostico:{acoes:[]},contextoPublico:{versao:1,dominio:DOMINIO,evidencias:fs,detalhesPublicados:fs,
   cobertura:{paginas:[{url:URL,coletadoEm:DATA,sha256:H,caracteresTextoVisivel:1200,htmlInicial:true,limitada:false}]}},capacidades:{posicoes:{configurada:false}}};
}
function analisar(p){
 const oportunidades=avaliarOportunidades(p,{agora:()=>T}),prioridades=construirPrioridades({...p,oportunidades},{agora:()=>T});
 return{...p,oportunidades,prioridades};
}
const social=(r,nome='Programa Aprender')=>r.oportunidades.planoDeAcao.find(t=>t.atuacoesRelacionadas?.some(a=>a.nome===nome));
const campo=(t,rotulo)=>t.modeloEntregavel.campos.find(c=>c.rotulo===rotulo);

test('audiência global mista não preenche acesso, papel ou região de programa social',()=>{
 const f=fonte('O Programa Aprender organiza encontros de leitura com famílias acompanhadas pela equipe.');
 const p=projeto({fs:[f]}),antes=structuredClone(p),r=analisar(p),t=social(r);
 assert.deepEqual(p,antes);
 for(const rotulo of ['Quem pode participar ou receber apoio','Região ou forma de participação','Requisitos e critérios de elegibilidade declarados']){
  assert.equal(campo(t,rotulo).valorSugerido,null);assert.equal(campo(t,rotulo).origem,'a_confirmar');
 }
 assert.ok(!t.modeloEntregavel.campos.some(c=>c.valorSugerido===MISTO));
 assert.equal(t.dependencias.find(d=>d.tipo==='publico_atendido').estado,'pendente');
 assert.match(t.modeloEntregavel.limite,/audiência.*gerais.*não confirmam/);
 assert.ok(t.passos.some(p=>p.includes('doador, apoiador, voluntário, comprador e destinatário')));
 assert.match(t.criterioSucesso,/sem concluir que a pessoa é elegível ou inelegível/);
 assert.equal(r.prioridades.regrasVersao,9);
 assert.ok(r.prioridades.criterios.some(c=>c.includes('audiência e território gerais não confirmam acesso nem papéis')));
});

test('audiência global homogênea também não estabelece elegibilidade de um programa próprio',()=>{
 const t=social(analisar(projeto({publico:'Famílias da comunidade',fs:[fonte('O Programa Aprender realiza encontros comunitários de leitura.')] })));
 assert.equal(campo(t,'Quem pode participar ou receber apoio').valorSugerido,null);
 assert.equal(campo(t,'Quem pode participar ou receber apoio').origem,'a_confirmar');
 assert.equal(t.dependencias.find(d=>d.tipo==='publico_atendido').estado,'pendente');
});

test('publicação específica de programa mantém operação e critérios literais sem certificar acesso individual',()=>{
 const operacao=fonte('O Programa Aprender organiza encontros de leitura; os participantes recebem orientação da equipe.'),
  criterio=fonte('No Programa Aprender, jovens de 14 a 17 anos residentes no bairro Jardim podem solicitar orientação. A equipe avalia a inscrição.');
 const t=social(analisar(projeto({fs:[operacao,criterio]})));
 assert.equal(campo(t,'Quem pode participar ou receber apoio').valorSugerido,null);
 assert.ok(t.modeloEntregavel.campos.some(c=>c.origem==='trecho_publicado'&&c.valorSugerido===operacao.trecho));
 assert.ok(t.modeloEntregavel.campos.some(c=>c.origem==='trecho_publicado'&&c.valorSugerido===criterio.trecho));
 assert.ok(t.evidenciasNegocio.some(e=>e.trecho===operacao.trecho));
 assert.ok(t.evidenciasNegocio.some(e=>e.trecho===criterio.trecho));
 assert.ok(!Object.hasOwn(t,'elegivel'));assert.ok(!Object.hasOwn(t,'retornoEsperado'));
});

test('critério de programa vizinho na mesma página não preenche ficha da atividade analisada',()=>{
 const propria=fonte('O Programa Aprender organiza encontros de leitura com orientação para famílias.'),
  vizinha=fonte('O Programa Jogar aceita inscrição de jovens de 16 a 18 anos para participar das oficinas esportivas.','Programa Jogar');
 const t=social(analisar(projeto({fs:[propria,vizinha]})));
 assert.equal(campo(t,'Requisitos e critérios de elegibilidade declarados').valorSugerido,null);
 assert.ok(!t.modeloEntregavel.campos.some(c=>c.valorSugerido===vizinha.trecho));
 assert.ok(t.evidenciasNegocio.some(e=>e.trecho===propria.trecho));
});

test('sem publicação, programa declarado preserva desconhecidos sem fabricar atendimento aberto',()=>{
 const p=projeto({fs:[]});p.perfil.entendimento.atuacoes[0].url=null;
 const t=social(analisar(p));
 assert.equal(t.paginaAlvo,null);assert.deepEqual(t.evidencias,[]);
 assert.equal(campo(t,'Quem pode participar ou receber apoio').valorSugerido,null);
 assert.equal(campo(t,'Custo ou gratuidade, se declarados').valorSugerido,null);
 assert.equal(t.dependencias.find(d=>d.tipo==='publico_atendido').estado,'pendente');
 assert.match(t.modeloEntregavel.limite,/Campos sem esse vínculo permanecem desconhecidos/);
});

test('doação, destinatário e voluntariado continuam separados sem importar região da organização',()=>{
 const atividades=[{tipo:'programa_social',nome:'Programa Aprender'},{tipo:'captacao',nome:'Doações para os encontros'},
  {tipo:'participacao',nome:'Voluntariado de leitura'}].map(a=>({...a,url:URL,natureza:'declaracao_usuario',evidencias:[]}));
 const r=analisar(projeto({atividades})),programa=social(r),doacao=social(r,'Doações para os encontros'),voluntariado=social(r,'Voluntariado de leitura');
 assert.equal(programa.experimento.percurso,'beneficiario');assert.equal(doacao.experimento.percurso,'doacao');assert.equal(voluntariado.experimento.percurso,'voluntariado');
 assert.ok(!doacao.modeloEntregavel.campos.some(c=>c.rotulo==='Quem pode participar ou receber apoio'));
 assert.equal(campo(voluntariado,'Território ou formato de participação').valorSugerido,null);
 assert.ok([programa,doacao,voluntariado].every(t=>!t.modeloEntregavel.campos.some(c=>c.valorSugerido===MISTO)));
});

test('loja comercial explícita da organização social preserva compra e entrega declarada',()=>{
 const p=projeto({fs:[]}),e=fonte('Caderno artesanal','Loja',{url:'https://'+DOMINIO+'/loja',campo:'jsonld.Product.name'});
 p.perfil.ofertas=[{id:'c1',nome:e.trecho,url:e.url,evidencias:[e],economia:{contribuicaoPorVenda:null,taxaFechamento:null}}];
 p.perfil.entendimento.papel='produtos';p.perfil.entendimento.atuacoes.push({tipo:'oferta',nome:e.trecho,natureza:'declaracao_usuario',evidencias:[e]});
 p.palavras.candidatos=[{termo:e.trecho,tipo:'produto',origem:'site',ofertaId:'c1',intencao:'comercial',evidencia:e}];
 const r=analisar(p),t=r.oportunidades.planoDeAcao.find(t=>t.experimento?.tipo==='ficha_compra');
 assert.ok(t);assert.equal(t.categoria,'compra');
 assert.equal(campo(t,'Região de entrega ou retirada').valorSugerido,'Brasil');
 assert.equal(campo(t,'Região de entrega ou retirada').origem,'declaracao_usuario');
 assert.ok(!t.atuacoesRelacionadas?.length);
 assert.ok(social(r));
});
