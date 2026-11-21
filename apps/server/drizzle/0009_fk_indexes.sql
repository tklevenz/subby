CREATE INDEX "devices_family_idx" ON "devices" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "invites_family_idx" ON "invites" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "invites_expires_idx" ON "invites" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "push_tokens_family_idx" ON "push_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "sessions_family_device_idx" ON "sessions" USING btree ("family_id","device_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");