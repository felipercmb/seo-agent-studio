# Resultado do primeiro piloto

**O modelo foi efetivamente ajustado, mas não foi aprovado para orientar clientes de forma autônoma.** A conclusão vem do teste reservado, executado depois de fixar dados e configuração. Não houve seleção de hiperparâmetros a partir dessas respostas.

Foi usado Qwen2.5-1.5B-Instruct em quatro bits, com adaptadores QLoRA de rank oito em oito camadas. O treinamento modificou aproximadamente 311 mil parâmetros durante 120 passos e levou **188,57 segundos** no Apple M4 com 16 GiB de RAM. Os pesos resultantes ficaram no computador, fora do Git; o código permite reproduzir o processo.

| Critério mecânico | Modelo-base | Após treino |
| --- | ---: | ---: |
| JSON como objeto válido | 15/16 | 11/16 |
| Contrato completo válido | 0/16 | 9/16 |
| Ação editorial esperada | 0/16 | 8/16 |
| Prioridade esperada | 0/16 | 9/16 |
| Referências esperadas | 0/16 | 7/16 |
| Limitação de retorno detectada por palavras | 0/16 | 9/16 |
| Todos os critérios acima simultaneamente | 0/16 | **3/16** |

O ajuste melhorou a adesão a alguns campos e escolhas do contrato, mas **piorou a validade do JSON**. Há respostas com aspas não escapadas, listas malformadas, referências inadequadas e ações que divergem dos alvos. Essas falhas impedem tratar o piloto como recomendador confiável. O validador recusa falhas de formato, mas não detecta todos os erros de conteúdo.

Os dois modelos receberam o mesmo prompt, casos, limite de geração e temperatura zero. O resultado do modelo-base vale para este contrato e esta instrução; não é uma avaliação geral da capacidade do Qwen. O detector de limitação financeira é lexical e não demonstra compreensão. Os alvos também são decisões sintéticas da mesma autoria, sem validação especializada.

A perda de validação foi 2,419 no começo, 1,400 no passo quarenta, 1,277 no passo oitenta e 1,421 no final. A piora final é um sinal para investigar sobreajuste; não autoriza selecionar um novo modelo usando o teste já observado. Os casos de treino incluem 24 famílias com quatro variações cada, enquanto validação e teste têm dezesseis composições reservadas cada.

## Evidência reproduzível

- [Respostas e métricas do modelo-base](base-teste.json).
- [Respostas e métricas do modelo ajustado](treinado-teste.json).
- [Comparação completa](comparacao.json).
- [Configuração executada, dependências e hashes](treino-resumo.json).
- [Dados e divisão congelada](../../dados/manifest.json).
- [Como reproduzir ou preparar outro experimento](../../../docs/TREINAR-IA.md).

Todas as respostas publicadas aqui pertencem a casos fictícios. O hash do adaptador é `a931686f5a1bc1c293badaea8e04df467882a2c9ec7052b42f00960288bed6b8`.

Um próximo experimento deve usar diversidade maior e revisão especializada, escolher ajustes pela validação e reservar **um novo teste** antes de treinar. Este conjunto já foi observado e não deve ser apresentado como teste inédito em uma próxima rodada. Não foram medidos ganhos reais de posição, tráfego ou receita.
