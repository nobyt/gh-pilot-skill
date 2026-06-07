#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import { loadConfig } from "./config.js";
import { executeTask } from "./executor.js";
import type { TaskResult } from "./types.js";

loadEnv();

function usage(): never {
  console.error("Usage: copilot-delegate <task-file.yaml> [--raw]");
  process.exit(1);
}

function output(result: TaskResult, raw: boolean): void {
  if (raw) {
    console.log(result.status === "success" ? result.message : result.error ?? result.message);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

const args = process.argv.slice(2);
if (args.length === 0) usage();

const raw = args.includes("--raw");
const taskFile = args.find((a) => !a.startsWith("--"));
if (!taskFile) usage();

try {
  const config = await loadConfig(taskFile);
  const result = await executeTask(config);
  output(result, raw);
  process.exit(result.status === "success" ? 0 : 1);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const result: TaskResult = {
    status: "error",
    message: "Task failed",
    editedFiles: [],
    model: "unknown",
    error: message,
  };
  output(result, raw);
  process.exit(1);
}
