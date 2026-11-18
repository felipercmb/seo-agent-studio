"""Executor versionado por stdin; somente inferência local e saída JSON."""
import os,sys,json,time,hashlib,gc
from pathlib import Path
IA=Path(__file__).resolve().parents[2];sys.path.insert(0,str(IA))
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1')
from negocio.jornadas.contrato import validar_base,validar_ofertas,validar_jornada
from negocio.jornadas.protocolo import mensagens,esquema
from negocio.jornadas.recuperacao import recuperar_jornada,validar_reserva
from negocio.contrato import ler_json_estrito

def digest(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def recusar_duvidas_extensas(saida):
    """Recusa perguntas inteiras, sem reparar fatos, referências ou trechos.

    A resposta bruta permanece no artefato. Uma pergunta extensa não precisa
    invalidar ofertas independentes, que ainda passam pelo contrato completo.
    Outros defeitos de estrutura continuam recusados normalmente.
    """
    if not isinstance(saida,dict) or not isinstance(saida.get('duvidas'),list) or len(saida['duvidas'])>6:return saida,[]
    indices=[i for i,v in enumerate(saida['duvidas']) if isinstance(v,str) and len(v)>240]
    if not indices:return saida,[]
    duvidas=[v for i,v in enumerate(saida['duvidas']) if i not in indices]
    duvidas.append('Perguntas fora do limite foram recusadas por inteiro. Confirme com o responsável o escopo, os papéis e as condições que ainda faltam; nenhuma pergunta foi encurtada.')
    return {**saida,'duvidas':duvidas},[{'tipo':'duvida_recusada_comprimento','indice':i,'caracteres':len(saida['duvidas'][i])} for i in indices]

def gerar(modelo,tok,base,oferta=None):
    from negocio.decodificacao.core_mlx import preparar_indice_json,criar_processador_mlx
    from negocio.protocolo import prefixo_assistente
    from mlx_lm import stream_generate
    from mlx_lm.sample_utils import make_sampler
    ms=mensagens(base,oferta);prompt=prefixo_assistente(tok,ms)['prompt'];tokens=tok.encode(prompt,add_special_tokens=False)
    limite=1300 if oferta else 650
    identidade={'mensagensSha256':digest(ms),'promptSha256':hashlib.sha256(prompt.encode()).hexdigest(),'tokensSha256':digest(tokens),'tokensEntrada':len(tokens)}
    if len(tokens)+limite>8192:return {'estado':'nao_executada_orcamento','inferida':False,'saida':None,'identidade':identidade}
    inicio=time.monotonic();indice=preparar_indice_json(esquema(base,oferta),tok,limitar_comprimento_texto=False)
    processor=criar_processador_mlx(indice);partes=[];ultimo=None
    for ultimo in stream_generate(modelo,tok,prompt=prompt,max_tokens=limite,sampler=make_sampler(temp=0),logits_processors=[processor]):partes.append(ultimo.text)
    bruto=''.join(partes)
    ajustes=[]
    try:
        saida=ler_json_estrito(bruto);saida,ajustes=recusar_duvidas_extensas(saida);estado='gerada'
    except (ValueError,TypeError):saida=None;estado='recusada_json'
    return {'estado':estado,'inferida':True,'saida':saida,'textoBruto':bruto,'posProcessamento':ajustes,'identidade':identidade,'tokensGerados':ultimo.generation_tokens if ultimo else 0,'segundos':time.monotonic()-inicio,'fimGeracao':ultimo.finish_reason if ultimo else None}

def executar(base,max_ofertas=1,fontes_reserva=None,*,leitor=None):
    from negocio.runtime_negocio import carregar_leitor
    if validar_base(base):raise ValueError('Fontes de negócio inválidas.')
    validar_reserva(fontes_reserva,base['dominio'])
    codigo={str(p.relative_to(IA.parent)):hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')}
    if not base['fontes']:
        return {'versao':2,'estado':'sem_fontes','dominio':base['dominio'],'ofertas':[],'duvidas':['A captura não forneceu evidências elegíveis.'],'inferencias':[],'perfilConfirmado':False,'codigo':codigo}
    modelo,tok,meta=leitor if leitor is not None else carregar_leitor(modelo_base='qwen35-4b');chamadas=[]
    primeiro=gerar(modelo,tok,base);chamadas.append(primeiro);val=validar_ofertas(primeiro.get('saida'),base);ofertas=[]
    for o in val['ofertas'][:max_ofertas]:
        gc.collect()
        import mlx.core as mx
        mx.clear_cache()
        especifica,oferta_ancorada,recuperacao=recuperar_jornada(base,o,fontes_reserva)
        g=gerar(modelo,tok,especifica,oferta_ancorada);chamadas.append(g)
        jornada=validar_jornada(g.get('saida'),especifica,oferta_ancorada)
        jornada.update(fontesSelecionadas=especifica['fontes'],entradaSha256=digest(especifica),recuperacao=recuperacao)
        ofertas.append({**o,'jornada':jornada})
    avisos=['A identificação de ofertas foi recusada por formato ou campos incompatíveis. Isso não significa que o site não tenha ofertas; revise a leitura e o perfil.'] if val.get('erro') else val['duvidas']
    return {'versao':2,'estado':'revisao_necessaria' if ofertas else 'insuficiente','dominio':base['dominio'],
      'ofertas':ofertas,'ofertasIdentificadas':len(val['ofertas']),'ofertasAnalisadas':len(ofertas),
      'recusadas':val['recusadas'],'duvidas':avisos,'modelo':meta,'inferencias':chamadas,
      'entradaSha256':digest(base),'codigo':codigo,'perfilConfirmado':False,
      'limite':'Hipóteses com origem para confirmação. Nenhum perfil é confirmado nem verba é recomendada automaticamente.'}

def main():
    bruto=sys.stdin.buffer.read(1048577)
    if len(bruto)>1048576:raise ValueError('Entrada excede1MiB local.')
    def pares(valores):
        d={}
        for k,v in valores:
            if k in d:raise ValueError('Chave repetida no pedido.')
            d[k]=v
        return d
    def constante(v):raise ValueError('Constante JSON inválida.')
    dados=json.loads(bruto.decode('utf8'),object_pairs_hook=pares,parse_constant=constante)
    if not isinstance(dados,dict) or set(dados) not in ({'base','maxOfertas'},{'base','maxOfertas','fontesReserva'}) or type(dados['maxOfertas'])is not int or not 1<=dados['maxOfertas']<=3:raise ValueError('Pedido incompatível.')
    resultado=executar(dados['base'],dados['maxOfertas'],dados.get('fontesReserva'));print(json.dumps(resultado,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
