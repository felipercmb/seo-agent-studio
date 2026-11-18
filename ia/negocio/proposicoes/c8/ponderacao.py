"""Tokens de decisão auditados; nenhuma ponderação por empresa ou vocabulário."""
import hashlib
import json
import re

PESO=8


def preparar_pesos(dados,tokenizer):
    tabela=[]
    for split,rs in dados.items():
        for r in rs:
            ms=r['messages'];alvo=ms[-1]['content'];full=tokenizer.apply_chat_template(ms,tokenize=False);inicio=full.rfind(alvo)
            if inicio<0:raise ValueError('Alvo ausente do template.')
            z=tokenizer(full,return_offsets_mapping=True,add_special_tokens=False);ids=z['input_ids']
            if ids!=tokenizer.apply_chat_template(ms,tokenize=True,return_dict=False):raise ValueError('Tokenização divergente.')
            prefixo=tokenizer.apply_chat_template(ms[:-1],tokenize=True,add_generation_prompt=True,return_dict=False);offset=len(prefixo)
            if ids[:offset]!=prefixo:raise ValueError('Máscara não alinha com resposta.')
            pesos=[1]*len(ids);decisoes=[]
            for m in re.finditer(r'"(u\d{3})":(null|\{)',alvo):
                a=inicio+m.start(2);b=inicio+m.end(2);indices=[i for i,(s,e) in enumerate(z['offset_mapping']) if s<b and e>a]
                if len(indices)!=1 or indices[0]<offset:raise ValueError('Decisão não corresponde a1token de resposta.')
                i=indices[0];pesos[i]=PESO;decisoes.append({'unidade':m[1],'classe':'null' if m[2]=='null' else 'proposicao','indiceToken':i,'spanCaracteres':[a,b],'token':tokenizer.decode([ids[i]]),'peso':PESO})
            if any(p!=1 for p in pesos[:offset]):raise ValueError('Prompt ponderado indevidamente.')
            tabela.append({'id':r['metadados']['tarefaId'],'split':split,'ids':ids,'offset':offset,'pesos':pesos,'decisoes':decisoes,'tokensSha256':hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest()})
    return {'versao':1,'pesoDecisao':PESO,'demaisTokens':1,'simetrico':True,'linhas':tabela}


def indexar(tabela):
    r={}
    for x in tabela['linhas']:
        k=tuple(x['ids'])
        if k in r and (r[k]['offset']!=x['offset'] or r[k]['pesos']!=x['pesos']):raise ValueError('Colisão de pesos para mesma sequência.')
        r[k]=x
    return r


def empacotar(batch,lengths,tabela):
    """Executado no iterador, antes do gradiente: lengths+pesos dos alvos."""
    if len(batch)!=len(lengths):raise ValueError('Batch/lengths diferentes.')
    resultado=[]
    for row,l in zip(batch,lengths):
        offset,n=l
        x=tabela.get(tuple(row[:n]))
        if x is None or x['offset']!=offset or len(x['ids'])!=n:raise ValueError('Sequência truncada ou sem máscara ponderada verificada.')
        w=x['pesos']+[1]*(len(row)-n)
        resultado.append([offset,n,*w[1:]])
    return resultado


def perda_ponderada(model,batch,lengths,*,bloco=128,checkpoint=True):
    import mlx.core as mx
    import mlx.nn as nn
    from mlx.nn.utils import checkpoint as checkpoint_module

    if tuple(lengths.shape) != (batch.shape[0], batch.shape[1] + 1):
        raise ValueError('Máscara estendida incompatível.')
    lm = model.language_model
    head = lm.model.embed_tokens if lm.args.tie_word_embeddings else lm.lm_head
    inputs, targets = batch[:, :-1], batch[:, 1:]
    hidden = lm.model(inputs)

    # targets come from token indices 1 through T-1 of the original sequence.
    # lengths[:, 1] is the number of real tokens, so index n is padding.
    steps = mx.arange(1, targets.shape[1] + 1)
    mask = mx.logical_and(steps >= lengths[:, 0:1], steps < lengths[:, 1:2])
    ntoks = mask.sum()
    pesos = mx.stop_gradient(lengths[:, 2:].astype(mx.float32))
    ativos = mask.astype(mx.float32) * pesos
    denominador = ativos.sum()

    def ce(h, target, ativo):
        target = mx.stop_gradient(target)
        ativo = mx.stop_gradient(ativo)
        logits = head.as_linear(h) if lm.args.tie_word_embeddings else head(h)
        return (nn.losses.cross_entropy(logits, target) * ativo).astype(mx.float32).sum()

    calcular = checkpoint_module(head, ce) if checkpoint else ce
    total = mx.array(0., dtype=mx.float32)
    for inicio in range(0, targets.shape[1], bloco):
        fim = min(inicio + bloco, targets.shape[1])
        total += calcular(hidden[:, inicio:fim], targets[:, inicio:fim], ativos[:, inicio:fim])
    return total / denominador, ntoks
