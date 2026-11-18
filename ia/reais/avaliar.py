"""Compara escolhas da IA com rótulos técnicos fracos de páginas reais."""

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import sys
import time

IA = Path(__file__).resolve().parent.parent
PASTA = Path(__file__).resolve().parent
sys.path.insert(0,str(IA))
sys.path.insert(0,str(IA/'v2'))
sys.path.insert(0,str(IA/'v3'))
from runtime import RAIZ, salvar_json, sha256
from contrato_v3 import validar_escolha
from avaliar_v3 import carregar
from decodificar_v3 import gerar_escolha
from inferir_v3 import bloqueios


def hashes():
    arquivos = [PASTA/'avaliar.py', PASTA/'preparar.py', IA/'v3/contrato_v3.py', IA/'v3/decodificar_v3.py',
                IA/'v3/inferir_v3.py', IA/'v2/inferir_v2.py', IA/'v2/contrato_v2.py', IA/'v2/decodificar.py']
    return {str(p.relative_to(IA)):sha256(p) for p in arquivos}


def pontuar(caso, escolha):
    entrada, alvo = caso['entrada'], caso['esperado']
    erros = validar_escolha(escolha,entrada)
    objeto = escolha if isinstance(escolha,dict) else {}
    acao, refs = objeto.get('acao'), objeto.get('evidencias')
    igual = acao == alvo['acao']
    fontes = refs == alvo['evidencias']
    critico = ((caso['tipo'] == 'noindex' and acao in ('corrigir_indexacao','preservar_exclusao'))
               or (caso['tipo'] == 'serp' and acao in ('acompanhar','comparar_concorrentes')))
    motivos = erros or bloqueios(escolha,entrada)
    return {'acao_esperada':igual,'referencias_exatas':fontes,
            'acao_e_referencias':igual and fontes and not erros,
            'escolha_critica':bool(critico),'aceita_formato_e_barreiras':not motivos,
            'esperada_mas_bloqueada':igual and fontes and bool(motivos)}, motivos


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dados',type=Path,required=True)
    parser.add_argument('--adaptador',type=Path,required=True)
    parser.add_argument('--split',choices=['train','valid','test'],required=True)
    parser.add_argument('--selecao',type=Path)
    parser.add_argument('--saida',type=Path,required=True)
    args=parser.parse_args()
    if args.saida.exists(): parser.error('Não sobrescrevendo avaliação.')
    if not args.saida.resolve().is_relative_to((RAIZ/'data').resolve()):
        parser.error('Resultados reais precisam ficar em data/.')
    pasta=args.dados.resolve()
    manifesto=json.loads((pasta/'manifest.json').read_text(encoding='utf-8'))
    arquivo=pasta/f'casos-{args.split}.jsonl'
    if sha256(arquivo)!=manifesto['arquivos'][arquivo.name]['sha256']:
        raise ValueError('Casos diferem do manifesto.')
    adaptador_sha=sha256(args.adaptador/'adapters.safetensors')
    config_sha=sha256(args.adaptador/'adapter_config.json')
    if args.split=='test':
        if not args.selecao: parser.error('Selecione pela validação antes do teste.')
        sel=json.loads(args.selecao.read_text(encoding='utf-8'))
        if sel['manifesto_sha256']!=sha256(pasta/'manifest.json') or sel['codigo_sha256']!=hashes():
            raise ValueError('Seleção não corresponde aos dados ou avaliador.')
        permitidos={(sel['candidato']['adaptador_sha256'],sel['candidato']['config_adaptador_sha256']),
                    (sel['base']['adaptador_sha256'],sel['base']['config_adaptador_sha256'])}
        if (adaptador_sha,config_sha) not in permitidos:
            raise ValueError('Teste permite somente o candidato selecionado ou o agente anterior.')
    casos=[json.loads(l) for l in arquivo.read_text(encoding='utf-8').splitlines()]
    modelo,tokenizer=carregar(args.adaptador)
    inicio=time.monotonic(); resultados=[]
    for i,caso in enumerate(casos):
        try:
            bruto,escolha=gerar_escolha(modelo,tokenizer,caso['entrada'])
            falha=None
        except (ValueError,RuntimeError) as erro:
            bruto,escolha,falha='',None,str(erro)
        criterios,motivos=pontuar(caso,escolha)
        resultados.append({'id':caso['id'],'dominio':caso['grupo'],'tipo':caso['tipo'],
                           'esperado':caso['esperado'],'escolha':escolha,'bruto':bruto,'falha':falha,
                           'criterios':criterios,'motivos_bloqueio':motivos})
        print(f'{args.split}: {i+1}/{len(casos)}',flush=True)
    metricas={k:{'quantidade':sum(r['criterios'][k] for r in resultados),'total':len(resultados)}
              for k in resultados[0]['criterios']}
    por_tipo={}
    for tipo in sorted({r['tipo'] for r in resultados}):
        grupo=[r for r in resultados if r['tipo']==tipo]
        por_tipo[tipo]={'total':len(grupo),'acao':sum(r['criterios']['acao_esperada'] for r in grupo),
                        'ambos':sum(r['criterios']['acao_e_referencias'] for r in grupo),
                        'criticas':sum(r['criterios']['escolha_critica'] for r in grupo)}
    por_dominio={}
    for dominio in sorted({r['dominio'] for r in resultados}):
        grupo=[r for r in resultados if r['dominio']==dominio]
        por_dominio[dominio]={'total':len(grupo),'acao':sum(r['criterios']['acao_esperada'] for r in grupo),
                              'ambos':sum(r['criterios']['acao_e_referencias'] for r in grupo)}
    salvar_json(args.saida,{'versao':1,'split':args.split,'adaptador_sha256':adaptador_sha,'config_adaptador_sha256':config_sha,
                             'manifesto_sha256':sha256(pasta/'manifest.json'),'casos_sha256':sha256(arquivo),'codigo_sha256':hashes(),
                             'duracao_segundos':time.monotonic()-inicio,'metricas':metricas,'por_tipo':por_tipo,
                             'por_dominio':por_dominio,'resultados':resultados,
                             'limites':['Rótulos técnicos fracos automatizados, não revisão independente de especialista.',
                                        'Páginas reais, mas sem dados reais de Google, tráfego pago ou conversões.',
                                        'A classificação não mede resultados reais de SEO ou de negócios.']},exclusivo=True)
    print('Avaliação local salva em '+str(args.saida))


if __name__=='__main__':
    main()
