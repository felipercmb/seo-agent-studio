import test from 'node:test';
import assert from 'node:assert/strict';
import {lerPrazosPublicados} from '../src/modulos/prazos-publicados.mjs';
import {extrairContextoPublico} from '../src/modulos/contexto-publico.mjs';
import {refinarPlanoAssistido} from '../src/modulos/prioridades-assistidas.mjs';

test('distingue duração máxima, início de cobrança e antecedência na mesma publicação',()=>{
  const trecho='Roteiro. Assim que os documentos são validados, a equipe confirma o acesso em até 48 horas, incluindo fins de semana. A primeira cobrança ocorre somente 30 dias após a compra, conforme o plano. O pedido deve ser feito com pelo menos 7 dias úteis de antecedência em relação à próxima fatura.';
  const prazos=lerPrazosPublicados(trecho);
  assert.deepEqual(prazos.map(p=>p.tipo),['duracao_maxima','inicio_depois_do_marco','antecedencia_minima']);
  assert.deepEqual(prazos.map(p=>p.prazo.texto),['em até 48 horas','somente 30 dias','pelo menos 7 dias úteis de antecedência']);
  assert.deepEqual(prazos.map(p=>p.marco.texto),['Assim que os documentos são validados','após a compra','em relação à próxima fatura']);
  assert.match(prazos[0].frase,/incluindo fins de semana/);
  for (const p of prazos) for (const c of [p.prazo,p.marco,p.acao]) {
    assert.equal(trecho.slice(c.inicio,c.fim),c.texto);
  }
});

test('não extrai pergunta, número sem marco ou unidade que pertence à contagem de pessoas',()=>{
  const trecho='Após a compra, a equipe confirma o pedido em até 24 horas? O atendimento responde em até 8 dias. Após a matrícula, a lista recebe até 10 pessoas.';
  assert.deepEqual(lerPrazosPublicados(trecho),[]);
});

test('preserva o marco quando ele vem depois do prazo',()=>{
  const [p]=lerPrazosPublicados('A confirmação fica disponível em até 48 horas após a conferência dos dados.');
  assert.equal(p.tipo,'duracao_maxima');
  assert.equal(p.prazo.texto,'em até 48 horas');
  assert.equal(p.marco.texto,'após a conferência dos dados');
  const [entreVirgulas]=lerPrazosPublicados('Implantação da loja em até 45 dias úteis, após o envio dos dados pelo cliente.');
  assert.equal(entreVirgulas.prazo.texto,'em até 45 dias úteis');
  assert.equal(entreVirgulas.marco.texto,'após o envio dos dados pelo cliente');
});

test('o prazo relativo ao evento preserva uma segunda condição inteira',()=>{
  const trecho='A troca será aceita até o dia anterior ao embarque, desde que esteja dentro de 5 dias após a emissão.';
  const [p]=lerPrazosPublicados(trecho);
  assert.equal(p.tipo,'prazo_com_condicao_adicional');
  assert.equal(p.prazo.texto,'até o dia anterior ao embarque');
  assert.equal(p.marco.texto,'desde que esteja dentro de 5 dias após a emissão');
  assert.equal(p.frase,trecho);
  for(const e of [p.prazo,p.marco,p.acao]) assert.equal(trecho.slice(e.inicio,e.fim),e.texto);
});

test('prazo nominal e evento inicial sobrevivem juntos sem inferir limite máximo',()=>{
  const s='Após o recebimento do material, a equipe faz a vistoria com o prazo de 5 dias úteis.';
  const [p]=lerPrazosPublicados(s);
  assert.equal(p.tipo,'prazo_declarado');
  assert.equal(p.marco.texto,'Após o recebimento do material');
  assert.equal(p.prazo.texto,'com o prazo de 5 dias úteis');
  assert.equal(s.slice(p.prazo.inicio,p.prazo.fim),p.prazo.texto);
});

test('preserva prazos da página inteira quando os detalhes gerais lotam',()=>{
  const dominio='empresa-exemplo.com.br',url='https://'+dominio+'/central-de-pedidos';
  const coletadoEm='2026-10-15T00:00:00.000Z';
  const retorno='Após o recebimento do pedido, a equipe confirma a devolução em até 2 dias úteis.';
  const opcao='Se o cliente entregar o item no balcão, o comprovante fica disponível imediatamente.';
  const corpo=Array.from({length:40},(_,i)=>'<p>Descrição editorial inventada de exemplo número '+i+' a respeito de organização de estoque.</p>').join('');
  const html='<body>'+corpo+'<p>'+retorno+'</p><p>'+opcao+'</p><p hidden>Após a compra, a equipe fará o envio em até 4 dias.</p></body>';
  const contextoPublico=extrairContextoPublico({dominio,coletadoEm,paginas:[{url,html,status:200,coletadoEm}]});
  assert.ok(!contextoPublico.detalhesPublicados.some(f=>f.trecho===retorno));
  assert.deepEqual(contextoPublico.fontesDePrazo.map(f=>f.trecho),[retorno,opcao]);
  const oferta={id:'oferta-1',nome:'Devoluções',url,evidencias:[]};
  const projeto={dominio,perfil:{estado:'confirmado',ofertas:[oferta]},contextoPublico};
  const agora=()=>Date.parse('2026-10-16');
  const plano=refinarPlanoAssistido(projeto,{}, {agora});
  const t=plano.tarefasDisponiveis.find(t=>t.decisao?.marcosPublicados);
  assert.deepEqual(t.decisao.marcosPublicados.map(m=>m.prazo.texto),['em até 2 dias úteis','imediatamente']);
  assert.ok(t.decisao.marcosPublicados.every(m=>m.fonte.url===url&&m.fonte.sha256===contextoPublico.cobertura.paginas[0].sha256));
  const fora={...projeto,perfil:{...projeto.perfil,ofertas:[{...oferta,url:'https://'+dominio+'/vendas'}]}};
  assert.ok(!refinarPlanoAssistido(fora,{}, {agora}).tarefasDisponiveis.some(t=>t.decisao?.marcosPublicados));
  const compartilhada={...projeto,perfil:{...projeto.perfil,ofertas:[oferta,{...oferta,id:'outra',nome:'Vendas'}]}};
  assert.ok(!refinarPlanoAssistido(compartilhada,{}, {agora}).tarefasDisponiveis.some(t=>t.decisao?.marcosPublicados));
});
