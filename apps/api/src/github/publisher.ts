import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { taskDependencies, type Task } from "../db/index.js";
import { listCapabilities } from "../domain/capabilities.js";
import { getChange } from "../domain/changes.js";
import { DomainError } from "../domain/errors.js";
import { recordEvent } from "../domain/events.js";
import { getTask, listTasks, setGitHubReference } from "../domain/tasks.js";
import { GitHubCliExecutor, type IssueExecutor, type IssueInfo } from "./client.js";
import { renderTaskIssueBody } from "./issueBody.js";

export interface PublishTaskInput {
  taskId: string;
  repoFullName: string;
  changeIssueNumber?: number;
  labels?: string[];
  executor?: IssueExecutor;
}

export interface PublishTaskResult {
  action: "created" | "updated";
  issueNumber: number;
  issueUrl: string;
}

export class PublishTaskError extends DomainError {
  constructor(
    readonly taskId: string,
    message: string,
  ) {
    super(message);
    this.name = "PublishTaskError";
  }
}

function dependencyIssueReferences(
  db: Db,
  task: Task,
): Array<{ number: number | null; title: string }> {
  const dependencies = db
    .select({ dependsOnTaskId: taskDependencies.dependsOnTaskId })
    .from(taskDependencies)
    .where(eq(taskDependencies.taskId, task.id))
    .all();

  return dependencies.map((dependency) => {
    const dependencyTask = getTask(db, dependency.dependsOnTaskId);
    return {
      number: dependencyTask.githubIssueNumber,
      title: dependencyTask.objective,
    };
  });
}

/** Publishes (or re-publishes) one task as a GitHub issue, idempotently. */
export async function publishTaskIssue(
  db: Db,
  input: PublishTaskInput,
): Promise<PublishTaskResult> {
  const task = getTask(db, input.taskId);
  const change = getChange(db, task.changeId);
  const capabilities = listCapabilities(db, change.id);
  const capability = task.capabilityId
    ? (capabilities.find((capability) => capability.id === task.capabilityId) ?? null)
    : null;
  const dependencyIssues = dependencyIssueReferences(db, task);

  const body = renderTaskIssueBody({
    taskId: task.id,
    taskNumber: task.githubIssueNumber,
    objective: task.objective,
    scope: task.scope,
    risk: task.risk,
    status: task.status,
    changeId: change.id,
    changeTitle: change.title,
    changeIssueNumber: input.changeIssueNumber ?? null,
    capabilityName: capability?.name ?? null,
    dependencyIssues,
  });

  const executor = input.executor ?? new GitHubCliExecutor();
  try {
    if (task.githubIssueNumber != null) {
      const updated = await executor.editIssue({
        repoFullName: input.repoFullName,
        number: task.githubIssueNumber,
        title: task.objective,
        body,
      });
      await setGitHubReference(db, {
        taskId: task.id,
        githubIssueNumber: updated.number,
        githubIssueUrl: updated.url,
      });
      recordEvent(db, {
        entityType: "task",
        entityId: task.id,
        eventType: "task.issue_updated",
        payload: { issueNumber: updated.number, issueUrl: updated.url },
      });
      return { action: "updated", issueNumber: updated.number, issueUrl: updated.url };
    }

    const issue: IssueInfo = await executor.createIssue({
      repoFullName: input.repoFullName,
      title: task.objective,
      body,
      labels: input.labels ?? [],
    });
    await setGitHubReference(db, {
      taskId: task.id,
      githubIssueNumber: issue.number,
      githubIssueUrl: issue.url,
    });
    recordEvent(db, {
      entityType: "task",
      entityId: task.id,
      eventType: "task.issue_created",
      payload: { issueNumber: issue.number, issueUrl: issue.url },
    });
    return { action: "created", issueNumber: issue.number, issueUrl: issue.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    recordEvent(db, {
      entityType: "task",
      entityId: task.id,
      eventType: "task.issue_publish_failed",
      payload: { error: message },
    });
    throw new PublishTaskError(task.id, `Failed to publish task ${task.id}: ${message}`);
  }
}

export interface PublishChangeIssuesInput {
  changeId: string;
  repoFullName: string;
  changeIssueNumber?: number;
  labels?: string[];
  executor?: IssueExecutor;
}

export async function publishChangeIssues(
  db: Db,
  input: PublishChangeIssuesInput,
): Promise<PublishTaskResult[]> {
  const tasks = listTasks(db, input.changeId);
  const results: PublishTaskResult[] = [];
  for (const task of tasks) {
    results.push(
      await publishTaskIssue(db, {
        taskId: task.id,
        repoFullName: input.repoFullName,
        changeIssueNumber: input.changeIssueNumber,
        labels: input.labels,
        executor: input.executor,
      }),
    );
  }
  return results;
}
