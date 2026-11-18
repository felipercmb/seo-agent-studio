"""Muda somente símbolos de unidade e ordem de alvos; nenhum fato novo."""
from copy import deepcopy
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import random
import shutil
from negocio.proposicoes.c8.protocolo import mensagens
from negocio.proposicoes.contrato import conferir_documento,validar_ofertas,validar_proposicoes


def permutar(r):
    novo=deepcopy(r);rng=random.Random(int(hashlib.sha256(r['id'].encode()).hexdigest()[:16],16));us=novo['documento']['unidades'];ids=rng.sample(range(100,1000),len(us));mapa={u['id']:'u'+str(i).zfill(3) for u,i in zip(us,ids)}
    for u in us:u['id']=mapa[u['id']]
    if novo['oferta'] is not None:
        alvos=[mapa[x] for x in r['documento']['unidadesAlvo']];rng.shuffle(alvos);novo['documento']['unidadesAlvo']=alvos
        inv={v:k for k,v in mapa.items()};novo['alvo']['proposicoesPorUnidade']={k:deepcopy(r['alvo']['proposicoesPorUnidade'][inv[k]]) for k in alvos}
        for c in novo['alvo']['condicoes']:c['unidade']=mapa[c['unidade']]
    novo['messages']=mensagens(novo['documento'],novo['oferta'])+[{'role':'assistant','content':json.dumps(novo['alvo'],ensure_ascii=False,separators=(',',':'))}]
    conferir_documento(novo['documento'])
    v=validar_proposicoes(novo['alvo'],novo['documento'],novo['oferta']) if novo['oferta'] else validar_ofertas(novo['alvo'],novo['documento'])
    if v.get('erro') or v.get('recusadas'):raise ValueError('Permutação invalidou alvo.')
    for a,b in zip(r['documento']['unidades'],us):
        if {k:v for k,v in a.items() if k!='id'}!={k:v for k,v in b.items() if k!='id'}:raise ValueError('Fonte/fato alterado.')
    novo['derivacaoC8']={'origemId':r['id'],'mapaIds':mapa,'ordemAlvosAnterior':r['documento'].get('unidadesAlvo'),'ordemAlvosNova':novo['documento'].get('unidadesAlvo'),'nenhumFatoNovo':True}
    return novo


def criar(origem,destino,raiz):
    origem=Path(origem);destino=Path(destino);destino.mkdir(mode=0o700);orig=json.loads((origem/'manifesto.json').read_text());rs=[permutar(json.loads(l)) for l in (origem/'tarefas-train.jsonl').read_text().splitlines()]
    for nome,linhas in [('train.jsonl',[{'messages':r['messages']} for r in rs]),('tarefas-train.jsonl',rs)]:
        with (destino/nome).open('x') as f:
            for r in linhas:f.write(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n')
    for nome in ['valid.jsonl','tarefas-valid.jsonl']:shutil.copy2(origem/nome,destino/nome)
    fontes=[Path(__file__),Path(__file__).with_name('protocolo.py'),Path(__file__).with_name('ponderacao.py')]
    orig.update(geradoEm=datetime.now(timezone.utc).isoformat(),codigoGeracaoSha256={str(p.relative_to(Path(raiz))):hashlib.sha256(p.read_bytes()).hexdigest() for p in fontes},protocoloSha256=hashlib.sha256(Path(__file__).with_name('protocolo.py').read_bytes()).hexdigest(),arquivosSha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in destino.glob('*.jsonl')},derivacao={'fonteManifestoSha256':hashlib.sha256((origem/'manifesto.json').read_bytes()).hexdigest(),'somenteTreinoPermutado':True,'validacaoByteAByteIgual':True,'mesmosFatosSplitsEntidades':True,'metodo':'IDs100–999 e ordem de alvos por SHA do ID de tarefa; seed determinístico; sem TEST novo.'},experimentoComposto='PermutaçãoIDs/ordem + CE com peso8 simétrico nas decisões. Não isola efeito de cada técnica.')
    with (destino/'manifesto.json').open('x') as f:json.dump(orig,f,ensure_ascii=False,indent=2);f.write('\n')
    return orig
