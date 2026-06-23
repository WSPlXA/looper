# Looper

Looper is a session-based COBOL-to-Java migration assistant. It discovers COBOL programs, asks for explicit architecture and Criteria approval, runs one migration task at a time, verifies generated code with deterministic gates, and persists the whole session under `.looper/` so work can be resumed.

## What Looper migrates

Looper currently migrates small COBOL program sets through the built-in COBOL source adapter and the Spring Boot hollow/skinny target adapter.

- COBOL input: `.cob`, `.cbl`, and `.cpy` files under the workspace.
- Discovery: `PROGRAM-ID`, `CALL` relationships, `LINKAGE SECTION`, `WORKING-STORAGE`, and COPY expansion evidence.
- Output: a Maven multi-module Java project under `.looper/generated/`.
- Verification: generated project structure plus real `mvn test`.

The active target profile is `hollow-skinny-v1`: `hollow` owns stable runtime/API contracts, while `skinny` owns COBOL-derived business plugins. Looper never selects hollow/skinny automatically; a human must approve the profile before any code generation.

## Install and configure

Requirements:

- Node.js 20+
- JDK 17+
- Maven on `PATH`
- A DeepSeek-compatible chat API key for live model runs

Install dependencies and check the local project:

```bash
npm install
cp .env.example .env
npm run build
npm test
```

Edit `.env` with your provider settings:

```bash
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=...
DEEPSEEK_MODEL=...
MODEL_TIMEOUT_MS=120000
```

## Start a session

Run Looper from the root of the COBOL workspace:

```bash
npm run looper
```

The CLI starts an interactive session and writes durable state into `.looper/`. On first start it discovers COBOL sources and creates a session in `ARCHITECTURE_REVIEW`.

Available slash commands:

- `/architectures` lists target profiles available for human approval.
- `/approve architecture <profile-id>` approves one target architecture.
- `/criteria` writes and displays the current Criteria revision.
- `/approve criteria <revision>` approves the current Criteria revision.
- `/plan` creates or displays migration tasks.
- `/run [task-id]` runs the next task, or a specific pending task.
- `/diff` shows files changed by the last run.
- `/score` shows the last Criteria evaluation.
- `/status` shows the current session state.
- `/pause` saves the session as paused.
- `/resume` reloads the saved session.
- `/exit` closes the CLI.

## Approve architecture and Criteria

Looper requires two explicit approvals before execution:

1. Architecture approval chooses the target profile. For the built-in flow:

   ```text
   /architectures
   /approve architecture hollow-skinny-v1
   ```

2. Criteria approval confirms the scoring and hard gates:

   ```text
   /criteria
   /approve criteria 1
   ```

Approval state is persisted in `.looper/session.json` and `.looper/decisions/target-architecture.yaml`. Criteria are persisted in `.looper/criteria.yaml`.

## Run and review migration loops

After approvals, create a plan and run tasks:

```text
/plan
/run
```

Each loop iteration:

- selects the next pending migration task;
- asks the target adapter to generate or update hollow/skinny files;
- runs target verification, including `mvn test`;
- evaluates Criteria;
- records evidence under `.looper/evidence/`;
- saves checkpoints under `.looper/checkpoints/`;
- updates `.looper/session.json`.

Scoring uses hard gates plus weighted score Criteria. Hard gates must pass. Weighted score Criteria must produce an overall score at or above the loop threshold, currently `90`. A task is marked complete only when the evaluation decision is `PASSED`; repeated failed or stagnant scores move the session to `BLOCKED`.

Use `/diff`, `/score`, and `/status` after `/run` to inspect what changed and why the session advanced, paused for review, or blocked.

## Resume a session

Run the same command again from the same workspace:

```bash
npm run looper
```

Then use:

```text
/resume
/status
/plan
/run
```

Looper reloads `.looper/session.json`, previously approved architecture, and the persisted plan when available. Generated Java stays in `.looper/generated/`, so subsequent loop iterations can recover existing plugin files before writing the next task.

## Built-in adapters and profiles

Public API exports:

- `buildMigrationLoop`
- `evaluateCriteria`
- `buildFileSessionStore`
- `buildCobolSourceAdapter`
- `buildSpringBootTargetAdapter`
- `hollowSkinnyProfile`

Built-in source adapter:

- `buildCobolSourceAdapter()` discovers COBOL programs and copybooks from a source root.

Built-in target adapter:

- `buildSpringBootTargetAdapter()` writes a Maven hollow/skinny project.
- The parent `pom.xml` includes `<module>hollow</module>` and `<module>skinny</module>`.
- `skinny` registers generated plugins through `META-INF/services/generated.cobol.api.ProgramPlugin`.

Built-in profile:

- `hollowSkinnyProfile` defines `hollow-skinny-v1`, its module boundaries, hard gates, and score Criteria.
- The profile is an available candidate, not an automatic choice.

## Development and tests

Useful commands:

```bash
npm run build
npm test
npm test -- test/integration/legacy-migration-loop.test.ts
```

The E2E integration test uses a deterministic fake model, real file session storage, the real migration loop, the COBOL source adapter, the Spring Boot target adapter, `hollowSkinnyProfile`, and real Maven verification.

Before publishing changes, run:

```bash
npm run build
npm test
git diff --check
```
