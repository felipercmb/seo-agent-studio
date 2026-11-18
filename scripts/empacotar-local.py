"""Build a local ZIP from the current checkout, with locked npm dependencies."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = (
    '.env.example', '.gitignore', '.nvmrc', 'CONTRIBUTING.md', 'LICENSE',
    'README.md', 'README.en.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md',
    'package.json', 'package-lock.json', 'server.mjs',
    'COMECE-AQUI.md', 'Abrir Visibilidade Aberta.command',
)
SOURCE_DIRS = ('docs', 'exemplos', 'extensoes', 'ia', 'lib', 'migrations', 'scripts', 'src', 'test')
SOURCE_TYPES = {'.html', '.json', '.jsonl', '.md', '.mjs', '.py', '.sql', '.txt'}
INTERNAL_DIRS = {'__pycache__', 'node_modules', 'modelos', 'modelos-base'}
LOCAL_FIXTURES = {
    'test/fixtures/google-web-goto-real-20261117.json',
    'test/fixtures/google-web-goto-real-20261117.proveniencia.json',
}
# These repository datasets have deterministic generators and synthetic examples.
FIXTURE_DIRS = {'ia/dados', 'ia/v2/dados', 'ia/v2/dados-b', 'ia/v3/dados', 'ia/comparacao/dados'}
STRESS_FIXTURES = {f'ia/{suite}/casos_estresse.jsonl' for suite in ('v2', 'v3', 'comparacao')}


def source_files():
    for name in ROOT_FILES:
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Arquivo do pacote indisponível: {name}')
        yield path
    for directory in SOURCE_DIRS:
        root = ROOT / directory
        if not root.is_dir() or root.is_symlink():
            raise ValueError(f'Diretório do pacote indisponível: {directory}')
        for path in root.rglob('*'):
            relative = path.relative_to(ROOT)
            name = relative.as_posix()
            if path.is_symlink():
                raise ValueError(f'Arquivo ou diretório simbólico fora do pacote: {name}')
            if not path.is_file() or path.suffix not in SOURCE_TYPES:
                continue
            if any(p.startswith('.') or p in INTERNAL_DIRS for p in relative.parts):
                continue
            if name in LOCAL_FIXTURES:
                continue
            if path.suffix == '.jsonl' and name not in STRESS_FIXTURES and not any(
                name.startswith(folder + '/') for folder in FIXTURE_DIRS
            ):
                continue
            yield path


def install_dependencies(stage, lock):
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not npm:
        raise ValueError('npm é necessário para montar o pacote. O ZIP pronto requer apenas Node.js.')
    subprocess.run(
        [npm, 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
        cwd=stage, check=True,
    )
    modules = stage / 'node_modules'
    (modules / '.package-lock.json').unlink(missing_ok=True)
    expected = {Path(name).name: data for name, data in lock['packages'].items() if name}
    if {p.name for p in modules.iterdir()} != set(expected):
        raise ValueError('Dependências instaladas divergem do arquivo de lock.')
    for name, data in expected.items():
        directory = modules / name
        package = json.loads((directory / 'package.json').read_text(encoding='utf-8'))
        if package['name'] != name or package['version'] != data['version']:
            raise ValueError(f'Dependência fora da versão esperada: {name}')
        if any(path.is_symlink() for path in directory.rglob('*')):
            raise ValueError(f'Dependência contém link simbólico: {name}')


def write_zip(stage, location, prefix, files):
    with ZipFile(location, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(files, key=lambda p: p.relative_to(stage).as_posix()):
            name = path.relative_to(stage).as_posix()
            entry = ZipInfo(f'{prefix}/{name}', date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            mode = 0o100755 if name.endswith('.command') else 0o100644
            entry.external_attr = mode << 16
            archive.writestr(entry, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)


def build(output):
    with TemporaryDirectory(prefix='visibilidade-pacote-') as staging:
        stage = Path(staging)
        for source in source_files():
            destination = stage / source.relative_to(ROOT)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        package = json.loads((stage / 'package.json').read_text(encoding='utf-8'))
        lock = json.loads((stage / 'package-lock.json').read_text(encoding='utf-8'))
        if package['version'] != lock['version']:
            raise ValueError('Versões divergentes em package.json e package-lock.json.')
        install_dependencies(stage, lock)
        files = sorted(p for p in stage.rglob('*') if p.is_file())
        manifest = stage / 'MANIFESTO-PACOTE.json'
        rows = []
        for path in files:
            raw = path.read_bytes()
            rows.append({'arquivo': path.relative_to(stage).as_posix(),
                         'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        manifest.write_text(json.dumps({
            'formato': 1, 'tipo': 'visibilidade-aberta-pacote-local',
            'versaoSoftware': package['version'], 'arquivos': rows,
        }, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        output.parent.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=output.parent, prefix='.visibilidade-') as temporary:
            draft = Path(temporary) / 'pacote.zip'
            write_zip(stage, draft, package['name'] + '-local', [*files, manifest])
            # A hard link publishes the finished ZIP without replacing an existing file.
            os.link(draft, output)
        print(f'{output} · {len(rows)} arquivos verificados no manifesto')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--saida', required=True, type=Path)
    args = parser.parse_args()
    output = args.saida.resolve()
    if output.suffix.lower() != '.zip' or output.exists():
        parser.error('Informe o caminho de um ZIP novo.')
    try:
        build(output)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Falha ao montar o pacote local: {error}\n')
