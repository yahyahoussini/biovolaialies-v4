CREATE TABLE `api_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_clients_key_hash_unique` ON `api_clients` (`key_hash`);--> statement-breakpoint
CREATE TABLE `chick_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`hatch_cycle_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`grade` text NOT NULL,
	`dispatched_at` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`actor_id` text,
	`data_status` text NOT NULL,
	`measurement_method` text,
	`device_id` text,
	`document_id` text,
	`validation_status` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`hatch_cycle_id`) REFERENCES `hatch_cycles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chick_lots_code_unique` ON `chick_lots` (`code`);--> statement-breakpoint
CREATE TABLE `commissioning_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`equipment` text NOT NULL,
	`procedure` text NOT NULL,
	`result` text NOT NULL,
	`executed_by` text,
	`executed_at` text,
	`evidence` text,
	`notes` text,
	FOREIGN KEY (`executed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commissioning_tests_code_unique` ON `commissioning_tests` (`code`);--> statement-breakpoint
CREATE TABLE `egg_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`parent_flock_id` text NOT NULL,
	`collected_at` text NOT NULL,
	`quantity` integer NOT NULL,
	`storage_building_id` text,
	`source_type` text NOT NULL,
	`source_id` text,
	`actor_id` text,
	`data_status` text NOT NULL,
	`measurement_method` text,
	`device_id` text,
	`document_id` text,
	`validation_status` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parent_flock_id`) REFERENCES `parent_flocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storage_building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `egg_lots_code_unique` ON `egg_lots` (`code`);--> statement-breakpoint
CREATE TABLE `equipment_items` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_code` text NOT NULL,
	`unit_label` text NOT NULL,
	`category` text NOT NULL,
	`reference` text,
	`name` text NOT NULL,
	`quantity_ref` real,
	`quantity_max` real,
	`status` text,
	`function` text,
	`characteristics` text,
	`decision_rule` text,
	`candidates` text,
	`sort_order` integer NOT NULL,
	`updated_at` text,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hatch_cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`building_id` text NOT NULL,
	`incubator_ref` text NOT NULL,
	`set_at` text NOT NULL,
	`eggs_set` integer NOT NULL,
	`status` text NOT NULL,
	`candled_at` text,
	`clears_removed` integer,
	`hatched_at` text,
	`chicks_hatched` integer,
	`unhatched` integer,
	`culls` integer,
	`source_type` text NOT NULL,
	`source_id` text,
	`actor_id` text,
	`data_status` text NOT NULL,
	`measurement_method` text,
	`device_id` text,
	`document_id` text,
	`validation_status` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hatch_cycles_code_unique` ON `hatch_cycles` (`code`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`contact_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`activity` text NOT NULL,
	`capacity` text,
	`need` text NOT NULL,
	`consent` integer NOT NULL,
	`consent_version` text NOT NULL,
	`status` text DEFAULT 'NOUVEAU' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `ledger_events` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text,
	`source` text NOT NULL,
	`occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`payload` text NOT NULL,
	`schema_version` integer NOT NULL,
	`idempotency_key` text,
	`payload_hash` text NOT NULL,
	`corrects_event_id` text,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_events_seq_unique` ON `ledger_events` (`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_events_idempotency_key_unique` ON `ledger_events` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `parent_flocks` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`building_id` text NOT NULL,
	`strain` text NOT NULL,
	`genetic_supplier` text NOT NULL,
	`origin_country` text NOT NULL,
	`import_reference` text,
	`placed_at` text NOT NULL,
	`female_count` integer NOT NULL,
	`male_count` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`actor_id` text,
	`data_status` text NOT NULL,
	`measurement_method` text,
	`device_id` text,
	`document_id` text,
	`validation_status` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parent_flocks_code_unique` ON `parent_flocks` (`code`);--> statement-breakpoint
CREATE TABLE `quality_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`root_type` text NOT NULL,
	`root_id` text NOT NULL,
	`reason` text NOT NULL,
	`description` text NOT NULL,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`evidence_refs` text NOT NULL,
	`opened_by` text NOT NULL,
	`opened_at` text NOT NULL,
	`decided_by` text,
	`decision_justification` text,
	`decision_evidence_refs` text,
	`decided_at` text,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quality_cases_code_unique` ON `quality_cases` (`code`);--> statement-breakpoint
CREATE TABLE `quality_hold_items` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`depth` integer NOT NULL,
	`active` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `quality_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`product_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`shipped_at` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`actor_id` text,
	`data_status` text NOT NULL,
	`measurement_method` text,
	`device_id` text,
	`document_id` text,
	`validation_status` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipments_code_unique` ON `shipments` (`code`);--> statement-breakpoint
ALTER TABLE `products` ADD `quantity` real;--> statement-breakpoint
ALTER TABLE `products` ADD `unit` text;