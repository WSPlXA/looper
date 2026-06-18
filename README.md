# deepseek-loop-engine

一个用于编译器驱动的 COBOL 到 Java 迁移的 durable state-graph agent runtime。

`deepseek-loop-engine` 通过受约束的 durable graph，协调 COBOL 输入、能力准入（capability gating）、分析、迁移规划、Java 代码生成、编译、错误分类、修复、验证和报告。DeepSeek 负责生成结构化的 actions；确定性的 tools 和 verifiers 控制状态流转。

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

model 无法直接设置 `SUCCESS` 状态或直接写入文件。Generate/repair 调用返回经过校验的 `WRITE_FILE` 或 `PATCH_FILE` actions，其路径必须与受控的 run 输出目录下的目标 Java 文件完全一致。`CompileNode` 只能产生 `COMPILE_PASSED` 状态；只有 `VerifyNode` 在检查了真实的 `javac` 结果、生成的源码、类名以及可选的验证回调（verification callback）之后，才能产生 `SUCCESS` 状态。

缺失 `COPYBOOK` context 时，会产生带有 `requiredInput.copybookSearchPath` 的 `INTERRUPTED` 状态。其他不支持的 V1 特性（`EXEC SQL`、JCL、`FILE SECTION`、索引文件 I/O、CICS）会在 model 运行生成前终止。

该 runtime 包含两个不同的有界循环：通用的 `StateGraph` 执行循环以及条件驱动的 compile-classify-repair 循环。其实现风格为 LangGraph 风格的 durable state graph，结合了 Mastra 风格的 TypeScript runtime primitives 以及由编译器把关的状态演进机制（compiler-gated state advancement）。

## 目标 Java 架构 (Target Java architecture)

目标 Java 架构由确定性的 `TargetJavaProfile` 控制，而不是由 model 决定。`resolveJavaArchitecture` 会在迁移规划前选择并对当前 active 的 profile 进行 checkpoint。该 profile 会被注入到 planning、generation 和 repair 的 prompts 中，然后在写入任何生成或修复的源码之前，由 `ArchitectureValidator` 独立强制执行。`VerifyNode` 也会在生成 `SUCCESS` 之前再次验证该 profile。

默认 V1 profile：`plain-java-single-class-v1`。

- 恰好只有一个 Java 源文件和一个声明的 Java 类型
- public 类名与 CLI 的 `targetClassName` 一致
- 无 package 声明
- 无外部依赖；仅允许导入 JDK `java.*` / `javax.*`
- 无 Spring、Lombok、持久化框架、Maven 或 Gradle 标识
- COBOL `PROCEDURE DIVISION` 映射为 `public void run()`
- `public static void main(String[] args)` 代理调用 `new TargetClass().run()`
- COBOL `DISPLAY` 映射到 `System.out`
- 源码必须能通过原生的 `javac` 编译

除非策略显式提供了不同的 profile，否则 model 无法引入任何框架、package、额外文件、额外的类型布局、构建依赖或交替入口点。架构验证结果以及 active 的 profile ID 会被持久化保存在 state、checkpoints、trace 和 report 等 artifacts 中。

## Runtime 布局与物理开销 (Runtime layout and physical cost)

- `core/graph/` 包含通用的有界 `StateGraph` runner。它不导入任何 COBOL、Java、`javac` 或 DeepSeek 代码。
- `core/checkpoint/` 在每个完成的节点之后写入一个不可变的 checkpoint 包，并能够加载最新的 checkpoint。Resume 命令目前尚未实现。
- `core/actions/` 用于校验 model 提出的文件 actions，并直接应用统一的 diff，而无需调用 shell。
- `core/architecture/` 定义了领域中立的策略契约；`architecture/java/` 包含确定性的 Java profile 以及单遍源码验证器。
- `models/deepseek/` 每个 model 步骤执行一次与 OpenAI 兼容的 HTTP 请求。Model 名称和 base URL 是配置项，而非常量。
- `loops/compile-repair.loop.ts` 现为一个轻量级的 graph assembler。编译尝试保持为连续的 append-only 数组；错误分类则按 attempt number 分开追加。
- `tools/shell.tool.ts` 使用 argv 和 `shell: false` 来调用可执行文件，将捕获的输出限制在 2 MiB 以内，并强制执行超时。这可以防止 shell 注入、无限制的 stderr 内存分配以及编译器进程卡死。
- 每个节点执行后，持久化顺序为：`state.json` -> checkpoint -> transition trace。State/checkpoint 的写入使用 temp-file + rename 的机制；trace 的写入则是序列化的 JSONL 追加。这里不存在并发的共享写入者或锁护送（lock convoy）。

主要的物理开销是 model 网络延迟和 `javac` 进程启动。Cache-line 对齐、Arena 分配、SoA 以及并行编译在 V1 版本中无法明显提升吞吐量。批处理工作已被有意推迟，直至依赖关系排序和背压机制实现。

## 前提条件 (Prerequisites)

- Node.js 20+
- JDK 且 `javac` 已配置在 `PATH` 中
- 兼容 DeepSeek 的 API 端点和 API key

```powershell
npm install
Copy-Item .env.example .env
# 编辑 .env。具体的 V4 Pro model 标识符取决于提供商。
npm run build
npm test
```

运行迁移：

```powershell
npm run migrate -- examples/cobol/HELLO.cob examples/output Hello 5
```

## Docker 构建与测试 (Docker build and test)

`test` 目标会在镜像构建期间安装 OpenJDK、构建 TypeScript 并执行完整的测试套件：

```powershell
docker compose build test
docker compose run --rm test
```

构建精简的 runtime 镜像，不启动 model 调用：

```powershell
docker compose --profile migrate build migrate
```

在导出有效的 API key 和特定提供商的 model 标识符后，才能运行示例迁移：

```powershell
$env:DEEPSEEK_API_KEY="..."
$env:DEEPSEEK_MODEL="deepseek-v4-pro"
docker compose --profile migrate run --rm migrate
```

`runs/` 和 `examples/output/` 会进行绑定挂载，以便 checkpoints、traces、reports 和生成的 Java 代码保存在宿主机上。

生成产物（Artifacts）：

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

成功时，最终的源文件也会被复制到 CLI 的 `output-dir` 中。源码读取、model 调用、action 校验、编译和验证失败仍会生成相应的 state、失败时的 checkpoint、trace 以及 report 等 artifacts。

## 终止与重载行为 (Stop and overload behavior)

- 编译修复受到 `maxAttempts` 的上限约束；不存在无界的重试队列。
- 图具有转换预算限制，因此异常的循环不会无限执行。
- Model 调用超时默认位 120 秒；编译器调用超时默认为 30 秒。
- 编译器输出大小限制在 2 MiB 以内。
- V1 是单运行/单写入者模式。在实现 COPYBOOK/依赖关系排序以及有界工作队列之前，不要添加文件级别的并发。

## 范围 (Scope)

- 包含：durable StateGraph runtime、checkpoints、结构化的 actions、确定性错误分类、人工干预状态（human interrupt state）、验证门（verification gate）、DeepSeek 适配器、CLI、JSONL trace、JSON report，以及真实的 `javac` 集成测试。
- 延后：HTTP 服务器、批量迁移（batch migration）、GnuCOBOL 行为等价对比、COPYBOOK 展开、DB2、JCL、CICS，以及多 agent 协作。

## 参考资料 (References)

- [DeepSeek Chat API](https://api-docs.deepseek.com/api/create-chat-completion)
- [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode)
- [Node child processes](https://nodejs.org/api/child_process.html)
