import { z } from "zod";

export const PermissionKindSchema = z.enum([
  "shell",
  "write",
  "read",
  "mcp",
  "url",
  "memory",
  "hook",
]);

export type PermissionKind = z.infer<typeof PermissionKindSchema>;

export const TaskConfigSchema = z.object({
  task: z.object({
    type: z.enum(["code-edit", "research", "long-task"]),
    prompt: z.string().min(1),
    context: z
      .object({
        files: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  provider: z
    .object({
      model: z.string().optional(),
    })
    .optional(),
  permissions: z
    .object({
      allowedTools: z.array(PermissionKindSchema).optional(),
    })
    .optional(),
  output: z
    .object({
      format: z.enum(["json", "markdown", "raw"]).optional(),
    })
    .optional(),
});

export type TaskConfig = z.infer<typeof TaskConfigSchema>;

export interface TaskResult {
  status: "success" | "error";
  message: string;
  editedFiles: string[];
  model: string;
  error?: string;
}
