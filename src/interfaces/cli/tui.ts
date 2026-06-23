import type { MigrationLoopContext } from "../../core/loop/migration-loop.js";
import type { MigrationSession } from "../../core/session/migration-session.js";
import type { TargetArchitectureProfile } from "../../core/architecture/target-profile.js";
import type { Criterion, CriteriaEvaluation } from "../../core/criteria/criteria.types.js";
import type { MigrationTask } from "../../core/adapters/target-adapter.js";
import type { LegacyInventory } from "../../core/adapters/source-adapter.js";
import {
  C_RESET,
  C_BOLD,
  C_DIM,
  C_CYAN,
  C_GREEN,
  C_YELLOW,
  C_RED,
} from "./render.js";

/* ── Utilities ─────────────────────────────────────────────── */

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function cjkWidth(char: string): number {
  const code = char.codePointAt(0)!;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3040 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3ffff)
  ) return 2;
  return 1;
}

function visibleWidth(str: string): number {
  let w = 0;
  for (const ch of stripAnsi(str)) w += cjkWidth(ch);
  return w;
}

function padEnd(str: string, target: number): string {
  const diff = target - visibleWidth(str);
  return diff > 0 ? str + " ".repeat(diff) : str;
}

/* ── Panel (rounded box with fixed width) ─────────────────── */

function panel(title: string, lines: string[], width: number, color = C_CYAN): string {
  const inner = width - 4;
  const titleDisplay = title ? ` ${title} ` : "";
  const titleW = visibleWidth(titleDisplay);
  const fillTop = Math.max(0, width - 3 - titleW);

  const out: string[] = [];
  out.push(`${color}╭─${C_BOLD}${titleDisplay}${C_RESET}${color}${"─".repeat(fillTop)}╮${C_RESET}`);
  for (const line of lines) {
    out.push(`${color}│${C_RESET} ${padEnd(line, inner)} ${color}│${C_RESET}`);
  }
  out.push(`${color}╰${"─".repeat(width - 2)}╯${C_RESET}`);
  return out.join("\n");
}

/* ── Stage Stepper ────────────────────────────────────────── */

function stepper(session: MigrationSession): string {
  const stages = [
    { key: "DISCOVERY", label: "发现" },
    { key: "ARCHITECTURE_REVIEW", label: "架构" },
    { key: "CRITERIA_REVIEW", label: "指标" },
    { key: "READY", label: "就绪" },
    { key: "RUNNING", label: "运行" },
    { key: "COMPLETED", label: "完成" },
  ];
  const effective = session.stage === "PAUSED" ? "READY"
    : session.stage === "NEEDS_REVIEW" ? "RUNNING"
    : session.stage === "BLOCKED" ? "RUNNING"
    : session.stage;
  const idx = stages.findIndex(s => s.key === effective);

  return stages.map((s, i) => {
    let icon: string;
    let label: string;
    if (i < idx) {
      icon = `${C_GREEN}●${C_RESET}`;
      label = `${C_GREEN}${s.label}${C_RESET}`;
    } else if (i === idx) {
      icon = `${C_YELLOW}◉${C_RESET}`;
      label = `${C_YELLOW}${s.label}${C_RESET}`;
    } else {
      icon = `${C_DIM}○${C_RESET}`;
      label = `${C_DIM}${s.label}${C_RESET}`;
    }
    const sep = i < stages.length - 1 ? ` ${C_DIM}───${C_RESET} ` : "";
    return `${icon} ${label}${sep}`;
  }).join("");
}

/* ── Dashboard Sections ───────────────────────────────────── */

function renderHeader(session: MigrationSession, width: number): string {
  const sessionTag = `${C_DIM}${session.id.slice(0, 20)}${C_RESET}`;
  const iterTag = `${C_DIM}iter ${session.iteration}${C_RESET}`;
  return panel("LOOPER", [
    stepper(session),
    `${sessionTag}  ${C_DIM}│${C_RESET}  ${iterTag}`,
  ], width, C_CYAN);
}

function renderTaskPanel(tasks: MigrationTask[], session: MigrationSession, width: number): string {
  const lines: string[] = [];
  for (const t of tasks) {
    const done = session.completedTaskIds.includes(t.id);
    const active = t.id === session.activeTaskId;
    let icon: string;
    let idStyle: string;
    if (done) {
      icon = `${C_GREEN}✓${C_RESET}`;
      idStyle = C_DIM;
    } else if (active) {
      icon = `${C_YELLOW}▸${C_RESET}`;
      idStyle = C_YELLOW;
    } else {
      icon = `${C_DIM}○${C_RESET}`;
      idStyle = "";
    }
    const progs = t.programIds.join(", ");
    lines.push(` ${icon}  ${idStyle}${t.id}${idStyle ? C_RESET : ""}  ${C_DIM}${progs}${C_RESET}`);
  }
  return panel("任务", lines, width);
}

function renderScorePanel(evaluation: CriteriaEvaluation, width: number): string {
  const score = evaluation.score;
  const barLen = 20;
  const filled = Math.round((barLen * score) / 100);
  const sColor = score >= 90 ? C_GREEN : score >= 60 ? C_YELLOW : C_RED;
  const bar = `${sColor}${"█".repeat(filled)}${C_DIM}${"░".repeat(barLen - filled)}${C_RESET}`;
  const dColor = evaluation.decision === "PASSED" ? C_GREEN : C_RED;

  const gates = [
    ["build.hollow", "build.hollow"],
    ["build.skinny", "build.skinny"],
    ["no-reverse", "architecture.no-reverse-dependency"],
    ["plugin-loads", "architecture.plugin-loads"],
  ];

  const gateLines = gates.map(([label, id]) => {
    const r = evaluation.results.find(ev => ev.criterionId === id);
    const icon = !r ? `${C_DIM}◻${C_RESET}` : r.passed ? `${C_GREEN}✓${C_RESET}` : `${C_RED}✗${C_RESET}`;
    return `${icon} ${label}`;
  });

  const leftCol = [
    `得分  ${bar} ${sColor}${score}%${C_RESET}`,
    `决策  ${dColor}${C_BOLD}${evaluation.decision}${C_RESET}`,
    `信度  ${C_BOLD}${evaluation.confidence}${C_RESET}`,
  ];

  const halfWidth = Math.floor((width - 8) / 2);
  const maxRows = Math.max(leftCol.length, gateLines.length);
  const combined: string[] = [];

  for (let i = 0; i < maxRows; i++) {
    const left = padEnd(leftCol[i] ?? "", halfWidth);
    const right = gateLines[i] ?? "";
    combined.push(`${left}  ${C_DIM}│${C_RESET}  ${right}`);
  }

  return panel("指标", combined, width);
}

function renderTreeSummary(inventory: LegacyInventory, width: number): string {
  const progs = inventory.programs?.slice(0, 5) ?? [];
  if (progs.length === 0) return "";

  const lines: string[] = [];
  const total = progs.length;
  for (let i = 0; i < total; i++) {
    const p = progs[i]!;
    const isLast = i === total - 1 && (inventory.programs?.length ?? 0) <= 5;
    const prefix = isLast ? "└── " : "├── ";
    const calls = p.callees.length > 0
      ? `  ${C_DIM}→ ${p.callees.join(", ")}${C_RESET}`
      : "";
    lines.push(`${C_DIM}${prefix}${C_RESET}${C_BOLD}${p.programId}${C_RESET}${calls}`);
  }
  if ((inventory.programs?.length ?? 0) > 5) {
    lines.push(`${C_DIM}└── … 还有 ${(inventory.programs?.length ?? 0) - 5} 个程序 (/tree 查看完整依赖树)${C_RESET}`);
  }

  return panel("依赖树", lines, width, C_DIM);
}

function renderStatusBar(
  session: MigrationSession,
  evaluation: CriteriaEvaluation | undefined,
  tasks: MigrationTask[],
  width: number
): string {
  const stageLabel = session.stage === "PAUSED" ? `${C_YELLOW}PAUSED${C_RESET}`
    : session.stage === "COMPLETED" ? `${C_GREEN}COMPLETED${C_RESET}`
    : session.stage === "BLOCKED" ? `${C_RED}BLOCKED${C_RESET}`
    : session.stage === "NEEDS_REVIEW" ? `${C_RED}NEEDS_REVIEW${C_RESET}`
    : `${C_CYAN}${session.stage}${C_RESET}`;

  const parts = [
    stageLabel,
    `iter ${session.iteration}`,
    `score ${evaluation ? `${evaluation.score}%` : "--"}`,
  ];
  if (tasks.length > 0) {
    parts.push(`${session.completedTaskIds.length}/${tasks.length} tasks`);
  }

  const content = parts.join(` ${C_DIM}•${C_RESET} `);
  return `${C_DIM}${"─".repeat(width)}${C_RESET}\n ${content}`;
}

/* ── Default View (shown when no command output) ──────────── */

function renderDefaultView(
  context: MigrationLoopContext,
  candidateProfiles: readonly TargetArchitectureProfile[],
  width: number
): string {
  const parts: string[] = [];
  const session = context.session;

  if (session.stage === "ARCHITECTURE_REVIEW") {
    const archLines = [
      `${C_BOLD}请选择并批准目标架构${C_RESET}`,
      "",
    ];
    for (const p of candidateProfiles) {
      archLines.push(` ${C_CYAN}${p.id}${C_RESET}  ${p.name}`);
    }
    archLines.push("", `${C_DIM}输入 /approve architecture <id> 批准${C_RESET}`);
    parts.push(panel("架构审批", archLines, width, C_YELLOW));
  } else if (session.stage === "CRITERIA_REVIEW") {
    const critLines = [
      `${C_BOLD}请核审并批准评估指标${C_RESET}`,
      "",
      ` 综合评分门槛: ${C_BOLD}>= 90${C_RESET}`,
      ` 硬性门槛: 编译成功 & 架构依赖检查`,
      "",
      `${C_DIM}输入 /approve criteria ${session.criteriaRevision} 批准${C_RESET}`,
    ];
    parts.push(panel("指标审批", critLines, width, C_YELLOW));
  } else {
    if (context.tasks.length > 0) {
      parts.push(renderTaskPanel(context.tasks, session, width));
    } else {
      parts.push(`  ${C_DIM}暂无任务。输入 /plan 生成迁移计划。${C_RESET}`);
    }

    if (context.lastEvaluation) {
      parts.push(renderScorePanel(context.lastEvaluation, width));
    }
  }

  const tree = renderTreeSummary(context.inventory, width);
  if (tree) parts.push(tree);

  if (session.risks.length > 0) {
    parts.push(`  ${C_RED}⚠ ${session.risks[0]?.slice(0, 60)}${C_RESET}`);
  }

  return parts.join("\n");
}

/* ── Main Export ───────────────────────────────────────────── */

export function renderTuiDashboard(
  context: MigrationLoopContext,
  candidateProfiles: readonly TargetArchitectureProfile[],
  criteria: readonly Criterion[],
  message?: string
): string {
  const width = Math.max(60, Math.min(120, process.stdout.columns || 100));

  const sections: string[] = [];

  sections.push(renderHeader(context.session, width));
  sections.push("");

  if (message) {
    sections.push(message);
  } else {
    sections.push(renderDefaultView(context, candidateProfiles, width));
  }

  sections.push("");
  sections.push(renderStatusBar(context.session, context.lastEvaluation, context.tasks, width));

  return sections.join("\n");
}
