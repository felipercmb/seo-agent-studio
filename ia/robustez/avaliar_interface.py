"""Avalia o caminho da interface; o teste reservado exige selecao previa assinada por hashes."""
import argparse
from collections import Counter
from datetime import datetime
import json
from pathlib import Path
import sys
import time

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'v3'),str(IA/'v2')]
from runtime import RAIZ,sha256,salvar_json
from contrato_v3 import apresentar,validar_escolha
from reais.inferir_web import (sanear,preservar_estado_fonte,carregar,gerar_escolha,regra_publicacao,
    regra_sem_evidencias,bloqueios_web,barreiras_web,orientar_web,diretiva_verificada)

PROTOCOLO=Path(__file__).with_name('protocolo-interface.json')

def codigo():
    arquivos=[Path(__file__),PROTOCOLO,IA/'reais/inferir_web.py',IA/'v3/inferir_v3.py',
       IA/'v3/contrato_v3.py',IA/'v3/decodificar_v3.py',IA/'v2/inferir_v2.py',IA/'v2/contrato_v2.py',IA/'v2/decodificar.py']
    return {str(p.relative_to(IA)):sha256(p) for p in arquivos}

def critica(escolha,entrada):
    if not isinstance(escolha,dict) or validar_escolha(escolha,entrada):return True
    acao=escolha['acao'];refs=set(escolha['evidencias'])
    citadas=[e for e in entrada['evidencias'] if e.get('id') in refs]
    if acao in ('corrigir_indexacao','preservar_exclusao'):return True
    serps=[e for e in citadas if e.get('tipo')=='serp' and e.get('atual') is True and
           type(e.get('posicao')) is int and 1<=e['posicao']<=100]
    if acao=='acompanhar' and not serps:return True
    if acao=='comparar_concorrentes' and not any(
       isinstance(e.get('concorrentes'),list) and any(isinstance(c,dict) and type(c.get('posicao')) is int and
         0<c['posicao']<e['posicao'] for c in e['concorrentes']) for e in serps):return True
    if acao=='confirmar_publicacao' and not any(diretiva_verificada(e) for e in citadas):return True
    return False

def processar(caso,modelo=None,tokenizer=None,gerador=gerar_escolha):
    instante=datetime.fromisoformat(caso['fonte']['reproducao_em'].replace('Z','+00:00'))
    entrada=preservar_estado_fonte(caso['entrada'],sanear(caso['entrada'],agora=instante),agora=instante)
    escolha=regra_publicacao(entrada) or regra_sem_evidencias(entrada)
    origem='regra' if escolha is not None else 'ia';erro=None
    if escolha is None:
        try:_,escolha=gerador(modelo,tokenizer,entrada)
        except (ValueError,RuntimeError) as exc:escolha=None;erro=str(exc)
    critica_bruta=critica(escolha,entrada)
    resultado=apresentar(escolha,entrada)
    if resultado['estado']!='recusada':
        motivos=bloqueios_web(escolha,entrada) or barreiras_web(escolha,entrada)
        if motivos:resultado.update(estado='recusada',motivos_aplicabilidade=motivos)
    orientar_web(resultado,entrada)
    aceita=resultado['estado']!='recusada'
    esperado=caso['esperado']
    igual=isinstance(escolha,dict) and escolha.get('acao')==esperado['acao'] and set(escolha.get('evidencias',[]))==set(esperado['evidencias'])
    return {'id':caso['id'],'dominio':caso['grupo'],'tipo':caso['tipo'],'origem':origem,
        'esperado_editorial':esperado,'escolha':escolha,'aceita':aceita,'corresponde_e_aceita':igual and aceita,
        'critica_antes_barreiras':critica_bruta,'critica_exibida':critica_bruta and aceita,
        'erro':erro,'motivos':resultado.get('motivos_aplicabilidade',resultado.get('erros',[]))}

def agregar(resultados):
    def soma(rs):
        return {'total':len(rs),'concordancias_aceitas':sum(x['corresponde_e_aceita'] for x in rs),
          'recusas':sum(not x['aceita'] for x in rs),'criticas_antes_barreiras':sum(x['critica_antes_barreiras'] for x in rs),
          'criticas_exibidas':sum(x['critica_exibida'] for x in rs),
          'regras':sum(x['origem']=='regra' for x in rs)}
    por_tipo={t:soma([x for x in resultados if x['tipo']==t]) for t in sorted({x['tipo'] for x in resultados})}
    por_dominio={d:soma([x for x in resultados if x['dominio']==d]) for d in sorted({x['dominio'] for x in resultados})}
    return {'total':soma(resultados),'por_tipo':por_tipo,'por_dominio':por_dominio,
       'dominios':len(por_dominio),'dominios_todos_concordantes':sum(x['total']==x['concordancias_aceitas'] for x in por_dominio.values())}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dados',type=Path,required=True);p.add_argument('--adaptador',type=Path,required=True)
    p.add_argument('--split',choices=['valid','test'],required=True);p.add_argument('--selecao',type=Path)
    p.add_argument('--saida',type=Path,required=True);args=p.parse_args()
    if args.saida.exists() or not args.saida.resolve().is_relative_to((RAIZ/'data').resolve()):p.error('A saída deve ser nova e ficar em data/.')
    pasta=args.dados.resolve();manifesto=json.loads((pasta/'manifest.json').read_text());arquivo=pasta/f'casos-{args.split}.jsonl'
    if sha256(arquivo)!=manifesto['arquivos'][arquivo.name]['sha256']:raise ValueError('Casos alterados.')
    chave=(sha256(args.adaptador/'adapters.safetensors'),sha256(args.adaptador/'adapter_config.json'))
    if args.split=='test':
        if not args.selecao:p.error('O teste exige seleção anterior.')
        s=json.loads(args.selecao.read_text())
        if s['manifesto_sha256']!=sha256(pasta/'manifest.json') or s['codigo_sha256']!=codigo():raise ValueError('Seleção não corresponde aos dados e ao código.')
        if chave not in {(s[n]['adaptador_sha256'],s[n]['config_adaptador_sha256']) for n in ('base','candidato')}:
            raise ValueError('Teste restrito ao anterior e ao escolhido na validação.')
    casos=[json.loads(l) for l in arquivo.read_text().splitlines()]
    modelo,tokenizer=carregar(args.adaptador);resultados=[];inicio=time.monotonic()
    for i,c in enumerate(casos):
        resultados.append(processar(c,modelo,tokenizer))
        print(f'{args.split}: {i+1}/{len(casos)}',flush=True)
    saida={'versao':1,'split':args.split,'adaptador':str(args.adaptador.resolve()),'adaptador_sha256':chave[0],
      'config_adaptador_sha256':chave[1],'manifesto_sha256':sha256(pasta/'manifest.json'),
      'casos_sha256':sha256(arquivo),'codigo_sha256':codigo(),'duracao_segundos':time.monotonic()-inicio,
      'metricas':agregar(resultados),'resultados':resultados,
      'limites':['Rótulos editoriais fracos, sem especialista independente.',
        'Reprodução da interface no instante da captura; não mede posições atuais nem retorno de negócios.',
        'Casos da mesma empresa são relacionados; decisões de regras são contadas separadamente.']}
    salvar_json(args.saida,saida,exclusivo=True)
    print(json.dumps(saida['metricas']['total'],ensure_ascii=False))

if __name__=='__main__':main()
