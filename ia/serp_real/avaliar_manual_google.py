"""Avalia escolha pura em transcrições manuais, reproduzidas na data de observação."""
from datetime import datetime
import json
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'serp_real')]
from runtime import RAIZ,salvar_json,sha256
from reais.inferir_web import carregar,entrada_para_modelo,gerar_escolha,sanear_web
from avaliar_frescor import codigo

PASTA=RAIZ/'data/ia/serp-real'
REGISTROS=[
 ('posicao_local','observacao-manual-google-20261115.json','atualizar_coleta',
  'Qual a posição observada e quais sites estavam à frente?'),
 ('recorte_sem_posicao','observacao-manual-google-adore-20261115.json','atualizar_coleta',
  'Depois das páginas examinadas, como saber a posição exata?'),
 ('marca_local','observacao-manual-google-marca-adore-20261115.json','atualizar_coleta',
  'Como acompanhar a posição observada para a marca?'),
]


def entrada(registro,objetivo):
    r=registro['resultado'];pos=r.get('posicao');quando=registro.get('verificada_em')
    # O recorte sem posição tem horário apenas aproximado: não se cria uma
    # captura SerpApi ou uma data exata que a observação não forneceu.
    instante=datetime.fromisoformat((quando or '2026-11-15T13:22:00Z').replace('Z','+00:00'))
    e={'id':'s1','tipo':'serp','termo':r['termo'],'pagina':r.get('url'),
       'posicao':pos,'atual':pos is not None,'observado_em':quando,'estado_fonte':'transcricao_manual',
       'descricao':'Transcrição manual localizada; não é uma captura validada pela API.'}
    if pos is not None:
        e['concorrentes']=[{'pagina':c['url'],'posicao':c['posicao']} for c in r.get('concorrentes_acima',[])]
    original={'site':r['site'],'objetivo':objetivo,'evidencias':[e],
      'dados_negocio':{'volume_busca':None,'taxa_conversao':None,'margem':None}}
    return entrada_para_modelo(sanear_web(original,agora=instante))


def main():
    if len(sys.argv)!=3:raise SystemExit('Uso: avaliar_manual_google.py ADAPTADOR SAIDA')
    adaptador=Path(sys.argv[1]);saida=Path(sys.argv[2])
    if saida.exists() or not saida.resolve().is_relative_to((RAIZ/'data').resolve()):raise ValueError('Use saída nova em data/.')
    modelo,tokenizer=carregar(adaptador);resultados=[]
    for nome,arquivo,esperado,objetivo in REGISTROS:
        p=PASTA/arquivo;registro=json.loads(p.read_text());contexto=entrada(registro,objetivo)
        try:bruto,escolha=gerar_escolha(modelo,tokenizer,contexto);erro=None
        except (RuntimeError,ValueError) as exc:bruto=None;escolha=None;erro=str(exc)
        resultados.append({'caso':nome,'registro_sha256':sha256(p),'esperado_editorial':esperado,
          'saida_bruta':bruto,'escolha':escolha,'concorda':isinstance(escolha,dict) and escolha.get('acao')==esperado
            and escolha.get('evidencias')==['s1'],'erro':erro})
    out={'versao':1,'adaptador_sha256':sha256(adaptador/'adapters.safetensors'),
      'config_sha256':sha256(adaptador/'adapter_config.json'),'script_sha256':sha256(Path(__file__)),
      'codigo_sha256':codigo(),
      'resultados':resultados,
      'limites':['Transcrições manuais e localizadas, não capturas autenticadas da fonte automática.',
        'Reprodução no instante da observação; não são posições atuais agora.',
        'Dois registros foram usados no desenvolvimento; o domínio do terceiro também apareceu antes.',
        'Referências editoriais automáticas e três casos não comprovam qualidade de recomendações.']}
    salvar_json(saida,out,exclusivo=True)
    print(json.dumps([{'caso':r['caso'],'escolha':r['escolha'],'concorda':r['concorda']} for r in resultados],ensure_ascii=False))


if __name__=='__main__':main()
