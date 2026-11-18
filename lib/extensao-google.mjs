import {readFile} from 'node:fs/promises';
const NOMES=['manifest.json','popup.html','popup.mjs','capturar.mjs'];
function crc32(b){let c=0xffffffff;for(const byte of b){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
/** ZIP STORE com quatro assets locais fixos. Não inclui dados, chaves ou código da IA. */
export async function criarPacoteExtensaoGoogle(){
  const locais=[],centrais=[];let offset=0;
  for(const nome of NOMES){
    const data=await readFile(new URL('../extensoes/google-local/'+nome,import.meta.url)),n=Buffer.from(nome),crc=crc32(data);
    if(data.length>65536)throw Error('Asset da extensão acima do limite.');
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0800,8);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(n.length,28);central.writeUInt32LE(offset,42);
    locais.push(local,n,data);centrais.push(central,n);offset+=local.length+n.length+data.length;
  }
  const indice=Buffer.concat(centrais),fim=Buffer.alloc(22);fim.writeUInt32LE(0x06054b50,0);fim.writeUInt16LE(NOMES.length,8);fim.writeUInt16LE(NOMES.length,10);fim.writeUInt32LE(indice.length,12);fim.writeUInt32LE(offset,16);
  return Buffer.concat([...locais,indice,fim]);
}
