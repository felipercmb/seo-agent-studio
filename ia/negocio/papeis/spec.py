from pathlib import Path
import hashlib
from negocio.papeis.contrato import conferir_entrada,validar_saida,projetar
from negocio.papeis.protocolo import mensagens,esquema
NOME='papeis';ROOT=Path(__file__).resolve().parents[3];PROTOCOLO=Path(__file__).with_name('protocolo.py')
def codigo():
    ps=[*Path(__file__).parent.glob('*.py')]
    ps += [ROOT/p for p in ['ia/negocio/ensaios.py','ia/negocio/ensaios_pesos.py','ia/negocio/ensaios_bootstrap.py','ia/negocio/quadros/contrato.py','ia/negocio/proposicoes/c8/ponderacao.py','ia/negocio/proposicoes/contrato.py','ia/negocio/proposicoes/unidades.py','ia/negocio/proposicoes/c7/dados.py','ia/negocio/protocolo.py','ia/negocio/decodificacao/core_mlx.py','ia/negocio/runtime_negocio.py','ia/negocio/modelos.py']]
    return {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in ps}
