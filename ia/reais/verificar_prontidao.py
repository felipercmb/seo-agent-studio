"""Aplica o protocolo congelado a resultados reais; nunca aprova uso autônomo."""

import argparse
import json
import math
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
PASTA=Path(__file__).resolve().parent
sys.path.insert(0,str(IA))
from runtime import RAIZ,salvar_json,sha256


def avaliar(tipo,resultado,manifesto,protocolo):
    regra=protocolo[tipo];m=resultado['metricas'];motivos=[]
    dominios=manifesto['dominios_com_casos']['test'] if tipo=='acoes' else manifesto['dominios']['test']
    if dominios < regra['dominios_teste_minimos']:
        motivos.append('Quantidade insuficiente de domínios de teste.')
    if tipo=='acoes':
        total=m['acao_e_referencias']['total'];certos=m['acao_e_referencias']['quantidade']
        if total==0 or certos < math.ceil(total*regra['fracao_minima_acao_e_referencias']):
            motivos.append('Ação e referências abaixo do limiar em casos técnicos reais.')
        if m['escolha_critica']['quantidade']>regra['escolhas_criticas_maximas']:
            motivos.append('Houve escolha crítica predefinida.')
        if m['esperada_mas_bloqueada']['quantidade']:
            motivos.append('A barreira bloqueou uma escolha considerada correta pelo rótulo técnico.')
        for nome in regra['tipos_que_exigem_um_acerto_conjunto']:
            if resultado['por_tipo'].get(nome,{}).get('total',0)<1:
                motivos.append('Sem casos de teste para o tipo '+nome+'; não é possível avaliá-lo nesta amostra.')
            elif resultado['por_tipo'][nome].get('ambos',0)<1:
                motivos.append('Nenhum acerto conjunto no tipo '+nome+'.')
    else:
        total=m['total_pares'];certos=m['pares_corretos']
        if total==0 or certos<math.ceil(total*regra['fracao_minima_pares_corretos']):
            motivos.append('Consistência e acerto por par abaixo do limiar.')
        if m['falsas_priorizacoes']>regra['falsas_priorizacoes_maximas']:
            motivos.append('Houve priorização quando os dados eram insuficientes.')
        positivo=resultado['por_tipo'].get('um_achado_verificado',{})
        if not positivo.get('total') or positivo.get('acertos',0)<math.ceil(positivo['total']*regra['fracao_minima_acertos_com_achado']):
            motivos.append('Poucos acertos nos casos com achado observável.')
    return {'estado':'atingiu_limites_do_experimento' if not motivos else 'nao_atingiu_limites_do_experimento',
            'motivos':motivos,'dominios_teste':dominios,'aprovado_para_uso_autonomo':False,
            'aviso':'Os limiares usam rótulos técnicos fracos. Mesmo atingidos, não demonstram eficácia, segurança ou retorno em clientes reais.'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--tipo',choices=['acoes','comparacao'],required=True);p.add_argument('--dados',type=Path,required=True)
    p.add_argument('--selecao',type=Path,required=True);p.add_argument('--teste',type=Path,required=True)
    p.add_argument('--saida',type=Path,required=True);a=p.parse_args()
    if not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Resultado real deve ficar em data/.')
    protocolo_path=PASTA/'protocolo.json';protocolo=json.loads(protocolo_path.read_text(encoding='utf-8'))
    selecao=json.loads(a.selecao.read_text(encoding='utf-8'));teste=json.loads(a.teste.read_text(encoding='utf-8'))
    manifesto=json.loads((a.dados/'manifest.json').read_text(encoding='utf-8'))
    if (selecao['tipo']!=a.tipo or selecao['protocolo_sha256']!=sha256(protocolo_path)
            or selecao['manifesto_sha256']!=sha256(a.dados/'manifest.json') or teste['split']!='test'
            or teste['manifesto_sha256']!=selecao['manifesto_sha256']
            or teste['adaptador_sha256']!=selecao['candidato']['adaptador_sha256']
            or teste['codigo_sha256']!=selecao['codigo_sha256']):
        raise ValueError('Seleção, protocolo ou resultado incompatível.')
    resultado=avaliar(a.tipo,teste,manifesto,protocolo)
    resultado.update(tipo=a.tipo,protocolo_sha256=sha256(protocolo_path),teste_sha256=sha256(a.teste),
                     selecao_sha256=sha256(a.selecao),manifesto_sha256=selecao['manifesto_sha256'])
    salvar_json(a.saida,resultado,exclusivo=True)
    print(json.dumps(resultado,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
