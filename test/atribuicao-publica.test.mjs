import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classificarOrigemPublicada} from '../src/modulos/atribuicao-publica.mjs';
import {construirPrioridades} from '../src/modulos/prioridades-local.mjs';
import {criarRelatorioCliente} from '../src/modulos/relatorio-cliente.mjs';
const H='b'.repeat(64),T=Date.parse('2026-11-17T11:00:00.000Z'),URL='https://exemplo.com.br/';
const fonte=(secao,trecho)=>({campo:'p',secao,trecho,url:URL,sha256:H,coletadoEm:new Date(T-10000).toISOString(),recortado:false});
test('rótulos de cliente ou resultado publicado suspendem atribuição de atividade própria',()=>{
 for(const secao of ['Depoimentos','Customer stories','Casos de sucesso','Construtoras que transformaram sua gestão com o software','O que nossos clientes dizem']){
  const r=classificarOrigemPublicada({secao});assert.equal(r.estado,'relato_ou_resultado_de_terceiro');assert.equal(r.atividadePropriaConfirmada,false);
 }
});
test('público-alvo e descrição presente não são confundidos com relato de resultado',()=>{
 for(const secao of ['Para construtoras que precisam de gestão','Recursos que transformam a operação','Quem pode usar o sistema?','Clientes e fornecedores'])assert.equal(classificarOrigemPublicada({secao}).estado,'nao_determinada');assert.equal(classificarOrigemPublicada().atividadePropriaConfirmada,false);
});
test('contexto de página ou hierarquia também identifica a origem sem usar nome de empresa',()=>{
 assert.equal(classificarOrigemPublicada({contexto:{titulos:[{texto:'Cases de sucesso'}]}}).estado,'relato_ou_resultado_de_terceiro');assert.equal(classificarOrigemPublicada({contexto:{tituloPagina:'Customer stories | Example'}}).estado,'relato_ou_resultado_de_terceiro');
});
test('relato do cliente não vira tarefa da oferta; fonte e motivo continuam no projeto e no relatório',()=>{
 const f=fonte('Empresas que transformaram sua gestão','O Sistema Aurora permite que nossa fábrica produza novos materiais para exportação.'),p={versao:1,dominio:'exemplo.com.br',revisao:1,perfil:{estado:'confirmado',ofertas:[{id:'o1',nome:'Sistema Aurora',url:URL,jornada:{natureza:'declaracao_usuario',comprador:'Gestor',executor:'Equipe do cliente',beneficiario:'Equipe',objetivo:'Conferir organização dos pedidos.'}}]},contextoPublico:{evidencias:[],detalhesPublicados:[f],cobertura:{paginas:[{url:URL,caracteresTextoVisivel:100}]}},palavras:{candidatos:[]},oportunidades:{itens:[],planoDeAcao:[]}};
 const r=construirPrioridades(p,{agora:()=>T});assert.equal(r.pendenciasDeOrigem.length,1);assert.equal(r.pendenciasDeOrigem[0].trecho,f.trecho);assert.ok(!r.tarefasDisponiveis.some(t=>t.decisao?.rotinaInteira?.trecho===f.trecho));
 const md=criarRelatorioCliente({...p,prioridades:r}).conteudo;assert.match(md,/Relatos de clientes preservados/);assert.ok(md.includes(H));assert.match(md,/não comprova atividade própria/);
});
test('publicação operacional própria continua disponível ao lado de resultado de cliente',()=>{
 const propria=fonte('Sistema Aurora','O Sistema Aurora organiza os pedidos cadastrados pela equipe.'),alheia=fonte('Clientes que cresceram','O Sistema Aurora ajudou nossa empresa a construir prédios.'),p={dominio:'exemplo.com.br',perfil:{estado:'confirmado',ofertas:[{id:'o1',nome:'Sistema Aurora',url:URL,jornada:{natureza:'declaracao_usuario',comprador:'Gestor',executor:'Equipe do cliente',beneficiario:'Equipe',objetivo:'Conferir organização dos pedidos cadastrados.'}}]},contextoPublico:{evidencias:[],detalhesPublicados:[alheia,propria],cobertura:{paginas:[{url:URL,caracteresTextoVisivel:100}]}},palavras:{candidatos:[]},oportunidades:{planoDeAcao:[]}};
 const r=construirPrioridades(p,{agora:()=>T});assert.ok(r.tarefasDisponiveis.some(t=>t.evidenciasNegocio?.some(f=>f.trecho===propria.trecho)));assert.equal(r.pendenciasDeOrigem[0].trecho,alheia.trecho);
});

test('contexto de clientes que falam nao atribui a necessidade do cliente ao fornecedor',()=>{
 const r=classificarOrigemPublicada({contexto:{titulos:[{texto:'Veja o que nossos clientes falam sobre a plataforma'}]},texto:'Nossa principal necessidade era treinar mais de 800 colaboradores.'});assert.equal(r.estado,'relato_ou_resultado_de_terceiro');assert.equal(r.atividadePropriaConfirmada,false);
});

test('formato de avaliacao com estrelas e mantido pendente sem autenticar autoria',()=>{
 for(const texto of ['"⭐⭐⭐⭐⭐ A parceria foi essencial para nossa equipe."','★★★★★ Nossa empresa passou a organizar seus cursos.']){const r=classificarOrigemPublicada({texto});assert.equal(r.estado,'relato_ou_resultado_de_terceiro');assert.equal(r.autoriaConfirmada,false);assert.equal(r.motivo,'formato_de_avaliacao_publicada_sem_autoria_verificada');}
 for(const texto of ['O software organiza os pedidos.','O recurso permite usar ★ para marcar uma tarefa.','A classificação ⭐⭐⭐⭐⭐ consta do relatório.'])assert.equal(classificarOrigemPublicada({texto}).estado,'nao_determinada');
});
