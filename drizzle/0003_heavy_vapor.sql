CREATE TABLE `vamp_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`mint` text NOT NULL,
	`trigger_scan_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`status_reason` text,
	`window_minutes` integer NOT NULL,
	`ath_floor_usd` real NOT NULL,
	`candidates_total` integer,
	`candidates_filtered` integer,
	`window_tokens` text,
	`shortlist` text,
	`quota_spent` text
);
--> statement-breakpoint
CREATE TABLE `vamp_verdicts` (
	`mint` text NOT NULL,
	`vamp_scan_id` text NOT NULL,
	`json` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`mint`, `vamp_scan_id`)
);
--> statement-breakpoint
ALTER TABLE `token_scans` ADD `vamp_requested` integer;--> statement-breakpoint
ALTER TABLE `token_scans` ADD `vamp_scan_id` text;