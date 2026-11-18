"""Derivação local de template Qwen3.5, sem carregar pesos nem usar GPU."""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import time


PREFIXO = "{%- set enable_thinking = false %}\n"
RECIBO = "proveniencia-local.json"


def sha256(arquivo):
    digest = hashlib.sha256()
    with Path(arquivo).open("rb") as leitor:
        for bloco in iter(lambda: leitor.read(1024 * 1024), b""):
            digest.update(bloco)
    return digest.hexdigest()


def _json(arquivo):
    return json.loads(Path(arquivo).read_text(encoding="utf-8"))


def _salvar(arquivo, valor):
    Path(arquivo).write_text(json.dumps(valor, ensure_ascii=False, indent=2,
                                     allow_nan=False) + "\n", encoding="utf-8")


def _versoes():
    resultado = {}
    for nome in ("transformers", "tokenizers"):
        try:
            resultado[nome] = importlib.metadata.version(nome)
        except importlib.metadata.PackageNotFoundError:
            resultado[nome] = None
    return resultado


def _arquivo_dentro(base, nome):
    if not isinstance(nome, str) or not nome or "\\" in nome:
        raise ValueError("Nome de arquivo inválido no recibo.")
    relativo = Path(nome)
    if relativo.is_absolute() or relativo.as_posix() != nome or any(p in ("", ".", "..") for p in relativo.parts):
        raise ValueError("Arquivo fora da origem no recibo.")
    alvo = base / relativo
    if alvo.is_symlink() or not alvo.is_file() or not alvo.resolve().is_relative_to(base):
        raise ValueError("Arquivo ausente, simbólico ou fora da origem: " + nome)
    return alvo


def verificar_origem(origem):
    """Confere somente os artefatos declarados, sem abrir tensores."""
    origem = Path(origem).resolve()
    if not origem.is_dir() or not (origem / RECIBO).is_file() or (origem / RECIBO).is_symlink():
        raise ValueError("Aguarde o recibo de download completo da origem.")
    recibo_bytes = (origem / RECIBO).read_bytes()
    meta = json.loads(recibo_bytes)
    if meta.get("licenca") != "apache-2.0" or meta.get("modeloBase") != "Qwen/Qwen3.5-9B":
        raise ValueError("Origem não é a conversão Qwen3.5-9B Apache-2.0 esperada.")
    if not isinstance(meta.get("modelo"), str) or not meta["modelo"].strip():
        raise ValueError("Identidade do modelo de origem ausente.")
    if not re.fullmatch(r"[a-f0-9]{40,64}", str(meta.get("revisao", ""))):
        raise ValueError("Revisão de origem ausente ou inválida.")
    arquivos = meta.get("arquivos")
    if not isinstance(arquivos, dict) or not 1 <= len(arquivos) <= 256:
        raise ValueError("Manifesto de arquivos da origem inválido.")
    if not all(isinstance(n, str) for n in arquivos):
        raise ValueError("Nomes de arquivo inválidos no recibo.")
    if not any(n.endswith(".safetensors") for n in arquivos):
        raise ValueError("Recibo sem pesos declarados.")
    if not any(Path(n).name.upper().startswith("LICENSE") for n in arquivos):
        raise ValueError("Recibo sem arquivo de licença declarado.")
    estados = {}
    for nome, esperado in arquivos.items():
        if not isinstance(esperado, str) or not re.fullmatch(r"[a-f0-9]{64}", esperado):
            raise ValueError("Hash inválido no recibo: " + str(nome))
        if nome == RECIBO or ".cache" in Path(nome).parts:
            raise ValueError("O recibo deve declarar artefatos do modelo, sem autorreferência/cache.")
        alvo = _arquivo_dentro(origem, nome)
        atual = sha256(alvo)
        if atual != esperado:
            raise ValueError("Arquivo da origem diverge do recibo: " + nome)
        s = alvo.stat()
        estados[nome] = {"sha256": atual, "bytes": s.st_size,
                         "modo": stat.S_IMODE(s.st_mode), "mtimeNs": s.st_mtime_ns}
    # A tokenizer can load extra templates from disk. Undeclared release files
    # would make the derivative less reproducible. HF cache/locks are ignored.
    for alvo in origem.rglob("*"):
        relativo = alvo.relative_to(origem)
        if ".cache" in relativo.parts:
            continue
        if alvo.is_symlink():
            raise ValueError("Link simbólico não declarado na origem: " + str(relativo))
        if alvo.is_file() and str(relativo) not in arquivos and str(relativo) != RECIBO:
            raise ValueError("Arquivo de origem fora do recibo: " + str(relativo))
    config = _json(origem / "config.json")
    if config.get("model_type") != "qwen3_5":
        raise ValueError("Arquitetura da origem incompatível.")
    return origem, meta, estados, recibo_bytes


def _prefixar_template(template):
    if not isinstance(template, str) or not template.strip():
        raise ValueError("Template de chat vazio ou incompatível.")
    if template.startswith(PREFIXO):
        raise ValueError("A origem já contém o prefixo desta derivação.")
    return PREFIXO + template


def _prefixar_config_template(valor):
    if isinstance(valor, str):
        return _prefixar_template(valor)
    if isinstance(valor, dict) and valor and all(isinstance(v, str) for v in valor.values()):
        return {k: _prefixar_template(v) for k, v in valor.items()}
    if isinstance(valor, list) and valor:
        nomes, resultado = set(), []
        for item in valor:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str) or item["name"] in nomes:
                raise ValueError("Lista de templates nomeados inválida.")
            nomes.add(item["name"])
            resultado.append({**item, "template": _prefixar_template(item.get("template"))})
        return resultado
    raise ValueError("tokenizer_config.chat_template incompatível.")


@contextmanager
def _offline():
    valores = {"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
               "HF_HUB_DISABLE_TELEMETRY": "1", "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1"}
    anteriores = {k: os.environ.get(k) for k in valores}
    os.environ.update(valores)
    try:
        yield
    finally:
        for k, v in anteriores.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _carregar_tokenizer(pasta):
    from transformers import AutoTokenizer
    return AutoTokenizer.from_pretrained(str(pasta), local_files_only=True,
                                         trust_remote_code=False)


def validar_tokenizer_local(origem, derivado, *, tokenizer_factory=None):
    """Checa o prefixo e a máscara em IDs reais; não carrega um modelo."""
    factory = tokenizer_factory or _carregar_tokenizer
    inicio, resultados = time.monotonic(), []
    with _offline():
        original, novo = factory(Path(origem)), factory(Path(derivado))
        alvos = [
            {"estado": "insuficiente", "valor": "indefinido", "fontes": [], "faltam": ["papel"]},
            {"estado": "hipotese", "valor": "servicos", "fontes": ["f01"], "faltam": []},
            {"estado": "hipotese", "valor": [{"texto": "Profissionais", "funcao": "prestador",
              "escopo": "Inscrição e seleção", "fontes": ["f02"]}], "fontes": ["f02"], "faltam": []},
        ]
        for i, alvo in enumerate(alvos, 1):
            ms = [{"role": "system", "content": "Use somente os trechos fornecidos. Responda apenas JSON."},
                  {"role": "user", "content": "Controle simulado local " + str(i) + ": fonte com condição e público."}]
            resposta = json.dumps(alvo, ensure_ascii=False, separators=(",", ":"))
            completa = ms + [{"role": "assistant", "content": resposta}]
            prompt = novo.apply_chat_template(ms, tokenize=False, add_generation_prompt=True)
            prompt_forcado = novo.apply_chat_template(ms, tokenize=False, add_generation_prompt=True,
                                                      enable_thinking=True)
            referencia = original.apply_chat_template(ms, tokenize=False, add_generation_prompt=True,
                                                       enable_thinking=False)
            texto = novo.apply_chat_template(completa, tokenize=False, add_generation_prompt=False)
            anterior = original.apply_chat_template(completa, tokenize=False, add_generation_prompt=False)
            if prompt != referencia or prompt_forcado != referencia or texto != anterior or not texto.startswith(prompt):
                raise ValueError("Template derivado não mantém o protocolo textual sem pensamento.")
            ids_prompt = novo.apply_chat_template(ms, tokenize=True, add_generation_prompt=True,
                                                   return_dict=False)
            ids_completa = novo.apply_chat_template(completa, tokenize=True, add_generation_prompt=False,
                                                     return_dict=False)
            if not ids_prompt or ids_completa[:len(ids_prompt)] != ids_prompt:
                raise ValueError("A máscara derivada não coincide com o prefixo em IDs do tokenizador.")
            conteudo = novo.decode(ids_completa[len(ids_prompt):], skip_special_tokens=False)
            if not conteudo.startswith(resposta):
                raise ValueError("A máscara corta o começo do JSON supervisionado.")
            default_ids = original.apply_chat_template(ms, tokenize=True, add_generation_prompt=True,
                                                        return_dict=False)
            completa_original = original.apply_chat_template(completa, tokenize=True,
                                                              add_generation_prompt=False, return_dict=False)
            restante_default = original.decode(completa_original[len(default_ids):], skip_special_tokens=False)
            resultados.append({"id": "controle-simulado-" + str(i), "origem": "simulado",
                "prefixoTextoCompativel": True, "prefixoTokensCompativel": True,
                "conversaCompletaTextoInalterada": True, "alvoIniciaNoJson": True,
                "tokensPromptDerivado": len(ids_prompt), "tokensPromptDefault": len(default_ids),
                "tokensConversaCompleta": len(ids_completa),
                "inicioAlvoMascaraDefault": restante_default[:40],
                "inicioAlvoMascaraDerivada": conteudo[:40]})
    return {"versao": 1, "aprovada": True, "modo": "CPU_tokenizer_local",
            "tokenizadorReal": tokenizer_factory is None,
            "gpuUsada": False, "pesosCarregados": False, "controles": resultados,
            "duracaoSegundos": time.monotonic() - inicio,
            "limites": ["Controles simulados de protocolo, não avaliação de qualidade do modelo.",
                        "O corpus real ainda precisa conferir comprimento e máscara em todos os exemplos.",
                        "Mensagens supervisionadas não devem conter reasoning_content ou tags de pensamento no conteúdo."]}


def derivar_modelo35(origem, saida, *, copiar_pesos=False, tokenizer_factory=None):
    destino = Path(saida).absolute()
    if os.path.lexists(destino):
        raise ValueError("Use uma pasta de saída nova.")
    origem, meta, estados, recibo_bytes = verificar_origem(origem)
    destino = destino.resolve()
    if destino == origem or destino.is_relative_to(origem) or origem.is_relative_to(destino):
        raise ValueError("Origem e saída devem ser pastas independentes.")
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporario = Path(tempfile.mkdtemp(prefix="." + destino.name + "-", dir=destino.parent))
    armazenamentos, alterados = [], []
    publicou = False
    try:
        for nome, estado in estados.items():
            anterior, novo = origem / nome, temporario / nome
            novo.parent.mkdir(parents=True, exist_ok=True)
            metodo = "copia"
            if nome.endswith(".safetensors") and not copiar_pesos:
                try:
                    os.link(anterior, novo)
                    metodo = "hardlink_sem_escrita"
                except OSError:
                    shutil.copy2(anterior, novo)
                    metodo = "copia_fallback_sem_hardlink"
            else:
                shutil.copy2(anterior, novo)
            armazenamentos.append({"arquivo": nome, "metodo": metodo, "bytes": estado["bytes"]})
        jinja = [n for n in estados if n == "chat_template.jinja" or n.startswith("chat_templates/") and n.endswith(".jinja")]
        for nome in jinja:
            arquivo = temporario / nome
            arquivo.write_text(_prefixar_template(arquivo.read_text(encoding="utf-8")), encoding="utf-8")
            alterados.append(nome)
        if "tokenizer_config.json" not in estados:
            raise ValueError("Origem sem tokenizer_config declarado.")
        config_tokenizer = _json(temporario / "tokenizer_config.json")
        if config_tokenizer.get("chat_template") is not None:
            config_tokenizer["chat_template"] = _prefixar_config_template(config_tokenizer["chat_template"])
            _salvar(temporario / "tokenizer_config.json", config_tokenizer)
            alterados.append("tokenizer_config.json")
        if not alterados:
            raise ValueError("Nenhum template de chat declarado foi encontrado.")
        (temporario / "proveniencia-origem.json").write_bytes(recibo_bytes)
        nota = ("# Derivação local do template\n\nLicença Apache-2.0 herdada da origem; arquivo de licença preservado.\n"
                "Alteração: prefixo Jinja que fixa enable_thinking=false em todos os templates declarados.\n"
                "Pesos e configuração da arquitetura não foram alterados. O arquivo proveniencia-origem.json "
                "é uma cópia exata do recibo original; proveniencia-local.json registra hashes antes/depois.\n"
                "Pesos com hardlink compartilham armazenamento: não grave nesses arquivos do derivado. "
                "Nenhuma permissão ou modo do arquivo original foi alterado.\n")
        (temporario / "DERIVACAO-TEMPLATE.md").write_text(nota, encoding="utf-8")
        validacao = validar_tokenizer_local(origem, temporario, tokenizer_factory=tokenizer_factory)
        _salvar(temporario / "validacao-template-local.json", validacao)
        # Recheck every declared file and the original receipt after writing
        # derivatives. The original permissions and mtimes must also be intact.
        for nome, estado in estados.items():
            arquivo, s = origem / nome, (origem / nome).stat()
            if sha256(arquivo) != estado["sha256"] or stat.S_IMODE(s.st_mode) != estado["modo"] or s.st_mtime_ns != estado["mtimeNs"]:
                raise ValueError("Origem mudou durante a derivação: " + nome)
        recibo_sha = hashlib.sha256(recibo_bytes).hexdigest()
        if sha256(origem / RECIBO) != recibo_sha:
            raise ValueError("Recibo original mudou durante a derivação.")
        arquivos_finais = {str(p.relative_to(temporario)): sha256(p) for p in sorted(temporario.rglob("*")) if p.is_file()}
        for nome in estados:
            if nome not in alterados and arquivos_finais[nome] != estados[nome]["sha256"]:
                raise ValueError("Arquivo sem transformação foi alterado: " + nome)
        recibo = {"versao": 2, "tipo": "derivacao_local_template_sem_pensamento", "estado": "concluido",
            "modelo": meta["modelo"], "revisao": meta["revisao"], "modeloBase": meta["modeloBase"],
            "revisaoBase": meta.get("revisaoBase"), "licenca": "apache-2.0", "derivadoLocal": True,
            "derivadoEm": datetime.now(timezone.utc).isoformat(),
            "origem": {"pasta": str(origem), "recibo": RECIBO, "reciboSha256": recibo_sha,
                       "arquivosReverificados": len(estados), "arquivosModosEMtimesPreservados": True},
            "transformacao": {"prefixo": PREFIXO, "arquivos": [{"arquivo": n, "antes": estados[n]["sha256"],
                            "depois": arquivos_finais[n]} for n in alterados]},
            "armazenamento": armazenamentos, "arquivos": arquivos_finais,
            "codigoDerivadorSha256": sha256(__file__),
            "tokenizerValidado": validacao["aprovada"], "pesosAlterados": False,
            "pesosCarregados": False, "GPUUsada": False, "originaisPreservados": True,
            "dependencias": _versoes(), "validacaoSimulada": tokenizer_factory is not None,
            "limite": "Derivação de protocolo; não demonstra qualidade de entendimento ou uso formal com clientes."}
        _salvar(temporario / RECIBO, recibo)
        # Reserve a new destination without overwriting another directory.
        destino.mkdir(exist_ok=False)
        publicou = True
        for filho in sorted(temporario.iterdir(), key=lambda p: p.name == RECIBO):
            shutil.move(str(filho), str(destino / filho.name))
        temporario.rmdir()
        return recibo
    except BaseException:
        shutil.rmtree(temporario, ignore_errors=True)
        if publicou:
            shutil.rmtree(destino, ignore_errors=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origem", type=Path, required=True)
    parser.add_argument("--saida", type=Path, required=True)
    parser.add_argument("--copiar-pesos", action="store_true", help="Copiar pesos em vez de tentar hardlinks.")
    args = parser.parse_args()
    recibo = derivar_modelo35(args.origem, args.saida, copiar_pesos=args.copiar_pesos)
    print(json.dumps({"estado": recibo["estado"], "saida": str(args.saida.resolve()),
                      "reciboSha256": sha256(args.saida / RECIBO),
                      "transformacoes": recibo["transformacao"]["arquivos"],
                      "tokenizerValidado": recibo["tokenizerValidado"],
                      "originaisPreservados": True, "pesosCarregados": False, "GPUUsada": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
