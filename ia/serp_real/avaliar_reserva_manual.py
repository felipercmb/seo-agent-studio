"""Testa como o agente trata duas transcrições reservadas sem fonte validada."""
from datetime import datetime
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'serp_real')]
from runtime import RAIZ,salvar_json,sha256
from avaliar_frescor import codigo
from reais.inferir_web import (carregar,entrada_para_modelo,finalizar_web,gerar_escolha,
  regra_posicao_indisponivel,sanear_web)

BASE=RAIZ/'data/ia/serp-real'


def main():
    if len(sys.argv)!=2:raise SystemExit('Uso: avaliar_reserva_manual.py SAIDA')
    saida=Path(sys.argv[1])
    if saida.exists() or not saida.resolve().is_relative_to((RAIZ/'data').resolve()):raise ValueError('Use saída nova em data/.')
    plano=BASE/'plano-teste-manual-agente-20261115.json';selecao=BASE/'seguro-selecao-final-20261115.json'
    arquivo=BASE/'teste-manual-agente-observacoes-20261115.json'
    p=json.loads(plano.read_text());s=json.loads(selecao.read_text());r=json.loads(arquivo.read_text())
    if (r['plano_sha256']!=sha256(plano) or r['selecao_congelada_sha256']!=sha256(selecao)
        or s['codigo_sha256']!=codigo() or
        [(x['site'],x['termo']) for x in r['casos']]!=[(x['site'],x['termo']) for x in p['casos']]):
        raise ValueError('Reserva não corresponde ao plano e à seleção congelados.')
    antes=datetime.fromisoformat(p['criado_em']);congelado=datetime.fromisoformat(s['congelado_em'])
    if not antes<congelado or any(datetime.fromisoformat(x['verificada_em'].replace('Z','+00:00'))<=congelado for x in r['casos']):
        raise ValueError('Datas incompatíveis com a reserva prospectiva.')
    dados=BASE/'dataset-rodada-segura-20261115';m=json.loads((dados/'manifest.json').read_text())
    if sha256(dados/'manifest.json')!=s['manifesto_sha256']:raise ValueError('Dados de desenvolvimento não correspondem à seleção.')
    proibidos={x[k].casefold().strip() for x in r['casos'] for k in ('site','termo')}
    for nome in ('desenvolvimento/train.jsonl','desenvolvimento/valid.jsonl','frescor-valid.jsonl'):
        arq=dados/nome
        if sha256(arq)!=m['arquivos'][nome]['sha256']:raise ValueError('Desenvolvimento alterado.')
        for linha in arq.read_text().splitlines():
            item=json.loads(linha)
            try:contexto=json.loads(item['messages'][1]['content']) if 'messages' in item else item['entrada']
            except (KeyError,IndexError,TypeError,ValueError):raise ValueError('Contexto de desenvolvimento inválido.')
            valores=[contexto.get('site'),*(e.get('termo') for e in contexto.get('evidencias',[]) if isinstance(e,dict))]
            if any(isinstance(v,str) and v.casefold().strip() in proibidos for v in valores):
                raise ValueError('Reserva coincide com domínio ou termo de desenvolvimento.')
    ad=Path(s['selecionado']['adaptador'])
    if sha256(ad/'adapters.safetensors')!=s['selecionado']['adaptador_sha256'] or sha256(ad/'adapter_config.json')!=s['selecionado']['config_sha256']:
        raise ValueError('Adaptador difere da seleção congelada.')
    modelo,tokenizer=carregar(ad);resultados=[]
    for caso in r['casos']:
        instante=datetime.fromisoformat(caso['verificada_em'].replace('Z','+00:00'))
        e={'id':'s1','tipo':'serp','termo':caso['termo'],'pagina':caso['url'],'atual':True,
          'posicao':caso['posicao_na_secao_web'],'observado_em':caso['verificada_em'],
          'estado_fonte':'transcricao_manual','descricao':'Observação manual sem páginas identificadas pela integração.',
          'concorrentes':[{'pagina':x['url'],'posicao':x['posicao_na_secao_web']} for x in caso['resultados_anteriores']]}
        original={'site':caso['site'],'objetivo':'Qual a posição atual e quais concorrentes estão acima?',
          'evidencias':[e],'dados_negocio':{'volume_busca':None,'taxa_conversao':None,'margem':None}}
        limpa=sanear_web(original,agora=instante)
        if limpa['evidencias'][0].get('posicao') is not None or limpa['evidencias'][0].get('atual') is not False:
            raise ValueError('Transcrição não pode virar captura validada.')
        try:bruto,escolha=gerar_escolha(modelo,tokenizer,entrada_para_modelo(limpa));erro=None
        except (RuntimeError,ValueError) as exc:bruto=None;escolha=None;erro=str(exc)
        regra=regra_posicao_indisponivel(limpa)
        if not regra:raise ValueError('A falta de captura não foi reconhecida.')
        saida_ia=finalizar_web(escolha,original,'ia',agora=instante) if escolha else {'estado':'falha'}
        saida_regra=finalizar_web(regra,original,'regra',agora=instante)
        resultados.append({'site':caso['site'],'termo':caso['termo'],'entrada_saneada':limpa,
          'escolha_ia':escolha,'estado_ia':saida_ia['estado'],'saida_bruta':bruto,'erro':erro,
          'escolha_regra':regra,'estado_regra':saida_regra['estado']})
    out={'versao':1,'plano_sha256':sha256(plano),'observacoes_sha256':sha256(arquivo),
      'selecao_sha256':sha256(selecao),'adaptador_sha256':sha256(ad/'adapters.safetensors'),
      'codigo_sha256':codigo(),'script_sha256':sha256(Path(__file__)),'resultados':resultados,
      'limites':['Duas transcrições sem captura identificada; a avaliação mede apenas o tratamento da incerteza.',
        'As empresas participaram do desenvolvimento da descoberta, mas as consultas foram reservadas antes da seleção.',
        'Não demonstra funcionamento da fonte SerpApi, qualidade profissional ou resultado comercial.']}
    salvar_json(saida,out,exclusivo=True)
    print(json.dumps([{'site':x['site'],'ia':x['escolha_ia'],'estado_ia':x['estado_ia'],
      'regra':x['escolha_regra'],'estado_regra':x['estado_regra']} for x in resultados],ensure_ascii=False))


if __name__=='__main__':main()
