"""Executa o agente experimental com entrada do servidor, sem rede ou arquivos de clientes."""

import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path
import re
import sys

IA = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(IA / 'v3'))
sys.path.insert(0, str(IA))
from runtime import RAIZ, sha256
from inferir_v3 import (sanear, preservar_estado_fonte, carregar, gerar_escolha,
                        apresentar, bloqueios, orientar_disponibilidade, validar_aplicabilidade)

PERGUNTA_COMERCIAL = re.compile(r'retorno|receita|lucro|vendas|convers|or[cç]amento|gasto|custos?|pre[cç]os?|investimento|\broi\b', re.I)


def barreiras_web(escolha, entrada):
    """Cada indicação deve citar a fonte específica que sustenta o próximo passo."""
    acao=escolha.get('acao')
    refs=set(escolha.get('evidencias', []))
    if acao=='melhorar_pagina' and not any(
            e.get('id')=='d1' and e.get('id') in refs and e.get('tipo')=='pagina' and e.get('atual') is True
            and isinstance(e.get('sha256_pagina'),str) and re.fullmatch(r'[a-f0-9]{64}',e['sha256_pagina']) is not None
            for e in entrada['evidencias']):
        return ['A revisão precisa citar um diagnóstico específico e recente da mesma página; um termo publicado não comprova um problema.']
    fontes=[e for e in entrada['evidencias'] if e.get('tipo')=='serp']
    if acao=='atualizar_coleta' and fontes and not any(e.get('id') in refs for e in fontes):
        return ['A orientação sobre a coleta de posições precisa citar a fonte de busca disponível neste contexto.']
    if acao != 'validar_demanda':
        return []
    if not any(e.get('id') == 'p1' and e.get('id') in refs and e.get('tipo') == 'pagina'
               and e.get('atual') is True and e.get('sha256_pagina') for e in entrada['evidencias']):
        return ['A escolha precisa citar o trecho recente da página de onde o termo foi extraído.']
    return []


def cabecalho_noindex(valor):
    if not isinstance(valor,str) or not valor.strip() or len(valor)>512 or re.search(r'[\x00-\x1f\x7f]',valor):return False
    escopo='todos'
    parametros={'max-snippet','max-image-preview','max-video-preview','unavailable_after'}
    for parte in valor.split(','):
        texto=parte.strip();p=re.match(r'^([a-z][a-z0-9_-]*)\s*:\s*(.*)$',texto,re.I)
        if p:
            nome=p.group(1).lower()
            if nome in parametros:continue
            escopo=nome;texto=p.group(2)
        tokens=re.findall(r'[a-z][a-z0-9_-]*(?:\s*:\s*[^,\s]+)?',texto.lower())
        if escopo in ('todos','googlebot') and any(t in ('noindex','none') for t in tokens):return True
    return False


def diretiva_verificada(e):
    if (not isinstance(e,dict) or e.get('tipo')!='pagina' or e.get('atual') is not True
            or not isinstance(e.get('id'),str) or not isinstance(e.get('sha256_pagina'),str)
            or re.fullmatch(r'[a-f0-9]{64}',e['sha256_pagina']) is None):
        return False
    v=e.get('verificacao')
    if not isinstance(v,dict) or v.get('intencao')!='desconhecida':return False
    if v.get('tipo')=='meta_robots_noindex' and v.get('escopo')=='html_inicial':return True
    if v.get('tipo')=='http_robots_noindex' and v.get('escopo')=='cabecalho_http':
        valor=e.get('valor_cabecalho');digest=e.get('sha256_cabecalho')
        return (isinstance(valor,str) and len(valor)<=512 and isinstance(digest,str)
                and re.fullmatch(r'[a-f0-9]{64}',digest) is not None
                and hashlib.sha256(valor.encode('utf-8')).hexdigest()==digest and cabecalho_noindex(valor))
    return False


def regra_publicacao(entrada):
    """Orienta uma conferência quando a diretiva foi verificada e a intenção é desconhecida."""
    objetivo = entrada.get('objetivo', '')
    if not isinstance(objetivo, str) or not re.search(r'indexa|noindex|diretiva|publica|exclus[aã]o', objetivo, re.I):
        return None
    for e in entrada.get('evidencias', []):
        if diretiva_verificada(e):
            return {'acao':'confirmar_publicacao', 'evidencias':[e['id']]}
    return None


def regra_sem_evidencias(entrada):
    """Não pede ao modelo que invente uma melhoria para uma análise vazia."""
    if entrada.get('evidencias') == []:
        return {'acao':'atualizar_coleta', 'evidencias':[]}
    return None


def regra_serp_atual(entrada):
    """Usa posições e concorrentes atuais já validados pelo servidor, quando pertinentes."""
    objetivo=entrada.get('objetivo','')
    if not isinstance(objetivo,str):return None
    explicito=bool(re.search(r'concorr|à frente|acima|mesma busca|posi[cç][aã]o|coloca[cç][aã]o|monitorar|acompanhar',objetivo,re.I))
    generico=bool(re.search(r'pr[oó]xima melhoria',objetivo,re.I))
    if not explicito and not generico:return None
    if not generico and PERGUNTA_COMERCIAL.search(objetivo):return None
    diagnostico=any(e.get('id')=='d1' and e.get('tipo')=='pagina' and e.get('atual') is True
                    for e in entrada.get('evidencias',[]) if isinstance(e,dict))
    if diagnostico and not explicito:return None
    for e in entrada.get('evidencias',[]):
        if (not isinstance(e,dict) or e.get('tipo')!='serp' or e.get('atual') is not True or
                type(e.get('posicao')) is not int or not 1<=e['posicao']<=100 or not isinstance(e.get('id'),str)):
            continue
        fontes=e.get('fontes_serp',[])
        if not isinstance(fontes,list) or not any(isinstance(f,dict) and isinstance(f.get('id'),str) and
                re.fullmatch(r'[a-zA-Z0-9_-]{8,128}',f['id']) is not None and
                isinstance(f.get('sha256'),str) and re.fullmatch(r'[a-f0-9]{64}',f['sha256']) is not None for f in fontes):
            continue
        concorrentes=e.get('concorrentes',[])
        tem_concorrente=isinstance(concorrentes,list) and any(isinstance(c,dict) and
            type(c.get('posicao')) is int and 0<c['posicao']<e['posicao'] and
            isinstance(c.get('pagina'),str) and re.match(r'^https?://',c['pagina'],re.I) for c in concorrentes)
        if tem_concorrente:return {'acao':'comparar_concorrentes','evidencias':[e['id']]}
        if re.search(r'concorr|à frente|acima',objetivo,re.I):return None
        return {'acao':'acompanhar','evidencias':[e['id']]}
    return None


def regra_posicao_indisponivel(entrada):
    """Perguntas explícitas sobre ranking sem captura atual precisam de uma fonte."""
    objetivo=entrada.get('objetivo','')
    if not isinstance(objetivo,str):return None
    evidencias=entrada.get('evidencias',[])
    if not isinstance(evidencias,list):return None
    generico=objetivo in ('Escolher uma próxima melhoria com as evidências disponíveis.',
      'Escolher uma próxima melhoria com as evidências disponíveis. O retorno comercial não foi medido.')
    if not generico and PERGUNTA_COMERCIAL.search(objetivo):return None
    if generico:
        # Sem página ou diagnóstico, não se pede ao modelo que adivinhe uma
        # melhoria: há somente uma consulta sem posição verificável.
        if len(evidencias)!=1 or not isinstance(evidencias[0],dict) or evidencias[0].get('tipo')!='serp':return None
    elif not re.search(r'posi[cç][aã]o|coloca[cç][aã]o|concorr|ranking|ordem dos resultados|aparece no google',objetivo,re.I):
        return None
    for e in evidencias:
        if (isinstance(e,dict) and e.get('tipo')=='serp' and isinstance(e.get('id'),str) and
                (e.get('atual') is not True or type(e.get('posicao')) is not int)):
            return {'acao':'atualizar_coleta','evidencias':[e['id']]}
    return None


def fontes_serp_validas(e, agora=None):
    """Exige os identificadores e datas de todas as páginas, sem autenticar o provedor pelo hash."""
    fontes=e.get('fontes_serp')
    if (type(e.get('posicao')) is not int or not 1<=e['posicao']<=100 or
        not isinstance(fontes,list) or not 1<=len(fontes)<=5):return False
    instante=agora or datetime.now(timezone.utc);datas=[];ids=set()
    try:
        observada=datetime.fromisoformat(e.get('observado_em','').replace('Z','+00:00'))
        for f in fontes:
            if (not isinstance(f,dict) or not isinstance(f.get('id'),str) or
                re.fullmatch(r'[a-zA-Z0-9_-]{8,128}',f['id']) is None or f['id'] in ids or
                not isinstance(f.get('sha256'),str) or re.fullmatch(r'[a-f0-9]{64}',f['sha256']) is None):return False
            data=datetime.fromisoformat(f.get('observado_em','').replace('Z','+00:00'))
            if not 0<=(instante-data).total_seconds()<3600:return False
            datas.append(data);ids.add(f['id'])
        return observada==min(datas)
    except (ValueError,TypeError,AttributeError):return False


def sanear_web(original, agora=None):
    """Retira capturas e concorrentes de posições que expiraram entre coleta e uso."""
    entrada=preservar_estado_fonte(original,sanear(original,agora=agora),agora=agora)
    for e in entrada['evidencias']:
        if e.get('tipo')=='serp':
            if e.get('atual') is True and not fontes_serp_validas(e,agora=agora):
                e.update(atual=False,posicao=None,estado_fonte='sem_captura_validavel',
                  descricao='A posição não tem páginas de origem recentes e identificadas para verificação.')
                e.pop('concorrentes',None)
            if e.get('atual') is not True:e.pop('fontes_serp',None)
            if e.get('estado_fonte')!='nao_observado_recorte':e.pop('recorte_serp',None)
    return entrada


def entrada_para_modelo(entrada):
    """Fontes e hashes ficam para auditoria; não ocupam contexto do modelo."""
    return {**entrada,'evidencias':[{k:v for k,v in e.items() if k not in ('fontes_serp','recorte_serp')}
                                    for e in entrada['evidencias']]}


def orientar_web(resultado,entrada):
    orientar_disponibilidade(resultado,entrada)
    if (resultado.get('estado')!='recusada' and resultado.get('escolha_ia',{}).get('acao')=='atualizar_coleta'
            and entrada.get('evidencias')==[]):
        resultado['orientacao_padrao']='Não foi possível reunir evidências suficientes nesta análise. Confira a disponibilidade e a permissão de leitura do site antes de tentar novamente.'
        resultado['limite_padrao']='Sem evidências, não é possível indicar posições, concorrentes ou uma melhoria específica.'
    return resultado


def bloqueios_web(escolha,entrada):
    # O contrato histórico v3 só conhece meta tags; aceita-se também a captura
    # HTTP revalidada pelo aplicativo local, sem alterar os resultados antigos.
    if escolha.get('acao')=='confirmar_publicacao':
        refs=set(escolha.get('evidencias',[]))
        if any(diretiva_verificada(e) and e.get('verificacao',{}).get('tipo')=='http_robots_noindex'
               and e.get('id') in refs for e in entrada.get('evidencias',[])):
            return validar_aplicabilidade(escolha,entrada)
    return bloqueios(escolha,entrada)


def selecao_candidata(pares):
    """Prefere a nova seleção experimental apenas quando a decisão corresponde ao arquivo."""
    for selecao,decisao in pares:
        try:
            registro=json.loads(decisao.read_text(encoding='utf-8'))
            if registro.get('estado') in ('experimental_disponivel','manter_selecao_anterior') and registro.get('selecao_sha256')==sha256(selecao):
                return selecao
        except (OSError,ValueError,TypeError):
            continue
    return None


def descrever_modelo(selecao_bytes, selecao, candidata=False):
    """Public identity of the locally verified adapter; never expose paths."""
    return {'versao':1,'modo':'candidata' if candidata else 'padrao',
            'selecaoSha256':hashlib.sha256(selecao_bytes).hexdigest(),
            'adaptadorSha256':selecao['adaptador_sha256'],
            'configSha256':selecao['candidato']['config_adaptador_sha256']}


def alternativa_sem_diagnostico(escolha,entrada,origem):
    """Substitui uma revisão sem achado por investigação do termo, com origem explícita."""
    if (origem!='ia' or not isinstance(escolha,dict) or escolha.get('acao')!='melhorar_pagina' or
        not isinstance(entrada.get('objetivo'),str) or
        not entrada['objetivo'].startswith('Escolher uma próxima melhoria com as evidências disponíveis.')):
        return None
    refs=escolha.get('evidencias',[])
    if not isinstance(refs,list) or 'p1' not in refs or 'd1' in refs:return None
    paginas=[e for e in entrada['evidencias'] if e.get('id')=='p1' and e.get('tipo')=='pagina' and
      e.get('atual') is True and isinstance(e.get('sha256_pagina'),str) and
      re.fullmatch(r'[a-f0-9]{64}',e['sha256_pagina']) is not None]
    fontes=[e for e in entrada['evidencias'] if e.get('id')=='s1' and e.get('tipo')=='serp' and
      isinstance(e.get('termo'),str) and e['termo'].strip()]
    if not any(p.get('pagina') and p.get('pagina')==s.get('pagina') for p in paginas for s in fontes):return None
    alternativa={'acao':'validar_demanda','evidencias':['p1']}
    return alternativa if not (bloqueios_web(alternativa,entrada) or barreiras_web(alternativa,entrada)) else None


def alternativa_com_diagnostico(escolha,entrada,origem):
    """Quando a IA cita diagnóstico como demanda, oferece apenas a revisão observada."""
    if (origem!='ia' or not isinstance(escolha,dict) or escolha.get('acao')!='validar_demanda' or
        escolha.get('evidencias')!=['d1'] or not isinstance(entrada.get('objetivo'),str) or
        not entrada['objetivo'].startswith('Escolher uma próxima melhoria com as evidências disponíveis.')):
        return None
    evidencias=entrada.get('evidencias',[])
    diagnosticos=[e for e in evidencias if isinstance(e,dict) and e.get('id')=='d1' and e.get('tipo')=='pagina'
      and e.get('atual') is True and isinstance(e.get('pagina'),str) and e['pagina'].startswith(('https://','http://'))
      and isinstance(e.get('descricao'),str) and e['descricao'].strip() and not e.get('verificacao')
      and isinstance(e.get('sha256_pagina'),str) and re.fullmatch(r'[a-f0-9]{64}',e['sha256_pagina']) is not None]
    if len(diagnosticos)!=1:return None
    # A real page context normally carries both its published term (p1) and
    # its observed diagnosis (d1). Presence of p1 cannot erase that diagnosis;
    # it must, however, belong to the very same page before a rule can help.
    paginas=[e for e in evidencias if isinstance(e,dict) and e.get('id')=='p1']
    if any(e.get('tipo')!='pagina' or e.get('atual') is not True or
           e.get('pagina')!=diagnosticos[0]['pagina'] for e in paginas):return None
    alternativa={'acao':'melhorar_pagina','evidencias':['d1']}
    return alternativa if not (bloqueios_web(alternativa,entrada) or barreiras_web(alternativa,entrada)) else None


def finalizar_web(escolha,original,origem,agora=None):
    """Reconfere idade e barreiras imediatamente antes de entregar as sugestões."""
    entrada=sanear_web(original,agora=agora)
    resultado=apresentar(escolha,entrada)
    if resultado['estado']!='recusada':
        motivos=bloqueios_web(escolha,entrada) or barreiras_web(escolha,entrada)
        if motivos:resultado.update(estado='recusada',motivos_aplicabilidade=motivos)
    alternativa=(alternativa_sem_diagnostico(escolha,entrada,origem) or alternativa_com_diagnostico(escolha,entrada,origem)) if resultado.get('motivos_aplicabilidade') else None
    if alternativa:
        resultado=apresentar(alternativa,entrada)
        resultado['escolha_original_ia']=escolha
        resultado['ajustada_por_regra']=True
        resultado['aviso']=('A IA não citou um diagnóstico específico; uma regra sugeriu investigar a demanda do termo.'
          if alternativa['acao']=='validar_demanda' else
          'A IA citou o diagnóstico como se medisse demanda; uma regra sugeriu revisar somente o ponto observado.')
        origem='regra'
    orientar_web(resultado,entrada);resultado['origem']=origem
    if origem=='regra' and not alternativa:
        resultado['aviso']=('Uma regra reconheceu a ausência de evidências. Confira a coleta.' if not entrada['evidencias'] else
          'Uma regra escolheu uma verificação a partir de posição e concorrentes observados. Revise a captura.'
          if escolha['acao'] in ('comparar_concorrentes','acompanhar') else
          'Uma regra identificou que falta uma captura atual para responder à pergunta sobre posições.'
          if escolha['acao']=='atualizar_coleta' else
          'Uma regra escolheu confirmar a intenção com base na diretiva identificada. Revise a evidência.')
    return resultado


def main():
    if sys.argv[1:] not in ([], ['--candidata']):
        raise ValueError('Opção local inválida.')
    texto = sys.stdin.read(256 * 1024 + 1)
    if len(texto.encode('utf-8')) > 256 * 1024:
        raise ValueError('Entrada grande demais.')
    envelope = json.loads(texto)
    if (not isinstance(envelope, dict) or envelope.get('versao') != 1
            or not isinstance(envelope.get('entradas'), list) or not 1 <= len(envelope['entradas']) <= 3):
        raise ValueError('Entrada inválida.')
    if sys.argv[1:] == ['--candidata']:
        caminho=selecao_candidata([
            (RAIZ/'data/ia/modular/selecao-interface-candidata.json',RAIZ/'data/ia/modular/decisao-interface-candidata.json'),
            (RAIZ/'data/ia/robustez/selecao-interface-candidata.json',RAIZ/'data/ia/robustez/decisao-interface-candidata.json'),
            (RAIZ/'data/ia/reais/selecao-rodada4-acoes.json',RAIZ/'data/ia/reais/decisao-interface-rodada4.json')])
    else:
        caminhos=[RAIZ/'data/ia/selecao-interface.json',RAIZ/'data/ia/reais/selecao-acoes.json',RAIZ/'data/ia/v3-selecao.json']
        caminho=next((p for p in caminhos if p.is_file()),None)
    if caminho is None:
        raise ValueError('Nenhuma seleção local encontrada.')
    selecao_bytes = caminho.read_bytes()
    selecao = json.loads(selecao_bytes.decode('utf-8'))
    adaptador = Path(selecao['candidato']['pasta'])
    if (sha256(adaptador / 'adapters.safetensors') != selecao['adaptador_sha256']
            or sha256(adaptador / 'adapter_config.json') != selecao['candidato']['config_adaptador_sha256']):
        raise ValueError('Seleção ou adaptador alterado.')
    identidade = descrever_modelo(selecao_bytes, selecao, sys.argv[1:] == ['--candidata'])
    modelo, tokenizer = None, None
    decisoes=[]
    for original in envelope['entradas']:
        entrada=sanear_web(original)
        escolha = (regra_publicacao(entrada) or regra_sem_evidencias(entrada) or regra_serp_atual(entrada)
                   or regra_posicao_indisponivel(entrada))
        origem = 'regra' if escolha is not None else 'ia'
        if escolha is None:
            if modelo is None:
                modelo, tokenizer = carregar(adaptador)
            _, escolha = gerar_escolha(modelo, tokenizer, entrada_para_modelo(entrada))
        decisoes.append((escolha,origem))
    resultados=[finalizar_web(escolha,original,origem)
                for original,(escolha,origem) in zip(envelope['entradas'],decisoes)]
    print(json.dumps({'versao':1, 'estado':'experimental', 'modelo':identidade, 'resultados':resultados}, ensure_ascii=False))


if __name__ == '__main__':
    main()
