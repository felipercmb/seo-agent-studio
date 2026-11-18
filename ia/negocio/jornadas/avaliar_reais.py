"""Inferência serial sobre pedidos públicos já preparados, sem busca ou rótulos.

Uma oferta por caso. Teste exige congelamento; os relatórios não atribuem uma
pontuação semântica automática a nomes, citações ou formatos válidos.
"""
import argparse,json,sys,hashlib,time,os,gc
from pathlib import Path
from datetime import datetime,timezone
IA=Path(__file__).resolve().parents[2];RAIZ=IA.parent;sys.path.insert(0,str(IA))
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1')

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def salvar(p,v):
    with Path(p).open('x',encoding='utf8') as f:json.dump(v,f,ensure_ascii=False,indent=2,allow_nan=False);f.write('\n')

def verificar_congelamento(arquivo):
    if not arquivo:raise ValueError('Teste exige manifesto de congelamento anterior.')
    congelado=json.loads(Path(arquivo).read_text())
    exigidos={str(p.relative_to(RAIZ)) for p in Path(__file__).parent.glob('*.py')}
    codigos=congelado.get('codigoSha256',{})
    if congelado.get('versao')!=1 or not exigidos.issubset(codigos):raise ValueError('Congelamento incompleto.')
    for relativo,h in codigos.items():
        p=RAIZ/relativo
        if Path(relativo).is_absolute() or '..' in Path(relativo).parts or not p.is_file() or sha(p)!=h:raise ValueError('Código mudou após o congelamento: '+relativo)
    return sha(arquivo)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--lote',type=Path,required=True);p.add_argument('--saida',type=Path,required=True)
    p.add_argument('--adaptador',type=Path);p.add_argument('--abrir-reserva',action='store_true');p.add_argument('--congelamento',type=Path)
    a=p.parse_args()
    if a.saida.exists():p.error('Escolha uma pasta nova; nenhum experimento anterior é sobrescrito.')
    bruto=a.lote.read_bytes()
    if len(bruto)>65536:raise ValueError('Manifesto acima do limite.')
    lote=json.loads(bruto)
    if lote.get('versao')!=1 or lote.get('split') not in ('development','test') or not isinstance(lote.get('lotes'),list) or not 1<=len(lote['lotes'])<=64:raise ValueError('Lote inválido.')
    congelamento=None
    if lote['split']=='test':
        if not a.abrir_reserva:raise ValueError('A reserva deve ser aberta explicitamente após o congelamento.')
        congelamento=verificar_congelamento(a.congelamento)
    a.saida.mkdir(parents=True,mode=0o700)
    from negocio.jornadas.contrato import validar_base
    from negocio.jornadas.recuperacao import validar_reserva
    from negocio.jornadas.executar import executar
    from negocio.runtime_negocio import carregar_leitor
    pedidos=[];ids=set()
    for c in lote['lotes']:
        if not isinstance(c,dict) or not isinstance(c.get('id'),str) or not __import__('re').fullmatch(r'[A-Za-z0-9_-]{1,100}',c['id']) or c['id'] in ids:raise ValueError('Caso inválido/repetido.')
        ids.add(c['id']);relativo=Path(c['entrada'])
        if relativo.is_absolute() or '..' in relativo.parts:raise ValueError('Pedido deve estar dentro da pasta do lote.')
        arquivo=a.lote.parent/relativo;entrada=arquivo.read_bytes()
        if len(entrada)>1048576 or c.get('entradaSha256') and sha(arquivo)!=c['entradaSha256']:raise ValueError('Identidade/tamanho do pedido inválido.')
        v=json.loads(entrada)
        if set(v)!={'base','maxOfertas','fontesReserva'} or v['maxOfertas']!=1 or v['base'].get('dominio')!=c['dominio'] or validar_base(v['base']):raise ValueError('Pedido incompatível.')
        validar_reserva(v['fontesReserva'],c['dominio']);pedidos.append((c,v,sha(arquivo)))
    codigo={str(q.relative_to(RAIZ)):sha(q) for q in Path(__file__).parent.glob('*.py')}
    registro={'versao':1,'inicio':datetime.now(timezone.utc).isoformat(),'split':lote['split'],'loteSha256':hashlib.sha256(bruto).hexdigest(),'congelamentoSha256':congelamento,
              'codigoSha256':codigo,'casosEsperados':len(pedidos),'casos':[],'concluido':False,'metodo':'Inferência em cascata com fontes públicas; uma oferta por caso; sem rótulos no pedido.','limite':'A revisão semântica é separada. Coleta vazia, erro e recusa não são entendimento correto de negócio vazio.'}
    salvar(a.saida/'inicio.json',registro)
    leitor=None
    for c,v,digest in pedidos:
        inicio=time.monotonic();print('Iniciando '+c['id'],flush=True)
        try:
            if v['base']['fontes'] and leitor is None:leitor=carregar_leitor(a.adaptador,modelo_base='qwen35-4b')
            r=executar(v['base'],1,v['fontesReserva'],leitor=leitor)
            destino=a.saida/(c['id']+'-resultado.json');salvar(destino,r)
            item={'id':c['id'],'dominio':c['dominio'],'entradaSha256':digest,'estado':r['estado'],'resultadoSha256':sha(destino),'resultado':destino.name,
                  'ofertas':len(r['ofertas']),'inferencias':sum(i.get('inferida') is True for i in r.get('inferencias',[])),
                  'geracoesComPosProcessamento':sum(bool(i.get('posProcessamento')) for i in r.get('inferencias',[])),'segundos':time.monotonic()-inicio}
        except Exception as e:
            item={'id':c['id'],'dominio':c['dominio'],'entradaSha256':digest,'estado':'falhou','erro':type(e).__name__+': '+str(e),'segundos':time.monotonic()-inicio}
        registro['casos'].append(item)
        (a.saida/'progresso.json').write_text(json.dumps(registro,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(item,ensure_ascii=False),flush=True);gc.collect()
        if leitor:
            import mlx.core as mx
            mx.clear_cache()
    registro.update(concluido=True,fim=datetime.now(timezone.utc).isoformat(),modelo=leitor[2] if leitor else None,
                    casosComFalha=sum(c['estado']=='falhou' for c in registro['casos']),casosSemFontes=sum(c['estado']=='sem_fontes' for c in registro['casos']))
    salvar(a.saida/'execucao.json',registro)

if __name__=='__main__':main()
