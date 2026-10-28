CREATE TABLE `auth_events` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`outcome` text NOT NULL,
	`client_hash` text,
	`user_agent` text,
	`detail` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_events_email_idx` ON `auth_events` (`email`,`at`);--> statement-breakpoint
CREATE INDEX `auth_events_client_idx` ON `auth_events` (`client_hash`,`at`);--> statement-breakpoint
CREATE INDEX `auth_events_at_idx` ON `auth_events` (`at`);--> statement-breakpoint
CREATE TABLE `export_records` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset` text NOT NULL,
	`filename` text NOT NULL,
	`filters` text NOT NULL,
	`rows` integer NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `export_records_sha_idx` ON `export_records` (`sha256`);--> statement-breakpoint
CREATE INDEX `export_records_created_idx` ON `export_records` (`created_at`);