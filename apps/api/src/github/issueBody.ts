export interface TaskIssueBodyContext {
  taskId: string;
  taskNumber: number | null;
  objective: string;
  scope: string | null;
  risk: string;
  status: string;
  changeId: string;
  changeTitle: string | null;
  changeIssueNumber: number | null;
  capabilityName: string | null;
  dependencyIssues: Array<{ number: number | null; title: string }>;
  requirements?: string[];
  inputs?: string[];
  outputs?: string[];
  tddHint?: string;
  verification?: string;
}

function bulletList(values: string[] | undefined): string {
  if (values && values.length > 0) {
    return values.map((value) => `- ${value}`).join("\n");
  }
  return "- —";
}

export function renderTaskIssueBody(context: TaskIssueBodyContext): string {
  const capabilityLine = context.capabilityName
    ? `- Capability: \`${context.capabilityName}\``
    : `- Capability: (not assigned)`;
  const parentLine =
    context.changeIssueNumber != null
      ? `- Change: \`${context.changeTitle ?? context.changeId}\` (parent issue #${context.changeIssueNumber})`
      : `- Change: \`${context.changeTitle ?? context.changeId}\``;
  const taskLine =
    context.taskNumber != null
      ? `- Task: \`${context.taskId}\` (#${context.taskNumber})`
      : `- Task: \`${context.taskId}\``;
  const dependencyLines =
    context.dependencyIssues.length > 0
      ? context.dependencyIssues
          .map((dependency) => {
            const link = dependency.number != null ? `#${dependency.number}` : "unpublished task";
            return `- ${link} — ${dependency.title}`;
          })
          .join("\n")
      : "- —";

  return [
    "## Objective",
    "",
    context.objective,
    "",
    "## Requirements",
    "",
    bulletList(context.requirements),
    "",
    "## Scope",
    "",
    context.scope ?? "—",
    "",
    "## Inputs",
    "",
    bulletList(context.inputs),
    "",
    "## Outputs",
    "",
    bulletList(context.outputs),
    "",
    "## TDD",
    "",
    context.tddHint ?? "Tests are written before implementation per project policy.",
    "",
    "## Verification",
    "",
    context.verification ?? "—",
    "",
    "## Dependencies",
    "",
    dependencyLines,
    "",
    "## Factory metadata",
    "",
    taskLine,
    parentLine,
    capabilityLine,
    `- Status: \`${context.status}\``,
    `- Risk: \`${context.risk}\``,
    "",
  ].join("\n");
}
