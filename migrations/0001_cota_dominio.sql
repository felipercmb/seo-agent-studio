ALTER TABLE rank_creditos ADD COLUMN dominio TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX rank_creditos_dominio_tempo ON rank_creditos(dominio, criado_em);
