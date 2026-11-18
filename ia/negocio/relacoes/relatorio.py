"""Renderização offline das hipóteses e respectivas evidências para revisão."""
import argparse
import json
from pathlib import Path


def limpar(v):
    # Escape source content as Markdown text, never raw HTML or active links.
    return str(v).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('\\','\\\\').replace('[','\\[').replace(']','\\]').replace('`','\\`').replace('|','\\|').replace('\n',' ')


def renderizar(resultado):
    linhas=['# Relações do negócio: revisão pendente','',
        'Hipóteses extraídas localmente. Fontes públicas são declarações dos sites. Confirme atores, ofertas e condições antes de usar qualquer interpretação.','']
    for r in resultado['resultados']:
        linhas += ['## '+limpar(r['dominio'])+' — '+r['modo'],'']
        rev=r.get('revisao')
        if not rev:
            linhas += ['Execução indisponível: '+limpar(r['geracao']['estado']),''];continue
        linhas += ['Estado: '+rev['estado']+'. Perfil confirmado: não.','']
        for grupo in ['relacoes','condicoes']:
            linhas += ['### '+('Relações' if grupo=='relacoes' else 'Condições'),'']
            if not rev[grupo]:linhas += ['Nenhum item estruturalmente utilizável nesta execução.',''];continue
            for i in rev[grupo]:
                if grupo=='relacoes':
                    linhas += ['- '+limpar(i['sujeito'])+' → **'+i['predicado']+'** → '+limpar(i['objeto'])+
                        '; oferta: '+limpar(i['oferta'] or 'não identificada')+'; '+i['polaridade']+'; '+i['temporalidade']+'.']
                else:linhas += ['- '+i['categoria']+'; aplicação: '+limpar(i['aplicacao'] or 'não identificada')+'; '+i['temporalidade']+'.']
                for f in i['citacoes']:
                    c=f.get('contexto',{})
                    linhas += ['','  Evidência '+f['id']+': '+limpar(f['texto']),
                        '','  Origem: '+limpar(c.get('url','metadados omitidos nesta comparação'))+
                        '; seção: '+limpar(' / '.join(h['texto'] for h in c.get('titulos',[])) or 'sem seção identificada')+
                        '; campo: '+limpar(c.get('campo','não disponível'))+'.']
                if i['alertas']:linhas += ['','  Revisar: '+', '.join(i['alertas'])+'.']
                linhas += ['']
        if rev['duvidas']:linhas += ['### Dúvidas','',*['- '+limpar(d) for d in rev['duvidas']],'']
        linhas += ['Itens recusados: '+str(len(rev['recusados']))+'. Isso não mede a correção semântica dos itens restantes.','']
    return '\n'.join(linhas)+'\n'


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('resultado',type=Path);p.add_argument('saida',type=Path);a=p.parse_args()
    with a.saida.open('x') as f:f.write(renderizar(json.loads(a.resultado.read_text())))


if __name__=='__main__':main()
