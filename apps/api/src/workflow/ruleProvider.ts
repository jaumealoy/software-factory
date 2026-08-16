import type {
  AnalyzeInput,
  AnalyzeOutput,
  CritiqueInput,
  CritiqueOutput,
  PlanInput,
  PlanOutput,
  PlannedCapability,
  RefineInput,
  RefineOutput,
  WorkflowProvider,
} from "./types.js";

/**
 * Deterministic, offline worker provider used for local runs and tests.
 * It never calls an external model, so the factory is fully usable without
 * API credentials; swapping in a real provider satisfies the LLM worker
 * contract without changing orchestration.
 */
export class RuleProvider implements WorkflowProvider {
  async refine(input: RefineInput): Promise<RefineOutput> {
    const requestText = input.requestText.trim();
    const firstSentence = requestText.split(/[.!?\n]/)[0]?.trim() ?? requestText;
    const hasDecisionConcern = /\b(or|scope|platform|conflict)\b/i.test(requestText);

    const proposedCapabilities = [
      {
        name: kebabCase(firstSentence) || "core-feature",
        description: firstSentence || "Capability backing the request",
      },
    ];

    return {
      title: firstSentence || "Untitled request",
      summary: requestText,
      proposedCapabilities,
      ambiguities: hasDecisionConcern ? ["Scope or platform choice hidden in the request"] : [],
      risks: ["unknown"],
      expandedScope: /\b(also|additionally|plus)\b/i.test(requestText),
    };
  }

  async critique(input: CritiqueInput): Promise<CritiqueOutput> {
    const findings: string[] = [];
    if (input.refinement.expandedScope) {
      findings.push("Request appears to expand product scope beyond a single feature.");
    }
    if (input.refinement.ambiguities.length > 0) {
      findings.push("Request contains an unresolved scope or platform choice.");
    }
    return {
      findings,
      recommendation:
        findings.length > 0
          ? "Resolve the flagged decisions before specification."
          : "Request is well-scoped for MVP 1.",
      requiresHumanDecision: findings.length > 0,
    };
  }

  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    return {
      signals: [
        ...new Set(
          [input.refinement.title]
            .concat(input.refinement.proposedCapabilities.map((capability) => capability.name))
            .filter((signal): signal is string => Boolean(signal)),
        ),
      ],
      notes: ["Rule-based analysis fallback"],
    };
  }

  async plan(input: PlanInput): Promise<PlanOutput> {
    const capabilities: PlannedCapability[] = input.refinement.proposedCapabilities.map(
      (capability) => ({
        name: capability.name,
        description: capability.description,
        tasks: [
          {
            objective: `Define contracts and scenarios for ${capability.name}`,
            risk: "medium" as const,
          },
          { objective: `Implement ${capability.name}`, risk: "high" as const },
          { objective: `Verify ${capability.name} with acceptance tests`, risk: "low" as const },
        ],
      }),
    );

    const dependencies: PlanOutput["dependencies"] = [];
    capabilities.forEach((capability, capabilityIndex) => {
      if (capability.tasks.length >= 3) {
        dependencies.push(
          {
            from: { capability: capabilityIndex, task: 1 },
            to: { capability: capabilityIndex, task: 0 },
          },
          {
            from: { capability: capabilityIndex, task: 2 },
            to: { capability: capabilityIndex, task: 1 },
          },
        );
      }
    });

    return { capabilities, dependencies };
  }
}

function kebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
