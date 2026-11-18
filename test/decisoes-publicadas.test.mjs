import test from 'node:test';
import assert from 'node:assert/strict';
import {prepararDecisaoPublicada} from '../src/modulos/decisoes-publicadas.mjs';
import {conferirVinculoResposta} from '../src/modulos/entregaveis-prioridades.mjs';
import {construirPrioridades} from '../src/modulos/prioridades-local.mjs';

const U='https://catalogo-local.com.br/servicos',D='catalogo-local.com.br',H='d'.repeat(64),T=Date.parse('2026-11-17T00:50:00Z'),DATA='2026-11-17T00:30:00.000Z';
const oferta=(extra={})=>({id:'o1',nome:'Curso de inglês',url:U,jornada:{natureza:'declaracao_usuario',comprador:'Pessoa ou responsável',executor:'Fornecedor do curso',beneficiario:'Pessoa que aprende',objetivo:'Comparar cursos por idade e nível, antes de conferir matrícula.'},...extra});
const f=(trecho,secao,extra={})=>({url:U,trecho,secao,campo:'p',sha256:H,coletadoEm:DATA,recortado:false,tipo:'negocio_publicado',natureza:'trecho_literal',classePagina:'institucional',...extra});
const tarefa={id:'id-preservado',tipo:'conferir_oferta',eixo:'negocio',base:'hipotese',ofertasAfetadas:[{id:'o1',nome:'Curso de inglês'}],decisao:{familia:'verificar_condicao_publicada',casos:[{entrada:14},{entrada:15}]}};
function preparar(o,fontes,extra={}){
 return prepararDecisaoPublicada(structuredClone(tarefa),{oferta:o,ofertas:[o],fontes,interacoes:[],cobertura:{paginas:[{url:U,sha256:H}]},validarVinculo:conferirVinculoResposta,agora:()=>T,...extra});
}
const plano=r=>r.decisao.decisaoPreparada;
const porCaso=(p,c)=>p.alternativas.filter(a=>c.esperado.alternativas.includes(a.id));
const cursoA=()=>f('Curso de inglês inicial para crianças de 3 e 4 anos de idade, com até 14 alunos por turma.','Curso inicial (3–4 anos)');
const cursoB=()=>f('Curso de inglês para adolescentes de 13 a 17 anos, com condições e nível a conferir.','Curso adolescente (13–17 anos)');

test('idades: oráculo independente do texto usa 4→3–4 e 15→13–17 sem converter faixa em matrícula',()=>{
 const r=preparar(oferta(),[cursoA(),cursoB()]),p=plano(r);
 assert.equal(p.tipo,'comparar_faixas_publicadas');
 assert.deepEqual(p.casos.map(c=>c.dadosEntrada.idadeAnos),[4,15]);
 assert.deepEqual(porCaso(p,p.casos[0]).map(a=>[a.faixa.minimo,a.faixa.maximo]),[[3,4]]);
 assert.deepEqual(porCaso(p,p.casos[1]).map(a=>[a.faixa.minimo,a.faixa.maximo]),[[13,17]]);
 assert.ok(p.casos.every(c=>c.natureza==='hipotese_controlada'&&c.esperado.natureza==='roteiro_de_conferencia'));
 assert.equal(p.confirmacaoRealCliente,false);assert.equal(r.id,tarefa.id);
 assert.equal(r.decisao.casos,undefined);assert.deepEqual(r.decisao.origemDeSelecao.casos,[{entrada:14},{entrada:15}]);
});

test('alterar a faixa da fonte altera o caso e sua rota, em vez de conservar a resposta anterior',()=>{
 const alterada=f('Curso de inglês inicial para crianças de 9 e 10 anos de idade.','Curso inicial (9–10 anos)');
 const p=plano(preparar(oferta(),[alterada,cursoB()]));
 assert.deepEqual(p.casos.map(c=>c.dadosEntrada.idadeAnos),[10,15]);
 assert.deepEqual(porCaso(p,p.casos[0]).map(a=>a.faixa.minimo),[9]);
});

test('uma modalidade recortada ou só um título não cria uma segunda alternativa',()=>{
 for(const ruim of [{...cursoB(),recortado:true},{...cursoB(),campo:'h2'}]){
  assert.equal(preparar(oferta(),[cursoA(),ruim]),null);
 }
});

test('tempo de atuação do fornecedor não é faixa etária de aluno',()=>{
 const a=f('Nosso curso de inglês possui de 3 a 4 anos de atuação no mercado.','Experiência do fornecedor');
 assert.equal(preparar(oferta(),[a,cursoB()]),null);
});

test('um limite de turma permanece só na fonte da modalidade que o publicou',()=>{
 const p=plano(preparar(oferta(),[cursoA(),cursoB()]));
 assert.ok(p.alternativas[0].fonte.trecho.includes('14 alunos'));
 assert.ok(!p.alternativas[1].fonte.trecho.includes('14 alunos'));
 assert.ok(p.casos.every(c=>!Object.hasOwn(c.dadosEntrada,'maximoAlunos')));
});

function correcao(oExtra={}){
 const o=oferta({nome:'Curso de redação',jornada:{...oferta().jornada,objetivo:'Comparar correção de redação e o tipo de retorno necessário.'},...oExtra});
 const ai=f('O curso de redação anuncia 30 correções de redação por IA por mês.','Retorno por IA');
 const humano=f('A redação pode ser corrigida por um professor, que devolve orientação. Disponível nos planos com avaliação docente.','Correção por professor');
 const credito=f('Escolha a redação que precisa de um professor e use 1 crédito.','Compre créditos');
 return{o,ai,humano,credito};
}
test('retorno automatizado e humano são ramos distintos com condições e créditos próprios',()=>{
 const {o,ai,humano,credito}=correcao(),r=preparar(o,[ai,humano,credito]),p=plano(r);
 assert.equal(p.tipo,'comparar_modalidades_de_correcao');
 assert.deepEqual(p.casos.map(c=>c.dadosEntrada.tipoDeRetorno),['automatizado','humano']);
 assert.deepEqual(porCaso(p,p.casos[0]).map(a=>a.modo),['automatizado']);
 assert.deepEqual(porCaso(p,p.casos[1]).map(a=>a.modo),['humano']);
 assert.equal(p.alternativas[0].fonte.trecho,ai.trecho);
 assert.deepEqual(p.alternativas[1].condicoes.map(x=>x.trecho),[credito.trecho]);
 assert.equal(p.casos[1].esperado.proximosPassos[0].passo.tipo,'instrucao_publicada');
 assert.notEqual(p.casos[0].esperado.proximosPassos[0].passo.fonte.secao,'Compre créditos');
 assert.equal(p.casos[1].dadosEntrada.creditosDisponiveis,null);
});

test('revisão de código por IA não preenche o ramo automatizado de redação',()=>{
 const {o,humano}=correcao(),codigo=f('A revisão de código por IA aponta ajustes no código.','Revisão de código');
 assert.equal(preparar(o,[codigo,humano]),null);
});

test('métodos de capturas diferentes não são combinados como uma escolha observada',()=>{
 const {o,ai,humano}=correcao();
 assert.equal(preparar(o,[ai,{...humano,sha256:'e'.repeat(64)}]),null);
});

function objetos(){
 const a=oferta({id:'publicacao',nome:'Publicação de página',jornada:{...oferta().jornada,objetivo:'Comparar publicação de página e registro de nome, mantendo os bônus em cada objeto.'}});
 const b=oferta({id:'registro',nome:'Registro de nome',jornada:{...oferta().jornada,objetivo:'Distinguir registro de nome da publicação de página.'}});
 const fa=f('Publicação de página: estrutura para colocar o conteúdo online; inclui nome por 1 ano.','Publicação de página');
 const fb=f('Registro de nome: Proteja sua identidade e garanta o endereço oficial. O bloco anuncia um mês de email.','Registro de nome');
 return{a,b,fa,fb};
}
test('objetos: a finalidade discrimina os casos e cada bônus permanece em sua fonte',()=>{
 const {a,b,fa,fb}=objetos(),r=preparar(a,[fa,fb],{ofertas:[a,b]}),p=plano(r);
 assert.equal(p.tipo,'comparar_objetos_publicados');
 assert.deepEqual(porCaso(p,p.casos[0]).map(a=>a.ofertaId),['publicacao']);
 assert.deepEqual(porCaso(p,p.casos[1]).map(a=>a.ofertaId),['registro']);
 assert.equal(p.alternativas[0].fonte.trecho,fa.trecho);assert.equal(p.alternativas[1].fonte.trecho,fb.trecho);
 assert.equal(p.casos[0].dadosEntrada.servicoExistente,null);
 assert.deepEqual(r.ofertasAfetadas.map(a=>a.id),['publicacao','registro']);
});

test('publicação que nomeia outro objeto não se transforma na resposta do objeto atual',()=>{
 const {a,b,fa}=objetos(),misturada=f('Publicação de página: para publicar seu conteúdo e conhecer o Registro de nome.','Registro de nome');
 assert.equal(preparar(b,[fa,misturada],{ofertas:[a,b]}),null);
});

test('promoção sem finalidade funcional não é reclassificada como decisão pronta',()=>{
 const {a,b}=objetos(),fa=f('Publicação de página com até 70% OFF por tempo limitado.','Publicação de página'),fb=f('Registro de nome com oferta promocional.','Registro de nome');
 assert.equal(preparar(a,[fa,fb],{ofertas:[a,b]}),null);
});
test('a fonte específica de quantidade/período vence termos que o objetivo manda não aplicar',()=>{
 const {o,humano}=correcao();o.jornada.objetivo='Comparar duração de acesso e correção de redação, sem aplicar graduação e cursos livres.';
 const ampla=f('O Curso de redação usa correção por IA; a marca também anuncia graduação e cursos livres.','Visão institucional');
 const especifica=f('O Curso de redação anuncia 30 correções de redação por IA por mês e aulas até o dia da prova.','Correção anunciada');
 const p=plano(preparar(o,[ampla,especifica,humano]));
 assert.equal(p.alternativas[0].fonte.trecho,especifica.trecho);
 assert.equal(p.alternativas[0].quantidadeAnunciada.valor,30);
 assert.equal(p.casos[0].dadosEntrada.quantidadeNoMes,31);
 assert.equal(p.casos[0].esperado.quantidadeStatus,'acima_da_quantidade_anunciada');
 assert.equal(p.casos[0].esperado.adequacaoConfirmada,false);
});

test('mencionar um segmento apenas para proibir sua generalização não confirma esse segmento',()=>{
 const {o,proposta}=demandas();o.jornada.objetivo='Conferir gestão de contratos e recursos, sem aplicar funcionalidades de segurança.';
 const restrita=f('Especificamente para empresas de segurança, o Sistema de contratos permite gerir recursos dos contratos e armamentos.','Gestão especializada');
 assert.equal(preparar(o,[proposta,restrita]),null);
});

test('um objeto citado apenas no trecho negativo do objetivo não cria comparação com ele',()=>{
 const {a,b,fa,fb}=objetos();a.jornada.objetivo='Comparar a publicação de página antes de contratar, sem transferir condições do Registro de nome.';
 assert.equal(preparar(a,[fa,fb],{ofertas:[a,b]}),null);
});

function demandas(){
 const o=oferta({nome:'Sistema de contratos',jornada:{...oferta().jornada,objetivo:'Conferir gestão de contratos e recursos, antes de avaliar a proposta.'}});
 const proposta=f('Criação de propostas com custos de serviços, peças e margens.','Orçamentos');
 const contrato=f('O Sistema de contratos oferece visibilidade dos recursos e produtos alocados, com controle dos custos de contratos.','Gestão de contratos');
 const restrita=f('Especificamente para empresas de segurança, o Sistema de contratos permite controle do armamento e reporte.','Controle especializado');
 return{o,proposta,contrato,restrita};
}
test('demandas: proposta com serviço/item e acompanhamento de contrato têm rotas e dados distintos',()=>{
 const {o,proposta,contrato,restrita}=demandas(),p=plano(preparar(o,[restrita,proposta,contrato]));
 assert.equal(p.tipo,'confrontar_demandas_operacionais');
 assert.deepEqual(p.casos.map(c=>c.dadosEntrada.artefato),['proposta','contrato']);
 assert.deepEqual(porCaso(p,p.casos[0]).map(a=>a.etapa),['preparacao_da_proposta']);
 assert.deepEqual(porCaso(p,p.casos[1]).map(a=>a.etapa),['acompanhamento_do_contrato']);
 assert.ok(p.alternativas.every(a=>a.fonte.trecho!==restrita.trecho));
 assert.equal(p.casos[0].dadosEntrada.custos,null);assert.equal(p.casos[1].dadosEntrada.segmento,null);
});

test('segmento específico sozinho não sustenta a necessidade genérica do cliente',()=>{
 const {o,proposta,restrita}=demandas();
 assert.equal(preparar(o,[proposta,restrita]),null);
});

test('objetivo que recusa comparação não recebe comparação automática',()=>{
 const o=oferta();o.jornada.objetivo='Não comparar faixas por idade; preciso apenas conferir o canal.';
 assert.equal(preparar(o,[cursoA(),cursoB()]),null);
});

test('plano preserva ID/dados de entrada, não copia economia e cabe no contrato de campos existente',()=>{
 const o=oferta();o.premissasEconomicas={contribuicaoPorVenda:987654.32};o.economia={taxaFechamento:.713456};
 const fs=[cursoA(),cursoB()],antes=structuredClone({o,fs}),r=preparar(o,fs);
 assert.deepEqual({o,fs},antes);assert.equal(r.id,'id-preservado');
 assert.ok(r.modeloEntregavel.campos.length<=12);
 assert.doesNotMatch(JSON.stringify(r),/987654|713456/);
 assert.equal(r.decisao.escopoConfirmado,false);
});

test('comparação compartilhada só aparece uma vez no topo e mantém as duas identidades no plano completo',()=>{
 const {a,b,fa,fb}=objetos(),p={dominio:D,perfil:{estado:'confirmado',ofertas:[a,b]},palavras:{candidatos:[]},oportunidades:{planoDeAcao:[]},
 contextoPublico:{detalhesPublicados:[fa,fb],cobertura:{paginas:[{url:U,sha256:H,caracteresTextoVisivel:1000,htmlInicial:true}]}},
 evidenciasNegocio:{base:{fontes:[]}}};
 const r=construirPrioridades(p,{agora:()=>T}),full=r.tarefasDisponiveis.filter(t=>t.decisao?.decisaoPreparada?.comparacaoGrupo),top=r.prioridades.filter(t=>t.decisao?.decisaoPreparada?.comparacaoGrupo);
 assert.equal(full.length,2);assert.equal(top.length,1);
 assert.equal(new Set(full.map(t=>t.id)).size,2);
 assert.equal(full[0].decisao.decisaoPreparada.comparacaoGrupo,full[1].decisao.decisaoPreparada.comparacaoGrupo);
});
test('necessidade funcional não incorpora parcelamento ou promessa de benefício da publicação',()=>{
 const {a,b,fb}=objetos(),fa=f('Publicação de página: estrutura para colocar conteúdo online em até 12x sem juros.','Publicação de página');
 const p=plano(preparar(a,[fa,fb],{ofertas:[a,b]}));
 assert.equal(p.casos[0].dadosEntrada.objetivoProposto,'colocar conteúdo online');
 assert.ok(p.alternativas[0].fonte.trecho.includes('12x sem juros'));
});

test('o próximo passo é próprio de cada alternativa, não uma instrução única para todo pedido',()=>{
 const {a,b}=objetos(),fa=f('Publicação de página: estrutura para publicar conteúdo online.','Publique sua página'),
  fb=f('Registro de nome: Proteja sua identidade digital.','Registre seu nome');
 const p=plano(preparar(a,[fa,fb],{ofertas:[a,b]}));
 assert.equal(p.proximoPasso.tipo,'condicional_por_alternativa');
 assert.equal(p.casos[0].esperado.proximosPassos[0].passo.fonte.trecho,fa.trecho);
 assert.equal(p.casos[1].esperado.proximosPassos[0].passo.fonte.trecho,fb.trecho);
});

test('mesma URL com duas capturas empatadas não inventa um catálogo combinado',()=>{
 assert.equal(preparar(oferta(),[cursoA(),{...cursoB(),sha256:'e'.repeat(64)}],{cobertura:undefined}),null);
});

test('uma captura mais recente substitui o grupo antigo para a decisão, sem mesclar modalidades',()=>{
 const recenteA={...cursoA(),sha256:'e'.repeat(64),coletadoEm:'2026-11-17T00:40:00.000Z'},recenteB={...cursoB(),sha256:'e'.repeat(64),coletadoEm:'2026-11-17T00:40:00.000Z'};
 const p=plano(preparar(oferta(),[cursoA(),recenteA,recenteB],{cobertura:undefined}));
 assert.ok(p.alternativas.every(a=>a.fonte.sha256==='e'.repeat(64)));
});

test('objetivo de comparar provedores externos não é substituído por dois produtos internos',()=>{
 const {a,b,fa,fb}=objetos();a.jornada.objetivo='Comparar publicação de página com fornecedores externos.';
 assert.equal(preparar(a,[fa,fb],{ofertas:[a,b]}),null);
});
