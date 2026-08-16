import type {
  OpenSpecCapabilityDelta,
  OpenSpecDesignArtifact,
  OpenSpecProposalArtifact,
  OpenSpecTaskGroup,
} from "./types.js";

export function renderProposalMarkdown(proposal: OpenSpecProposalArtifact): string {
  const lines: string[] = [];
  lines.push("## Why", "", proposal.why.trim(), "", "## What Changes", "");
  lines.push(...proposal.whatChanges.map((item) => `- ${item}`));
  lines.push("", "## Capabilities", "", "### New Capabilities");
  for (const capability of proposal.newCapabilities) {
    lines.push(`- \`${capability.name}\`: ${capability.description}`);
  }
  lines.push("", "### Modified Capabilities");
  for (const capability of proposal.modifiedCapabilities) {
    lines.push(`- \`${capability.name}\`: ${capability.change}`);
  }
  lines.push("", "## Impact");
  lines.push(...proposal.impact.map((item) => `- ${item}`));
  return lines.join("\n").trimEnd() + "\n";
}

export function renderDesignMarkdown(design: OpenSpecDesignArtifact): string {
  const lines: string[] = [];
  lines.push("## Context");
  lines.push(...design.context.map((item) => `- ${item}`));
  lines.push("", "## Goals / Non-Goals", "", "**Goals:**");
  lines.push(...design.goals.map((item) => `- ${item}`));
  lines.push("", "**Non-Goals:**");
  lines.push(...design.nonGoals.map((item) => `- ${item}`));
  lines.push("", "## Decisions");
  lines.push(...design.decisions.map((item) => `- ${item}`));
  lines.push("", "## Risks / Trade-offs");
  lines.push(...design.risks.map((item) => `- ${item}`));
  return lines.join("\n").trimEnd() + "\n";
}

export function renderSpecMarkdown(capability: OpenSpecCapabilityDelta): string {
  const lines: string[] = [];
  lines.push("## ADDED Requirements", "");
  for (const requirement of capability.requirements) {
    lines.push(`### Requirement: ${requirement.name}`, "");
    lines.push(requirement.text.trim(), "");
    for (const scenario of requirement.scenarios) {
      lines.push(`#### Scenario: ${scenario.scenario}`, "");
      lines.push(`- **WHEN** ${scenario.when}`, "");
      lines.push(`- **THEN** ${scenario.then}`, "");
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function renderTasksMarkdown(groups: OpenSpecTaskGroup[]): string {
  const lines: string[] = [];
  groups.forEach((group, groupIndex) => {
    lines.push(`## ${groupIndex + 1}. ${group.group}`, "");
    group.items.forEach((item, itemIndex) => {
      lines.push(`- [ ] ${groupIndex + 1}.${itemIndex + 1} ${item}`);
    });
    lines.push("");
  });
  return lines.join("\n").trimEnd() + "\n";
}
