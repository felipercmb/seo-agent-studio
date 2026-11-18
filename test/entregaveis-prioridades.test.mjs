import test from 'node:test';
import assert from 'node:assert/strict';
import {conferirVinculoResposta} from '../src/modulos/entregaveis-prioridades.mjs';
import {construirPrioridades} from '../src/modulos/prioridades-local.mjs';
import {sincronizarTarefas} from '../src/modulos/tarefas.mjs';

const D='exemplo-local.com.br',URL='https://'+D+'/oferta',H='a'.repeat(64),T=Date.parse('2026-11-16T12:00:00.000Z');
function oferta(extra={}){
  return{id:'o1',nome:'Plataforma de solicitações',url:URL,centralidade:{nivel:'principal',natureza:'declaracao_usuario'},evidencias:[],
    jornada:{natureza:'declaracao_usuario',comprador:'Equipe que organiza as solicitações',executor:'Atendentes da empresa usuária',beneficiario:'Empresa usuária e quem solicita atendimento',pagador:'',objetivo:'Configurar departamentos, atendentes e horários para encaminhar mensagens fora do expediente.'},...extra};
}
function fonte(id,trecho,secao,extra={}){
  return{id,texto:trecho,tipo:'declaracao',contexto:{paginaId:'pag_'+H.slice(0,20),url:URL,tituloPagina:'Plataforma de solicitações',
    titulos:[{nivel:1,texto:'Plataforma de solicitações'},{nivel:2,texto:secao}],campo:'p',coletadoEm:new Date(T-1000).toISOString(),sha256:H,recortado:false,classePagina:'institucional',...extra}};
}
function projeto(fs,{o=oferta(),interacoes=[]}={}){
  return{dominio:D,perfil:{estado:'confirmado',ofertas:[o]},palavras:{candidatos:[]},oportunidades:{planoDeAcao:[]},
    contextoPublico:{evidencias:[],detalhesPublicados:[],interacoesPublicas:interacoes,cobertura:{paginas:[{url:URL,caracteresTextoVisivel:1000,htmlInicial:true}]}},
    evidenciasNegocio:{base:{versao:1,dominio:D,fontes:fs}}};
}
const executar=p=>construirPrioridades(p,{agora:()=>T});
const atual=p=>executar(p).tarefasDisponiveis.find(t=>t.decisao);
const campos=t=>t.modeloEntregavel?.campos||[];

test('função publicada ligada ao objetivo vence descrição de dor com palavra precisa',()=>{
  const dor=fonte('s01','O cliente precisa repetir tudo porque a equipe não sabe o que foi discutido.','Histórico inacessível'),
    funcao=fonte('s02','Configure os departamentos e seus horários para encaminhar as mensagens aos atendentes da empresa.','Departamentos e horários');
  const t=atual(projeto([dor,funcao]));
  assert.equal(t.evidencias[0].trecho,funcao.texto);
  assert.ok(campos(t).some(c=>c.valorSugerido===funcao.texto&&c.origem==='trecho_publicado'));
  assert.ok(!campos(t).some(c=>c.valorSugerido===dor.texto));
  assert.equal(t.modeloEntregavel.natureza,'hipotese_editorial');
  assert.match(t.criterioSucesso,/eventual edição só ocorre se a dúvida tiver sido observada/);
});

test('duas alternativas do objetivo sustentadas na publicação viram entradas fictícias preenchidas',()=>{
  const o=oferta({nome:'Manutenção técnica'});o.jornada.objetivo='Planejar manutenção preventiva ou corretiva do equipamento.';o.jornada.executor='Equipe técnica contratada';
  const f=fonte('s01','Realizamos manutenção preventiva e corretiva dos equipamentos com equipe técnica especializada.','Manutenção técnica',{tituloPagina:'Manutenção técnica',titulos:[{nivel:1,texto:'Manutenção técnica'}]});
  const t=atual(projeto([f],{o})),qs=t.decisao.entrega.perguntas;
  assert.equal(qs.length,2);assert.match(qs[0].entrada,/Situação fictícia.*preventiva/);assert.doesNotMatch(qs[0].entrada,/corretiva/);
  assert.match(qs[1].entrada,/Situação fictícia.*corretiva/);assert.doesNotMatch(qs[1].entrada,/preventiva/);
  assert.ok(qs.every(q=>q.saidaEsperada===f.texto&&q.origemResposta==='trecho_publicado'));
  assert.ok(campos(t).some(c=>c.valorSugerido?.includes('Equipe técnica contratada')&&c.origem==='declaracao_usuario'));
});

test('condição publicada dá entrada específica e caso desconhecido sem inventar o comportamento inverso',()=>{
  const f=fonte('s01','Quando os atendentes estiverem offline, o sistema guarda as mensagens para retorno posterior.','Mensagens fora do expediente');
  const t=atual(projeto([f])),qs=t.decisao.entrega.perguntas;
  assert.match(qs[0].entrada,/Situação fictícia: os atendentes estiverem offline/);
  assert.equal(qs[0].saidaEsperada,f.texto);
  assert.match(qs[1].entrada,/Ainda não sabemos se/);assert.equal(qs[1].origemResposta,'a_confirmar');
  const resposta=campos(t).find(c=>c.valorSugerido===qs[1].saidaEsperada);
  assert.equal(resposta.origem,'a_confirmar');
});

test('rótulo da própria página e hash pode preencher próximo passo sem alegar ativação',()=>{
  const f=fonte('s01','A plataforma organiza solicitações e encaminha mensagens conforme os departamentos configurados.','Organização de solicitações');
  const controle={tipo:'botao',acao:'contatar',rotulo:'Abrir opções de contato',url:URL,sha256:H,campo:'button.texto',coletadoEm:new Date(T-1000).toISOString(),htmlInicial:true,modo:'nao_preenchido'};
  const t=atual(projeto([f],{interacoes:[controle]}));
  assert.equal(t.decisao.entrega.proximoPassoObservado.rotulo,controle.rotulo);
  assert.equal(t.decisao.entrega.proximoPassoObservado.modo,'nao_executado');
  assert.ok(campos(t).some(c=>c.valorSugerido?.includes('A ação não foi executada')&&c.origem==='trecho_publicado'));
});

test('canal em outra página ou documento não é reaproveitado como próximo passo comprovado',()=>{
  const f=fonte('s01','A plataforma organiza solicitações e encaminha mensagens conforme os departamentos configurados.','Organização de solicitações');
  for(const extra of [{url:'https://'+D+'/outro'},{sha256:'b'.repeat(64)}]){
    const controle={tipo:'botao',acao:'contatar',rotulo:'Contato',url:URL,sha256:H,htmlInicial:true,modo:'nao_preenchido',...extra};
    const t=atual(projeto([f],{interacoes:[controle]}));
    assert.equal(t.decisao.entrega.proximoPassoObservado,null);
    assert.ok(campos(t).some(c=>c.rotulo.startsWith('Próximo passo')&&c.valorSugerido===null&&c.origem==='a_confirmar'));
  }
});

test('serviço opcional permanece literal no rascunho e não vira obrigação de contratação',()=>{
  const o=oferta({nome:'Locação de equipamentos'});o.jornada.objetivo='Locar equipamento e avaliar a logística.';o.jornada.executor='Fornecedor do equipamento';
  const f=fonte('s01','A locação de equipamentos oferece transporte opcional, que pode ser contratado separadamente.','Logística da locação',{tituloPagina:'Locação de equipamentos',titulos:[{nivel:1,texto:'Locação de equipamentos'}]});
  const t=atual(projeto([f],{o}));
  assert.ok(campos(t).some(c=>c.valorSugerido===f.texto&&c.origem==='trecho_publicado'));
  assert.equal(t.decisao.escopoConfirmado,false);
  assert.match(t.criterioSucesso,/descrição não é promovida a obrigação/);
  assert.ok(!Object.hasOwn(t,'retornoEsperado'));
});

test('limite numérico continua tipado, com duas entradas concretas e regra inteira preservada',()=>{
  const f=fonte('s01','A Plataforma de solicitações permite até 10 usuários.','Planos da plataforma');
  const t=atual(projeto([f]));
  assert.deepEqual(t.decisao.casos.map(c=>c.entrada),[10,11]);
  assert.ok(campos(t).some(c=>c.valorSugerido==='10 usuarios'));
  assert.ok(campos(t).some(c=>c.valorSugerido==='11 usuarios'));
  assert.ok(campos(t).some(c=>c.valorSugerido===f.texto&&c.origem==='trecho_publicado'));
  assert.equal(t.decisao.escopoConfirmado,false);
});

test('metadados e papéis ausentes mantêm esclarecimento sem fabricar um rascunho comercial completo',()=>{
  const o=oferta();o.jornada.executor='';o.jornada.beneficiario='';
  const p=projeto([fonte('s01','Plataforma de solicitações','Plataforma',{campo:'title'})],{o});p.contextoPublico.cobertura.paginas[0].caracteresTextoVisivel=0;
  const t=atual(p);assert.equal(t.tipo,'confirmar_jornada');assert.equal(t.modeloEntregavel.tipo,'ficha_de_esclarecimento');assert.equal(t.modeloEntregavel.natureza,'roteiro_de_revisao');assert.equal(t.decisao.decisaoPreparada,undefined);assert.ok(t.modeloEntregavel.campos.every(c=>['declaracao_usuario','a_confirmar'].includes(c.origem)));
});

test('rascunho não inclui economia privada nem muda dados de entrada ou contrato persistente',()=>{
  const o=oferta();o.economia={contribuicaoPorVenda:919283.72,taxaFechamento:.91327};
  const p=projeto([fonte('s01','A plataforma organiza departamentos e encaminha mensagens para a equipe usuária.','Departamentos')],{o}),antes=structuredClone(p),r=executar(p),t=r.tarefasDisponiveis.find(t=>t.decisao);
  assert.deepEqual(p,antes);assert.doesNotMatch(JSON.stringify(t.modeloEntregavel),/919283|91327/);
  assert.ok(campos(t).length<=12);assert.ok(campos(t).filter(c=>c.valorSugerido!==null).length>=7);
  assert.doesNotThrow(()=>sincronizarTarefas(null,r.tarefasDisponiveis,{dominio:D,agora:()=>T}));
});

test('bloco e seu parágrafo são um fato; avaliação alheia ao objetivo não vira segunda situação',()=>{
  const a=fonte('s01','Departamentos e horários Configure os departamentos e seus horários para encaminhar as mensagens aos atendentes da empresa.','Departamentos e horários',{campo:'bloco.titulo-conteudo'}),
    b=fonte('s02','Configure os departamentos e seus horários para encaminhar as mensagens aos atendentes da empresa.','Departamentos e horários'),
    alheia=fonte('s03','Ao encerrar, o cliente recebe uma solicitação de avaliação; o feedback fica disponível nos relatórios.','Avaliação de atendimento');
  const t=atual(projeto([a,b,alheia]));
  assert.equal(t.decisao.entrega.perguntas[0].origemResposta,'trecho_publicado');
  assert.equal(t.decisao.entrega.perguntas[1].origemResposta,'declaracao_usuario');
  assert.equal(t.evidenciasNegocio.length,1);
  assert.ok(!campos(t).some(c=>c.valorSugerido===alheia.texto));
});

test('contexto de serviço opcional acompanha o fato operacional sem exigir esse serviço',()=>{
  const o=oferta({nome:'Locação de equipamentos'});o.jornada.objetivo='Planejar a locação, transporte e devolução dos equipamentos.';
  const f=fonte('s01','O transporte entrega os equipamentos ao solicitante e acompanha a devolução após a locação.','Transporte da locação'),
    contexto=fonte('s02','Além da locação dos equipamentos, o cliente pode optar pelo transporte e devolução contratados separadamente.','Transporte da locação');
  const t=atual(projeto([f,contexto],{o}));
  assert.ok(campos(t).some(c=>c.rotulo.startsWith('Contexto de escopo')&&c.valorSugerido===contexto.texto&&c.origem==='trecho_publicado'));
  assert.ok(t.evidenciasNegocio.some(e=>e.trecho===contexto.texto));
  assert.equal(t.decisao.escopoConfirmado,false);
  assert.match(t.modeloEntregavel.limite,/revisar escopo/);
});

test('fontes de outra versão do HTML não são combinadas em uma única resposta',()=>{
  const a=fonte('s01','Configure os departamentos e seus horários para encaminhar as mensagens aos atendentes da empresa.','Departamentos e horários'),
    b=fonte('s02','As mensagens enviadas fora dos horários são encaminhadas aos departamentos definidos.','Mensagens fora de horários',{sha256:'b'.repeat(64)});
  const t=atual(projeto([a,b]));
  assert.equal(t.evidenciasNegocio.length,1);
  assert.ok(t.evidenciasNegocio.every(e=>e.sha256===t.evidenciasNegocio[0].sha256));
  assert.equal(t.decisao.entrega.perguntas[1].origemResposta,'declaracao_usuario');
});

test('relação de encaminhamento explícita vira pergunta sobre destino e regra, não só nome da empresa',()=>{
  const f=fonte('s01','A equipe é notificada. O sistema distribui automaticamente para o departamento ou atendente correto com base nas regras configuradas.','Atendente recebe a solicitação');
  const t=atual(projeto([f])),q=t.decisao.entrega.perguntas[0];
  assert.match(q.entrada,/Para onde.*encaminhamento.*regra/);
  assert.equal(q.saidaEsperada,f.texto);
  assert.ok(!q.entrada.includes('Plataforma de solicitações'));
});

test('condições para atividade e acompanhamento têm perguntas específicas e mantêm publicação inteira',()=>{
  const o=oferta({nome:'Locação de equipamentos'});o.jornada.objetivo='Locar equipamentos e planejar operação, treinamento e acompanhamento do transporte.';
  const f=fonte('s01','Para operar o equipamento, é necessário concluir o treinamento informado e verificar a aptidão para a operação.','Operação do equipamento',{tituloPagina:o.nome,titulos:[{nivel:1,texto:o.nome},{nivel:2,texto:'Operação do equipamento'}]}),
    b=fonte('s02','O acompanhamento do transporte vai desde a retirada até a entrega do equipamento; o cliente recebe mensagens sobre o trajeto.','Acompanhamento do transporte',{tituloPagina:o.nome,titulos:[{nivel:1,texto:o.nome},{nivel:2,texto:'Acompanhamento do transporte'}]});
  const t=atual(projeto([f,b],{o})),qs=t.decisao.entrega.perguntas;
  assert.ok(qs.some(q=>q.entrada==='Quais condições são publicadas para operar o equipamento?'&&q.saidaEsperada===f.texto));
  assert.ok(qs.some(q=>q.entrada==='Como é descrito o acompanhamento do transporte?'&&q.saidaEsperada===b.texto));
});

test('função de organizar histórico publicada inteira não é confundida com falta de conteúdo',()=>{
  const o=oferta();o.jornada.objetivo='Organizar os históricos e manter os atendentes visíveis para consulta.';
  const f=fonte('s01','A Plataforma de solicitações organiza os históricos e mantém a lista dos atendentes na mesma tela.','Históricos e atendentes');
  const t=atual(projeto([f],{o}));
  assert.notEqual(t.tipo,'confirmar_jornada');
  assert.ok(campos(t).some(c=>c.valorSugerido===f.texto&&c.origem==='trecho_publicado'));
});

test('sem objetivo declarado a oferta pede contexto e não recebe uma decisão arbitrária',()=>{
  const o=oferta();o.jornada.objetivo='';
  const f=fonte('s01','A Plataforma de solicitações organiza os históricos e mantém a lista dos atendentes na mesma tela.','Históricos e atendentes');
  const t=atual(projeto([f],{o}));
  assert.equal(t.tipo,'confirmar_jornada');assert.equal(t.modeloEntregavel.tipo,'ficha_de_esclarecimento');assert.equal(t.decisao.decisaoPreparada,undefined);assert.ok(t.modeloEntregavel.campos.some(c=>c.rotulo==='Objetivo registrado'&&c.origem==='a_confirmar'));
  assert.ok(t.camposAConfirmar.includes('o objetivo a avaliar nesta oferta'));
  assert.ok(t.decisao.corposPreservadosNaPagina>0);
  assert.doesNotMatch(t.acao,/zero texto visível|só metadados/);
});

test('fato longo não é trocado por outro trecho enquanto seu limite numérico é reaproveitado',()=>{
  const textoLongo=('A Plataforma de solicitações permite até 10 usuários. Configure departamentos, atendentes e horários para encaminhar mensagens fora do expediente. '+'A publicação preserva a descrição desta configuração para consulta. '.repeat(28)).trim(),
    limite=fonte('s01',textoLongo,'Configurar departamentos, atendentes, horários e mensagens'),
    outro=fonte('s02','A Plataforma de solicitações organiza os departamentos e horários da equipe.','Departamentos');
  const t=atual(projeto([limite,outro]));
  assert.equal(t.decisao.condicaoInteira.trecho,textoLongo);
  assert.deepEqual(t.decisao.casos.map(c=>c.entrada),[10,11]);
  assert.equal(t.modeloEntregavel,undefined,'a tarefa original é preservada quando não há rascunho completo seguro');
  assert.equal(t.evidencias[0].trecho,textoLongo);
});



test('marca compartilhada não vincula outra modalidade ausente do perfil à oferta declarada',()=>{
 const o=oferta({nome:'Jadlog Rodo'}),vizinha={trecho:'Jadlog.com Ideal para envio rápido de produtos com até 30 kg vendidos pela internet.',secao:'Jadlog.com'};assert.deepEqual(conferirVinculoResposta(vizinha,o,[]),{sustentado:false,motivo:'nome_parcial_nao_sustenta_o_objeto'});
 assert.equal(conferirVinculoResposta({trecho:'Suas encomendas até 50 kg na modalidade rodoviária.',secao:'Jadlog Rodo'},o,[]).sustentado,true);assert.equal(conferirVinculoResposta({trecho:'Jadlog Rodo atende encomendas até 50 kg.'},o,[]).sustentado,true);
});

test('rascunho de peso usa o limite da modalidade e mantém a vizinha como pendência',()=>{
 const o=oferta({nome:'Jadlog Rodo'});o.jornada.objetivo='Conferir o limite de peso para envio pelo serviço Jadlog Rodo.';const propria=fonte('s01','Jadlog Rodo Suas encomendas até 50 kg na modalidade rodoviária.','Jadlog Rodo'),vizinha=fonte('s02','Jadlog.com Ideal para envio rápido de produtos com até 30 kg vendidos pela internet.','Jadlog.com'),p=projeto([propria,vizinha],{o}),antes=structuredClone(p),r=executar(p),t=r.tarefasDisponiveis.find(x=>x.decisao);
 assert.deepEqual(t.decisao.casos.map(c=>c.entrada),[50,51]);assert.ok(t.evidenciasNegocio.some(f=>f.trecho===propria.texto));assert.ok(!t.evidenciasNegocio.some(f=>f.trecho===vizinha.texto));assert.ok(r.pendenciasDeOferta.some(x=>x.fontesRecusadas.some(f=>f.trecho===vizinha.texto)));assert.equal(t.decisao.escopoConfirmado,false);assert.deepEqual(p,antes);
});
