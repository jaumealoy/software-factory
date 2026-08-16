CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`change_id` text,
	`task_id` text,
	`kind` text NOT NULL,
	`path` text,
	`uri` text,
	`summary` text,
	`source_revision` text,
	`validation_result` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_change_id_idx` ON `artifacts` (`change_id`);--> statement-breakpoint
CREATE INDEX `artifacts_task_id_idx` ON `artifacts` (`task_id`);--> statement-breakpoint
CREATE TABLE `capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`change_id` text NOT NULL,
	`parent_capability_id` text,
	`name` text NOT NULL,
	`summary` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `capabilities_change_id_idx` ON `capabilities` (`change_id`);--> statement-breakpoint
CREATE INDEX `capabilities_parent_idx` ON `capabilities` (`parent_capability_id`);--> statement-breakpoint
CREATE TABLE `changes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`request_text` text NOT NULL,
	`status` text DEFAULT 'CREATED' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `factory_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `changes_project_id_idx` ON `changes` (`project_id`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`change_id` text NOT NULL,
	`problem` text NOT NULL,
	`options_json` text NOT NULL,
	`recommendation` text,
	`rationale` text,
	`resume_status` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`resolution_note` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `decisions_change_id_idx` ON `decisions` (`change_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_entity_idx` ON `events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `factory_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `factory_projects_slug_unique` ON `factory_projects` (`slug`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`local_path` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `factory_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repositories_project_id_idx` ON `repositories` (`project_id`);--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `depends_on_task_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_dependencies_depends_on_idx` ON `task_dependencies` (`depends_on_task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`change_id` text NOT NULL,
	`capability_id` text,
	`objective` text NOT NULL,
	`scope` text,
	`status` text DEFAULT 'PROPOSED' NOT NULL,
	`risk` text DEFAULT 'low' NOT NULL,
	`github_issue_number` integer,
	`github_issue_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_change_id_idx` ON `tasks` (`change_id`);--> statement-breakpoint
CREATE INDEX `tasks_capability_id_idx` ON `tasks` (`capability_id`);