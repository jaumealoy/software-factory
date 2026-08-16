export interface ProposedCapability {
  name: string;
  description: string;
}

export interface RefineOutput {
  title: string;
  summary: string;
  proposedCapabilities: ProposedCapability[];
  ambiguities: string[];
  risks: string[];
  expandedScope: boolean;
}

export interface RefineInput {
  requestText: string;
  projectName?: string;
}

export interface CritiqueOutput {
  findings: string[];
  recommendation: string;
  requiresHumanDecision: boolean;
}

export interface CritiqueInput {
  requestText: string;
  refinement: RefineOutput;
  existingSpecs?: string[];
}

export interface AnalyzeOutput {
  signals: string[];
  notes: string[];
}

export interface AnalyzeInput {
  requestText: string;
  refinement: RefineOutput;
}

export interface PlannedTask {
  objective: string;
  risk?: "low" | "medium" | "high";
}

export interface PlannedCapability {
  name: string;
  description: string;
  tasks: PlannedTask[];
}

export interface PlanOutput {
  capabilities: PlannedCapability[];
  /** Index-based planning for the planned task list: `{ capability, task }` pair references. */
  dependencies: Array<{ from: PlannedTaskRef; to: PlannedTaskRef }>;
}

export interface PlannedTaskRef {
  capability: number;
  task: number;
}

export interface PlanInput {
  requestText: string;
  refinement: RefineOutput;
  critique: CritiqueOutput;
  signals: string[];
  impactManifestId?: string;
}

export interface WorkflowProvider {
  refine(input: RefineInput): Promise<RefineOutput>;
  critique(input: CritiqueInput): Promise<CritiqueOutput>;
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>;
  plan(input: PlanInput): Promise<PlanOutput>;
}
