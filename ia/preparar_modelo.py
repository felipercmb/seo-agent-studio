"""Download explícito de pesos públicos; nenhum cadastro ou serviço pago."""

import os
from runtime import MODELO, REVISAO, PASTA_MODELO, salvar_json, sha256


def main():
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    from huggingface_hub import snapshot_download
    print(f"Baixando {MODELO} na revisão {REVISAO} (~880 MB).", flush=True)
    snapshot_download(repo_id=MODELO, revision=REVISAO, local_dir=PASTA_MODELO,
                      token=False, max_workers=2,
                      allow_patterns=["*.json", "*.safetensors", "*.model", "*.txt", "README.md", "LICENSE*"])
    arquivos = {str(p.relative_to(PASTA_MODELO)): sha256(p)
                for p in sorted(PASTA_MODELO.rglob("*"))
                if p.is_file() and ".cache" not in p.parts and p.name != "proveniencia-local.json"}
    salvar_json(PASTA_MODELO / "proveniencia-local.json", {
        "modelo": MODELO, "revisao": REVISAO, "licenca": "Apache-2.0", "arquivos": arquivos,
    })
    print("Modelo salvo e hashes registrados. Treino e inferência usarão estes arquivos locais.")


if __name__ == "__main__":
    main()
