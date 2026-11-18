import test from 'node:test';
import assert from 'node:assert/strict';
import {prepararEntregavelOferta,conferirVinculoResposta} from '../src/modulos/entregaveis-prioridades.mjs';
import {construirPrioridades} from '../src/modulos/prioridades-local.mjs';
const D='servicos-locais.com.br',U='https://'+D+'/',H='c'.repeat(64),T=Date.parse('2026-11-16T22:20:00Z'),DATA='2026-11-16T22:00:00.000Z';
const oferta=(id,nome)=>({id,nome,url:U,jornada:{natureza:'declaracao_usuario',comprador:'Pessoa que avalia a modalidade',executor:'Equipe responsável e pessoa usuária',beneficiario:'Pessoa usuária',objetivo:'Localizar o plano, registrar os dados e escolher a modalidade antes de contratar.'}});
const alfa=oferta('a','Plano Alfa'),beta=oferta('b','Plano Beta');
const fonte=(trecho,secao=null)=>({url:U,trecho,secao,tituloPagina:'Plano Alfa — página de serviços',campo:'p',sha256:H,coletadoEm:DATA,recortado:false,tipo:'negocio_publicado',natureza:'trecho_literal'});
const gerar=(f,o=alfa,ofertas=[alfa,beta])=>prepararEntregavelOferta({id:'t1',tipo:'conferir_oferta',base:'hipotese',decisao:{familia:'verificar_rotina_publicada',rotinaInteira:f,escopoConfirmado:false}},
 {oferta:o,fontes:[f],contextos:[f],ofertas});
const perguntas=t=>t.decisao.entrega.perguntas;

test('catálogo geral não é resposta do plano só por título de página e URL iguais',()=>{
 const f=fonte('Nosso aplicativo reúne compra avulsa, pagamentos, seguros e uma tag sem mensalidade em um só lugar e muito mais.');
 const t=gerar(f);
 assert.equal(perguntas(t)[0].saidaEsperada,null);assert.equal(perguntas(t)[0].origemResposta,'a_confirmar');
 assert.ok(t.modeloEntregavel.campos.some(c=>c.rotulo.startsWith('Trecho preservado')&&c.valorSugerido===f.trecho&&c.origem==='trecho_publicado'));
 assert.equal(t.decisao.entrega.vinculos[0].sustentado,false);
 assert.ok(t.decisaoCliente.fatos.some(x=>x.descricao===f.trecho));
 assert.match(t.titulo,/Confirmar o alcance/);assert.doesNotMatch(t.acao,/defeito observado|apenas metadados/);
});

test('seção Alfa com corpo explicitamente de Beta não recebe a resposta de Beta',()=>{
 const f=fonte('O Plano Beta permite até 40 usuários e inclui revisão pela equipe.','Plano Alfa'),t=gerar(f);
 assert.equal(conferirVinculoResposta(f,alfa,[alfa,beta]).sustentado,false);
 assert.equal(perguntas(t)[0].saidaEsperada,null);
 assert.ok(t.evidenciasNegocio.some(e=>e.trecho===f.trecho));
});

test('seção própria com condição não ambígua mantém a resposta útil sem exigir repetição do nome',()=>{
 const f=fonte('A modalidade permite até 5 usuários.','Plano Alfa'),t=gerar(f);
 assert.equal(conferirVinculoResposta(f,alfa,[alfa,beta]).sustentado,true);
 assert.equal(perguntas(t)[0].saidaEsperada,f.trecho);assert.equal(perguntas(t)[0].origemResposta,'trecho_publicado');
});

test('nome literal no corpo mantém rascunho preenchido e fonte própria',()=>{
 const f=fonte('O Plano Alfa organiza os acessos e permite comparar os registros da equipe.'),t=gerar(f);
 assert.equal(perguntas(t)[0].saidaEsperada,f.trecho);
 assert.equal(t.decisao.entrega.vinculos[0].motivo,'nome_da_oferta_no_corpo');
 assert.equal(t.evidenciasNegocio[0].sha256,H);
});

test('mensalidade de serviço adjacente não equivale a mensalista do plano',()=>{
 const a=oferta('m','Plano mensal de armários'),b=oferta('r','Reserva de armários');
 const f=fonte('O aplicativo permite pagar serviços e ativar uma tag sem mensalidade.','Aplicativo');
 assert.equal(conferirVinculoResposta(f,a,[a,b]).sustentado,false);
 const especifica=fonte('Acesse a unidade, escolha a opção de mensalista e preencha os dados do plano.','Como aderir à modalidade mensal?');
 assert.equal(conferirVinculoResposta(especifica,a,[a,b]).sustentado,true);
 assert.equal(perguntas(gerar(especifica,a,[a,b]))[0].saidaEsperada,especifica.trecho);
});

test('corpo coletado sem vínculo suficiente continua corpo e pede alcance, sem virar metadado',()=>{
 const f=fonte('O aplicativo organiza tarefas e permite consultar os registros gerais.');
 const p={dominio:D,perfil:{estado:'confirmado',ofertas:[alfa,beta]},palavras:{candidatos:[]},oportunidades:{planoDeAcao:[]},
  evidenciasNegocio:{base:{fontes:[{id:'s01',texto:f.trecho,tipo:'declaracao',contexto:{url:U,campo:'p',tituloPagina:alfa.nome,titulos:[],sha256:H,coletadoEm:DATA,recortado:false,classePagina:'institucional'}}]}},
  contextoPublico:{cobertura:{paginas:[{url:U,htmlInicial:true,caracteresTextoVisivel:900}]}}};
 const ts=construirPrioridades(p,{agora:()=>T}).tarefasDisponiveis.filter(t=>t.tipo==='confirmar_jornada');
 assert.equal(ts.length,2);
 assert.ok(ts.every(t=>t.decisao.corposPreservadosNaPagina===1&&t.decisao.somenteMetadados===false));
 assert.ok(ts.every(t=>/corpo publicado preservado/.test(t.acao)));
});

test('controle de modalidade vizinha não é transferido para o plano na mesma URL',()=>{
 const f=fonte('O Plano Alfa organiza os acessos e permite consultar os registros da equipe.');
 const controle={tipo:'botao',acao:'comprar',rotulo:'Comprar Plano Beta',url:U,sha256:H,coletadoEm:DATA,htmlInicial:true,modo:'nao_preenchido'};
 const t=prepararEntregavelOferta({id:'t',tipo:'conferir_oferta',decisao:{rotinaInteira:f}},{oferta:alfa,fontes:[f],ofertas:[alfa,beta],interacoes:[controle]});
 assert.equal(t.decisao.entrega.proximoPassoObservado,null);
 assert.ok(t.modeloEntregavel.campos.some(c=>c.rotulo.startsWith('Próximo passo')&&c.valorSugerido===null));
});
