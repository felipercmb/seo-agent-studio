import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

const html = readFileSync(new URL('../src/portal.html', import.meta.url), 'utf8');
function trecho(inicio, fim) {
  const a=html.indexOf(inicio), b=html.indexOf(fim,a);
  assert.ok(a>=0 && b>a, 'As funções reais do portal devem estar disponíveis para o teste.');
  return html.slice(a,b);
}
const puras=trecho('function validarRelatorioPosicoes(', 'function resultadosDaBusca(');
const api={};runInNewContext(puras,api);

function relatorio(alteracoes={}) {
  return {versao:2,dominio:'negocio.com',estado:'parcial',geradoEm:'2026-11-15T12:00:00Z',
    candidatos:[{termo:'conserto de roupas',tipo:'servico'}],consultas:[],limites:[],
    descoberta:{paginasLidas:2,termosDescobertos:1,limitePaginas:12,limiteTermos:100},
    cobertura:{selecionadas:1,verificadas:0,encontradas:0,pendentes:1,paginasConsultadas:0},
    progresso:{continuar:true,esperaMs:3000,motivo:'Buscas descobertas',paginasNesteLote:0},...alteracoes};
}

test('interface aceita contrato v2 e rejeita versão antiga, domínio trocado e relatório incompleto', () => {
  const r=relatorio();assert.equal(api.validarRelatorioPosicoes(r,'negocio.com'),r);
  for(const invalido of [null,{...r,versao:1},{...r,dominio:'outro.com'},{...r,progresso:null},
    {...r,progresso:{continuar:'sim'}},{...r,descoberta:null},{...r,candidatos:Array(101).fill({termo:'x'})}]) {
    assert.throws(()=>api.validarRelatorioPosicoes(invalido,'negocio.com'),/incompleta/);
  }
});

test('posição só aparece quando observada e mantém página e posição local separadas', () => {
  const encontrado={estado:'encontrado',posicao:13,pagina:2,posicaoNaPagina:3};
  assert.equal(api.descricaoPosicao(encontrado),'Posição registrada: 13');
  assert.equal(api.recorteDaPosicao(encontrado),'Página 2; 3º resultado nessa página');
  assert.equal(api.descricaoPosicao({...encontrado,estado:'indisponivel'}),'Posição não verificada');
  assert.equal(api.descricaoPosicao({...encontrado,posicao:null}),'Posição não verificada');
  assert.equal(api.recorteDaPosicao({pagina:null,posicaoNaPagina:null}),'');
});

test('ausência no recorte é diferente de termo pendente ou fonte indisponível', () => {
  assert.equal(api.descricaoPosicao({estado:'nao_encontrado',concluida:false}),'Ainda não observado; leitura pendente');
  assert.equal(api.descricaoPosicao({estado:'nao_encontrado',concluida:true}),'Não observado nas páginas lidas');
  assert.equal(api.descricaoPosicao({estado:'indisponivel',concluida:false}),'Posição não verificada');
});

test('filtro e paginação local cobrem cem candidatos sem alterar sua evidência', () => {
  const candidatos=Array.from({length:100},(_,i)=>({termo:'Serviço local '+i,evidencia:{sha256:String(i)}}));
  const primeiro=api.filtrarCandidatos(candidatos,'servico',1);
  assert.equal(primeiro.total,100);assert.equal(primeiro.paginas,10);assert.equal(primeiro.itens.length,10);
  assert.equal(primeiro.itens[0],candidatos[0]);
  const ultimo=api.filtrarCandidatos(candidatos,'serviço',99);
  assert.equal(ultimo.pagina,10);assert.equal(ultimo.itens[9],candidatos[99]);
  const vazio=api.filtrarCandidatos(candidatos,'inexistente',3);
  assert.equal(vazio.total,0);assert.equal(vazio.pagina,1);assert.equal(vazio.itens.length,0);
  assert.equal(candidatos[99].evidencia.sha256,'99');
});

test('continuação automática exige página visível, mesmo domínio, permissão e menos de seis etapas', () => {
  const rel=relatorio(), contexto={visivel:true,pausada:false,lotes:5,dominio:rel.dominio};
  assert.equal(api.podeContinuarPosicoes(rel,contexto),true);
  for(const variante of [{visivel:false},{pausada:true},{lotes:6},{dominio:'outro.com'}]) {
    assert.equal(api.podeContinuarPosicoes(rel,{...contexto,...variante}),false);
  }
  for(const estado of ['fonte_nao_configurada','cota_esgotada','indisponivel','sem_termos']) {
    assert.equal(api.podeContinuarPosicoes({...rel,estado},contexto),false);
  }
  assert.equal(api.podeContinuarPosicoes({...rel,progresso:{continuar:false}},contexto),false);
});

function agenda(rel=relatorio()) {
  const tarefas=[], chamadas=[], canceladas=[];
  const contexto={document:{visibilityState:'visible'},timerContinuacao:null,continuacaoPausada:false,
    lotesAutomaticos:1,dominioPosicoes:rel.dominio,atual:rel,motivoPausa:'',
    setTimeout:(fn,ms)=>{tarefas.push({fn,ms});return tarefas.length;},
    clearTimeout:id=>canceladas.push(id),
    verificarPosicoes:(...args)=>chamadas.push(args)};
  runInNewContext(puras+trecho('function cancelarContinuacao(', 'function iniciarPosicoes('),contexto);
  return {contexto,tarefas,chamadas,canceladas};
}

test('agendamento aguarda ao menos três segundos e continua com o sinal explícito', () => {
  const rel=relatorio({progresso:{continuar:true,esperaMs:1}}),a=agenda(rel);
  a.contexto.agendarContinuacao(rel);assert.equal(a.tarefas[0].ms,3000);
  a.tarefas[0].fn();assert.equal(a.chamadas.length,1);
  assert.equal(a.chamadas[0][0],'negocio.com');assert.equal(a.chamadas[0][1],false);assert.equal(a.chamadas[0][2],true);
});

test('timer antigo não consulta outro domínio nem avança com a página oculta', () => {
  for(const mudar of [a=>{a.contexto.dominioPosicoes='outro.com';},a=>{a.contexto.document.visibilityState='hidden';}]) {
    const a=agenda();a.contexto.agendarContinuacao(a.contexto.atual);mudar(a);a.tarefas[0].fn();assert.equal(a.chamadas.length,0);
  }
});

test('sexta etapa pausa a sequência e estados sem fonte não agendam novas tentativas', () => {
  const a=agenda();a.contexto.lotesAutomaticos=6;a.contexto.agendarContinuacao(a.contexto.atual);
  assert.equal(a.tarefas.length,0);assert.equal(a.contexto.continuacaoPausada,true);assert.match(a.contexto.motivoPausa,/seis etapas/);
  for(const estado of ['fonte_nao_configurada','cota_esgotada','indisponivel']) {
    const rel=relatorio({estado}),b=agenda(rel);b.contexto.agendarContinuacao(rel);assert.equal(b.tarefas.length,0);
  }
});

test('motivos de andamento são traduzidos e códigos desconhecidos nunca vazam para o visitante', () => {
  for(const codigo of ['fonte_naoconfig','fonte_nao_configurada','configuracao','cota','cota_dominio',
    'plano_incompativel','controle','prazo','ocupada','limite','fila','concluido']) {
    const mensagem=api.mensagemAndamento(codigo);
    assert.equal(typeof mensagem,'string');assert.ok(mensagem.length>25);assert.notEqual(mensagem,codigo);
  }
  assert.match(api.mensagemAndamento('configuracao'),/Confira a chave SERPAPI_KEY/);
  assert.match(api.mensagemAndamento('cota_dominio'),/24 horas/);
  for(const desconhecido of ['segredo_interno_123','__proto__','toString','constructor',null,{}]) {
    assert.equal(api.mensagemAndamento(desconhecido),'Confira os resultados disponíveis e os termos que ainda aguardam verificação.');
  }
  assert.ok(!html.includes('motivoPausa || rel.progresso.motivo;'));
  assert.ok(!html.includes("'Motivo da interrupção: '+consulta.interrompidaPor"));
});

test('rótulo específico de entidade prevalece e tipos novos têm descrição legível', () => {
  assert.equal(api.rotuloCandidato({tipo:'entidade',rotulo:'Artista publicado no catálogo'}),'Artista publicado no catálogo');
  assert.equal(api.rotuloCandidato({tipo:'produto'}),'Produto');
  assert.equal(api.rotuloCandidato({tipo:'relacionada'}),'Busca relacionada do Google');
  assert.equal(api.rotuloCandidato({tipo:'entidade'}),'Nome identificado no conteúdo');
  assert.equal(api.rotuloCandidato({tipo:'__proto__'}),'Termo relacionado');
});

test('busca relacionada preserva fonte e consulta de origem mesmo sem URL', () => {
  const evidencia={fonte:'SerpApi',termoOrigem:'contratar artista',fonteId:'captura-123'};
  const linhas=api.origemCandidato(evidencia);
  assert.ok(linhas.includes('Fonte: SerpApi'));
  assert.ok(linhas.includes('Busca que originou esta sugestão: contratar artista'));
  assert.ok(linhas.includes('Consulta de origem na fonte: captura-123'));
  assert.ok(!linhas.some(l=>l.includes('undefined')));
});

test('descoberta parcial não afirma limite alcançado e releitura falha preserva datas antigas', () => {
  const parcial=api.avisosDescoberta({limitada:true});
  assert.equal(parcial[0],'A descoberta ficou parcial; pode haver outras páginas e termos.');
  assert.ok(!parcial.join(' ').includes('limite'));
  const antiga=api.avisosDescoberta({limitada:true,releituraIndisponivel:true});
  assert.equal(antiga.length,2);assert.match(antiga[1],/descoberta anterior/);assert.match(antiga[1],/datas originais/);
  assert.equal(api.avisosDescoberta({limitada:false,releituraIndisponivel:false}).length,0);
});
