ALTER TABLE `lead_source_connections` ADD `verification_secret_ciphertext` text;--> statement-breakpoint
ALTER TABLE `lead_source_connections` ADD `verification_secret_iv` text;--> statement-breakpoint
ALTER TABLE `lead_source_connections` ADD `verification_secret_tag` text;--> statement-breakpoint
ALTER TABLE `lead_source_connections` ADD `verification_secret_ending` text;