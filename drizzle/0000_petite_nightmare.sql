CREATE TABLE `deployers` (
	`wallet` text PRIMARY KEY NOT NULL,
	`name` text,
	`created_at` integer NOT NULL,
	`last_scanned_at` integer,
	`lifetime_deploys` integer,
	`lifetime_best_ath_usd` real,
	`lifetime_best_mint` text,
	`linked_wallets` text
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`wallet` text PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`updated_at` integer NOT NULL,
	`verdict_snippet` text
);
--> statement-breakpoint
CREATE TABLE `provider_usage` (
	`provider` text NOT NULL,
	`month` text NOT NULL,
	`calls_used` integer DEFAULT 0 NOT NULL,
	`soft_limit` integer NOT NULL,
	PRIMARY KEY(`provider`, `month`)
);
--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`status_reason` text,
	`window_n` integer NOT NULL,
	`window_from` integer,
	`window_to` integer,
	`bands_version` text NOT NULL,
	`quota_spent` text,
	`stage_state` text,
	`pinned_mints` text
);
--> statement-breakpoint
CREATE TABLE `theses` (
	`mint` text NOT NULL,
	`scan_id` text NOT NULL,
	`json` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`mint`, `scan_id`)
);
--> statement-breakpoint
CREATE TABLE `tokens` (
	`mint` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`name` text NOT NULL,
	`ticker` text NOT NULL,
	`description` text,
	`image_uri` text,
	`image_path` text,
	`socials` text,
	`created_at` integer NOT NULL,
	`bonded` integer NOT NULL,
	`cashback` integer,
	`ath_usd` real,
	`ath_at` integer,
	`ath_source` text,
	`last_trade_at` integer,
	`reply_count` integer,
	`pool_address` text,
	`curve_stats` text,
	`fetched_at` integer NOT NULL
);
