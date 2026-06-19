# Looper 项目架构与核心时序图规范

本项目是一个基于持久化状态图（State Graph）运行时和智能反馈优化环（Meta Loop）驱动的 COBOL 到 Java 自动迁移与验证引擎。为了提供极高细粒度的系统洞察，本篇文档整合了项目的**组件与依赖图（项目图）**以及**四大核心业务时序图**。

---

## 1. 项目组件与层级依赖图 (Project Component & Dependency Diagram)

本图描绘了 `looper` 的完整目录结构、关键源文件、核心层级划分以及模块之间的交互依赖流：

```mermaid
graph TD
    %% Styling Definitions
    classDef workflow fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef loop fill:#e8f5e9,stroke:#388e3c,stroke-width:2px;
    classDef node fill:#fffde7,stroke:#fbc02d,stroke-width:2px;
    classDef core fill:#ede7f6,stroke:#7b1fa2,stroke-width:2px;
    classDef agent fill:#ffebee,stroke:#c62828,stroke-width:2px;
    classDef arch fill:#fbe9e7,stroke:#d84315,stroke-width:2px;
    classDef tool fill:#eceff1,stroke:#455a64,stroke-width:2px;

    %% Layers
    subgraph "1. 工作流层 (src/workflows/)"
        BatchWF["[Batch]<br>cobol-to-java-batch.workflow.ts"]:::workflow
        SingleWF["[Single]<br>cobol-to-java-single-file.workflow.ts"]:::workflow
        CallGraphWF["[Call Graph]<br>cobol-call-graph-to-java.workflow.ts"]:::workflow
    end

    subgraph "2. 循环反馈层 (src/loops/)"
        MetaLoop["[Meta Feedback Loop]<br>meta-skill-improvement.loop.ts"]:::loop
        SubprogLoop["[Subprogram Translation Loop]<br>subprogram-translation.loop.ts"]:::loop
    end

    subgraph "3. 核心图运行时与持久化 (src/core/)"
        GraphRunner["[Graph Runner]<br>graph/graph.runner.ts"]:::core
        LoopRunner["[Generic Loop]<br>loop/loop-runner.ts"]:::core
        FileCheckpointStore["[Checkpoint Store]<br>checkpoint/file-checkpoint.store.ts"]:::core
        FileStateStore["[State Store]<br>storage/file-state-store.ts"]:::core
        TraceLogger["[Trace Log]<br>trace/trace-logger.ts"]:::core
        ArchPolicy["[Arch Interface]<br>architecture/architecture-policy.ts"]:::core
    end

    subgraph "4. 状态机业务节点 (src/nodes/)"
        subgraph "单文件迁移节点 (src/nodes/)"
            sourceIntake["source-intake.node.ts"]:::node
            capabilityGate["capability-gate.node.ts"]:::node
            analyzeCobol["analyze-cobol.node.ts"]:::node
            resolveJavaArchitecture["resolve-java-architecture.node.ts"]:::node
            planMigration["plan-migration.node.ts"]:::node
            generateJava["generate-java.node.ts"]:::node
            compile["compile.node.ts"]:::node
            classifyError["classify-error.node.ts"]:::node
            repair["repair.node.ts"]:::node
            verify["verify.node.ts"]:::node
            report["report.node.ts"]:::node
        end
        subgraph "调用链组装节点 (src/nodes/assembly/)"
            scanSubprograms["scan-subprograms.node.ts"]:::node
            expandCopybooks["expand-copybooks.node.ts"]:::node
            extractCallGraph["extract-call-graph.node.ts"]:::node
            translateSubprograms["translate-subprograms.node.ts"]:::node
            assembleProgram["assemble-program.node.ts"]:::node
            compileAssembly["compile-assembly.node.ts"]:::node
            classifyAssemblyError["classify-assembly-error.node.ts"]:::node
            repairAssembly["repair-assembly.node.ts"]:::node
            reportAssembly["report-assembly.node.ts"]:::node
        end
    end

    subgraph "5. 架构策略校验器 (src/architecture/)"
        ArchValidator["[Arch Validator]<br>java/architecture-validator.ts"]:::arch
        JavaProfile["[Java Profile]<br>java/target-java-profile.ts"]:::arch
    end

    subgraph "6. 大模型 Agent 层 (src/agents/)"
        PlanningAgent["[Planning Agent]<br>cobol-migration-agent.ts"]:::agent
        MigrationAgent["[Migration Agent]<br>cobol-migration-agent.ts"]:::agent
        JavaRepairAgent["[Repair Agent]<br>java-repair-agent.ts"]:::agent
        SkillImproverAgent["[Skill Improver Agent]<br>skill-improver.agent.ts"]:::agent
        SubprogTranslatorAgent["[Translator Agent]<br>subprogram-translator.agent.ts"]:::agent
        AssemblerAgent["[Assembler Agent]<br>program-assembler.agent.ts"]:::agent
    end

    subgraph "7. 底层命令与实体工具 (src/tools/)"
        JavacTool["[Javac Tool]<br>javac.tool.ts"]:::tool
        FilesystemTool["[FS Tool]<br>filesystem.tool.ts"]:::tool
        ShellTool["[Shell Adapter]<br>shell.tool.ts"]:::tool
    end

    %% Dependency Arrows
    BatchWF -->|依赖调用| SingleWF
    BatchWF -.->|扫描依赖关系| ScanSkill["skills/batch/scan-project.skill.ts"]
    BatchWF -.->|拓扑排序| BuildGraph["skills/batch/build-dependency-graph.skill.ts"]
    
    MetaLoop -->|执行主要流水线| CallGraphWF
    MetaLoop -->|大模型反思提炼规则| SkillImproverAgent
    MetaLoop -->|泛型迭代逻辑| LoopRunner
    
    SingleWF -->|实例化引擎运行时| GraphRunner
    SingleWF -->|按需加载| SingleNodes[Single-File Nodes]
    SingleWF -->|校验架构规范| ArchValidator
    
    CallGraphWF -->|实例化引擎运行时| GraphRunner
    CallGraphWF -->|加载组装流水线| AssemblyNodes[Assembly Nodes]
    
    SubprogLoop -->|泛型迭代逻辑| LoopRunner
    SubprogLoop -->|单方法转换| SubprogTranslatorAgent
    
    translateSubprograms -->|并发/循环翻译每个子程序| SubprogLoop

    GraphRunner -->|状态更新持久化| FileStateStore
    GraphRunner -->|生成还原检查点| FileCheckpointStore
    GraphRunner -->|追加日志追踪| TraceLogger

    %% Node to Agent/Tool bindings
    planMigration --> PlanningAgent
    generateJava --> MigrationAgent
    compile --> JavacTool
    classifyError --> ErrorClassifierAgent["[Error Classifier]<br>agents/error-classifier.agent.ts"]:::agent
    repair --> JavaRepairAgent
    verify --> ArchValidator
    
    compileAssembly --> JavacTool
    repairAssembly --> JavaRepairAgent
    assembleProgram --> AssemblerAgent

    ArchValidator --> JavaProfile
```

---

## 2. 核心流程时序图 (Full-Flow Sequence Diagrams)

由于系统支持四种不同的运行流程，这里以**极细粒度**分别拆解每种机制的时序交互过程：

````carousel
```mermaid
sequenceDiagram
    autonumber
    title Flow 1: 单文件迁移时序 (Single-File Workflow)
    
    participant Entry as Single File Workflow
    participant Runner as GraphRunner
    participant Nodes as StateGraph Nodes
    participant State as FileStateStore (state.json)
    participant CP as FileCheckpointStore
    participant LLM as DeepSeek (Model Client)
    participant Javac as JavacTool (Compiler)
    participant Arch as ArchitectureValidator

    Entry->>State: 1.1 初始化迁移状态 (status: "CREATED")
    Entry->>Runner: 1.2 启动 GraphRunner (起点: "sourceIntake")
    
    %% Loop starting
    loop 循环节点转换直至 "END"
        Runner->>Nodes: 2.1 执行当前节点 .run(state, context)
        
        alt Node: sourceIntake
            Nodes->>Nodes: 读取源 COBOL 源码并载入 state
        else Node: capabilityGate
            Nodes->>Nodes: 解析 COBOL, 检查 COPY/EXEC-SQL/CICS
            Note over Nodes: 若发现不支持特性, 标记终止或 INTERRUPTED 挂起
        else Node: resolveJavaArchitecture
            Nodes->>Arch: 获取匹配的目标 TargetJavaProfile (V1)
        else Node: planMigration
            Nodes->>LLM: 调用 PlanningAgent 生成迁移策略 markdown
        else Node: generateJava
            Nodes->>LLM: 调用 MigrationAgent 生成初始 Java 源码
            Nodes->>Arch: 验证源码是否违反架构限制
        else Node: compile
            Nodes->>Javac: 调用本地 javac 执行编译
            Javac-->>Nodes: 返回编译结果 (success, stdout, stderr)
        else Node: classifyError (仅编译失败时)
            Nodes->>LLM: 调用 ErrorClassifierAgent 分析错误原因
        else Node: repair (仅编译失败时)
            Nodes->>LLM: 调用 JavaRepairAgent 预测修复代码 (patch)
            Nodes->>Arch: 验证修复后的代码是否符合规范
        else Node: verify (编译成功时)
            Nodes->>Arch: 静态分析 + 类名一致性 + 架构强规则校验
        else Node: report
            Nodes->>Nodes: 写入最终迁移运行报告 markdown 文件
        end
        
        Nodes-->>Runner: 2.2 返回 NodeResult { state, status, next }
        Runner->>State: 2.3 save(state) 覆盖 state.json (临时文件写 + 原子 Rename)
        Runner->>CP: 2.4 save(checkpoint) 写入独立检查点快照
        Note over Runner: 依据 next 执行节点跳转 (如 compile -> classifyError)
    end
    
    Runner-->>Entry: 3. 返回最终 MigrationState
```
<!-- slide -->
```mermaid
sequenceDiagram
    autonumber
    title Flow 2: 批量迁移时序 (Batch Workflow)
    
    participant CLI as Batch CLI Entry
    participant Batch as Batch Workflow
    participant Scan as ScanProject Skill
    participant Graph as Dependency Graph Skill
    participant Single as Single-File Workflow
    participant Report as Aggregate Report Skill

    CLI->>Batch: 1. 执行批量任务
    Batch->>Scan: 2. 扫描源文件夹 (.cbl / .cob)
    Scan-->>Batch: 返回文件列表及过滤的跳过项
    
    Batch->>Graph: 3. 提取文件 COPY 依赖并建图
    Graph-->>Batch: 返回拓扑排序后的文件列表 (解决循环引用)
    
    loop 串行按拓扑顺序处理每个 COBOL 文件 (并发为 1)
        Batch->>Batch: 触发 onFileStart 监听
        Batch->>Single: 4. 调用 Single-File Workflow (分配子 runs)
        Single-->>Batch: 返回当前文件迁移结果 (SUCCESS/FAILED)
        Batch->>Batch: 记录耗时与失败详情, 触发 onFileComplete
    end
    
    Batch->>Report: 5. 聚合各单文件结果, 导出 markdown / json 批处理报告
    Report-->>Batch: 返回报告路径
    Batch-->>CLI: 6. 返回批量运行汇总统计 (总数, 成功, 失败等)
```
<!-- slide -->
```mermaid
sequenceDiagram
    autonumber
    title Flow 3: 调用链分析组装迁移 (Call-Graph Assembly Workflow)
    
    participant Entry as Call Graph Workflow
    participant Runner as GraphRunner
    participant Nodes as Assembly Nodes
    participant SubLoop as SubprogramTranslationLoop
    participant LLM as DeepSeek (Model Client)
    participant Javac as JavacTool (Compiler)
    participant Arch as ArchitectureValidator

    Entry->>Runner: 1. 启动 GraphRunner (起点: "scanSubprograms")
    
    %% Setup & Callgraph Extract
    Runner->>Nodes: 2. 执行 scanSubprograms (扫描所有子程序)
    Runner->>Nodes: 3. 执行 expandCopybooks (平铺替换 COPYBOOK 宏指令)
    Runner->>Nodes: 4. 执行 extractCallGraph (分析 CALL 语句构造调用链图)
    
    %% Translation Node with loop
    Runner->>Nodes: 5. 执行 translateSubprograms
    loop 循环翻译每个独立的子程序
        Nodes->>SubLoop: 调用 runSubprogramTranslationLoop()
        loop 验证重试 (最大 attempts 限制)
            SubLoop->>LLM: 5.1 翻译子程序为 Java 方法 (包含 Linkage 参数转换)
            SubLoop->>SubLoop: 5.2 规则校验 (CamelCase, Braces 平衡, nested 方法检测等)
            Note over SubLoop: 校验通过或达最大次数, 跳出循环
        end
        SubLoop-->>Nodes: 返回方法体及签名
    end
    
    %% Assemble & Validate
    Runner->>Nodes: 6. 执行 assembleProgram (将所有方法组装进单个 public Java 类)
    Runner->>Nodes: 7. 执行 compileAssembly (javac 编译)
    
    alt 编译失败
        Runner->>Nodes: 8.1 执行 classifyAssemblyError (分类大模型解析错误)
        Runner->>Nodes: 8.2 执行 repairAssembly (修补并重新编译)
    end
    
    Runner->>Nodes: 9. 执行 reportAssembly (导出整体集成报告)
    Runner-->>Entry: 10. 返回最终 AssemblyMigrationState
```
<!-- slide -->
```mermaid
sequenceDiagram
    autonumber
    title Flow 4: 规则自动演进环 (Meta-Skill Improvement Loop)
    
    participant User as CLI Command / User
    participant Meta as Meta Loop Runner
    participant Model as SkillImproverAgent
    participant WF as Call-Graph Workflow
    participant File as Filesystem

    User->>Meta: 1. 启动 Meta 循环 (maxRounds)
    
    loop 轮次 (Round = 1 to maxRounds)
        alt Round > 1 且 上一轮存在翻译失败项
            Meta->>Model: 2.1 传入失败的 COBOL 源码片段与上一轮的报错原因
            Model-->>Meta: 2.2 提炼并生成新的转换规则列表 (SkillRule[])
            Meta->>Meta: 2.3 追加到累加规则库中 (accumulatedRules)
        end
        
        Meta->>Meta: 3.1 序列化规则为文本提示词 (skillRulesText)
        Meta->>WF: 3.2 触发 Call-Graph Workflow (注入当前的规则 text)
        Note over WF: 工作流在子程序翻译阶段使用当前规则限制大模型输出
        WF-->>Meta: 3.3 返回工作流运行结果 (Compiled? Report Path)
        
        alt 编译成功 (SUCCESS)
            Note over Meta: 判定为通过, 提早结束轮次循环
        else 编译失败 (FAILED)
            Note over Meta: 收集这轮的 translationFailures 用于下一轮迭代
        end
        
        Meta->>Meta: 4. 触发 onRoundComplete 进度回调
    end
    
    Meta-->>User: 5. 返回 MetaMigrationResult (编译状态, 总轮次, 累积规则列表)
```
````

---

## 3. 核心文件设计指南与时序强校验

为了确保迁移后的 Java 源码具有绝对的安全性与确定性，`src/architecture/java/architecture-validator.ts` 内部的时序审查包含以下细粒度检查逻辑：

| 校验编码 (Code) | 校验细节描述 | 时序影响与决策 |
| :--- | :--- | :--- |
| `SOURCE_TOO_LARGE` | 检测源码大小是否超过 `TargetJavaProfile.maxSourceBytes` (默认 256 KiB) | 超限则在 **generateJava** / **repair** 阶段直接判定为违规并触发重新规划。 |
| `PACKAGE_FORBIDDEN` | 代码不能包含 `package xxx;` 声明，仅允许 plain 结构 | 确保单文件 `javac` 可直接在输出目录编译。 |
| `EXTERNAL_IMPORT_FORBIDDEN` | 检查 `import` 是否在允许的前缀列表（仅限 `java.`，`javax.`）内 | 隔离依赖，防止模型任意引用外部未托管库。 |
| `FRAMEWORK_SYMBOL_FORBIDDEN` | 严格屏蔽任何 `org.springframework`、`hibernate` 等框架关键字 | 保证生成的代码是 100% 纯粹的纯 Java 逻辑。 |
| `SINGLE_TYPE_REQUIRED` | 代码中只能且必须声明一个类/接口/枚举/记录类型 | 强制生成平铺的面向过程转化 Java 代码，不得进行多文件拆分。 |
| `CLASS_NAME_MISMATCH` | 类名必须与工作流输入的 `className` 完美匹配 | 保证文件系统的文件名与 public 类名一致。 |
| `RUN_METHOD_REQUIRED` | 代码中必须包含 `public void run()` 方法 | 约定作为 COBOL `PROCEDURE DIVISION` 的主要控制入口。 |
| `MAIN_METHOD_REQUIRED` | 必须包含标准的 `public static void main(String[] args)` 静态入口 | 确保转成的 Java 代码开箱即用，支持独立命令行运行。 |
| `MAIN_MUST_DELEGATE` | main 方法内部必须显式委托给 `new ClassName().run()` | 限制 main 的职责仅作为实例化引导器，避免面向对象设计退化。 |

---

> [!TIP]
> 每一个时序状态的流转都严格依赖事务级更新保证。如果在流程中遭遇系统中断，可以利用 `runs/` 下对应的 `state.json` 结合 `checkpoints/` 快照，无缝恢复执行，而无需重复高昂的 LLM 调用开销。
