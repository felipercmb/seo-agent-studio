"""Alinha o prefixo vazio do template, sem descartar conteúdo gerado."""

MARCADOR='{"auditoria_prefixo_assistente":true}'
VAZIO="<think>\n\n</think>\n\n"


def prefixo_assistente(tokenizer,mensagens):
    prompt=tokenizer.apply_chat_template(mensagens,tokenize=False,add_generation_prompt=True)
    completo=tokenizer.apply_chat_template(mensagens+[{"role":"assistant","content":MARCADOR}],tokenize=False)
    ponto=completo.rfind(MARCADOR)
    if ponto<0 or not completo[:ponto].startswith(prompt):
        raise ValueError("Template não apresenta fronteira de assistente reconhecida.")
    acrescimo=completo[:ponto][len(prompt):]
    if acrescimo not in ("",VAZIO):
        raise ValueError("Prefixo adicional não é o cabeçalho vazio conhecido; não executar automaticamente.")
    # This is supplied as prompt, not stripped from any generated answer. JSON
    # parsing of the model response remains strict and unchanged.
    return {"prompt":prompt+acrescimo,"prefixo":acrescimo,"alinhado":bool(acrescimo),
        "origem":"cabecalho_vazio_do_template_de_treino","respostaGeradaNaoFoiEditada":True}
