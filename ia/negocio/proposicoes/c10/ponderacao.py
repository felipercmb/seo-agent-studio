"""C10: peso simétrico no primeiro token divergente de contrafactuais JSON.

Os contrafactuais só localizam a fronteira BPE; nunca substituem exemplos,
fontes, rótulos ou mensagens de treino. Dados e loss C8 são preservados.
"""
from copy import deepcopy
import hashlib
import json
import re
from negocio.proposicoes.c8.ponderacao import indexar,empacotar,perda_ponderada

PESO=8
OBJETO_ESTRUTURAL={'sujeito':'','tipoSujeito':'indefinido','acao':'','objeto':'','escopo':'indefinido'}


def digest(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()


def preparar_pesos(dados,tokenizer):
    tabela=[]
    decoder=json.JSONDecoder()
    for split,rs in dados.items():
        for r in rs:
            ms=r['messages'];alvo=ms[-1]['content'];full=tokenizer.apply_chat_template(ms,tokenize=False);inicio=full.rfind(alvo)
            if inicio<0:raise ValueError('Alvo ausente do template.')
            z=tokenizer(full,return_offsets_mapping=True,add_special_tokens=False);ids=z['input_ids']
            if ids!=tokenizer.apply_chat_template(ms,tokenize=True,return_dict=False):raise ValueError('Tokenização divergente.')
            prefixo=tokenizer.apply_chat_template(ms[:-1],tokenize=True,add_generation_prompt=True,return_dict=False);offset=len(prefixo)
            if ids[:offset]!=prefixo:raise ValueError('Máscara não alinha com resposta.')
            pesos=[1]*len(ids);decisoes=[];vistos=set()
            for m in re.finditer(r'"(u\d{3})":(null|\{)',alvo):
                valor,fim=decoder.raw_decode(alvo,m.start(2))
                if valor is not None and not isinstance(valor,dict):raise ValueError('Decisão não é objeto/null.')
                alternativo=OBJETO_ESTRUTURAL if valor is None else None
                alt=deepcopy(ms);alt[-1]['content']=alvo[:m.start(2)]+json.dumps(alternativo,ensure_ascii=False,separators=(',',':'))+alvo[fim:]
                altids=tokenizer.apply_chat_template(alt,tokenize=True,return_dict=False)
                i=next((k for k,(a,b) in enumerate(zip(ids,altids)) if a!=b),None)
                if i is None or i<offset or i in vistos:raise ValueError('Fork ausente, no prompt ou repetido.')
                if ids[:i]!=altids[:i] or altids[:offset]!=prefixo:raise ValueError('Prefixo comum/prompt contrafactual divergente.')
                s,e=z['offset_mapping'][i];chave=inicio+m.start();valor_inicio=inicio+m.start(2)
                if not chave<=s<=valor_inicio or e<valor_inicio:raise ValueError('Fork fora da fronteira local da unidade.')
                # O alvo original permanece byte a byte igual; só o peso muda.
                pesos[i]=PESO;vistos.add(i)
                a=inicio+m.start(2);b=inicio+m.end(2);old=[k for k,(s,e) in enumerate(z['offset_mapping']) if s<b and e>a]
                if len(old)!=1:raise ValueError('Auditoria do antigo span deve continuar unívoca.')
                decisoes.append({'unidade':m[1],'classe':'null' if valor is None else 'proposicao','indiceToken':i,'indiceTokenIntersecaoValorC8':old[0],'token':tokenizer.decode([ids[i]]),'tokenAlternativo':tokenizer.decode([altids[i]]),'peso':PESO,'prefixoComumTokensSha256':digest(ids[:i]),'contrafactualTokensSha256':digest(altids),'tokensPrefixoComum':i,'promptPreservado':True,'contrafactualNuncaUsadoComoAlvo':True})
            if any(p!=1 for p in pesos[:offset]):raise ValueError('Prompt ponderado indevidamente.')
            tabela.append({'id':r['metadados']['tarefaId'],'split':split,'ids':ids,'offset':offset,'pesos':pesos,'decisoes':decisoes,'tokensSha256':hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest()})
    return {'versao':2,'pesoDecisao':PESO,'demaisTokens':1,'simetrico':True,'fronteira':'primeiro_token_divergente_LCP_contrafactual_positivo_null','contrafactuaisUsadosComoTreino':False,'linhas':tabela}
