import { loadConfig } from "../config.js";
import { createDb, runMigrations } from "../db/index.js";
import { FactoryStore } from "../domain/index.js";
import { migrationsDir } from "../paths.js";

const DEMO_SLUG = "demo-factory";

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = createDb(config.DATABASE_PATH);
  runMigrations(handle.db, migrationsDir);
  const store = new FactoryStore(handle.db);

  const existing = (await store.listProjects()).find((project) => project.slug === DEMO_SLUG);
  if (existing) {
    console.log(`Demo project "${existing.name}" already exists (${existing.id}); skipping seed.`);
    handle.client.close();
    return;
  }

  const project = await store.createProject({
    name: "Demo Factory Project",
    slug: DEMO_SLUG,
    description: "Seeded local project used for development and tests.",
  });
  console.log(`Created project ${project.name} (${project.id})`);

  await store.addRepository({
    projectId: project.id,
    name: "software-factory",
    url: "https://github.com/jaumealoy/software-factory",
    localPath: "..",
    isPrimary: true,
  });
  console.log("Added primary repository software-factory.");

  const change = await store.createChange({
    projectId: project.id,
    title: "Add Google OAuth login",
    requestText: "Users should be able to sign in with their Google account.",
    summary: "Add Google OAuth authentication to the dashboard.",
  });
  console.log(`Created change "${change.title}" (${change.id})`);

  const authentication = await store.addCapability({
    changeId: change.id,
    name: "Authentication",
    summary: "Sign-in and sign-out flows powered by Google OAuth.",
  });
  const notifications = await store.addCapability({
    changeId: change.id,
    name: "Notifications",
    summary: "Notify users about sign-in events.",
  });

  const contractTask = await store.createTask({
    changeId: change.id,
    capabilityId: authentication.id,
    objective: "Define the OAuth contract (client id, redirects, token exchange).",
    risk: "medium",
  });
  const implementTask = await store.createTask({
    changeId: change.id,
    capabilityId: authentication.id,
    objective: "Implement the Google OAuth provider flow.",
    risk: "high",
  });
  const testTask = await store.createTask({
    changeId: change.id,
    capabilityId: notifications.id,
    objective: "Write and run the integration test layer for the OAuth flow",
    risk: "low",
  });

  await store.addTaskDependency({ taskId: implementTask.id, dependsOnTaskId: contractTask.id });
  await store.addTaskDependency({ taskId: testTask.id, dependsOnTaskId: implementTask.id });
  console.log(`Created ${change.title} task graph with 3 tasks.`);

  await store.recordArtifact({
    changeId: change.id,
    kind: "impact_manifest",
    summary: "Impact manifest for the OAuth change.",
    uri: "openspec://changes/add-google-oauth/impact",
  });

  await store.transitionChange(change.id, "REFINING");
  await store.transitionChange(change.id, "CRITIQUE");
  await store.transitionChange(change.id, "SPECIFYING");

  const pending = await store.requestDecision({
    changeId: change.id,
    problem: "Which OAuth library should we use?",
    options: ["openid-client", "passport", "auth.js"],
    recommendation: "openid-client",
    rationale: "Actively maintained and exposes a smaller API surface for a single provider.",
    resumeStatus: "ANALYZING",
  });
  console.log(`Requested decision "${pending.problem}" (${pending.id}).`);

  handle.client.close();
  console.log("Seed complete.");
}

void main();
