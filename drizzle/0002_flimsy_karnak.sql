CREATE TABLE `token_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`mint` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`status_reason` text,
	`quota_spent` text
);
