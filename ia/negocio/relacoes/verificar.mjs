import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {carregarCapturaLocal} from '../capturas.mjs';
import {prepararRelacoes} from './preparar.mjs';

const arquivo=process.argv[2];
const bytes=await readFile(arquivo),salvo=JSON.parse(bytes);
if(!salvo.captura?.arquivo)throw Error('Captura de origem necessária.');
const original=carregarCapturaLocal(salvo.captura.arquivo);
if(original.captura.sha256!==salvo.captura.sha256)throw Error('Captura alterada.');
const calculado=prepararRelacoes(original.coleta,{maxFontes:salvo.recuperacao.maxFontes,maxCaracteres:salvo.recuperacao.maxCaracteres});
for(const campo of ['pool','entrada','mapaIds','recuperacao'])
  if(JSON.stringify(calculado[campo])!==JSON.stringify(salvo[campo]))throw Error('Projeção contextual alterada: '+campo);
console.log(JSON.stringify({contextoSha256:createHash('sha256').update(bytes).digest('hex'),capturaSha256:original.captura.sha256,
  fontesConferidas:salvo.entrada.fontes.length,redeUsada:false}));
