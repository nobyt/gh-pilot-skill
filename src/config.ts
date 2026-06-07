import { readFile } from "fs/promises";
import { resolve } from "path";
import yaml from "js-yaml";
import { TaskConfig, TaskConfigSchema } from "./types.js";

export async function loadConfig(filePath: string): Promise<TaskConfig> {
  const absPath = resolve(process.cwd(), filePath);
  const raw = await readFile(absPath, "utf-8");
  const parsed = yaml.load(raw);
  return TaskConfigSchema.parse(parsed);
}

export async function readContextFiles(files: string[]): Promise<string> {
  const parts = await Promise.all(
    files.map(async (f) => {
      const absPath = resolve(process.cwd(), f);
      const content = await readFile(absPath, "utf-8");
      return `<file path="${f}">\n${content}\n</file>`;
    })
  );
  return parts.join("\n\n");
}
