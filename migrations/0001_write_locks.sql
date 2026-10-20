CREATE TABLE `write_locks` (
	`name` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`started_at` integer NOT NULL,
	`checkpoint` text
);
