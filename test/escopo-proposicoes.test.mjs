import {test} from 'node:test';
import assert from 'node:assert/strict';
import {revisarEscopoProposicoes} from '../src/modulos/escopo-proposicoes.mjs';
const H='a'.repeat(64),D='exemplo.com.br',A='https://'+D+'/boleto',B='https://'+D+'/pix';
const fonte=(id,url=A,sha256=H)=>({id,texto:'Declaração publicada.',contexto:{url,sha256,coletadoEm:'2026-11-17T10:00:00Z'}});
function resultado(){const propria={id:'p1',sujeito:'O titular',acao:'emite',objeto:'boleto',citacoes:[fonte('a')]},vizinha={id:'p2',sujeito:'O cliente',acao:'paga',objeto:'com QR code',citacoes:[fonte('b',B)]};return{versao:3,dominio:D,ofertas:[{nome:'Boleto',fonteNome:'a',citacoes:[fonte('a')],jornada:{proposicoes:[propria,vizinha],executores:[{grupo:'Titular',proposicoes:['p1']},{grupo:'Cliente',proposicoes:['p2']}],transacoesDoCliente:[{proposicoes:['p2']}],condicoes:[{categoria:'prazo',citacoes:[fonte('b',B)]}]}}]};}
test('interpretação de outra página e projeções dependentes ficam pendentes; original e citações são preservados',()=>{
 const r=resultado(),antes=structuredClone(r),t=revisarEscopoProposicoes(r),j=t.resultadoTriado.ofertas[0].jornada;assert.deepEqual(r,antes);assert.deepEqual(j.proposicoes.map(p=>p.id),['p1']);assert.deepEqual(j.executores.map(p=>p.grupo),['Titular']);assert.equal(j.transacoesDoCliente.length,0);assert.equal(j.condicoes.length,0);assert.equal(t.pendencias.length,4);assert.equal(t.pendencias.find(p=>p.campo==='proposicoes').interpretacao.citacoes[0].contexto.url,B);assert.equal(t.resultadoOriginalPreservado,true);
});
test('nome na mesma página não torna a relação aprovada e condição dentro do recorte continua literal',()=>{
 const r=resultado();r.ofertas[0].jornada.condicoes=[{categoria:'prazo',aplicaA:'emissão',citacoes:[fonte('c')]}];const t=revisarEscopoProposicoes(r);assert.equal(t.resultadoTriado.ofertas[0].jornada.condicoes.length,1);assert.equal(t.resultadoTriado.perfilConfirmado,false);assert.equal(t.resultadoTriado.revisaoSemantica,'pendente');assert.ok(t.limites.some(l=>l.includes('Mesma página e hash não demonstram mesma oferta')));
});
test('outra captura da mesma URL não empresta o hash da âncora',()=>{
 const r=resultado();r.ofertas[0].jornada.proposicoes[0].citacoes=[fonte('d',A,'b'.repeat(64))];const t=revisarEscopoProposicoes(r);assert.equal(t.resultadoTriado.ofertas[0].jornada.proposicoes.length,0);assert.ok(t.pendencias.some(p=>p.interpretacao.id==='p1'));
});
test('âncora sem localização ou com várias páginas deixa pendência em vez de escolher uma por ordem',()=>{
 for(const change of [o=>{o.fonteNome='ausente';},o=>{delete o.fonteNome;o.citacoes.push(fonte('b',B));}]){const r=resultado();change(r.ofertas[0]);const t=revisarEscopoProposicoes(r);assert.equal(t.ofertas[0].ancora,null);assert.equal(t.resultadoTriado.ofertas[0].jornada.proposicoes.length,0);assert.ok(t.pendencias.every(p=>p.motivo==='pagina_da_ancora_nao_determinada'));}
});
test('suporte documental único de projeção não substitui referências ausentes ou externas',()=>{
 const r=resultado();r.ofertas[0].jornada.executores.push({grupo:'Externo',proposicoes:['p1'],citacoes:[fonte('b',B)]},{grupo:'Sem apoio'});const t=revisarEscopoProposicoes(r);assert.deepEqual(t.resultadoTriado.ofertas[0].jornada.executores.map(x=>x.grupo),['Titular']);
});
test('a política não afirma separar produtos que compartilham a mesma página',()=>{
 const r=resultado();r.ofertas[0].jornada.proposicoes[1].citacoes=[fonte('b')];const t=revisarEscopoProposicoes(r);assert.equal(t.resultadoTriado.ofertas[0].jornada.proposicoes.length,2);assert.equal(t.resultadoTriado.revisaoSemantica,'pendente');assert.ok(t.limites.some(l=>l.includes('mesma oferta')));
});
test('resultado de outro motor ou sem domínio não é reinterpretado silenciosamente',()=>{
 assert.equal(revisarEscopoProposicoes({versao:2,ofertas:[]}).estado,'nao_aplicavel');assert.equal(revisarEscopoProposicoes({versao:3,dominio:'localhost',ofertas:[]}).estado,'dominio_invalido');
});
test('nome e atividade numa política não passam como operação só por ter a mesma página',()=>{
 const r=resultado(),url='https://'+D+'/termos-de-contratacao';r.ofertas[0].citacoes=[fonte('a',url)];r.ofertas[0].jornada.proposicoes=[{id:'p1',sujeito:'O fornecedor',acao:'obedece',objeto:'ao contrato',citacoes:[fonte('a',url)]}];
 const old=structuredClone(r),t=revisarEscopoProposicoes(r);assert.deepEqual(r,old);assert.equal(t.resultadoTriado.ofertas[0].jornada.proposicoes.length,0);assert.ok(t.pendencias.some(p=>p.motivo==='ancora_documental_nao_confirma_oferta'&&p.explicacao.includes('não confirma')));assert.equal(t.ofertas[0].ancoraDocumental,true);
});
test('artigo e condição editorial permanecem pendentes sem apagar o original',()=>{
 const r=resultado();r.ofertas[0].jornada.proposicoes[0].citacoes=[{...fonte('a'),contexto:{...fonte('a').contexto,classePagina:'editorial'}}];r.ofertas[0].jornada.condicoes=[{categoria:'prazo',citacoes:[fonte('blog','https://'+D+'/post/guia')]}];
 const t=revisarEscopoProposicoes(r);assert.equal(t.resultadoTriado.ofertas[0].jornada.condicoes.length,0);assert.ok(t.pendencias.some(p=>p.motivo==='fonte_documental_nao_confirma_operacao'));assert.equal(r.ofertas[0].jornada.condicoes.length,1);
});
