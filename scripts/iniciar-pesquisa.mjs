import {criarServidor} from '../server.mjs';

let servidor;
try{
  servidor=await criarServidor({habilitarProposicoes:true});
  console.log('Comparação experimental local: '+servidor.endereco+'/projeto');
  console.log('A leitura por atividade é opcional e requer revisão. Abrir esta página não inicia inferência, treinamento ou consulta de posições.');
  for(const sinal of ['SIGINT','SIGTERM'])process.once(sinal,()=>{servidor.fechar().catch(()=>{process.exitCode=1;});});
}catch(e){
  if(e?.code==='EADDRINUSE')console.error('A porta local já está em uso. Encerre o servidor anterior ou informe outra PORT antes de iniciar a comparação.');
  else console.error('Não foi possível iniciar a comparação experimental local. Confira a instalação com npm run diagnosticar.');
  process.exitCode=1;
}
