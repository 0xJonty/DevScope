CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`mint` text,
	`narrative_token_id` text,
	`status` text NOT NULL,
	`status_reason` text,
	`params` text NOT NULL,
	`metadata_uri` text,
	`image_path` text,
	`signature` text,
	`vanity` integer NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
