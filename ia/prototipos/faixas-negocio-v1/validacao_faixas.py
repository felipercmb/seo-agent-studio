"""Protótipo isolado; não importa nem altera o pipeline avaliado.
As faixas devem ser estruturadas a partir de evidência revisada. Não interpreta
texto livre e não certifica correção da extração ou utilidade comercial.
"""
from dataclasses import dataclass

@dataclass(frozen=True)
class Faixa:
    unidade: str
    minimo: int | None
    maximo: int | None

    def __post_init__(self):
        if not isinstance(self.unidade,str) or not self.unidade.strip():
            raise ValueError("Unidade explícita necessária.")
        if any(v is not None and (isinstance(v,bool) or not isinstance(v,int)) for v in (self.minimo,self.maximo)):
            raise ValueError("Limites inteiros ou None necessários.")
        if self.minimo is not None and self.maximo is not None and self.minimo>self.maximo:
            raise ValueError("Faixa invertida.")

    def contem(self,valor):
        if isinstance(valor,bool) or not isinstance(valor,int):raise ValueError("Valor inteiro necessário.")
        return (self.minimo is None or valor>=self.minimo) and (self.maximo is None or valor<=self.maximo)


def conferir_faixa(publicada,recomendada):
    """Uma recomendação pode restringir, mas não ampliar a faixa publicada."""
    if publicada.unidade!=recomendada.unidade:
        return {"compativel":False,"erros":["unidade_diferente"],"contraexemplos":[]}
    erros=[];provas=[]
    if publicada.minimo is not None and (recomendada.minimo is None or recomendada.minimo<publicada.minimo):
        erros.append("limite_inferior_ampliado");provas.append(publicada.minimo-1)
    if publicada.maximo is not None and (recomendada.maximo is None or recomendada.maximo>publicada.maximo):
        erros.append("limite_superior_ampliado");provas.append(publicada.maximo+1)
    provas=[n for n in provas if recomendada.contem(n) and not publicada.contem(n)]
    return {"compativel":not erros,"erros":erros,"contraexemplos":provas,
            "limite":"Compatibilidade matemática de limites estruturados; não aprova negócio, fonte ou plano."}
