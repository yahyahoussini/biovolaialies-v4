CREATE TABLE `machine_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`building_id` text NOT NULL,
	`zone_id` text NOT NULL,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`encoding` text NOT NULL,
	`profile` text NOT NULL,
	`data_status` text NOT NULL,
	`lines` integer NOT NULL,
	`accepted` integer NOT NULL,
	`duplicates` integer NOT NULL,
	`rejected` integer NOT NULL,
	`flagged` integer NOT NULL,
	`errors` text NOT NULL,
	`from_at` text,
	`to_at` text,
	`imported_by` text NOT NULL,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`imported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `machine_imports_zone_idx` ON `machine_imports` (`zone_id`,`sha256`);