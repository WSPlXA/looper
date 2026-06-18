import { loadConfig } from "../../config/env.js";
import { migrateOneCommand } from "./commands/migrate-one.command.js";
import { migrateBatchCommand } from "./commands/migrate-batch.command.js";
import { migrateProgramCommand } from "./commands/migrate-program.command.js";

const [command, ...args] = process.argv.slice(2);

try {
  const config = loadConfig();
  if (command === "migrate-one") {
    if (args.length < 3) {
      console.error("Usage: npm run migrate -- <source.cob> <output-dir> <ClassName> [max-attempts]");
      process.exitCode = 2;
    } else {
      process.exitCode = await migrateOneCommand(args, config);
    }
  } else if (command === "migrate-batch") {
    if (args.length < 2) {
      console.error("Usage: npm run migrate-batch -- <source-dir> <output-dir> [max-attempts-per-file]");
      process.exitCode = 2;
    } else {
      process.exitCode = await migrateBatchCommand(args, config);
    }
  } else if (command === "migrate-program") {
    if (args.length < 3) {
      console.error("Usage: npm run migrate-program -- <source-dir> <output-dir> <ClassName> [translation-attempts] [repair-attempts]");
      process.exitCode = 2;
    } else {
      process.exitCode = await migrateProgramCommand(args, config);
    }
  } else {
    console.error("Commands:");
    console.error("  migrate-one     <source.cob> <output-dir> <ClassName> [max-attempts]");
    console.error("  migrate-batch   <source-dir> <output-dir> [max-attempts-per-file]");
    console.error("  migrate-program <source-dir> <output-dir> <ClassName> [translation-attempts] [repair-attempts]");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
