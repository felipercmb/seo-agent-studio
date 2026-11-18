"""Opt-in use of the shared trainer, confined to this process."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from negocio import ensaios
from negocio.papeis import spec
def main():
    original=ensaios.especificacao
    ensaios.especificacao=lambda name:spec if name=='papeis' else original(name)
    try:ensaios.treinar('papeis')
    finally:ensaios.especificacao=original
if __name__=='__main__':main()
