CREATE TABLE `children` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`birth_date` text NOT NULL,
	`birth_time` text,
	`due_date` text,
	`sex` text,
	`photo_uri` text,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`import_ref` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `children_import_ref_idx` ON `children` (`import_ref`);--> statement-breakpoint
CREATE TABLE `logs` (
	`id` text PRIMARY KEY NOT NULL,
	`child_id` text NOT NULL,
	`log_type` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`created_by` text,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`import_ref` text
);
--> statement-breakpoint
CREATE INDEX `child_started_idx` ON `logs` (`child_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `child_type_started_idx` ON `logs` (`child_id`,`log_type`,`started_at`);--> statement-breakpoint
CREATE INDEX `sync_status_idx` ON `logs` (`sync_status`);--> statement-breakpoint
CREATE UNIQUE INDEX `logs_import_ref_idx` ON `logs` (`import_ref`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`child_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`interval_min` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`notification_id` text,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`import_ref` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
