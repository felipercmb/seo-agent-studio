/** Curadoria autoral DEV pareada; não lê VAL/TEST, modelos ou rede. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validarEntradaCritica,validarSaidaCritica,TIPOS_PROBLEMA,DEFINICOES_PROBLEMA} from './contrato.mjs';

const fonte=(id,texto,tipo='declaracao')=>({id,texto,tipo});
const criterio=(texto,escopo,fontes=['f01'])=>({texto,escopo,fontes});
const sha=b=>createHash('sha256').update(b).digest('hex');
function proposta(decisao,criterios,acao,verificar,incertezas){
  return{estado:'proposta',decisao,alternativas:[],criterios,acao,verificar,
    fontes:[...new Set(criterios.flatMap(c=>c.fontes))],incertezas,hipotese:true};
}
function diferencas(a,b,p=''){
  if(a===b)return[];
  if(a!==null&&b!==null&&typeof a==='object'&&typeof b==='object'){
    const ks=new Set([...Object.keys(a),...Object.keys(b)]);
    return[...ks].flatMap(k=>diferencas(a[k],b[k],p?`${p}.${k}`:k));
  }
  return[{caminho:p,antes:a,depois:b}];
}
function mudar(obj,caminho,valor){const ks=caminho.split('.'),ultimo=ks.pop();let x=obj;for(const k of ks)x=x[k];x[ultimo]=valor;}

export function construirFamilias(){
  const f=[];
  const adicionar=(id,split,tipo,fontes,boa,caminho,valorFalho,refs,explicacao)=>{
    const ruim=structuredClone(boa);mudar(ruim,caminho,valorFalho);
    const delta=diferencas(boa,ruim);if(delta.length!==1)throw Error(id+': o par não altera exatamente uma folha.');
    f.push({id,split,tipo,fontes,boa,ruim,delta,problema:{tipo,trechoPropostaLiteral:valorFalho,fontes:refs,explicacao}});
  };
  adicionar('prazo-atualizacao-licenca','train','condicao_alterada',[
    fonte('f01','Vendemos a Licença Traço para escritórios de desenho. As atualizações estão incluídas por dezoito meses contados após a aquisição da licença; a licença continua válida depois desse período.')],
    proposta('Conferir a diferença entre duração da licença e prazo de atualizações antes de uma intenção de compra.',
      [criterio('por dezoito meses contados após a aquisição da licença','atualizações')],
      'Para o responsável pelo site, montar uma comparação fictícia entre data da compra e fim das atualizações; manter a validade da licença em linha separada.',
      'Antes de comprar, confira que o prazo começa após a aquisição; no exemplo fictício, a data de fim das atualizações deve ser calculada a partir da compra.',
      ['Não foram informadas as condições para obter atualizações depois do período incluído.']),
    'verificar','Antes de comprar, confira que o prazo começa antes da aquisição; no exemplo fictício, a data de fim das atualizações deve ser calculada a partir da compra.',
    ['f01'],'O trecho troca após por antes no início do prazo. A fonte conta as atualizações após a aquisição; conferir a regra antes de comprar não muda esse marco.');

  adicionar('entrega-programada-escopo','train','escopo_incorreto',[
    fonte('f01','A Entrega Programada aceita até quatro volumes por pedido. A Entrega Avulsa segue cotação própria e não tem limite de volumes publicado nesta página.')],
    proposta('Separar o limite publicado da Entrega Programada da condição ainda não publicada da Entrega Avulsa.',
      [criterio('aceita até quatro volumes por pedido','Entrega Programada')],
      'Apresentar ao responsável dois pedidos fictícios, de três e seis volumes, e registrar onde a regra publicada permite decidir e onde será necessário pedir cotação própria.',
      'O pedido de três volumes cabe no limite publicado da Programada; seis não cabe nesse limite. A Avulsa permanece a confirmar, sem copiar o limite de quatro volumes.',
      ['Não foi fornecido limite ou preço para a Entrega Avulsa.']),
    'criterios.0.escopo','Entrega Avulsa',['f01'],
    'Em criterios[0].escopo, o limite de quatro volumes foi transferido da Entrega Programada para a Entrega Avulsa. Os dois nomes são literais, mas só a primeira tem esse limite publicado.');

  adicionar('traducao-comprador-prestador','train','ator_ou_papel_trocado',[
    fonte('f01','A Ponte Editorial intermedeia traduções: editoras contratam e tradutores independentes executam o trabalho. A plataforma organiza a proposta, mas não traduz os textos.'),
    fonte('f02','O orçamento depende da aceitação da editora antes do início da tradução. A solicitação de orçamento não autoriza a execução.')],
    proposta('Testar se o fluxo de orçamento distingue a editora contratante do tradutor executor.',
      [criterio('depende da aceitação da editora antes do início da tradução','orçamento',['f02'])],
      'Desenhar um fluxo fictício para o responsável: pedido da editora, proposta do tradutor e aceite da editora. Identificar o executor em cada etapa, sem solicitar trabalho real.',
      'No fluxo fictício, a editora deve aparecer como contratante e o tradutor como executor; a execução continua dependente do aceite da editora.',
      ['Não foram fornecidos preço, prazo ou disponibilidade de tradutor.']),
    'verificar','No fluxo fictício, o tradutor deve aparecer como contratante e a editora como executora; a execução continua dependente do aceite da editora.',
    ['f01','f02'],'A verificação troca contratante e executor. A fonte atribui contratação às editoras e execução aos tradutores independentes; orçamento não muda esses papéis.');

  adicionar('claim-retorno-horas','train','alegacao_como_resultado',[
    fonte('f01','A publicidade do Fluxo Rápido afirma retorno de 4,3 horas poupadas por hora de configuração. Esta página não apresenta medição feita na empresa do visitante.'),
    fonte('f02','O Plano Piloto inclui um modelo de relatório de horas. O exemplo público usa dados fictícios e não permite concluir economia real.')],
    proposta('Separar a alegação promocional de retorno de horas da evidência que o modelo de relatório permite conferir.',
      [criterio('usa dados fictícios e não permite concluir economia real','exemplo público',['f02'])],
      'Preparar para o responsável uma ficha com alegação atribuída e coluna de medição ainda vazia. Usar somente os dados fictícios para verificar a leitura do relatório, sem calcular retorno real.',
      'Registrar: a fonte afirma retorno de 4,3 horas por hora de configuração; não foi observado aqui. O relatório fictício não comprova economia na empresa.',
      ['Não foram fornecidos tempos reais anteriores ou posteriores à configuração.']),
    'verificar','Registrar que o retorno de 4,3 horas por hora de configuração foi observado aqui. O relatório fictício comprova economia na empresa.',
    ['f01','f02'],'Uma alegação publicitária e um exemplo fictício foram tratados como observação na empresa. A fonte declara que não há essa medição e que o exemplo não permite concluir economia real.');

  adicionar('reserva-publica-simulacao','train','verificacao_inviavel',[
    fonte('f01','A Sala Aberta oferece aluguel de salas. O simulador público calcula duração e saldo fictício sem reservar sala. O botão Confirmar reserva, no calendário público, efetua uma reserva real e altera a disponibilidade; esse calendário não exige cadastro.')],
    proposta('Testar a distinção entre uma simulação de duração e a confirmação de reserva real de sala.',
      [criterio('sem reservar sala','simulador público'),criterio('efetua uma reserva real e altera a disponibilidade','Confirmar reserva')],
      'Montar com o responsável um exemplo local de duração e conferir as diferenças entre o simulador e o calendário, sem enviar pedido ou bloquear horário.',
      'Simular sem confirmar reserva real e sem transferir saldo; conferir que o resultado continua fictício e não altera a disponibilidade de salas.',
      ['A disponibilidade de um horário real não foi medida neste ensaio.']),
    'verificar','Clicar em Confirmar reserva para efetuar uma reserva real e bloquear um horário no calendário público; usar a alteração da disponibilidade como resultado do teste.',
    ['f01'],'A verificação deixa de ser simulação e exige uma transação real que altera a agenda. O fato de o calendário ser público e sem cadastro não autoriza efetivar reserva neste ensaio.');

  adicionar('prazo-ja-publicado','train','diagnostico_sem_evidencia',[
    fonte('f01','Na página de Orçamento Técnico está publicado: respondemos em até três dias úteis. Esse prazo se aplica ao formulário de orçamento; urgências de clientes contratados usam o canal previsto em seu atendimento.')],
    proposta('Testar se um visitante distingue o prazo do orçamento do encaminhamento de urgências, usando o texto já publicado.',
      [criterio('respondemos em até três dias úteis','Orçamento Técnico')],
      'Usar a página local já capturada para pedir ao responsável uma conferência com dois pedidos fictícios: orçamento comum e urgência de cliente contratado. Registrar o caminho indicado, sem enviar formulário.',
      'O orçamento deve ser associado a três dias úteis; urgência deve ser separada desse formulário. Registrar eventual dúvida observada, sem afirmar que a informação falta.',
      ['Não foi observado como visitantes reais interpretam a página.']),
    'acao','Adicionar o prazo de resposta à página, pois o site não informa nenhum prazo para orçamento.',
    ['f01'],'O diagnóstico de ausência contradiz a fonte, que publica o prazo de três dias úteis na página de orçamento. Um teste de compreensão é possível, mas não prova falta do conteúdo.');

  adicionar('certificado-dois-requisitos','validation','condicao_alterada',[
    fonte('f01','A Oficina de Narrativas fornece certificado somente a quem cumpre os dois requisitos: presença em cinco encontros e entrega do projeto final. Comparecer aos encontros, sem entregar o projeto, não dá direito ao certificado.')],
    proposta('Conferir se a explicação do certificado preserva os dois requisitos da Oficina de Narrativas.',
      [criterio('presença em cinco encontros e entrega do projeto final','certificado')],
      'Preparar com o responsável dois exemplos fictícios: presença completa sem projeto e presença completa com projeto. Usar esses exemplos para conferir a explicação, sem emitir certificado.',
      'O exemplo sem projeto deve permanecer inelegível, mesmo com cinco encontros; apenas o exemplo que cumpre os dois requisitos permite solicitar o certificado.',
      ['Não foram informados prazo e procedimento para emissão do certificado.']),
    'verificar','O exemplo sem projeto deve ser considerado elegível se compareceu aos cinco encontros; a entrega do projeto final não é necessária para solicitar o certificado.',
    ['f01'],'A verificação elimina um requisito necessário e transforma presença em condição suficiente. A fonte exige presença e projeto final, e nega o direito ao certificado sem projeto.');

  adicionar('portfolio-expositor-visitante','validation','escopo_incorreto',[
    fonte('f01','A seleção de Expositores exige portfólio. A entrada de Visitantes é aberta e não exige portfólio. Expositores apresentam suas peças; visitantes podem conhecer a feira sem participar da seleção.')],
    proposta('Separar a seleção de expositores do acesso de visitantes à feira.',
      [criterio('exige portfólio','Expositores')],
      'Conferir com o responsável um percurso fictício de expositor e outro de visitante. Manter a seleção no primeiro e a visita aberta no segundo, sem coletar portfólio nem inscrever ninguém.',
      'A conferência deve exigir portfólio apenas do expositor em seleção; não exigir dos visitantes o requisito de quem expõe.',
      ['Não foram informados calendário ou vagas da seleção de expositores.']),
    'criterios.0.escopo','Visitantes',['f01'],
    'Em criterios[0].escopo, o requisito de portfólio foi transferido aos Visitantes. A fonte o impõe aos Expositores e explicitamente dispensa os Visitantes.');

  adicionar('software-proprio-integracoes','validation','ator_ou_papel_trocado',[
    fonte('f01','Operamos o Monitor de Tarefas por assinatura com nossa própria equipe. O software integra aplicativos de terceiros, mas não conecta clientes a consultores externos para executar o serviço.'),
    fonte('f02','O Plano Equipe inclui três integrações de aplicativos. Integração de aplicativo não inclui consultoria de terceiros.')],
    proposta('Apresentar o Monitor de Tarefas como serviço próprio e separar integração de aplicativo de consultoria externa.',
      [criterio('inclui três integrações de aplicativos','Plano Equipe',['f02']),criterio('não inclui consultoria de terceiros','Integração de aplicativo',['f02'])],
      'Preparar com o responsável uma comparação entre integrar um aplicativo e contratar consultoria. Marcar a primeira como recurso do software e manter a segunda fora do que foi publicado.',
      'A comparação deve manter a execução com a equipe da empresa e não criar um mercado de consultores a partir das integrações de aplicativos.',
      ['Não foram publicados fornecedores de consultoria ou contratação desse serviço.']),
    'decisao','Apresentar o Monitor de Tarefas como intermediador de consultores externos, pois integra aplicativos de terceiros.',
    ['f01','f02'],'A proposta troca execução própria por intermediação e infere consultores a partir de integrações. A fonte declara equipe própria e nega essa conexão com consultores externos.');

  adicionar('claim-ensaio-nao-fornecido','validation','alegacao_como_resultado',[
    fonte('f01','A página promocional do Verniz Nuvem afirma resistência a quarenta e seis ciclos. Não fornece neste material protocolo de ensaio ou laudo.'),
    fonte('f02','O Verniz Nuvem Fosco destina-se apenas a ambientes internos secos. A versão Externa tem orientações próprias.')],
    proposta('Distinguir a indicação de ambiente da alegação promocional de resistência do Verniz Nuvem Fosco.',
      [criterio('destina-se apenas a ambientes internos secos','Verniz Nuvem Fosco',['f02'])],
      'Conferir com o responsável um exemplo de ambiente interno seco e deixar uso externo sujeito às orientações próprias. Registrar a resistência como alegação do fabricante, sem inventar ensaio realizado.',
      'A indicação deve ficar limitada ao ambiente publicado. A fonte afirma resistência a quarenta e seis ciclos; esse ensaio não foi observado aqui e o laudo não foi fornecido.',
      ['Não foram fornecidos protocolo de ensaio ou orientações da versão Externa.']),
    'verificar','A indicação deve ficar limitada ao ambiente publicado. A resistência a quarenta e seis ciclos foi observada aqui e validada em nosso ensaio do produto.',
    ['f01','f02'],'O trecho transforma uma alegação promocional em ensaio observado e validado pelo analista. Nenhum ensaio ou laudo foi fornecido neste material.');

  adicionar('painel-privado-sem-acesso','validation','verificacao_inviavel',[
    fonte('f01','A página pública do Relato de Chamados informa que o Plano Gestão inclui relatório de atendimentos. O relatório de uma empresa só pode ser consultado no painel privado após autenticação.'),
    fonte('f02','Material deste diagnóstico simulado: somente a página pública, sem credenciais, sessão autenticada ou relatório privado fornecido.','conteudo')],
    proposta('Distinguir a existência publicada do recurso de relatório dos dados privados que ainda não foram fornecidos.',
      [criterio('inclui relatório de atendimentos','Plano Gestão')],
      'Conferir o recurso no material público e preparar ao responsável uma pergunta sobre o plano usado. Registrar a resposta como declaração, sem abrir painel ou afirmar conteúdo do relatório privado.',
      'O registro deve separar recurso publicado, plano declarado e dados privados não fornecidos; não acessar o painel nem concluir volume ou qualidade de atendimentos.',
      ['Credenciais e relatório privado não foram fornecidos para este diagnóstico.']),
    'verificar','Acessar o painel privado com as credenciais da empresa e ler seu relatório de atendimentos para concluir o conteúdo do relatório real neste diagnóstico.',
    ['f01','f02'],'O teste exige credenciais e relatório que o material explicitamente não fornece. A existência pública do recurso não permite executar essa verificação privada neste ensaio.');

  adicionar('html-inicial-nao-e-site-completo','validation','diagnostico_sem_evidencia',[
    fonte('f01','Oferecemos o Catálogo Móvel por assinatura para fornecedores. O catálogo de produtos é carregado pela interface do aplicativo após a inicialização.'),
    fonte('f02','Registro técnico simulado: a captura do HTML inicial contém o título Catálogo Móvel e um contêiner vazio. Não foi fornecida captura renderizada após a inicialização da interface.','conteudo')],
    proposta('Separar a limitação do HTML inicial da existência do catálogo antes de diagnosticar falta de produtos.',
      [criterio('é carregado pela interface do aplicativo após a inicialização','catálogo de produtos')],
      'Registrar com o responsável a limitação da captura inicial e preparar uma solicitação de captura renderizada local. Manter a presença dos itens como não observada até receber esse material, sem afirmar que o catálogo está ausente.',
      'O diagnóstico deve distinguir não observado no HTML inicial de ausente no site. A fonte declara catálogo por interface, mas os itens renderizados ainda precisam de evidência.',
      ['Não foi fornecida captura renderizada ou lista dos produtos.']),
    'acao','Adicionar uma lista de produtos, pois o site não oferece catálogo e a ausência de itens no HTML inicial comprova que o catálogo não existe.',
    ['f01','f02'],'A captura inicial incompleta não prova ausência no site. A fonte declara carregamento do catálogo pela interface, e falta a captura renderizada para observar os itens.');
  return f;
}

export function montarCorpus(){
  const familias=construirFamilias(),casos=[];
  if(familias.length!==12||new Set(familias.map(f=>f.id)).size!==12)throw Error('Esperadas12famílias distintas.');
  for(const fam of familias){
    const proveniencia={tipo:'documento_autoral_simulado',fonteSimulada:true,publicado:false,empresaReal:false,sha256Fontes:sha(JSON.stringify(fam.fontes))};
    for(const [variante,plano,esperado]of [
      ['consistente',fam.boa,{estado:'manter',problemas:[]}],
      ['uma_falha',fam.ruim,{estado:'revisar',problemas:[fam.problema]}],
    ]){
      const entrada={tarefa:'criticar',fontes:fam.fontes,proposta:plano},v=validarEntradaCritica(entrada),s=validarSaidaCritica(esperado,entrada);
      if(!v.valido||!s.valido)throw Error(fam.id+' '+variante+': '+JSON.stringify([v.erros,s.erros]));
      casos.push({id:'critico-'+fam.id+'-'+variante,grupoEmpresarial:'simulacao-critico-'+fam.id,familia:fam.id,split:fam.split,
        natureza:'contrafactual_controlado_nao_publicado',entrada,esperado,
        anotacaoForaDoPrompt:{variante,tipoPrincipal:fam.tipo,mutacao:variante==='uma_falha'?fam.delta:[],rotuloAutoral:true},
        proveniencia,elegivelTreinoExperimental:false,treinoEfetivoPermitido:false,revisaoCruzadaPendente:true,revisaoHumana:false,revisaoHumanaPendente:true,prontoParaUsoComClientes:false,
        origemRotulos:{autor:'rodada_valor_fontes',tipo:'supervisao_tecnica_experimental_autoral',autorizacaoUsuarioExperimentoLocal:true,consentimentoClienteTreino:null,revisaoHumana:false}});
    }
  }
  for(const tipo of TIPOS_PROBLEMA)for(const split of ['train','validation'])if(familias.filter(f=>f.tipo===tipo&&f.split===split).length!==1)throw Error('Tipos/famílias não balanceados: '+tipo+' '+split);
  casos.sort((a,b)=>sha(a.id).localeCompare(sha(b.id)));
  return{versao:1,geradoEm:new Date().toISOString(),natureza:'Corpus DEV autoral de consistência,24casos pareados/12famílias; não são documentos reais, VAL real ou TEST.',
    contrato:{entrada:'{tarefa:criticar,fontes:[{id,texto,tipo}],proposta:9chaves canônicas}',saida:'{estado:manter|revisar,problemas:[{tipo,trechoPropostaLiteral,fontes,explicacao}]}',tipos:DEFINICOES_PROBLEMA,
      manter:'Nenhuma inconsistência das categorias foi evidenciada; não certifica verdade, utilidade, completude ou uso com clientes.',trecho:'Substring literal de um único campo textual da proposta; não compor texto entre campos.'},
    casos,particao:{familias:12,casos:24,train:{familias:6,manter:6,revisar:6},validation:{familias:6,manter:6,revisar:6},gruposCruzados:0,mesmoParNoMesmoSplit:true,umTipoPorFamilia:true},
    testesDeIntegridade:{propostasMecanicamenteValidas:24,saidasCriticoMecanicamenteValidas:24,paresComUmaSoFolhaAlterada:12},
    elegivelTreinoExperimental:false,revisaoCruzadaPendente:true,revisaoHumana:false,revisaoHumanaPendente:true,prontoParaUsoComClientes:false,
    limites:['Não contém documentos, frases ou rótulos copiados de VAL/TEST; todos os cenários foram escritos para este lote.',
      'Os rótulos são autoria técnica, pendentes de revisão cruzada. Não são parecer humano profissional.',
      'As variantes diferem em uma única folha; todas preservam o contrato mecânico da proposta. Metadados de variante/mutação nunca devem entrar no prompt.',
      'Manter não aprova verdade/utilidade; um crítico treinado continua experimental e precisa medir falsos positivos e falsos negativos.',
      'Medir classe manter/revisar por família e tipo; reportar24casos,12famílias e split sem inflar independência pelos pares.',
      'Nenhuma captura, rede, modelo, GPU, transação ou revisão de TEST foi usada. Não modifica resultados anteriores0/12,0/8 ou0/4.']};
}

async function main(){
  const a=process.argv.slice(2);if(a.length!==2||a[0]!=='--saida')throw Error('Use --saida ARQUIVO_NOVO.');
  const destino=path.resolve(a[1]);if(fs.existsSync(destino))throw Error('Preserve arquivos anteriores; use destino novo.');
  const corpus=montarCorpus();corpus.codigo={geradorSha256:sha(fs.readFileSync(new URL(import.meta.url))),contratoCriticoSha256:sha(fs.readFileSync(new URL('./contrato.mjs',import.meta.url))),contratoPropostaSha256:sha(fs.readFileSync(new URL('../recomendacoes/validar.mjs',import.meta.url)))};
  fs.mkdirSync(path.dirname(destino),{recursive:true});fs.writeFileSync(destino,JSON.stringify(corpus,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({arquivo:destino,sha256:sha(fs.readFileSync(destino)),...corpus.particao}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
