import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { LegacyInventory, SourceAdapter } from "../../core/adapters/source-adapter.js";
import type { MigrationTask } from "../../core/adapters/target-adapter.js";
import {
  approveArchitecture,
  architectureDecisionSchema,
  type ArchitectureDecision,
} from "../../core/architecture/architecture-decision.js";
import type { TargetArchitectureProfile } from "../../core/architecture/target-profile.js";
import type { Criterion } from "../../core/criteria/criteria.types.js";
import type { MigrationLoopContext } from "../../core/loop/migration-loop.js";
import type { SessionStore } from "../../core/session/file-session-store.js";
import { migrationSessionSchema, sessionStageSchema, type MigrationSession } from "../../core/session/migration-session.js";
import type { WorkspaceArtifactStore } from "../../core/session/workspace-artifact-store.js";
import { parseCliCommand } from "./commands.js";
import {
  renderArchitectures,
  renderCriteria,
  renderDiff,
  renderEvaluation,
  renderHelp,
  renderPlan,
  renderRunResult,
  renderSession,
} from "./render.js";

export type ReplDependencies = {
  input: Readable;
  output: Writable;
  workspace: string;
  sessionStore: SessionStore;
  migrationLoop: {
    runNext(context: MigrationLoopContext): Promise<MigrationLoopContext>;
  };
  sourceAdapter: SourceAdapter;
  candidateProfiles: readonly TargetArchitectureProfile[];
  artifacts: WorkspaceArtifactStore;
  criteria: readonly Criterion[];
  planTasks?: (inventory: LegacyInventory, decision: ArchitectureDecision) => Promise<MigrationTask[]>;
  clock?: () => Date;
  approvedBy?: string;
};

type PauseMetadata = {
  sessionId: string;
  pausedFromStage: MigrationSession["stage"];
  pausedAt: string;
};

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function parseYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"")) return JSON.parse(trimmed) as string;
  return trimmed;
}

function looperTextPath(workspace: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error("Looper artifact path must be relative");
  const root = resolve(workspace, ".looper");
  const filePath = resolve(root, relativePath);
  const back = relative(root, filePath);
  if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    throw new Error("Looper artifact path escapes .looper");
  }
  return filePath;
}

async function saveLooperText(workspace: string, relativePath: string, content: string): Promise<void> {
  const filePath = looperTextPath(workspace, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

async function loadLooperText(workspace: string, relativePath: string): Promise<string | undefined> {
  try {
    return await readFile(looperTextPath(workspace, relativePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function architectureDecisionYaml(decision: ArchitectureDecision, profile: TargetArchitectureProfile): string {
  return [
    `id: ${quoteYaml(decision.id)}`,
    `profileId: ${quoteYaml(decision.profileId)}`,
    `profileName: ${quoteYaml(profile.name)}`,
    `revision: ${decision.revision}`,
    `approvedBy: ${quoteYaml(decision.approvedBy)}`,
    `approvedAt: ${quoteYaml(decision.approvedAt)}`,
    "moduleBoundaries:",
    ...profile.moduleBoundaries.map(boundary => `  - ${quoteYaml(boundary)}`),
  ].join("\n");
}

function criteriaYaml(session: MigrationSession, criteria: readonly Criterion[]): string {
  return [
    `revision: ${session.criteriaRevision}`,
    ...(session.approvedCriteriaRevision === undefined ? [] : [`approvedRevision: ${session.approvedCriteriaRevision}`]),
    "passThreshold: 90",
    "criteria:",
    ...criteria.flatMap(criterion => [
      `  - id: ${quoteYaml(criterion.id)}`,
      `    kind: ${quoteYaml(criterion.kind)}`,
      `    category: ${quoteYaml(criterion.category)}`,
      `    weight: ${criterion.weight}`,
      `    requiredConfidence: ${criterion.requiredConfidence}`,
    ]),
  ].join("\n");
}

function planYaml(session: MigrationSession, tasks: readonly MigrationTask[]): string {
  return [
    `sessionId: ${quoteYaml(session.id)}`,
    `iteration: ${session.iteration}`,
    "tasks:",
    ...tasks.flatMap(task => [
      `  - id: ${quoteYaml(task.id)}`,
      "    programIds:",
      ...(task.programIds.length ? task.programIds.map(programId => `      - ${quoteYaml(programId)}`) : ["      []"]),
      "    allowedPaths:",
      ...(task.allowedPaths.length ? task.allowedPaths.map(path => `      - ${quoteYaml(path)}`) : ["      []"]),
      `    status: ${quoteYaml(session.completedTaskIds.includes(task.id) ? "completed" : task.id === session.activeTaskId ? "active" : "pending")}`,
    ]),
  ].join("\n");
}

export function parseMigrationPlanYaml(raw: string): MigrationTask[] {
  const tasks: MigrationTask[] = [];
  let current: MigrationTask | undefined;
  let list: "programIds" | "allowedPaths" | undefined;

  for (const line of raw.split(/\r?\n/)) {
    const taskMatch = /^\s*-\s+id:\s*(.+)\s*$/.exec(line);
    if (taskMatch) {
      current = { id: parseYamlScalar(taskMatch[1]!), programIds: [], allowedPaths: [] };
      tasks.push(current);
      list = undefined;
      continue;
    }

    if (!current) continue;

    const listMatch = /^\s*(programIds|allowedPaths):\s*$/.exec(line);
    if (listMatch) {
      list = listMatch[1] as "programIds" | "allowedPaths";
      continue;
    }

    const emptyListMatch = /^\s*(programIds|allowedPaths):\s*\[\]\s*$/.exec(line);
    if (emptyListMatch) {
      current[emptyListMatch[1] as "programIds" | "allowedPaths"] = [];
      list = undefined;
      continue;
    }

    const itemMatch = /^\s*-\s+(.+)\s*$/.exec(line);
    if (itemMatch && list) {
      current[list].push(parseYamlScalar(itemMatch[1]!));
    }
  }

  return tasks.filter(task => task.id.trim().length > 0);
}

function parseFlatYaml(raw: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.+)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (!key || value === undefined) continue;
    entries[key] = value.startsWith("\"") ? JSON.parse(value) as string : value;
  }
  return entries;
}

async function loadArchitectureDecision(workspace: string): Promise<ArchitectureDecision | undefined> {
  const raw = await loadLooperText(workspace, "decisions/target-architecture.yaml");
  if (!raw) return undefined;
  const flat = parseFlatYaml(raw);
  if (!flat.id || !flat.profileId || !flat.revision || !flat.approvedBy || !flat.approvedAt) return undefined;
  return architectureDecisionSchema.parse({
    id: flat.id,
    profileId: flat.profileId,
    revision: Number.parseInt(flat.revision, 10),
    approvedBy: flat.approvedBy,
    approvedAt: flat.approvedAt,
  });
}

function initialStage(session: MigrationSession): MigrationSession["stage"] {
  if (!session.architectureDecisionId) return "ARCHITECTURE_REVIEW";
  if (session.approvedCriteriaRevision !== session.criteriaRevision) return "CRITERIA_REVIEW";
  return "READY";
}

function createSession(workspace: string, now: string): MigrationSession {
  return migrationSessionSchema.parse({
    id: `session-${randomUUID()}`,
    workspace,
    stage: "DISCOVERY",
    iteration: 0,
    criteriaRevision: 1,
    scoreHistory: [],
    completedTaskIds: [],
    risks: [],
    createdAt: now,
    updatedAt: now,
  });
}

function withUpdatedSession(
  session: MigrationSession,
  updates: Partial<Omit<MigrationSession, "createdAt">>,
  now: string,
): MigrationSession {
  return migrationSessionSchema.parse({
    ...session,
    ...updates,
    updatedAt: now,
  });
}

export function buildPauseTransition(
  session: MigrationSession,
  pausedAt: string,
): { session: MigrationSession; alreadyPaused: boolean; metadata?: PauseMetadata } {
  const paused = withUpdatedSession(session, { stage: "PAUSED" }, pausedAt);
  if (session.stage === "PAUSED") return { session: paused, alreadyPaused: true };
  return {
    session: paused,
    alreadyPaused: false,
    metadata: {
      sessionId: session.id,
      pausedFromStage: session.stage,
      pausedAt,
    },
  };
}

async function persistCriteria(workspace: string, session: MigrationSession, criteria: readonly Criterion[]): Promise<void> {
  await saveLooperText(workspace, "criteria.yaml", criteriaYaml(session, criteria));
}

async function persistPlan(workspace: string, session: MigrationSession, tasks: readonly MigrationTask[]): Promise<void> {
  await saveLooperText(workspace, "plan.yaml", planYaml(session, tasks));
}

async function loadPersistedPlan(workspace: string): Promise<MigrationTask[] | undefined> {
  const raw = await loadLooperText(workspace, "plan.yaml");
  if (!raw) return undefined;
  const tasks = parseMigrationPlanYaml(raw);
  return tasks.length > 0 ? tasks : undefined;
}

async function persistPauseMetadata(workspace: string, metadata: PauseMetadata): Promise<void> {
  await saveLooperText(workspace, "state/pause.json", JSON.stringify(metadata, null, 2));
}

async function loadPauseMetadata(workspace: string, sessionId: string): Promise<PauseMetadata | undefined> {
  const raw = await loadLooperText(workspace, "state/pause.json");
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as Partial<PauseMetadata>;
  if (parsed.sessionId !== sessionId || typeof parsed.pausedAt !== "string") return undefined;
  const stage = sessionStageSchema.safeParse(parsed.pausedFromStage);
  if (!stage.success || stage.data === "PAUSED") return undefined;
  return { sessionId, pausedFromStage: stage.data, pausedAt: parsed.pausedAt };
}

function isLegacyInventory(value: unknown): value is LegacyInventory {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LegacyInventory>;
  return typeof candidate.sourceKind === "string"
    && typeof candidate.sourceRoot === "string"
    && Array.isArray(candidate.programs)
    && Array.isArray(candidate.copybookFiles)
    && Array.isArray(candidate.risks);
}

async function loadDiscoveryInventory(
  artifacts: WorkspaceArtifactStore,
  sessionId: string,
): Promise<LegacyInventory | undefined> {
  try {
    const discovery = await artifacts.loadJson("evidence/discovery.json") as { sessionId?: unknown; inventory?: unknown };
    if (discovery.sessionId !== sessionId || !isLegacyInventory(discovery.inventory)) return undefined;
    return discovery.inventory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof Error && error.message === ".looper directory does not exist") return undefined;
    throw error;
  }
}

async function buildInitialContext(dependencies: ReplDependencies): Promise<{
  context: MigrationLoopContext;
  architectureDecision?: ArchitectureDecision;
}> {
  const now = (dependencies.clock ?? (() => new Date()))().toISOString();
  const loadedSession = await dependencies.sessionStore.load();
  let session = loadedSession ?? createSession(dependencies.workspace, now);
  let inventory = loadedSession ? await loadDiscoveryInventory(dependencies.artifacts, session.id) : undefined;
  if (!inventory) {
    inventory = await dependencies.sourceAdapter.discover(dependencies.workspace);
    await dependencies.artifacts.saveJson("evidence/discovery.json", {
      sessionId: session.id,
      discoveredAt: now,
      inventory,
    });
  }
  session = withUpdatedSession(session, {
    stage: session.stage === "DISCOVERY" ? initialStage(session) : session.stage,
    risks: inventory.risks,
  }, now);
  await dependencies.sessionStore.save(session);
  const architectureDecision = await loadArchitectureDecision(dependencies.workspace);
  return {
    context: {
      session,
      inventory,
      ...(architectureDecision ? { architectureDecision } : {}),
      tasks: [],
    },
    ...(architectureDecision ? { architectureDecision } : {}),
  };
}

export async function startRepl(dependencies: ReplDependencies): Promise<void> {
  let { context, architectureDecision } = await buildInitialContext(dependencies);
  let tasks: MigrationTask[] = [];
  const output = dependencies.output;
  const rl = createInterface({ input: dependencies.input, output });

  output.write(`${renderHelp()}\n\n${renderSession(context.session)}\n\nlooper> `);

  async function saveSession(session: MigrationSession): Promise<void> {
    context = { ...context, session };
    await dependencies.sessionStore.save(session);
  }

  async function ensurePlan(): Promise<MigrationTask[]> {
    if (tasks.length > 0) return tasks;
    if (!architectureDecision) return tasks;
    const persistedTasks = await loadPersistedPlan(dependencies.workspace);
    if (persistedTasks) {
      tasks = persistedTasks;
      return tasks;
    }
    tasks = dependencies.planTasks ? await dependencies.planTasks(context.inventory, architectureDecision) : context.tasks;
    await persistPlan(dependencies.workspace, context.session, tasks);
    return tasks;
  }

  try {
    for await (const line of rl) {
      if (!line.trim()) {
        output.write("\nlooper> ");
        continue;
      }

      try {
        const command = parseCliCommand(line);
        if (command.name === "exit") break;

        if (command.name === "architectures") {
          output.write(`${renderArchitectures(dependencies.candidateProfiles)}\n`);
        } else if (command.name === "status") {
          output.write(`${renderSession(context.session)}\n`);
        } else if (command.name === "criteria") {
          await persistCriteria(dependencies.workspace, context.session, dependencies.criteria);
          output.write(`${renderCriteria(dependencies.criteria, context.session)}\n`);
        } else if (command.name === "approve") {
          const [kind, value] = command.args;
          if (kind === "architecture") {
            const profile = dependencies.candidateProfiles.find(candidate => candidate.id === value);
            if (!profile) throw new Error(`Unknown architecture profile: ${value ?? ""}`);
            architectureDecision = approveArchitecture(
              profile,
              dependencies.approvedBy ?? "terminal-user",
              (dependencies.clock ?? (() => new Date()))().toISOString(),
            );
            const nextSession = withUpdatedSession(context.session, {
              architectureDecisionId: architectureDecision.id,
              stage: "CRITERIA_REVIEW",
            }, (dependencies.clock ?? (() => new Date()))().toISOString());
            context = { ...context, architectureDecision };
            await saveLooperText(dependencies.workspace, "decisions/target-architecture.yaml", architectureDecisionYaml(architectureDecision, profile));
            await saveSession(nextSession);
            output.write(`Approved architecture ${profile.id}. Review /criteria next.\n`);
          } else if (kind === "criteria") {
            const revision = Number.parseInt(value ?? "", 10);
            if (!Number.isInteger(revision)) throw new Error("Criteria approval requires a numeric revision");
            if (revision !== context.session.criteriaRevision) {
              throw new Error(`Current criteria revision is ${context.session.criteriaRevision}`);
            }
            if (!context.session.architectureDecisionId || !architectureDecision) {
              throw new Error("Approve architecture before criteria");
            }
            const nextSession = withUpdatedSession(context.session, {
              approvedCriteriaRevision: revision,
              stage: "READY",
            }, (dependencies.clock ?? (() => new Date()))().toISOString());
            await persistCriteria(dependencies.workspace, nextSession, dependencies.criteria);
            await saveSession(nextSession);
            output.write(`Approved criteria revision ${revision}. Use /plan or /run.\n`);
          } else {
            throw new Error("Usage: /approve architecture <profile-id> or /approve criteria <revision>");
          }
        } else if (command.name === "plan") {
          const plannedTasks = await ensurePlan();
          output.write(`${renderPlan(plannedTasks, context.session)}\n`);
        } else if (command.name === "run") {
          if (context.session.stage === "PAUSED") throw new Error("Session is paused. Use /resume before /run.");
          if (!architectureDecision || !context.session.architectureDecisionId) {
            throw new Error("Architecture approval is required before /run");
          }
          if (context.session.approvedCriteriaRevision !== context.session.criteriaRevision) {
            throw new Error("Criteria approval is required before /run");
          }
          const plannedTasks = await ensurePlan();
          let runSession = context.session;
          const requestedTaskId = command.args[0];
          if (requestedTaskId) {
            const requestedTask = plannedTasks.find(task => task.id === requestedTaskId);
            if (!requestedTask) throw new Error(`Unknown migration task: ${requestedTaskId}`);
            if (context.session.completedTaskIds.includes(requestedTaskId)) {
              throw new Error(`Migration task is already completed: ${requestedTaskId}`);
            }
            runSession = withUpdatedSession(context.session, {
              activeTaskId: requestedTask.id,
            }, (dependencies.clock ?? (() => new Date()))().toISOString());
          }
          context = await dependencies.migrationLoop.runNext({
            ...context,
            session: runSession,
            architectureDecision,
            tasks: plannedTasks,
          });
          tasks = context.tasks;
          await persistPlan(dependencies.workspace, context.session, tasks);
          output.write(`${renderRunResult(context)}\n`);
        } else if (command.name === "diff") {
          output.write(`${renderDiff(context)}\n`);
        } else if (command.name === "score") {
          output.write(`${renderEvaluation(context.lastEvaluation)}\n`);
        } else if (command.name === "pause") {
          const pausedAt = (dependencies.clock ?? (() => new Date()))().toISOString();
          const transition = buildPauseTransition(context.session, pausedAt);
          if (transition.metadata) await persistPauseMetadata(dependencies.workspace, transition.metadata);
          await saveSession(transition.session);
          output.write(transition.alreadyPaused ? "Session is already PAUSED.\n" : "Session saved as PAUSED.\n");
        } else if (command.name === "resume") {
          const loaded = await dependencies.sessionStore.load();
          if (!loaded) throw new Error("No saved session found");
          architectureDecision = await loadArchitectureDecision(dependencies.workspace) ?? architectureDecision;
          const resumed = loaded.stage === "PAUSED"
            ? withUpdatedSession(loaded, {
              stage: (await loadPauseMetadata(dependencies.workspace, loaded.id))?.pausedFromStage ?? initialStage(loaded),
            }, (dependencies.clock ?? (() => new Date()))().toISOString())
            : loaded;
          context = {
            ...context,
            session: resumed,
            ...(architectureDecision ? { architectureDecision } : {}),
          };
          await dependencies.sessionStore.save(resumed);
          output.write(`${renderSession(resumed)}\n`);
        }
      } catch (error) {
        output.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      output.write("\nlooper> ");
    }
  } finally {
    rl.close();
  }
}
