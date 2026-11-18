"""Testa o tratamento de uma observação histórica transcrita, sem a promover a SERP atual."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

IA = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(IA))
from runtime import RAIZ, salvar_json, sha256
from reais.inferir_web import (carregar, entrada_para_modelo, finalizar_web, gerar_escolha,
                                regra_posicao_indisponivel, sanear_web)


def entrada_historica(registro):
    """Uma transcrição não recebe carimbo nem assinatura de uma captura SerpApi."""
    if registro.get('tipo') != 'transcricao_manual_historica' or not isinstance(registro.get('resultado'), dict):
        raise ValueError('Use uma observação manual identificada como histórica.')
    r = registro['resultado']
    if (not isinstance(r.get('site'), str) or not isinstance(r.get('termo'), str)
            or type(r.get('posicao')) is not int or not isinstance(r.get('url'), str)
            or not isinstance(r.get('concorrentes_acima'), list)):
        raise ValueError('Observação histórica incompleta.')
    return {'site': r['site'], 'objetivo': 'Qual é a posição atual e quais concorrentes estão acima?',
            'evidencias': [{'id': 's1', 'tipo': 'serp', 'termo': r['termo'], 'pagina': r['url'],
              'posicao': r['posicao'], 'atual': False, 'observado_em': None,
              'estado_fonte': 'desconhecida',
              'concorrentes': [{'pagina': c['url'], 'posicao': c['posicao']} for c in r['concorrentes_acima']],
              'descricao': 'Transcrição histórica de fonte externa; o momento exato da captura não foi informado.'}],
            'dados_negocio': {'volume_busca': None, 'taxa_conversao': None, 'margem': None}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--registro', type=Path, required=True)
    p.add_argument('--adaptador', type=Path, required=True)
    p.add_argument('--saida', type=Path, required=True)
    a = p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):
        p.error('A saída precisa ser nova e estar em data/.')
    registro = json.loads(a.registro.read_text(encoding='utf-8'))
    original = entrada_historica(registro)
    agora = datetime.now(timezone.utc)
    limpa = sanear_web(original, agora=agora)
    regra = regra_posicao_indisponivel(limpa)
    if not regra:
        raise ValueError('A barreira não reconheceu a falta de posição atual.')
    modelo, tokenizer = carregar(a.adaptador)
    bruto, escolha = gerar_escolha(modelo, tokenizer, entrada_para_modelo(limpa))
    resultado = {'versao': 1, 'tipo': 'transcricao_manual_historica',
      'avaliado_em': agora.isoformat(), 'registro_sha256': sha256(a.registro),
      'script_sha256': sha256(Path(__file__)),
      'adaptador_sha256': sha256(a.adaptador/'adapters.safetensors'),
      'config_adaptador_sha256': sha256(a.adaptador/'adapter_config.json'),
      'entrada_saneada': limpa, 'saida_bruta_ia': bruto,
      'resultado_ia': finalizar_web(escolha, original, 'ia', agora=agora),
      'resultado_regra': finalizar_web(regra, original, 'regra', agora=agora),
      'limites': ['Transcrição manual de uma página de terceiros; não há captura original assinada.',
        'O momento exato dos resultados não foi fornecido; nenhuma posição foi tratada como atual.',
        'Um único caso não é avaliação independente nem mede impacto ou qualidade profissional.']}
    salvar_json(a.saida, resultado, exclusivo=True)
    print(json.dumps({'escolha_ia': escolha, 'escolha_regra': regra,
                      'estado_ia': resultado['resultado_ia']['estado'],
                      'estado_regra': resultado['resultado_regra']['estado']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
