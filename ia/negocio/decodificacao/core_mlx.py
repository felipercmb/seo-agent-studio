"""Protótipo opcional para outlines_core0.2.14, sem instalar ou carregar modelo.

Nada deste módulo é importado pelo runtime ativo. Os imports de core/MLX são
adiados. Suporta somente geração serial, sem draft/MTP, e tokenizer ByteLevel.
APIs conferidas no tag0.2.14 (8466141a4d882572876d39563c9e6be372d918d3).
"""
from dataclasses import dataclass
from copy import deepcopy
import hashlib
import importlib.metadata as metadata
import json


def _mapa_bytes():
    mapa={};extra=256
    for byte in range(256):
        if 33<=byte<=126 or 161<=byte<=172 or 174<=byte<=255:
            mapa[chr(byte)]=byte
        else:
            mapa[chr(extra)]=byte;extra+=1
    return mapa


def vocabulario_bytes(tokenizer):
    """Não decodifica tokens UTF-8 parciais com replacement characters."""
    hf=tokenizer
    if getattr(hf,"backend_tokenizer",None) is None:
        hf=getattr(tokenizer,"_tokenizer",None)
    if hf is None or getattr(hf,"backend_tokenizer",None) is None:
        raise ValueError("Tokenizador HF rápido/ByteLevel necessário; sem fallback por decode de token isolado.")
    decoder=hf.backend_tokenizer.decoder
    estado=decoder.__getstate__()
    if isinstance(estado,bytes):estado=estado.decode("utf-8")
    estado=json.loads(estado) if isinstance(estado,str) else estado
    if not isinstance(estado,dict) or estado.get("type")!="ByteLevel":
        raise ValueError("Este protótipo só trata decoder ByteLevel; outros exigem adaptador específico.")
    eos=hf.eos_token_id
    if isinstance(eos,bool) or not isinstance(eos,int) or eos<0:
        raise ValueError("EOS primário único e inteiro necessário.")
    especiais=set(getattr(hf,"all_special_ids",[]) or [])
    extras=getattr(tokenizer,"eos_token_ids",[]) or []
    if isinstance(extras,int):extras=[extras]
    especiais.update(extras);especiais.add(eos)
    mapa=_mapa_bytes();vocab={};vistos=set();maximo=eos
    for token,token_id in hf.get_vocab().items():
        if isinstance(token_id,bool) or not isinstance(token_id,int) or token_id<0 or token_id in vistos:
            raise ValueError("Vocabulário com ID inválido/repetido.")
        vistos.add(token_id)
        if token_id in especiais:continue
        if not isinstance(token,str) or not token:
            raise ValueError("Token vazio ou inválido.")
        try:bruto=bytes(mapa[ch] for ch in token)
        except KeyError as erro:
            raise ValueError("Token não ByteLevel ou AddedToken não suportado; não substituir por U+FFFD.") from erro
        vocab.setdefault(bruto,[]).append(token_id);maximo=max(maximo,token_id)
    if not vocab:raise ValueError("Vocabulário útil vazio.")
    h=hashlib.sha256()
    for bruto,ids in sorted(vocab.items(),key=lambda par:min(par[1])):
        for token_id in ids:
            h.update(token_id.to_bytes(8,"little"));h.update(len(bruto).to_bytes(8,"little"));h.update(bruto)
    return eos,vocab,{"eos":eos,"maxTokenId":maximo,"tokensUteis":sum(len(v) for v in vocab.values()),"vocabularioBytesSha256":h.hexdigest()}


@dataclass(frozen=True)
class IndicePreparado:
    indice:object
    eos:int
    max_token_id:int
    auditoria:dict


def esquema_para_compilacao(schema,*,limitar_comprimento_texto=True):
    """Evita expandir comprimentos de strings em milhares de estados do DFA.

    O contrato posterior continua responsável pelos comprimentos. Nenhuma
    resposta longa é cortada ou aceita por causa desta projeção do decoder.
    """
    resultado=deepcopy(schema)
    def visitar(valor):
        if isinstance(valor,dict):
            if not limitar_comprimento_texto and valor.get("type")=="string":
                valor.pop("maxLength",None)
            for filho in valor.values():visitar(filho)
        elif isinstance(valor,list):
            for filho in valor:visitar(filho)
    visitar(resultado)
    return resultado


def preparar_indice_json(schema,tokenizer,*,prefixo_json=False,draft_model=None,limitar_comprimento_texto=True):
    """Fase CPU futura; não chamada nos ensaios desta entrega."""
    if prefixo_json or draft_model is not None:
        raise ValueError("Somente JSON gerado integralmente e geração serial sem draft/MTP.")
    if not isinstance(schema,dict) or schema.get("type")!="object":
        raise ValueError("JSONSchema raiz object obrigatório neste protótipo.")
    # O conversor pode fixar a ordem de properties. Preserve a ordem escolhida
    # pelo chamador (por exemplo a ordem já usada no treino), não alfabetize.
    serial=json.dumps(schema,ensure_ascii=False,separators=(",",":"))
    if len(serial)>50000:raise ValueError("Schema excede orçamento experimental.")
    try:versao=metadata.version("outlines-core")
    except metadata.PackageNotFoundError as erro:
        raise RuntimeError("outlines_core opcional ausente; nenhuma restrição foi aplicada ou instalação executada.") from erro
    if versao!="0.2.14":raise RuntimeError("Revalidar APIs antes de usar outra versão de outlines_core.")
    from outlines_core import Index,Vocabulary
    from outlines_core.json_schema import build_regex_from_schema
    eos,vocab,auditoria=vocabulario_bytes(tokenizer)
    compilavel=esquema_para_compilacao(schema,limitar_comprimento_texto=limitar_comprimento_texto)
    serial_compilavel=json.dumps(compilavel,ensure_ascii=False,separators=(",",":"))
    regex=build_regex_from_schema(serial_compilavel,whitespace_pattern=r"[ ]?")
    indice=Index(regex,Vocabulary(eos,vocab))
    auditoria.update(coreVersao=versao,schemaSha256=hashlib.sha256(serial.encode()).hexdigest(),
        schemaCompiladoSha256=hashlib.sha256(serial_compilavel.encode()).hexdigest(),
        limitesComprimentoTextoNoIndice=limitar_comprimento_texto,
        limitesComprimentoTextoNoContratoPosterior=True,
        modo="serial_sem_draft",naoAsseguraLiteralidadeOuSemantica=True)
    return IndicePreparado(indice,eos,auditoria["maxTokenId"],auditoria)


class ProcessadorSerial:
    """Estado por geração. Hooks permitem testar o protocolo sem MLX/GPU."""
    def __init__(self,guia,eos,max_token_id,alocar,preencher,aplicar):
        self.guia=guia;self.eos=eos;self.max_token_id=max_token_id
        self.alocar=alocar;self.preencher=preencher;self.aplicar=aplicar
        self.comprimento_anterior=None;self.tamanho_vocab=None;self.mascara=None

    def __call__(self,tokens,logits):
        if len(tokens.shape)!=1 or not len(tokens):
            raise ValueError("Somente uma sequência serial de tokens; batch não suportado.")
        if len(logits.shape) not in (1,2) or len(logits.shape)==2 and logits.shape[0]!=1:
            raise ValueError("Logits de uma sequência necessários.")
        tamanho=logits.shape[-1]
        if self.max_token_id>=tamanho:raise ValueError("Vocabulário e dimensão dos logits não coincidem.")
        if self.tamanho_vocab is None:
            self.tamanho_vocab=tamanho;self.mascara=self.alocar(tamanho)
        elif self.tamanho_vocab!=tamanho:raise ValueError("Vocabulário mudou durante geração.")
        comprimento=len(tokens)
        if self.comprimento_anterior is not None:
            if comprimento!=self.comprimento_anterior+1:
                raise ValueError("Contexto repetido, salto ou rollback: draft/MTP/reuso não suportado.")
            ultimo=tokens[-1];ultimo=int(ultimo.item() if hasattr(ultimo,"item") else ultimo)
            terminal=ultimo==self.eos and self.guia.is_finished()
            if not terminal and not self.guia.accepts_tokens([ultimo]):
                permitidos=self.guia.get_tokens() if hasattr(self.guia,"get_tokens") else []
                raise ValueError("Token amostrado não aceito pela gramática; id="+str(ultimo)+
                    "; contexto="+str(comprimento)+"; permitidos="+str(permitidos[:12])+"; sem fallback silencioso.")
            if not terminal:self.guia.advance(token_id=ultimo,return_tokens=False)
        # A primeira chamada contém o prompt, que não pertence ao JSON gerado.
        self.comprimento_anterior=comprimento
        self.preencher(self.guia,self.mascara)
        resultado=self.aplicar(logits,self.mascara)
        return resultado[0] if len(logits.shape)==1 else resultado


def criar_processador_mlx(preparado,*,usar_kernel_metal=False):
    """Respeita o device do processo; kernel Metal exige opção explícita."""
    if not isinstance(preparado,IndicePreparado):raise TypeError("Índice preparado necessário.")
    from outlines_core import Guide
    import mlx.core as mx
    if not usar_kernel_metal:
        # O kernel Metal oficial não executa no backend CPU. Este caminho usa
        # operações MX no device já escolhido pelo chamador; os testes usam CPU.
        import numpy as np
        def alocar(n):return np.full((1,(n+31)//32),-1,dtype=np.int32)
        def preencher(guia,mascara):guia.write_mask_into(mascara.ctypes.data,mascara.size,mascara.itemsize)
        def aplicar(logits,mascara):
            n=logits.shape[-1];ids=np.arange(n,dtype=np.uint32)
            permitido=((mascara.view(np.uint32)[0,ids//32]>>(ids%32))&1).astype(np.bool_)
            base=mx.expand_dims(logits,0) if len(logits.shape)==1 else logits
            return mx.where(mx.array(permitido)[None,:],base,mx.array(-float("inf"),dtype=base.dtype))
        return ProcessadorSerial(Guide(preparado.indice),preparado.eos,preparado.max_token_id,alocar,preencher,aplicar)
    from outlines_core.kernels.mlx import allocate_token_bitmask,fill_next_token_bitmask,apply_token_bitmask
    return ProcessadorSerial(Guide(preparado.indice),preparado.eos,preparado.max_token_id,
        allocate_token_bitmask,fill_next_token_bitmask,apply_token_bitmask)
