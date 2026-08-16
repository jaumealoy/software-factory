export interface OpenSpecScenario {
  scenario: string;
  when: string;
  then: string;
}

export interface OpenSpecRequirement {
  name: string;
  text: string;
  scenarios: OpenSpecScenario[];
}

export interface OpenSpecCapabilityDelta {
  name: string;
  requirements: OpenSpecRequirement[];
}

export interface OpenSpecNewCapability {
  name: string;
  description: string;
}

export interface OpenSpecModifiedCapability {
  name: string;
  change: string;
}

export interface OpenSpecProposalArtifact {
  why: string;
  whatChanges: string[];
  newCapabilities: OpenSpecNewCapability[];
  modifiedCapabilities: OpenSpecModifiedCapability[];
  impact: string[];
}

export interface OpenSpecDesignArtifact {
  context: string[];
  goals: string[];
  nonGoals: string[];
  decisions: string[];
  risks: string[];
}

export interface OpenSpecTaskGroup {
  group: string;
  items: string[];
}

export interface OpenSpecChangeArtifacts {
  proposal: OpenSpecProposalArtifact;
  design: OpenSpecDesignArtifact;
  specs: OpenSpecCapabilityDelta[];
  tasks: OpenSpecTaskGroup[];
}

export interface OpenSpecIssue {
  level: "ERROR" | "WARN";
  path: string | null;
  message: string;
}

export interface OpenSpecValidationResult {
  valid: boolean;
  issues: OpenSpecIssue[];
  durationMs: number;
}

export interface OpenSpecPreflight {
  configured: boolean;
  openspecRoot: string;
  configPath: string;
}

export interface OpenSpecChangeRecord {
  kind: "openspec_proposal" | "openspec_design" | "openspec_spec" | "openspec_tasks";
  relativePath: string;
  content: string;
}

export interface CreateOpenSpecChangeInput {
  /** Factory change the OpenSpec change is generated for. */
  changeId: string;
  /** Path to the target product repository (the factory operates on). */
  repoPath: string;
  /** Kebab-case change identifier, e.g. `add-user-auth`. */
  name: string;
  artifacts: OpenSpecChangeArtifacts;
  /** Allow `openspec new change` to create the OpenSpec config when missing. */
  autoInit?: boolean;
  sourceRevision?: string;
}

export interface OpenSpecChangeResult {
  name: string;
  changeRoot: string;
  validation: OpenSpecValidationResult;
}
