import { describe, expect, it } from "vitest";
import { DuplicateError, NotFoundError, ValidationError } from "../../src/domain/errors.js";
import { createTestChange, createTestContext, createTestProject } from "../helpers.js";

describe("factory project persistence", () => {
  it("persists a project and retrieves it with repositories", async () => {
    const { store } = createTestContext();
    const project = await store.createProject({
      name: "Invoice App",
      slug: "invoice-app",
      description: "Small invoicing product.",
    });

    const repository = await store.addRepository({
      projectId: project.id,
      name: "invoice-backend",
      url: "https://github.com/example/invoice-backend",
      localPath: "../invoice-backend",
      isPrimary: true,
    });
    expect(repository.isPrimary).toBe(true);

    const retrieved = await store.getProjectWithRepositories(project.id);
    expect(retrieved.project.name).toBe("Invoice App");
    expect(retrieved.repositories).toHaveLength(1);
    expect(retrieved.repositories[0]?.name).toBe("invoice-backend");
  });

  it("rejects duplicate slugs and unknown projects", async () => {
    const { store } = createTestContext();
    await store.createProject({ name: "Slugged", slug: "the-slug" });
    await expect(store.createProject({ name: "Other", slug: "the-slug" })).rejects.toBeInstanceOf(
      DuplicateError,
    );

    await expect(store.getProjectWithRepositories("missing")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      store.addRepository({
        projectId: "missing",
        name: "x",
        url: "https://example.com/x",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects invalid slugs and repository input", async () => {
    const { store } = createTestContext();
    await expect(store.createProject({ name: "Bad", slug: " " })).rejects.toBeInstanceOf(
      ValidationError,
    );

    const project = await store.createProject({ name: "Repo", slug: "repo" });
    await expect(
      store.addRepository({ projectId: project.id, name: " ", url: " " }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("persists a change with capabilities, tasks, and artifacts", async () => {
    const { store } = createTestContext();
    const { projectId } = await createTestProject(store);
    const { changeId } = await createTestChange(store, projectId);

    const capability = await store.addCapability({
      changeId,
      name: "Authentication",
      summary: "Sign in flows.",
    });
    const task = await store.createTask({
      changeId,
      capabilityId: capability.id,
      objective: "Implement sign-in.",
      risk: "high",
    });
    await store.recordArtifact({
      changeId,
      kind: "impact_manifest",
      summary: "Impacted modules.",
    });
    await store.recordArtifact({
      taskId: task.id,
      changeId,
      kind: "openspec_proposal",
      summary: "Proposal artifact.",
    });

    const state = await store.getChangeWithState(changeId);
    expect(state.change.id).toBe(changeId);
    expect(state.capabilities).toHaveLength(1);
    expect(state.tasks).toHaveLength(1);
    expect(state.taskGraph.isAcyclic).toBe(true);
    expect(state.artifacts).toHaveLength(2);
    expect(await store.listArtifacts({ taskId: task.id })).toHaveLength(1);

    const changes = await store.listChanges(projectId);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.id).toBe(changeId);
  });

  it("records and lists execution events", async () => {
    const { store } = createTestContext();
    await store.recordEvent({
      entityType: "project",
      entityId: "p1",
      eventType: "test.event",
      payload: { reason: "verification" },
    });

    const events = await store.listEvents({ entityType: "project", entityId: "p1" });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("test.event");
    expect(events[0]?.payloadJson).toContain("verification");
  });
});
