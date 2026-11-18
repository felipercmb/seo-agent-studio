import{validarSaidaRecomendacao}from'./validar.mjs';

/** No hooks, commands or browser actions: this policy only classifies a proposal. */
export function classificarRecomendacaoExperimental({entrada,saida,modeloSha256=null}={}){
  const validacao=validarSaidaRecomendacao(saida,entrada);
  const estado=!validacao.valido?'bloqueada':saida.estado==='insuficiente'?'abstencao':'revisao_pendente';
  return{versao:1,estado,validacao,saida:validacao.valido?structuredClone(saida):null,
    modeloSha256:typeof modeloSha256==='string'&&/^[a-f0-9]{64}$/.test(modeloSha256)?modeloSha256:null,
    revisaoHumana:false,confirmadoPeloNegocio:false,execucaoAutonoma:false,consentimentoTreino:false,
    proximosPassos:estado==='bloqueada'?['Corrigir o formato ou as referências antes de mostrar a recomendação.']:
      estado==='abstencao'?['Obter somente os dados descritos nas incertezas; não completar condições pelo nome da empresa.']:
      ['Conferir o vínculo entre objeto, condição, escolha e fonte.','Pedir à pessoa responsável que corrija o entendimento antes de considerar qualquer ação.'],
    limites:['Referência literal válida não prova interpretação, adequação ou benefício financeiro.',
      'O módulo não publica, não preenche formulário, não altera campanha nem executa a ação proposta.',
      'A correção de um perfil não treina pesos automaticamente nem concede consentimento para reutilizar dados.']};
}
