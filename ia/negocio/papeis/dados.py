"""C16: canonical supplied frames and explicit contrastive corruptions.

No target string is added to the source or prompt as a role label. The
canonical relation spans ARE supplied: this is classification, not extraction.
"""
import argparse
from copy import deepcopy
import hashlib,json,re
from pathlib import Path
from negocio.papeis.contrato import validar_saida
from negocio.papeis.protocolo import mensagens

EMPTY={'estrutura':'sem_relacao','tipoAtor':'indefinido','escopo':'indefinido','negada':False}
hash_file=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def frame(s):return {k:deepcopy(s[k]) for k in ['estrutura','ator','acao','objeto','marcadorNominal']}
def inferencia_falsa_literal(e):
    u=next(u for u in e['documento']['unidades'] if u['id']==e['unidade']);t=u['texto'];m=re.search(r'\b(Conecte|Utilize|Acesse|Experimente|Crie|Transforme|Reúna)\b',t,re.I)
    if m:
        a=re.search(r'\b(API|App|plataforma|sistema|ferramenta|checkout)\b',t,re.I);obj=re.split(r'[.!?]',t[m.end():].strip())[0].strip()
        if a and 1<=len(obj)<=180:return {'estrutura':'verbal','ator':a.group(),'acao':m.group(),'objeto':obj,'marcadorNominal':None}
    m=re.search(r'\b(oferecemos|disponibilizamos)\s+((?:o|a|os|as)\s+[^.!?,;]+)',t,re.I)
    if m and 1<=len(m[2])<=180:return {'estrutura':'verbal','ator':m[2],'acao':m[1],'objeto':m[2],'marcadorNominal':None}
    return None

def construir(origem,saida):
    origem,saida=Path(origem),Path(saida)
    if saida.exists():raise ValueError('Use uma saída nova.')
    rows=[];skips=[];seen={};removed=[]
    for split in ['train','valid']:
        for line in (origem/('tarefas-'+split+'.jsonl')).read_text().splitlines():
            old=json.loads(line)
            if old['entrada']['tarefa']!='relacao':continue
            s=old['alvo'];variants=[]
            if s['estrutura']!='sem_relacao':
                proposed=frame(s);label={'estrutura':'relacao_publicada',**{k:s[k] for k in ['tipoAtor','escopo','negada']}};variants.append(('canonica_fornecida',proposed,label))
                if proposed['ator']!=proposed['objeto']:variants.append(('sujeito_objeto_trocados',{**proposed,'ator':proposed['objeto'],'objeto':proposed['ator']},EMPTY))
            else:
                false=inferencia_falsa_literal(old['entrada'])
                if false:variants.append(('instrucao_atribuida_a_objeto',false,EMPTY))
                else:skips.append({'id':old['id'],'split':split,'motivo':'controle_sem_proposta_literal_para_classificar'})
            for name,proposed,label in variants:
                entry={**deepcopy(old['entrada']),'quadroProposto':proposed};errors=validar_saida(label,entry)
                if errors:raise ValueError((old['id'],name,errors))
                ms=mensagens(entry)+[{'role':'assistant','content':json.dumps(label,ensure_ascii=False,separators=(',',':'))}];key=json.dumps(ms[:-1],ensure_ascii=False,sort_keys=True)
                row={'id':'c16-'+old['id']+'-'+('c' if name=='canonica_fornecida' else 's' if name=='sujeito_objeto_trocados' else 'i'),'split':split,'familia':'c16-'+old['familia'],'entidade':old['entidade'],'origem':'Quadro literal fornecido e corrupção contrastiva controlada, derivados do corpus C15 conhecido. Não mede extração.','referenciaC15':old['id'],'variante':name,'relacaoFornecida':True,'ofertaFornecida':True,'fimAFim':False,'reservaNova':False,'entrada':entry,'alvo':deepcopy(label),'messages':ms}
                if key in seen:
                    previous=seen[key]
                    if previous['split']!=split or previous['alvo']!=label:raise ValueError('Prompt duplicado com alvo/split divergente.')
                    removed.append({'id':row['id'],'mantido':previous['id']});continue
                seen[key]=row;rows.append(row)
    for key in ['familia','entidade']:
        if {r[key] for r in rows if r['split']=='train'}&{r[key] for r in rows if r['split']=='valid'}:raise ValueError('Divisão contaminada: '+key)
    root=Path(__file__).resolve().parents[3];files=[Path(__file__),Path(__file__).with_name('contrato.py'),Path(__file__).with_name('protocolo.py')]
    manifest={'versao':1,'natureza':'controlado_e_dev_publico_papeis','empresasReservadasUsadas':False,'revisaoHumanaIndependente':False,'relacaoCorretaFornecidaNosPositivos':True,'extracaoDeRelacoesAvaliada':False,'dominiosTEST1eTEST2Incluidos':False,'fonteManifestoC15Sha256':hash_file(origem/'manifesto.json'),'arquivosFonteSha256':{s:hash_file(origem/('tarefas-'+s+'.jsonl')) for s in ['train','valid']},'codigoGeracaoSha256':{str(p.relative_to(root)):hash_file(p) for p in files},'contagens':{},'arquivosSha256':{},'descartes':skips,'duplicatasExatasRemovidas':removed,'classes':{}}
    saida.mkdir(parents=True,mode=0o700)
    for split in ['train','valid']:
        rs=[x for x in rows if x['split']==split];manifest['contagens'][split]=len(rs);manifest['classes'][split]={'positivos':sum(x['alvo']['estrutura']!='sem_relacao' for x in rs),'negativos':sum(x['alvo']['estrutura']=='sem_relacao' for x in rs),'unidadesTextuaisUnicas':len({next(u['texto'] for u in x['entrada']['documento']['unidades'] if u['id']==x['entrada']['unidade']) for x in rs})}
        for name,vals in [('tarefas-'+split+'.jsonl',rs),(split+'.jsonl',[{'messages':x['messages']} for x in rs])]:
            raw=''.join(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n' for x in vals);(saida/name).write_text(raw);manifest['arquivosSha256'][name]=hashlib.sha256(raw.encode()).hexdigest()
    (saida/'manifesto.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--origem',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);args=p.parse_args();print(json.dumps(construir(args.origem,args.saida)['classes']))
