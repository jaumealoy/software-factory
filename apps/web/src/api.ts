export type ChangeStatus = string;
export type TaskStatus = string;

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  defaultModel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeSummary {
  id: string;
  projectId: string;
  title: string;
  summary: string | null;
  requestText: string;
  status: ChangeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  changeId: string;
  capabilityId: string | null;
  objective: string;
  scope: string | null;
  model: string | null;
  status: TaskStatus;
  risk: string;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
}

export interface KiloModel {
  id: string;
  provider: string;
  model: string;
}

export interface TaskModelResolution {
  model: string;
  source: "task" | "project" | "default";
}

export type TaskRunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTED";

export interface TaskRunEvent {
  type: string;
  stage: string | null;
  message?: string;
}

export interface TaskRunResult {
  status: TaskRunStatus;
  message: string | null;
  verificationPassed: boolean | null;
  verificationOutput: string | null;
  events: TaskRunEvent[];
}

export interface TaskRunRecord {
  id: string;
  createdAt: string;
  payload: TaskRunResult | null;
}

export interface TaskEdge {
  taskId: string;
  dependsOnTaskId: string;
}

export interface TaskGraph {
  tasks: TaskItem[];
  edges: TaskEdge[];
  isAcyclic: boolean;
}

export interface Capability {
  id: string;
  name: string;
  description: string | null;
}

export interface Artifact {
  id: string;
  changeId: string | null;
  taskId: string | null;
  kind: string;
  path: string | null;
  uri: string | null;
  summary: string | null;
  validationResult: string | null;
  createdAt: string;
}

export interface Decision {
  id: string;
  changeId: string;
  problem: string;
  optionsJson: string;
  recommendation: string | null;
  rationale: string | null;
  status: string;
  resolutionNote: string | null;
  createdAt: string;
}

export interface ExecutionEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  payloadJson: string | null;
  createdAt: string;
}

export interface ChangeDetail {
  change: ChangeSummary;
  capabilities: Capability[];
  tasks: TaskItem[];
  taskGraph: TaskGraph;
  pendingDecisions: Decision[];
  artifacts: Artifact[];
  events: ExecutionEvent[];
}

export type WorkflowPhase = "completed" | "awaiting_decision";

export interface WorkflowResult {
  changeId: string;
  phase: WorkflowPhase;
  decisionId: string | null;
  tasksCreated: number;
  capabilitiesCreated: number;
  openspecName: string | null;
  impactArtifactId: string | null;
}

export interface CreateChangeResponse {
  workflow: WorkflowResult;
  pendingDecisions: Decision[];
}

export interface ResolveDecisionResponse {
  decision: Decision;
  workflow: WorkflowResult | null;
  pendingDecisions: Decision[];
}

export interface CreateChangePayload {
  projectId: string;
  title: string;
  requestText: string;
  repositoryPath: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number | null;
}

export interface DirectoryListing {
  exists: boolean;
  path: string;
  entries: FileEntry[];
  message?: string;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  binary: boolean;
}

export interface ProviderCredentialView {
  provider: string;
  configured: boolean;
  masked: string | null;
}

export interface Session {
  id: string;
  taskId: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";
  outcome: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SessionEvent {
  id: number;
  type: string;
  stage: string | null;
  message: string | null;
  detail?: string;
  data: Record<string, unknown> | null;
}

export interface ChatMessage {
  id: number;
  sessionId: string;
  direction: "user" | "agent";
  text: string;
  timestamp: string;
}

export type DiffStatus = "modified" | "new" | "deleted";

export interface DiffLine {
  type: "add" | "del" | "ctx";
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  status: DiffStatus;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface WorkingDiff {
  files: DiffFile[];
  empty: boolean;
}

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep default
    }
    throw new Error(message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  listProjects: () => request<Project[]>("/api/projects"),

  listModels: () => request<{ models: KiloModel[] }>("/api/models"),

  setTaskModel: (taskId: string, model: string | null) =>
    request<{ task: TaskItem; model: TaskModelResolution }>(`/api/tasks/${taskId}/model`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    }),

  setProjectDefaultModel: (projectId: string, model: string | null) =>
    request<Project>(`/api/projects/${projectId}/model`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    }),

  runTask: (taskId: string, repositoryPath: string) =>
    request<{ result: TaskRunResult }>(`/api/tasks/${taskId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repositoryPath }),
    }),

  getTaskRuns: (taskId: string) => request<{ runs: TaskRunRecord[] }>(`/api/tasks/${taskId}/runs`),

  listChanges: (projectId?: string) =>
    request<ChangeSummary[]>(
      `/api/changes${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
    ),

  getChange: (changeId: string) => request<ChangeDetail>(`/api/changes/${changeId}`),

  createChange: (payload: CreateChangePayload) =>
    request<CreateChangeResponse>("/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),

  resolveDecision: (decisionId: string, payload: { approved: boolean; repositoryPath: string }) =>
    request<ResolveDecisionResponse>(`/api/decisions/${decisionId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),

  listFiles: (projectId: string, dirPath?: string) =>
    request<DirectoryListing>(
      `/api/projects/${projectId}/files${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ""}`,
    ),

  readFileContent: (projectId: string, path: string) =>
    request<FileContent>(
      `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
    ),

  listProviderCredentials: () =>
    request<{ providers: ProviderCredentialView[] }>("/api/settings/providers"),

  setProviderCredential: (provider: string, key: string) =>
    request<ProviderCredentialView>(`/api/settings/providers/${provider}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    }),

  removeProviderCredential: (provider: string) =>
    request<null>(`/api/settings/providers/${provider}`, { method: "DELETE" }),

  listFavorites: () => request<{ models: string[] }>("/api/favorites"),

  addFavorite: (model: string) =>
    request<{ model: string; models: string[] }>("/api/favorites", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    }),

  removeFavorite: (model: string) =>
    request<null>("/api/favorites", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    }),

  startSession: (payload: { taskId: string; repositoryPath: string; model?: string }) =>
    request<{ sessionId: string; streamUrl: string }>("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),

  getSession: (sessionId: string) => request<{ session: Session }>(`/api/sessions/${sessionId}`),

  getSessionMessages: (sessionId: string) =>
    request<{ messages: ChatMessage[] }>(`/api/sessions/${sessionId}/messages`),

  sendSessionMessage: (sessionId: string, text: string) =>
    request<{ message: SessionEvent }>(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),

  getWorkingDiff: (projectId: string) =>
    request<{ diff: WorkingDiff }>(`/api/projects/${projectId}/diff`),

  saveFile: (projectId: string, path: string, content: string) =>
    request<FileContent>(`/api/projects/${projectId}/files`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content }),
    }),
};
