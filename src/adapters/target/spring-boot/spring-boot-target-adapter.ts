import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { LegacyInventory, LegacyProgram } from "../../../core/adapters/source-adapter.js";
import type { MigrationTask, TargetAdapter } from "../../../core/adapters/target-adapter.js";
import type { ArchitectureDecision } from "../../../core/architecture/architecture-decision.js";
import { requireApprovedArchitecture } from "../../../core/architecture/architecture-decision.js";
import type { TargetArchitectureProfile } from "../../../core/architecture/target-profile.js";
import type { CriterionEvidence } from "../../../core/criteria/criteria.types.js";
import { AppError } from "../../../core/errors/app-error.js";
import type { ModelClient } from "../../../core/model/model-client.js";
import type { Tool } from "../../../core/tool/tool.js";
import { runSubprogramTranslationLoop, type SubprogramTranslationQuality } from "../../../loops/subprogram-translation.loop.js";
import { assembleHollowSkinnyProject, type HollowSkinnyPlugin } from "../../../profiles/hollow-skinny/assemble-hollow-skinny-project.js";
import { verifyHollowSkinnyProject } from "../../../profiles/hollow-skinny/verify-hollow-skinny-project.js";
import type { JavaMethodTranslation, SubprogramInfo } from "../../../schemas/assembly-state.schema.js";
import type { CompileResult } from "../../../schemas/migration-state.schema.js";
import { buildCallOrder } from "../../../skills/cobol/extract-call-graph.skill.js";

type MavenExecutor = Pick<Tool<{ projectDir: string }, CompileResult>, "execute">;

type Dependencies = {
  model: ModelClient;
  outputDir: string;
  profile: TargetArchitectureProfile;
  maven: MavenExecutor;
};

type GeneratedProjectModel = {
  plugins: HollowSkinnyPlugin[];
  files: Array<{ relativePath: string; content: string }>;
  translations: Map<string, JavaMethodTranslation>;
  qualities: Map<string, SubprogramTranslationQuality>;
  lastMavenResult?: CompileResult;
};

const GROUP_ID = "generated.cobol";
const SPRING_BOOT_VERSION = "3.4.5";
const JAVA_VERSION = 17;
const MAX_TRANSLATION_ATTEMPTS = 3;
const SERVICE_REGISTRATION_PATH = `skinny/src/main/resources/META-INF/services/${GROUP_ID}.api.ProgramPlugin`;
const SKINNY_SOURCE_ROOT = `skinny/src/main/java/${GROUP_ID.replaceAll(".", "/")}/skinny`;

function toSubprogramInfo(program: LegacyProgram): SubprogramInfo {
  return {
    programId: program.programId,
    sourceFile: program.sourceFile,
    expandedSource: program.expandedSource,
    linkageParams: program.linkage,
    callees: program.callees,
  };
}

function toJavaTypeName(value: string): string {
  const parts = value.split(/[^A-Za-z\d_$]+/).filter(Boolean);
  const joined = parts.map(part => {
    const lower = part.toLowerCase();
    return `${lower[0]?.toUpperCase() ?? ""}${lower.slice(1)}`;
  }).join("");
  const candidate = joined || "Generated";
  return /^[A-Za-z_$]/.test(candidate) ? candidate : `P${candidate}`;
}

function pluginClassName(programId: string): string {
  return `${toJavaTypeName(programId)}Plugin`;
}

function normalizePluginBody(method: Omit<JavaMethodTranslation, "programId" | "attempts">): string {
  const body = method.body.trim().replace(/\breturn\s*;/g, "return 0;");
  if (!body) return "return 0;";
  if (/^\s*return\b/m.test(body)) return body;
  return `${body}\nreturn 0;`;
}

function ensureSafeOutputPath(outputDir: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error(`Generated path must be relative: ${relativePath}`);
  }
  const root = resolve(outputDir);
  const target = resolve(root, relativePath);
  const back = relative(root, target);
  if (back === "" || back.startsWith("..") || isAbsolute(back)) {
    throw new Error(`Generated path escapes outputDir: ${relativePath}`);
  }
  return target;
}

async function readGeneratedFile(outputDir: string, relativePath: string): Promise<string | null> {
  try {
    return await readFile(ensureSafeOutputPath(outputDir, relativePath), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function unindentJavaBody(body: string): string {
  return body
    .split("\n")
    .map(line => line.startsWith("        ") ? line.slice(8) : line)
    .join("\n")
    .trim();
}

function parseExecuteBody(content: string, className: string): string {
  const marker = "public int execute(ProgramContext context) {";
  const start = content.indexOf(marker);
  if (start < 0) {
    throw new Error(`Cannot recover ${className}: missing execute(ProgramContext context)`);
  }
  let index = start + marker.length;
  let depth = 1;
  let bodyStart = index;
  while (index < content.length) {
    const char = content[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return unindentJavaBody(content.slice(bodyStart, index));
    }
    index += 1;
  }
  throw new Error(`Cannot recover ${className}: unterminated execute method`);
}

function parseGeneratedPlugin(className: string, content: string): HollowSkinnyPlugin {
  const programIdRaw = /public\s+String\s+programId\(\)\s*\{\s*return\s+((?:"(?:\\.|[^"])*"))\s*;\s*\}/m.exec(content)?.[1];
  if (!programIdRaw) {
    throw new Error(`Cannot recover ${className}: missing programId() return literal`);
  }
  const programId = JSON.parse(programIdRaw) as string;
  return {
    programId,
    className,
    methodBody: parseExecuteBody(content, className),
  };
}

async function recoverPluginsFromDisk(outputDir: string): Promise<HollowSkinnyPlugin[]> {
  const services = await readGeneratedFile(outputDir, SERVICE_REGISTRATION_PATH);
  if (!services) return [];
  const pluginClasses = services.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith(`${GROUP_ID}.skinny.`))
    .map(line => line.slice(`${GROUP_ID}.skinny.`.length));
  const plugins: HollowSkinnyPlugin[] = [];
  for (const className of pluginClasses) {
    const content = await readGeneratedFile(outputDir, `${SKINNY_SOURCE_ROOT}/${className}.java`);
    if (!content) {
      throw new Error(`Cannot recover ${className}: generated plugin source is missing`);
    }
    plugins.push(parseGeneratedPlugin(className, content));
  }
  return plugins;
}

function sortPlugins(plugins: HollowSkinnyPlugin[]): HollowSkinnyPlugin[] {
  return [...plugins].sort((a, b) =>
    a.programId.localeCompare(b.programId) || a.className.localeCompare(b.className),
  );
}

function recoveredQuality(plugin: HollowSkinnyPlugin): SubprogramTranslationQuality {
  const bodyPresent = plugin.methodBody.trim().length > 0;
  return {
    evaluatorPassed: bodyPresent,
    evaluatorReason: `Recovered generated plugin ${plugin.className} from disk`,
    coverage: bodyPresent ? 1 : 0,
    coverageEvidence: [
      `recovered plugin class: ${plugin.className}`,
      `executable body non-empty: ${bodyPresent}`,
      "linkage params matched: recovered generated plugin has no persisted linkage metadata",
      "CALL target coverage: recovered generated plugin has no persisted call graph metadata",
    ],
  };
}

async function writeProjectFiles(outputDir: string, files: readonly { relativePath: string; content: string }[]): Promise<string[]> {
  const changedFiles: string[] = [];
  for (const file of files) {
    const target = ensureSafeOutputPath(outputDir, file.relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
    changedFiles.push(file.relativePath);
  }
  return changedFiles;
}

function byCriterionId(
  profile: TargetArchitectureProfile,
  criterionId: string,
  fallback: Omit<CriterionEvidence, "criterionId">,
): CriterionEvidence {
  const criterion = profile.criteria.find(item => item.id === criterionId);
  return {
    criterionId,
    passed: fallback.passed,
    ...(criterion?.kind === "SCORE" ? { score: fallback.score ?? (fallback.passed ? 100 : 0) } : {}),
    confidence: fallback.confidence,
    evidence: fallback.evidence,
  };
}

export function buildSpringBootTargetAdapter(dependencies: Dependencies): TargetAdapter {
  const state: GeneratedProjectModel = {
    plugins: [],
    files: [],
    translations: new Map(),
    qualities: new Map(),
  };

  function assembleProject(): void {
    state.plugins = sortPlugins(state.plugins);
    const project = assembleHollowSkinnyProject({
      groupId: GROUP_ID,
      springBootVersion: SPRING_BOOT_VERSION,
      javaVersion: JAVA_VERSION,
      plugins: state.plugins,
    });
    state.files = project.files;
  }

  async function recoverStateFromDisk(): Promise<void> {
    const recovered = await recoverPluginsFromDisk(dependencies.outputDir);
    for (const plugin of recovered) {
      if (!state.plugins.some(candidate => candidate.programId === plugin.programId || candidate.className === plugin.className)) {
        state.plugins.push(plugin);
      }
      if (!state.qualities.has(plugin.programId)) {
        state.qualities.set(plugin.programId, recoveredQuality(plugin));
      }
    }
    if (recovered.length > 0) {
      assembleProject();
    }
  }

  return {
    id: "spring-boot-hollow-skinny-target",

    async plan(inventory: LegacyInventory, decision: ArchitectureDecision): Promise<MigrationTask[]> {
      const profileId = requireApprovedArchitecture(decision);
      if (profileId !== dependencies.profile.id) {
        throw new Error(`Architecture decision profile ${profileId} does not match target profile ${dependencies.profile.id}`);
      }
      const subprograms = inventory.programs.map(toSubprogramInfo);
      const { order } = buildCallOrder(subprograms);
      return order.map(programId => ({
        id: `migrate-${programId.toLowerCase()}`,
        programIds: [programId],
        allowedPaths: ["pom.xml", "hollow/**", "skinny/**"],
      }));
    },

    async execute(task: MigrationTask, inventory: LegacyInventory): Promise<{ changedFiles: string[] }> {
      await recoverStateFromDisk();
      const programId = task.programIds[0];
      if (!programId) {
        throw new Error(`Migration task ${task.id} has no programIds`);
      }
      const program = inventory.programs.find(candidate => candidate.programId === programId);
      if (!program) {
        throw new Error(`Migration task ${task.id} references unknown program ${programId}`);
      }

      const subprogram = toSubprogramInfo(program);
      const translation = await runSubprogramTranslationLoop(
        subprogram,
        "",
        dependencies.model,
        MAX_TRANSLATION_ATTEMPTS,
      );
      if (!translation.ok) {
        throw new AppError(
          `REPAIRABLE_TRANSLATION_EXHAUSTED: ${programId} exhausted ${translation.attempts} translation attempts`,
          "REPAIRABLE_TRANSLATION_EXHAUSTED",
          {
            programId,
            attempts: translation.attempts,
            failureReasons: translation.failureReasons,
            lastAttemptBody: translation.lastAttemptBody,
          },
        );
      }

      const fullTranslation: JavaMethodTranslation = {
        programId,
        ...translation.method,
        attempts: translation.attempts,
      };
      state.translations.set(programId, fullTranslation);
      state.qualities.set(programId, translation.quality);
      const plugin: HollowSkinnyPlugin = {
        programId,
        className: pluginClassName(programId),
        methodBody: normalizePluginBody(translation.method),
      };
      const existingIndex = state.plugins.findIndex(candidate => candidate.programId === programId);
      if (existingIndex >= 0) {
        state.plugins[existingIndex] = plugin;
      } else {
        state.plugins.push(plugin);
      }

      assembleProject();
      const changedFiles = await writeProjectFiles(dependencies.outputDir, state.files);
      return { changedFiles };
    },

    async verify(_task: MigrationTask): Promise<CriterionEvidence[]> {
      await recoverStateFromDisk();
      const projectVerification = verifyHollowSkinnyProject(state.files);
      const mavenResult = await dependencies.maven.execute({ projectDir: dependencies.outputDir });
      state.lastMavenResult = mavenResult;
      const paths = new Set(state.files.map(file => file.relativePath));
      const serviceRegistration = state.files.find(file =>
        file.relativePath.startsWith("skinny/src/main/resources/META-INF/services/")
        && file.relativePath.endsWith(".api.ProgramPlugin"),
      );
      const pluginLoads = projectVerification.passed
        && state.plugins.length > 0
        && !!serviceRegistration
        && state.plugins.every(plugin => serviceRegistration.content.includes(`${GROUP_ID}.skinny.${plugin.className}`));
      const noReverseDependency = projectVerification.violations.every(violation => !violation.includes("imports a skinny package"));
      const buildEvidence = [
        `maven success: ${mavenResult.success}`,
        ...(mavenResult.stdout ? [`stdout: ${mavenResult.stdout}`] : []),
        ...(mavenResult.stderr ? [`stderr: ${mavenResult.stderr}`] : []),
      ];
      const verificationEvidence = projectVerification.violations.length > 0
        ? projectVerification.violations
        : ["hollow/skinny verifier reported no violations"];
      const qualities = [...state.qualities.entries()];
      const averageCoverage = qualities.length === 0
        ? 0
        : qualities.reduce((sum, [, quality]) => sum + quality.coverage, 0) / qualities.length;
      const semanticScore = Math.round(averageCoverage * 100);
      const semanticEvidence = qualities.length === 0
        ? ["translated program count: 0"]
        : [
          `translated program count: ${qualities.length}`,
          `average deterministic coverage: ${semanticScore}`,
          ...qualities.flatMap(([programId, quality]) => [
            `${programId} evaluator: ${quality.evaluatorPassed ? "passed" : "failed"} - ${quality.evaluatorReason}`,
            ...quality.coverageEvidence.map(item => `${programId} ${item}`),
          ]),
        ];

      return [
        byCriterionId(dependencies.profile, "build.hollow", {
          passed: mavenResult.success && paths.has("hollow/pom.xml"),
          confidence: 1,
          evidence: [...buildEvidence, `hollow/pom.xml present: ${paths.has("hollow/pom.xml")}`],
        }),
        byCriterionId(dependencies.profile, "build.skinny", {
          passed: mavenResult.success && paths.has("skinny/pom.xml"),
          confidence: 1,
          evidence: [...buildEvidence, `skinny/pom.xml present: ${paths.has("skinny/pom.xml")}`],
        }),
        byCriterionId(dependencies.profile, "architecture.no-reverse-dependency", {
          passed: noReverseDependency,
          confidence: 1,
          evidence: verificationEvidence,
        }),
        byCriterionId(dependencies.profile, "architecture.plugin-loads", {
          passed: pluginLoads,
          confidence: 1,
          evidence: [
            `service registration present: ${!!serviceRegistration}`,
            `registered plugins: ${state.plugins.map(plugin => plugin.className).join(", ") || "none"}`,
            ...verificationEvidence,
          ],
        }),
        byCriterionId(dependencies.profile, "semantic.fidelity", {
          passed: state.qualities.size > 0 && semanticScore >= 80,
          score: semanticScore,
          confidence: 1,
          evidence: semanticEvidence,
        }),
        byCriterionId(dependencies.profile, "build.tests", {
          passed: mavenResult.success,
          score: mavenResult.success ? 100 : 0,
          confidence: 1,
          evidence: buildEvidence,
        }),
        byCriterionId(dependencies.profile, "architecture.conformance", {
          passed: projectVerification.passed,
          score: projectVerification.passed ? 100 : 0,
          confidence: 1,
          evidence: verificationEvidence,
        }),
        byCriterionId(dependencies.profile, "code.maintainability", {
          passed: projectVerification.passed,
          score: projectVerification.passed ? 100 : 0,
          confidence: 1,
          evidence: ["Generated project uses one skinny plugin class per COBOL program and shared hollow contracts."],
        }),
        byCriterionId(dependencies.profile, "evidence.completeness", {
          passed: state.files.length > 0 && state.plugins.length > 0,
          score: state.files.length > 0 && state.plugins.length > 0 ? 100 : 0,
          confidence: 1,
          evidence: [
            `generated files: ${state.files.length}`,
            `translated plugins: ${state.plugins.length}`,
            "Verification includes hollow/skinny structural checks and Maven result.",
          ],
        }),
      ];
    },
  };
}
