# Abrir o Visibilidade Aberta

Extraia o ZIP e abra um terminal na pasta extraída. Use Node.js 22 a partir de 22.13, ou Node.js 24.

```sh
npm start
```

No Mac, você também pode abrir **Abrir Visibilidade Aberta.command**. Acesse [a análise local](http://127.0.0.1:8794/projeto) enquanto o servidor estiver aberto. O ZIP já contém as dependências do aplicativo. Use `npm run diagnosticar` se a análise não iniciar.

Se a porta 8794 estiver em uso, rode `PORT=0 npm start` e abra o endereço exibido pelo aplicativo. Para comparar duas instalações abertas ao mesmo tempo, use uma pasta de dados própria para cada uma.

Informe um site, confira as ofertas e confirme o perfil antes de escolher uma tarefa. A leitura de páginas públicas usa internet. O banco de trabalho é criado na pasta `data/` na primeira execução. Para levar uma análise a outra instalação, feche o servidor e copie a pasta de dados do projeto, incluindo o SQLite e os arquivos de captura. Guarde a cópia separadamente do ZIP.

O fluxo de análise assistida funciona sem conta, chave ou pesos da IA. Para registrar uma busca que você abriu no navegador, use [o coletor local](http://127.0.0.1:8794/google-local). Para saber o que a captura sustenta, confira a consulta e a data junto da tarefa. Leia o [guia completo](docs/USO-LOCAL-INTEGRADO.md).

Para verificar o código do pacote, execute `npm run check`, `npm test` e, se tiver Python instalado, `python3 -m unittest discover -s ia -p 'test_*.py'`. O ZIP inclui exemplos sintéticos e o manifesto SHA-256. Testes com MLX e tokenizador requerem o ambiente opcional de IA descrito no [guia de treino](docs/TREINAR-IA.md).
