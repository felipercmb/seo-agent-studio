"""Ponderação uniforme por campo, sem regras específicas para uma empresa."""
import hashlib
import json
from negocio.proposicoes.c8.ponderacao import indexar,empacotar,perda_ponderada

CATEGORICOS={'estrutura','tipoAtor','escopo','negada','categoria','origemAplicacao','alcance'}

def valores_json(alvo):
    decoder=json.JSONDecoder();pos=1;itens=[];vistos=set()
    if not alvo.startswith('{') or not alvo.endswith('}'):raise ValueError('Objeto JSON canônico necessário.')
    while pos<len(alvo)-1:
        chave,pos=decoder.raw_decode(alvo,pos)
        if not isinstance(chave,str) or chave in vistos or alvo[pos:pos+1]!=':':raise ValueError('Chave inválida/repetida.')
        vistos.add(chave);inicio=pos+1;valor,fim=decoder.raw_decode(alvo,inicio)
        if isinstance(valor,(dict,list)):raise ValueError('Somente campos primitivos são ponderados.')
        itens.append((chave,valor,inicio,fim));pos=fim
        if alvo[pos:pos+1]==',':pos+=1
        elif pos!=len(alvo)-1:raise ValueError('Separador JSON inválido.')
    return itens

def preparar_pesos(dados,tokenizer):
    linhas=[]
    for split,rs in dados.items():
        for r in rs:
            ms=r['messages'];alvo=ms[-1]['content'];full=tokenizer.apply_chat_template(ms,tokenize=False);inicio=full.rfind(alvo)
            if inicio<0:raise ValueError('Alvo ausente do template.')
            z=tokenizer(full,return_offsets_mapping=True,add_special_tokens=False);ids=z['input_ids']
            if ids!=tokenizer.apply_chat_template(ms,tokenize=True,return_dict=False):raise ValueError('Tokenização divergente.')
            prefixo=tokenizer.apply_chat_template(ms[:-1],tokenize=True,add_generation_prompt=True,return_dict=False);offset=len(prefixo)
            if ids[:offset]!=prefixo:raise ValueError('Prefixo tokenizado divergente.')
            pesos=[1]*len(ids);campos=[]
            for chave,valor,comeco,fim in valores_json(alvo):
                a,b=inicio+comeco,inicio+fim;peso=4 if chave in CATEGORICOS else 2
                indices=[i for i,(s,e) in enumerate(z['offset_mapping']) if s<b and e>a]
                if not indices or min(indices)<offset:raise ValueError('Campo sem token ou dentro do prompt.')
                for i in indices:pesos[i]=max(pesos[i],peso)
                campos.append({'campo':chave,'spanValor':[a,b],'indicesTokens':indices,'peso':peso,'mesmoPesoParaNullOuTexto':True})
            if any(w!=1 for w in pesos[:offset]):raise ValueError('Prompt recebeu ponderação.')
            linhas.append({'id':r['id'],'split':split,'ids':ids,'offset':offset,'pesos':pesos,'campos':campos,'tokensSha256':hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest()})
    return {'versao':1,'objetivo':'CE campos categóricos4/literais2/estrutura1, normalizada por pesos ativos','parametrosPorEmpresa':False,'alvosAlterados':False,'promptPonderado':False,'linhas':linhas}
