"""Revisão humana local e cega ao rótulo editorial; grava anotações em JSONL privado."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys

IA=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(IA),str(IA/'v3'),str(IA/'robustez')]
from runtime import RAIZ,sha256
from contrato_v3 import ACOES,validar_escolha
from reais.inferir_web import sanear,preservar_estado_fonte,bloqueios_web,barreiras_web

def verificar_arquivos(dados,avaliacao):
    m=json.loads((dados/'manifest.json').read_text());r=json.loads(avaliacao.read_text())
    if r.get('split') not in ('valid','test') or r.get('manifesto_sha256')!=sha256(dados/'manifest.json'):
        raise ValueError('A avaliação não corresponde ao manifesto.')
    p=dados/f"casos-{r['split']}.jsonl"
    if sha256(p)!=m['arquivos'][p.name]['sha256'] or r['casos_sha256']!=sha256(p):raise ValueError('Casos alterados.')
    cs=[json.loads(l) for l in p.read_text().splitlines()];por_id={c['id']:c for c in cs}
    if len(por_id)!=len(cs) or len(r['resultados'])!=len(cs) or set(por_id)!={x['id'] for x in r['resultados']}:
        raise ValueError('Casos e resultados divergem.')
    return por_id,r

def arquivos_da_captura(caso):
    raiz=RAIZ/'data/ia'
    manifestos=list((raiz/'reais').glob('coleta*/manifest.json'))+list((raiz/'robustez').glob('coleta*/manifest.json'))
    for m in manifestos:
        if sha256(m)!=caso['fonte']['manifesto_sha256']:continue
        dados=json.loads(m.read_text())
        site=next((s for s in dados['sites'] if s['dominio']==caso['grupo'] and
                   s['sha256_registro']==caso['fonte']['registro_sha256']),None)
        if not site:return []
        pasta=m.parent/site['id'];registro=pasta/'registro.json'
        if sha256(registro)!=site['sha256_registro']:raise ValueError('Registro local de captura alterado.')
        arquivos=[]
        for p in json.loads(registro.read_text())['arquivos']:
            arquivo=pasta/p['arquivo']
            if arquivo.parent!=pasta or sha256(arquivo)!=p['sha256_utf8_local']:raise ValueError('HTML de captura alterado.')
            arquivos.append({'arquivo':str(arquivo),'sha256_utf8_local':p['sha256_utf8_local']})
        return arquivos
    return []

def correcao_valida(caso,escolha):
    instante=datetime.fromisoformat(caso['fonte']['reproducao_em'].replace('Z','+00:00'))
    entrada=preservar_estado_fonte(caso['entrada'],sanear(caso['entrada'],agora=instante),agora=instante)
    return not (validar_escolha(escolha,entrada) or bloqueios_web(escolha,entrada) or barreiras_web(escolha,entrada))

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dados',type=Path,required=True);p.add_argument('--avaliacao',type=Path,required=True)
    p.add_argument('--saida',type=Path,required=True);p.add_argument('--revisor',required=True)
    a=p.parse_args();saida=a.saida.resolve()
    if not saida.is_relative_to((RAIZ/'data').resolve()) or saida.exists():p.error('Use uma saída nova dentro de data/.')
    if not a.revisor.strip() or len(a.revisor)>80:p.error('Informe um identificador curto, sem dados sensíveis.')
    casos,avaliacao=verificar_arquivos(a.dados,a.avaliacao)
    saida.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(saida,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    print('Revisão local. Os rótulos automáticos ficam ocultos; as páginas registram o momento da captura.')
    print('Contextos sem dados são omitidos: o fluxo da interface não os envia ao modelo.')
    print('a = aprovar sugestão ou recusa; c = registrar correção; n = não avaliável; p = parar.')
    with os.fdopen(fd,'w',encoding='utf-8') as f:
      for resultado in avaliacao['resultados']:
        c=casos[resultado['id']]
        if c['tipo']=='sem_dados':continue
        visivel={'dominio':c['grupo'],'objetivo':c['entrada']['objetivo'],'evidencias':c['entrada']['evidencias'],
          'escolha_examinada':resultado['escolha'],'aceita_pelo_sistema':resultado['aceita'],
          'motivos_de_recusa':resultado['motivos'],'origem':resultado['origem'],
          **({'escolha_original_da_ia':resultado.get('escolha_original')} if resultado.get('ajustada_por_regra') else {}),
          'arquivos_locais':arquivos_da_captura(c)}
        print('\n'+json.dumps(visivel,ensure_ascii=False,indent=2))
        escolha=input('Parecer [a/c/n/p]: ').strip().lower()
        while escolha not in ('a','c','n','p'):escolha=input('Use a, c, n ou p: ').strip().lower()
        if escolha=='p':break
        alvo=None
        if escolha=='c':
            print('Ações disponíveis: '+', '.join(ACOES))
            acao=input('Ação corrigida: ').strip();ids=input('IDs das evidências, separados por vírgula (vazio se não houver): ').strip()
            alvo={'acao':acao,'evidencias':[x.strip() for x in ids.split(',') if x.strip()]}
            if not correcao_valida(c,alvo):
                print('A correção não passou pelo contrato ou pelas barreiras; registro marcado como não avaliável.')
                escolha='n';alvo=None
        elif escolha=='a' and resultado['aceita']:
            alvo=resultado['escolha']
        nota=input('Justificativa curta (opcional): ').strip()[:1000]
        registro={'versao':1,'caso_id':c['id'],'dominio':c['grupo'],'split_original':avaliacao['split'],
          'manifesto_sha256':avaliacao['manifesto_sha256'],'avaliacao_sha256':sha256(a.avaliacao),
          'registro_captura_sha256':c['fonte']['registro_sha256'],'adaptador_sha256':avaliacao['adaptador_sha256'],
          'revisor_autodeclarado':a.revisor.strip(),'avaliado_em':datetime.now(timezone.utc).isoformat(),
          'parecer':{'a':'aprovada' if resultado['aceita'] else 'recusa_aprovada','c':'corrigida','n':'nao_avaliavel'}[escolha],
          'alvo_humano':alvo,'justificativa':nota,
          'limite':'Revisão autodeclarada. Não valida causa, posições atuais ou retorno comercial.'}
        f.write(json.dumps(registro,ensure_ascii=False)+'\n');f.flush();os.fsync(f.fileno())
    print('Revisão salva localmente em '+str(saida)+'. Ela não altera o modelo automaticamente.')

if __name__=='__main__':main()
