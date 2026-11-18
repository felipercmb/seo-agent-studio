import {criarPosicoesAtuais} from '../posicoes-atuais.mjs';

export async function identificarPlano(palavras) {
  const dados = palavras.candidatos.map(c => [c.termo, c.tipo, c.origem, c.ofertaId]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(dados)));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

// Esta interface recebe apenas candidatos produzidos no servidor. O navegador
// não pode enviar capturas, posições, volume, credenciais ou prompts.
export async function medirProjeto(projeto, env, opcoes = {}) {
  const planoId = await identificarPlano(projeto.palavras);
  const descobrir = () => ({candidatos: projeto.palavras.candidatos,
    cobertura: projeto.descoberta.cobertura, limites: projeto.palavras.limites});
  const medir = criarPosicoesAtuais({...opcoes, planoId, descobrir,
    coletar: async () => ({dominio: projeto.dominio, paginas: [],
      coletadoEm: projeto.coletadoEm, falhas: []})});
  // Primeira chamada prepara a fila; chamadas seguintes avançam um lote. As
  // cotas e o cache de capturas continuam compartilhados com o portal anterior.
  const resultado = await medir({site: projeto.dominio, continuar: true}, env);
  return {...resultado, planoId};
}
