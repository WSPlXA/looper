# DeepSeek Loop Engine Architecture

本项目是一个基于持久化状态图（State Graph）运行时驱动的 COBOL 到 Java 迁移引擎。它利用大模型（DeepSeek）进行迁移规划和代码生成/修复，并使用确定性编译器（javac）和架构验证器（ArchitectureValidator）进行严格把关。

---

## 1. 核心系统组件图 (System Component Diagram)

以下是引擎的核心层次结构和组件依赖关系：

```mermaid
graph TD
    %% CLI Layer
    CLI[CLI Entry main.ts / command] -->|触发工作流| Workflow[cobol-to-java-single-file.workflow.ts]

    %% Workflow Runner
    subgraph "Core StateGraph Runner"
        Workflow -->|构建与启动| Runner[GraphRunner]
        Runner -->|加载/保存 State| StateStore[FileStateStore]
        Runner -->|持久化节点状态| CheckpointStore[FileCheckpointStore]
        Runner -->|追踪节点转换| TraceLogger[TraceLogger]
    end

    %% Nodes Layer
    subgraph "State Graph Nodes (src/nodes/)"
        Intake[sourceIntake]
        Gate[capabilityGate]
        Analyze[analyzeCobol]
        Resolve[resolveJavaArchitecture]
        Plan[planMigration]
        Gen[generateJava]
        Compile[compile]
        Classify[classifyError]
        Repair[repair]
        Verify[verify]
        Report[report]
    end

    Runner -->|执行| Intake
    Intake --> Gate --> Analyze --> Resolve --> Plan --> Gen --> Compile
    Compile -->|PASSED| Verify --> Report
    Compile -->|FAILED| Classify --> Repair --> Compile

    %% Business & Tools Layer
    subgraph "Models & Tools"
        Plan & Gen & Classify & Repair -.->|调用大模型| DeepSeek[DeepSeek Client]
        Compile -->|调用本地编译器| JavacTool[JavacTool]
        Verify -->|静态校验规范| ArchValidator[ArchitectureValidator]
    end

    subgraph "FileSystem Persistence"
        StateStore & CheckpointStore & TraceLogger -->|写入磁盘| RunsDir[runs/run-id/ <br> state.json <br> checkpoints/ <br> trace.jsonl]
    end
```

---

## 2. 状态机执行流与分支决策 (State Transition Flow)

图运行时基于 `durable state-graph` 进行状态演进，其控制流与决策流如下：

```mermaid
flowchart TD
    Start([开始: sourceIntake]) --> Gate{capabilityGate}

    %% Gating
    Gate -->|包含 EXEC_SQL / JCL / CICS| EndUnsupported([UNSUPPORTED 终止])
    Gate -->|包含 COPY 语句| EndInterrupted([INTERRUPTED 挂起])
    Gate -->|通过检验| Analyze[analyzeCobol]

    %% Planning & Generation
    Analyze --> Resolve[resolveJavaArchitecture <br> 绑定 TargetJavaProfile]
    Resolve --> Plan[planMigration <br> 生成迁移设计计划]
    Plan -->|包含不支持特性| PlanUnsupported([UNSUPPORTED 终止]) --> Report
    Plan -->|成功规划| Gen[generateJava <br> 生成初始 Java 源码]
    Gen -->|架构策略验证未通过| GenArchFailed([标记为 FAILED]) --> Report
    Gen -->|通过验证| Compile{compile <br> 调用 javac 编译}

    %% Compile & Repair Loop
    Compile -->|编译失败 < maxAttempts| Classify[classifyError <br> 分析编译错误信息]
    Classify -->|UnsupportedTranslation 或 <br> 尝试次数 >= maxAttempts| ClassifyMax([标记为 FAILED]) --> Report
    Classify -->|需要修复| Repair[repair <br> 生成修复补丁]
    Repair -->|架构策略验证未通过| RepairArchFailed([标记为 FAILED]) --> Report
    Repair -->|通过验证 并 尝试次数 + 1| Compile

    %% Verification
    Compile -->|编译成功 COMPILE_PASSED| Verify{verify 综合校验}
    Verify -->|1. 编译结果成功<br>2. 源码文件存在<br>3. 类名匹配一致<br>4. 架构校验通过 ArchValidator| Success[标记为 SUCCESS] --> CopyToOutput[拷贝最终 Java 源码到输出目录] --> Report
    Verify -->|任意校验失败| Failed[标记为 FAILED] --> Report

    %% Reporting
    Report[report <br> 生成迁移分析报告] --> End([结束])
```

---

## 3. 持久化与恢复模型 (Persistence & Checkpoint Model)

在每个节点（Node）执行完毕后，`GraphRunner` 会以**事务级**顺序保存进度，这是实现 Durable Execution 的基础：

```mermaid
sequenceDiagram
    participant Runner as GraphRunner
    participant Store as FileStateStore (state.json)
    participant CP as FileCheckpointStore (checkpoints/)
    participant Trace as TraceLogger (trace.jsonl)
    participant Disk as FileSystem

    Note over Runner: 节点执行完毕得到新 State
    Runner->>Store: save(state)
    Store->>Disk: 临时文件写入 + 原子 Rename 重命名
    Runner->>CP: save(runId, node_status, state)
    CP->>Disk: 写入该节点的独立 checkpoint 归档
    Runner->>Trace: trace("state.transition", data)
    Trace->>Disk: 以 JSONL 形式向 trace.jsonl 追加一行
```

---

## 4. 各层职责划分

| 目录/模块 | 职责与设计模式 |
| :--- | :--- |
| `src/core/graph/` | **通用无状态图运行器**。提供 `GraphRunner` 和 `GraphNode` 抽象，不涉及任何具体的 COBOL、Java 业务逻辑。 |
| `src/core/checkpoint/` | **检查点持久化**。在每个 Node 执行结束后输出一份不可变的快照，保证后续 Resume CLI 可按快照回滚或恢复。 |
| `src/core/actions/` | **安全文件行为器**。只接收模型生成的 `WRITE_FILE` 或 `PATCH_FILE` action 并对其路径进行绝对沙箱化校验后执行改动。 |
| `src/architecture/java/` | **架构规约强制器**。提供 `TargetJavaProfile`（如 plain-java-single-class-v1）和 `ArchitectureValidator`，静态分析并拒绝任何引入了框架、多文件或 package 的非合规 Java 代码。 |
| `src/nodes/` | **业务图节点**。各步骤状态演进的直接执行者，调用大模型或工具（如 `javac`）。 |
| `src/tools/` | **物理工具适配器**。如 `JavacTool` 以 `shell: false` 形式安全地孵化编译器子进程，提供超时控制和最大 2 MiB 的缓冲区截断保护。 |
