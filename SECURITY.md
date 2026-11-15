# Segurança

O uso padrão de Visibilidade Aberta é local. O servidor escuta somente em `127.0.0.1` e não oferece uma configuração de `HOST` para exposição pública. Compartilhar uma porta por túnel ou alterar esse comportamento exige uma revisão própria de acesso, limites e proteção do serviço.

## Relatar uma vulnerabilidade

Não publique chaves, bancos, relatórios privados ou detalhes de exploração em uma issue pública.

Abra a aba **Security** do repositório. **Se a opção de relato privado de vulnerabilidade estiver habilitada**, use-a para contatar os mantenedores. Se não estiver disponível, peça apenas um canal privado de contato, sem publicar a vulnerabilidade ou dados sensíveis. O projeto não anuncia um e-mail de segurança ou prazo de resposta garantido.

Ao obter um canal privado, inclua a versão ou commit afetado, os passos mínimos de reprodução, o impacto observado e uma demonstração sanitizada. Prefira um servidor controlado por você e credenciais fictícias. Não teste contra terceiros sem autorização.

## Chaves e dados locais

`SERPAPI_KEY` é um segredo do operador. Guarde-a no ambiente ou em `.env`; não a envie em screenshots, URLs públicas, issues ou pull requests. Caso uma chave seja exposta, revogue-a no fornecedor e substitua a configuração local.

O banco `data/visibilidade.sqlite` guarda progresso, resultados estruturados e contadores de uso. Os relatórios de ranking e diagnóstico usados pelo agente, incluindo trechos de evidências, ficam disponíveis por até sete dias; o HTML integral não é persistido. Esses registros podem revelar quais sites você analisou. Trate o banco e suas cópias como dados locais que não devem ser publicados por padrão.

Executar no seu computador não torna a coleta offline. O domínio consultado pode ser enviado aos serviços DNS Google/Cloudflare e ao resolvedor do sistema. O site recebe requisições de leitura; a SerpApi, quando ativada, recebe os termos, o contexto da busca e a chave para autenticação. Os provedores podem registrar essas requisições conforme suas próprias políticas.

A expiração lógica de uma captura ou do progresso não é uma garantia de eliminação segura do conteúdo do disco. O histórico de comparação do diagnóstico também pode permanecer no armazenamento do navegador até ser apagado.

## Controles e limites

O coletor limita domínios, redirecionamentos, tempo e tamanho das respostas; respeita `robots.txt` e não executa scripts ou envia formulários. No transporte local, os endereços são resolvidos e verificados antes da conexão; a conexão usa o IP público aprovado, preservando o nome do servidor para TLS. Isso evita que uma segunda resolução DNS altere silenciosamente o destino da conexão.

Esses controles reduzem riscos, mas não equivalem a uma auditoria completa de segurança. Não remova a validação de IPs privados, de TLS ou de redirecionamentos para fazer um site específico funcionar. Um bloqueio de coleta deve aparecer como indisponibilidade, sem inventar defeitos no site.

Os limites locais de consumo dependem do SQLite desta instalação. Eles não controlam outros programas ou computadores que utilizem a mesma chave. O padrão recusa planos pagos e créditos extras; mudanças nesse comportamento precisam ser explícitas e revisadas.

O agente aceita apenas o domínio na API e usa relatórios produzidos pelo servidor. Ele não executa instruções encontradas no site, não usa modelos de linguagem, não faz novas chamadas de coleta e não aplica mudanças no site ou em anúncios. Recomendações são hipóteses para avaliação humana; posição não determina receita ou causa do ranking.

## Atualizações

Use uma versão corrigida do Node.js e mantenha as dependências atualizadas. Ao relatar problemas, informe a versão utilizada. Não há compromisso publicado de manutenção de versões antigas.
