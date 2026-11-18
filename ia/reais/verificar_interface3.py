"""Aplica limiares fixados antes do teste para a terceira seleção experimental."""
import argparse
import json
import math
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(IA))
from runtime import RAIZ,salvar_json,sha256

def avaliar(anterior,candidato,sintetico):
    motivos=[];ma=anterior['metricas'];mc=candidato['metricas'];m=mc['acao_e_referencias']
    if not m['total'] or m['quantidade']<math.ceil(.8*m['total']):motivos.append('Acurácia real total abaixo de 80%.')
    if mc['escolha_critica']['quantidade']:motivos.append('Escolha crítica no teste real.')
    for tipo in ('serp','comercial','demanda','h1'):
        a=anterior['por_tipo'].get(tipo,{});c=candidato['por_tipo'].get(tipo,{})
        if a.get('total')!=c.get('total') or c.get('total',0)<2:motivos.append('Amostra incompatível ou pequena em '+tipo+'.');continue
        if c['ambos']<math.ceil(.8*c['total']):motivos.append('Acurácia abaixo de 80% em '+tipo+'.')
        if c['ambos']+1<a['ambos']:motivos.append('Regressão maior que um acerto em '+tipo+'.')
    for tipo in ('noindex','demanda'):
        c=sintetico['por_tipo'].get(tipo,{})
        if not c.get('total') or c.get('corretos_e_aceitos',0)<math.ceil(.8*c['total']):motivos.append('Contraprovas sintéticas insuficientes em '+tipo+'.')
        if tipo=='noindex' and c.get('criticos',0):motivos.append('Escolhas críticas em noindex sintético.')
    return {'estado':'candidato_experimental_preferido' if not motivos else 'manter_selecao_anterior',
            'motivos':motivos,'aprovado_para_uso_autonomo':False,
            'limite':'Os dados têm rótulos fracos e não avaliam efeito, retorno ou segurança geral; não há noindex real novo.'}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for nome in ('anterior','candidato','sintetico','selecao','saida'):p.add_argument('--'+nome,type=Path,required=True)
    a=p.parse_args()
    if a.saida.exists() or not a.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('Saída deve ser nova e dentro de data/.')
    ler=lambda p:json.loads(p.read_text());ant,novo,sint,sel=map(ler,(a.anterior,a.candidato,a.sintetico,a.selecao))
    if (ant['split']!='test' or novo['split']!='test' or ant['manifesto_sha256']!=novo['manifesto_sha256']
        or ant['codigo_sha256']!=novo['codigo_sha256'] or ant['adaptador_sha256']!=sel['base']['adaptador_sha256']
        or novo['adaptador_sha256']!=sel['candidato']['adaptador_sha256'] or sint['natureza']!='sintetica'
        or sint['selecao_sha256']!=sha256(a.selecao)):
        raise ValueError('Avaliações incompatíveis com a seleção.')
    resultado=avaliar(ant,novo,sint)
    resultado.update(selecao_sha256=sha256(a.selecao),anterior_sha256=sha256(a.anterior),candidato_sha256=sha256(a.candidato),
                     sintetico_sha256=sha256(a.sintetico),criterio_sha256=sha256(RAIZ/'data/ia/reais/criterio-interface-rodada3.json'),
                     verificador_sha256=sha256(Path(__file__)))
    salvar_json(a.saida,resultado,exclusivo=True);print(json.dumps(resultado,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
