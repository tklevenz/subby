ALTER TABLE "families" ADD COLUMN "restore_gen" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "restored_seq" bigint;