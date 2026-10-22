CREATE TABLE "device_log" (
	"family_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"entry" jsonb NOT NULL,
	CONSTRAINT "device_log_family_id_index_pk" PRIMARY KEY("family_id","index")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"sign_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "families" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"current_epoch" integer DEFAULT 1 NOT NULL,
	"recovery_sign_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "families_recovery_sign_key_unique" UNIQUE("recovery_sign_key")
);
--> statement-breakpoint
CREATE TABLE "family_keys" (
	"family_id" uuid NOT NULL,
	"epoch" integer NOT NULL,
	"recipient" text NOT NULL,
	"sealed" text NOT NULL,
	CONSTRAINT "family_keys_family_id_epoch_recipient_pk" PRIMARY KEY("family_id","epoch","recipient")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"claim_hash" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"claimant" jsonb,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"family_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"epoch" integer NOT NULL,
	"updated_at" bigint NOT NULL,
	"device_id" uuid NOT NULL,
	"deleted" boolean NOT NULL,
	"data" text,
	"seq" bigint NOT NULL,
	CONSTRAINT "records_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_log" ADD CONSTRAINT "device_log_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_keys" ADD CONSTRAINT "family_keys_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "records_family_seq_idx" ON "records" USING btree ("family_id","seq");