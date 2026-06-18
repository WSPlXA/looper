import { loadConfig } from "../../config/env.js";
import { migrateOneCommand } from "./commands/migrate-one.command.js";

const [command, ...args] = process.argv.slice(2);
if (command !== "migrate-one" || args.length < 3) {
  console.error("Usage: npm run migrate -- <source.cob> <output-dir> <ClassName> [max-attempts]");
  process.exitCode = 2;
} else {
  try {
    process.exitCode = await migrateOneCommand(args, loadConfig());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
