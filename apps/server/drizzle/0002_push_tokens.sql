CREATE TABLE "push_tokens" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"token" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;