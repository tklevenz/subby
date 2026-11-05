CREATE TABLE "purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"store" text NOT NULL,
	"kind" text NOT NULL,
	"device_id" uuid NOT NULL,
	"family_id" uuid,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "added_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchases_device_idx" ON "purchases" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "purchases_family_idx" ON "purchases" USING btree ("family_id");