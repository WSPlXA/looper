# deepseek-loop-engine

A durable state-graph agent runtime for compiler-driven COBOL-to-Java migration.

`deepseek-loop-engine` coordinates COBOL intake, capability gating, analysis, migration planning, Java generation, compilation, error classification, repair, verification, and reporting through a bounded durable graph. DeepSeek proposes structured actions; deterministic tools and verifiers control state transitions.

```text
sourceIntake
  -> capabilityGate
  -> analyzeCobol
  -> resolveJavaArchitecture
  -> planMigration
  -> generateJava
  -> compile

compile --COMPILE_PASSED--> verify -> report
compile --COMPILE_FAILED--> classifyError -> repair -> compile
compile --MAX_ATTEMPTS_EXCEEDED--> classifyError -> report

capabilityGate --MISSING_COPYBOOK_CONTEXT--> INTERRUPTED -> report
capabilityGate --UNSUPPORTED_FEATURE--> report
verify --SUCCESS--> report
verify --FAILED--> report
```

The model cannot set `SUCCESS` or write files directly. Generate/repair calls return validated `WRITE_FILE` or `PATCH_FILE` actions whose path must be exactly the target Java file under the controlled run output directory. `CompileNode` can only produce `COMPILE_PASSED`; only `VerifyNode` can produce `SUCCESS` after checking the real `javac` result, generated source, class name, and optional verification callback.

Missing COPYBOOK context produces `INTERRUPTED` with `requiredInput.copybookSearchPath`. Other unsupported V1 features (`EXEC SQL`, JCL, `FILE SECTION`, indexed file I/O, CICS) stop before model generation.

The runtime has two distinct bounded loops: the generic StateGraph execution loop and the conditional compile-classify-repair loop. Its implementation style is a LangGraph-style durable state graph with Mastra-style TypeScript runtime primitives and compiler-gated state advancement.

## Target Java architecture

Target Java architecture is controlled by a deterministic `TargetJavaProfile`, not by the model. `resolveJavaArchitecture` selects and checkpoints the active profile before migration planning. The profile is injected into planning, generation, and repair prompts, then independently enforced by `ArchitectureValidator` before any generated or repaired source is written. `VerifyNode` validates the profile again before it can produce `SUCCESS`.

Default V1 profile: `plain-java-single-class-v1`.

- exactly one Java source file and one declared Java type
- public class name equals the CLI `targetClassName`
- no package declaration
- no external dependencies; only JDK `java.*` / `javax.*` imports are permitted
- no Spring, Lombok, persistence framework, Maven, or Gradle symbols
- COBOL `PROCEDURE DIVISION` maps to `public void run()`
- `public static void main(String[] args)` delegates to `new TargetClass().run()`
- COBOL `DISPLAY` maps to `System.out`
- source must compile with plain `javac`

The model cannot introduce frameworks, packages, extra files, extra type layouts, build dependencies, or alternate entry points unless a different profile is explicitly supplied by policy. Architecture validation results and the active profile ID are persisted in state, checkpoints, trace, and report artifacts.

## Runtime layout and physical cost

- `core/graph/` contains the generic bounded StateGraph runner. It imports no COBOL, Java, `javac`, or DeepSeek code.
- `core/checkpoint/` writes one immutable checkpoint envelope after every completed node and can load the latest checkpoint. Resume commands are not implemented yet.
- `core/actions/` validates model-proposed file actions and applies unified diffs without invoking a shell.
- `core/architecture/` defines the domain-neutral policy contract; `architecture/java/` contains the deterministic Java profile and single-pass source validator.
- `models/deepseek/` performs one OpenAI-compatible HTTP request per model step. The model name and base URL are configuration, not constants.
- `loops/compile-repair.loop.ts` is now a thin graph assembler. Compile attempts remain a contiguous append-only array; error classifications are appended separately by attempt number.
- `tools/shell.tool.ts` invokes executables with argv and `shell: false`, caps captured output at 2 MiB, and enforces a timeout. This prevents shell injection, unbounded stderr allocation, and hung compiler processes.
- After each node, persistence order is `state.json`, checkpoint, then transition trace. State/checkpoint writes use temp-file + rename; trace writes are serialized JSONL appends. There is no concurrent shared writer or lock convoy.

The dominant costs are model network latency and `javac` process startup. Cache-line alignment, Arena allocation, SoA, and parallel compilation would not improve V1 throughput measurably. Batch work is intentionally deferred until dependency ordering and backpressure exist.

## Prerequisites

- Node.js 20+
- JDK with `javac` on `PATH`
- A DeepSeek-compatible endpoint and API key

```powershell
npm install
Copy-Item .env.example .env
# Edit .env. The exact V4 Pro model identifier depends on the provider.
npm run build
npm test
```

Run a migration:

```powershell
npm run migrate -- examples/cobol/HELLO.cob examples/output Hello 5
```

## Docker build and test

The `test` target installs OpenJDK, builds TypeScript, and executes the full test suite during image construction:

```powershell
docker compose build test
docker compose run --rm test
```

Build the reduced runtime image without starting a model call:

```powershell
docker compose --profile migrate build migrate
```

Run the example migration only after exporting a valid API key and provider-specific model identifier:

```powershell
$env:DEEPSEEK_API_KEY="..."
$env:DEEPSEEK_MODEL="deepseek-v4-pro"
docker compose --profile migrate run --rm migrate
```

`runs/` and `examples/output/` are bind-mounted so checkpoints, traces, reports, and generated Java remain on the host.

Artifacts:

```text
runs/<run-id>/
  state.json
  trace.jsonl
  report.json
  checkpoints/
    000000-sourceIntake-succeeded.json
    000001-capabilityGate-succeeded.json
    ...
  attempts/attempt-1.java
  output/Hello.java
```

On success, the final source is also copied to the CLI `output-dir`. Source-read, model, action validation, compilation, and verification failures still produce state, failure checkpoint, trace, and report artifacts.

## Stop and overload behavior

- Compile repair is capped by `maxAttempts`; no unbounded retry queue exists.
- The graph has a transition budget, so a malformed cycle cannot run forever.
- Model calls default to 120 seconds; compiler calls default to 30 seconds.
- Compiler output is bounded to 2 MiB.
- V1 is single-run/single-writer. Do not add file-level concurrency before COPYBOOK/dependency ordering and a bounded work queue are implemented.

## Scope

Included: durable StateGraph runtime, checkpoints, structured actions, deterministic error classification, human interrupt state, verification gate, DeepSeek adapter, CLI, JSONL trace, JSON report, and real-`javac` integration tests.

Deferred: HTTP server, batch migration, GnuCOBOL behavior comparison, COPYBOOK expansion, DB2, JCL, CICS, and multi-agent collaboration.

References: [DeepSeek Chat API](https://api-docs.deepseek.com/api/create-chat-completion), [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode), [Node child processes](https://nodejs.org/api/child_process.html).
