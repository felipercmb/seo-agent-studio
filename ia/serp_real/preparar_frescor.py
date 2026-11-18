"""Prepara ajuste sobre fontes sem posição atual e controles inteiramente fictícios."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import random
import sys

IA = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(IA), str(IA/'v3'), str(IA/'serp_real')]
from runtime import RAIZ, sha256
from contrato_v3 import mensagens
from reais.inferir_web import entrada_para_modelo, sanear_web
from avaliar_transcricao import entrada_historica

ANTIGO = RAIZ/'data/ia/robustez/dataset-ciclo5-20261115'
REGISTRO = RAIZ/'data/ia/serp-real/observacao-manual-ahrefs-20261115.json'
DESTINO = RAIZ/'data/ia/serp-real/dataset-frescor-revisado-20261115'
AGORA = datetime(2026, 11, 15, 13, 0, tzinfo=timezone.utc)
OBJETIVOS = {
  'train': ['Qual a posição atual e quais sites estão à frente?',
            'Quem aparece acima na busca e qual é a posição de hoje?',
            'Qual a posição no Google e os concorrentes acima?'],
  'valid': ['Quais concorrentes ocupam posições acima deste site agora?',
            'Como verificar a posição atual e quem aparece à frente?'],
  'test': ['Onde o site aparece atualmente e quem está na frente?',
           'Qual é o ranking atual e quais domínios estão acima?'],
}
OBJETIVOS_ACOMPANHAR = {
  'train': ['Qual o próximo passo para acompanhar a posição encontrada?',
            'Como monitorar a posição desta busca?'],
  'valid': ['Que acompanhamento cabe para a posição observada?'],
  'test': ['Como acompanhar esta colocação no Google?'],
}


def linha(x):
    return (json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(',', ':'))+'\n').encode()


def escrever(path, dados):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(dados)


def casos(split, quantidade=12):
    tipos = ('sem_posicao', 'vencida', 'concorrente_atual', 'acompanhar_atual')
    resultado = []
    for tipo in tipos:
        for i in range(quantidade):
            site = f'{split}-{tipo.replace("_", "-")}-{i:02}.invalid'
            url = f'https://{site}/servico'
            objetivo = (OBJETIVOS_ACOMPANHAR if tipo == 'acompanhar_atual' else OBJETIVOS)[split][i % len(
                (OBJETIVOS_ACOMPANHAR if tipo == 'acompanhar_atual' else OBJETIVOS)[split])]
            serp = {'id':'s1', 'tipo':'serp', 'termo':f'consulta hipotética {split} {i}', 'pagina':url,
              'posicao':None, 'atual':False, 'observado_em':None,
              'estado_fonte':('nao_configurada','cota_esgotada','nao_consultada','desconhecida')[i % 4],
              'descricao':'Não há posição atual confirmada para essa consulta.'}
            esperado = {'acao':'atualizar_coleta', 'evidencias':['s1']}
            if tipo == 'vencida':
                # Fictício: o saneamento retira os números antes da inferência.
                serp.update(atual=True, posicao=12+i, observado_em='2026-11-14T11:00:00Z',
                    estado_fonte='desconhecida', concorrentes=[{'pagina':'https://rival.invalid/', 'posicao':1}])
            elif tipo in ('concorrente_atual','acompanhar_atual'):
                serp.update(atual=True, posicao=12+i if tipo == 'concorrente_atual' else 1,
                    observado_em='2026-11-15T12:45:00Z', estado_fonte='consultavel_ou_parcial',
                    descricao='Posição fictícia na captura comparável.',
                    fontes_serp=[{'id':f'captura_{split}_{tipo}_{i:02}',
                      'sha256':hashlib.sha256(site.encode()).hexdigest(), 'observado_em':'2026-11-15T12:45:00Z'}])
                if tipo == 'concorrente_atual':
                    serp['concorrentes'] = [{'pagina':'https://rival.invalid/', 'posicao':2}]
                    esperado['acao'] = 'comparar_concorrentes'
                else:
                    esperado['acao'] = 'acompanhar'
            entrada = {'site':site, 'objetivo':objetivo, 'evidencias':[serp],
              'dados_negocio':{'volume_busca':None, 'taxa_conversao':None, 'margem':None}}
            resultado.append({'id':f'{split}-{tipo}-{i:02}', 'grupo':site, 'tipo':tipo,
              'entrada':entrada, 'esperado':esperado, 'fonte':{'reproducao_em':'2026-11-15T13:00:00Z'},
              'limite':'Totalmente fictício. Não representa posições ou concorrentes reais.'})
    return resultado


def main():
    if DESTINO.exists():
        raise ValueError('Não sobrescrevendo dados anteriores.')
    anterior = json.loads((ANTIGO/'manifest.json').read_text())
    def ler_antigo(nome):
        p = ANTIGO/nome
        if sha256(p) != anterior['arquivos'][nome]['sha256']:
            raise ValueError('Dados anteriores alterados: '+nome)
        return p.read_bytes()
    historico = json.loads(REGISTRO.read_text())
    original = entrada_historica(historico)
    # O exemplo real só pode ser reproduzido depois de ter sido observado;
    # AGORA acima é exclusivamente o relógio dos cenários fictícios.
    agora_real = datetime.now(timezone.utc)
    limpa = entrada_para_modelo(sanear_web(original, agora=agora_real))
    alvo = {'acao':'atualizar_coleta', 'evidencias':['s1']}
    caso_real = {'id':'transcricao-historica-desenvolvimento', 'grupo':historico['resultado']['site'],
      'tipo':'transcricao_manual_historica', 'entrada':original, 'esperado':alvo,
      'fonte':{'reproducao_em':agora_real.isoformat()},
      'limite':'Observação manual antiga de terceiro; não é captura atual autenticada.'}
    grupos = {split:casos(split) for split in ('train','valid','test')}
    treino = ler_antigo('desenvolvimento/train.jsonl').splitlines(keepends=True)
    for objetivo in OBJETIVOS['train']:
        e = deepcopy(limpa); e['objetivo'] = objetivo
        treino.extend([linha({'messages':mensagens(e, alvo)})]*12)
    for c in grupos['train']:
        e = entrada_para_modelo(sanear_web(c['entrada'], agora=AGORA))
        treino.extend([linha({'messages':mensagens(e, c['esperado'])})]*6)
    random.Random(20261121).shuffle(treino)
    arquivos = {'casos-train.jsonl':ler_antigo('casos-train.jsonl')+linha(caso_real),
      'casos-valid.jsonl':ler_antigo('casos-valid.jsonl'),
      'casos-valid-sintetico.jsonl':ler_antigo('casos-valid-sintetico.jsonl'),
      'desenvolvimento/train.jsonl':b''.join(treino),
      'desenvolvimento/valid.jsonl':ler_antigo('desenvolvimento/valid.jsonl')+b''.join(
        linha({'messages':mensagens(entrada_para_modelo(sanear_web(c['entrada'],agora=AGORA)),c['esperado'])})
        for c in grupos['valid']),
      'frescor-valid.jsonl':b''.join(map(linha, grupos['valid'])),
      'frescor-test.jsonl':b''.join(map(linha, grupos['test']))}
    for nome,dados in arquivos.items(): escrever(DESTINO/nome,dados)
    manifest = {'versao':'frescor-1', 'gerador_sha256':sha256(Path(__file__)),
      'registro_historico_sha256':sha256(REGISTRO), 'manifesto_anterior_sha256':sha256(ANTIGO/'manifest.json'),
      'treino_mensagens':len(treino), 'casos_sinteticos':{s:len(v) for s,v in grupos.items()},
      'arquivos':{k:{'sha256':hashlib.sha256(v).hexdigest(),'bytes':len(v)} for k,v in arquivos.items()},
      'limites':['Uma observação manual histórica foi usada no desenvolvimento, sem se passar por posição atual.',
        'Casos de validação e teste deste experimento são inteiramente fictícios e têm domínios distintos.',
        'Preferências automáticas não equivalem a avaliação por especialista.']}
    escrever(DESTINO/'manifest.json', (json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({k:manifest[k] for k in ('treino_mensagens','casos_sinteticos')},ensure_ascii=False))


if __name__ == '__main__':
    main()
