import {ErroConsulta} from '../consulta.mjs';

export class ErroProjeto extends ErroConsulta {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function criarRepositorio(db) {
  if (!db?.prepare) throw new ErroProjeto('O projeto modular precisa do banco local. Inicie com npm start.', 503);
  return {
    async ler(dominio) {
      const linha = await db.prepare('SELECT payload FROM projetos_modulares WHERE dominio = ?').bind(dominio).first();
      if (!linha) return null;
      const projeto = JSON.parse(linha.payload);
      if (projeto.versao !== 1 || projeto.dominio !== dominio) throw new Error('Projeto incompatível');
      return projeto;
    },
    async salvar(projeto, revisaoAnterior) {
      const payload = JSON.stringify(projeto);
      if (new TextEncoder().encode(payload).length > 4 * 1024 * 1024) {
        throw new ErroProjeto('O relatório ultrapassou o limite local de armazenamento desta análise.', 413);
      }
      const parametros = [projeto.revisao, projeto.geradoEm, payload, projeto.dominio];
      const resultado = revisaoAnterior === 0
        ? await db.prepare('INSERT INTO projetos_modulares (revisao, atualizado_em, payload, dominio) VALUES (?, ?, ?, ?) ON CONFLICT(dominio) DO NOTHING').bind(...parametros).run()
        : await db.prepare('UPDATE projetos_modulares SET revisao = ?, atualizado_em = ?, payload = ? WHERE dominio = ? AND revisao = ?').bind(...parametros, revisaoAnterior).run();
      if (resultado.meta?.changes !== 1) throw new ErroProjeto('O projeto foi alterado em outra janela. Abra a análise salva antes de editar novamente.', 409);
    },
    async excluir(dominio, revisao) {
      const resultado = await db.prepare('DELETE FROM projetos_modulares WHERE dominio = ? AND revisao = ?').bind(dominio, revisao).run();
      if (resultado.meta?.changes !== 1) throw new ErroProjeto('O projeto mudou. Abra a análise salva antes de apagar.', 409);
    },
  };
}
