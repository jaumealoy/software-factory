import type { Db } from "../db/index.js";
import type {
  Artifact,
  Capability,
  Change,
  Decision,
  FactoryProject,
  Repository,
  Task,
} from "../db/index.js";
import { listArtifacts, recordArtifact, type RecordArtifactInput } from "./artifacts.js";
import { addCapability, listCapabilities, type AddCapabilityInput } from "./capabilities.js";
import {
  createChange,
  getChange,
  listChanges,
  transitionChange,
  type CreateChangeInput,
} from "./changes.js";
import {
  getDecision,
  listPendingDecisions,
  requestDecision,
  resolveDecision,
  type ListPendingDecisionsOptions,
  type RequestDecisionInput,
  type ResolveDecisionInput,
} from "./decisions.js";
import type { RecordEventInput } from "./events.js";
import { listEvents, recordEvent as recordDomainEvent } from "./events.js";
import {
  addRepository,
  createProject,
  getProjectWithRepositories,
  listProjects,
  type AddRepositoryInput,
  type CreateProjectInput,
} from "./projects.js";
import type { ChangeStatus, TaskStatus } from "./statuses.js";
import {
  addTaskDependency,
  createTask,
  getTask,
  getTaskGraph,
  listTasks,
  removeTaskDependency,
  setGitHubReference,
  transitionTask,
  type AddTaskDependencyInput,
  type CreateTaskInput,
  type RemoveTaskDependencyInput,
  type SetGitHubReferenceInput,
  type TaskGraph,
} from "./tasks.js";

export interface ChangeWithDetails {
  change: Change;
  capabilities: Capability[];
  tasks: Task[];
  taskGraph: TaskGraph;
  pendingDecisions: Decision[];
  artifacts: Artifact[];
}

/**
 * Typed internal repository/service API for the orchestrator and the dashboard.
 * All factory persistence flows through this facade.
 */
export class FactoryStore {
  constructor(readonly db: Db) {}

  async createProject(input: CreateProjectInput): Promise<FactoryProject> {
    return createProject(this.db, input);
  }

  async listProjects(): Promise<FactoryProject[]> {
    return listProjects(this.db);
  }

  async getProjectWithRepositories(projectId: string): Promise<{
    project: FactoryProject;
    repositories: Repository[];
  }> {
    return getProjectWithRepositories(this.db, projectId);
  }

  async addRepository(input: AddRepositoryInput): Promise<Repository> {
    return addRepository(this.db, input);
  }

  async createChange(input: CreateChangeInput): Promise<Change> {
    return createChange(this.db, input);
  }

  async getChange(changeId: string): Promise<Change> {
    return getChange(this.db, changeId);
  }

  async listChanges(projectId?: string): Promise<Change[]> {
    return listChanges(this.db, projectId);
  }

  async transitionChange(changeId: string, to: ChangeStatus): Promise<Change> {
    return transitionChange(this.db, changeId, to);
  }

  async addCapability(input: AddCapabilityInput): Promise<Capability> {
    return addCapability(this.db, input);
  }

  async listCapabilities(changeId: string): Promise<Capability[]> {
    return listCapabilities(this.db, changeId);
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return createTask(this.db, input);
  }

  async getTask(taskId: string): Promise<Task> {
    return getTask(this.db, taskId);
  }

  async listTasks(changeId: string): Promise<Task[]> {
    return listTasks(this.db, changeId);
  }

  async transitionTask(taskId: string, to: TaskStatus): Promise<Task> {
    return transitionTask(this.db, taskId, to);
  }

  async setGitHubReference(input: SetGitHubReferenceInput): Promise<Task> {
    return setGitHubReference(this.db, input);
  }

  async addTaskDependency(input: AddTaskDependencyInput): Promise<void> {
    return addTaskDependency(this.db, input);
  }

  async removeTaskDependency(input: RemoveTaskDependencyInput): Promise<void> {
    return removeTaskDependency(this.db, input);
  }

  async getTaskGraph(changeId: string): Promise<TaskGraph> {
    return getTaskGraph(this.db, changeId);
  }

  async requestDecision(input: RequestDecisionInput): Promise<Decision> {
    return requestDecision(this.db, input);
  }

  async resolveDecision(input: ResolveDecisionInput): Promise<Decision> {
    return resolveDecision(this.db, input);
  }

  async getDecision(decisionId: string): Promise<Decision> {
    return getDecision(this.db, decisionId);
  }

  async listPendingDecisions(options: ListPendingDecisionsOptions = {}): Promise<Decision[]> {
    return listPendingDecisions(this.db, options);
  }

  async recordArtifact(input: RecordArtifactInput): Promise<Artifact> {
    return recordArtifact(this.db, input);
  }

  async listArtifacts(options: { changeId?: string; taskId?: string }): Promise<Artifact[]> {
    return listArtifacts(this.db, options);
  }

  async recordEvent(input: RecordEventInput): Promise<void> {
    return recordDomainEvent(this.db, input);
  }

  async listEvents(
    input: Parameters<typeof listEvents>[1],
  ): Promise<Awaited<ReturnType<typeof listEvents>>> {
    return listEvents(this.db, input);
  }

  async getChangeWithState(changeId: string): Promise<ChangeWithDetails> {
    const change = getChange(this.db, changeId);
    const taskGraph = getTaskGraph(this.db, changeId);
    return {
      change,
      capabilities: listCapabilities(this.db, changeId),
      tasks: taskGraph.tasks,
      taskGraph,
      pendingDecisions: listPendingDecisions(this.db, { changeId }),
      artifacts: listArtifacts(this.db, { changeId }),
    };
  }
}

export type FactoryDb = Db;
