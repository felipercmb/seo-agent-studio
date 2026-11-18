"""Instala SOMENTE o wheelcore0.2.14 autorizado, sem pip, deps ou rede.

Fallback local para pip com arquivos macOS dataless. Confere digest oficial,
tags, todos os RECORDs e destino exclusivo. Não substitui arquivos existentes.
"""
import argparse
import base64
import csv
from datetime import datetime,timezone
import hashlib
import io
import json
from pathlib import Path,PurePosixPath
import platform
import stat
import sys
import zipfile

NOME='outlines_core-0.2.14-cp314-cp314-macosx_14_0_arm64.whl'
SHA='69410e5b55bcbaad8c865d94bd01e7bff8a57996dcd2251b7d50dec70d7d9a63'
DIST='outlines_core-0.2.14.dist-info'

def digest(b):return base64.urlsafe_b64encode(hashlib.sha256(b).digest()).decode().rstrip('=')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--wheel',type=Path,required=True);p.add_argument('--recibo',type=Path,required=True);a=p.parse_args()
    if a.recibo.exists():raise ValueError('Use recibo novo.')
    raiz=Path(__file__).resolve().parents[3];site=raiz/'.venv-ia/lib/python3.14/site-packages'
    if sys.version_info[:2]!=(3,14) or platform.machine()!='arm64' or platform.system()!='Darwin' or int(platform.mac_ver()[0].split('.')[0])<14:raise ValueError('Ambiente incompatível com este wheel específico.')
    bruto=a.wheel.read_bytes()
    if a.wheel.name!=NOME or hashlib.sha256(bruto).hexdigest()!=SHA:raise ValueError('Nome ou hash oficial do wheel divergente.')
    if not site.is_dir() or (site/'outlines_core').exists() or any(site.glob('outlines_core-*.dist-info')):raise ValueError('Destino ausente ou core já existente; não substituir.')
    antes=sorted(q.name for q in site.glob('*.dist-info'))
    protegidos={str(q):hashlib.sha256(q.read_bytes()).hexdigest() for pat in ['mlx-*.dist-info/METADATA','mlx_lm-*.dist-info/METADATA','transformers-*.dist-info/METADATA'] for q in site.glob(pat)}
    if len(protegidos)!=3:raise ValueError('Baseline de dependências protegidas não encontrado.')
    criados=[];inicio=datetime.now(timezone.utc).isoformat();a.recibo.parent.mkdir(parents=True,exist_ok=True)
    recibo={'versao':1,'inicio':inicio,'metodo':'instalacao_direta_wheel_verificado_com_RECORD','motivo':'pip bloqueado ao importar arquivos dataless; sem contornar requisito Python do pacote Outlines.','autorizacaoRootSomenteCore014':True,'wheel':{'arquivo':str(a.wheel.resolve()),'sha256OficialConferido':SHA},'destino':str(site),'protegidosAntes':protegidos,'dependenciasInstaladas':False,'GPUModeloExecutados':False}
    try:
        with zipfile.ZipFile(io.BytesIO(bruto)) as z:
            infos=[i for i in z.infolist() if not i.is_dir()]
            if sum(i.file_size for i in infos)>32*1024*1024:raise ValueError('Orçamento descomprimido excedido.')
            nomes=[i.filename for i in infos]
            if len(nomes)!=len(set(nomes)):raise ValueError('Caminho repetido no wheel.')
            for i in infos:
                caminho=PurePosixPath(i.filename)
                if caminho.is_absolute() or '..' in caminho.parts or caminho.parts[0] not in ('outlines_core',DIST) or stat.S_ISLNK(i.external_attr>>16):raise ValueError('Caminho não autorizado no wheel.')
                if (site/Path(*caminho.parts)).exists():raise ValueError('Arquivo de destino já existe.')
            wheel=z.read(DIST+'/WHEEL').decode()
            if 'Tag: cp314-cp314-macosx_14_0_arm64' not in wheel:raise ValueError('Tag inesperada.')
            record=DIST+'/RECORD';linhas=list(csv.reader(io.StringIO(z.read(record).decode())))
            registros={r[0]:r for r in linhas}
            if len(registros)!=len(linhas) or set(registros)!=set(nomes):raise ValueError('Inventário RECORD difere do wheel.')
            for nome,alg,tamanho in linhas:
                data=z.read(nome)
                if nome==record:
                    if alg or tamanho:raise ValueError('RECORD próprio inesperado.')
                elif alg!='sha256='+digest(data) or tamanho!=str(len(data)):raise ValueError('Integridade individual divergente: '+nome)
            for i in infos:
                if i.filename==record:continue
                q=site/Path(*PurePosixPath(i.filename).parts);q.parent.mkdir(parents=True,exist_ok=True)
                with q.open('xb') as out:out.write(z.read(i.filename))
                criados.append(q)
            extras={DIST+'/INSTALLER':b'local-verified-wheel\n',DIST+'/direct_url.json':(json.dumps({'url':a.wheel.resolve().as_uri(),'archive_info':{'hashes':{'sha256':SHA}}},separators=(',',':'))+'\n').encode()}
            for nome,data in extras.items():
                q=site/nome
                with q.open('xb') as out:out.write(data)
                criados.append(q);linhas.append([nome,'sha256='+digest(data),str(len(data))])
            q=site/record;buf=io.StringIO(newline='');writer=csv.writer(buf,lineterminator='\n');writer.writerows(linhas)
            with q.open('x',newline='') as out:out.write(buf.getvalue())
            criados.append(q)
        depois=sorted(q.name for q in site.glob('*.dist-info'))
        intactos=all(hashlib.sha256(Path(q).read_bytes()).hexdigest()==h for q,h in protegidos.items())
        if set(depois)-set(antes)!={DIST} or set(antes)-set(depois) or not intactos:raise ValueError('Mudança fora do pacote autorizado.')
        recibo.update(estado='instalado',pacote='outlines_core',versao='0.2.14',adicionadas=[DIST],removidas=[],protegidosIntactos=True,arquivos=[{'arquivo':str(q),'sha256':hashlib.sha256(q.read_bytes()).hexdigest()} for q in criados])
    except BaseException as erro:
        for q in reversed(criados):q.unlink(missing_ok=True)
        for top in (site/'outlines_core',site/DIST):
            if top.exists():
                for q in sorted((q for q in top.rglob('*') if q.is_dir()),key=lambda q:len(q.parts),reverse=True):
                    try:q.rmdir()
                    except OSError:pass
                try:top.rmdir()
                except OSError:pass
        recibo.update(estado='falhou_rollback_arquivos_criados',erro=type(erro).__name__+': '+str(erro))
        raise
    finally:
        recibo['fim']=datetime.now(timezone.utc).isoformat()
        with a.recibo.open('x') as out:json.dump(recibo,out,ensure_ascii=False,indent=2);out.write('\n')
    print(json.dumps({k:recibo[k] for k in ('estado','pacote','versao','protegidosIntactos')},ensure_ascii=False))

if __name__=='__main__':main()
