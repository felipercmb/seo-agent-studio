import{test}from'node:test';import assert from'node:assert/strict';
import{materialAuxiliarSemObjetivo}from'../src/modulos/entregaveis-prioridades.mjs';
const oferta=objetivo=>({jornada:{objetivo}});
test('baixar um guia não é a implantação da oferta e tutoriais não são o trabalho de assinatura',()=>{
 assert.equal(materialAuxiliarSemObjetivo({secao:'Guia de implantação',trecho:'Acesse nosso whitepaper gratuito e descubra como implementar a ferramenta.'},oferta('Comparar etapas de implantação e quem executa melhorias.')),true);
 assert.equal(materialAuxiliarSemObjetivo({secao:'Conheça nossa Base de conhecimento',trecho:'Encontre guias e tutoriais sobre assinaturas eletrônicas e integrações.'},oferta('Comparar modalidades de assinatura.')),true);
});
test('objetivo explícito de consultar material conserva a rota e operação concreta permanece elegível',()=>{
 assert.equal(materialAuxiliarSemObjetivo({secao:'Base de conhecimento',trecho:'Encontre guias e tutoriais sobre integração.'},oferta('Encontrar guias de integração para preparar a equipe.')),false);
 assert.equal(materialAuxiliarSemObjetivo({secao:'Operação',trecho:'O operador configura a integração e envia documentos para assinatura.'},oferta('Comparar etapas de implantação.')),false);
});
