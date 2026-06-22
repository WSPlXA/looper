# Looper Legacy Migration Loop Engineering 设计书

## 1. 背景与目标

Looper 当前已经具备 COBOL 文件扫描、COPYBOOK 展开、调用图提取、变量分析、Java/Spring Boot 代码生成、编译、修复、Checkpoint 和 Trace 等能力，但这些能力分散在多套 CLI、Workflow、Graph、Node、Loop、Agent 和 Skill 编排中。单文件、批量、程序组装、Meta 改进和 Spring Boot 迁移各自形成入口，导致产品主线不清晰，也增加了维护和扩展成本。

本次设计将 Looper 收敛为一个运行在终端中的 legacy migration engineering agent。第一阶段只解决 COBOL 项目到 Spring Boot 项目的迁移，并在接口边界上允许未来增加其他源语言和目标技术栈。

Spring Boot 是 Looper 修改工作区后交付的目标工程，不是 Looper 自身的运行容器。首期提供类似 Codex Terminal 或 OpenCode 的交互式 CLI；完整 TUI 在核心稳定后建设。

## 2. 产品定位

用户在 legacy 项目工作区中启动统一入口：

```bash
looper
```

Agent 围绕工作区持续执行以下闭环：

```text
理解工作区
→ 建立迁移清单
→ 提出目标架构候选方案
→ 等待人工确认架构、Criteria 和计划
→ 分批修改目标工程
→ 编译、测试和评估
→ 根据证据自动修复或请求人工决策
→ 更新迁移覆盖率、风险和下一步计划
```

用户不再选择 `migrate-one`、`migrate-batch`、`migrate-program`、`migrate-program-meta` 或 `migrate-program-spring` 等内部技术流程。迁移过程由统一 Agent 根据当前会话状态和证据驱动。

## 3. 设计原则

### 3.1 稳定内核，动态策略

以下部分保持稳定：

- 会话与 Checkpoint 协议；
- 工具权限和变更审查规则；
- 编译、测试和证据记录；
- 有界循环、停止条件和错误状态；
- Source Adapter、Target Adapter 和 Architecture Profile 接口。

以下部分允许动态调整：

- 迁移任务顺序和每轮工作范围；
- 工具与适配器选择；
- 重试次数、评分权重和验证门槛；
- 根据新证据重新规划后续任务；
- 经过人工批准后变更目标架构。

### 3.2 确定性证据优先

编译器、测试、静态规则和人工批准记录负责裁决。LLM 可以提出计划、生成修改、解释失败和补充语义评估，但不能自行宣布迁移成功，也不能覆盖确定性检查结果。

### 3.3 最小可验证切片

每轮只迁移一个能够独立验证的最小切片。每轮必须明确输入范围、允许修改范围、Criteria、验证命令和停止条件，避免一次性生成整个目标项目。

### 3.4 架构决策必须由人确认

Looper 可以根据源项目特征提出目标架构候选方案，但不得默认选择。hollow.jar 基盘加 skinny.jar 业务插件模式只是内置候选 Profile 之一，每次迁移都必须由用户明确批准。

## 4. 总体架构

```text
Terminal CLI
    ↓
Migration Agent
    ↓
Migration Loop
    ├── Observe：读取源码、构建结果、历史决策和会话状态
    ├── Plan：选择下一项最小迁移任务
    ├── Act：调用工具在批准范围内修改工作区
    ├── Verify：执行编译、测试、静态检查和行为对比
    ├── Evaluate：运行硬门槛、评分和人工 Criteria
    └── Learn：更新项目认知、风险、规则和后续计划
          ↓
Session / Checkpoint / Evidence / Trace
```

目标代码边界：

```text
src/
├── interfaces/
│   └── cli/                  # 首期交互式终端，未来 TUI 复用同一核心
├── core/
│   ├── agent/                # 对话、计划确认和工具选择
│   ├── loop/                 # 唯一迁移闭环及停止条件
│   ├── criteria/             # 硬门槛、评分和证据聚合
│   ├── session/              # 会话、任务、Checkpoint 和恢复
│   └── tools/                # 文件、Shell、Maven、Javac 和 diff 等通用工具
├── adapters/
│   ├── source/
│   │   └── cobol/            # COBOL 扫描、COPYBOOK、变量、调用图和语义分析
│   └── target/
│       └── spring-boot/      # Spring Boot 工程生成、编译和架构校验
└── profiles/
    └── hollow-skinny/        # 可选目标架构 Profile，不作为默认值
```

业务迁移只由一个 `MigrationLoop` 编排。Source Adapter、Target Adapter、Profile 和 Tool 提供能力，不再各自形成独立业务流程。

## 5. Loop Engineering 模型

### 5.1 Observe

收集本轮决策所需的最小上下文：

- 源项目结构、COBOL PROGRAM、COPYBOOK 和调用关系；
- WORKING-STORAGE、LINKAGE、EXTERNAL 和共享状态；
- 已批准的目标架构、Criteria 和迁移计划；
- 上轮 diff、构建结果、评分、失败证据和风险；
- 当前 Checkpoint 和允许修改范围。

### 5.2 Plan

从待迁移清单中选择下一项最小可验证切片，为其生成：

- 源程序和依赖范围；
- 目标模块与文件范围；
- 数据、状态和调用映射；
- 本轮 Criteria 和验证命令；
- 最大尝试次数与人工审批点。

### 5.3 Act

Agent 只能在已批准任务范围内调用工具。所有文件修改都形成可审查 diff。架构决策、Criteria 硬门槛和允许修改范围不能在 Act 阶段被隐式改变。

### 5.4 Verify

Target Adapter 和 Profile 提供确定性验证，包括：

- Maven 构建和测试；
- 模块依赖和禁止引用检查；
- 插件发现与加载契约；
- 输入输出、数据流和行为对比；
- 生成文件、映射记录和迁移证据完整性。

### 5.5 Evaluate

Criteria Engine 先执行硬门槛，再计算分项得分和置信度。结果只能是：

- `PASSED`：所有硬门槛通过，分数达到批准阈值；
- `FAILED`：存在可自动修复的失败；
- `NEEDS_REVIEW`：需要人工语义或架构决策；
- `BLOCKED`：缺少外部信息、依赖或达到重试上限。

### 5.6 Learn

每轮结束后更新：

- 已迁移覆盖率和未迁移清单；
- 已验证的 COBOL 到 Spring Boot 映射规则；
- 新发现的共享状态、风险和不支持特性；
- Criteria 得分变化和失败模式；
- 下一轮候选任务。

现有 Meta Skill Improvement 不再作为独立外层迁移流程，而成为每轮 Learn 阶段的一项能力。

## 6. 人工架构决策门

源项目扫描完成后，Agent 必须给出一个或多个候选 Target Architecture Profile。候选方案至少说明：

- 模块边界和依赖方向；
- COBOL 状态与调用语义如何映射；
- 适用条件、主要风险和迁移成本；
- 构建、部署和测试方式；
- Profile 特有的硬门槛和评分项。

在用户批准前，Migration Loop 只能分析和规划，不能生成业务代码。批准结果保存为版本化决策：

```text
.looper/decisions/target-architecture.yaml
```

决策包含 Profile、模块结构、状态策略、批准时间和修改历史。Agent 可以根据新证据提出变更，但必须再次经过人工批准。

### 6.1 hollow/skinny 候选 Profile

hollow/skinny 是首个内置候选 Profile：

- `hollow.jar` 提供基盘能力、稳定接口、插件协议和运行时；
- `skinny.jar` 承载迁移后的业务实现；
- skinny 只能依赖 hollow 的公开接口；
- hollow 不得依赖具体业务模块；
- 业务实现必须能够由插件机制发现和加载；
- 共享状态不得直接落入 Spring 单例 Bean 的可变字段；
- 两个模块必须支持独立构建和契约测试。

该 Profile 不设置为默认值，每次迁移必须由人明确选择。

## 7. COBOL 到 Spring Boot 的语义映射原则

目标不是保留危险的 COBOL 运行时形态，而是在 Spring Boot 中保留可验证的业务语义：

- 每个 COBOL PROGRAM 映射为职责明确的业务 Service 或插件实现；
- WORKING-STORAGE 映射为显式 `ProgramContext`，避免污染 Spring 单例；
- COPYBOOK 映射为共享 DTO、Value Object 或经过 Profile 批准的公共数据结构；
- COBOL `CALL` 映射为接口依赖与方法调用；
- 真正的 EXTERNAL 共享状态通过明确的 `SharedStateStore` 管理；
- 批处理、事务、数据库和外部系统边界必须进入 Architecture Decision 和 Criteria；
- 无法确定的语义进入 `NEEDS_REVIEW`，不能用占位实现掩盖。

## 8. Criteria 与评分

Criteria 是可执行验收规则，由通用规则、Source Adapter、Target Profile 和当前任务共同提供。Criteria 初稿由 Agent 生成，执行前由用户确认；后续修改硬门槛、权重或阈值也必须重新批准。

### 8.1 Criteria 分层

通用硬门槛：

- 项目能够构建；
- 原有测试不退化；
- 变更没有超出批准范围；
- 本轮可以恢复或回退；
- 没有未经批准的架构变更。

COBOL Source Criteria：

- PROGRAM、COPYBOOK 和 CALL 完整识别；
- WORKING-STORAGE、LINKAGE 和 EXTERNAL 有明确映射；
- 调用关系和数据流没有静默遗漏；
- 不支持语法进入风险清单。

Spring Boot Target Criteria：

- 目标工程能够构建和测试；
- 目标 Profile 的模块边界和依赖方向成立；
- 状态作用域符合并发和生命周期要求；
- 插件、批处理、API 或其他运行入口满足已批准架构。

Task Criteria：

- 指定源程序及依赖已经映射；
- 输入输出字段和正常、异常路径保持一致；
- 不存在未解释的占位实现；
- 对应迁移证据已经记录。

### 8.2 100 分制

默认评分维度如下，实际权重和阈值在执行前由用户批准：

| 维度 | 默认权重 | 主要依据 |
|---|---:|---|
| 行为语义保真 | 40 | 对比测试、输入输出、数据流、调用关系 |
| 构建与测试质量 | 25 | 编译、单测、集成测试和回归结果 |
| 目标架构符合度 | 20 | Profile 规则、模块依赖和插件契约 |
| 代码可维护性 | 10 | 复杂度、占位代码、重复逻辑和静态检查 |
| 迁移证据完整度 | 5 | 映射记录、风险、决策和 Trace |

建议默认阈值：

- 90 至 100：可接受；
- 75 至 89：基本可用，但必须记录剩余改进项；
- 低于 75：继续迁移或修复循环；
- 任意硬门槛失败：总分不生效，不能通过；
- 人工 Criteria 未完成：进入 `NEEDS_REVIEW`；
- 语义评分置信度不足：不能自动通过。

每次 Evaluate 输出总分、分项得分、硬门槛状态、置信度、决策和逐项证据。LLM 只能参与无法由确定性工具覆盖的语义评分，并必须给出证据位置。

示例配置：

```yaml
criteria:
  - id: target.skinny.no-internal-dependency
    level: error
    evaluator: forbidden-import
    config:
      module: skinny
      forbiddenPackages:
        - com.example.hollow.internal

  - id: behavior.calculate-premium
    level: error
    evaluator: test-command
    config:
      command: mvn -pl skinny test -Dtest=CalculatePremiumMigrationTest

  - id: source.external-state-reviewed
    level: review
    evaluator: human-approval
```

## 9. 终端交互

首期采用对话式 CLI：

```text
$ looper

Looper detected:
- 126 COBOL programs
- 18 COPYBOOKs
- 4 shared-state clusters

Architecture decision required.
Use /architectures to inspect candidates.
```

核心命令：

```text
/plan          查看当前迁移计划
/architectures 查看候选目标架构
/approve       批准计划、架构或 Criteria
/criteria      查看验收规则和权重
/run           执行下一轮或指定任务
/diff          审查本轮代码变更
/score         查看分项得分和证据
/status        查看覆盖率、风险和阻塞项
/pause         安全暂停
/resume        恢复历史会话
```

架构选择、Criteria 变更、高风险写操作和最终验收必须人工批准。普通低风险修复可以在已批准的任务和文件范围内自动循环。

## 10. 会话、产物与恢复

会话数据统一保存在目标工作区：

```text
.looper/
├── session.json
├── plan.yaml
├── criteria.yaml
├── decisions/
├── checkpoints/
├── evidence/
└── traces/
```

每轮执行前保存基线和 Checkpoint，执行后记录：

- 输入上下文和任务计划；
- 工具调用和文件 diff；
- 构建、测试和静态检查输出；
- Criteria 分项得分、总分和置信度；
- 人工批准记录；
- 风险变化和下一轮建议。

崩溃或人工暂停后从最后一个已确认 Checkpoint 恢复，不重复已经通过的昂贵分析和模型调用。

## 11. 错误处理与停止条件

错误统一分类：

- `RETRYABLE`：模型超时或临时工具失败，可以有限重试；
- `REPAIRABLE`：编译、测试或 Criteria 失败，进入修复循环；
- `NEEDS_REVIEW`：架构变化、语义不确定或人工 Criteria；
- `BLOCKED`：缺少依赖、测试数据、外部系统或达到重试上限；
- `FATAL`：会话损坏或安全约束被破坏，立即停止。

自动修复同时受以下限制：

- 最大尝试次数；
- 最大修改文件范围；
- 最大评分无提升轮数。

连续修复没有提升时必须停止，保留最后一个通过硬门槛的 Checkpoint，并向用户展示失败证据和可选处理方案。禁止无限重试。

## 12. 测试与验收策略

- Core Unit Tests：Migration Loop、状态恢复、人工审批门和评分计算；
- COBOL Adapter Tests：COPYBOOK、调用图、变量和共享状态识别；
- Spring Boot Adapter Tests：工程生成、模块依赖和代码校验；
- Profile Contract Tests：hollow/skinny 插件加载、公开接口和依赖方向；
- Integration Tests：完整执行一个小型 COBOL 到 Spring Boot 迁移闭环；
- Regression Tests：清理旧流程后，确认保留能力没有退化；
- Optional Live Tests：真实模型和真实 Maven 工程验证，不作为普通单元测试前提。

首个端到端验收样例必须包含多个 COBOL PROGRAM、COPYBOOK、CALL 和共享状态，并迁移为可编译、可测试、可由插件机制加载的 hollow/skinny 工程。

## 13. 现有项目清理范围

保留并重新归位：

- ModelClient 和 DeepSeek 实现；
- 文件、Shell、Maven、Javac 和报告工具；
- Checkpoint、Trace 和 State Store；
- COBOL 调用图、COPYBOOK 和变量分析能力；
- Spring Boot 工程组装与架构校验；
- 通用有界循环和 Evaluator 概念；
- 当前工作区新增的变量分析能力，将其纳入 COBOL Source Adapter。

删除或合并：

- 五套重叠迁移 CLI 入口；
- 重叠的 Workflow、Graph 和 Node 业务编排；
- 未进入主流程的 Planning、Generation 等 Loop；
- 独立的 Meta Skill Improvement 外层流程；
- 描述不同主流程的重复架构文档。

清理分为两个阶段：

1. 新 `looper` Agent Loop 先调用现有能力，并通过 Core、Adapter 和端到端测试证明闭环可用；
2. 再删除旧入口和旧编排层，最终 README 只描述一条主流程。

历史命令不作为长期兼容接口保留。

## 14. 非目标

首期不包含：

- 完整分栏 TUI；
- COBOL 之外的 Source Adapter；
- Spring Boot 之外的 Target Adapter；
- 未经人工确认的自动目标架构选择；
- 一次性全项目代码生成；
- 用单一总分绕过硬门槛；
- 无界自动修复。

## 15. 完成标准

本次架构收敛完成需要满足：

- `looper` 成为唯一主入口；
- Migration Loop 可以完成 Observe、Plan、Act、Verify、Evaluate 和 Learn；
- 目标架构、Criteria 和高风险操作具备人工审批门；
- Criteria 支持硬门槛、100 分制、分项证据和置信度；
- 会话可以暂停和恢复；
- COBOL 和 Spring Boot 能力通过 Adapter 调用；
- hollow/skinny 作为非默认候选 Profile 通过契约测试；
- 端到端样例可以迁移、构建、测试和加载；
- 旧迁移入口和重叠业务编排被移除；
- README 与实际唯一主流程一致。
