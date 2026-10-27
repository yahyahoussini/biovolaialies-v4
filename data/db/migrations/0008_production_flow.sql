CREATE TABLE `bvu_ids` (
	`bvu_id` text PRIMARY KEY NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bvu_ids_object_idx` ON `bvu_ids` (`object_type`,`object_id`);--> statement-breakpoint
CREATE TABLE `identifier_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`bvu_id` text NOT NULL,
	`scheme` text NOT NULL,
	`issuer` text DEFAULT '' NOT NULL,
	`value` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`reason` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`bvu_id`) REFERENCES `bvu_ids`(`bvu_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `identifier_aliases_value_idx` ON `identifier_aliases` (`scheme`,`value`);--> statement-breakpoint
CREATE INDEX `identifier_aliases_bvu_idx` ON `identifier_aliases` (`bvu_id`);--> statement-breakpoint
CREATE TABLE `lot_phases` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_id` text NOT NULL,
	`phase` text NOT NULL,
	`building_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`age_days_at_start` integer,
	`plan_check` text NOT NULL,
	`notes` text,
	`actor_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lot_phases_lot_idx` ON `lot_phases` (`lot_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `production_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`purpose` text NOT NULL,
	`parent_line_code` text,
	`egg_type` text,
	`phase_plan` text NOT NULL,
	`exit_min_days` integer,
	`exit_max_days` integer,
	`exit_label` text NOT NULL,
	`source` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_lines_code_unique` ON `production_lines` (`code`);--> statement-breakpoint
CREATE TABLE `subject_events` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`event_type` text NOT NULL,
	`value` real,
	`unit` text,
	`payload` text NOT NULL,
	`attribution_proof` text,
	`occurred_at` text NOT NULL,
	`actor_id` text,
	`device_id` text,
	`source_type` text NOT NULL,
	`data_status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subject_events_subject_idx` ON `subject_events` (`subject_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`bvu_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`sex` text NOT NULL,
	`visual_id` text NOT NULL,
	`rfid_uid` text,
	`tagged_at` text NOT NULL,
	`status` text NOT NULL,
	`status_at` text NOT NULL,
	`status_reason` text,
	`notes` text,
	`data_status` text NOT NULL,
	`actor_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_bvu_id_unique` ON `subjects` (`bvu_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_visual_id_unique` ON `subjects` (`visual_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_rfid_uid_unique` ON `subjects` (`rfid_uid`);--> statement-breakpoint
CREATE INDEX `subjects_lot_idx` ON `subjects` (`lot_id`);--> statement-breakpoint
CREATE TABLE `table_egg_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`lot_id` text NOT NULL,
	`collected_on` text NOT NULL,
	`egg_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`saleable` integer NOT NULL,
	`cracked` integer NOT NULL,
	`dirty` integer NOT NULL,
	`small` integer NOT NULL,
	`status` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`actor_id` text,
	`data_status` text NOT NULL,
	`measurement_method` text,
	`device_id` text,
	`document_id` text,
	`validation_status` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `table_egg_lots_code_unique` ON `table_egg_lots` (`code`);--> statement-breakpoint
CREATE INDEX `table_egg_lots_lot_idx` ON `table_egg_lots` (`lot_id`,`collected_on`);--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`source_building_id` text NOT NULL,
	`destination_building_id` text NOT NULL,
	`destination_lot_id` text,
	`destination_lot_code` text,
	`destination_line_code` text,
	`phase_on_arrival` text,
	`quantity_sent` integer NOT NULL,
	`sent_at` text NOT NULL,
	`sent_by` text NOT NULL,
	`sender_name` text NOT NULL,
	`sender_signature` text NOT NULL,
	`document_ref` text,
	`transporter` text,
	`vehicle` text,
	`crates` integer,
	`notes` text,
	`quantity_received` integer,
	`dead_on_arrival` integer,
	`received_at` text,
	`received_by` text,
	`receiver_name` text,
	`receiver_signature` text,
	`discrepancy` integer,
	`discrepancy_reason` text,
	`status` text NOT NULL,
	`status_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`source_building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_code_unique` ON `transfers` (`code`);--> statement-breakpoint
CREATE INDEX `transfers_object_idx` ON `transfers` (`object_type`,`object_id`);--> statement-breakpoint
CREATE INDEX `transfers_destination_idx` ON `transfers` (`destination_building_id`,`status`);--> statement-breakpoint
ALTER TABLE `lots` ADD `purpose` text;--> statement-breakpoint
ALTER TABLE `lots` ADD `hatched_at` text;--> statement-breakpoint
ALTER TABLE `parent_flocks` ADD `lot_id` text REFERENCES lots(id);--> statement-breakpoint
ALTER TABLE `parent_flocks` ADD `production_line` text;