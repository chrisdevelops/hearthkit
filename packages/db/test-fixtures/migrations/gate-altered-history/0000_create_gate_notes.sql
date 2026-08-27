CREATE TABLE "gate_notes" (
	"id" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"edited_after_it_was_applied" text
);
--> statement-breakpoint
INSERT INTO "gate_notes" ("id", "title") VALUES (1, 'first note');
