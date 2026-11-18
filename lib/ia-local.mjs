import {spawn} from 'node:child_process';
import {access,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const python = fileURLToPath(new URL('../.venv-ia/bin/python', import.meta.url));
const script = fileURLToPath(new URL('../ia/reais/inferir_web.py', import.meta.url));
const selecoes = ['../data/ia/selecao-interface.json','../data/ia/reais/selecao-acoes.json','../data/ia/v3-selecao.json']
  .map(p => fileURLToPath(new URL(p, import.meta.url)));
const modelo = fileURLToPath(new URL('../data/ia/modelo/proveniencia-local.json', import.meta.url));
const candidatas = [
  ['../data/ia/modular/selecao-interface-candidata.json','../data/ia/modular/decisao-interface-candidata.json'],
  ['../data/ia/robustez/selecao-interface-candidata.json','../data/ia/robustez/decisao-interface-candidata.json'],
  ['../data/ia/reais/selecao-rodada4-acoes.json','../data/ia/reais/decisao-interface-rodada4.json'],
].map(par=>par.map(p=>fileURLToPath(new URL(p,import.meta.url))));

export function candidataIntegra(dados,registro) {
  try {
    const d=JSON.parse(registro);
    return ['experimental_disponivel','manter_selecao_anterior'].includes(d.estado) &&
      d.selecao_sha256===createHash('sha256').update(dados).digest('hex');
  } catch { return false; }
}

// The browser never supplies commands, paths, prompts, model files, or environment.
export function criarExecutorIA({iniciar = spawn, limiteMs = 180_000} = {}) {
  let ocupado = false;
  return {
    async disponivel() {
      try { await Promise.all([python, script, modelo].map(p => access(p))); await Promise.any(selecoes.map(p => access(p))); return true; }
      catch { return false; }
    },
    async candidataDisponivel() {
      for(const [candidata,decisao] of candidatas){
        try {const [dados,registro]=await Promise.all([readFile(candidata),readFile(decisao,'utf8')]);
          if(candidataIntegra(dados,registro))return true;
        } catch { /* Tente a seleção anterior, se existir. */ }
      }
      return false;
    },
    async executar(entrada, {candidata: usarCandidata = false} = {}) {
      if (ocupado) throw new Error('A análise local já está em andamento.');
      const dados = JSON.stringify(entrada);
      if (Buffer.byteLength(dados) > 256 * 1024) throw new Error('Entrada excede o limite local.');
      ocupado = true;
      try {
        return await new Promise((resolver, rejeitar) => {
          const env = {PATH:'/usr/bin:/bin', HF_HUB_OFFLINE:'1', HF_HUB_DISABLE_TELEMETRY:'1', PYTHONUNBUFFERED:'1'};
          if (process.env.HOME) env.HOME = process.env.HOME;
          if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
          const filho = iniciar(python, usarCandidata ? [script,'--candidata'] : [script], {cwd:raiz, env, shell:false, stdio:['pipe','pipe','ignore']});
          const partes = []; let bytes = 0, terminado = false;
          const finalizar = (erro, valor) => {
            if (terminado) return;
            terminado = true; clearTimeout(timer);
            if (erro) rejeitar(erro); else resolver(valor);
          };
          const timer = setTimeout(() => { filho.kill('SIGKILL'); finalizar(new Error('Análise local excedeu o tempo.')); }, limiteMs);
          filho.once('error', () => finalizar(new Error('Não foi possível iniciar a análise local.')));
          filho.stdin.on('error', () => {});
          filho.stdout.on('data', parte => {
            bytes += parte.length;
            if (bytes > 1024 * 1024) { filho.kill('SIGKILL'); finalizar(new Error('Resposta local excedeu o limite.')); }
            else partes.push(parte);
          });
          filho.once('close', codigo => {
            if (codigo !== 0) return finalizar(new Error('Não foi possível concluir a análise local.'));
            try { finalizar(null, JSON.parse(Buffer.concat(partes).toString('utf8'))); }
            catch { finalizar(new Error('Resposta local inválida.')); }
          });
          filho.stdin.end(dados);
        });
      } finally { ocupado = false; }
    },
  };
}
