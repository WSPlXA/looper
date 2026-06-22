# Legacy Migration Loop Engineering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overlapping migration commands and orchestration layers with one resumable terminal agent loop for COBOL-to-Spring-Boot migration, with human-approved architecture decisions, executable criteria, scoring, and a non-default hollow/skinny target profile.

**Architecture:** Build a small stable kernel around session persistence, architecture approvals, criteria evaluation, and an Observe → Plan → Act → Verify → Evaluate → Learn loop. Existing COBOL analysis and Java translation capabilities enter through a `SourceAdapter`; Spring Boot generation, Maven verification, and architecture rules enter through a `TargetAdapter` and explicit `TargetArchitectureProfile`. Switch the CLI only after an end-to-end loop passes, then delete the superseded workflows, graph nodes, and commands.

**Tech Stack:** TypeScript 5.8, Node.js 22, Zod 3, Vitest 3, DeepSeek model client, Java 17, Maven, Spring Boot 3.4.x

---

## File structure

New and retained responsibilities after this plan:

```text
src/
├── interfaces/cli/
│   ├── repl.ts                         # terminal read/evaluate loop
│   ├── commands.ts                     # slash-command parsing and dispatch
│   └── render.ts                       # deterministic text rendering
├── core/
│   ├── loop/
│   │   ├── migration-loop.ts           # one migration iteration
│   │   └── loop-policy.ts              # bounded repair and stop decisions
│   ├── criteria/
│   │   ├── criteria.types.ts           # approved rubric and evidence types
│   │   └── criteria-engine.ts          # hard gates, score, confidence, decision
│   ├── session/
│   │   ├── migration-session.ts        # durable session schema
│   │   ├── file-session-store.ts       # atomic load/save in .looper
│   │   └── workspace-artifact-store.ts # decisions, plans, criteria, and evidence
│   ├── architecture/
│   │   ├── target-profile.ts           # target profile contract
│   │   └── architecture-decision.ts     # explicit human approval record
│   └── adapters/
│       ├── source-adapter.ts            # legacy discovery contract
│       └── target-adapter.ts            # planning/execution/verification contract
├── adapters/
│   ├── source/cobol/cobol-source-adapter.ts
│   └── target/spring-boot/spring-boot-target-adapter.ts
├── profiles/hollow-skinny/
│   ├── hollow-skinny.profile.ts
│   ├── assemble-hollow-skinny-project.ts
│   └── verify-hollow-skinny-project.ts
└── apps/cli/main.ts                    # thin `looper` bootstrap only
```

The existing `src/core/model`, `src/core/actions`, `src/core/checkpoint`, `src/core/storage`, `src/core/trace`, `src/models/deepseek`, `src/tools`, and reusable COBOL/Java skills remain. Old orchestration is removed only in Task 10.

## Task 1: Lock the baseline and finish the in-progress COBOL variable analyzer

**Files:**
- Modify: `src/skills/cobol/analyze-variables.skill.ts`
- Modify: `src/apps/cli/commands/analyze-variables.command.ts`
- Modify: `src/apps/cli/main.ts`
- Modify: `package.json`
- Create: `test/unit/analyze-variables.test.ts`

- [ ] **Step 1: Add a characterization test for WORKING-STORAGE, LINKAGE, references, and CALL targets**

```ts
import { describe, expect, it } from "vitest";
import {
  analyzeProgramVariables,
  buildXrefDatabase,
} from "../../src/skills/cobol/analyze-variables.skill.js";

describe("COBOL variable analysis", () => {
  it("maps declarations, references, sections, and callees", () => {
    const source = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. ORDER-MAIN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-TOTAL PIC 9(5).
       LINKAGE SECTION.
       01 LK-ORDER-ID PIC X(10).
       PROCEDURE DIVISION USING LK-ORDER-ID.
           MOVE 1 TO WS-TOTAL
           CALL "PRICE-CALC"
           GOBACK.`;

    const analysis = analyzeProgramVariables("ORDER-MAIN.cob", source);
    expect(analysis?.programId).toBe("ORDER-MAIN");
    expect(analysis?.declarations).toEqual([
      expect.objectContaining({ name: "WS-TOTAL", section: "WORKING-STORAGE" }),
      expect.objectContaining({ name: "LK-ORDER-ID", section: "LINKAGE" }),
    ]);
    expect(analysis?.references["WS-TOTAL"]).toHaveLength(1);
    expect(analysis?.callees).toEqual(["PRICE-CALC"]);
    expect(buildXrefDatabase([analysis!])).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "WS-TOTAL" })]),
    );
  });
});
```

- [ ] **Step 2: Run the characterization test**

Run: `npm test -- test/unit/analyze-variables.test.ts`

Expected: PASS. If it fails, change only `analyze-variables.skill.ts` until the asserted COBOL behavior passes; do not alter the assertions.

- [ ] **Step 3: Verify the existing in-progress CLI integration**

Run: `npm run build && npm test`

Expected: TypeScript exits 0 and all tests, including `analyze-variables.test.ts`, pass.

- [ ] **Step 4: Commit the completed analyzer slice separately**

```bash
git add package.json src/apps/cli/main.ts \
  src/apps/cli/commands/analyze-variables.command.ts \
  src/skills/cobol/analyze-variables.skill.ts \
  test/unit/analyze-variables.test.ts
git commit -m "feat: add COBOL variable analysis"
```

## Task 2: Add durable migration sessions

**Files:**
- Create: `src/core/session/migration-session.ts`
- Create: `src/core/session/file-session-store.ts`
- Create: `src/core/session/workspace-artifact-store.ts`
- Create: `test/unit/file-session-store.test.ts`

- [ ] **Step 1: Write failing tests for atomic persistence and resume**

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFileSessionStore } from "../../src/core/session/file-session-store.js";
import { migrationSessionSchema } from "../../src/core/session/migration-session.js";
import { buildWorkspaceArtifactStore } from "../../src/core/session/workspace-artifact-store.js";

describe("file session store", () => {
  it("saves and resumes the last durable session", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "looper-session-"));
    const store = buildFileSessionStore(workspace);
    const session = migrationSessionSchema.parse({
      id: "session-1",
      workspace,
      stage: "DISCOVERY",
      iteration: 0,
      criteriaRevision: 0,
      scoreHistory: [],
      completedTaskIds: [],
      risks: [],
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });

    await store.save(session);
    await expect(store.load()).resolves.toEqual(session);
    expect(JSON.parse(await readFile(join(workspace, ".looper/session.json"), "utf8"))).toEqual(session);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npm test -- test/unit/file-session-store.test.ts`

Expected: FAIL because `migration-session.ts` and `file-session-store.ts` do not exist.

- [ ] **Step 3: Implement the session schema**

```ts
// src/core/session/migration-session.ts
import { z } from "zod";

export const sessionStageSchema = z.enum([
  "DISCOVERY",
  "ARCHITECTURE_REVIEW",
  "CRITERIA_REVIEW",
  "READY",
  "RUNNING",
  "NEEDS_REVIEW",
  "BLOCKED",
  "PAUSED",
  "COMPLETED",
]);

export const migrationSessionSchema = z.object({
  id: z.string().min(1),
  workspace: z.string().min(1),
  stage: sessionStageSchema,
  iteration: z.number().int().nonnegative(),
  architectureDecisionId: z.string().min(1).optional(),
  criteriaRevision: z.number().int().nonnegative(),
  approvedCriteriaRevision: z.number().int().nonnegative().optional(),
  scoreHistory: z.array(z.object({
    iteration: z.number().int().positive(),
    score: z.number().min(0).max(100),
    decision: z.enum(["PASSED", "FAILED", "NEEDS_REVIEW", "BLOCKED"]),
  })),
  completedTaskIds: z.array(z.string()),
  activeTaskId: z.string().optional(),
  risks: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MigrationSession = z.infer<typeof migrationSessionSchema>;
```

- [ ] **Step 4: Implement atomic load/save**

```ts
// src/core/session/file-session-store.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { migrationSessionSchema, type MigrationSession } from "./migration-session.js";

export type SessionStore = {
  load(): Promise<MigrationSession | null>;
  save(session: MigrationSession): Promise<void>;
};

export function buildFileSessionStore(workspace: string): SessionStore {
  const directory = join(workspace, ".looper");
  const filePath = join(directory, "session.json");
  return {
    async load() {
      try {
        return migrationSessionSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(session) {
      await mkdir(directory, { recursive: true });
      const validated = migrationSessionSchema.parse(session);
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await rename(temporary, filePath);
    },
  };
}
```

- [ ] **Step 5: Implement safe workspace artifacts**

```ts
// src/core/session/workspace-artifact-store.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type WorkspaceArtifactStore = {
  saveJson(relativePath: string, value: unknown): Promise<string>;
  loadJson(relativePath: string): Promise<unknown>;
};

export function buildWorkspaceArtifactStore(workspace: string): WorkspaceArtifactStore {
  const root = resolve(workspace, ".looper");
  function target(relativePath: string): string {
    if (isAbsolute(relativePath)) throw new Error("Artifact path must be relative");
    const resolved = resolve(root, relativePath);
    const rel = relative(root, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Artifact path escapes .looper");
    return resolved;
  }
  return {
    async saveJson(relativePath, value) {
      const filePath = target(relativePath);
      await mkdir(dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(temporary, filePath);
      return filePath;
    },
    async loadJson(relativePath) {
      return JSON.parse(await readFile(target(relativePath), "utf8")) as unknown;
    },
  };
}
```

Add to `file-session-store.test.ts`:

```ts
const artifacts = buildWorkspaceArtifactStore(workspace);
await artifacts.saveJson("decisions/target-architecture.yaml", { profileId: "hollow-skinny-v1" });
await expect(artifacts.loadJson("decisions/target-architecture.yaml"))
  .resolves.toEqual({ profileId: "hollow-skinny-v1" });
await expect(artifacts.saveJson("../escape.json", {})).rejects.toThrow("escapes .looper");
```

JSON serialization is valid YAML 1.2, so `plan.yaml`, `criteria.yaml`, and decision `.yaml` files remain machine-readable without adding another parser dependency.

- [ ] **Step 6: Run and commit**

Run: `npm test -- test/unit/file-session-store.test.ts && npm run build`

Expected: PASS and TypeScript exit 0.

```bash
git add src/core/session test/unit/file-session-store.test.ts
git commit -m "feat: persist migration sessions"
```

## Task 3: Implement executable Criteria, scoring, and confidence

**Files:**
- Create: `src/core/criteria/criteria.types.ts`
- Create: `src/core/criteria/criteria-engine.ts`
- Create: `test/unit/criteria-engine.test.ts`

- [ ] **Step 1: Write failing tests for scoring and hard-gate veto**

```ts
import { describe, expect, it } from "vitest";
import { evaluateCriteria } from "../../src/core/criteria/criteria-engine.js";
import type { Criterion } from "../../src/core/criteria/criteria.types.js";

const rubric: Criterion[] = [
  { id: "behavior", kind: "SCORE", category: "SEMANTIC", weight: 40, requiredConfidence: 0.8 },
  { id: "tests", kind: "SCORE", category: "BUILD", weight: 25, requiredConfidence: 1 },
  { id: "dependency", kind: "HARD_GATE", category: "ARCHITECTURE", weight: 0, requiredConfidence: 1 },
];

describe("criteria engine", () => {
  it("returns PASSED when gates pass and weighted score reaches threshold", () => {
    const result = evaluateCriteria(rubric, [
      { criterionId: "behavior", passed: true, score: 95, confidence: 0.9, evidence: ["behavior-test.xml"] },
      { criterionId: "tests", passed: true, score: 100, confidence: 1, evidence: ["mvn-test.log"] },
      { criterionId: "dependency", passed: true, confidence: 1, evidence: ["jdeps.log"] },
    ], 90);
    expect(result.decision).toBe("PASSED");
    expect(result.score).toBe(97);
  });

  it("lets a failed hard gate veto a high score", () => {
    const result = evaluateCriteria(rubric, [
      { criterionId: "behavior", passed: true, score: 100, confidence: 1, evidence: ["behavior-test.xml"] },
      { criterionId: "tests", passed: true, score: 100, confidence: 1, evidence: ["mvn-test.log"] },
      { criterionId: "dependency", passed: false, confidence: 1, evidence: ["forbidden import"] },
    ], 90);
    expect(result).toMatchObject({ score: 100, hardGatesPassed: false, decision: "FAILED" });
  });

  it("requires review when evidence confidence is below the approved floor", () => {
    const result = evaluateCriteria(rubric, [
      { criterionId: "behavior", passed: true, score: 95, confidence: 0.5, evidence: ["model-review.json"] },
      { criterionId: "tests", passed: true, score: 100, confidence: 1, evidence: ["mvn-test.log"] },
      { criterionId: "dependency", passed: true, confidence: 1, evidence: ["jdeps.log"] },
    ], 90);
    expect(result.decision).toBe("NEEDS_REVIEW");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- test/unit/criteria-engine.test.ts`

Expected: FAIL because the criteria modules do not exist.

- [ ] **Step 3: Define Criteria types**

```ts
// src/core/criteria/criteria.types.ts
export type CriterionKind = "HARD_GATE" | "SCORE" | "HUMAN_REVIEW";
export type CriterionCategory = "SEMANTIC" | "BUILD" | "ARCHITECTURE" | "MAINTAINABILITY" | "EVIDENCE";

export type Criterion = {
  id: string;
  kind: CriterionKind;
  category: CriterionCategory;
  weight: number;
  requiredConfidence: number;
};

export type CriterionEvidence = {
  criterionId: string;
  passed: boolean;
  score?: number;
  confidence: number;
  evidence: string[];
};

export type CriteriaEvaluation = {
  score: number;
  confidence: number;
  hardGatesPassed: boolean;
  decision: "PASSED" | "FAILED" | "NEEDS_REVIEW" | "BLOCKED";
  results: CriterionEvidence[];
};
```

- [ ] **Step 4: Implement deterministic evaluation**

```ts
// src/core/criteria/criteria-engine.ts
import type { CriteriaEvaluation, Criterion, CriterionEvidence } from "./criteria.types.js";

export function evaluateCriteria(
  criteria: readonly Criterion[],
  evidence: readonly CriterionEvidence[],
  passThreshold: number,
): CriteriaEvaluation {
  const byId = new Map(evidence.map(result => [result.criterionId, result]));
  const missing = criteria.filter(criterion => !byId.has(criterion.id));
  if (missing.length > 0) {
    return { score: 0, confidence: 0, hardGatesPassed: false, decision: "BLOCKED", results: [...evidence] };
  }
  const results = criteria.map(criterion => byId.get(criterion.id)!);
  const hardGatesPassed = criteria
    .filter(criterion => criterion.kind === "HARD_GATE")
    .every(criterion => byId.get(criterion.id)!.passed);
  const requiresReview = criteria.some(criterion => {
    const result = byId.get(criterion.id)!;
    return (criterion.kind === "HUMAN_REVIEW" && !result.passed)
      || result.confidence < criterion.requiredConfidence;
  });
  const scored = criteria.filter(criterion => criterion.kind === "SCORE");
  const totalWeight = scored.reduce((sum, criterion) => sum + criterion.weight, 0);
  const weighted = scored.reduce((sum, criterion) => {
    return sum + (byId.get(criterion.id)!.score ?? 0) * criterion.weight;
  }, 0);
  const score = totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);
  const confidence = results.length === 0
    ? 0
    : Math.min(...results.map(result => result.confidence));
  const decision = !hardGatesPassed
    ? "FAILED"
    : requiresReview
      ? "NEEDS_REVIEW"
      : score >= passThreshold ? "PASSED" : "FAILED";
  return { score, confidence, hardGatesPassed, decision, results };
}
```

- [ ] **Step 5: Run and commit**

Run: `npm test -- test/unit/criteria-engine.test.ts && npm run build`

Expected: three tests pass and TypeScript exits 0.

```bash
git add src/core/criteria test/unit/criteria-engine.test.ts
git commit -m "feat: evaluate migration criteria and scores"
```

## Task 4: Add explicit architecture candidates and human approval

**Files:**
- Create: `src/core/architecture/target-profile.ts`
- Create: `src/core/architecture/architecture-decision.ts`
- Create: `src/profiles/hollow-skinny/hollow-skinny.profile.ts`
- Create: `test/unit/architecture-decision.test.ts`

- [ ] **Step 1: Write a failing test proving that no profile is implicitly selected**

```ts
import { describe, expect, it } from "vitest";
import { approveArchitecture, requireApprovedArchitecture } from "../../src/core/architecture/architecture-decision.js";
import { hollowSkinnyProfile } from "../../src/profiles/hollow-skinny/hollow-skinny.profile.js";

describe("architecture decision gate", () => {
  it("blocks execution until a candidate is explicitly approved", () => {
    expect(() => requireApprovedArchitecture(undefined)).toThrow("Architecture approval is required");
    const decision = approveArchitecture(hollowSkinnyProfile, "gaosong", "2026-06-23T00:00:00.000Z");
    expect(requireApprovedArchitecture(decision)).toBe(hollowSkinnyProfile.id);
    expect(decision).toMatchObject({ approvedBy: "gaosong", profileId: "hollow-skinny-v1", revision: 1 });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- test/unit/architecture-decision.test.ts`

Expected: FAIL because the profile and decision modules do not exist.

- [ ] **Step 3: Define the profile and decision contracts**

```ts
// src/core/architecture/target-profile.ts
import type { Criterion } from "../criteria/criteria.types.js";

export type TargetArchitectureProfile = {
  id: string;
  name: string;
  description: string;
  moduleBoundaries: string[];
  criteria: Criterion[];
};

// src/core/architecture/architecture-decision.ts
import type { TargetArchitectureProfile } from "./target-profile.js";

export type ArchitectureDecision = {
  id: string;
  profileId: string;
  revision: number;
  approvedBy: string;
  approvedAt: string;
};

export function approveArchitecture(
  profile: TargetArchitectureProfile,
  approvedBy: string,
  approvedAt = new Date().toISOString(),
): ArchitectureDecision {
  return {
    id: `architecture-${profile.id}-r1`,
    profileId: profile.id,
    revision: 1,
    approvedBy,
    approvedAt,
  };
}

export function requireApprovedArchitecture(decision: ArchitectureDecision | undefined): string {
  if (!decision) throw new Error("Architecture approval is required before code generation");
  return decision.profileId;
}
```

- [ ] **Step 4: Implement hollow/skinny as a candidate, not a default**

```ts
// src/profiles/hollow-skinny/hollow-skinny.profile.ts
import type { TargetArchitectureProfile } from "../../core/architecture/target-profile.js";

export const hollowSkinnyProfile: TargetArchitectureProfile = {
  id: "hollow-skinny-v1",
  name: "Hollow base with Skinny business plugins",
  description: "A stable hollow.jar runtime exposes public plugin contracts; skinny.jar contains COBOL-derived business implementations.",
  moduleBoundaries: [
    "hollow must not depend on skinny",
    "skinny may depend only on hollow public API",
    "mutable COBOL state must be scoped through ProgramContext or SharedStateStore",
  ],
  criteria: [
    { id: "build.hollow", kind: "HARD_GATE", category: "BUILD", weight: 0, requiredConfidence: 1 },
    { id: "build.skinny", kind: "HARD_GATE", category: "BUILD", weight: 0, requiredConfidence: 1 },
    { id: "architecture.no-reverse-dependency", kind: "HARD_GATE", category: "ARCHITECTURE", weight: 0, requiredConfidence: 1 },
    { id: "architecture.plugin-loads", kind: "HARD_GATE", category: "ARCHITECTURE", weight: 0, requiredConfidence: 1 },
    { id: "semantic.fidelity", kind: "SCORE", category: "SEMANTIC", weight: 40, requiredConfidence: 0.8 },
    { id: "build.tests", kind: "SCORE", category: "BUILD", weight: 25, requiredConfidence: 1 },
    { id: "architecture.conformance", kind: "SCORE", category: "ARCHITECTURE", weight: 20, requiredConfidence: 1 },
    { id: "code.maintainability", kind: "SCORE", category: "MAINTAINABILITY", weight: 10, requiredConfidence: 0.8 },
    { id: "evidence.completeness", kind: "SCORE", category: "EVIDENCE", weight: 5, requiredConfidence: 1 },
  ],
};
```

- [ ] **Step 5: Run and commit**

Run: `npm test -- test/unit/architecture-decision.test.ts && npm run build`

Expected: PASS and TypeScript exit 0.

```bash
git add src/core/architecture/target-profile.ts \
  src/core/architecture/architecture-decision.ts \
  src/profiles/hollow-skinny/hollow-skinny.profile.ts \
  test/unit/architecture-decision.test.ts
git commit -m "feat: require target architecture approval"
```

## Task 5: Introduce adapter contracts and the COBOL discovery adapter

**Files:**
- Create: `src/core/adapters/source-adapter.ts`
- Create: `src/core/adapters/target-adapter.ts`
- Create: `src/adapters/source/cobol/cobol-source-adapter.ts`
- Create: `test/unit/cobol-source-adapter.test.ts`

- [ ] **Step 1: Write a failing discovery test using real fixture files**

```ts
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCobolSourceAdapter } from "../../src/adapters/source/cobol/cobol-source-adapter.js";

describe("COBOL source adapter", () => {
  it("discovers programs, calls, copybooks, variables, and risks", async () => {
    const inventory = await buildCobolSourceAdapter().discover(
      resolve("test/fixtures/cobol"),
    );
    expect(inventory.sourceKind).toBe("cobol");
    expect(inventory.programs.map(program => program.programId)).toContain("MAIN");
    expect(inventory.programs.find(program => program.programId === "MAIN")?.callees).toContain("UTILS");
    expect(inventory.copybookFiles.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Add a `.cpy` fixture used by the test**

Create `test/fixtures/cobol/COMMON.cpy`:

```cobol
       01 COMMON-STATUS PIC 9 VALUE 0.
```

Update `test/fixtures/cobol/MAIN_WITH_COPY.cob` so its `COPY` statement names `COMMON`; preserve its existing PROGRAM-ID and CALL behavior.

- [ ] **Step 3: Run the test and verify it fails**

Run: `npm test -- test/unit/cobol-source-adapter.test.ts`

Expected: FAIL because adapter contracts do not exist.

- [ ] **Step 4: Define adapter contracts**

```ts
// src/core/adapters/source-adapter.ts
export type LegacyProgram = {
  programId: string;
  sourceFile: string;
  expandedSource: string;
  callees: string[];
  linkage: Array<{ name: string; pic: string }>;
  workingStorageNames: string[];
  linkageNames: string[];
};

export type LegacyInventory = {
  sourceKind: string;
  sourceRoot: string;
  programs: LegacyProgram[];
  copybookFiles: string[];
  risks: string[];
};

export interface SourceAdapter {
  readonly id: string;
  discover(sourceRoot: string): Promise<LegacyInventory>;
}

// src/core/adapters/target-adapter.ts
import type { ArchitectureDecision } from "../architecture/architecture-decision.js";
import type { CriterionEvidence } from "../criteria/criteria.types.js";
import type { LegacyInventory } from "./source-adapter.js";

export type MigrationTask = {
  id: string;
  programIds: string[];
  allowedPaths: string[];
};

export interface TargetAdapter {
  readonly id: string;
  plan(inventory: LegacyInventory, decision: ArchitectureDecision): Promise<MigrationTask[]>;
  execute(task: MigrationTask, inventory: LegacyInventory): Promise<{ changedFiles: string[] }>;
  verify(task: MigrationTask): Promise<CriterionEvidence[]>;
}
```

- [ ] **Step 5: Implement COBOL discovery by composing existing deterministic skills**

Implement `buildCobolSourceAdapter()` with these exact operations:

```ts
const entries = await readdir(sourceRoot, { recursive: true });
const cobFiles = entries.filter(name => /\.(?:cob|cbl)$/i.test(name)).map(name => join(sourceRoot, name));
const copybookFiles = entries.filter(name => /\.cpy$/i.test(name)).map(name => join(sourceRoot, name));
const programs: LegacyProgram[] = [];
const risks: string[] = [];

for (const sourceFile of cobFiles) {
  const raw = await readFile(sourceFile, "utf8");
  const { expanded, unresolvedNames } = await expandCopybooks(raw, copybookFiles);
  const subprogram = extractSubprogramInfo(sourceFile, expanded);
  const variables = analyzeProgramVariables(sourceFile, expanded);
  if (!subprogram || !variables) {
    risks.push(`Unable to identify PROGRAM-ID: ${sourceFile}`);
    continue;
  }
  risks.push(...unresolvedNames.map(name => `Unresolved COPY ${name} in ${sourceFile}`));
  programs.push({
    programId: subprogram.programId,
    sourceFile,
    expandedSource: expanded,
    callees: subprogram.callees,
    linkage: subprogram.linkageParams,
    workingStorageNames: variables.declarations.filter(item => item.section === "WORKING-STORAGE").map(item => item.name),
    linkageNames: variables.declarations.filter(item => item.section === "LINKAGE").map(item => item.name),
  });
}

return { sourceKind: "cobol", sourceRoot, programs, copybookFiles, risks };
```

- [ ] **Step 6: Run and commit**

Run: `npm test -- test/unit/cobol-source-adapter.test.ts && npm run build`

Expected: PASS and TypeScript exit 0.

```bash
git add src/core/adapters src/adapters/source/cobol \
  test/unit/cobol-source-adapter.test.ts test/fixtures/cobol
git commit -m "feat: discover COBOL projects through an adapter"
```

## Task 6: Generate and verify the hollow/skinny Spring Boot profile

**Files:**
- Create: `src/profiles/hollow-skinny/assemble-hollow-skinny-project.ts`
- Create: `src/profiles/hollow-skinny/verify-hollow-skinny-project.ts`
- Create: `test/unit/assemble-hollow-skinny-project.test.ts`

- [ ] **Step 1: Write a failing project-generation contract test**

```ts
import { describe, expect, it } from "vitest";
import { assembleHollowSkinnyProject } from "../../src/profiles/hollow-skinny/assemble-hollow-skinny-project.js";

describe("hollow/skinny project assembly", () => {
  it("creates a parent build, public hollow contracts, and skinny service registration", () => {
    const project = assembleHollowSkinnyProject({
      groupId: "generated.cobol",
      springBootVersion: "3.4.5",
      javaVersion: 17,
      plugins: [{ programId: "ORDER-MAIN", className: "OrderMainPlugin", methodBody: "return 0;" }],
    });
    const paths = project.files.map(file => file.relativePath);
    expect(paths).toContain("pom.xml");
    expect(paths).toContain("hollow/pom.xml");
    expect(paths).toContain("skinny/pom.xml");
    expect(paths).toContain("hollow/src/main/java/generated/cobol/api/ProgramPlugin.java");
    expect(paths).toContain("skinny/src/main/resources/META-INF/services/generated.cobol.api.ProgramPlugin");
    expect(project.files.find(file => file.relativePath === "skinny/pom.xml")?.content)
      .toContain("<artifactId>hollow</artifactId>");
    expect(project.files.find(file => file.relativePath === "hollow/pom.xml")?.content)
      .not.toContain("<artifactId>skinny</artifactId>");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- test/unit/assemble-hollow-skinny-project.test.ts`

Expected: FAIL because the assembler does not exist.

- [ ] **Step 3: Implement the profile output contract**

Export these types and function from `assemble-hollow-skinny-project.ts`:

```ts
export type HollowSkinnyPlugin = {
  programId: string;
  className: string;
  methodBody: string;
};

export type HollowSkinnyProject = {
  files: Array<{ relativePath: string; content: string }>;
};

export function assembleHollowSkinnyProject(input: {
  groupId: string;
  springBootVersion: string;
  javaVersion: number;
  plugins: HollowSkinnyPlugin[];
}): HollowSkinnyProject;
```

Generate the following concrete Java contracts in `hollow`:

```java
package generated.cobol.api;

public interface ProgramPlugin {
    String programId();
    int execute(ProgramContext context);
}
```

```java
package generated.cobol.api;

import java.util.HashMap;
import java.util.Map;

public final class ProgramContext {
    private final Map<String, Object> values = new HashMap<>();

    public Object get(String name) { return values.get(name); }
    public void put(String name, Object value) { values.put(name, value); }
}
```

```java
package generated.cobol.runtime;

import generated.cobol.api.ProgramPlugin;
import java.util.ServiceLoader;

public final class PluginLoader {
    public Iterable<ProgramPlugin> load() {
        return ServiceLoader.load(ProgramPlugin.class);
    }
}
```

For every plugin, generate a `skinny` class implementing `ProgramPlugin` and add its fully qualified name to `META-INF/services/generated.cobol.api.ProgramPlugin`. Parent `pom.xml` must list `hollow` before `skinny`; `skinny/pom.xml` depends on `${project.groupId}:hollow:${project.version}`; `hollow/pom.xml` has no skinny dependency.

- [ ] **Step 4: Add deterministic profile verification**

Export:

```ts
export type HollowSkinnyVerification = {
  passed: boolean;
  violations: string[];
};

export function verifyHollowSkinnyProject(
  files: readonly { relativePath: string; content: string }[],
): HollowSkinnyVerification;
```

The verifier must reject:

- a `hollow` file importing a `.skinny.` package;
- missing `ProgramPlugin.java`;
- missing service registration;
- mutable `static` fields in generated skinny Java sources;
- a skinny POM without a hollow dependency.

- [ ] **Step 5: Extend the test with verifier assertions**

```ts
const verification = verifyHollowSkinnyProject(project.files);
expect(verification).toEqual({ passed: true, violations: [] });

const invalid = project.files.map(file => file.relativePath.includes("/skinny/")
  ? file
  : { ...file, content: `${file.content}\nimport generated.cobol.skinny.Bad;` });
expect(verifyHollowSkinnyProject(invalid).passed).toBe(false);
```

- [ ] **Step 6: Run and commit**

Run: `npm test -- test/unit/assemble-hollow-skinny-project.test.ts && npm run build`

Expected: PASS and TypeScript exit 0.

```bash
git add src/profiles/hollow-skinny test/unit/assemble-hollow-skinny-project.test.ts
git commit -m "feat: generate hollow and skinny Spring Boot modules"
```

## Task 7: Implement one evidence-driven Migration Loop

**Files:**
- Create: `src/core/loop/loop-policy.ts`
- Create: `src/core/loop/migration-loop.ts`
- Create: `test/unit/migration-loop.test.ts`

- [ ] **Step 1: Write a failing test for approvals, one iteration, and score history**

```ts
import { describe, expect, it, vi } from "vitest";
import { buildMigrationLoop } from "../../src/core/loop/migration-loop.js";

describe("migration loop", () => {
  it("blocks before approvals and persists evidence after one iteration", async () => {
    const save = vi.fn();
    const loop = buildMigrationLoop({
      sessionStore: { load: vi.fn(), save },
      source: { id: "cobol", discover: vi.fn() },
      target: {
        id: "spring-boot",
        plan: vi.fn().mockResolvedValue([{ id: "task-1", programIds: ["MAIN"], allowedPaths: ["target/**"] }]),
        execute: vi.fn().mockResolvedValue({ changedFiles: ["target/Main.java"] }),
        verify: vi.fn().mockResolvedValue([
          { criterionId: "build", passed: true, score: 100, confidence: 1, evidence: ["mvn.log"] },
        ]),
      },
      criteria: [{ id: "build", kind: "SCORE", category: "BUILD", weight: 100, requiredConfidence: 1 }],
      passThreshold: 90,
      maxRepairAttempts: 3,
      maxStagnantIterations: 2,
      checkpointStore: { save: vi.fn(), loadLatest: vi.fn() },
      artifacts: { saveJson: vi.fn(), loadJson: vi.fn() },
      trace: vi.fn(),
    });

    await expect(loop.runNext({
      session: {
        id: "s1", workspace: "/tmp/work", stage: "ARCHITECTURE_REVIEW", iteration: 0,
        criteriaRevision: 1, scoreHistory: [], completedTaskIds: [], risks: [],
        createdAt: "2026-06-23T00:00:00.000Z", updatedAt: "2026-06-23T00:00:00.000Z",
      },
      inventory: { sourceKind: "cobol", sourceRoot: "/tmp/work", programs: [], copybookFiles: [], risks: [] },
      tasks: [],
    })).rejects.toThrow("Architecture approval is required");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- test/unit/migration-loop.test.ts`

Expected: FAIL because `migration-loop.ts` does not exist.

- [ ] **Step 3: Implement the loop policy**

```ts
// src/core/loop/loop-policy.ts
export function shouldStopRepair(input: {
  attempt: number;
  maxAttempts: number;
  scores: readonly number[];
  maxStagnantIterations: number;
}): boolean {
  if (input.attempt >= input.maxAttempts) return true;
  if (input.scores.length <= input.maxStagnantIterations) return false;
  const recent = input.scores.slice(-(input.maxStagnantIterations + 1));
  return recent.every(score => score <= recent[0]!);
}
```

- [ ] **Step 4: Implement the loop in explicit phases**

Define the loop context and dependencies before `buildMigrationLoop()`:

```ts
import type { ArchitectureDecision } from "../architecture/architecture-decision.js";
import type { Criterion, CriteriaEvaluation } from "../criteria/criteria.types.js";
import type { MigrationSession } from "../session/migration-session.js";
import type { SessionStore } from "../session/file-session-store.js";
import type { WorkspaceArtifactStore } from "../session/workspace-artifact-store.js";
import type { LegacyInventory, SourceAdapter } from "../adapters/source-adapter.js";
import type { MigrationTask, TargetAdapter } from "../adapters/target-adapter.js";
import type { CheckpointStore } from "../checkpoint/checkpoint.store.js";

export type MigrationLoopContext = {
  session: MigrationSession;
  inventory: LegacyInventory;
  architectureDecision?: ArchitectureDecision;
  tasks: MigrationTask[];
  lastExecution?: { changedFiles: string[] };
  lastEvaluation?: CriteriaEvaluation;
};

export type MigrationLoopDependencies = {
  sessionStore: SessionStore;
  source: SourceAdapter;
  target: TargetAdapter;
  criteria: Criterion[];
  passThreshold: number;
  maxRepairAttempts: number;
  maxStagnantIterations: number;
  checkpointStore: CheckpointStore<MigrationLoopContext>;
  artifacts: WorkspaceArtifactStore;
  trace(type: string, data?: unknown): Promise<void>;
};
```

`buildMigrationLoop(dependencies: MigrationLoopDependencies)` must expose `runNext(context: MigrationLoopContext)` and execute exactly:

```ts
requireApprovedArchitecture(context.architectureDecision);
if (context.session.approvedCriteriaRevision !== context.session.criteriaRevision) {
  throw new Error("Criteria approval is required before execution");
}
const tasks = context.tasks.length > 0
  ? context.tasks
  : await dependencies.target.plan(context.inventory, context.architectureDecision!);
const task = tasks.find(candidate => !context.session.completedTaskIds.includes(candidate.id));
if (!task) {
  const completed = { ...context.session, stage: "COMPLETED" as const, updatedAt: new Date().toISOString() };
  await dependencies.sessionStore.save(completed);
  return { ...context, session: completed, tasks };
}
const execution = await dependencies.target.execute(task, context.inventory);
const evidence = await dependencies.target.verify(task);
const evaluation = evaluateCriteria(dependencies.criteria, evidence, dependencies.passThreshold);
const iteration = context.session.iteration + 1;
const scores = [...context.session.scoreHistory.map(item => item.score), evaluation.score];
const exhausted = evaluation.decision === "FAILED" && shouldStopRepair({
  attempt: scores.length,
  maxAttempts: dependencies.maxRepairAttempts,
  scores,
  maxStagnantIterations: dependencies.maxStagnantIterations,
});
const stage = exhausted
  ? "BLOCKED"
  : evaluation.decision === "PASSED"
    ? "READY"
    : evaluation.decision === "NEEDS_REVIEW"
      ? "NEEDS_REVIEW"
      : evaluation.decision === "BLOCKED" ? "BLOCKED" : "RUNNING";
const nextSession = migrationSessionSchema.parse({
  ...context.session,
  stage,
  iteration,
  activeTaskId: evaluation.decision === "PASSED" ? undefined : task.id,
  completedTaskIds: evaluation.decision === "PASSED"
    ? [...context.session.completedTaskIds, task.id]
    : context.session.completedTaskIds,
  scoreHistory: [...context.session.scoreHistory, {
    iteration,
    score: evaluation.score,
    decision: evaluation.decision,
  }],
  updatedAt: new Date().toISOString(),
});
const nextContext = { ...context, session: nextSession, tasks, lastExecution: execution, lastEvaluation: evaluation };
await dependencies.sessionStore.save(nextSession);
await dependencies.artifacts.saveJson(
  `evidence/iteration-${String(iteration).padStart(6, "0")}.json`,
  { task, execution, evaluation },
);
await dependencies.checkpointStore.save(nextSession.id, `iteration-${iteration}`, nextContext);
await dependencies.trace("iteration.completed", { iteration, taskId: task.id, evaluation });
return nextContext;
```

Do not automatically re-run `runNext` inside the method. One invocation equals one auditable iteration.

- [ ] **Step 5: Complete the test with approved and stagnant cases**

Add an approved decision and `approvedCriteriaRevision: 1`, then assert one successful iteration records score 100 and task completion. Add a second test where scores `[70, 70, 70]` with `maxStagnantIterations: 2` produces `BLOCKED`.

- [ ] **Step 6: Run and commit**

Run: `npm test -- test/unit/migration-loop.test.ts && npm run build`

Expected: PASS and TypeScript exit 0.

```bash
git add src/core/loop/loop-policy.ts src/core/loop/migration-loop.ts test/unit/migration-loop.test.ts
git commit -m "feat: add evidence-driven migration loop"
```

## Task 8: Connect COBOL translation to the Spring Boot target adapter

**Files:**
- Create: `src/adapters/target/spring-boot/spring-boot-target-adapter.ts`
- Create: `test/integration/spring-boot-target-adapter.test.ts`
- Modify: `src/loops/subprogram-translation.loop.ts`
- Modify: `src/agents/subprogram-translator.agent.ts`

- [ ] **Step 1: Write a failing integration test with a deterministic model**

Use the existing fake `ModelClient` pattern from `test/integration/cobol-to-java-single-file.test.ts`. Return a valid `JavaMethodTranslation` JSON object for every translation prompt, then assert:

```ts
const adapter = buildSpringBootTargetAdapter({
  model: fakeModel,
  outputDir,
  profile: hollowSkinnyProfile,
  maven: { execute: vi.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: "", stderr: "" }) },
});
const tasks = await adapter.plan(inventory, architectureDecision);
expect(tasks).toHaveLength(inventory.programs.length);
await adapter.execute(tasks[0]!, inventory);
const evidence = await adapter.verify(tasks[0]!);
expect(evidence.find(item => item.criterionId === "architecture.plugin-loads")?.passed).toBe(true);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- test/integration/spring-boot-target-adapter.test.ts`

Expected: FAIL because the target adapter does not exist.

- [ ] **Step 3: Implement planning as dependency-ordered migration slices**

The adapter must call `buildCallOrder()` and create one task per program in callee-before-caller order:

```ts
return order.map(programId => ({
  id: `migrate-${programId.toLowerCase()}`,
  programIds: [programId],
  allowedPaths: ["pom.xml", "hollow/**", "skinny/**"],
}));
```

- [ ] **Step 4: Implement execution using existing translation capability and the new assembler**

For the task program, construct `SubprogramInfo`, call `runSubprogramTranslationLoop`, reject exhausted translation attempts as `REPAIRABLE`, merge the successful plugin into the durable generated-project model, call `assembleHollowSkinnyProject`, and write only returned files under `outputDir`. Validate every relative path with `resolve`, `relative`, and `isAbsolute` before writing.

The adapter constructor must accept all external dependencies:

```ts
export function buildSpringBootTargetAdapter(dependencies: {
  model: ModelClient;
  outputDir: string;
  profile: TargetArchitectureProfile;
  maven: Tool<{ projectDir: string }, CompileResult>;
}): TargetAdapter;
```

- [ ] **Step 5: Implement verification evidence**

Return evidence for every hollow/skinny hard gate plus the five score categories. Hard gates must come from `verifyHollowSkinnyProject()` and the real Maven tool result. Scores derived from deterministic checks use confidence `1`; the semantic score uses the translation evaluator result and its measured coverage, never a free-form success claim.

- [ ] **Step 6: Run and commit**

Run: `npm test -- test/integration/spring-boot-target-adapter.test.ts && npm run build`

Expected: PASS and TypeScript exit 0.

```bash
git add src/adapters/target/spring-boot \
  src/loops/subprogram-translation.loop.ts \
  src/agents/subprogram-translator.agent.ts \
  test/integration/spring-boot-target-adapter.test.ts
git commit -m "feat: migrate COBOL slices into Spring Boot plugins"
```

## Task 9: Add the interactive terminal CLI and full session flow

**Files:**
- Create: `src/interfaces/cli/commands.ts`
- Create: `src/interfaces/cli/render.ts`
- Create: `src/interfaces/cli/repl.ts`
- Create: `test/unit/cli-commands.test.ts`
- Modify: `src/apps/cli/main.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing parser tests**

```ts
import { describe, expect, it } from "vitest";
import { parseCliCommand } from "../../src/interfaces/cli/commands.js";

describe("terminal commands", () => {
  it.each([
    ["/plan", { name: "plan", args: [] }],
    ["/approve architecture hollow-skinny-v1", { name: "approve", args: ["architecture", "hollow-skinny-v1"] }],
    ["/run migrate-main", { name: "run", args: ["migrate-main"] }],
    ["/resume", { name: "resume", args: [] }],
  ])("parses %s", (input, expected) => {
    expect(parseCliCommand(input)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- test/unit/cli-commands.test.ts`

Expected: FAIL because `commands.ts` does not exist.

- [ ] **Step 3: Implement strict command parsing**

```ts
export type CliCommandName = "plan" | "architectures" | "approve" | "criteria" | "run" | "diff" | "score" | "status" | "pause" | "resume" | "exit";
export type CliCommand = { name: CliCommandName; args: string[] };

const names = new Set<CliCommandName>([
  "plan", "architectures", "approve", "criteria", "run", "diff",
  "score", "status", "pause", "resume", "exit",
]);

export function parseCliCommand(input: string): CliCommand {
  const [rawName, ...args] = input.trim().split(/\s+/);
  if (!rawName?.startsWith("/")) throw new Error("Commands must start with /");
  const name = rawName.slice(1) as CliCommandName;
  if (!names.has(name)) throw new Error(`Unknown command: ${rawName}`);
  return { name, args };
}
```

- [ ] **Step 4: Implement rendering and REPL dispatch**

Use `node:readline/promises`. `startRepl()` receives injected `input`, `output`, `sessionStore`, `migrationLoop`, `sourceAdapter`, candidate profiles, and a clock. It must:

1. load or create `.looper/session.json`;
2. run discovery once and persist `evidence/discovery.json`;
3. block `/run` until `/approve architecture <profile-id>` and `/approve criteria <revision>` succeed;
4. map `/run` to exactly one `migrationLoop.runNext()` call;
5. render score, decision, evidence, risks, and next action;
6. map `/pause` to durable `PAUSED` and `/resume` to the last saved session;
7. close cleanly on `/exit` or EOF.

When architecture is approved, persist `decisions/target-architecture.yaml`. When Criteria are proposed or approved, persist `criteria.yaml`; when target planning first runs, persist `plan.yaml`. Construct `buildFileCheckpointStore(join(workspace, ".looper"))` and `buildTraceLogger(join(workspace, ".looper/traces/session.jsonl"), session.id)` and inject them into the Migration Loop.

Keep `render.ts` pure: each renderer accepts data and returns a string. Do not print from core or adapter modules.

- [ ] **Step 5: Replace package scripts with one main command while retaining tests/build**

```json
{
  "scripts": {
    "dev": "tsx src/apps/cli/main.ts",
    "looper": "tsx src/apps/cli/main.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

`src/apps/cli/main.ts` must only load config, construct dependencies, and call `startRepl()` with `process.stdin`, `process.stdout`, and `process.cwd()`.

- [ ] **Step 6: Run and commit**

Run: `npm test -- test/unit/cli-commands.test.ts && npm run build`

Expected: PASS and TypeScript exit 0.

```bash
git add src/interfaces/cli src/apps/cli/main.ts package.json package-lock.json test/unit/cli-commands.test.ts
git commit -m "feat: add interactive looper terminal agent"
```

## Task 10: Prove the end-to-end loop, then remove old orchestration

**Files:**
- Create: `test/fixtures/legacy-project/MAIN.cob`
- Create: `test/fixtures/legacy-project/PRICE.cob`
- Create: `test/fixtures/legacy-project/COMMON.cpy`
- Create: `test/integration/legacy-migration-loop.test.ts`
- Modify: `src/index.ts`
- Modify: `README.md`
- Delete: `src/apps/cli/commands/migrate-one.command.ts`
- Delete: `src/apps/cli/commands/migrate-batch.command.ts`
- Delete: `src/apps/cli/commands/migrate-program.command.ts`
- Delete: `src/apps/cli/commands/migrate-program-meta.command.ts`
- Delete: `src/apps/cli/commands/migrate-program-spring.command.ts`
- Delete: `src/apps/cli/commands/analyze-variables.command.ts`
- Delete: `src/workflows/cobol-to-java-single-file.workflow.ts`
- Delete: `src/workflows/cobol-to-java-batch.workflow.ts`
- Delete: `src/workflows/cobol-call-graph-to-java.workflow.ts`
- Delete: `src/loops/meta-skill-improvement.loop.ts`
- Delete: `src/loops/planning.loop.ts`
- Delete: `src/loops/generation.loop.ts`
- Delete: `src/loops/compile-repair.loop.ts`
- Delete: `src/loops/compile-repair.nodes.ts`
- Delete: `src/loops/single-file-migration.loop.ts`
- Delete: `src/nodes/`
- Delete: `src/core/graph/`
- Delete: `src/core/workflow/`
- Delete: `src/skills/batch/`
- Delete: `src/schemas/batch-report.schema.ts`
- Delete: `src/agents/assembly-repair.agent.ts`
- Delete: `src/agents/cobol-migration-agent.ts`
- Delete: `src/agents/error-classifier.agent.ts`
- Delete: `src/agents/java-repair-agent.ts`
- Delete: `src/agents/program-assembler.agent.ts`
- Delete: `src/agents/skill-improver.agent.ts`
- Delete: `src/skills/common/`
- Delete: `src/skills/migration/`
- Delete: `src/skills/repair/`
- Delete: `test/integration/cobol-to-java-single-file.test.ts`
- Delete: `test/unit/compile-repair.loop.test.ts`
- Delete: `test/unit/graph-runner.test.ts`
- Delete: `test/unit/batch-scan.test.ts`
- Delete: `test/unit/dependency-graph.test.ts`
- Delete: `arch.md`
- Delete: `project_architecture_diagrams.md`

- [ ] **Step 1: Add an end-to-end fixture with CALL, COPYBOOK, LINKAGE, and shared state**

`MAIN.cob` must COPY `COMMON`, CALL `PRICE`, and pass one LINKAGE value. `PRICE.cob` must read a WORKING-STORAGE value and return a deterministic result. `COMMON.cpy` must declare a status and amount field. Keep the fixture small enough that its expected call order and variable mapping fit in the test assertions.

- [ ] **Step 2: Write the end-to-end test before deleting anything**

The test must use a deterministic fake model, a real temporary workspace, and the real file session store. It must assert:

```ts
expect(unapproved.session.stage).toBe("ARCHITECTURE_REVIEW");
expect(firstApprovedIteration.session.completedTaskIds).toHaveLength(1);
expect(finalSession.stage).toBe("COMPLETED");
expect(finalSession.scoreHistory.every(item => item.score >= 90)).toBe(true);
expect(await readFile(join(outputDir, "pom.xml"), "utf8")).toContain("<module>hollow</module>");
expect(await readFile(join(outputDir, "pom.xml"), "utf8")).toContain("<module>skinny</module>");
expect(await readFile(join(outputDir, "skinny/src/main/resources/META-INF/services/generated.cobol.api.ProgramPlugin"), "utf8"))
  .toContain("MainPlugin");
expect(await buildMavenTestTool().execute({ projectDir: outputDir })).toMatchObject({ success: true });
```

- [ ] **Step 3: Run the new end-to-end test before cleanup**

Run: `npm test -- test/integration/legacy-migration-loop.test.ts`

Expected: PASS with the generated hollow/skinny project compiling under real Maven.

- [ ] **Step 4: Export only the new public API**

Replace `src/index.ts` exports with:

```ts
export { buildMigrationLoop } from "./core/loop/migration-loop.js";
export { evaluateCriteria } from "./core/criteria/criteria-engine.js";
export { buildFileSessionStore } from "./core/session/file-session-store.js";
export { buildCobolSourceAdapter } from "./adapters/source/cobol/cobol-source-adapter.js";
export { buildSpringBootTargetAdapter } from "./adapters/target/spring-boot/spring-boot-target-adapter.js";
export { hollowSkinnyProfile } from "./profiles/hollow-skinny/hollow-skinny.profile.js";
```

- [ ] **Step 5: Delete old orchestration only after checking imports**

Run:

```bash
rg -n "apps/cli/commands|workflows/|core/graph|core/workflow|meta-skill-improvement|planning\.loop|generation\.loop|compile-repair" src test
```

Expected before deletion: references are confined to the files and legacy tests listed for deletion or replacement. Move reusable deterministic logic to its owning adapter, then use `git rm` for the obsolete paths.

- [ ] **Step 6: Delete tests owned by removed orchestration**

Use `git rm` on these exact files after the new end-to-end test passes:

```bash
git rm test/integration/cobol-to-java-single-file.test.ts \
  test/unit/compile-repair.loop.test.ts \
  test/unit/graph-runner.test.ts \
  test/unit/batch-scan.test.ts \
  test/unit/dependency-graph.test.ts
```

Keep action validation, model client, architecture, Java assembly, COBOL analysis, adapter, criteria, session, loop, CLI, and new end-to-end tests.

- [ ] **Step 7: Rewrite README around the single product flow**

README must contain exactly these top-level sections:

```markdown
# Looper
## What Looper migrates
## Install and configure
## Start a session
## Approve architecture and Criteria
## Run and review migration loops
## Resume a session
## Built-in adapters and profiles
## Development and tests
```

Document `npm run looper`, the slash commands, `.looper/` artifacts, scoring rules, and the fact that hollow/skinny is never selected automatically. Remove all old migration command instructions and diagrams.

- [ ] **Step 8: Run the full verification gate**

Run:

```bash
npm run build
npm test
rg -n "migrate-one|migrate-batch|migrate-program|migrate-program-meta|migrate-program-spring" README.md package.json src test
rg -n "from [\"'].*(?:core/graph|core/workflow|workflows/)" src test
git diff --check
```

Expected:

- TypeScript exits 0;
- all unit and integration tests pass;
- both `rg` commands return no matches;
- `git diff --check` returns no output.

- [ ] **Step 9: Commit the cutover**

```bash
git add README.md src test package.json package-lock.json
git commit -m "refactor: make migration loop the only workflow"
```

## Final acceptance

Run one manual smoke session against `test/fixtures/legacy-project`:

```bash
npm run looper
```

In the terminal:

```text
/architectures
/approve architecture hollow-skinny-v1
/criteria
/approve criteria 1
/run
/status
/score
/pause
/resume
/exit
```

Accept only when:

- no code generation occurs before architecture and Criteria approvals;
- each `/run` performs one auditable iteration;
- scores include hard-gate status, five weighted categories, confidence, and evidence paths;
- a paused session resumes from `.looper/session.json`;
- the generated project contains separately buildable hollow and skinny modules;
- real Maven tests pass;
- no legacy migration command or orchestration import remains.
