CREATE TABLE "gate_notes" (
	"id" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
INSERT INTO "gate_notes" ("id", "title") VALUES (1, 'first note');
