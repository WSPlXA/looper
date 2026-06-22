# DeepSeek Loop Engine — 架构文档

本项目是以「LLM 提案 → 确定性评估器判定 → 有界重试」为核心模式的 COBOL → Java 迁移引擎。
主力模型为 DeepSeek；javac 作为最终裁判，永远不由 LLM 决定是否成功。

---

## 1. CLI 命令体系

```
npm run migrate-one            单文件迁移（旧流程，plain-java-single-class）
npm run migrate-batch          批量目录迁移
npm run migrate-program        单次 COBOL 调用图→Java 类（不带 meta-loop）
npm run migrate-program-meta   多轮 Meta 学习迁移（主力命令）
```

入口：`src/apps/cli/main.ts` → 按 argv[2] 分发到对应 command。

---

## 2. 系统总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│              Meta Skill Improvement Loop（外层）                  │
│  migrate-program-meta CLI                                        │
│      │                                                           │
│      ├─ round > 1 ──► SkillImprover Agent                       │
│      │                 分析 evaluator 失败 + javac 错误           │
│      │                 生成最多 12 条翻译规则                      │
│      │                 → accumulatedRules（跨轮累积）             │
│      │                                                           │
│      └─────────────────────────────────────────────────────────►│
│                cobolCallGraphToJava Workflow（内层状态机）         │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Meta Skill Improvement Loop

文件：`src/loops/meta-skill-improvement.loop.ts`
命令：`src/apps/cli/commands/migrate-program-meta.command.ts`

- 用 `buildLoopRunner<MetaState>` 构建，`maxAttempts = maxRounds`
- 每轮流程：
  1. round > 1 时：把上轮的 `translationFailures` + `compileErrors` 喂给 SkillImprover
  2. 新规则追加到 `accumulatedRules`，格式化为 few-shot 文本
  3. 注入 `injectedSkillRules` 运行内层 Workflow
- 评估器：`state.lastRoundCompiled === true` 即通过
- **规则不跨 CLI 调用持久化**（当前限制）

### 2.2 SkillImprover Agent

文件：`src/agents/skill-improver.agent.ts`

输入：
```typescript
failureInfos[]  // evaluator 拒绝的翻译（programId + cobolSnippet + failureReasons）
compileErrors   // javac stderr（修复前最后一次编译）
existingRules   // 已有规则文本（避免重复）
round           // 当前轮次
```
输出：`SkillRule[]`（每条规则含 trigger + instruction + example，最多 12 条/轮）

---

## 3. 内层工作流（Assembly State Graph）

文件：`src/workflows/cobol-call-graph-to-java.workflow.ts`
运行器：`GraphRunner`（`src/core/graph/`），带 FileStateStore + FileCheckpointStore

### 3.1 节点流转

```
scanSubprograms
    │
expandCopybooks
    │
extractCallGraph
    │
translateSubprograms ──► [并发翻译，每个子程序走独立 Translation Loop]
    │
assembleProgram ──► assembleJavaClass skill
    │
compileAssembly ──► javac
    │
  ┌─┴────────────────┐
PASS              FAIL（未超 maxRepairAttempts）
  │                  │
reportAssembly    repairAssembly
                  │
                  ├─ Pass 1: declareClassFields
                  │   提取 undeclared symbols → 注入类字段
                  │
                  └─ Pass 2: 对出错方法重新翻译
                      └─► compileAssembly（循环）
```

### 3.2 状态持久化

每个节点执行后，GraphRunner 按顺序：
1. `FileStateStore.save(state)` → 原子 rename 写 `runs/<id>/state.json`
2. `FileCheckpointStore.save(...)` → `runs/<id>/checkpoints/`
3. `TraceLogger.trace(...)` → `runs/<id>/trace.jsonl`

---

## 4. 翻译子循环（Subprogram Translation Loop）

文件：`src/loops/subprogram-translation.loop.ts`

每个 COBOL 子程序走独立的有界重试循环（`maxTranslationAttempts`，默认 3）：

```
SubprogramTranslator Agent
        ↓
Evaluator（确定性，无 LLM）
   ✓ 方法名 camelCase
   ✓ 参数数与 LINKAGE SECTION 匹配
   ✓ body 非空，花括号平衡
   ✗ 嵌套方法定义
   ✗ if (/* */)
   ✗ x = /* */;
   ✗ public/private/protected/static 修饰符在方法体内
   ✗ 英文散文行（LLM 推理文字泄露）
        ↓
  PASSED → 返回 method
  FAILED → 带 failureReasons 重试
```

并发：`translate-subprograms.node.ts` 用 `concurrencyLimit` 控制同时翻译数量。

---

## 5. 确定性组装技能（assembleJavaClass）

文件：`src/skills/java/assemble-java-class.skill.ts`

纯函数，无 LLM，职责：
1. **方法名去重**：同签名第二个加 `_2` 后缀
2. **注入类字段**：`extraClassFieldDeclarations`（COBOL EXTERNAL / 跨方法共享变量）
3. **sanitizeBody()** 净化每个方法体：
   - `if (/* */)` → `if (false /* UNRESOLVED */)`
   - `x = /* */;` → `x = 0; /* UNRESOLVED */`
   - `public/private/protected/static TYPE` 前缀 → 去掉修饰符（Java 无 static 局部变量）
   - 英文散文行 → `// [REASONING-STRIPPED]`
4. **TODO call 解析**：`// TODO call PROGRAM-ID(args)` → `methodName(args);`
5. 返回 `source` + `methodLineStarts`（方法名→行号映射，供 repair 定位）

---

## 6. 类字段声明技能（declareClassFields）

文件：`src/skills/java/declare-class-fields.skill.ts`

修复"cannot find symbol"的结构性修复（Pass 1）：

1. `parseErrorLineNumbers(stderr)` — 从 javac stderr 提取出错行号（locale-independent）
2. `collectDeclaredNames(source)` — 只收集**类级字段**（4 空格缩进 + 访问修饰符），**不收**方法局部变量
3. 在出错行找候选标识符（过滤关键字、PascalCase 类名、已声明字段）
4. `inferFieldDeclaration(name)` 类型推断：
   - String：`.length()`/`.equals()` 等调用，或 `arr[i] = stringVar`（通过追踪赋值链）
   - double：`= N.N` 字面量
   - 数组：`name[i][j]` 维度计数，大小取字面量最大索引 + 10（最小 1000）
   - 默认 int
5. 注入 class 开头后，追加到 `state.extraClassFieldDeclarations`（跨修复轮持久）

---

## 7. 各层职责

| 目录 | 职责 |
|:---|:---|
| `src/core/graph/` | 通用状态图运行器，与业务无关 |
| `src/core/loop/` | `buildLoopRunner<S>`：LLM 提案 → 评估器 → 有界重试工厂 |
| `src/core/checkpoint/` | 节点级快照，支持 Resume |
| `src/core/trace/` | JSONL 追踪日志 |
| `src/schemas/` | Zod schema：AssemblyMigrationState 等中心类型 |
| `src/agents/` | LLM agent 构建器（翻译、修复分类、skill 改进） |
| `src/nodes/assembly/` | 业务图节点（9 个，scan→report） |
| `src/skills/java/` | 纯函数技能（assembleJavaClass、declareClassFields、countNetBraces） |
| `src/tools/` | 物理工具适配器（javac、文件系统） |
| `src/loops/` | 有界重试循环（翻译子循环、meta 改进循环） |
| `src/workflows/` | 工作流入口（组装图节点，启动 GraphRunner） |
| `src/apps/cli/` | CLI 命令层 |
| `runs/` | 运行时产物（state.json、checkpoints、trace.jsonl、output/*.java） |

---

## 8. 已知当前局限

| 问题 | 状态 |
|:---|:---|
| 规则不跨 CLI 调用持久化 | 待做：写 `.learned-rules.json` |
| `static` 局部变量 → sanitizer 去掉修饰符，但变成局部而非类字段 | 已有 declareClassFields 兜底，下轮 repair 补类字段 |
| 并发翻译时方法名冲突 | 已修：assembleJavaClass 自动去重加 `_2` 后缀 |
| 23 个子程序翻译失败（translation exhausted） | 待分析：主要为嵌套程序、大型复杂 COBOL |
| 输出为单 Java 文件，非 Spring Boot 多 package | 规划中 |
