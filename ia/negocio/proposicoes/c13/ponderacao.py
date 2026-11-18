"""C13: mesmas mensagens C10, com decisões de categorias e condições auditadas."""
from copy import deepcopy
import hashlib
import json
import re
from negocio.proposicoes.c10.ponderacao import preparar_pesos as preparar_c10
from negocio.proposicoes.c10.ponderacao import indexar, empacotar, perda_ponderada

PESO_CATEGORIA=4
PESO_CONDICAO=8
CATEGORIAS={
    'tipoSujeito':{'fornecedor','usuario','terceiro','ferramenta','indefinido'},
    'escopo':{'fornecimento','implementacao','uso','prestacao_da_oferta','servico_do_cliente','transacao_do_cliente','contratacao_da_oferta','indefinido'},
    'natureza':{'software','servico','produto','programa_social','indefinido'},
    'papel_site':{'disponibiliza','executa','vende','intermedeia','indefinido'},
}
digest=lambda v:hashlib.sha256(json.dumps(v,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def preparar_pesos(dados,tokenizer):
    original=deepcopy(dados)
    table=preparar_c10(dados,tokenizer)
    by_id={(split,r['metadados']['tarefaId']):r for split,records in dados.items() for r in records}
    decoder=json.JSONDecoder()
    for row in table['linhas']:
        record=by_id[(row['split'],row['id'])]
        messages=record['messages'];target=messages[-1]['content']
        full=tokenizer.apply_chat_template(messages,tokenize=False);start=full.rfind(target)
        encoded=tokenizer(full,return_offsets_mapping=True,add_special_tokens=False)
        if encoded['input_ids']!=row['ids']:raise ValueError('Tokenização divergente.')
        audits=[]
        def fork(field,value_start,value_end,key_start,replacement,weight):
            alternate=deepcopy(messages)
            alternate[-1]['content']=target[:value_start]+replacement+target[value_end:]
            altids=tokenizer.apply_chat_template(alternate,tokenize=True,return_dict=False)
            token=next((i for i,(a,b) in enumerate(zip(row['ids'],altids)) if a!=b),None)
            if token is None or token<row['offset'] or altids[:row['offset']]!=row['ids'][:row['offset']]:
                raise ValueError('Fronteira semântica ausente ou no prompt.')
            begin,end=encoded['offset_mapping'][token]
            # BPE may include the comma or quote immediately before this field.
            if not start+max(0,key_start-2)<=begin<start+value_end or end<=start+value_start:
                raise ValueError('Fronteira fora do campo JSON auditado: '+field)
            row['pesos'][token]=max(row['pesos'][token],weight)
            audits.append({'campo':field,'indiceToken':token,'peso':weight,
                'token':tokenizer.decode([row['ids'][token]]),'tokenAlternativo':tokenizer.decode([altids[token]]),
                'spanToken':[begin,end],'spanValor':[start+value_start,start+value_end],
                'prefixoComumTokensSha256':digest(row['ids'][:token]),'contrafactualTokensSha256':digest(altids),
                'contrafactualNuncaUsadoComoAlvo':True})
        for match in re.finditer(r'"(tipoSujeito|escopo|natureza|papel_site)":"([^"]+)"',target):
            field,value=match[1],match[2]
            if value not in CATEGORIAS[field]:raise ValueError('Categoria fora do contrato: '+field)
            alternate='indefinido' if value!='indefinido' else sorted(CATEGORIAS[field]-{'indefinido'})[0]
            fork(field,match.start(2),match.end(2),match.start(),alternate,PESO_CATEGORIA)
        match=re.search(r'"condicoes":(\[)',target)
        if match:
            value,end=decoder.raw_decode(target,match.start(1))
            if not isinstance(value,list):raise ValueError('Condições não são lista.')
            # This probe is not a valid training label and is never used as one.
            alternate=[] if value else [{'unidade':'u000','categoria':'outro','aplicaA':None,'alcance':'indefinido'}]
            fork('presencaCondicoes',match.start(1),end,match.start(),json.dumps(alternate,ensure_ascii=False,separators=(',',':')),PESO_CONDICAO)
        if any(w!=1 for w in row['pesos'][:row['offset']]):raise ValueError('Prompt ponderado indevidamente.')
        row['decisoesSemanticas']=audits
    if dados!=original:raise ValueError('Mensagens ou alvos alterados.')
    table.update(versao=3,pesoCategorias=PESO_CATEGORIA,pesoCondicoes=PESO_CONDICAO,mensagensEAlvosPreservados=True,parametrosPorEmpresa=False,
        hipotese='Mesmos dados C10; ponderar categorias e condições pode melhorar essas decisões, sem aprovar semântica.')
    return table
