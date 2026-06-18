import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().min(1).default("deepseek-v4-pro"),
  RUNS_DIR: z.string().min(1).default("./runs"),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  JAVAC_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
