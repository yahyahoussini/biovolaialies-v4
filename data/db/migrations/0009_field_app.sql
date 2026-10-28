CREATE TABLE `field_discrepancies` (
	`id` text PRIMARY KEY NOT NULL,
	`day_key` text NOT NULL,
	`lot_id` text NOT NULL,
	`day` text NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`opened_at` text NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`resolved_count` integer,
	`resolution_note` text,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_discrepancies_day_key_unique` ON `field_discrepancies` (`day_key`);--> statement-breakpoint
CREATE INDEX `field_discrepancies_lot_idx` ON `field_discrepancies` (`lot_id`,`status`);--> statement-breakpoint
CREATE TABLE `field_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`op_id` text NOT NULL,
	`device_id` text NOT NULL,
	`device_seq` integer NOT NULL,
	`author_id` text NOT NULL,
	`kind` text NOT NULL,
	`lot_id` text,
	`transfer_id` text,
	`payload` text NOT NULL,
	`captured_at` text NOT NULL,
	`received_at` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`result_type` text,
	`result_id` text,
	`day_key` text,
	`applied_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_entries_op_id_unique` ON `field_entries` (`op_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `field_entries_device_seq_idx` ON `field_entries` (`device_id`,`device_seq`);--> statement-breakpoint
CREATE INDEX `field_entries_day_idx` ON `field_entries` (`day_key`);--> statement-breakpoint
CREATE INDEX `field_entries_author_idx` ON `field_entries` (`author_id`,`received_at`);