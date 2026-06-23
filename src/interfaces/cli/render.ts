import type { MigrationTask } from "../../core/adapters/target-adapter.js";
import type { TargetArchitectureProfile } from "../../core/architecture/target-profile.js";
import type { CriteriaEvaluation, Criterion } from "../../core/criteria/criteria.types.js";
import type { MigrationLoopContext } from "../../core/loop/migration-loop.js";
import type { MigrationSession } from "../../core/session/migration-session.js";
import type { LegacyInventory } from "../../core/adapters/source-adapter.js";

export function supportsColor(): boolean {
  if (process.env.FORCE_COLOR !== undefined) {
    return process.env.FORCE_COLOR !== "0";
  }
  if (process.stdout && !process.stdout.isTTY) {
    return false;
  }
  if (process.platform === "win32") {
    return (
      process.env.COLORTERM !== undefined ||
      process.env.TERM === "xterm-256color" ||
      process.env.WT_SESSION !== undefined ||
      process.env.TERM_PROGRAM === "vscode"
    );
  }
  return process.env.TERM !== "dumb";
}

const colorSupported = supportsColor();

export const C_RESET = colorSupported ? "\x1b[0m" : "";
export const C_BOLD = colorSupported ? "\x1b[1m" : "";
export const C_DIM = colorSupported ? "\x1b[2m" : "";
export const C_CYAN = colorSupported ? "\x1b[36m" : "";
export const C_GREEN = colorSupported ? "\x1b[32m" : "";
export const C_YELLOW = colorSupported ? "\x1b[33m" : "";
export const C_RED = colorSupported ? "\x1b[31m" : "";
export const C_MAGENTA = colorSupported ? "\x1b[35m" : "";

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function box(title: string, lines: string[], color = C_CYAN): string {
  // Fix the newline padding bug: split lines containing newlines first
  const splitLines = lines.flatMap(line => line.split(/\r?\n/));
  
  const maxLength = Math.max(
    title.length + 6,
    ...splitLines.map(line => stripAnsi(line).length)
  );
  
  const topBorder = `${color}╭── ${C_BOLD}${title}${C_RESET}${color} ${"─".repeat(Math.max(0, maxLength - title.length - 5))}╮${C_RESET}`;
  
  const middle = splitLines.map(line => {
    const cleanLine = stripAnsi(line);
    const padding = " ".repeat(Math.max(0, maxLength - cleanLine.length + 1));
    return `${color}│${C_RESET} ${line}${padding}${color}│${C_RESET}`;
  }).join("\n");
  
  const bottomBorder = `${color}╰${"─".repeat(maxLength + 2)}╯${C_RESET}`;
  
  return [topBorder, middle, bottomBorder].join("\n");
}

function indent(lines: readonly string[], prefix = "  "): string {
  return lines.map(line => `${prefix}${line}`).join("\n");
}

function renderRisks(risks: readonly string[]): string {
  if (risks.length === 0) {
    return `${C_DIM}- 未检测到重大迁移和重构风险${C_RESET}`;
  }
  return risks.map(risk => `${C_RED}⚠ ${risk}${C_RESET}`).join("\n");
}

function nextActionFor(session: MigrationSession): string {
  if (!session.architectureDecisionId) {
    return "运行 /architectures 查看候选架构，然后输入 /approve architecture <profile-id> 审批通过。";
  }
  if (session.approvedCriteriaRevision !== session.criteriaRevision) {
    return `运行 /criteria 查看评估标准，然后输入 /approve criteria ${session.criteriaRevision} 审批通过。`;
  }
  if (session.stage === "PAUSED") {
    return "会话当前已暂停。请输入 /resume 恢复会话以继续。";
  }
  if (session.stage === "COMPLETED") {
    return "迁移已成功完成！请审查 .looper/evidence 目录下的执行证据和生成的 Java 代码。";
  }
  if (session.stage === "NEEDS_REVIEW") {
    return "编译成功但指标跑分未达到 90 分门槛。请使用 /score 审查不通过项并修正代码。";
  }
  if (session.stage === "BLOCKED") {
    return "连续 3 次自动修复失败。编译已受阻，需要开发者介入审查编译日志（/score）手动修复。";
  }
  return "一切就绪！请输入 /run 启动下一个原子任务的转换循环。";
}

export function renderHelp(): string {
  const lines = [
    `${C_CYAN}${C_BOLD}会话与状态控制:${C_RESET}`,
    `  /status                        ${C_DIM}查看当前迁移会话详细进度看板${C_RESET}`,
    `  /tree                          ${C_DIM}渲染自动发现的 COBOL 依赖调用树${C_RESET}`,
    `  /exit                          ${C_DIM}保存当前状态并安全关闭 CLI${C_RESET}`,
    ``,
    `${C_CYAN}${C_BOLD}审批核审指令:${C_RESET}`,
    `  /architectures                 ${C_DIM}列出所有候选的 Target Java 架构 Profile${C_RESET}`,
    `  /approve architecture <id>     ${C_DIM}人工核审并批准目标 Java 架构模型${C_RESET}`,
    `  /criteria                      ${C_DIM}查看当前评估门槛与评分标准配置${C_RESET}`,
    `  /approve criteria <revision>   ${C_DIM}人工核审并批准指标规则修订版本${C_RESET}`,
    ``,
    `${C_CYAN}${C_BOLD}迁移任务运行:${C_RESET}`,
    `  /plan                          ${C_DIM}查看系统拆分的原子迁移任务列表与状态${C_RESET}`,
    `  /run [task-id]                 ${C_DIM}执行下一个迁移任务或指定的原子任务${C_RESET}`,
    `  /diff                          ${C_DIM}查看上一次转换变更 of Java 文件列表${C_RESET}`,
    `  /score                         ${C_DIM}查看最近一次迭代的核验得分与详细编译错误日志${C_RESET}`,
    `  /pause                         ${C_DIM}暂停迁移工作流并持久化进度${C_RESET}`,
    `  /resume                        ${C_DIM}恢复上一次暂停的迁移会话${C_RESET}`,
  ];
  return box("LOOPER 终端迁移引擎帮助 (COMMANDS)", lines, C_CYAN);
}

export function renderSession(session: MigrationSession): string {
  const lastScore = session.scoreHistory.at(-1);
  let stageColor = C_YELLOW;
  if (session.stage === "READY" || session.stage === "COMPLETED") stageColor = C_GREEN;
  if (session.stage === "BLOCKED" || session.stage === "NEEDS_REVIEW") stageColor = C_RED;
  
  let scoreText = `${C_DIM}未评估${C_RESET}`;
  if (lastScore) {
    const scoreColor = lastScore.decision === "PASSED" ? C_GREEN : C_RED;
    scoreText = `${scoreColor}${lastScore.score} (${lastScore.decision})${C_RESET}`;
  }
  
  const lines = [
    `会话识别码 : ${C_BOLD}${session.id}${C_RESET}`,
    `工作空间   : ${C_DIM}${session.workspace}${C_RESET}`,
    `当前阶段   : ${stageColor}${C_BOLD}${session.stage}${C_RESET}`,
    `迭代次数   : ${C_BOLD}${session.iteration}${C_RESET}`,
    `目标架构   : ${session.architectureDecisionId ? `${C_GREEN}${session.architectureDecisionId}${C_RESET}` : `${C_RED}未审批${C_RESET}`}`,
    `评估规则   : 版本 ${C_BOLD}${session.criteriaRevision}${C_RESET} ${session.approvedCriteriaRevision === session.criteriaRevision ? `${C_GREEN}(已审批通过)${C_RESET}` : `${C_RED}(待审批)${C_RESET}`}`,
    `活动任务   : ${session.activeTaskId ? `${C_YELLOW}${session.activeTaskId}${C_RESET}` : `${C_DIM}无${C_RESET}`}`,
    `已完任务数 : ${C_GREEN}${session.completedTaskIds.length}${C_RESET}`,
    `最近得分   : ${scoreText}`,
    ``,
    `${C_BOLD}自动发现的风险项 (RISKS):${C_RESET}`,
    renderRisks(session.risks),
    ``,
    `${C_BOLD}💡 下一步操作指南:${C_RESET}`,
    `  ${C_YELLOW}${nextActionFor(session)}${C_RESET}`,
  ];
  return box("迁移会话看板 (SESSION PANEL)", lines, stageColor);
}

export function renderArchitectures(profiles: readonly TargetArchitectureProfile[]): string {
  const lines = profiles.flatMap(profile => [
    `架构 ID: ${C_BOLD}${profile.id}${C_RESET}`,
    `名称   : ${C_CYAN}${profile.name}${C_RESET}`,
    `说明   : ${profile.description}`,
    `边界与依赖规则:`,
    ...profile.moduleBoundaries.map(boundary => `  ${C_DIM}➔ ${boundary}${C_RESET}`),
    ``,
    `确认批准此架构输入: ${C_YELLOW}/approve architecture ${profile.id}${C_RESET}`,
  ]);
  return box("可用目标架构方案 (CANDIDATES)", lines, C_CYAN);
}

export function renderCriteria(criteria: readonly Criterion[], session: MigrationSession): string {
  const isApproved = session.approvedCriteriaRevision === session.criteriaRevision;
  const statusColor = isApproved ? C_GREEN : C_RED;
  const lines = [
    `规则版本: ${C_BOLD}${session.criteriaRevision}${C_RESET} ${isApproved ? `${C_GREEN}(已核准)${C_RESET}` : `${C_RED}(未批准)${C_RESET}`}`,
    `准入要求: 综合评分必须 ${C_BOLD}>= 90${C_RESET} 分，且所有 HARD_GATE (硬性门槛) 必须通过。`,
    ``,
    `${C_BOLD}指标项明细:${C_RESET}`,
    ...criteria.map(c => {
      const typeLabel = c.kind === "HARD_GATE" ? `${C_RED}[硬性门槛]${C_RESET}` : `${C_GREEN}[权重指标]${C_RESET}`;
      const weightLabel = c.kind === "SCORE" ? ` 权重: ${C_BOLD}${c.weight}%${C_RESET}` : "";
      return `  • ${C_BOLD}${c.id}${C_RESET} ${typeLabel}${weightLabel} ${C_DIM}(置信度 >= ${c.requiredConfidence})${C_RESET}`;
    }),
    ``,
    `核准当前指标请输入: ${C_YELLOW}/approve criteria ${session.criteriaRevision}${C_RESET}`,
  ];
  return box("自动化核验指标规范 (CRITERIA)", lines, statusColor);
}

export function renderPlan(tasks: readonly MigrationTask[], session: MigrationSession): string {
  if (!session.architectureDecisionId) {
    return box("迁移任务计划 (PLAN)", [
      `${C_RED}⚠ 尚未生成迁移计划：必须先审批批准目标架构设计。${C_RESET}`,
      `请输入 ${C_YELLOW}/architectures${C_RESET} 查看，并使用 ${C_YELLOW}/approve architecture <id>${C_RESET} 确认。`,
    ], C_RED);
  }
  if (tasks.length === 0) {
    return box("迁移任务计划 (PLAN)", [`${C_DIM}未发现任何可迁移的任务${C_RESET}`], C_YELLOW);
  }
  const lines = [
    `已规划的迁移任务序列 (按依赖拓扑排序):`,
    ...tasks.map(task => {
      const isCompleted = session.completedTaskIds.includes(task.id);
      const isActive = task.id === session.activeTaskId;
      let statusLabel = `${C_DIM}[ ] Pending${C_RESET}`;
      if (isCompleted) statusLabel = `${C_GREEN}[✓] Completed${C_RESET}`;
      else if (isActive) statusLabel = `${C_YELLOW}[▶] Active${C_RESET}`;
      return `  ${statusLabel} ${C_BOLD}${task.id}${C_RESET}\n` +
             `      ${C_DIM}关联程序 : ${task.programIds.join(", ")}${C_RESET}\n` +
             `      ${C_DIM}生成路径 : ${task.allowedPaths.join(", ")}${C_RESET}`;
    }),
    ``,
    `执行下一个任务请输入: ${C_YELLOW}/run${C_RESET}，或指定特定任务 ${C_YELLOW}/run <task-id>${C_RESET}`,
  ];
  return box("迁移任务计划 (PLAN)", lines, C_CYAN);
}

function renderProgressBar(score: number): string {
  const length = 20;
  const filledLength = Math.round((length * score) / 100);
  const filled = "█".repeat(filledLength);
  const empty = "░".repeat(length - filledLength);
  const color = score >= 90 ? C_GREEN : C_RED;
  return `${color}[${filled}${empty}] ${score}%${C_RESET}`;
}

export function renderEvaluation(evaluation: CriteriaEvaluation | undefined): string {
  if (!evaluation) {
    return `${C_DIM}尚未产生核验得分报告。请完成配置后执行 /run 启动。${C_RESET}`;
  }
  const statusColor = evaluation.decision === "PASSED" ? C_GREEN : C_RED;
  const lines = [
    `综合得分 : ${renderProgressBar(evaluation.score)}`,
    `最终决策 : ${statusColor}${C_BOLD}${evaluation.decision}${C_RESET}`,
    `最低信度 : ${C_BOLD}${evaluation.confidence}${C_RESET}`,
    `硬性门槛 : ${evaluation.hardGatesPassed ? `${C_GREEN}全部通过 (PASSED)${C_RESET}` : `${C_RED}存在未通过项 (FAILED)${C_RESET}`}`,
  ];
  if (evaluation.blockedReasons.length) {
    lines.push(
      ``,
      `${C_RED}${C_BOLD}阻塞原因 (Blocked Reasons):${C_RESET}`,
      ...evaluation.blockedReasons.map(reason => `  • ${reason}`)
    );
  }
  if (evaluation.missingCriterionIds.length) {
    lines.push(
      ``,
      `${C_RED}${C_BOLD}缺失评估指标 (Missing Criteria):${C_RESET}`,
      ...evaluation.missingCriterionIds.map(id => `  • ${id}`)
    );
  }
  lines.push(``, `${C_BOLD}指标项核查详情与日志记录 (EVIDENCE):${C_RESET}`);
  evaluation.results.forEach(result => {
    const symbol = result.passed ? `${C_GREEN}✓${C_RESET}` : `${C_RED}✗${C_RESET}`;
    const scoreVal = result.score !== undefined ? ` (得分: ${result.score})` : "";
    lines.push(`  ${symbol} ${C_BOLD}${result.criterionId}${C_RESET}${scoreVal}`);
    if (result.evidence && result.evidence.length > 0) {
      result.evidence.forEach(ev => {
        lines.push(`      ${C_DIM}${ev}${C_RESET}`);
      });
    }
  });
  return box("自动化指标核查打分报告 (EVALUATION)", lines, statusColor);
}

export function renderRunResult(context: MigrationLoopContext): string {
  return [
    `${C_CYAN}======================== 迭代完成 (ITERATION FINISHED) ========================${C_RESET}`,
    renderSession(context.session),
    renderEvaluation(context.lastEvaluation),
  ].join("\n\n");
}

export function renderDiff(context: MigrationLoopContext): string {
  const changedFiles = context.lastExecution?.changedFiles ?? [];
  if (changedFiles.length === 0) {
    return `${C_DIM}上次迭代没有变动或生成任何 Java 代码文件。${C_RESET}`;
  }
  const lines = [
    `本次迭代受变更影响的文件列表:`,
    ...changedFiles.map(file => `  ${C_GREEN}+ ${file}${C_RESET}`),
  ];
  return box("生成代码变更对比 (DIFF)", lines, C_CYAN);
}

export function renderDependencyTree(inventory: LegacyInventory): string {
  if (!inventory || !inventory.programs || inventory.programs.length === 0) {
    return box("COBOL 拓扑调用树 (TOPOLOGY)", [`${C_DIM}没有发现可供分析的 COBOL 源程序文件。${C_RESET}`], C_YELLOW);
  }
  const lines = [
    `源代码根目录 : ${C_DIM}${inventory.sourceRoot}${C_RESET}`,
    `适配器源类型 : ${C_BOLD}${inventory.sourceKind}${C_RESET}`,
    ``,
    `${C_BOLD}依赖树与程序调用拓扑树图 (CALL TREE):${C_RESET}`,
  ];
  const totalProgs = inventory.programs.length;
  inventory.programs.forEach((prog, index) => {
    const isLastProg = index === totalProgs - 1;
    const progPrefix = isLastProg ? "└── " : "├── ";
    const childPrefix = isLastProg ? "    " : "│   ";
    lines.push(`${progPrefix}❖ ${C_BOLD}${prog.programId}${C_RESET} ${C_DIM}(${prog.sourceFile.split(/[/\\]/).pop()})${C_RESET}`);
    if (prog.linkage && prog.linkage.length > 0) {
      lines.push(`${childPrefix}├─ ${C_YELLOW}LINKAGE:${C_RESET} [${prog.linkage.join(", ")}]`);
    }
    if (prog.callees && prog.callees.length > 0) {
      const totalCallees = prog.callees.length;
      prog.callees.forEach((callee, cIndex) => {
        const isLastCallee = cIndex === totalCallees - 1;
        const calleeIcon = isLastCallee ? "└─ " : "├─ ";
        lines.push(`${childPrefix}${calleeIcon}${C_GREEN}CALL ➔ ${callee}${C_RESET}`);
      });
    }
  });
  return box("COBOL 发现拓扑依赖树", lines, C_CYAN);
}
