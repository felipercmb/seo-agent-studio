"""CPU tests of continuation provenance; no model training or quality claim."""
from copy import deepcopy
import hashlib,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from negocio.ensaios_continuar import preparar_config

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

class ContinuarTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.r=Path(self.temp.name);self.origin=self.r/'origem';self.origin.mkdir();self.corpus=self.r/'corpus';self.corpus.mkdir();self.out=self.r/'saida';self.proto=self.r/'protocolo.py';self.proto.write_text('protocolo de teste');self.spec=SimpleNamespace(PROTOCOLO=self.proto)
        (self.origin/'adapters.safetensors').write_bytes(b'fixture, nao pesos reais');(self.origin/'adapter_config.json').write_text('{}');(self.corpus/'manifesto.json').write_text('{}')
        self.receipt={'estado':'concluido','novoAjustePesos':True,'codigoMudouDuranteExecucao':False,'protocoloSha256':sha(self.proto),'adaptadorSha256':sha(self.origin/'adapters.safetensors'),'configAdaptadorSha256':sha(self.origin/'adapter_config.json'),'modeloBase':'qwen35-4b','corpusManifestoSha256':sha(self.corpus/'manifesto.json'),'config':{'model':'/modelo/local','num_layers':1,'lora_parameters':{'keys':['self_attn.q_proj','self_attn.v_proj'],'rank':32},'data':'/dados/anteriores','iters':320,'seed':42}}
        self.save()
    def save(self):(self.origin/'treino.json').write_text(json.dumps(self.receipt))
    def call(self,steps=400):return preparar_config(self.origin,self.corpus,self.out,steps,self.spec)
    def test_continues_weights_with_identical_lora_shape_and_new_paths(self):
        before=deepcopy(self.receipt);cfg,old=self.call();self.assertEqual(cfg['lora_parameters'],before['config']['lora_parameters']);self.assertEqual(cfg['iters'],400);self.assertEqual(cfg['resume_adapter_file'],str((self.out/'adaptador-inicial.safetensors').resolve()));self.assertEqual(cfg['data'],str((self.out/'dados').resolve()));self.assertEqual(old,before);self.assertEqual(json.loads((self.origin/'treino.json').read_text()),before);self.assertFalse(self.out.exists())
    def test_different_corpus_is_rejected(self):
        (self.corpus/'manifesto.json').write_text('{"mudou":true}')
        with self.assertRaisesRegex(ValueError,'mesmo modelo-base e corpus'):self.call()
    def test_corrupted_initial_weights_are_rejected(self):
        (self.origin/'adapters.safetensors').write_bytes(b'outro')
        with self.assertRaisesRegex(ValueError,'Adaptador alterado'):self.call()
    def test_running_or_code_drift_source_is_rejected(self):
        for key,value in [('estado','em_treino'),('codigoMudouDuranteExecucao',True)]:
            before=self.receipt[key];self.receipt[key]=value;self.save()
            with self.assertRaisesRegex(ValueError,'proveniência'):self.call()
            self.receipt[key]=before
    def test_unexercised_linear_attention_shape_is_rejected(self):
        self.receipt['config']['num_layers']=4;self.save()
        with self.assertRaisesRegex(ValueError,'configuração de memória'):self.call()
    def test_bounded_steps(self):
        for n in [0,401,True]:
            with self.assertRaisesRegex(ValueError,'400passos'):self.call(n)

if __name__=='__main__':unittest.main()
