import type { Agent } from "../core/agent/agent.js";
import type { FileAction } from "../core/actions/agent-action.types.js";
import type { MigrationState } from "../schemas/migration-state.schema.js";

export function buildGenerationLoop(generate: Agent<{
  cobolSource: string;
  plan: NonNullable<MigrationState["plan"]>;
  className: string;
}, Extract<FileAction, { type: "WRITE_FILE" }>>) {
  return async (state: MigrationState): Promise<MigrationState> => {
    if (!state.plan) throw new Error("Generation requires a migration plan");
    const result = await generate({ cobolSource: state.cobolSource, plan: state.plan, className: state.className });
    if (result.path !== `${state.className}.java`) throw new Error(`Model returned path ${result.path}; expected ${state.className}.java`);
    return { ...state, currentJavaCode: result.content };
  };
}
