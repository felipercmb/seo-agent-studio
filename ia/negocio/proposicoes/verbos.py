"""Classificação transparente do verbo copiado, não decisão semântica de papéis."""
import re
import unicodedata


def classificar(acao):
    t=' '.join(unicodedata.normalize('NFD',acao).encode('ascii','ignore').decode().lower().split())
    for rel,padrao in (
        ('identidade',r'^(?:e|sao|somos|is|are)\b'),
        ('destina_se_a',r'^(?:destina|para\b|destined|intended)'),
        ('desenvolve',r'^(?:desenvolv|constr[ou]|develop|build)'),
        ('utiliza',r'^(?:utiliz|us[ao]|usam|use)'),
        ('paga',r'^(?:paga|pagam|pay|paid)'),
        ('recebe',r'^(?:receb|receive)'),
        ('solicita',r'^(?:solicit|request)'),
        ('contrata',r'^(?:contrat|hire)'),
        ('disponibiliza',r'^(?:disponibiliz|oferec|ofert|permite|permit|provide|offer|allow|help|ajud)'),
        ('executa',r'^(?:execut|realiz|configur|implement|implan|oper|emite|emitir|emiti|process|liquid|intermedi|conect|organiz|automatiz|consert|transport|entreg|agend|prospect|abord|presta|registra|inclui|faz|faze|feito|feita|perform|manag|connect|schedule)'),
    ):
        if re.search(padrao,t):return rel
    return 'indefinida'
