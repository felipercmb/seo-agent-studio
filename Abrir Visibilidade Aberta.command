#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print -u2 'Instale Node.js 22.13+ da série 22, ou Node.js 24, e abra novamente.'
  exit 1
fi
exec node server.mjs
