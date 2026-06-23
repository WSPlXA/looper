# Looper - COBOL 到 Java 渐进式迁移助手

Looper 是一个基于持久化会话（Session-based）的 COBOL 到 Java 渐进式代码迁移助手。它能够自动发现 COBOL 程序依赖树、由人工进行目标架构与评估指标（Criteria）审批，以“单次执行单个任务”的迁移环（Migration Loop）进行迭代，配合确定性编译器及测试用例网关进行自动修复，最终将完整的迁移状态与生成代码持久化在 `.looper/` 目录下。

## 核心特性

- **依赖树与风险发现 (Discovery)**：自动解析 COBOL 源码，提取 `PROGRAM-ID`、调用关系 (`CALL`)、`LINKAGE SECTION` 结构、`WORKING-STORAGE` 变量以及 COPYBOOK 扩展证据，识别潜在的重构风险。
- **架构决策审批 (Architecture Approval)**：支持配置多套架构 Profile，必须由人工显式审批目标架构（例如内置的 `hollow-skinny-v1` 架构）后，方可启动代码生成。
- **动态指标引擎与审批 (Criteria & Scoring)**：基于硬性门槛（Hard Gate，例如编译成功、API 兼容）与权重指标（Score Criteria，例如语义保真度、单元测试通过率、可维护性），支持动态调整和版本控制。
- **原子任务计划 (Task Planning)**：根据依赖和复杂性，将整个系统拆分为多个原子迁移任务，支持按需指定运行特定任务。
- **自动化迁移与修复环 (Repair Loop)**：对单个任务执行“LLM 生成 -> 编译 -> 运行 mvn test -> 评估指标 -> 失败自动修复 (Auto-repair)”循环，直至达标或触及上限。
- **会话持久化与断点续传 (Pause & Resume)**：随时保存会话进度（包括已完成的任务、生成的代码、测试结果及历史评分），支持完美恢复与增量迁移。

---

## 架构模型与模块划分

Looper 当前内置支持 `hollow-skinny-v1` 架构 Profile（Hollow 基础模块与 Skinny 业务插件架构）：

1. **Hollow 模块**：持有稳定的公共 API、运行时依赖和数据类型契约。
2. **Skinny 模块**：持有从 COBOL 逻辑转译过来的核心业务实现，以业务插件的形式动态载入并注册到 Hollow 中（基于 `META-INF/services/generated.cobol.api.ProgramPlugin`）。
3. **架构边界**：
   - Hollow 模块绝不可依赖 Skinny 模块。
   - Skinny 模块仅能依赖 Hollow 模块的公共 API。
   - 任何可变的 COBOL 上下文状态必须限定在 `ProgramContext` 或 `SharedStateStore` 中。

---

## 安装与配置

### 环境要求

- **Node.js**: 20+
- **JDK**: 17+ (运行生成的 Java 项目)
- **Maven**: 必须配置在系统的 `PATH` 环境变量中
- **API Key**: 一个兼容 DeepSeek 协议的 LLM API 密钥，用于代码转译

### 初始化项目

1. **安装 Node 依赖**：
   ```bash
   npm install
   ```

2. **配置环境变量**：
   复制并编辑配置文件：
   ```bash
   cp .env.example .env
   ```
   在 `.env` 中填入你的 API 配置：
   ```env
   DEEPSEEK_API_KEY=your_api_key_here
   DEEPSEEK_BASE_URL=https://api.deepseek.com/v1 # 或其他兼容的 API 端点
   DEEPSEEK_MODEL=deepseek-chat
   MODEL_TIMEOUT_MS=120000
   ```

3. **构建与自测**：
   编译 TypeScript 源码并执行 Looper 自身的测试集：
   ```bash
   npm run build
   npm test
   ```

---

## 交互式指令列表 (REPL)

在 COBOL 代码仓库根目录下执行以下命令启动 Looper CLI：

```bash
npm run looper
```

进入交互式控制台后，系统会自动检测终端环境是否支持 TTY，并以 **3分栏式 TUI 交互界面** 呈现：

```text
+------------------------+------------------------------------------------+------------------------------------+
| COBOL 发现依赖树        | LOOPER 终端控制台 (CONSOLE)                    | 核验指标与跑分                      |
| 总数: 3                | ---------------------------------------------- | ---------------------------------- |
| ---------------------- | 进度: [DISCOVERY] > READY > CRIT > RUN > COMP   | 评分: [##########----] 71%         |
| * MAIN                 | 阶段: CRITERIA_REVIEW | 迭代: 2                | 决策: PENDING                      |
|   |-CALL-> PROG1       | ---------------------------------------------- | 硬门槛 (Hard Gates):               |
| * PROG1                | 原子迁移任务列表 (PLAN):                        |   build.hollow: [PASS]             |
|   |-CALL-> PROG2       |   [PASS] task-hollow                           |   build.skinny: [PASS]             |
| * PROG2                |   [RUN]  task-skinny                           |   no-reverse:   [FAIL]             |
|                        |                                                |   loads:        [PEND]             |
|                        |                                                | ---------------------------------- |
|                        |                                                | MAVEN 构建编译日志                 |
|                        |                                                | - build.hollow: [INFO] success     |
|                        |                                                | - build.skinny: [INFO] success     |
+------------------------+------------------------------------------------+------------------------------------+

looper> 
```

### 3分栏 TUI 分区说明

1. **左侧分栏 (Left Column)**：展示 COBOL 发现的程序依赖调用树（拓扑依赖关系）。
2. **中间分栏 (Center Column)**：作为主交互对话、输入交互指令以及当前正在执行的任务计划/执行状态进度器。
3. **右侧分栏 (Right Column)**：包含 Criteria 跑分评估仪表盘、硬门槛通过状态列表以及 Maven 编译与构建证据日志。

如果运行在非 TTY 管道环境（如自动化脚本或 CI 环境），系统会自动退化为标准流式（Linear Output）文本日志输出。

### 斜杠指令列表

| 指令 | 参数 | 描述 |
| :--- | :--- | :--- |
| `/status` | 无 | 查看当前迁移会话的状态（Stage、当前迭代次数、已完成任务数等）。 |
| `/architectures` | 无 | 列出所有候选的目标架构 Profile 供人类选择审批。 |
| `/approve` | `architecture <profile-id>` | 批准指定的目标架构 Profile（如 `/approve architecture hollow-skinny-v1`）。 |
| `/criteria` | 无 | 输出并生成当前会话的 Criteria 评估指标配置文件（`.looper/criteria.yaml`）。 |
| `/approve` | `criteria <revision>` | 批准当前的评估规则版本（如 `/approve criteria 1`）。 |
| `/plan` | 无 | 预览或生成渐进式迁移任务计划（写入 `.looper/plan.yaml`）。 |
| `/run` | `[task-id]` (可选) | 顺序执行下一个待处理的迁移任务；或者指定运行某个 pending 状态的特定 `task-id`。 |
| `/diff` | 无 | 显示上一次迁移执行中发生变更/生成的 Java 代码文件。 |
| `/score` | 无 | 显示最近一次迁移任务执行的详细评估得分。 |
| `/pause` | 无 | 暂停当前迁移，将会话持久化保存为 `PAUSED` 状态。 |
| `/resume` | 无 | 从 `.looper/` 目录中重新加载并恢复暂停的会话。 |
| `/tree` | 无 | 在控制台输出当前扫描到的 COBOL 程序的完整拓扑依赖树。 |
| `/help` | 无 | 打印所有支持的 CLI 交互指令及使用说明。 |
| `/exit` | 无 | 保存当前状态并退出 CLI 终端。 |

---

## 迁移会话生命周期与完整示例

整个迁移会话状态流转如下：
`DISCOVERY` ➔ `ARCHITECTURE_REVIEW` ➔ `CRITERIA_REVIEW` ➔ `READY` ➔ `RUNNING` ➔ (`NEEDS_REVIEW` / `BLOCKED` / `PAUSED` ➔ `READY`) ➔ `COMPLETED`。

### 完整运行示例

#### 1. 启动会话与架构批准
首次在仓库下运行 `npm run looper`，系统自动扫描并发现 COBOL 程序，之后进入 `ARCHITECTURE_REVIEW` 阶段：
```text
looper> /status
当前状态: ARCHITECTURE_REVIEW
未选定架构决策，请先审查并批准架构。

looper> /architectures
可用目标架构 Profile:
- hollow-skinny-v1: Hollow base with Skinny business plugins

looper> /approve architecture hollow-skinny-v1
批准目标架构 hollow-skinny-v1 成功。请接下来审查评估指标。
```

#### 2. 指标批准
系统自动流转至 `CRITERIA_REVIEW` 阶段：
```text
looper> /criteria
输出当前指标版本为: 1 (未批准)
硬性网关: build.hollow, build.skinny, architecture.no-reverse-dependency
评分指标: semantic.fidelity, build.tests, architecture.conformance, ...

looper> /approve criteria 1
批准指标版本 1 成功。会话现已准备就绪。
```

#### 3. 规划与运行迁移
系统流转至 `READY` 状态，现在可以生成计划并执行：
```text
looper> /plan
未检测到计划，已自动规划如下原子任务:
- Task: cobol-base-plugin (包含: COBOL_BASE.cbl, allowedPaths: ...)
- Task: customer-ledger (包含: CUST_LDG.cbl, allowedPaths: ...)

looper> /run
启动任务 cobol-base-plugin 迁移迭代...
[LLM] 正在将 COBOL_BASE 转换为 Java...
[Verify] 正在生成 Maven 代码结构并执行编译...
[Test] 运行 mvn test 成功。
[Score] 指标评估完成，当前得分: 95.0。符合门槛 (>= 90)。
任务 cobol-base-plugin 状态变更为: COMPLETED。
```

#### 4. 暂停与恢复执行
在多任务迁移过程中，您随时可以安全暂停：
```text
looper> /pause
会话已成功暂停，状态持久化至 `.looper/state/pause.json`。

looper> /exit
```

下次您重新打开终端并试图继续工作时：
```bash
npm run looper
```
```text
looper> /resume
成功恢复暂停前的会话状态！
当前状态: READY (已完成任务: cobol-base-plugin)

looper> /run
继续执行下一个待处理的任务...
```

---

## 开发者日常命令

- **代码编译**：
  ```bash
  npm run build
  ```
- **执行全部单元/集成测试**（使用 Vitest）：
  ```bash
  npm test
  ```
- **指定运行特定测试**：
  ```bash
  npm test -- test/unit/criteria-engine.test.ts
  ```
