import { join } from "node:path";
import type { Tool } from "../core/tool/tool.js";
import { migrationReportSchema } from "../schemas/migration-report.schema.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";
import { writeTextFileTool } from "./filesystem.tool.js";

export const reportTool: Tool<{ state: MigrationState }, string> = {
  name: "report",
  description: "Write a final migration report for all terminal states.",
  async execute({ state }) {
    const reportPath = join(state.runDir, "report.json");
    const errorClassDistribution: Record<string, number> = {};
    for (const entry of state.classifications ?? []) {
      const key = entry.classification.errorClass;
      errorClassDistribution[key] = (errorClassDistribution[key] ?? 0) + 1;
    }
    const report = migrationReportSchema.parse({
      runId: state.runId,
      sourceFile: state.sourceFile,
      className: state.className,
      status: state.status,
      attempts: state.attempts,
      ...(state.failureReason ? { failureReason: state.failureReason } : {}),
      ...(state.terminal ? { terminal: state.terminal } : {}),
      ...(state.interrupt ? { interrupt: state.interrupt } : {}),
      ...(state.verification ? { verification: state.verification } : {}),
      ...(state.classifications ? { classifications: state.classifications } : {}),
      ...(state.targetJavaProfile ? { targetJavaProfile: state.targetJavaProfile } : {}),
      ...(state.architectureValidation ? { architectureValidation: state.architectureValidation } : {}),
      errorClassDistribution,
      generatedAt: new Date().toISOString(),
    });
    await writeTextFileTool.execute({ path: reportPath, content: `${JSON.stringify(report, null, 2)}\n` });
    return reportPath;
  },
};
