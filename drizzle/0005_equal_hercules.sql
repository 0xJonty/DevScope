CREATE TABLE `narrative_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`rank` integer NOT NULL,
	`json` text NOT NULL,
	`image_path` text
);
--> statement-breakpoint
ALTER TABLE `narrative_scans` ADD `related_tweets` integer DEFAULT 3 NOT NULL;