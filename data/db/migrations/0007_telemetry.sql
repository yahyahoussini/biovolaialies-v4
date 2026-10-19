CREATE TABLE `alert_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`alert_id` text NOT NULL,
	`level` integer NOT NULL,
	`recipient_id` text,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`detail` text,
	`sent_at` text NOT NULL,
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `egg_logger_missions` (
	`id` text PRIMARY KEY NOT NULL,
	`sensor_id` text NOT NULL,
	`egg_lot_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sensor_id`) REFERENCES `sensors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`egg_lot_id`) REFERENCES `egg_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ingest_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`gateway_id` text NOT NULL,
	`seq` integer NOT NULL,
	`sent_at` text NOT NULL,
	`received_at` text NOT NULL,
	`clock_offset_seconds` real,
	`reading_count` integer NOT NULL,
	`event_count` integer NOT NULL,
	`accepted` integer NOT NULL,
	`duplicates` integer NOT NULL,
	`rejected` integer NOT NULL,
	`flagged` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`api_client_id` text,
	FOREIGN KEY (`gateway_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_messages_gateway_seq_hash_uq` ON `ingest_messages` (`gateway_id`,`seq`,`payload_hash`);--> statement-breakpoint
CREATE TABLE `measurement_aggregates` (
	`id` text PRIMARY KEY NOT NULL,
	`sensor_id` text NOT NULL,
	`granularity` text NOT NULL,
	`bucket_start` text NOT NULL,
	`building_id` text NOT NULL,
	`zone_id` text,
	`lot_id` text,
	`count` integer NOT NULL,
	`expected` integer,
	`suspect_count` integer NOT NULL,
	`sum` real NOT NULL,
	`sum_sq` real NOT NULL,
	`min` real,
	`max` real,
	FOREIGN KEY (`sensor_id`) REFERENCES `sensors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aggregates_sensor_gran_bucket_uq` ON `measurement_aggregates` (`sensor_id`,`granularity`,`bucket_start`);--> statement-breakpoint
CREATE INDEX `aggregates_lot_idx` ON `measurement_aggregates` (`lot_id`,`granularity`);--> statement-breakpoint
CREATE TABLE `reference_bands` (
	`id` text PRIMARY KEY NOT NULL,
	`sensor_type` text NOT NULL,
	`production_line` text NOT NULL,
	`age_day_from` integer NOT NULL,
	`age_day_to` integer NOT NULL,
	`season` text NOT NULL,
	`low` real NOT NULL,
	`high` real NOT NULL,
	`unit` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`lots_used` integer,
	`samples` integer,
	`learned_from` text,
	`supersedes_id` text,
	`note` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rule_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_code` text NOT NULL,
	`building_id` text,
	`params` text NOT NULL,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rule_settings_rule_building_uq` ON `rule_settings` (`rule_code`,`building_id`);--> statement-breakpoint
CREATE TABLE `rule_states` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_code` text NOT NULL,
	`subject_key` text NOT NULL,
	`building_id` text NOT NULL,
	`state` text NOT NULL,
	`since` text NOT NULL,
	`open_alert_id` text,
	`memory` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rule_states_rule_subject_uq` ON `rule_states` (`rule_code`,`subject_key`);--> statement-breakpoint
CREATE TABLE `rule_transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_code` text NOT NULL,
	`subject_key` text NOT NULL,
	`building_id` text NOT NULL,
	`lot_id` text,
	`from_state` text NOT NULL,
	`to_state` text NOT NULL,
	`at` text NOT NULL,
	`value` real,
	`reference_low` real,
	`reference_high` real,
	`band_id` text,
	`diagnosis` text NOT NULL,
	`context` text,
	`alert_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rule_transitions_building_at_idx` ON `rule_transitions` (`building_id`,`at`);--> statement-breakpoint
CREATE TABLE `rule_watermarks` (
	`building_id` text PRIMARY KEY NOT NULL,
	`evaluated_until` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sensor_calibrations` (
	`id` text PRIMARY KEY NOT NULL,
	`sensor_id` text NOT NULL,
	`calibrated_at` text NOT NULL,
	`method` text NOT NULL,
	`reference_instrument` text NOT NULL,
	`reference_value` real NOT NULL,
	`measured_value` real NOT NULL,
	`offset_applied` real,
	`tolerance` real NOT NULL,
	`result` text NOT NULL,
	`next_due_at` text NOT NULL,
	`performed_by` text NOT NULL,
	`evidence_ref` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sensor_id`) REFERENCES `sensors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sensor_calibrations_sensor_idx` ON `sensor_calibrations` (`sensor_id`,`calibrated_at`);--> statement-breakpoint
CREATE TABLE `site_events` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`building_id` text NOT NULL,
	`zone_id` text,
	`lot_id` text,
	`kind` text NOT NULL,
	`occurred_at` text NOT NULL,
	`badge` text,
	`media_ref` text,
	`payload` text,
	`ingest_message_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_events_device_kind_at_uq` ON `site_events` (`device_id`,`kind`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `site_events_building_at_idx` ON `site_events` (`building_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `zone_occupations` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`head_count` integer,
	`note` text,
	`recorded_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `zone_occupations_zone_idx` ON `zone_occupations` (`zone_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `zones` (
	`id` text PRIMARY KEY NOT NULL,
	`farm_id` text NOT NULL,
	`building_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`farm_id`) REFERENCES `farms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zones_farm_code_uq` ON `zones` (`farm_id`,`code`);--> statement-breakpoint
ALTER TABLE `alerts` ADD `escalation_level` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `alerts` ADD `next_escalation_at` text;--> statement-breakpoint
ALTER TABLE `alerts` ADD `outcome` text;--> statement-breakpoint
ALTER TABLE `api_clients` ADD `device_id` text;--> statement-breakpoint
ALTER TABLE `devices` ADD `catalog_ref` text;--> statement-breakpoint
ALTER TABLE `devices` ADD `gateway_id` text;--> statement-breakpoint
ALTER TABLE `devices` ADD `clock_offset_seconds` real;--> statement-breakpoint
ALTER TABLE `devices` ADD `last_clock_sync_at` text;--> statement-breakpoint
ALTER TABLE `lots` ADD `production_line` text;--> statement-breakpoint
ALTER TABLE `measurements` ADD `zone_id` text;--> statement-breakpoint
ALTER TABLE `measurements` ADD `quality_flag` text;--> statement-breakpoint
ALTER TABLE `measurements` ADD `attribution` text;--> statement-breakpoint
ALTER TABLE `measurements` ADD `ingest_message_id` text;--> statement-breakpoint
ALTER TABLE `measurements` ADD `received_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `measurements_sensor_captured_uq` ON `measurements` (`sensor_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `measurements_building_captured_idx` ON `measurements` (`building_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `measurements_lot_idx` ON `measurements` (`lot_id`);--> statement-breakpoint
ALTER TABLE `sensors` ADD `code` text;--> statement-breakpoint
ALTER TABLE `sensors` ADD `catalog_ref` text;--> statement-breakpoint
ALTER TABLE `sensors` ADD `zone_id` text REFERENCES zones(id);--> statement-breakpoint
ALTER TABLE `sensors` ADD `position` text;--> statement-breakpoint
ALTER TABLE `sensors` ADD `mounting_height_m` real;--> statement-breakpoint
CREATE UNIQUE INDEX `sensors_code_unique` ON `sensors` (`code`);