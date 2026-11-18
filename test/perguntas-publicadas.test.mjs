import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'parse5';
import {createHash} from 'node:crypto';
import {extrairPerguntasPublicadas} from '../src/modulos/perguntas-publicadas.mjs';
const fonte={url:'https://exemplo.com.br/',sha256:'a'.repeat(64),coletadoEm:'2026-11-17T10:00:00Z'};
const q=(name='Quem executa a entrega?',text='O transporte é executado pelos profissionais independentes contratados pelo cliente.')=>({'@type':'Question',name,acceptedAnswer:{'@type':'Answer',text}});
const faq=items=>({'@context':'https://schema.org','@type':'FAQPage',mainEntity:items});
const ler=(v,extra='')=>extrairPerguntasPublicadas(parse('<html><head><script type="application/ld+json">'+JSON.stringify(v).replace(/</gu,'\\u003c')+'</script></head><body>'+extra+'</body></html>'),fonte);

test('recupera resposta inteira e pergunta separada com ponteiro e hash do JSON original',()=>{
 const v=faq([q()]),r=ler(v);assert.equal(r.itens.length,1);const f=r.itens[0];assert.equal(f.trecho,v.mainEntity[0].acceptedAnswer.text);assert.equal(f.pergunta,v.mainEntity[0].name);assert.equal(f.sha256,fonte.sha256);assert.equal(f.origemEstruturada.respostaPointer,'/mainEntity/0/acceptedAnswer/text');assert.equal(f.origemEstruturada.jsonLdSha256,createHash('sha256').update(JSON.stringify(v)).digest('hex'));assert.equal(f.visibilidade,'nao_verificada');assert.equal(f.recortado,false);assert.equal(f.ofertaConfirmada,undefined);
});
test('grafo herda schema e conserva caminho e texto original marcado',()=>{
 const original='<p>A plataforma permite que <strong>o cliente</strong> organize sua equipe.</p>';const r=ler({'@context':'https://schema.org','@graph':[{'@type':'FAQPage',mainEntity:q('Quem organiza a equipe?',original)}]});assert.equal(r.itens[0].trecho,'A plataforma permite que o cliente organize sua equipe.');assert.equal(r.itens[0].origemEstruturada.respostaOriginal,original);assert.equal(r.itens[0].origemEstruturada.respostaPointer,'/@graph/0/mainEntity/acceptedAnswer/text');
});
test('pergunta isolada, QAPage, schema externo, Review e resposta sugerida não viram resposta própria',()=>{
 for(const v of [q(),{...faq([q()]),'@type':'QAPage'},{...faq([q()]),'@context':'https://outro.com'}, {'@context':'https://schema.org','@type':'Review',mainEntity:faq([q()])},faq([{'@type':'Question',name:'Quem presta o serviço?',suggestedAnswer:{'@type':'Answer',text:'A equipe do cliente executa essa atividade.'}}])])assert.equal(ler(v).itens.length,0);
});
test('não extrai FAQ de formulário nem depoimento e nunca lê valores de controles',()=>{
 const script='<script type="application/ld+json">'+JSON.stringify(faq([q()]))+'</script>';const r=extrairPerguntasPublicadas(parse('<body><form>'+script+'<input value="SEGREDO_LOCAL"></form><blockquote>'+script+'</blockquote><div class="testimonial">'+script+'</div></body>'),fonte);assert.equal(r.itens.length,0);assert.ok(!JSON.stringify(r).includes('SEGREDO_LOCAL'));
});
test('remove marcação executável do texto e não executa ou solicita nada',()=>{
 const r=ler(faq([q('Como contratar o serviço?','<p>O cliente solicita a proposta na página.</p><form><input value="SEGREDO"></form><script>roubar()</script>')]));assert.equal(r.itens[0].trecho,'O cliente solicita a proposta na página.');assert.ok(!r.itens[0].trecho.includes('roubar'));assert.equal(r.itens[0].autoria,'declaracao_do_site_nao_verificada');
});
test('resposta longa é recusada inteira, duplicatas não ocupam o orçamento e limite é explícito',()=>{
 const r=ler(faq([q(),q(),q('Como funciona a contratação?',('Texto publicado completo. ').repeat(100)),...Array.from({length:15},(_,i)=>q('Como funciona a modalidade '+i+'?','O cliente executa a rotina documentada da modalidade '+i+'.'))]));assert.equal(r.itens.length,12);assert.equal(r.limitada,true);assert.ok(r.descartes.some(d=>d.motivo==='pergunta_ou_resposta_fora_do_limite'));assert.ok(r.itens.every(f=>f.recortado===false));
});
