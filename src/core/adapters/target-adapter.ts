import type { ArchitectureDecision } from "../architecture/architecture-decision.js";
import type { CriterionEvidence } from "../criteria/criteria.types.js";
import type { LegacyInventory } from "./source-adapter.js";

export type MigrationTask = {
  id: string;
  programIds: string[];
  allowedPaths: string[];
};

export interface TargetAdapter {
  readonly id: string;
  plan(inventory: LegacyInventory, decision: ArchitectureDecision): Promise<MigrationTask[]>;
  execute(task: MigrationTask, inventory: LegacyInventory): Promise<{ changedFiles: string[] }>;
  verify(task: MigrationTask): Promise<CriterionEvidence[]>;
}
