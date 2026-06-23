import { join, resolve } from "node:path";
import { buildSpringBootTargetAdapter } from "../../adapters/target/spring-boot/spring-boot-target-adapter.js";
import { loadConfig } from "../../config/env.js";
import { buildCobolSourceAdapter } from "../../adapters/source/cobol/cobol-source-adapter.js";
import { buildFileCheckpointStore } from "../../core/checkpoint/file-checkpoint.store.js";
import { buildMigrationLoop, type MigrationLoopContext } from "../../core/loop/migration-loop.js";
import { buildFileSessionStore, type SessionStore } from "../../core/session/file-session-store.js";
import { buildWorkspaceArtifactStore } from "../../core/session/workspace-artifact-store.js";
import { buildTraceLogger } from "../../core/trace/trace-logger.js";
import { startRepl } from "../../interfaces/cli/repl.js";
import { DeepSeekClient } from "../../models/deepseek/deepseek-client.js";
import { hollowSkinnyProfile } from "../../profiles/hollow-skinny/hollow-skinny.profile.js";
import { buildMavenTestTool } from "../../tools/maven.tool.js";

function buildSessionTraceLogger(
  tracePath: string,
  sessionStore: Pick<SessionStore, "load">,
): (type: string, data?: unknown) => Promise<void> {
  const loggers = new Map<string, ReturnType<typeof buildTraceLogger>>();

  return async (type, data) => {
    const session = await sessionStore.load();
    const runId = session?.id ?? "unknown-session";
    let logger = loggers.get(runId);
    if (!logger) {
      logger = buildTraceLogger(tracePath, runId);
      loggers.set(runId, logger);
    }
    await logger(type, data);
  };
}

try {
  const config = loadConfig();
  const workspace = process.cwd();
  const looperRoot = resolve(workspace, ".looper");
  const sourceAdapter = buildCobolSourceAdapter();
  const sessionStore = buildFileSessionStore(workspace);
  const artifacts = buildWorkspaceArtifactStore(workspace);
  const tracePath = join(looperRoot, "traces", "session.jsonl");
  const targetAdapter = buildSpringBootTargetAdapter({
    model: new DeepSeekClient({
      apiKey: config.DEEPSEEK_API_KEY,
      baseUrl: config.DEEPSEEK_BASE_URL,
      model: config.DEEPSEEK_MODEL,
      timeoutMs: config.MODEL_TIMEOUT_MS,
    }),
    outputDir: join(looperRoot, "generated"),
    profile: hollowSkinnyProfile,
    maven: buildMavenTestTool(),
  });
  const migrationLoop = buildMigrationLoop({
    sessionStore,
    source: sourceAdapter,
    target: targetAdapter,
    criteria: hollowSkinnyProfile.criteria,
    passThreshold: 90,
    maxRepairAttempts: 3,
    maxStagnantIterations: 2,
    checkpointStore: buildFileCheckpointStore<MigrationLoopContext>(looperRoot),
    artifacts,
    trace: buildSessionTraceLogger(tracePath, sessionStore),
  });

  await startRepl({
    input: process.stdin,
    output: process.stdout,
    workspace,
    sessionStore,
    migrationLoop,
    sourceAdapter,
    candidateProfiles: [hollowSkinnyProfile],
    artifacts,
    criteria: hollowSkinnyProfile.criteria,
    planTasks: (inventory, decision) => targetAdapter.plan(inventory, decision),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
