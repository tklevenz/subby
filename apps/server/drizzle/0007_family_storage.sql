ALTER TABLE "families" ADD COLUMN "record_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "data_bytes" bigint DEFAULT 0 NOT NULL;