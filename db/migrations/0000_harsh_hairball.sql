CREATE TABLE IF NOT EXISTS "answer_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"context_id" integer NOT NULL,
	"answer_text" text NOT NULL,
	"embedding" "vector(1536)" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contexts" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "question_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"context_id" integer NOT NULL,
	"question_text" text NOT NULL,
	"embedding" "vector(1536)" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "answer_embeddings" ADD CONSTRAINT "answer_embeddings_context_id_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "contexts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "question_embeddings" ADD CONSTRAINT "question_embeddings_context_id_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "contexts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
