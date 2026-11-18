# Limites numéricos ligados à oferta e à fonte

`src/modulos/condicoes-estruturadas.mjs` contém funções puras para extrair alguns limites inteiros explícitos e conferir se uma recomendação ampliaria esses limites. Não consulta rede, executa modelo, lê arquivos nem modifica o agente experimental congelado.

## Extração

```js
import {extrairCondicoesEstruturadas, verificarCompatibilidade} from './src/modulos/condicoes-estruturadas.mjs';

const resultado = extrairCondicoesEstruturadas({
  ofertaId: 'oferta_1',
  dominio: 'empresa.com.br', // opcional; exige o mesmo domínio normalizado
  fontes: [{
    id: 'fonte_1',
    texto: 'Plano Amplo: entre 81 e 200 itens.',
    url: 'https://empresa.com.br/plano',
    sha256: 'a'.repeat(64), // exemplo de formato; usar o hash real da captura
    coletadoEm: '2026-11-16T10:00:00.000Z',
  }],
  escopo: {
    id: 'capacidade_plano_amplo',
    descricao: 'Capacidade de itens do plano Amplo',
    confirmado: true, // só após revisão do objeto e da fonte pelo responsável
  },
});
```

Cada fonte deve ser **um segmento contínuo da captura**. A função não junta fontes para completar uma frase. Aceita até 64 fontes com 6.000 caracteres cada, IDs distintos, URL pública HTTP(S), SHA-256 em hexadecimal minúsculo e instante UTC válido. A verificação é de formato/procedência fornecida: **não autentica o hash contra o documento original**. Quem monta as fontes deve fazer essa conferência e preservar a captura. Com `dominio`, não são aceitas fontes de outro domínio; `www` é normalizado pelo mesmo validador do produto. Subdomínios distintos não são aceitos silenciosamente.

Sem `escopo`, a saída tem `escopoId:null`, `escopoDescricao:null` e `escopoConfirmado:false`. Um modelo não deve preencher confirmação automática. A ligação entre oferta, objeto e trecho precisa de revisão; a presença de um número não prova esse vínculo.

Retorno:

- `condicoes`: limites candidatos com `fonteId`, `url`, `sha256`, `coletadoEm`, `ofertaId`, `unidade`, `minimo`, `maximo`, `fraseLiteral`, offsets `inicio`/`fim`, padrão reconhecido e escopo;
- `naoInterpretadas`: regras recusadas ou números que não couberam nos padrões, com trecho/offset/motivo; trechos informativos são limitados a 600 caracteres;
- `limites`: advertências específicas sobre cobertura, escopo, vigência e significado.

`fraseLiteral` é exatamente `fonte.texto.slice(inicio, fim)`. Os offsets são índices JavaScript do texto original, inclusive quando há caracteres como emoji antes da frase. `coletadoEm` é normalizado para UTC com milissegundos. Todas as condições têm `interpretacao:'limite_numerico_candidato'` e `vigenciaConfirmada:false`.

## Padrões suportados

| Frase | Mínimo inclusivo | Máximo inclusivo |
|---|---:|---:|
| até10 usuários / no máximo 10 usuários | não publicado | 10 |
| de11a30 usuários / de 11 até 30 usuários | 11 | 30 |
| entre81e200 itens | 81 | 200 |
| mais de80 e até200 documentos | 81 | 200 |
| mais de80 documentos | 81 | não publicado |

As unidades são: `usuarios`, `itens`, `documentos`, `assinaturas`, `colaboradores`, `produtos`, `projetos`, `arquivos`, `sites`, `paginas`, `licencas`, `contatos`, `kg`. Singular/plural e acentos conhecidos são normalizados, mas unidades diferentes não são equivalentes. “Assinatura” não vira usuário, assinatura digital ou contrato por inferência.

Peso em `kg`, “quilos” ou “quilogramas” aceita limites fechados explicitamente publicados como inteiros. Não há conversão de gramas ou outras unidades, nem arredondamento de valores decimais. “Mais de 10 kg” fica sem interpretação: não vira mínimo 11 kg, pois 10,5 kg também supera 10 kg. Casos como 50 kg/51 kg verificam apenas o teto publicado e não aprovam envio, modalidade ou demais condições.

O parser é deliberadamente limitado. Duração (“30 dias de teste”), taxa (“10 documentos/mês”), restrição por usuário, decimais, milhares pontuados, condições compostas, negações, alternativas e unidades qualificadas (“usuários ativos”) são recusadas ou ficam em `naoInterpretadas`. Isso não é um parser geral de contratos. A análise cobre apenas o segmento recebido; outras restrições, exceções ou informação histórica podem existir fora dele.

## Comparação

```js
const publicada = resultado.condicoes[0];
const ampliada = {...publicada, minimo: 81, maximo: null};
verificarCompatibilidade(publicada, ampliada);
// compativel:false; erros:['limite_superior_omitido']; contraexemplos:[201]

verificarCompatibilidade(publicada, {...publicada, minimo: 300, maximo: 400});
// compativel:false; contraexemplos:[300]

verificarCompatibilidade(publicada, {...publicada, minimo: 100, maximo: 180});
// compativel:true; elegibilidadeConfirmada:false; vigenciaConfirmada:false
```

Os dois objetos precisam ter os mesmos `ofertaId`, unidade, `escopoId`, descrição do escopo, fonte, URL, hash e data, com escopo confirmado nos dois. Uma troca ou ausência de confirmação bloqueia a comparação. Essa regra impede comparar uma condição de uma oferta/programa com outra só porque os números coincidem.

Os campos `minimo` e `maximo` aceitam inteiros não negativos seguros ou `null`. Um intervalo invertido, `boolean`, decimal, `NaN`, infinito ou ambos os limites desconhecidos é inválido. Os marcadores `minimoPublicado`/`maximoPublicado` pertencem ao objeto publicado; quando presentes, precisam coincidir com ele. Não certificam o texto de uma recomendação.

**`null` significa limite não publicado, nunca infinito ou zero implícito.** Para “até 10 usuários”, manter o mesmo teto permite `compativel_nos_limites_publicados`, com `limitesNaoPublicados:['minimo']`. Acrescentar mínimo 0 sem uma fonte que o publique é recusado como `minimo_sem_base_publicada`. Omitir um limite que estava publicado também é recusado. As testemunhas são valores que satisfazem as restrições explícitas da recomendação e violam um limite publicado; não afirmam elegibilidade real do usuário.

Um resultado compatível só descreve os limites numéricos recebidos. Não aprova negócio, extração original, fluxo, validade atual, venda, lucro nem todas as condições contratuais. A interface deve preservar o trecho e os avisos e usar somente objetos/fonte/escopo revisados.

## Verificação

```sh
node --test test/condicoes-estruturadas.test.mjs
```

Os testes incluem fronteiras 80/81/200/201, disjuntas 300..400, subfaixas, todas as trocas entre as 13 unidades, metadados, domínio/escopo, duração/taxa, negação, limites inválidos, fontes separadas, offsets e comparação exaustiva de faixas pequenas contra inclusão por enumeração. Não alteram resultados de modelos ou a reserva de empresas.
