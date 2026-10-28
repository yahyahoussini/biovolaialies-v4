CREATE TABLE `egg_code_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`line_id` text NOT NULL,
	`run_id` text NOT NULL,
	`request_ref` text NOT NULL,
	`first_serial` integer NOT NULL,
	`last_serial` integer NOT NULL,
	`allocated_at` text NOT NULL,
	`requested_by` text NOT NULL,
	FOREIGN KEY (`line_id`) REFERENCES `egg_marking_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `egg_marking_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `egg_code_blocks_line_serial_idx` ON `egg_code_blocks` (`line_id`,`first_serial`);--> statement-breakpoint
CREATE UNIQUE INDEX `egg_code_blocks_ref_idx` ON `egg_code_blocks` (`run_id`,`request_ref`);--> statement-breakpoint
CREATE TABLE `egg_marking_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`building_id` text NOT NULL,
	`routes` text NOT NULL,
	`shell_prefix` text NOT NULL,
	`next_serial` integer DEFAULT 0 NOT NULL,
	`read_threshold` real NOT NULL,
	`read_window` integer NOT NULL,
	`tray_capacity` integer NOT NULL,
	`protocol` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text,
	`updated_by` text,
	FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `egg_marking_lines_code_unique` ON `egg_marking_lines` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `egg_marking_lines_shell_prefix_unique` ON `egg_marking_lines` (`shell_prefix`);--> statement-breakpoint
CREATE TABLE `egg_marking_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`line_id` text NOT NULL,
	`route` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`started_by` text NOT NULL,
	`ended_at` text,
	`ended_by` text,
	`first_serial` integer,
	`last_serial` integer,
	`allocated` integer DEFAULT 0 NOT NULL,
	`printed` integer DEFAULT 0 NOT NULL,
	`read_ok` integer DEFAULT 0 NOT NULL,
	`read_ko` integer DEFAULT 0 NOT NULL,
	`guard_since` text NOT NULL,
	`notes` text,
	`close_note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`line_id`) REFERENCES `egg_marking_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ended_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `egg_marking_runs_code_unique` ON `egg_marking_runs` (`code`);--> statement-breakpoint
CREATE INDEX `egg_marking_runs_line_idx` ON `egg_marking_runs` (`line_id`,`status`);--> statement-breakpoint
CREATE INDEX `egg_marking_runs_source_idx` ON `egg_marking_runs` (`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `egg_read_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`batch_ref` text NOT NULL,
	`first_serial` integer NOT NULL,
	`last_serial` integer NOT NULL,
	`read_at` text NOT NULL,
	`ok` integer NOT NULL,
	`ko` integer NOT NULL,
	`received_at` text NOT NULL,
	`reported_by` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `egg_marking_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `egg_read_batches_ref_idx` ON `egg_read_batches` (`run_id`,`batch_ref`);--> statement-breakpoint
CREATE INDEX `egg_read_batches_serial_idx` ON `egg_read_batches` (`run_id`,`first_serial`);--> statement-breakpoint
CREATE INDEX `egg_read_batches_read_idx` ON `egg_read_batches` (`read_at`);--> statement-breakpoint
CREATE TABLE `egg_read_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`serial` integer NOT NULL,
	`kind` text NOT NULL,
	`at` text NOT NULL,
	`recorded_by` text,
	`hatch_cycle_id` text,
	`note` text,
	FOREIGN KEY (`run_id`) REFERENCES `egg_marking_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hatch_cycle_id`) REFERENCES `hatch_cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `egg_read_exceptions_serial_idx` ON `egg_read_exceptions` (`run_id`,`serial`,`kind`);--> statement-breakpoint
CREATE INDEX `egg_read_exceptions_cycle_idx` ON `egg_read_exceptions` (`hatch_cycle_id`);--> statement-breakpoint
CREATE TABLE `egg_read_stops` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`stopped_at` text NOT NULL,
	`rate` real NOT NULL,
	`considered` integer NOT NULL,
	`lifted_at` text,
	`lifted_by` text,
	`lift_note` text,
	FOREIGN KEY (`run_id`) REFERENCES `egg_marking_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lifted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `egg_read_stops_run_idx` ON `egg_read_stops` (`run_id`);--> statement-breakpoint
CREATE TABLE `egg_trays` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`tray_ref` text,
	`first_serial` integer NOT NULL,
	`last_serial` integer NOT NULL,
	`capacity` integer NOT NULL,
	`egg_count` integer NOT NULL,
	`packed_at` text NOT NULL,
	`packed_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `egg_marking_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `egg_trays_serial_idx` ON `egg_trays` (`run_id`,`first_serial`);--> statement-breakpoint
CREATE UNIQUE INDEX `egg_trays_ref_idx` ON `egg_trays` (`run_id`,`tray_ref`);