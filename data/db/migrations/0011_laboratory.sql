CREATE TABLE `lab_results` (
	`id` text PRIMARY KEY NOT NULL,
	`sample_id` text NOT NULL,
	`analyte` text NOT NULL,
	`method` text,
	`value` text NOT NULL,
	`numeric_value` real,
	`unit` text,
	`interpretation` text NOT NULL,
	`result_at` text NOT NULL,
	`report_ref` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`review_note` text,
	FOREIGN KEY (`sample_id`) REFERENCES `lab_samples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lab_results_sample_idx` ON `lab_results` (`sample_id`);--> statement-breakpoint
CREATE TABLE `lab_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`matrix` text NOT NULL,
	`reason` text NOT NULL,
	`observation_id` text,
	`sampled_at` text NOT NULL,
	`sampled_by` text NOT NULL,
	`sample_count` integer,
	`laboratory` text NOT NULL,
	`sent_at` text,
	`status` text NOT NULL,
	`notes` text,
	`data_status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `sanitary_observations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sampled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lab_samples_code_unique` ON `lab_samples` (`code`);--> statement-breakpoint
CREATE INDEX `lab_samples_object_idx` ON `lab_samples` (`object_type`,`object_id`);--> statement-breakpoint
CREATE INDEX `lab_samples_status_idx` ON `lab_samples` (`status`);