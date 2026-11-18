Experimento isolado de perda por blocos para o caminho textual Qwen3.5. Não altera o mlx-lm instalado e só participa do treino se o chamador fornecer explicitamente `loss=...`.

No CLI local de treino, a ativação é optativa: acrescentar `--perda-blocos 128` (ou64) a `ia/negocio/treinar.py`, com `--modelo-base qwen35-4b` e os caminhos obrigatórios de dados, configuração e saída nova. `--perda-blocos 0` mantém a perda padrão e é o valor inicial. O bootstrap passa a perda explicitamente a train/evaluate sem editar a biblioteca instalada. O helper e sua configuração ficam na cápsula/recibo do experimento; não muda automaticamente o adaptador usado pelo produto.

`perda_qwen35_em_blocos(model, batch, lengths, bloco=128, checkpoint=True)` mantém o backbone completo e divide a projeção para o vocabulário e a cross-entropy em fatias estáticas. Cada bloco usa checkpoint com os parâmetros do módulo de projeção e stop-gradient nos índices/máscara. Assim, o backward pode recomputar a projeção em vez de manter todos os logits da sequência. O ganho de memória real depende do compilador, device e modelo e precisa de medição pelo ensaio GPU; a equivalência CPU não demonstra um limite de RAM.

Não se selecionam posições por `lengths.item()` dentro de `mx.compile`. O comprimento de cada fatia vem da forma estática do batch; a máscara continua tensor. O objetivo é o mesmo do `default_loss` instalado no mlx-lm0.32.2, com diferenças possíveis apenas pela ordem das somas e pela aritmética do device. Por compatibilidade, a máscara `steps <= lengths[:,1]` também preserva o primeiro alvo de padding que o iterador pode acrescentar após o EOS. Corrigir esse limite exigiria um experimento separado e novos recibos.

O teste CPU passou em 9/9 casos: head treinável, head congelado, head quantizado4bit, embedding compartilhado treinável e quantizado4bit, gradientes do backbone, vários tamanhos de bloco, compilação com valores diferentes de lengths e conservação da máscara. Os gradientes e a perda foram comparados ao `default_loss` real instalado com tolerância float32 de2e-6. O toy tem contexto causal para que o teste inclua a influência do prompt; nenhum peso real ou GPU foi usado.

```sh
.venv-ia/bin/python ia/negocio/treino_memoria/test_perda_em_blocos_cpu.py
```

O helper recusa sharding/pipeline distribuído. Não suporta automaticamente famílias com soft-capping, escala adicional ou outras transformações após o head. Não corta o prompt antes da atenção, não interrompe gradientes do hidden state e não muda o token alvo. O ensaio não mede precisão, utilidade U1–U4 ou resultados comerciais.

No bootstrap, passar o helper como argumento `loss` ao `train` é necessário: atribuir outra função a `trainer.default_loss` não altera o valor já ligado no argumento padrão. A integração optativa deve registrar o SHA do helper, tamanho do bloco, checkpoint e convenção da máscara. Os recibos CPU são aditivos em `data/experimentos-modulares/rodada-treino-negocio-7h-20261116-031117/treino-memoria/`; o primeiro ensaio falho foi preservado, a versão3 inclui o head quantizado e a versão4 também o embedding compartilhado quantizado.
