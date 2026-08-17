import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type {
  ArtifactKind,
  ChangeStatus,
  DecisionStatus,
  RiskLevel,
  TaskStatus,
} from "../domain/statuses.js";

const createdAt = integer("created_at", { mode: "timestamp_ms" })
  .notNull()
  .$defaultFn(() => new Date());
const updatedAt = integer("updated_at", { mode: "timestamp_ms" })
  .notNull()
  .$defaultFn(() => new Date());

export const factoryMeta = sqliteTable("factory_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const factoryProjects = sqliteTable("factory_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  defaultModel: text("default_model"),
  createdAt,
  updatedAt,
});

export const repositories = sqliteTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => factoryProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    localPath: text("local_path"),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [index("repositories_project_id_idx").on(table.projectId)],
);

export const changes = sqliteTable(
  "changes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => factoryProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary"),
    requestText: text("request_text").notNull(),
    status: text("status").$type<ChangeStatus>().notNull().default("CREATED"),
    createdAt,
    updatedAt,
  },
  (table) => [index("changes_project_id_idx").on(table.projectId)],
);

export const capabilities = sqliteTable(
  "capabilities",
  {
    id: text("id").primaryKey(),
    changeId: text("change_id")
      .notNull()
      .references(() => changes.id, { onDelete: "cascade" }),
    parentCapabilityId: text("parent_capability_id").references(
      (): AnySQLiteColumn => capabilities.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    summary: text("summary"),
    position: integer("position").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("capabilities_change_id_idx").on(table.changeId),
    index("capabilities_parent_idx").on(table.parentCapabilityId),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    changeId: text("change_id")
      .notNull()
      .references(() => changes.id, { onDelete: "cascade" }),
    capabilityId: text("capability_id").references(() => capabilities.id, {
      onDelete: "set null",
    }),
    objective: text("objective").notNull(),
    scope: text("scope"),
    model: text("model"),
    status: text("status").$type<TaskStatus>().notNull().default("PROPOSED"),
    risk: text("risk").$type<RiskLevel>().notNull().default("low"),
    githubIssueNumber: integer("github_issue_number"),
    githubIssueUrl: text("github_issue_url"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("tasks_change_id_idx").on(table.changeId),
    index("tasks_capability_id_idx").on(table.capabilityId),
  ],
);

export const taskDependencies = sqliteTable(
  "task_dependencies",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: text("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnTaskId] }),
    index("task_dependencies_depends_on_idx").on(table.dependsOnTaskId),
  ],
);

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    changeId: text("change_id")
      .notNull()
      .references(() => changes.id, { onDelete: "cascade" }),
    problem: text("problem").notNull(),
    optionsJson: text("options_json").notNull(),
    recommendation: text("recommendation"),
    rationale: text("rationale"),
    resumeStatus: text("resume_status").$type<ChangeStatus>(),
    status: text("status").$type<DecisionStatus>().notNull().default("PENDING"),
    resolutionNote: text("resolution_note"),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    createdAt,
    updatedAt,
  },
  (table) => [index("decisions_change_id_idx").on(table.changeId)],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    changeId: text("change_id").references(() => changes.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ArtifactKind>().notNull(),
    path: text("path"),
    uri: text("uri"),
    summary: text("summary"),
    sourceRevision: text("source_revision"),
    validationResult: text("validation_result"),
    createdAt,
  },
  (table) => [
    index("artifacts_change_id_idx").on(table.changeId),
    index("artifacts_task_id_idx").on(table.taskId),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json"),
    createdAt,
  },
  (table) => [index("events_entity_idx").on(table.entityType, table.entityId)],
);

export const modelFavorites = sqliteTable("model_favorites", {
  modelId: text("model_id").primaryKey(),
  createdAt,
});

export const executionSessions = sqliteTable(
  "execution_sessions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("RUNNING"),
    outcome: text("outcome"),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdAt,
    updatedAt,
  },
  (table) => [index("execution_sessions_task_id_idx").on(table.taskId)],
);

export const sessionEvents = sqliteTable(
  "session_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => executionSessions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    stage: text("stage"),
    message: text("message"),
    detail: text("detail"),
    dataJson: text("data_json"),
    createdAt,
  },
  (table) => [index("session_events_session_id_idx").on(table.sessionId)],
);

export const agentChats = sqliteTable(
  "agent_chats",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => factoryProjects.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull().default("New chat"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt,
    updatedAt,
  },
  (table) => [index("agent_chats_project_id_idx").on(table.projectId)],
);

export const agentChatMessages = sqliteTable(
  "agent_chat_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: text("chat_id")
      .notNull()
      .references(() => agentChats.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    text: text("text").notNull(),
    createdAt,
  },
  (table) => [index("agent_chat_messages_chat_idx").on(table.chatId)],
);

export type FactoryProject = typeof factoryProjects.$inferSelect;
export type NewFactoryProject = typeof factoryProjects.$inferInsert;

export type FactoryMeta = typeof factoryMeta.$inferSelect;
export type NewFactoryMeta = typeof factoryMeta.$inferInsert;

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;

export type Change = typeof changes.$inferSelect;
export type NewChange = typeof changes.$inferInsert;

export type Capability = typeof capabilities.$inferSelect;
export type NewCapability = typeof capabilities.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type TaskDependency = typeof taskDependencies.$inferSelect;

export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;

export type ExecutionEvent = typeof events.$inferSelect;
export type NewExecutionEvent = typeof events.$inferInsert;

export type ModelFavorite = typeof modelFavorites.$inferSelect;
export type NewModelFavorite = typeof modelFavorites.$inferInsert;

export type ExecutionSession = typeof executionSessions.$inferSelect;
export type NewExecutionSession = typeof executionSessions.$inferInsert;

export type SessionEvent = typeof sessionEvents.$inferSelect;
export type NewSessionEvent = typeof sessionEvents.$inferInsert;

export type AgentChat = typeof agentChats.$inferSelect;
export type NewAgentChat = typeof agentChats.$inferInsert;

export type AgentChatMessage = typeof agentChatMessages.$inferSelect;
export type NewAgentChatMessage = typeof agentChatMessages.$inferInsert;
