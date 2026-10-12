CREATE TABLE `mimic_studies` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`status_reason` text,
	`deploy_count` integer,
	`digest` text,
	`study` text,
	`prompt_version` text,
	`quota_spent` text
);
