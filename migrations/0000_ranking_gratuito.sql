CREATE TABLE rank_creditos (
  id TEXT PRIMARY KEY NOT NULL,
  mes TEXT NOT NULL,
  hora TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX rank_creditos_mes ON rank_creditos(mes);
--> statement-breakpoint
CREATE INDEX rank_creditos_hora ON rank_creditos(hora);
--> statement-breakpoint
CREATE INDEX rank_creditos_tempo ON rank_creditos(criado_em);
--> statement-breakpoint
CREATE TABLE rank_resultados (
  chave TEXT PRIMARY KEY NOT NULL,
  expira_em INTEGER NOT NULL,
  payload TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE rank_travas (
  chave TEXT PRIMARY KEY NOT NULL,
  token TEXT NOT NULL,
  expira_em INTEGER NOT NULL
);
