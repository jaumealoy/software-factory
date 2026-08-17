import type { TaskRunContext, TaskRunStage } from "../runner/types.js";

/**
 * Builds the developer-facing message handed to `kilo run` for a task.
 * It encodes the factory's TDD boundary and the verification step.
 */
export function buildTaskPrompt(context: TaskRunContext): string {
  const artifactLines =
    context.artifactPaths.length > 0
      ? context.artifactPaths.map((artifact) => `- ${artifact}`).join("\n")
      : "- (none; follow the task objective)";

  return [
    `Implement the task "${context.taskObjective}" for change "${context.changeTitle}".`,
    "",
    "## Working agreement",
    "- Write the tests FIRST, commit them, then implement until the tests pass.",
    "- Do not change behavior outside the task scope.",
    "- Keep changes minimal and focused.",
    "",
    ...phaseInstruction(context.phase),
    "## Specification artifacts",
    artifactLines,
    "",
    `## Verification`,
    `Run \`${context.testCommand ?? "the repository's test command"}\` and make sure it passes.`,
    "",
    "Report a summary of what changed and the verification result.",
  ].join("\n");
}

function phaseInstruction(phase: TaskRunStage | undefined): string[] {
  switch (phase) {
    case "TEST_IMPLEMENTATION":
      return [
        "## This phase",
        "Write the failing tests for the task and COMMIT them. Do not implement the production code yet.",
      ];
    case "IMPLEMENTATION":
      return [
        "## This phase",
        "The tests already exist. Implement the production code until the tests pass, then run the verification command.",
      ];
    default:
      return [];
  }
}
