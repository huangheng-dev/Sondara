ALTER TABLE `users` ADD `totp_secret_ciphertext` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret_iv` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret_tag` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_verified_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_recovery_codes_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text DEFAULT 'login_2fa' NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_challenges_token_hash_unique` ON `auth_challenges` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_challenges_user_idx` ON `auth_challenges` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_challenges_expiry_idx` ON `auth_challenges` (`expires_at`);
