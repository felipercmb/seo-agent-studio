Este crítico é um experimento separado do agente de recomendações. Recebe fontes e uma proposta que já satisfaz o contrato mecânico e procura inconsistências semânticas delimitadas. Não executa ações nem aprova clientes.

`manter` significa que uma inconsistência das seis categorias não foi evidenciada. Não certifica verdade, utilidade, completude ou resultado. `revisar` exige um trecho literal de um único campo da proposta, fontes existentes e explicação. A validação dessas referências não prova que a crítica esteja correta.

O corpus autoral tem 12 famílias com um par consistente/falho em cada uma. Uma única folha muda por par. Seis famílias ficam em treino e seis em validação; cada categoria tem uma família em cada divisão. São 24 casos dependentes de 12 famílias, sem documentos reais, VAL real ou TEST. Os metadados de variante, mutação, tipo esperado, grupo e rótulo nunca entram no prompt.

Os positivos incluem palavras que não bastam para bloquear uma proposta: conferir uma regra antes da compra cujo prazo começa após a aquisição; não transferir saldo durante simulação; atribuir um retorno anunciado à fonte e dizer que não foi observado. Avaliar relações e escopos, não presença de palavras.

Gerar novo artefato local: `node ia/negocio/critico/montar-controles.mjs --saida ARQUIVO_NOVO`. O comando recusa substituição. Testes: `node --test ia/negocio/critico/test-contrato.mjs`. Nenhum modelo ou treino é chamado.

Antes de treinar, exigir revisão técnica cruzada dos rótulos; revisão humana continua pendente. Medir falsos positivos nos casos `manter`, falsos negativos nos `revisar`, acerto por tipo e por família, e recusas de contrato separadas. Não substituir os resultados históricos de recomendações pelos resultados deste crítico.
