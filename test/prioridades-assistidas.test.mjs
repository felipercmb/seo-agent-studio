import test from 'node:test';
import assert from 'node:assert/strict';
import {construirPrioridades} from '../src/modulos/prioridades-local.mjs';
import {sincronizarTarefas} from '../src/modulos/tarefas.mjs';

const D='empresa-exemplo.com.br',URL='https://'+D+'/sistema',T=Date.parse('2026-11-16T16:00:00.000Z'),H='a'.repeat(64),opts={agora:()=>T};
function oferta(extra={}){
  return{id:'oferta_1',nome:'Suite Agenda',url:URL,centralidade:{nivel:'indefinida',natureza:'declaracao_usuario'},
    jornada:{natureza:'declaracao_usuario',comprador:'Gestor da equipe',executor:'Usuários da empresa que configuram os acessos',beneficiario:'Equipe da empresa',pagador:'',objetivo:'Comparar os requisitos da Suite Agenda com a rotina da equipe.'},evidencias:[],...extra};
}
function fonte(texto='A Suite Agenda permite até 10 usuários. A equipe da empresa configura os acessos.',extra={}){
  return{id:'s01',texto,tipo:'declaracao',contexto:{paginaId:'pag_'+H.slice(0,20),url:URL,tituloPagina:'Suite Agenda — requisitos publicados',titulos:[{nivel:1,texto:'Suite Agenda'}],campo:'p',coletadoEm:new Date(T-10000).toISOString(),sha256:H,recortado:false,classePagina:'institucional',...extra}};
}
function ficha(o=oferta(),extra={}){
  return{id:'ficha_'+o.id,tipo:'conferir_oferta',eixo:'qualificacao',base:'hipotese',titulo:'Preparar a ficha de '+o.nome,
    acao:'Conferir os requisitos publicados.',paginaAlvo:{url:o.url},ofertasAfetadas:[{id:o.id,nome:o.nome}],
    passos:['Preencher a ficha.'],criterioSucesso:'Registro das respostas.',evidencias:[],...extra};
}
function projeto({ofertas=[oferta()],fontes=[fonte()],plano,zero=false}={}){
  return{dominio:D,perfil:{estado:'confirmado',ofertas},palavras:{candidatos:[]},
    oportunidades:{planoDeAcao:plano??ofertas.map(o=>ficha(o))},
    contextoPublico:{evidencias:[],detalhesPublicados:[],cobertura:{paginas:[{url:URL,htmlInicial:true,caracteresTextoVisivel:zero?0:600}]}},
    evidenciasNegocio:{base:{versao:1,dominio:D,fontes}}};
}
const tarefaNegocio=r=>r.tarefasDisponiveis.filter(t=>t.decisao);

test('uma decisão por oferta/URL substitui ficha e dois pedidos; plano anterior permanece íntegro',()=>{
  const p=projeto(),antes=structuredClone(p),r=construirPrioridades(p,opts);
  assert.equal(r.regrasVersao,9);
  assert.equal(r.planoCompletoAnterior.length,2);
  assert.ok(r.planoCompletoAnterior.some(t=>t.tipo==='qualificar_pedido'));
  assert.ok(r.planoCompletoAnterior.some(t=>t.id==='ficha_oferta_1'));
  assert.equal(tarefaNegocio(r).length,1);
  const t=tarefaNegocio(r)[0];assert.equal(t.decisao.familia,'verificar_condicao_publicada');
  assert.deepEqual(t.decisao.casos.map(x=>x.entrada),[10,11]);
  assert.equal(t.decisao.escopoConfirmado,false);assert.equal(t.decisao.apoioVinculo.escopoConfirmado,false);
  assert.equal(t.evidencias[0].trecho,p.evidenciasNegocio.base.fontes[0].texto);
  assert.deepEqual(p,antes);
});

test('decisões de ofertas e URLs diferentes não são confundidas como duplicata',()=>{
  const a=oferta(),b=oferta({id:'oferta_2',nome:'Editor Contratos',url:'https://'+D+'/contratos'});
  const p=projeto({ofertas:[a,b],fontes:[fonte(),{...fonte('O Editor Contratos exige cadastro da equipe antes de gerar um documento.',{url:b.url,tituloPagina:'Editor Contratos',titulos:[{nivel:1,texto:'Editor Contratos'}]}),id:'s02'}]});
  const r=construirPrioridades(p,opts);assert.equal(tarefaNegocio(r).length,2);assert.equal(new Set(tarefaNegocio(r).map(t=>t.id)).size,2);
});

test('achado observado e publicação permanecem separados e precedem hipótese de negócio',()=>{
  const o=oferta(),publicacao=ficha(o,{id:'publicacao_1',tipo:'confirmar_publicacao',eixo:'publicacao',base:'observacao',titulo:'Conferir intenção de publicação'}),
    tecnica=ficha(o,{id:'botao_1',tipo:'corrigir_uso',eixo:'tecnico',base:'observacao',titulo:'Conferir nome do botão'});
  const r=construirPrioridades(projeto({plano:[ficha(o),tecnica,publicacao]}),opts);
  assert.deepEqual(r.prioridades.slice(0,2).map(t=>t.id),['publicacao_1','botao_1']);
  assert.ok(r.tarefasDisponiveis.some(t=>t.id==='botao_1'));
});

test('metadados com executor e beneficiário desconhecidos pedem confirmação, sem casos de contratação',()=>{
  const o=oferta();o.jornada.executor='';o.jornada.beneficiario='';
  const p=projeto({ofertas:[o],fontes:[fonte('Suite Agenda para equipes',{campo:'title'})],zero:true}),r=construirPrioridades(p,opts);
  const [t]=tarefaNegocio(r);assert.equal(t.tipo,'confirmar_jornada');assert.equal(t.decisao.somenteMetadados,true);
  assert.ok(t.camposAConfirmar.includes('quem executa cada rotina'));assert.ok(t.camposAConfirmar.includes('quem usa ou recebe'));
  assert.ok(!t.decisao.casos);assert.ok(!r.tarefasDisponiveis.some(x=>x.tipo==='qualificar_pedido'));
  assert.match(t.criterioSucesso,/dados ainda desconhecidos/);
});

test('marcador objetivo de zero texto visível exige conferência mesmo havendo descrição JSON-LD e papéis declarados',()=>{
  const r=construirPrioridades(projeto({fontes:[fonte('A Suite Agenda exige cadastro da empresa para gerar documentos.',{campo:'jsonld.Service.description'})],zero:true}),opts);
  assert.equal(tarefaNegocio(r)[0].tipo,'confirmar_jornada');assert.equal(tarefaNegocio(r)[0].decisao.somenteMetadados,true);
});

test('HTML fraco incorpora conferência hipotética do elemento em vez de criar outra prioridade de contratação',()=>{
  const o=oferta();o.jornada.executor='';o.jornada.beneficiario='';
  const r=construirPrioridades(projeto({ofertas:[o],fontes:[fonte('Suite Agenda',{campo:'title'})],zero:true,
    plano:[ficha(o),ficha(o,{id:'conferir_h1',tipo:'corrigir_uso',eixo:'tecnico',titulo:'Conferir H1 renderizado'})]}),opts);
  assert.equal(r.prioridades.length,1);assert.equal(r.prioridades[0].tipo,'confirmar_jornada');
  assert.ok(r.planoCompletoAnterior.some(t=>t.id==='conferir_h1'));
});

test('um papel essencial ausente continua explícito mesmo se houver condição numérica completa',()=>{
  const o=oferta();o.jornada.beneficiario='';
  const t=tarefaNegocio(construirPrioridades(projeto({ofertas:[o]}),opts))[0];
  assert.equal(t.tipo,'confirmar_jornada');assert.deepEqual(t.camposAConfirmar,['quem usa ou recebe']);
});

test('prazo público acrescenta um marco verificável sem preencher o papel que falta',()=>{
  const o=oferta({jornada:{comprador:'Gestor da equipe'}});
  const trecho='Assim que os colaboradores são cadastrados, a equipe confirma os documentos em até 48 horas, incluindo fins de semana.';
  const [t]=tarefaNegocio(construirPrioridades(projeto({ofertas:[o],fontes:[fonte(trecho)]}),opts));
  assert.equal(t.decisao.escopoConfirmado,false);
  assert.match(t.titulo,/Conferir prazos e seus marcos/u);
  assert.deepEqual(t.camposAConfirmar,['quem executa cada rotina','quem usa ou recebe','o objetivo a avaliar nesta oferta']);
  const [m]=t.decisao.marcosPublicados;
  assert.equal(m.fonte.trecho,trecho);
  assert.equal(m.marco.texto,'Assim que os colaboradores são cadastrados');
  assert.ok(t.modeloEntregavel.campos.some(c=>c.valorSugerido===trecho&&c.evidencia.sha256===H));
});

test('prazo de outro plano na mesma URL não passa ao vizinho, nem prazo de fonte recortada',()=>{
  const a=oferta({nome:'Suite Agenda',jornada:{}}),b=oferta({id:'oferta_2',nome:'Plano Atlas',jornada:{}});
  const texto='Assim que o pedido é aceito, o Plano Atlas libera os acessos em até 24 horas.';
  const tarefas=tarefaNegocio(construirPrioridades(projeto({ofertas:[a,b],fontes:[fonte(texto)]}),opts));
  assert.equal(tarefas.find(t=>t.ofertasAfetadas[0].id===a.id).decisao.marcosPublicados,undefined);
  assert.equal(tarefas.find(t=>t.ofertasAfetadas[0].id===b.id).decisao.marcosPublicados[0].prazo.texto,'em até 24 horas');
  const [t]=tarefaNegocio(construirPrioridades(projeto({ofertas:[b],fontes:[fonte(texto,{recortado:true})]}),opts));
  assert.equal(t.decisao.marcosPublicados,undefined);
});

test('intermediação declarada pede papéis e condições por etapa sem inferir quem recebe',()=>{
  const o=oferta({nome:'Agenciamento de apresentações'});
  o.jornada.executor='';
  o.jornada.pagador='Organizador do evento';
  const p=projeto({ofertas:[o],fontes:[fonte('Agenciamento de apresentações para eventos.')]});
  p.perfil.entendimento={papel:'intermediacao',natureza:'declaracao_usuario'};
  const [t]=tarefaNegocio(construirPrioridades(p,opts));
  assert.equal(t.tipo,'confirmar_jornada');
  assert.equal(t.decisao.familia,'esclarecer_intermediacao');
  assert.equal(t.decisao.escopoConfirmado,false);
  assert.match(t.titulo,/Agenciamento de apresentações/);
  assert.match(t.passos.join(' '),/quem encaminha, quem executa e quem recebe.*Preserve exceções/);
  assert.deepEqual(t.modeloEntregavel.campos.find(c=>c.rotulo==='Quem paga'),{
    rotulo:'Quem paga',valorSugerido:'Organizador do evento',origem:'declaracao_usuario',
  });
  assert.equal(t.modeloEntregavel.campos.find(c=>c.rotulo==='Quem recebe e por qual etapa').origem,'a_confirmar');
  assert.doesNotMatch(t.passos.join(' '),/software|elegível/);
  assert.doesNotThrow(()=>sincronizarTarefas(null,[t],{dominio:D,...opts}));

  p.perfil.entendimento.natureza='hipotese';
  const [semConfirmacao]=tarefaNegocio(construirPrioridades(p,opts));
  assert.equal(semConfirmacao.decisao.familia,'esclarecer_jornada');
});

test('duas cobranças publicadas com vínculo produzem uma única ficha de conferência',()=>{
  const o=oferta({nome:'Plataforma de inscrições'});
  o.jornada.executor='';
  const trecho='Crie seu evento sem taxa de instalação. Nas inscrições pagas, há uma taxa de 2% por inscrição.';
  const f=fonte(trecho,{titulos:[{nivel:1,texto:'Plataforma de inscrições'}]});
  const p=projeto({ofertas:[o],fontes:[f]});
  const [t]=tarefaNegocio(construirPrioridades(p,opts));
  assert.equal(t.decisao.familia,'conferir_cobrancas_por_etapa');
  assert.equal(t.decisao.escopoConfirmado,false);
  assert.equal(t.evidencias[0].trecho,trecho);
  assert.equal(t.decisao.cobrancasPublicadas.escopoTransacao.texto,'Nas inscrições pagas');
  assert.match(t.passos.join(' '),/quem paga e quem recebe/);
  assert.doesNotThrow(()=>sincronizarTarefas(null,[t],{dominio:D,...opts}));

  const ofertaVizinha=oferta({id:'oferta_2',nome:'Plataforma de certificados'});
  p.perfil.ofertas.push(ofertaVizinha);
  const tarefas=tarefaNegocio(construirPrioridades(p,opts));
  assert.equal(tarefas.filter(x=>x.decisao.familia==='conferir_cobrancas_por_etapa').length,1);
  assert.ok(tarefas.find(x=>x.decisao.familia==='conferir_cobrancas_por_etapa').ofertasAfetadas.every(x=>x.id===o.id));
});

test('condição recortada não gera caso de limite nem orienta seleção de plano',()=>{
  const p=projeto({fontes:[fonte(undefined,{recortado:true})]}),r=construirPrioridades(p,opts);
  assert.ok(tarefaNegocio(r).every(t=>t.decisao.familia!=='verificar_condicao_publicada'));
  assert.ok(r.diagnosticoDeRegras.some(d=>d.motivo==='condicao_recortada'));
});

test('metadado de integridade ausente não é interpretado como fonte inteira',()=>{
  const f=fonte();delete f.contexto.recortado;
  const r=construirPrioridades(projeto({fontes:[f]}),opts);
  assert.ok(tarefaNegocio(r).every(t=>t.decisao.familia!=='verificar_condicao_publicada'));
});

test('marcador de recorte não é apagado por duplicata sem contexto ou com falso negativo',()=>{
  const f=fonte(),p=projeto({fontes:[f]});p.contextoPublico.evidencias=[{trecho:f.texto,url:URL,campo:'p',sha256:H,coletadoEm:f.contexto.coletadoEm,recortado:true}];
  const r=construirPrioridades(p,opts);assert.ok(tarefaNegocio(r).every(t=>t.decisao.familia!=='verificar_condicao_publicada'));
});

test('suporte genérico de todos os planos não serve de condição de enquadramento',()=>{
  const f=fonte('O suporte da Suite Agenda é para todos os planos e recebe solicitações até 18 horas.',{titulos:[{nivel:1,texto:'Suporte da Suite Agenda'}]});
  const r=construirPrioridades(projeto({fontes:[f]}),opts);
  assert.ok(tarefaNegocio(r).every(t=>t.decisao.familia!=='verificar_condicao_publicada'));
  assert.ok(r.diagnosticoDeRegras.some(d=>d.motivo==='suporte_sem_vinculo_com_escolha'));
});

test('suporte pode ser requisito quando necessidade e modalidade específica estão publicamente vinculadas',()=>{
  const o=oferta();o.jornada.objetivo='Comparar suporte prioritário para a equipe.';
  const f=fonte('Apenas o Plano Premium da Suite Agenda inclui suporte prioritário para a equipe.',{titulos:[{nivel:1,texto:'Suite Agenda'},{nivel:2,texto:'Plano Premium'}]});
  const t=tarefaNegocio(construirPrioridades(projeto({ofertas:[o],fontes:[f]}),opts))[0];
  assert.equal(t.decisao.familia,'verificar_condicao_publicada');assert.equal(t.decisao.escopoConfirmado,false);
});

test('coincidir a URL não basta: condição de outro contexto deve ser esclarecida',()=>{
  const f=fonte('O pacote Delta permite até 10 usuários e recebe novos cadastros.',{tituloPagina:'Pacote Delta',titulos:[{nivel:1,texto:'Pacote Delta'}]});
  const r=construirPrioridades(projeto({fontes:[f]}),opts);
  assert.equal(tarefaNegocio(r)[0].tipo,'confirmar_jornada');
  assert.ok(r.diagnosticoDeRegras.some(d=>d.motivo==='condicao_sem_apoio_de_vinculo'));
});

test('duas ofertas na mesma URL mantêm regra e seção próprias sem copiar capacidade vizinha',()=>{
  const a=oferta({nome:'Plano Solo'}),b=oferta({id:'oferta_2',nome:'Plano Equipe'});
  const f1=fonte('A modalidade permite até 5 usuários.',{tituloPagina:'Planos',titulos:[{nivel:1,texto:'Planos'},{nivel:2,texto:'Plano Solo'}]}),
    f2={...fonte('A modalidade permite até 40 usuários.',{tituloPagina:'Planos',titulos:[{nivel:1,texto:'Planos'},{nivel:2,texto:'Plano Equipe'}]}),id:'s02'};
  const ts=tarefaNegocio(construirPrioridades(projeto({ofertas:[a,b],fontes:[f1,f2]}),opts));
  assert.equal(ts.length,2);
  assert.deepEqual(ts.find(t=>t.ofertasAfetadas[0].id===a.id).decisao.casos.map(c=>c.entrada),[5,6]);
  assert.deepEqual(ts.find(t=>t.ofertasAfetadas[0].id===b.id).decisao.casos.map(c=>c.entrada),[40,41]);
});

test('uma jornada sustentada não é afogada por sete incompletas na mesma importância',()=>{
  const boas=oferta(),fracas=Array.from({length:7},(_,i)=>{const o=oferta({id:'fraca_'+i,nome:'Oferta incompleta '+i});o.jornada.executor='';o.jornada.beneficiario='';return o;});
  const r=construirPrioridades(projeto({ofertas:[boas,...fracas]}),opts);
  assert.equal(r.prioridades[0].ofertasAfetadas[0].id,boas.id);
  assert.equal(r.prioridades.filter(t=>t.tipo==='confirmar_jornada').length,1);
  assert.equal(tarefaNegocio(r).length,8,'as pendências continuam disponíveis fora do topo');
});

test('centralidade declarada é respeitada; confirmação principal pode vir antes de rotina complementar',()=>{
  const boa=oferta({centralidade:{nivel:'complementar',natureza:'declaracao_usuario'}}),
    fraca=oferta({id:'fraca',nome:'Oferta principal',centralidade:{nivel:'principal',natureza:'declaracao_usuario'}});fraca.jornada.executor='';
  const r=construirPrioridades(projeto({ofertas:[boa,fraca]}),opts);
  assert.equal(r.prioridades[0].ofertasAfetadas[0].id,'fraca');
  assert.ok(r.prioridades.some(t=>t.ofertasAfetadas[0].id===boa.id));
});

test('fontes futuras e URLs de outro domínio não viram condições utilizáveis',()=>{
  for(const extra of [{coletadoEm:new Date(T+1).toISOString()},{url:'https://outro-exemplo.com.br/sistema'}]){
    const r=construirPrioridades(projeto({fontes:[fonte(undefined,extra)]}),opts);
    assert.equal(tarefaNegocio(r)[0].tipo,'confirmar_jornada');
  }
});

test('tarefas refinadas atendem ao contrato persistente e preservam dados anteriores sem mutação',()=>{
  const p=projeto(),r=construirPrioridades(p,opts),antes=structuredClone(p);
  const s=sincronizarTarefas(null,r.tarefasDisponiveis,{dominio:D,agora:()=>T});
  assert.ok(s.itens.length>0);assert.deepEqual(p,antes);
  assert.equal(s.itens[0].origem.base,'hipotese');
  assert.ok(!Object.hasOwn(r,'roi'));assert.ok(!Object.hasOwn(r,'verbaRecomendada'));
  r.planoCompletoAnterior[0].titulo='Modificação na cópia';assert.notEqual(p.oportunidades.planoDeAcao[0].titulo,'Modificação na cópia');
});

test('contexto público inteiro funciona sem o hook de evidências do harness antigo',()=>{
  const p=projeto(),f=fonte();delete p.evidenciasNegocio;
  p.contextoPublico.detalhesPublicados=[{url:URL,campo:'p',trecho:f.texto,sha256:H,coletadoEm:f.contexto.coletadoEm,recortado:false,secao:'Suite Agenda'}];
  const t=tarefaNegocio(construirPrioridades(p,opts))[0];
  assert.equal(t.decisao.familia,'verificar_condicao_publicada');
  assert.deepEqual(t.decisao.casos.map(x=>x.entrada),[10,11]);
});

test('prazo de retorno comercial não vira requisito de uso quando há rotina publicada',()=>{
  const sla=fonte('Nossos especialistas entrarão em contato em até 1 dia útil.',{titulos:[{nivel:1,texto:'Suite Agenda'},{nivel:2,texto:'Fale com nossos especialistas'}]}),
    rotina={...fonte('A Suite Agenda integra ferramentas da empresa e envia informações financeiras ao processo cadastrado.',{campo:'dd',titulos:[{nivel:1,texto:'Suite Agenda'},{nivel:2,texto:'Integrações financeiras'}]}),id:'s02'};
  const r=construirPrioridades(projeto({fontes:[sla,rotina]}),opts),t=tarefaNegocio(r)[0];
  assert.equal(t.decisao.familia,'verificar_rotina_publicada');
  assert.equal(t.evidencias[0].trecho,rotina.texto);
  assert.ok(!t.acao.includes(sla.texto));
  assert.ok(r.diagnosticoDeRegras.some(x=>x.motivo==='etapa_comercial_nao_e_requisito_de_uso'));
});

test('só promessa de contato não produz casos de elegibilidade nem diagnóstico falso de metadados',()=>{
  const f=fonte('O retorno da solicitação de contato ocorre em até 24 horas.',{titulos:[{nivel:1,texto:'Suite Agenda'},{nivel:2,texto:'Formulário de contato'}]});
  const t=tarefaNegocio(construirPrioridades(projeto({fontes:[f]}),opts))[0];
  assert.equal(t.tipo,'confirmar_jornada');assert.equal(t.decisao.somenteMetadados,false);
  assert.equal(t.decisao.corposPreservadosNaPagina,1);assert.ok(!t.decisao.casos);
});

test('SLA de suporte de modalidade específica não é confundido com retorno de contato comercial',()=>{
  const o=oferta();o.jornada.objetivo='Comparar suporte prioritário da Suite Agenda.';
  const f=fonte('Apenas o Plano Premium da Suite Agenda inclui resposta de suporte em até 2 horas.',{titulos:[{nivel:1,texto:'Suite Agenda'},{nivel:2,texto:'Plano Premium'}]});
  const t=tarefaNegocio(construirPrioridades(projeto({ofertas:[o],fontes:[f]}),opts))[0];
  assert.equal(t.decisao.familia,'verificar_condicao_publicada');assert.equal(t.decisao.escopoConfirmado,false);
});

test('blocos DOM inteiros com seção sustentam rotinas de ofertas parafraseadas na mesma URL',()=>{
  const a=oferta({nome:'Transporte de encomendas'}),b=oferta({id:'oferta_2',nome:'Operação fluvial'});
  const f1=fonte('Rede de encomendas A empresa oferece transporte para encomendas e entrega as remessas pela rede publicada.',{campo:'bloco.titulo-conteudo',tituloPagina:'Serviços',titulos:[{nivel:3,texto:'Rede de encomendas'}]}),
    f2={...fonte('Divisão dos Rios A operação conecta os centros pela rota fluvial e transporta as cargas conforme a modalidade publicada.',{campo:'bloco.titulo-conteudo',tituloPagina:'Serviços',titulos:[{nivel:3,texto:'Divisão dos Rios'}]}),id:'s02'};
  const ts=tarefaNegocio(construirPrioridades(projeto({ofertas:[a,b],fontes:[f1,f2]}),opts));
  assert.equal(ts.length,2);assert.ok(ts.every(t=>t.decisao.familia==='verificar_rotina_publicada'));
  assert.equal(ts.find(t=>t.ofertasAfetadas[0].id===a.id).evidencias[0].trecho,f1.texto);
  assert.equal(ts.find(t=>t.ofertasAfetadas[0].id===b.id).evidencias[0].trecho,f2.texto);
});

test('bloco que contém somente título não é promovido a corpo operacional',()=>{
  const f=fonte('Suite Agenda: integração de ferramentas',{campo:'bloco.titulo-conteudo',titulos:[{nivel:2,texto:'Suite Agenda: integração de ferramentas'}]});
  const t=tarefaNegocio(construirPrioridades(projeto({fontes:[f]}),opts))[0];
  assert.equal(t.tipo,'confirmar_jornada');assert.equal(t.decisao.corposPreservadosNaPagina,0);
  assert.equal(t.decisao.somenteMetadados,false,'sem marcador de texto zero, seleção insuficiente não prova ausência de corpo');
});

test('corpo preservado sem vínculo à oferta exige esclarecimento do vínculo, não nova coleta por metadados',()=>{
  const f=fonte('O programa Delta envia relatórios mensais e configura seus destinatários.',{tituloPagina:'Programa Delta',titulos:[{nivel:1,texto:'Programa Delta'}]});
  const t=tarefaNegocio(construirPrioridades(projeto({fontes:[f]}),opts))[0];
  assert.equal(t.tipo,'confirmar_jornada');assert.equal(t.decisao.corposPreservadosNaPagina,1);
  assert.equal(t.decisao.corposVinculadosAOferta,0);assert.equal(t.decisao.somenteMetadados,false);
  assert.match(t.acao,/corpo publicado preservado/);assert.match(t.acao,/vincul/);
  assert.doesNotMatch(t.acao,/zero texto|só.*metadados/);
});

function achadoTecnico(o,id='tecnica_1',numero=1){
  return ficha(o,{id,tipo:'corrigir_uso',eixo:'tecnico',base:'observacao',titulo:'Conferir campos e botões — '+o.nome,
    acao:'Confira datas, hóspedes e hotel antes de reservar.',passos:['Confira hóspedes e datas para reservar.'],
    criterioSucesso:'Confira a reserva do hotel.',comoValidar:'Verifique os hóspedes.',entregavel:'Registro da reserva.',
    decisaoCliente:{objeto:'hotel'},experimento:{tipo:'reserva_hotel'},modeloEntregavel:{campos:[{rotulo:'Hóspedes'}]},
    lacuna:{natureza:'observada',descricao:numero+' controle(s) sem nome no HTML inicial.',url:o.url,sha256:H,coletadoEm:new Date(T-10000).toISOString()},
    evidencias:[{tipo:'diagnostico',verificacaoId:'rotulos_'+numero,url:o.url,trecho:numero+' controle(s) sem nome no HTML inicial.',sha256:H,coletadoEm:new Date(T-10000).toISOString()}]});
}
test('enquadramento técnico usa objetivo e partes declaradas sem setor inferido; achado e fonte ficam intactos',()=>{
  const o=oferta({nome:'Hospedagem de aplicações'});o.jornada.objetivo='Publicar o site no CMS e verificar a migração separada.';o.jornada.executor='Fornecedor da infraestrutura';
  const old=achadoTecnico(o),r=construirPrioridades(projeto({ofertas:[o],plano:[old]}),opts),t=r.tarefasDisponiveis.find(x=>x.id===old.id);
  const textoVisivel=JSON.stringify([t.titulo,t.acao,t.passos,t.criterioSucesso,t.comoValidar,t.entregavel]);
  assert.match(textoVisivel,/Publicar o site no CMS/);assert.match(textoVisivel,/Fornecedor da infraestrutura/);
  assert.doesNotMatch(textoVisivel,/hóspedes|hotel|datas|reservar|reserva do hotel/);
  assert.deepEqual(t.evidencias,old.evidencias);assert.deepEqual(t.lacuna,old.lacuna);assert.equal(t.base,'observacao');
  assert.ok(!t.decisaoCliente&&!t.experimento&&!t.modeloEntregavel);
  assert.match(r.planoCompletoAnterior.find(x=>x.id===old.id).acao,/hóspedes/);
});

test('jornada declarada de hospedagem física continua válida sem bloquear palavras por heurística setorial',()=>{
  const o=oferta({nome:'Hospedagem de temporada'});o.jornada.objetivo='Reservar um quarto com datas e hóspedes definidos.';
  const t=construirPrioridades(projeto({ofertas:[o],plano:[achadoTecnico(o)]}),opts).tarefasDisponiveis.find(x=>x.id==='tecnica_1');
  assert.match(t.acao,/quarto com datas e hóspedes definidos/);assert.equal(t.contextoDeclarado.confirmacaoDeFuncionamento,false);
});

test('topo mostra uma tarefa técnica por URL sem apagar os demais achados ou sufocar decisão substantiva',()=>{
  const o=oferta(),tecnicas=[1,2,3].map(n=>achadoTecnico(o,'tecnica_'+n,n));
  const r=construirPrioridades(projeto({plano:tecnicas}),opts);
  assert.equal(r.prioridades.filter(t=>t.eixo==='tecnico').length,1);
  assert.ok(r.prioridades.some(t=>t.decisao?.familia==='verificar_condicao_publicada'));
  assert.equal(r.tarefasDisponiveis.filter(t=>t.eixo==='tecnico').length,3);
  for(const t of tecnicas)assert.ok(r.planoCompletoAnterior.some(x=>x.id===t.id));
});

test('necessidade e indicação não são convertidas em requisito, obrigação ou elegibilidade',()=>{
  for(const texto of ['A Suite Agenda é indicada para equipes que precisam de mais controle da rotina.',
    'A Suite Agenda oferece a estabilidade que você precisa para publicar seu conteúdo.']){
    const t=tarefaNegocio(construirPrioridades(projeto({fontes:[fonte(texto,{campo:'dd'})]}),opts))[0];
    assert.equal(t.decisao.modalidade,'informacao_publicada');assert.equal(t.decisao.capacidadeExtraida,null);
    assert.match(t.titulo,/bloco de decisão com respostas publicadas/);
    assert.equal(t.decisao.casos[0].origemResposta,'trecho_publicado');
    assert.equal(t.decisao.casos[0].esperado,texto);
    assert.match(t.criterioSucesso,/não é promovida a obrigação, requisito ou prova de adequação/);
  }
});

test('título genérico de documento jurídico não vincula cláusula de correio ao serviço de migração',()=>{
  const o=oferta({nome:'Implantação consultiva'});o.jornada.objetivo='Migrar site ou e-mail com assistência especializada adicional.';
  const f=fonte('Durante o teste do Serviço de Correio, o cliente deve registrar o domínio para manter o correio ativo.',{tituloPagina:'Termos — Site e E-mail',titulos:[{nivel:1,texto:'Condições gerais'}]});
  const t=tarefaNegocio(construirPrioridades(projeto({ofertas:[o],fontes:[f]}),opts))[0];
  assert.equal(t.tipo,'confirmar_jornada');assert.equal(t.decisao.somenteMetadados,false);
  assert.equal(t.decisao.corposPreservadosNaPagina,1);assert.equal(t.decisao.corposVinculadosAOferta,0);
});



test('uma declaração preservada de intermediação gera conferência específica para o objeto exato',()=>{
  const ingressos=oferta({nome:'Ingressos',url:null,jornada:null}),outra=oferta({id:'oferta_2',nome:'Plataforma para organizadores',jornada:null});
  const url='https://'+D+'/static/termos-de-uso';
  const frase='Ingressos são vendidos por nós em nome das pessoas que realizam os eventos.';
  const p=projeto({ofertas:[ingressos,outra],fontes:[fonte(frase,{url,tituloPagina:'Termos de uso'})]});
  const f=p.evidenciasNegocio.base.fontes[0];
  p.perfil.entendimento={papel:'intermediacao',natureza:'hipotese',relacoes:[{
    tipo:'representacao_na_transacao',texto:frase,objetos:['Ingressos'],recortado:false,
    forma:'venda_em_nome_de_terceiro',evidencias:[{url,campo:'p',sha256:H,trecho:frase}],
  }]};
  const t=tarefaNegocio(construirPrioridades(p,opts)).find(t=>t.decisao.familia==='conferir_representacao_publicada');
  assert.equal(t.decisao.relacaoPublicada.frase,frase);
  assert.equal(t.decisao.relacaoPublicada.fonte.url,url);
  assert.equal(t.paginaAlvo,null);
  assert.deepEqual(t.ofertasAfetadas.map(x=>x.id),[ingressos.id]);
  assert.equal(t.decisao.escopoConfirmado,false);
  assert.match(t.acao,/quem entrega/);
  assert.match(t.criterioSucesso,/cada parte/);
  f.contexto.recortado=true;
  assert.ok(!tarefaNegocio(construirPrioridades(p,opts)).some(t=>t.decisao.familia==='conferir_representacao_publicada'));
  f.contexto.recortado=false;
  p.perfil.entendimento={...p.perfil.entendimento,papel:'servicos',natureza:'declaracao_usuario'};
  assert.ok(!tarefaNegocio(construirPrioridades(p,opts)).some(t=>t.decisao.familia==='conferir_representacao_publicada'));
});

test('limites publicados para planos viram casos de conferência na mesma oferta',()=>{
  const o=oferta({jornada:null});
  const f1=fonte('O plano Essencial atende até 3 usuários.');
  const f2={...fonte('O plano Empresa tem mínimo de 10 usuários.'),id:'s02'};
  const p=projeto({ofertas:[o],fontes:[f1,f2]});
  const [t]=tarefaNegocio(construirPrioridades(p,opts));
  assert.equal(t.decisao.familia,'conferir_limites_por_modalidade');
  assert.deepEqual(t.decisao.limitesPorModalidade.casos.map(x=>x.quantidade),[3,4,10]);
  assert.equal(t.evidencias.length,2);
  assert.equal(t.paginaAlvo.url,URL);
  assert.ok(t.passos.some(x=>x.includes('acima do máximo publicado')&&x.includes('abaixo do mínimo publicado')));
  assert.equal(t.decisao.escopoConfirmado,false);
});
