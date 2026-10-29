CREATE TABLE `commissioning_records` (
	`id` text PRIMARY KEY NOT NULL,
	`building_id` text NOT NULL,
	`code` text NOT NULL,
	`result` text NOT NULL,
	`performed_at` text NOT NULL,
	`performed_by` text NOT NULL,
	`measured` text,
	`evidence` text NOT NULL,
	`notes` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `commissioning_records_building_idx` ON `commissioning_records` (`building_id`,`code`);--> statement-breakpoint
CREATE TABLE `nomenclature_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`ref` text NOT NULL,
	`family` text NOT NULL,
	`designation` text NOT NULL,
	`manufacturer` text,
	`quantity` real NOT NULL,
	`quantity_formula` text,
	`location` text,
	`function` text,
	`specifications` text,
	`communication` text,
	`power` text,
	`connectors` text,
	`cables` text,
	`price_low_mad` real NOT NULL,
	`price_high_mad` real NOT NULL,
	`price_confidence` text NOT NULL,
	`price_date` text,
	`installation` text,
	`spares` text,
	`maintenance` text,
	`origin` text NOT NULL,
	`sort_order` integer NOT NULL,
	`updated_at` text,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nomenclature_articles_ref_unique` ON `nomenclature_articles` (`ref`);--> statement-breakpoint
DROP TABLE `commissioning_tests`;