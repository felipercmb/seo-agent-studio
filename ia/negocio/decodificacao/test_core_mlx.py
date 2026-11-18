import json
import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from negocio.decodificacao.core_mlx import vocabulario_bytes,ProcessadorSerial,preparar_indice_json

class Decoder:
    def __init__(self,tipo="ByteLevel"):self.tipo=tipo
    def __getstate__(self):return json.dumps({"type":self.tipo})
class Backend:
    decoder=Decoder()
class Tokenizer:
    backend_tokenizer=Backend();eos_token_id=9;all_special_ids=[8,9]
    def get_vocab(self):return{"Ġ":1,"Ã":2,"©":3,"{":4,"}":5,"<think>":8,"<eos>":9}
class Vetor:
    def __init__(self,valores):self.valores=valores;self.shape=(len(valores),)
    def __len__(self):return len(self.valores)
    def __getitem__(self,i):return self.valores[i]
class Logits:
    shape=(1,10)
class Guia:
    def __init__(self):self.avancos=[]
    def accepts_tokens(self,tokens):return tokens==[4] if not self.avancos else tokens==[5]
    def advance(self,*,token_id,return_tokens):self.avancos.append(token_id)

class CoreMLXPrototypeTests(unittest.TestCase):
    def test_bytes_parciais_preservados_sem_replacement(self):
        eos,vocab,meta=vocabulario_bytes(Tokenizer())
        self.assertEqual(eos,9);self.assertEqual(vocab[b" "],[1])
        self.assertEqual(vocab[b"\xc3"],[2]);self.assertEqual(vocab[b"\xa9"],[3])
        self.assertNotIn(b"\xef\xbf\xbd",vocab);self.assertEqual(meta["maxTokenId"],9)
        self.assertFalse(any(8 in ids or 9 in ids for ids in vocab.values()))
    def test_sem_fallback_para_decoder_desconhecido(self):
        t=Tokenizer();t.backend_tokenizer=type("Outro",(),{"decoder":Decoder("Metaspace")})()
        with self.assertRaisesRegex(ValueError,"ByteLevel"):vocabulario_bytes(t)
    def test_prompt_nao_avanca_e_token_novo_avanca_uma_vez(self):
        guia=Guia();mascaras=[]
        p=ProcessadorSerial(guia,9,5,lambda n:[n],lambda g,m:mascaras.append(list(g.avancos)),lambda l,m:l)
        p(Vetor([90,91]),Logits());self.assertEqual(guia.avancos,[])
        p(Vetor([90,91,4]),Logits());self.assertEqual(guia.avancos,[4]);self.assertEqual(mascaras,[[],[4]])
        with self.assertRaisesRegex(ValueError,"repetido"):p(Vetor([90,91,4]),Logits())
    def test_token_fora_da_gramatica_falha_fechado(self):
        p=ProcessadorSerial(Guia(),9,5,lambda n:[],lambda g,m:None,lambda l,m:l)
        p(Vetor([90]),Logits())
        with self.assertRaisesRegex(ValueError,"não aceito"):p(Vetor([90,3]),Logits())
    def test_prefixo_e_speculacao_recusados_antes_import_opcional(self):
        for kwargs in ({"prefixo_json":True},{"draft_model":object()}):
            with self.assertRaisesRegex(ValueError,"serial"):preparar_indice_json({"type":"object"},Tokenizer(),**kwargs)

if __name__=="__main__":unittest.main()
