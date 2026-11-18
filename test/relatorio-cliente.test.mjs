import test from 'node:test';
import assert from 'node:assert/strict';
import {extrairCondicoesPorAtividade} from '../src/modulos/condicoes-atividade.mjs';
import {extrairAtribuicoesNominais} from '../src/modulos/atribuicoes-nominais.mjs';
import {criarRelatorioCliente} from '../src/modulos/relatorio-cliente.mjs';

const AGORA = '2026-11-15T19:00:00.000Z';
const DATA = '2026-11-15T18:55:00.000Z';

test('respostas existentes e sequência de páginas exportam evidências sem posições absolutas ou campos arbitrários',()=>{
 const p=projeto();p.contextoPublico={perguntasPublicadas:[{natureza:'resposta_estruturada_publicada',pergunta:'Quem executa a operação?',trecho:'O cliente utiliza a ferramenta para organizar seus próprios pedidos.',url:'https://cliente.com.br/',sha256:'b'.repeat(64),coletadoEm:DATA,segredo:'NAO_EXPORTAR'}]};
 p.googleLocal={capturas:[{metodo:'captura_declarada_pagina_aberta',dominio:p.dominio,termo:'busca',coletadoEm:DATA,inicioSolicitado:20,ordemNaPagina:2}],sequencias:[{dominio:p.dominio,termo:'busca',paginasCapturadas:2,paginasEncadeadas:1,encontros:[{inicioSolicitado:20,ordemNaPagina:2,naSequenciaDesdePrimeira:false}],lacunas:[{}],conflitos:[],linksEmMaisDeUmaPagina:[],codigoLocal:'NAO_EXPORTAR'}]};
 const md=criarRelatorioCliente(p).conteudo;assert.match(md,/Respostas já declaradas/);assert.match(md,/Visibilidade e alcance/);assert.match(md,/Página avulsa/);assert.match(md,/Posição absoluta desconhecida/);assert.ok(md.includes('b'.repeat(64)));assert.doesNotMatch(md,/NAO_EXPORTAR|posição 22/);
});

test('exportação identifica caso proposto sem transformar hipótese em relato do cliente',()=>{
 const p=projeto();p.oportunidades.planoDeAcao=[tarefa({modeloEntregavel:{campos:[{rotulo:'Necessidade de teste',valorSugerido:'Participante fictício com objetivo X',origem:'hipotese_controlada'}]}})];
 const md=criarRelatorioCliente(p).conteudo;assert.match(md,/caso proposto e fictício/);assert.match(md,/não é necessidade observada do cliente/);
});
test('captura declarada é exportada separadamente, sem posição absoluta ou valores privados estruturados',()=>{
 const p=projeto();p.googleLocal={capturas:[{metodo:'captura_declarada_pagina_aberta',dominio:p.dominio,termo:'consulta autoral',coletadoEm:DATA,atual:true,inicioSolicitado:10,ordemNaPagina:1,sha256Trecho:'a'.repeat(64),termoNaSelecao:false,concorrentesAntes:[],credencial:'VALOR_PRIVADO',economia:{contribuicao:987654.32}}]};
 const md=criarRelatorioCliente(p).conteudo;assert.match(md,/Capturas locais do navegador/);assert.match(md,/sem posição absoluta/);assert.match(md,/Início solicitado na URL: 10/);assert.match(md,/página: 1/);assert.doesNotMatch(md,/VALOR_PRIVADO|987654|Posição observada: 11/);
});

const projeto = () => ({versao:1,dominio:'cliente.com.br',revisao:2,avaliação:'não exportar objetos inteiros',avaliadoEm:AGORA,
  perfil:{estado:'confirmado',nome:'Cliente Exemplo',resumo:'Oferece consultoria para empresas.',publico:'Empresas',regioes:['Brasil'],
    ofertas:[]}, oportunidades:{itens:[],planoDeAcao:[]}});
const tarefa = (extras = {}) => ({tipo:'conferir_oferta',titulo:'Conferir a oferta',acao:'Abra a página e confira o próximo passo.',
  base:'hipotese',paginaAlvo:{url:'https://cliente.com.br/servicos'},passos:['Abra a página.','Confira com uma pessoa.'],
  criterioSucesso:'Uma pessoa consegue identificar a oferta e o próximo passo.',ofertasAfetadas:[{id:'oferta1',nome:'Consultoria'}],
  evidencias:[],...extras});
const evidencia = (extras = {}) => ({tipo:'google',fonte:'SerpApi',coletadoEm:DATA,sha256:'a'.repeat(64),
  trecho:'Recorte observado no Google.',...extras});
const observacao = (extras = {}) => ({termo:'Contratar consultoria',observado:{estado:'encontrado',posicao:7,
  contexto:{pais:'Brasil',idioma:'Português',dispositivo:'Computador',localidade:'Brasil'}},evidencias:[evidencia()],...extras});
const demanda = (extras = {}) => ({fonte:'Fonte de teste',coletadoEm:DATA,pais:'Brasil',idioma:'Português',periodoInicio:'2025-11',periodoFim:'2026-10',
  itens:[{termo:'Contratar consultoria',buscasMensais:0}],...extras});

test('plano exporta a jornada declarada e a pergunta por oferta sem copiar premissas financeiras',()=>{
  const p=projeto();p.perfil.ofertas=[{id:'o1',nome:'Intermediação artística',url:'https://cliente.com.br/contrate',
    jornada:{natureza:'declaracao_usuario',comprador:'Organizador do evento',executor:'Artista independente',beneficiario:'Público presente',pagador:'',objetivo:'Contratar apresentação para data e local definidos'},
    premissasEconomicas:{contribuicao:987654.32,fechamento:.54321}}];
  p.palavras={candidatos:[{termo:'contratar artista gospel',ofertaId:'o1',origem:'hipotese',intencao:'comercial'},{termo:'show',ofertaId:null,intencao:'indefinida',origem:'site'}]};
  const antes=structuredClone(p),md=criarRelatorioCliente(p).conteudo;
  for(const esperado of ['Organizador do evento (declarado pelo usuário)','Artista independente (declarado pelo usuário)','Público presente (declarado pelo usuário)','Quem paga: a esclarecer','contratar artista gospel','reconhecer Intermediação artística','Expressões sem vínculo com uma oferta nesta seleção: show','intenção por regras, como hipótese'])assert.ok(md.includes(esperado),esperado);
  assert.doesNotMatch(md,/987654|54321|receita prevista/);assert.deepEqual(p,antes);
});

test('jornada experimental sem origem de declaração permanece a esclarecer na entrega ao cliente',()=>{
  const p=projeto();p.perfil.ofertas=[{id:'o1',nome:'Consultoria',jornada:{comprador:'GRUPO NÃO CONFIRMADO',executor:'EXECUTOR NÃO CONFIRMADO'}}];
  const md=criarRelatorioCliente(p).conteudo;
  assert.match(md,/Quem solicita ou contrata: a esclarecer/);assert.doesNotMatch(md,/GRUPO NÃO CONFIRMADO|EXECUTOR NÃO CONFIRMADO/);
});

test('plano distingue trecho publicado de diagnóstico e mantém atividade, fonte, rascunho e critério de prioridade',()=>{
  const p=projeto();p.perfil.entendimento={finalidade:{tipo:'social',natureza:'declaracao_usuario'},atuacoes:[{tipo:'programa_social',nome:'Educação comunitária'}]};
  p.oportunidades.planoDeAcao=[tarefa({ofertasAfetadas:[],atuacoesRelacionadas:[{tipo:'programa_social',nome:'Educação comunitária'}],
    entregavel:'Mapa do encaminhamento institucional.',esforco:{motivo:'Conferir com a equipe.'},
    priorizacao:{criterios:[{criterio:'importancia_no_negocio',valor:'principal',natureza:'hipotese'},{criterio:'retorno_comercial',valor:'nao_medido'}],limite:'Ordem editorial, sem previsão de retorno.'},
    modeloEntregavel:{campos:[{rotulo:'Condição publicada',valorSugerido:'Acesso por escolas',origem:'trecho_publicado'},{rotulo:'Contato responsável',valorSugerido:null,origem:'a_confirmar'}],limite:'Não presume inscrição individual.'},
    evidencias:[{tipo:'diagnostico',url:'https://cliente.com.br/servicos',trecho:'Dois campos sem rótulo.',sha256:'a'.repeat(64),coletadoEm:DATA}],
    evidenciasNegocio:[{tipo:'negocio_publicado',natureza:'trecho_literal',campo:'p',url:'https://cliente.com.br/servicos',trecho:'Acesso por escolas',sha256:'a'.repeat(64),coletadoEm:DATA}]})];
  const md=criarRelatorioCliente(p).conteudo;
  for(const s of ['Atividades relacionadas: Educação comunitária','Mapa do encaminhamento institucional','trecho publicado a conferir','a preencher (a confirmar)','Não presume inscrição individual','Achado derivado do HTML','Trecho publicado','Origem na página: p','a'.repeat(64),'Importância na atuação: principal','Retorno comercial: não medido','Conferir com a equipe'])assert.ok(md.includes(s),s);
});

test('exportação não transforma campos arbitrários de prioridade e rascunho em dados financeiros',()=>{
  const p=projeto();p.oportunidades.planoDeAcao=[tarefa({priorizacao:{criterios:[{criterio:'retorno_comercial',valor:987654.321},{criterio:'lucro_inventado',valor:'987654.321'}]},modeloEntregavel:{campos:[{rotulo:'Valor desconhecido',valorSugerido:987654.321}]}})];
  const md=criarRelatorioCliente(p).conteudo;assert.ok(!md.includes('987654'));assert.ok(md.includes('a preencher'));assert.ok(!md.includes('lucro_inventado'));
});

test('plano exportado preserva a decisão concreta e os rótulos como observação não executada',()=>{
  const p=projeto();p.oportunidades.planoDeAcao=[tarefa({eixo:'negocio',decisaoCliente:{objeto:'Passagens',objetivo:'Escolher o trajeto.',escolha:'Origem, destino e data',percurso:['Localizar o campo.','Conferir o próximo passo sem compra.'],fatos:[{descricao:'O HTML publica um campo de origem.',evidencias:[{tipo:'interface_publica',natureza:'rotulo_literal',url:'https://cliente.com.br/',campo:'form.label',trecho:'Origem',coletadoEm:DATA,sha256:'b'.repeat(64)}]}],restricoes:['Não enviar dados.'],incertezas:['Disponibilidade do trajeto não verificada'],resultadoAConferir:'A pessoa localiza a busca.'}})];
  const md=criarRelatorioCliente(p).conteudo;
  for(const s of ['Decisão do visitante','Origem, destino e data','Rótulo observado na interface','ação não executada','form\\.label','b'.repeat(64),'Disponibilidade do trajeto não verificada','Não enviar dados','A pessoa localiza a busca'])assert.ok(md.includes(s),s);
});

test('campos ausentes ou estados indefinidos não viram posições, procura ou cobertura zero', () => {
  const p = projeto();
  p.oportunidades.itens = [{}, {observado:{}}, {observado:{estado:undefined,posicao:undefined}}, {observado:{estado:'indisponivel'}}];
  p.demanda = {estado:'disponivel'};
  const r = criarRelatorioCliente(p);
  assert.match(r.conteudo,/quantidade de páginas não informada/);
  assert.match(r.conteudo,/Posições atuais: ainda não confirmadas/);
  assert.match(r.conteudo,/não há estimativa válida disponível/);
  assert.ok(!r.conteudo.includes('0 página(s)'));
  assert.ok(!r.conteudo.includes('posição undefined'));
  assert.ok(!r.conteudo.includes('há observações no recorte'));
  assert.equal(r.arquivo,'plano-cliente.com.br-r2.md');
});

test('zero de leitura e demanda explícita são preservados com fonte e período válidos', () => {
  const p = projeto();
  p.descoberta = {cobertura:{paginasLidas:0,limitePaginas:12,limitada:true}};
  p.palavras = {candidatos:[]};
  p.demanda = demanda();
  const r = criarRelatorioCliente(p);
  assert.match(r.conteudo,/Leitura pública: 0 página\(s\) de um limite de 12/);
  assert.match(r.conteudo,/Cobertura da descoberta: parcial/);
  assert.match(r.conteudo,/Palavras candidatas: 0/);
  assert.match(r.conteudo,/há estimativas históricas/);
  assert.match(r.conteudo,/Fonte de procura: Fonte de teste/);
  assert.ok(r.conteudo.includes(DATA));
  assert.ok(r.conteudo.includes('2025\\-11 a 2026\\-10'));
});

test('posição e ausência no recorte exigem estados explícitos, valores consistentes e fonte atual', () => {
  const p = projeto();
  p.oportunidades.itens = [observacao(), observacao({termo:'Outra busca',observado:{estado:'nao_encontrado_no_recorte',posicao:null}}),
    observacao({termo:'Sem valor',observado:{estado:'encontrado'}}),observacao({termo:'Zero inválido',observado:{estado:'encontrado',posicao:0}}),
    observacao({termo:'Sem fonte',evidencias:[]})];
  const r = criarRelatorioCliente(p);
  assert.match(r.conteudo,/1 busca\(s\) com posição observada/);
  assert.match(r.conteudo,/Capturas sem o site no recorte: 1/);
  assert.match(r.conteudo,/posição 7/);
  assert.match(r.conteudo,/Fonte: SerpApi/);
  assert.match(r.conteudo,/Brasil; Português; Computador; Brasil/);
  assert.ok(!r.conteudo.includes('posição 0'));
  assert.ok(!r.conteudo.includes('Sem fonte'));
});

test('captura vencida, futura ou com data inexistente não aparece como posição atual', () => {
  for(const coletadoEm of ['2026-11-15T17:00:00Z','2026-11-15T20:00:00Z','2026-02-30T19:00:00Z',undefined]) {
    const p = projeto();p.oportunidades.itens=[observacao({evidencias:[evidencia({coletadoEm})]})];
    const r = criarRelatorioCliente(p);
    assert.match(r.conteudo,/Posições atuais: ainda não confirmadas/);
    assert.ok(!r.conteudo.includes('posição 7'));
  }
});

test('HTML e Markdown fornecidos em textos permanecem texto literal', () => {
  const p = projeto();
  p.perfil.nome='[Clique](javascript:alert(1))';
  p.perfil.resumo='<script>alert(1)</script>\n## Injetado';
  p.oportunidades.planoDeAcao=[tarefa({titulo:'**Título** [link](javascript:alert(2))',acao:'<img src=x onerror=alert(3)>\n1. Passo falso'})];
  const r = criarRelatorioCliente(p);
  assert.ok(!r.conteudo.includes('<script>'));
  assert.ok(!r.conteudo.includes('<img'));
  assert.ok(r.conteudo.includes('&lt;script&gt;'));
  assert.ok(!r.conteudo.includes('[Clique](javascript:'));
  assert.ok(!r.conteudo.includes('\n## Injetado'));
  assert.ok(!r.conteudo.includes('\n1. Passo falso'));
  assert.ok(r.conteudo.includes('\\*\\*Título\\*\\*'));
});

test('links preservam URLs públicas válidas e recusam destinos inseguros ou com dados privados', () => {
  const p = projeto();
  p.oportunidades.planoDeAcao=[tarefa({paginaAlvo:{url:'https://cliente.com.br/oferta(1)'},
    evidencias:[{url:'https://cliente.com.br/origem',trecho:'A oferta publicada.',coletadoEm:DATA}]})];
  const valido = criarRelatorioCliente(p).conteudo;
  assert.ok(valido.includes('](https://cliente.com.br/oferta%281%29)'));
  assert.ok(valido.includes('](https://cliente.com.br/origem)'));
  for(const url of ['javascript:alert(1)','data:text/html,<script>x</script>','https://usuario:senha@cliente.com.br/',
    'https://cliente.com.br/p?token=privado','https://cliente.com.br/p#privado','http://127.0.0.1/']) {
    p.oportunidades.planoDeAcao=[tarefa({paginaAlvo:{url}})];
    const r = criarRelatorioCliente(p);
    assert.ok(!r.conteudo.includes('Página: ['));
    assert.ok(!r.conteudo.includes('senha@'));
    assert.ok(!r.conteudo.includes('token=privado'));
  }
});

test('exportação seleciona campos e exclui números financeiros estruturados sem apagar texto público', () => {
  const p = projeto();
  p.perfil.resumo='Plano anunciado a R$ 99,00, sujeito à revisão.';
  p.perfil.ofertas=[{nome:'Consultoria',economia:{contribuicaoPorVenda:378293.75,taxaFechamento:0.918273}}];
  p.oportunidades.frentes=[{valorPorContato:{valor:763491.25}}];
  p.oportunidades.planoDeAcao=[tarefa({valorPorContato:{valor:765432.125},
    ofertasAfetadas:[{id:'oferta1',nome:'Consultoria',economia:{contribuicaoPorVenda:378293.75}}]})];
  const r = criarRelatorioCliente(p);
  for(const valor of ['378293','0.918273','763491','765432','contribuicaoPorVenda','valorPorContato']) assert.ok(!r.conteudo.includes(valor),valor);
  assert.ok(r.conteudo.includes('R$ 99,00'));
  assert.match(r.conteudo,/Textos e evidências podem conter valores publicados ou digitados/);
});

test('tarefas repetidas são reunidas preservando evidências e passos distintos', () => {
  const p = projeto();
  const a={url:'https://cliente.com.br/a',trecho:'Primeira evidência',coletadoEm:DATA};
  const b={url:'https://cliente.com.br/b',trecho:'Segunda evidência',coletadoEm:DATA};
  p.oportunidades.planoDeAcao=[tarefa({id:'a',evidencias:[a],base:'observacao'}),
    tarefa({id:'b',passos:['Abra a página.','Repita a leitura.'],evidencias:[a,b],base:'observacao'})];
  const r = criarRelatorioCliente(p);
  assert.equal((r.conteudo.match(/^### \d+\./gm)||[]).length,1);
  assert.equal((r.conteudo.match(/Primeira evidência/g)||[]).length,1);
  assert.ok(r.conteudo.includes('Segunda evidência'));
  assert.ok(r.conteudo.includes('Repita a leitura'));
  assert.ok(r.conteudo.includes('observação registrada'));
  assert.ok(r.conteudo.includes('Como conferir a conclusão'));
});

test('limite de 64 se aplica a tarefas únicas, sem esconder uma tarefa diferente após duplicatas', () => {
  const p = projeto();
  p.oportunidades.planoDeAcao=[...Array.from({length:70},()=>tarefa()),
    ...Array.from({length:70},(_,n)=>tarefa({titulo:'Tarefa única '+n,acao:'Ação única '+n}))];
  const r = criarRelatorioCliente(p);
  assert.equal((r.conteudo.match(/^### \d+\./gm)||[]).length,64);
  assert.ok(r.conteudo.includes('Tarefa única 0'));
  assert.ok(!r.conteudo.includes('Tarefa única 69'));
  assert.match(r.conteudo,/até 64 tarefas únicas/);
});

test('evidência ausente mantém a tarefa como conferência e fornece critério verificável', () => {
  const p = projeto();
  p.perfil.estado='rascunho';
  p.oportunidades.planoDeAcao=[tarefa({base:'observacao',criterioSucesso:null,comoValidar:'Confira o resultado com uma pessoa.'})];
  const r = criarRelatorioCliente(p);
  assert.match(r.conteudo,/rascunho que precisa de revisão/);
  assert.match(r.conteudo,/hipótese ou conferência a realizar/);
  assert.match(r.conteudo,/Evidência desta tarefa: ainda não registrada/);
  assert.match(r.conteudo,/Confira o resultado com uma pessoa/);
});

test('formatter não modifica o projeto e valida o nome do arquivo e a revisão', () => {
  const p = projeto(), original=structuredClone(p);
  criarRelatorioCliente(p);
  assert.deepEqual(p,original);
  for(const invalido of [null,{}, {...p,revisao:0},{...p,revisao:-1},{...p,dominio:'../../privado'}]) {
    assert.throws(()=>criarRelatorioCliente(invalido));
  }
});

test('relações propostas conservam trecho, fonte, data e identificador sem certificar o negócio',()=>{
  const p=projeto();p.perfil.entendimento={relacoes:[{texto:'Conectamos contratantes a prestadores.',natureza:'hipotese',
    evidencias:[{url:'https://cliente.com.br/como-funciona',trecho:'Conectamos contratantes a prestadores.',coletadoEm:DATA,sha256:'c'.repeat(64)}]}]};
  const r=criarRelatorioCliente(p).conteudo;
  assert.match(r,/hipóteses, sem confirmação jurídica ou financeira/);assert.ok(r.includes('https://cliente.com.br/como-funciona'));
  assert.ok(r.includes(DATA));assert.ok(r.includes('c'.repeat(64)));
});

test('propósito e território exportados não viram público ou região comercial declarados',()=>{
  const p=projeto(),fonte={url:'https://cliente.com.br/missao',trecho:'Fomentar iniciativas nas periferias urbanas.',coletadoEm:DATA,sha256:'d'.repeat(64)};
  p.perfil.entendimento={proposito:{texto:'Fomentar iniciativas.',evidencias:[fonte]},territorios:[{texto:'periferias urbanas',evidencias:[fonte]}]};
  const original=structuredClone(p),r=criarRelatorioCliente(p).conteudo;
  assert.match(r,/Propósito proposto a partir do site/);assert.match(r,/não identificam público humano nem confirmam região/);
  assert.ok(r.includes('https://cliente.com.br/missao'));assert.ok(r.includes('d'.repeat(64)));assert.deepEqual(p,original);
});

test('uma decisão agrupada conserva as páginas e as condições de cada oferta',()=>{
  const p=projeto(),fonte=(url,trecho)=>({url,trecho,coletadoEm:DATA,sha256:'e'.repeat(64)});
  p.oportunidades.planoDeAcao=[tarefa({eixo:'negocio',paginasRelacionadas:[{url:'https://cliente.com.br/equipes'},{url:'https://cliente.com.br/entrega'}],
    decisaoCliente:{escolha:'Distinguir demanda e validação.',escoposPorOferta:[
      {nome:'Equipes técnicas',pagina:'https://cliente.com.br/equipes',fatos:[{descricao:'Equipe para projeto.',evidencias:[fonte('https://cliente.com.br/equipes','Equipe para projeto.')]}]},
      {nome:'Modelo de entrega',pagina:'https://cliente.com.br/entrega',fatos:[{descricao:'Validação humana.',evidencias:[fonte('https://cliente.com.br/entrega','Validação humana.')]}]}
    ]}})];
  const r=criarRelatorioCliente(p).conteudo;
  for(const s of ['Equipes técnicas','Modelo de entrega','Equipe para projeto','Validação humana','https://cliente.com.br/equipes','https://cliente.com.br/entrega','e'.repeat(64)])assert.ok(r.includes(s),s);
  assert.match(r,/Páginas relacionadas à mesma decisão/);assert.equal((r.match(/^### \d+\./gm)||[]).length,1);
});

test('fontes sem vínculo saem em seção de revisão, sem tarefa nem premissas econômicas',()=>{
 const p=projeto();p.prioridades={tarefasDisponiveis:[],pendenciasDeOferta:[{ofertaNome:'Serviço sob revisão',natureza:'pendencia_de_atribuicao',recomendacaoComercial:false,motivo:'O vínculo precisa de confirmação.',fontesRecusadas:[{url:'https://cliente.com.br/servicos',trecho:'Texto <script>local</script> de outro objeto.',coletadoEm:DATA,sha256:'f'.repeat(64)}],premissasEconomicas:{contribuicaoPorVenda:987654321}}]};
 const antes=structuredClone(p),r=criarRelatorioCliente(p).conteudo;
 assert.match(r,/Publicações com escopo a revisar/);assert.match(r,/não sustentam uma recomendação de edição/);
 assert.ok(r.includes('&lt;script&gt;local&lt;/script&gt;'));assert.ok(r.includes('f'.repeat(64)));
 assert.equal((r.match(/^### \d+\./gm)||[]).length,0);assert.doesNotMatch(r,/987654321/);assert.deepEqual(p,antes);
});

test('deduplicação conserva critério e observação existentes numa cópia mais completa', () => {
  const p = projeto();
  p.oportunidades.planoDeAcao=[tarefa({criterioSucesso:null}), tarefa({base:'observacao',criterioSucesso:'Critério específico da conferência.',
    evidencias:[{url:'https://cliente.com.br/servicos',trecho:'Achado registrado na página.',coletadoEm:DATA}]})];
  const r = criarRelatorioCliente(p);
  assert.equal((r.conteudo.match(/^### \d+\./gm)||[]).length,1);
  assert.ok(r.conteudo.includes('Critério específico da conferência'));
  assert.ok(r.conteudo.includes('observação registrada'));
});


test('exportação da regra conserva a frase seguinte do contexto e não apenas a atividade extraída',()=>{
 const p=projeto(),trecho='Seu cliente não precisa criar conta para assinar. Para enviar documentos, a equipe usa o plano Corporativo.',f={trecho,tipo:'declaracao',campo:'p',url:'https://cliente.com.br/',sha256:'a'.repeat(64),coletadoEm:DATA,recortado:false};
 p.perfil.entendimento={condicoesPorAtividade:extrairCondicoesPorAtividade({dominio:p.dominio,fontes:[f]})};assert.equal(p.perfil.entendimento.condicoesPorAtividade.itens.length,1);const antes=structuredClone(p),md=criarRelatorioCliente(p).conteudo;assert.ok(md.includes('Para enviar documentos, a equipe usa o plano Corporativo'));assert.ok(md.includes('não precisa criar conta para assinar'));assert.deepEqual(p,antes);
});

test('exportação nominal mantém exclusão posterior que não pertence ao recorte da relação',()=>{
 const p=projeto(),trecho='A instalação é responsabilidade do cliente. Essa atribuição não abrange suporte técnico.',f={trecho,tipo:'declaracao',campo:'p',url:'https://cliente.com.br/',sha256:'a'.repeat(64),coletadoEm:DATA,recortado:false};
 p.perfil.entendimento={atribuicoesNominais:extrairAtribuicoesNominais({dominio:p.dominio,fontes:[f]})};assert.equal(p.perfil.entendimento.atribuicoesNominais.itens.length,1);const antes=structuredClone(p),md=criarRelatorioCliente(p).conteudo;assert.ok(md.includes('Essa atribuição não abrange suporte técnico'));assert.ok(md.includes('responsabilidade do cliente'));assert.deepEqual(p,antes);
});
