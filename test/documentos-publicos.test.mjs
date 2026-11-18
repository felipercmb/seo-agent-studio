import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {classificarDocumentoPublico as doc,textoPadraoDeConsentimento} from '../src/modulos/documentos-publicos.mjs';
import {extrairFontesNegocio as v5} from '../ia/negocio/fontes-v5.mjs';
import {extrairFontesNegocio as v6} from '../ia/negocio/fontes-v6.mjs';
import {extrairContextoPublico} from '../src/modulos/contexto-publico.mjs';
import {construirPrioridades} from '../src/modulos/prioridades-local.mjs';
const D='documentos-exemplo.com.br',T='2026-11-17T13:00:00Z';
function captura(){const html='<html><head><title>Política de reembolso</title></head><body><h1>Condições do plano</h1><p>O cliente do software Aurora deve informar uma conta para solicitar reembolso em até sete dias, conforme as condições publicadas.</p></body></html>';return{dominio:D,coletadoEm:T,paginas:[{url:'https://'+D+'/politica-de-reembolso',status:200,html,coletadoEm:T,sha256:createHash('sha256').update(html).digest('hex')}]};}
test('caminhos documentais com hífen e prefixos de idioma são reconhecidos',()=>{
 for(const path of ['/politica-de-reembolso','/pt/politica-de-privacidade/','/refund-policy','/termos-de-uso','/termos-de-contratacao','/termos-de-adesao','/termos-comerciais','/privacy-policy','/terms-of-service'])assert.equal(doc({url:'https://example.com'+path}).classe,'politica');
});
test('posts e artigo sobre uma política continuam conteúdo editorial',()=>{
 for(const path of ['/post/guia','/posts','/posts/guia','/blog/politica-de-reembolso','/news/refund-policy','/insights','/cases/cliente'])assert.equal(doc({url:'https://example.com'+path,tituloPagina:'Política de reembolso'}).classe,'editorial');
});
test('texto padronizado de preferências não vira rotina, sem filtrar um serviço de armazenamento',()=>{
 assert.equal(textoPadraoDeConsentimento('O armazenamento ou acesso técnico é necessário para o propósito legítimo de armazenar preferências que não são solicitadas pelo assinante ou usuário.'),true);
 assert.equal(textoPadraoDeConsentimento('O armazenamento ou acesso técnico que é usado exclusivamente para fins estatísticos.'),true);
 assert.equal(textoPadraoDeConsentimento('O armazenamento técnico ou acesso que é usado exclusivamente para fins estatísticos anônimos.'),true);
 for(const t of ['O armazenamento de documentos permite que a empresa organize os seus contratos.','O usuário deve informar preferências para receber os relatórios estatísticos.'])assert.equal(textoPadraoDeConsentimento(t),false);
});
test('menção a política ou serviço com nome parecido não vira documento contratual',()=>{
 for(const [path,title]of [['/consultoria','Como elaborar uma política de privacidade'],['/produtos','Software de reembolso'],['/politica-de-precos-do-produto','Conheça o serviço'],['/solucoes/reembolso-online','Serviço de análise']])assert.equal(doc({url:'https://example.com'+path,tituloPagina:title}).classe,'nao_determinada');
});
test('título inequívoco ajuda sem declarar finalidade ou papel confirmado',()=>{
 const r=doc({url:'https://example.com/documento',tituloPagina:'Política de Reembolso — Aurora'});assert.equal(r.classe,'politica');assert.equal(r.motivo,'titulo_documental_explicito');assert.equal(r.finalidadeOuPapelConfirmado,false);
 assert.equal(doc({url:'inválida',classePagina:'institucional'}).classe,'institucional');
});
test('V6 preserva textos, IDs, hashes e dados originais V5, com derivação separada',()=>{
 const c=captura(),a=v5(c),b=v6(c);assert.equal(a.fontes.length,b.fontes.length);assert.ok(a.fontes.every(f=>f.contexto.classePagina==='nao_determinada'));
 for(const [i,f]of b.fontes.entries()){const before=a.fontes[i];assert.equal(f.texto,before.texto);assert.equal(f.id,before.id);assert.equal(f.contexto.sha256,before.contexto.sha256);assert.equal(f.contexto.url,before.contexto.url);assert.equal(f.contexto.classePagina,'politica');assert.equal(f.classificacaoDocumento.classeAnterior,'nao_determinada');}
 assert.ok(v5(c).fontes.every(f=>f.contexto.classePagina==='nao_determinada'));
});
test('política continua evidência, mas não vira rotina principal mesmo com perfil declarado',()=>{
 const c=captura(),url=c.paginas[0].url,p={dominio:D,perfil:{estado:'confirmado',ofertas:[{id:'aurora',nome:'Aurora',url,jornada:{comprador:'Gestor',executor:'Equipe do cliente',beneficiario:'Equipe',objetivo:'Conferir o uso da ferramenta Aurora'}}]},contextoPublico:extrairContextoPublico(c),palavras:{candidatos:[]},oportunidades:{planoDeAcao:[]}};
 const r=construirPrioridades(p,{agora:()=>Date.parse(T)+1000});assert.ok(!r.tarefasDisponiveis.some(t=>['verificar_rotina_publicada','verificar_condicao_publicada'].includes(t.decisao?.familia)));assert.ok(r.tarefasDisponiveis.some(t=>t.tipo==='confirmar_jornada'));
});
