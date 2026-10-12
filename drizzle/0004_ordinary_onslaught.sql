CREATE TABLE `narrative_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`window_days` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`status_reason` text,
	`grok_model` text,
	`grok_raw` text,
	`narratives` text,
	`prompt_version` text
);
