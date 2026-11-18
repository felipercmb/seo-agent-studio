-- Perfis e cenários declarados ficam apenas na instalação local.
-- Um registro contém o estado e até 24 eventos, gravados por revisão atômica.
CREATE TABLE projetos_modulares (
  dominio TEXT PRIMARY KEY NOT NULL,
  revisao INTEGER NOT NULL CHECK (revisao > 0),
  atualizado_em TEXT NOT NULL,
  payload TEXT NOT NULL
);
