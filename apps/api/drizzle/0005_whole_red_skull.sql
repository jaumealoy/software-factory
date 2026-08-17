CREATE TABLE `agent_chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` text NOT NULL,
	`direction` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `agent_chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_chat_messages_chat_idx` ON `agent_chat_messages` (`chat_id`);--> statement-breakpoint
CREATE TABLE `agent_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`title` text DEFAULT 'New chat' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `factory_projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_chats_project_id_idx` ON `agent_chats` (`project_id`);