"""Verifica critério conservador antes de trocar a seleção experimental da interface."""
import argparse
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(IA))
from runtime import RAIZ,salvar_json,sha256

def avaliar(anterior,candidato,sint_anterior,sint_candidato):
    motivos=[];ma=anterior['metricas'];mc=candidato['metricas']
    if mc['acao_e_referencias']['quantidade']<ma['acao_e_referencias']['quantidade']:
        motivos.append('Total de acertos reais menor que a versão anterior.')
    if mc['escolha_critica']['quantidade']:
        motivos.append('Houve escolha crítica predefinida no teste real.')
    for tipo,base in anterior['por_tipo'].items():
        novo=candidato['por_tipo'].get(tipo,{})
        if novo.get('total')!=base['total']:raise ValueError('Conjuntos de tipos diferentes.')
        if base['total']>=2 and novo['ambos']+1<base['ambos']:
            motivos.append('Perdeu mais de um acerto no tipo '+tipo+'.')
    a=sint_anterior['por_tipo']['noindex'];c=sint_candidato['por_tipo']['noindex']
    if not a['total'] or a['total']!=c['total']:raise ValueError('Contraprovas noindex incompatíveis.')
    if c['corretos_e_aceitos']<1 or c['corretos_e_aceitos']<a['corretos_e_aceitos']:
        motivos.append('Contraprovas sintéticas de noindex insuficientes ou inferiores à versão anterior.')
    return {'estado':'candidato_experimental_preferido' if not motivos else 'manter_selecao_anterior',
            'motivos':motivos,'aprovado_para_uso_autonomo':False,
            'limite':'Critério relativo em amostra pequena de rótulos fracos; não mede efeito, vendas ou segurança geral.'}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for nome in ('anterior','candidato','sint-anterior','sint-candidato','selecao','selecao-anterior','saida'):
        p.add_argument('--'+nome,type=Path,required=True)
    a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('A saída deve ser nova e ficar em data/.')
    ler=lambda x:json.loads(x.read_text(encoding='utf-8'))
    antigo,novo,sa,sn,sel=map(ler,(a.anterior,a.candidato,a.sint_anterior,a.sint_candidato,a.selecao))
    if (antigo['split']!='test' or novo['split']!='test' or antigo['manifesto_sha256']!=novo['manifesto_sha256']
        or antigo['codigo_sha256']!=novo['codigo_sha256'] or antigo['adaptador_sha256']!=sel['base']['adaptador_sha256']
        or novo['adaptador_sha256']!=sel['candidato']['adaptador_sha256']
        or sa['natureza']!='sintetica' or sn['natureza']!='sintetica'
        or sa['manifesto_sha256']!=sn['manifesto_sha256'] or sa['selecao_sha256']!=sha256(a.selecao_anterior)
        or sn['selecao_sha256']!=sha256(a.selecao)):
        raise ValueError('As avaliações não correspondem às seleções e conjuntos esperados.')
    resultado=avaliar(antigo,novo,sa,sn)
    resultado.update(selecao_sha256=sha256(a.selecao),anterior_sha256=sha256(a.anterior),candidato_sha256=sha256(a.candidato),
                     sintetico_anterior_sha256=sha256(a.sint_anterior),sintetico_candidato_sha256=sha256(a.sint_candidato),
                     criterio_sha256=sha256(RAIZ/'data/ia/reais/criterio-interface-rodada2.json'),verificador_sha256=sha256(Path(__file__)))
    salvar_json(a.saida,resultado,exclusivo=True);print(json.dumps(resultado,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
